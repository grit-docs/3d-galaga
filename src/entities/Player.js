/**
 * Player.js
 * ---------------------------------------------------------------
 * The player craft.
 * - Acceleration based lateral movement with drag (no instant snap).
 * - Bank / lean into turns, ease back to level.
 * - Dash with invulnerability + cooldown.
 * - Shield / life management, brief hit invulnerability.
 * - Weapon state (level, rapid) used by the
 *   ProjectileSystem to decide what to spawn.
 * Owns its own 3D group; systems read/write its state.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { BOUNDS, PLAYER, WEAPON } from '../config.js';
import { buildPlayerShip } from './ShipBuilder.js';

/** Scratch vectors reused every frame to avoid allocation. */
const _bankTarget = new THREE.Vector3();
const _kick = new THREE.Vector3();

export class Player {
  constructor() {
    this.group = buildPlayerShip();
    this.group.name = 'player';
    // Visual size: 0.63 (base) × 0.9 × 0.9 (two further 10% reductions)
    // = 0.5103 of the original hull. The collision radius (`this.radius`)
    // is scaled down with the hull so the hitbox matches the sprite.
    this.group.scale.setScalar(0.63 * 0.9 * 0.9);

    this.velocityX = 0;
    this.alive = true;
    this.visible = true;

    this.lives = PLAYER.MAX_LIVES;
    this.shield = PLAYER.MAX_SHIELD;
    this.invulnTimer = 0;

    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashDir = 0;

    // weapon upgrades
    this.weaponLevel = 1;
    this.rapidLevel = 0; // permanent Rapid stack (cap: WEAPON.RAPID_MAX_LEVEL)

    this._collectEngines();

    this._t = 0;
    // 1.35 base x 0.9 (this request's 10% reduction) = 1.215, matching the
    // shrunk visual hull.
    this.radius = 1.35 * 0.9;
  }

  _collectEngines() {
    const list = [];
    this.group.traverse((o) => {
      if (o.name === 'engine') list.push(o);
    });
    this._engines = list;
  }

  reset() {
    this.group.position.set(0, BOUNDS.PLAYER_Y, BOUNDS.PLAYER_Z);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.velocityX = 0;
    this.alive = true;
    this.visible = true;
    this.lives = PLAYER.MAX_LIVES;
    this.shield = PLAYER.MAX_SHIELD;
    this.invulnTimer = PLAYER.RESPAWN_INVULN_TIME;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashDir = 0;
    this.weaponLevel = 1;
    this.rapidLevel = 0;
  }

  get position() {
    return this.group.position;
  }

  /** Current weapon stats resolved from level + temporary buffs. */
  weaponStats() {
    const i = Math.min(this.weaponLevel - 1, WEAPON.COUNTS.length - 1);
    return {
      count: WEAPON.COUNTS[i],
      spread: WEAPON.SPREAD[i],
      baseSpeed: WEAPON.PROJECTILE_SPEED + WEAPON.SPEED_BONUS[i],
      baseDamage: WEAPON.DAMAGE + WEAPON.DMG_BONUS[i],
      baseRate: WEAPON.FIRE_RATE + this.rapidLevel * WEAPON.RAPID_RATE_PER_LEVEL,
      rapid: this.rapidLevel > 0,
      rapidLevel: this.rapidLevel,
    };
  }

  /**
   * @param input   InputManager
   * @param dt      delta seconds
   * @param now     elapsed game time (for timers)
   */
  update(input, dt, now) {
    this._t += dt;

    // --- timers -------------------------------------------------
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    if (this.dashCooldown > 0) this.dashCooldown -= dt;

    if (!this.alive) return;

    // --- lateral movement --------------------------------------
    let axis = this.dashTimer > 0 ? this.dashDir : input.axisX;
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.velocityX = this.dashDir * PLAYER.DASH_SPEED;
    } else {
      const accel = PLAYER.ACCEL_X * dt;
      this.velocityX += axis * accel;
      // drag / decel
      this.velocityX -= this.velocityX * Math.min(1, PLAYER.DRAG * dt);
      // clamp
      const max = PLAYER.MAX_SPEED_X;
      if (this.velocityX > max) this.velocityX = max;
      else if (this.velocityX < -max) this.velocityX = -max;
    }

