/**
 * ParticleSystem.js
 * ---------------------------------------------------------------
 * CPU-based particle pool, rendered as a THREE.Points cloud with
 * additive blending. Fixed max capacity, ring-buffer allocation.
 *
 * The abstraction is intentionally decoupled from the GPU: the
 * update loop writes into a buffer attribute. Swapping this for a
 * WebGPU compute-backed impl later only requires the same
 * `spawn()` / `update(dt)` contract.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';

const OFFSCREEN_Y = 1e9;

export class ParticleSystem {
  constructor(scene, max = 1200) {
    this._max = max;
    this._positions = new Float32Array(max * 3);
    this._colors = new Float32Array(max * 3);
    // Spawn-time colour, kept separately: the visible colour buffer is
    // base × (life/maxLife) recomputed each frame. Previously the fade
    // was MULTIPLIED into the colour buffer every frame, so brightness
    // decayed exponentially (compounding ~0.98^frames → denormals →
    // zero) and dead particles kept stale garbage in the buffer, which
    // was re-uploaded to the GPU every single frame.
    this._baseColors = new Float32Array(max * 3);
    this._velocities = new Float32Array(max * 3);
    this._life = new Float32Array(max);
    this._maxLife = new Float32Array(max);
    this._drag = new Float32Array(max);
    this._grav = new Float32Array(max);
    this._next = 0;

    for (let i = 0; i < max; i++) {
      this._positions[i * 3 + 1] = OFFSCREEN_Y;
      this._life[i] = 0;
    }

    this._geometry = new THREE.BufferGeometry();
    this._geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3).setUsage(THREE.DynamicDrawUsage));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(this._colors, 3).setUsage(THREE.DynamicDrawUsage));

    this._material = new THREE.PointsMaterial({
      size: 0.4,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this._points = new THREE.Points(this._geometry, this._material);
    this._points.frustumCulled = false;
    scene.add(this._points);

    this._tempColor = new THREE.Color();
  }

  /**
   * @param {THREE.Vector3|{x,y,z}} pos
   * @param {object} opts color / vx,vy,vz / life / drag / gravity
   */
  spawn(pos, opts = {}) {
    const i = this._next;
    this._next = (this._next + 1) % this._max;
    const { color = 0xffffff, vx = 0, vy = 0, vz = 0, life = 0.7, drag = 0, gravity = 0 } = opts;

    if (typeof color === 'number') this._tempColor.setHex(color);
    else this._tempColor.copy(color);

    this._positions[i * 3] = pos.x;
    this._positions[i * 3 + 1] = pos.y;
    this._positions[i * 3 + 2] = pos.z;
    this._velocities[i * 3] = vx;
    this._velocities[i * 3 + 1] = vy;
    this._velocities[i * 3 + 2] = vz;
    this._baseColors[i * 3] = this._tempColor.r;
    this._baseColors[i * 3 + 1] = this._tempColor.g;
    this._baseColors[i * 3 + 2] = this._tempColor.b;
    // spawn fully bright (life just reset to full below)
    this._colors[i * 3] = this._baseColors[i * 3];
    this._colors[i * 3 + 1] = this._baseColors[i * 3 + 1];
    this._colors[i * 3 + 2] = this._baseColors[i * 3 + 2];
    this._life[i] = life;
    this._maxLife[i] = life;
    this._drag[i] = drag;
    this._grav[i] = gravity;
  }

  update(dt) {
    const P = this._positions;
    const C = this._colors;
    const V = this._velocities;
    const L = this._life;
    for (let i = 0; i < this._max; i++) {
      let life = L[i];
      if (life <= 0) continue;
      life -= dt;
      if (life <= 0) {
        L[i] = 0;
        P[i * 3 + 1] = OFFSCREEN_Y;
        this._resetColor(i);
        continue;
      }
      L[i] = life;
      const d = this._drag[i];
      if (d > 0) {
        const f = Math.max(0, 1 - d * dt);
        V[i * 3] *= f; V[i * 3 + 1] *= f; V[i * 3 + 2] *= f;
      }
      V[i * 3 + 1] -= this._grav[i] * dt;

      P[i * 3] += V[i * 3] * dt;
      P[i * 3 + 1] += V[i * 3 + 1] * dt;
      P[i * 3 + 2] += V[i * 3 + 2] * dt;

      // derive visible colour from the immutable spawn colour
      const fade = life / this._maxLife[i];
      const i3 = i * 3;
      C[i3] = this._baseColors[i3] * fade;
      C[i3 + 1] = this._baseColors[i3 + 1] * fade;
      C[i3 + 2] = this._baseColors[i3 + 2] * fade;
    }
    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
  }

  /** Zero a dead particle's colour so the upload buffer stays clean. */
  _resetColor(i) {
    const i3 = i * 3;
    this._colors[i3] = 0;
    this._colors[i3 + 1] = 0;
    this._colors[i3 + 2] = 0;
  }

  clear() {
    for (let i = 0; i < this._max; i++) {
      this._life[i] = 0;
      this._positions[i * 3 + 1] = OFFSCREEN_Y;
      this._resetColor(i);
    }
    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this._geometry.dispose();
    this._material.dispose();
  }
}
