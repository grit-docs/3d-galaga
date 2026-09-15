/**
 * Enemy.js
 * ---------------------------------------------------------------
 * A single hostile craft with a small state machine:
 *
 *   ENTERING   -> fly in on a curve to a formation slot
 *   FORMATION  -> bob in place (occasionally fire)
 *   DIVING     -> follow an attack curve toward / past the player
 *   REJOINING  -> curve back to its formation slot
 *
 * Curve movement is sampled by arc length (getPointAt) for constant
 * speed; the craft orients nose-first along the travel tangent.
 *
 * Pattern variants:
 *   fighter     -> simple curved dive
 *   interceptor -> fast S-curve dive
 *   heavy       -> slow lob dive + volleys while diving
 *   elite       -> predictive dive (aims where the player will be)
 *
 * Scratch vectors are module-level so no per-frame allocation.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { COLORS, DIVE, ENEMY, ENEMY_PROJECTILE, WAVE } from '../config.js';
import { buildEnemyShip } from './ShipBuilder.js';

const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _mLook = new THREE.Matrix4();
const _fireDir = new THREE.Vector3();
const _rotDir = new THREE.Vector3();

/** Size an enemy eases to as a dive closes in on the player.
 * Full-size enemies right next to the player read disproportionately large,
 * so the hull (and its hitbox) shrinks near closest approach and eases back
 * to 1 on the way out. */
const DIVE_SHRINK = 0.5;

export class Enemy {
  constructor(type) {
    this.type = type;
    this.palette = COLORS.ENEMIES[type];
    this.group = buildEnemyShip(type, this.palette);
    this.group.name = `enemy-${type}`;

    this._baseRadius = ENEMY.RADIUS[type];
    this.radius = this._baseRadius;
    this._diveScale = 1; // dive-shrink factor, eases toward DIVE_SHRINK
    this.maxHp = 1;
    this.hp = 1;

    this.state = 'ENTERING';
    this.formationIndex = -1;
    this.formationSlot = new THREE.Vector3();
    this.active = true;
    this.dying = false;

    this._curve = null;
    this._curveT = 0;
    this._bobPhase = Math.random() * Math.PI * 2;
    this._fireCooldown = 0.8 + Math.random() * 1.6;
    this._volleyLeft = 0;
    this._t = Math.random() * 10;
    this._hitFlash = 0; // non-lethal hit punch (0..1), decayed in update
    this._engines = [];
    this._collectEngines();
  }

  _collectEngines() {
    const list = [];
    let core = null;
    this.group.traverse((o) => {
      if (o.name === 'engine') list.push(o);
      if (o.name === 'core') core = o;
    });
    this._engines = list;
    this._core = core; // reactor: breathed idly, flares on hit
  }

  onRecycle() {
    this.active = false;
    this.dying = false;
  }

  /** Configure for a wave. */
  configure({ slot, index, spawnFrom, hpScale }) {
    this.formationIndex = index;
    this.formationSlot.copy(slot);
    this.maxHp = Math.max(1, Math.round(ENEMY.BASE_HP[this.type] * hpScale));
    this.hp = this.maxHp;
    this.state = 'ENTERING';
    this.active = true;
    this.dying = false;
    this._bobPhase = Math.random() * Math.PI * 2;
    this._fireCooldown = 0.8 + Math.random() * 1.6;
    this._volleyLeft = 0;

    const from = spawnFrom
      ? spawnFrom.clone()
      : new THREE.Vector3(this.formationSlot.x * 1.8, 8, -85);
    this._buildCurve(from, this.formationSlot);
    this.group.position.copy(from);
    // start full-size (a recycled enemy may have died mid-shrink at 0.5)
    this._diveScale = 1;
    this.group.scale.setScalar(1);
    this.group.visible = true;
  }

  _buildCurve(from, to) {
    const mid = from.clone().lerp(to, 0.5);
    mid.x += (Math.random() - 0.5) * 7;
    mid.y += 10 + Math.random() * 4;
    mid.z += 16;
    this._curve = new THREE.CatmullRomCurve3([from, mid, to], false, 'catmullrom', 0.4);
    this._curveT = 0;
  }

