/**
 * StarFieldSystem.js
 * ---------------------------------------------------------------
 * A 3D starfield that moves toward the player, wrapping around
 * in Z to create an "infinite flight" feel for a fixed shooter.
 * Uses THREE.Points with a shared geometry for low draw cost.
 *
 * The parallax is implemented by giving closer stars (higher Z)
 * a higher speed multiplier: near stars streak faster past the
 * camera, far stars drift slowly, matching the spec's parallax
 * requirement.
 *
 * Motion trails: a second, cheap layer (ONE LineSegments draw call)
 * draws a short -Z streak behind every star head, fading to black so
 * additive blending reads it as a light trail. Trail length = speed ×
 * TRAIL_TIME, so fast/near stars warp-streak while far stars barely
 * tail. Total cost: +1 draw call and one extra float write per star
 * per frame on the CPU — both negligible.
  *
 * Intentionally a "system" with a stable `spawn/update/clear`
 * contract so a future WebGPU compute impl can drop in.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';

// Trail length is "how many seconds of recent travel to show". A star
// moving at 14 u/s tail ≈ 3u (a whisper); one at 44 u/s tail ≈ 10u (a streak).
const TRAIL_TIME = 0.22;

const BOUNDS = {
  X: 90,
  Y: 45,
  Z_MIN: -95,
  Z_MAX: 30,
};

// Radial center fade: screen-space (NDC) radius where the curve reaches
// its floor (center, sparsest) and ceiling (edges, densest). With floor
// 0.07 the core keeps a faint few stars (~7% brightness) instead of a
// dead hole; ~23% darker at screen center is enough to read as "fewer
//" without emptying the middle of the screen.
const FADE_INNER = 0.12;
const FADE_OUTER = 0.60;
const FADE_FLOOR = 0.07;

/** 1 = full density, 0.07 = sparsest (screen center). */
function _radialCurve(x, y) {
  const r = Math.sqrt(x * x + y * y);
  const k = THREE.MathUtils.smoothstep(r, FADE_INNER, FADE_OUTER);
  return FADE_FLOOR + (1 - FADE_FLOOR) * k;
}

export class StarFieldSystem {
  constructor(scene, count = 1800) {
    this._count = count;
    this._positions = new Float32Array(count * 3);
    this._speeds = new Float32Array(count);
    this._sizes = new Float32Array(count);

    // seed
    for (let i = 0; i < count; i++) {
      this._positions[i * 3] = (Math.random() - 0.5) * BOUNDS.X * 2;
      this._positions[i * 3 + 1] = (Math.random() - 0.5) * BOUNDS.Y * 2;
      this._positions[i * 3 + 2] = BOUNDS.Z_MIN + Math.random() * (BOUNDS.Z_MAX - BOUNDS.Z_MIN);
      // parallax: closer stars (larger z) get higher speed
      const z = this._positions[i * 3 + 2];
      const t = (z - BOUNDS.Z_MIN) / (BOUNDS.Z_MAX - BOUNDS.Z_MIN); // 0..1
      this._sizes[i] = 0.08 + t * 0.25;
      this._speeds[i] = 14 + t * 30;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._positions, 3).setUsage(THREE.DynamicDrawUsage));

