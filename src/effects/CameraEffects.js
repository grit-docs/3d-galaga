/**
 * CameraEffects.js
 * ---------------------------------------------------------------
 * A small camera FX layer that runs once per frame and nudges the
 * camera between:
 *
 *   - a fixed base pose (set by Renderer.js),
 *   - a subtle player-follow offset (lateral only),
 *   - a decaying random shake (from explosions / hits).
 *
 * All effects are intentionally subtle; the goal is to add punch
 * without hurting play ability.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';

export class CameraEffects {
  constructor(renderer, camera) {
    this._renderer = renderer;
    this._camera = camera;
    this.shake = 0;
    this.shakeDecay = 6.5;
    this.shakeAmp = 0;
    this._v = new THREE.Vector3();
    this._t = 0;
  }

  /** Trigger a shake (0..1 intensity). */
  addShake(intensity) {
    this.shake = Math.max(this.shake, intensity);
    this.shakeAmp = 0.15 + intensity * 0.9;
  }

  update(dt, playerX) {
    this._t += dt;
    if (this.shake > 0) {
      this.shake -= this.shakeDecay * dt;
      if (this.shake < 0) this.shake = 0;
    }

    const base = this._renderer.cameraBase();
    // lateral follow of the player
    const follow = playerX * 0.05;
    this._v.set(
      base.pos.x + follow,
      base.pos.y,
      base.pos.z
    );
    // shake offset (random but bounded)
    const amp = this.shakeAmp * this.shake;
    if (amp > 0.0001) {
      this._v.x += (Math.random() - 0.5) * amp * 0.3;
      this._v.y += (Math.random() - 0.5) * amp * 0.3;
      this._v.z += (Math.random() - 0.5) * amp * 0.2;
    }
    this._camera.position.lerp(this._v, 0.35);
    this._camera.lookAt(base.look);
  }
}