    this.group.position.x += this.velocityX * dt;
    if (this.group.position.x > BOUNDS.PLAYER_MAX_X) {
      this.group.position.x = BOUNDS.PLAYER_MAX_X;
      this.velocityX = 0;
    } else if (this.group.position.x < BOUNDS.PLAYER_MIN_X) {
      this.group.position.x = BOUNDS.PLAYER_MIN_X;
      this.velocityX = 0;
    }
    // keep a tiny hover bob for life
    this.group.position.y = BOUNDS.PLAYER_Y + Math.sin(this._t * 2.2) * 0.06;
    // fixed-rail shooter: the craft never advances in Z (prevents
    // any drift from muzzle-kick style nudges accumulating).
    this.group.position.z = BOUNDS.PLAYER_Z;

    // --- banking ------------------------------------------------
    const speedRatio = THREE.MathUtils.clamp(this.velocityX / PLAYER.MAX_SPEED_X, -1, 1);
    _bankTarget.set(
      0,
      0,
      -speedRatio * PLAYER.BANK_TILT
    );
    // pitch slightly with speed
    const targetX = speedRatio * PLAYER.BANK_Z * 0.4;
    const lerp = Math.min(1, PLAYER.BANK_LERP * dt);
    this.group.rotation.z += (_bankTarget.z - this.group.rotation.z) * lerp;
    this.group.rotation.x += (targetX - this.group.rotation.x) * lerp;

    // --- engine / invuln visuals --------------------------------
    const engineGlow = 1.6 + Math.abs(speedRatio) * 1.2 + Math.sin(this._t * 30) * 0.25;
    for (const e of this._engines) {
      const s = 0.2 + Math.min(0.5, Math.abs(speedRatio) * 0.4) + Math.sin(this._t * 40) * 0.04;
      e.scale.set(s, s, 0.3 * (1 + Math.min(1, Math.abs(speedRatio))));
      e.material.emissiveIntensity = engineGlow;
    }

    // --- invulnerability flicker (subtle) ------------------------
    if (this.invulnTimer > 0) {
      this.group.visible = Math.sin(this._t * 28) > -0.6;
    } else {
      this.group.visible = true;
    }

    // --- dash trigger ------------------------------------------
    if (input.dashPressed && this.dashCooldown <= 0 && this.dashTimer <= 0) {
      this.dashTimer = PLAYER.DASH_TIME;
      this.dashDir = input.axisX !== 0 ? input.axisX : Math.sign(this.velocityX) || 1;
      this.dashCooldown = PLAYER.DASH_COOLDOWN;
      this.invulnTimer = Math.max(this.invulnTimer, PLAYER.DASH_INVULN);
    }
  }

  takeDamage(amount) {
    if (this.invulnTimer > 0 || !this.alive) return false;
    this.shield -= amount;
    if (this.shield <= 0) {
      // lose a life (ship destroyed)
      this.lives -= 1;
      this.shield = PLAYER.MAX_SHIELD;
      this.invulnTimer = PLAYER.INVULN_TIME;
      if (this.lives <= 0) {
        this.alive = false;
        this.visible = false;
        this.group.visible = false;
        return 'dead';
      }
      return 'lostLife';
    }
    return 'hit';
  }

  heal(amount = 45) {
    // clamp to [0, MAX] — negative amounts (elite capture-beam chip)
    // simply reduce shield, never driving it below zero.
    this.shield = Math.max(0, Math.min(PLAYER.MAX_SHIELD, this.shield + amount));
  }

  /** +1 Rapid level (permanent, capped). Each level adds fire rate. */
  grantRapid() {
    this.rapidLevel = Math.min(WEAPON.RAPID_MAX_LEVEL, this.rapidLevel + 1);
  }

  /** Wipe collected upgrades (weapon + Rapid) — called on ship destruction. */
  resetCollected() {
    this.weaponLevel = 1;
    this.rapidLevel = 0;
  }

  upgradeWeapon() {
    this.weaponLevel = Math.min(WEAPON.MAX_LEVEL, this.weaponLevel + 1);
  }
}