    const mat = new THREE.PointsMaterial({
      size: 0.22,
      color: 0xbfe6ff,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this._points = new THREE.Points(geo, mat);
    this._points.frustumCulled = false;
    scene.add(this._points);
    this._geometry = geo;

    // ---- motion trails ---------------------------------------------
    // LineSegments: vertex 0 = bright head, vertex 1 = black tail. The
    // line interpolates to black, and under additive blending black adds
    // nothing → a fading light streak. Positions are dynamic (rewritten
    // in update); colors are set once (per-star brightness variation).
    this._trailPos = new Float32Array(count * 6);
    this._trailCol = new Float32Array(count * 6);
    const base = new THREE.Color(0xbfe6ff);
    // Per-star base brightness (0.35..0.95) — trail head colors are
    // derived from this × the radial fade curve, rewritten in update()
    // with the same "only when the fade changed" guard as the points.
    this._trailBright = new Float32Array(count);
    this._baseR = base.r; this._baseG = base.g; this._baseB = base.b;
    for (let i = 0; i < count; i++) {
      this._trailBright[i] = 0.35 + Math.random() * 0.6;
      const bright = this._trailBright[i];
      const i6 = i * 6;
      this._trailCol[i6]     = base.r * bright;
      this._trailCol[i6 + 1] = base.g * bright;
      this._trailCol[i6 + 2] = base.b * bright;
      // tail vertex stays (0,0,0) = invisible under additive blending
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this._trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(this._trailCol, 3));
    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._trails = new THREE.LineSegments(trailGeo, trailMat);
    this._trails.frustumCulled = false;
    scene.add(this._trails);
    this._trailGeo = trailGeo;
  }

  update(dt, intensity = 1, camera = null) {
    const P = this._positions;
    const T = this._trailPos;
    const C = camera ? camera.projectionMatrix.elements : null;
    const hasCam = !!(C && camera.aspect);
    const w = Math.max(1, camera ? Math.round(camera.aspect * 100) | 0 : 100);
    const h = 100;
    const trailCol = this._trailCol;
    const bR = this._baseR, bG = this._baseG, bB = this._baseB;
    const tb = this._trailBright;
    let trailColDirty = false;
    for (let i = 0; i < this._count; i++) {
      const i3 = i * 3;
      const i6 = i * 6;
      P[i3 + 2] += this._speeds[i] * dt * intensity;
      if (P[i3 + 2] > BOUNDS.Z_MAX) {
        P[i3 + 2] = BOUNDS.Z_MIN;
        P[i3] = (Math.random() - 0.5) * BOUNDS.X * 2;
        P[i3 + 1] = (Math.random() - 0.5) * BOUNDS.Y * 2;
        // keep speed consistent with new z
        const t = (P[i3 + 2] - BOUNDS.Z_MIN) / (BOUNDS.Z_MAX - BOUNDS.Z_MIN);
        this._speeds[i] = 14 + t * 30;
        // respawned: re-evaluate fade below (no skip via _lastRadial)
      }
      // ---- radial center fade ---------------------------------
      // Star's screen-space center offset (viewport units, 0 = middle).
      // Perspective divide via w = -z_eye, so only matrix rows used:
      // x_eye = C0*px + C1*py + C2*pz,  w    = C8*px + C9*py + C10*pz.
      let f = 1;
      if (hasCam) {
        const px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
        const we = C[8] * px + C[9] * py + C[10] * pz - C[14];
        if (we < 1e-3) {
          f = 0; // at/behind the camera — invisible anyway
        } else {
          const xe = C[0] * px + C[1] * py + C[2] * pz - C[12];
          const ye = C[4] * px + C[5] * py + C[6] * pz - C[13];
          const nx = (xe / we) * (w / 2);
          const ny = (ye / we) * (h / 2);
          f = _radialCurve(nx / w, ny / h);
        }
      }
      // rewrite colors only when the fade actually moved (the curve is
      // gentle, so most stars skip most frames → tiny buffer uploads)
      if (f !== this._trailBright[i]) {
        this._trailBright[i] = f;
        const i6c = i * 6;
        trailCol[i6c]     = bR * f;
        trailCol[i6c + 1] = bG * f;
        trailCol[i6c + 2] = bB * f;
        // tail vertex stays 0
        trailColDirty = true;
      }
      // streak = the last TRAIL_TIME seconds of travel: a -Z segment
      // behind the head. Longer for faster (nearer) stars on purpose.
      const L = this._speeds[i] * TRAIL_TIME * intensity;
      T[i6] = P[i3];     T[i6 + 1] = P[i3 + 1];   T[i6 + 2] = P[i3 + 2];
      T[i6 + 3] = P[i3]; T[i6 + 4] = P[i3 + 1];   T[i6 + 5] = P[i3 + 2] - L;
    }
    this._geometry.attributes.position.needsUpdate = true;
    this._trailGeo.attributes.position.needsUpdate = true;
    if (trailColDirty) this._trailGeo.attributes.color.needsUpdate = true;
  }

  /** Show/hide the whole starfield (points + trails). */
  setActive(v) {
    this._points.visible = v;
    this._trails.visible = v;
  }

  clear() {
    // optional: hide the whole starfield (used on some UI states)
    this.setActive(false);
  }
}
