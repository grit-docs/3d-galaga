/**
 * ExplosionEffect.js
 * ---------------------------------------------------------------
 * Wraps a burst of particles + a brief flash. The ParticleSystem
 * is already pooled, so every call here is just parameter setup.
 *
 * Two presets:
 *   small    - used for regular enemy kills
 *   big      - used for player death + boss dies
 *
 * Each preset also drives a one-shot point-light flash at the
 * explosion centre (for a few frames) for extra punch.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { COLORS } from '../config.js';

const FLASH_DURATION = 0.15; // seconds
const FLASH_STRENGTH = 6;    // light intensity

export class ExplosionEffect {
  constructor(scene, particleSystem) {
    this._scene = scene;
    this._particles = particleSystem;

    // one shared point light, re-used every frame — no allocation
    this._flash = new THREE.PointLight(COLORS.ENEMIES.fighter.glow, 0, 20, 2);
    this._flash.visible = false;
    scene.add(this._flash);
    this._flashTimer = 0;

    this._scratchColor = new THREE.Color();
  }

  _emitBurst(pos, colorHex, speed, count, spread, life, gravity) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (Math.random() - 0.5) * spread;
      const v = (Math.random() - 0.5) * spread;
      this._particles.spawn(pos, {
        color: colorHex,
        vx: Math.cos(a) * speed * (0.6 + Math.random() * 0.8) + r,
        vy: -Math.abs(Math.sin(Math.random() * Math.PI)) * speed * 0.7 + v,
        vz: Math.sin(a) * speed * (0.6 + Math.random() * 0.8) + (Math.random() - 0.5) * spread,
        life: life * (0.7 + Math.random() * 0.6),
        drag: 1.6,
        gravity: gravity,
      });
    }
  }

  /**
   * @param {THREE.Vector3} pos
   * @param {THREE.Color|number} color
   */
  small(pos, color = COLORS.ENEMIES.fighter.core) {
    this._flash.position.copy(pos);
    this._flashTimer = FLASH_DURATION;
    this._flash.visible = true;
    this._flash.intensity = FLASH_STRENGTH * 0.7;
    this._emitBurst(pos, color, 14, 24, 7, 0.55, 4);
  }

  big(pos, color = 0xffc94d) {
    this._flash.position.copy(pos);
    this._flashTimer = FLASH_DURATION;
    this._flash.visible = true;
    this._flash.intensity = FLASH_STRENGTH * 2;
    // double burst for impact
    this._emitBurst(pos, color, 18, 60, 12, 0.9, 2);
    this._emitBurst(pos, 0xffffff, 26, 30, 6, 0.5, 1);
  }

  /** Player hit — cooler tint. */
  playerHit(pos) {
    this._flash.position.copy(pos);
    this._flashTimer = FLASH_DURATION;
    this._flash.visible = true;
    this._flash.intensity = FLASH_STRENGTH * 1.4;
    this._emitBurst(pos, 0x3dc9ff, 16, 40, 10, 0.7, 3);
    this._emitBurst(pos, 0xffffff, 22, 20, 6, 0.4, 1);
  }

  update(dt) {
    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      this._flash.intensity *= (1 - dt * 10);
      if (this._flashTimer <= 0) {
        this._flash.visible = false;
        this._flash.intensity = 0;
      }
    }
  }
}
