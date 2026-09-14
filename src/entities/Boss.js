/**
 * Boss.js
 * ---------------------------------------------------------------
 * The wave-5 (and every-5-waves) dreadnought.
 *
 * - Large multi-part hull with a glowing core + gun pods.
 * - HP pool; destroyed when HP hits 0.
 * - Three escalating attack phases:
 *     Phase 1 (>66% HP) -> tight forward mine spread from the pods
 *     Phase 2 (33-66%)  -> aimed mine burst + shallow flank mines
 *     Phase 3 (<33%)    -> forward fan of mines centered on the player
 * - A short fly-in, then a slow sine patrol near the front.
 *
 * Boss projectiles are routed through the shared projectile pool,
 * flagged hostile so the CollisionSystem treats them like enemy
 * shots but with boss damage/scale.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';
import { BOSS, COLORS } from '../config.js';
import { buildEnemyShip } from './ShipBuilder.js';

const _dir = new THREE.Vector3();
const _mw = new THREE.Vector3();
const TELEGRAPH = 0.34; // seconds of charge before boss shots leave the pod
// Invuln grace floor (real seconds). The fly-in to the patrol ring takes
// ~2.5s; this guarantees the spawn window is at least 3s of invulnerability
// so late-arriving player volleys can't chip the tank before it engages.
const INVULN_FLOOR = 3.0;

export class Boss {
  constructor() {
    this.group = buildEnemyShip('boss', COLORS.BOSS);
    this.group.name = 'boss';
    this.radius = BOSS.RADIUS;

    this.maxHp = 1;
    this.hp = 1;
    this.alive = true;
    this.entering = true;
    this.phase = 1;

    this._t = 0;
    this._fireTimer = 1.2;

    this._cannons = [];
    this._core = null;
    this._vent = null;    // stern reactor (name 'vent') — breathed in update()
    this._pending = [];   // shots in the firing delay, leaving the barrel soon
    this._invuln = 0;          // remaining floor-time invulnerability (s)
    this._enterCueShown = false; // one-shot SHIELD DOWN popup flag
    this._collectParts();

    // "Make it big": upscale the whole dreadnought about its center. The
    // collision radius (config BOSS.RADIUS) is the tuned hitbox that tracks
    // the scaled visual, so both grow together.
    this.group.scale.set(1.2, 1.2, 1.2);
    this.group.visible = false;
  }

  _collectParts() {
    const cannons = [];
    let core = null;
    let vent = null;
    this.group.traverse((o) => {
      if (o.name === 'cannon') cannons.push(o);
      if (o.name === 'core') core = o;
      if (o.name === 'vent') vent = o;
    });
    this._cannons = cannons;
    this._core = core;
    this._vent = vent;
  }

  onRecycle() {
    this.alive = false;
    this.group.visible = false;
    this._clearPending();
  }

  configure(wave) {
    const cycle = Math.max(0, Math.floor(wave / BOSS.BOSS_EVERY) - 1);
    this.maxHp = BOSS.HP + BOSS.HP_SCALE * cycle;
    this.hp = this.maxHp;
    this.alive = true;
    this.entering = true;
    this.phase = 1;
    this._t = 0;
    this._fireTimer = 1.0;
    this._invuln = INVULN_FLOOR;
    this._enterCueShown = false;
    this._clearPending();
    this.group.visible = true;
    this.group.position.set(0, 4, -95);
    this.group.rotation.set(0, 0, 0);
  }

  get position() {
    return this.group.position;
  }

  get coreHpRatio() {
    return Math.max(0, this.hp / this.maxHp);
  }

  /**
   * @param game Game holding _context (player, spawnEnemyShot, wave, ...)
   */
  update(game, dt) {
    if (!this.alive) return;
    this._t += dt;

    // ---- phase selection from HP ratio --------------------------
    const ratio = this.coreHpRatio;
    const targetPhase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
    if (targetPhase !== this.phase) {
      this.phase = targetPhase;
      this._fireTimer = Math.max(this._fireTimer, 0.6);
      this._pulseCore();
    }

    // ---- movement -----------------------------------------------
    if (this.entering) {
      this.group.position.z += (BOSS.Z - this.group.position.z) * Math.min(1, dt * 1.4);
      this.group.position.x += Math.sin(this._t * 0.6) * dt * 2;
      if (this.group.position.z > BOSS.Z - 1.5) this.entering = false;
    } else {
      this.group.position.x = Math.sin(this._t * 0.4) * 7;
      this.group.position.y = 1.5 + Math.sin(this._t * 0.7) * 0.8;
      this.group.position.z = BOSS.Z + Math.sin(this._t * 0.5) * 1.2;
      this.group.rotation.z = -Math.cos(this._t * 0.4) * 0.12;
      this.group.rotation.x = Math.sin(this._t * 0.7) * 0.05;
    }

    // ---- invuln window: fly-in arrival OR minimum grace (whichever
    //      ends later). Hits are blocked in hit() while `invuln`. ----
    if (this._invuln > 0) this._invuln -= dt;
    const invuln = this.entering || this._invuln > 0;
    if (!invuln && !this._enterCueShown) {
      this._enterCueShown = true; // one-shot cue that the shield has closed
      game._floatingText.spawnAt(
        this.position.clone().add(new THREE.Vector3(0, 3.2, 0)),
        'SHIELD DOWN', '#7dff9a', false
      );
    }

    // ---- core glow scales with danger (+ charge boost) ----------
    const charging = this._pending.length > 0;
    if (this._core) {
      const danger = 1 - ratio;
      const chargeBoost = charging ? 1.6 + Math.sin(this._t * 30) * 0.5 : 0;
      // visible tell for the invuln window (shield shimmer)
      const invulnBoost = invuln ? 1.2 + Math.sin(this._t * 10) * 0.5 : 0;
      this._core.material.emissiveIntensity =
        1.4 + Math.sin(this._t * 6) * 0.3 + danger * 1.6 + chargeBoost + invulnBoost;
      // elongate the core so it reads as a glowing energy cell, not a
      // flat ball; keep the idle pulse + danger swell as a multiplier
      const cs = 0.85 + Math.sin(this._t * 8) * 0.06 + danger * 0.15;
      this._core.scale.set(0.95 * cs, 0.72 * cs, 1.25 * cs);
    }

    // ---- stern reactor breathes (faster + hotter as it weakens ----
    if (this._vent) {
      const danger = 1 - ratio;
      const breath = 1 + Math.sin(this._t * (3 + danger * 5)) * 0.12;
      this._vent.scale.set(1.0 * breath, 0.7 * breath, 0.4 * breath);
      this._vent.material.emissiveIntensity = 1.4 + danger * 1.2 + (charging ? Math.sin(this._t * 30) * 0.5 : 0);
    }

    // ---- firing -------------------------------------------------
    this._fireTimer -= dt;
    if (this._fireTimer <= 0) {
      this._attackTick(game);
    }

    // ---- pending shots: fire them once the charge finishes --------
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const s = this._pending[i];
      s.t -= dt;
      if (s.t <= 0) {
        game._context.spawnEnemyShot({
          origin: s.origin, dir: s.dir, speed: s.speed, damage: s.damage, scale: s.scale,
          kind: s.kind, life: s.life,
        });
        this._pending.splice(i, 1);
      }
    }

    // gun pods physically charge up while a volley is telegraphed
    const pk = charging ? 1.22 + Math.sin(this._t * 30) * 0.14 : 1;
    for (const c of this._cannons) {
      c.scale.set(0.45 * pk, 0.45 * pk, 0.8 * pk);
    }


  }

  _attackTick(game) {
    const ctx = game._context;
    const player = ctx.player.group.position;
    const wave = ctx.wave;

    const rate = this.phase === 1 ? BOSS.FIRE_INTERVAL.p1 : this.phase === 2 ? BOSS.FIRE_INTERVAL.p2 : BOSS.FIRE_INTERVAL.p3;
    this._fireTimer = rate * (0.85 + Math.random() * 0.4);

    const aim = (tx, tz, spread = 0) => {
      const dx = tx - this.position.x;
      const dz = tz - this.position.z;
      const len = Math.hypot(dx, dz) || 1;
      let dirx = dx / len;
      let dirz = dz / len;
      if (spread !== 0) {
        const c = Math.cos(spread);
        const s = Math.sin(spread);
        const nx = dirx * c - dirz * s;
        dirz = dirx * s + dirz * c;
        dirx = nx;
      }
      return _dir.set(dirx, 0, dirz);
    };

    // WEAPONS — the boss throws:
    //   • MINE : small orb that travels in a straight line.
    // Every pod fires on a short charge pulse, then the mine leaves
    // the barrel. `o` = { speed, damage, scale, kind, life, ci }.
    const charge = (d, o = {}) => {
      const ci = (o.ci !== undefined) ? o.ci : 0;
      const c = this._cannons[ci] || this._cannons[0];
      const origin = c ? this.group.localToWorld(_mw.copy(c.position)).clone() : this.position.clone();
      this._pending.push({
        origin, dir: d.clone(), speed: o.speed, damage: o.damage ?? 26,
        scale: o.scale ?? 1, kind: o.kind ?? 'orb',
        life: o.life,
        t: TELEGRAPH, max: TELEGRAPH,
      });
    };

    const mineSpeed = 11 + wave * 0.4; // slow enough to dodge
    const mine = { kind: 'orb', scale: 0.55, life: 6, damage: 22 };

    if (this.phase === 1) {
      // tight spread — five pods in a narrow fan centered on your position
      charge(aim(player.x, player.z, -0.16), { ci: 0, speed: mineSpeed, ...mine, damage: 20 });
      charge(aim(player.x, player.z, -0.08), { ci: 3, speed: mineSpeed + 2, ...mine, damage: 22 });
      charge(aim(player.x, player.z), { ci: 2, speed: mineSpeed + 3, ...mine, damage: 24 });
      charge(aim(player.x, player.z, 0.08), { ci: 4, speed: mineSpeed + 2, ...mine, damage: 22 });
      charge(aim(player.x, player.z, 0.16), { ci: 1, speed: mineSpeed, ...mine, damage: 20 });
    } else if (this.phase === 2) {
      // tight 3-mine burst + two wing mines on a shallow ±30° forward arc
      charge(aim(player.x, player.z, -0.12), { ci: 3, speed: mineSpeed + 3, ...mine, damage: 24 });
      charge(aim(player.x, player.z), { ci: 2, speed: mineSpeed + 4, ...mine, damage: 26 });
      charge(aim(player.x, player.z, 0.12), { ci: 4, speed: mineSpeed + 3, ...mine, damage: 24 });
      charge(_dir.set(-0.5, 0, 0.866).normalize(), { ci: 0, speed: mineSpeed, ...mine });
      charge(_dir.set(0.5, 0, 0.866).normalize(), { ci: 1, speed: mineSpeed, ...mine });
    } else {
      // phase 3: forward fan of mines — all eight travel toward the player
      // (±60° around the aim line) instead of a full 360° ring
      const n = 8;
      const half = Math.PI / 3; // 60°
      const base = aim(player.x, player.z).clone();
      for (let i = 0; i < n; i++) {
        const ang = -half + (i / (n - 1)) * half * 2;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        _dir.set(base.x * c - base.z * s, 0, base.x * s + base.z * c).normalize();
        charge(_dir, { ci: i % this._cannons.length, speed: mineSpeed + 2, ...mine, damage: 20 });
      }
    }
  }

  /** Reset pending shots; call on death / reconfigure. */
  _clearPending() {
    this._pending.length = 0;
    for (const c of this._cannons) c.scale.set(0.45, 0.45, 0.8);
  }

  _pulseCore() {
    if (this._core) this._core.scale.setScalar(1.7);
    if (this._vent) this._vent.material.emissiveIntensity = 4.0; // phase-change flare
  }

  /** Return true when this hit destroyed the boss. */
  hit(damage) {
    if (!this.alive) return true;
    // Invincible during the entry window (fly-in to the patrol ring OR the
    // 3s minimum grace, whichever ends last): the boss spends its entry
    // crossing the player's firing line, so early volleys — plus stray shots
    // still in flight — would otherwise chip a big chunk of its HP pool
    // before it even starts attacking. Returning false makes the
    // CollisionSystem treat it as a non-lethal hit: the shot is spent on the
    // shield with a spark and a tick, zero damage.
    if (this.entering || this._invuln > 0) return false;
    this.hp -= damage;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      return true;
    }
    return false;
  }
}
