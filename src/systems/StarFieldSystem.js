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
    for (let i = 0; i < count; i++) {
      const bright = 0.35 + Math.random() * 0.6;
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

  update(dt, intensity = 1) {
    const P = this._positions;
    const T = this._trailPos;
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
      }
      // streak = the last TRAIL_TIME seconds of travel: a -Z segment
      // behind the head. Longer for faster (nearer) stars on purpose.
      const L = this._speeds[i] * TRAIL_TIME * intensity;
      T[i6] = P[i3];     T[i6 + 1] = P[i3 + 1];   T[i6 + 2] = P[i3 + 2];
      T[i6 + 3] = P[i3]; T[i6 + 4] = P[i3 + 1];   T[i6 + 5] = P[i3 + 2] - L;
    }
    this._geometry.attributes.position.needsUpdate = true;
    this._trailGeo.attributes.position.needsUpdate = true;
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
