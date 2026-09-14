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
 * Intentionally a "system" with a stable `spawn/update/clear`
 * contract so a future WebGPU compute impl can drop in.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';

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
  }

  update(dt, intensity = 1) {
    const P = this._positions;
    for (let i = 0; i < this._count; i++) {
      P[i * 3 + 2] += this._speeds[i] * dt * intensity;
      if (P[i * 3 + 2] > BOUNDS.Z_MAX) {
        P[i * 3 + 2] = BOUNDS.Z_MIN;
        P[i * 3] = (Math.random() - 0.5) * BOUNDS.X * 2;
        P[i * 3 + 1] = (Math.random() - 0.5) * BOUNDS.Y * 2;
        // keep speed consistent with new z
        const t = (P[i * 3 + 2] - BOUNDS.Z_MIN) / (BOUNDS.Z_MAX - BOUNDS.Z_MIN);
        this._speeds[i] = 14 + t * 30;
      }
    }
    this._geometry.attributes.position.needsUpdate = true;
  }

  clear() {
    // optional: hide the whole starfield (used on some UI states)
    this._points.visible = false;
  }
}
