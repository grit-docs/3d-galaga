/**
 * ProjectileSystem.js
 * ---------------------------------------------------------------
 * Owns the shared projectile + power-up pools and exposes spawn /
 * update / getActiveProjectiles / deactivateAll helpers.
 *
 * All spawns are pooled — no (re)allocation after boot.
 * Pools are shared so a single boss bullet uses the same resource
 * as a regular enemy shot.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { POOL_DEFAULTS } from '../config.js';
import { Pool } from '../core/Pool.js';
import { Projectile } from '../entities/Projectile.js';
import { PowerUp } from '../entities/PowerUp.js';

// kill-zone bounds for out-of-play culling (world units).
// zMax sits just behind the camera (z=30) so shots despawn as soon
// as they leave the visible frame — no lingering bullets in the sky.
const KILL_ZONE = {
  halfX: 34,
  zMin: -110,
  zMax: 38,
};

export class ProjectileSystem {
  constructor(scene) {
    this._scene = scene;
    this._projectilePool = new Pool(() => this._makeProjectile(), POOL_DEFAULTS.PROJECTILES);
    this._powerupPool = new Pool(() => this._makePowerUp(), POOL_DEFAULTS.POWERUPS);
    this._activeProjectiles = new Set();
    this._activePowerups = new Set();
  }

  _makeProjectile() {
    const p = new Projectile(this._scene, (item) => {
      this._activeProjectiles.delete(item);
      this._projectilePool.release(item);
    });
    return p;
  }

  _makePowerUp() {
    const pu = new PowerUp(this._scene, (item) => {
      this._activePowerups.delete(item);
      this._powerupPool.release(item);
    });
    return pu;
  }

  /**
   * Spawn a player laser. `angle` in radians; 0 = straight.
   * Convention: player fires in -Z direction.
   */
  spawnPlayerShot({ origin, angle = 0, stats }) {
    const speed = stats.baseSpeed;
    const dir = new THREE.Vector3(-Math.sin(angle) * speed, 0, -Math.cos(angle) * speed);
    const off = new THREE.Vector3(origin.x, origin.y + 0.2, origin.z - 1.6);
    const p = this._projectilePool.acquire();
    p.spawn({
      position: off,
      velocity: dir,
      hostile: false,
      damage: stats.baseDamage,
      pierce: stats.pierce ? 2 : 0,
      scale: 1.0,
    });
    this._activeProjectiles.add(p);
    return p;
  }

  spawnPlayerShotFromDrone({ origin, angle, stats }) {
    const speed = stats.baseSpeed;
    const dir = new THREE.Vector3(-Math.sin(angle) * speed, 0, -Math.cos(angle) * speed);
    const p = this._projectilePool.acquire();
    p.spawn({
      position: origin,
      velocity: dir,
      hostile: false,
      damage: Math.round(stats.baseDamage * 0.6),
      pierce: stats.pierce ? 1 : 0,
      scale: 0.8,
    });
    this._activeProjectiles.add(p);
    return p;
  }

  spawnEnemyShot({ origin, dir, speed, damage, scale = 1, kind, life, radius }) {
    const v = dir.clone().multiplyScalar(speed);
    const p = this._projectilePool.acquire();
    p.spawn({
      position: origin,
      velocity: v,
      hostile: true,
      damage,
      scale,
      kind, life,
      radius: radius ?? 0.55,
    });
    this._activeProjectiles.add(p);
    return p;
  }

  spawnPowerUp({ origin, type, fallSpeed }) {
    const pu = this._powerupPool.acquire();
    pu.spawn(origin.x, origin.z, type, fallSpeed);
    this._activePowerups.add(pu);
    return pu;
  }

  update(dt) {
    // projectiles
    for (const p of this._activeProjectiles) {
      p.update(dt, KILL_ZONE);
    }
    // powerups
    for (const pu of this._activePowerups) {
      pu.update(dt);
    }
  }

  get activeProjectiles() {
    return this._activeProjectiles;
  }
  get activePowerups() {
    return this._activePowerups;
  }

  deactivateAll() {
    for (const p of [...this._activeProjectiles]) p.kill();
    for (const pu of [...this._activePowerups]) pu.kill();
  }

  /** Kill only hostile shots — used when the boss dies so the screen
   *  clears of its fire while the player's live lasers / powerups
   *  are left alone. */
  deactivateHostile() {
    for (const p of [...this._activeProjectiles]) {
      if (p.hostile) p.kill();
    }
  }
}