  _buildDiveCurve(game) {
    const start = this.group.position.clone();
    const player = game._context.player.group.position;
    const px = player.x;
    const pz = player.z;
    let pts;
    if (this.type === 'interceptor') {
      pts = [
        start,
        new THREE.Vector3(start.x + (Math.random() - 0.5) * 5, 6, start.z + 5),
        new THREE.Vector3(-px, 3, -10),
        new THREE.Vector3(px * 0.8, 1, pz - 6),
        new THREE.Vector3(px * 0.35, 0, pz + 20),
      ];
    } else if (this.type === 'heavy') {
      pts = [
        start,
        new THREE.Vector3(start.x * 0.5, 9, -16),
        new THREE.Vector3(px * 0.6, 11, -2),
        new THREE.Vector3(px * 1.1, 8, pz - 5),
        new THREE.Vector3(px * 1.1, 3, pz + 14),
      ];
      this._volleyLeft = 3;
    } else if (this.type === 'elite') {
      // predict: aim ~2.2s of the player's lateral travel ahead
      const predictedX = px + game._context.player.velocityX * 2.2;
      pts = [
        start,
        new THREE.Vector3(predictedX * 0.6, 6, -14),
        new THREE.Vector3(predictedX * 1.05, 2, pz - 6),
        new THREE.Vector3(predictedX * 1.2, 0, pz + 16),
      ];
    } else {
      // fighter: simple curved pass
      const side = px >= 0 ? -1 : 1;
      pts = [
        start,
        new THREE.Vector3(px * 0.8 + side * 4, 7, -16),
        new THREE.Vector3(px * 0.5 + side * 2, 2, -6),
        new THREE.Vector3(px, 0.5, pz - 5),
        new THREE.Vector3(px + side * 1.5, -1, pz + 18),
      ];
    }
    this._curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.45);
    this._curveT = 0;
  }

  _buildReturnCurve(to) {
    const from = this.group.position.clone();
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 8;
    mid.x += (from.x > 0 ? -1 : 1) * 5;
    this._curve = new THREE.CatmullRomCurve3([from, mid, to], false, 'catmullrom', 0.4);
    this._curveT = 0;
  }

  get position() {
    return this.group.position;
  }

  isDiving() {
    return this.state === 'DIVING';
  }

  /**
   * @param game the Game (holds _context with shared systems/refs)
   */
  update(game, dt, wave) {
    if (!this.active || this.dying) return;
    this._t += dt;
    this._updateDiveScale(dt);
    this._engineGlow();
    this._corePulse();
    this._hitPulse(dt);

    switch (this.state) {
      case 'ENTERING':
        this._advanceCurve(dt, 1 / DIVE.ENTER_TIME, () => { this.state = 'FORMATION'; });
        break;
      case 'FORMATION':
        this._bobInFormation();
        this._tryFire(game, dt, wave);
        break;
      case 'DIVING': {
        const speedMul = this.type === 'interceptor' ? 0.55 : this.type === 'heavy' ? 1.7 : 1;
        if (this.type === 'heavy' && this._volleyLeft > 0 && Math.random() < 0.04) {
          this._volleyLeft -= 1;
          this._fire(game, wave, 1);
        }
        this._advanceCurve(dt, (1 / (DIVE.TRAVEL_TIME * speedMul)), () => {
          this.state = 'REJOINING';
          this._buildReturnCurve(this.formationSlot);
        });
        break;
      }
      case 'REJOINING':
        this._advanceCurve(dt, 1 / DIVE.RETURN_TIME, () => { this.state = 'FORMATION'; });
        break;
      default:
        break;
    }
  }

  _advanceCurve(dt, speed, onDone) {
    if (!this._curve) return;
    this._curveT = Math.min(1, this._curveT + speed * dt);
    this._curve.getPointAt(this._curveT, _pos);
    this.group.position.copy(_pos);
    this._orientAlongTangent(this._curveT);
    if (this._curveT >= 1) onDone();
  }

  _orientAlongTangent(u) {
    if (!this._curve) return;
    this._curve.getTangentAt(THREE.MathUtils.clamp(u, 0.001, 0.999), _tgt);
    if (_tgt.lengthSq() < 1e-6) return;
    // Ship bow points -Z in model space; align -Z with travel direction.
    // lookAt orients +Z toward target, so aim at (pos - tangent).
    _tgt.copy(_pos).addScaledVector(_tgt, -1);
    _mLook.lookAt(_pos, _tgt, _up);
    this.group.quaternion.setFromRotationMatrix(_mLook);
  }

  _bobInFormation() {
    const slot = this.formationSlot;
    const bob = Math.sin(this._t * (Math.PI * 2 / ENEMY.FORMATION_WOBBLE) + this._bobPhase) * ENEMY.FORMATION_BOB;
    this.group.position.set(slot.x, bob, slot.z);
    // face the front (toward player) with a gentle sway
    this.group.rotation.set(0, Math.sin(this._t * 0.9 + this._bobPhase) * 0.12, 0);
  }

  _tryFire(game, dt, wave) {
    if (this._fireCooldown > 0) {
      this._fireCooldown -= dt;
      return;
    }
    const chance = WAVE.FIRE_CHANCE + Math.max(0, wave - 1) * 0.025;
    if (Math.random() > chance) return;
    this._fireCooldown = 1.1 + Math.random() * 1.8;
    this._fire(game, wave, this.type === 'heavy' ? 3 : this.type === 'interceptor' ? 2 : 1);
  }

  _fire(game, wave, count) {
    const speed = ENEMY_PROJECTILE.BASE_SPEED + ENEMY_PROJECTILE.WAVESPEED_BONUS * Math.max(0, wave - 1);
    const ctx = game._context;
    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * 0.16;
      _rotDir.set(Math.sin(spread), 0, Math.cos(spread));
      // B4: named-argument spawn — single canonical shape.
      ctx.spawnEnemyShot({
        origin: this.group.position,
        dir: _rotDir,
        speed,
        damage: this.damageFor(wave),
      });
    }
    void _fireDir;
  }

  damageFor(wave) {
    const byType = { fighter: 1, interceptor: 0.9, heavy: 1.5, elite: 1.15 };
    return Math.round(ENEMY_PROJECTILE.DAMAGE * (byType[this.type] ?? 1) * (1 + Math.max(0, wave - 1) * 0.04));
  }

  /** Return true when this hit killed the enemy. */
  hit(damage) {
    if (this.dying) return true;
    this.hp -= damage;
    if (this.hp <= 0) {
      this._die();
      return true;
    }
    return false;
  }

  /** Ease the hull (and hitbox) toward DIVE_SHRINK as a dive closes in on
   * the player; back to full size otherwise. The change is eased so nothing
   * visibly pops. */
  _updateDiveScale(dt) {
    let target = 1;
    if (this.state === 'DIVING') {
      // curveT 0 = formation release; closest pass beside the player is
      // around 0.75, so the shrink lands right before the close pass.
      const near = THREE.MathUtils.smoothstep(this._curveT, 0.3, 0.7);
      target = 1 + (DIVE_SHRINK - 1) * near;
    }
    this._diveScale = THREE.MathUtils.damp(this._diveScale, target, 8, dt);
    // keep the hitbox honest: it must never outgrow the shrunk visual
    this.radius = this._baseRadius * this._diveScale;
  }

  /** Visual-only punch applied each frame while a recent hit decays. */
  _hitPulse(dt) {
    if (this._hitFlash <= 0) {
      this._pulsed = false;
      this.group.scale.setScalar(this._diveScale);
      return;
    }
    this._hitFlash = Math.max(0, this._hitFlash - dt * 7); // ~0.14s punch
    this._pulsed = true;
    const s = this._diveScale * (1 + this._hitFlash * 0.28);
    this.group.scale.setScalar(s);
  }

  _die() {
    this.dying = true;
  }

  _engineGlow() {
    for (const e of this._engines) {
      const p = 0.9 + Math.sin(this._t * 25 + this._bobPhase) * 0.22;
      const b = e.userData.baseScale || [0.16, 0.16, 0.26];
      e.scale.set(b[0] * p, b[1] * p, b[2] * (0.85 + Math.sin(this._t * 33 + this._bobPhase) * 0.25)); // flame flicker
      e.material.emissiveIntensity = 1.5 + Math.sin(this._t * 30 + this._bobPhase) * 0.5;
    }
  }

  /** Idle reactor breathing + elite halo spin (named meshes, lazily cached). */
  _corePulse() {
    const k = Math.sin(this._t * 5 + this._bobPhase);
    if (this._core) this._core.scale.setScalar(0.3 + k * 0.05 + this._hitFlash * 0.1);
    if (this._hitFlash > 0) this._core.material.emissiveIntensity = 2.0 + this._hitFlash * 2.4;
    if (this.type === 'elite') {
      if (!this._halo) {
        let h = null;
        this.group.traverse((o) => { if (o.name === 'halo') h = o; });
        this._halo = h;
      }
      if (this._halo) this._halo.rotation.z += 0.03;
    }
  }
}
