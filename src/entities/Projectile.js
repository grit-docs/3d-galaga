/**
 * Projectile.js
 * ---------------------------------------------------------------
 * A single pooled laser. Used for BOTH player lasers and enemy
 * bullets — the `hostile` flag + `style` field drive rendering and
 * collision routing in the CollisionSystem.
 *
 * Pooled: call `spawn(...)` to (re)initialise, `kill()` to return
 * it to the pool (via the owner ProjectileSystem).
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { COLORS } from '../config.js';

// shared geometries/materials — created ONCE, shared across all shots
const GEO_PLAYER = new THREE.CapsuleGeometry(0.09, 0.55, 3, 8);
const GEO_ENEMY = new THREE.SphereGeometry(0.17, 8, 6);
const GEO_CORE = new THREE.SphereGeometry(0.06, 6, 4);

const MAT_PLAYER = new THREE.MeshStandardMaterial({
  color: 0x06222e,
  emissive: COLORS.PLAYER_LASER,
  emissiveIntensity: 3.2,
  roughness: 0.2,
});
const MAT_PLAYER_CORE = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xbfffff,
  emissiveIntensity: 4.0,
});
const MAT_ENEMY = new THREE.MeshStandardMaterial({
  color: 0x33001a,
  emissive: COLORS.ENEMY_BULLET,
  emissiveIntensity: 2.6,
  roughness: 0.35,
});
const MAT_ENEMY_CORE = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffc0dc,
  emissiveIntensity: 3.5,
});

export class Projectile {
  constructor(scene, poolRelease) {
    this.group = new THREE.Group();
    this._release = poolRelease; // () => pool.release(this)

    // player laser body
    this.playerShot = new THREE.Mesh(GEO_PLAYER, MAT_PLAYER);
    this.playerCore = new THREE.Mesh(GEO_CORE, MAT_PLAYER_CORE);
    this.playerShot.rotation.x = Math.PI / 2;
    this.group.add(this.playerShot, this.playerCore);

    // enemy orb (generic hostile shot)
    this.enemyShot = new THREE.Mesh(GEO_ENEMY, MAT_ENEMY);
    this.enemyCore = new THREE.Mesh(GEO_CORE, MAT_ENEMY_CORE);
    // enemy bullets are 30% smaller (visual only — the shared hitbox radius
    // in spawn() is untouched, so dodging fairness is unchanged).
    this.enemyShot.scale.setScalar(0.7);
    this.enemyCore.scale.setScalar(0.7);
    this.group.add(this.enemyShot, this.enemyCore);
    this.enemyShot.visible = false;
    this.enemyCore.visible = false;

    this.group.visible = false;
    scene.add(this.group);

    this.active = false;
    this.hostile = false;
    this.speed = 0;
    this.damage = 0;
    this.pierce = 0; // remaining pierce hits (0 = normal)
    this.radius = 0.5;
    this._vx = 0;
    this._vz = 0;
    this._life = 0;
  }

  onRecycle() {
    this.active = false;
    this.group.visible = false;
    this.pierce = 0;
  }

  /**
   * @param {object} opts { position, velocity, damage, hostile, pierce, radius, speedScale }
   */
  spawn(opts) {
    this.active = true;
    this.group.visible = true;
    this.hostile = !!opts.hostile;
    this.damage = opts.damage;
    this.pierce = opts.pierce ?? 0;
    this.radius = opts.radius ?? (opts.hostile ? 0.55 : 0.5);

    this._vx = opts.velocity.x;
    this._vz = opts.velocity.z;
    this.group.position.copy(opts.position);
    this.group.rotation.set(0, 0, 0);

    this.playerShot.visible = !this.hostile;
    this.playerCore.visible = !this.hostile;
    this.enemyShot.visible = this.hostile;
    this.enemyCore.visible = this.hostile;

    // scale: shots are small by design
    const s = opts.scale ?? 1;
    this.group.scale.setScalar(s);

    // Hard lifetime budget so ANY shot (including sideways/horizontal
    // boss ring shots that never cross the z kill-zone) despawns.
    this._life = opts.life ?? (opts.hostile ? 4.0 : 2.4);
    return this;
  }

  update(dt, killZone) {
    if (!this.active) return;

    // lifetime expiry — last line of defense against lingering shots
    this._life -= dt;
    if (this._life <= 0) {
      this.kill();
      return;
    }

    this.group.position.x += this._vx * dt;
    this.group.position.z += this._vz * dt;

    if (this.hostile) {
      // spin the orb a bit for life
      this.group.rotation.y += dt * 10;
    }

    const p = this.group.position;
    // B7: ProjectileSystem passes { halfX, zMin, zMax } — use exactly
    // that shape. (Previously this read killZone.x/.top/.bottom which
    // were undefined, so culling never fired.)
    if (
      Math.abs(p.x) > killZone.halfX ||
      p.z > killZone.zMax ||
      p.z < killZone.zMin
    ) {
      // kill (not just deactivate) so the object returns to the pool —
      // a plain deactivate leaked the item into the active Set forever.
      this.kill();
    }
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.group.visible = false;
  }

  kill() {
    // idempotent so that deactivateAll / collision / bounds never
    // double-release the same projectile back to the pool.
    if (!this.active) return;
    this.deactivate();
    this.onRecycle();
    this._release(this);
  }
}
