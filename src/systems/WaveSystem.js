/**
 * WaveSystem.js
 * ---------------------------------------------------------------
 * Drives the wave cadence:
 *
 *   - Builds formation slots for the current wave (triangle, V, W,
 *     ring, twin columns...).
 *   - Spawns enemies in staggered pairs from the pool.
 *   - Applies per-wave HP / speed / fire-rate scaling.
 *   - Flags boss waves (every BOSS.BOSS_EVERY).
 *   - Reports completion when every spawned enemy is dead.
 *
 * The Game owns the enemy pool + list; WaveSystem just orchestrates.
 * ---------------------------------------------------------------
 */
import { BOUNDS, WAVE as WAVE_CFG } from '../config.js';
import * as THREE from 'three/webgpu';

export class WaveSystem {
  constructor(game) {
    this._game = game;
    this.wave = 0;
    this.active = false;
    this._spawnQueue = []; // {type, slot, delay}
    this._spawnTimer = 0;
    this._spawnedCount = 0;
    this._aliveCount = 0;
    this._isBossWave = false;
  }

  /** Start a new wave (call when entering PLAYING / WAVE_CLEAR). */
  startWave(wave) {
    this.wave = wave;
    this.active = true;
    this._isBossWave = wave % WAVE_CFG.BOSS_EVERY === 0;
    this._spawnQueue = this._buildSpawnPlan(wave);
    this._spawnedCount = 0;
    this._aliveCount = 0;
    this._spawnTimer = 0.6; // brief pause before first spawner
    this._bossDead = !this._isBossWave; // non-boss waves skip boss check
  }

  /** Call when the boss dies so isComplete waits for escorts too. */
  bossDied() {
    if (this._isBossWave) this._bossDead = true;
  }

  /** Wave scaling helpers (capped so very high waves stay sane). */
  hpScale(wave) {
    const s = 1 + Math.max(0, wave - 1) * WAVE_CFG.HP_SCALE;
    return Math.min(4, s);
  }
  speedScale(wave) {
    const s = 1 + Math.max(0, wave - 1) * WAVE_CFG.SPEED_SCALE;
    return Math.min(1.8, s);
  }

  /**
   * Build the spawner plan for a wave: a flat list of
   * {type, slot} in formation order. Boss waves still include a
   * small escort ring so the boss isn't alone.
   */
  _buildSpawnPlan(wave) {
    const plan = [];
    if (this._isBossWave) {
      // escort ring + a small elite line, so the boss isn't alone
      const bosses = [
        { type: 'interceptor', slot: { x: -9, y: 0, z: -38 } },
        { type: 'interceptor', slot: { x: 9, y: 0, z: -38 } },
        { type: 'interceptor', slot: { x: -12, y: 0, z: -44 } },
        { type: 'interceptor', slot: { x: 12, y: 0, z: -44 } },
        { type: 'elite', slot: { x: -5, y: 0, z: -46 } },
        { type: 'elite', slot: { x: 5, y: 0, z: -46 } },
      ];
      for (const s of bosses) plan.push(s);
      return plan;
    }

    const layout = this._layoutFor(wave);
    for (const slot of layout) {
      plan.push({ type: slot.type, slot: slot.pos });
    }
    return plan;
  }

  _layoutFor(wave) {
    const w = wave;
    // Galaga-style: clear horizontal rows, tight spacing, one type per row
    if (w === 1) return this._rows(3, 4, ['fighter']);
    if (w === 2) return this._rows(3, 5, ['fighter', 'interceptor']);
    if (w === 3) return this._rows(3, 6, ['fighter', 'heavy', 'interceptor']);
    if (w === 4) return this._rows(4, 5, ['interceptor', 'heavy']);
    if (w === 5) return this._rows(4, 6, ['fighter', 'heavy', 'interceptor', 'elite']);
    if (w === 6) return this._rows(4, 7, ['interceptor', 'elite']);
    if (w === 7) return this._rows(5, 6, ['fighter', 'heavy', 'elite']);
    if (w === 8) return this._rows(5, 7, ['interceptor', 'heavy', 'elite']);
    // beyond 8: cap at 6 rows x 8 cols with mixed rows
    const rows = Math.min(6, 5 + Math.floor((w - 8) / 2));
    const cols = Math.min(8, 7 + Math.floor((w - 8) / 3));
    return this._rows(rows, cols, ['fighter', 'interceptor', 'heavy', 'elite']);
  }

  // ---- shape generators (return {type, pos}[]) ---------------------

  /**
   * Galaga-style horizontal rows. Each row is a tight straight line of
   * `cols` enemies at the same z. Rows are stacked back-to-front so the
   * player sees a clean block of enemies lined up in rows, one type per
   * row (row index cycles the type list).
   */
  _rows(rows, cols, typeCycle) {
    const out = [];
    // spacing between enemies in a row (world units) — widened so the
    // bugs read as a clean, breathable grid instead of a dense smear
    const gap = 3.8;
    // rows span z from near (biggest) to far (smallest); the wider z run
    // keeps stacked rows visually separated down the depth axis
    const zNear = BOUNDS.FORMATION_Z_MIN + 3;   // ~-31 (near)
    const zFar = BOUNDS.FORMATION_Z_MAX - 3;    // ~-49 (far)
    for (let r = 0; r < rows; r++) {
      const tRatio = rows === 1 ? 0 : r / (rows - 1);
      const z = zNear + (zFar - zNear) * tRatio;
      // row width: same world-space width across rows so the
      // row looks uniform; perspective makes the far row render
      // narrower and smaller, just like in the reference art.
      const span = (cols - 1) * gap;
      const rowType = typeCycle[r % typeCycle.length];
      for (let c = 0; c < cols; c++) {
        const x = -span / 2 + c * gap;
        out.push({ type: rowType, pos: { x, y: 0, z } });
      }
    }
    return out;
  }

  /** Number of enemies that should still be alive (boss escorts etc). */
  get expectedAlive() {
    return this._spawnQueue.length;
  }

  get isComplete() {
    if (!this.active) return true;
    if (this._isBossWave) {
      // Boss wave: both the boss AND every escort must be dead.
      return this._bossDead && this._spawnQueue.length === 0 && this._aliveCount === 0;
    }
    // A wave is only complete when the spawner plan is EXHAUSTED and
    // every enemy that was spawned is dead. Previously only the
    // alive-count was checked, so a fast player could "clear" a wave
    // by killing just the first couple of spawns while the rest sat
    // un-spawned in the queue.
    return this._spawnQueue.length === 0 && this._aliveCount === 0;
  }

  /** Register a newly spawned enemy (increments alive count). */
  enemySpawned() {
    this._spawnedCount += 1;
    this._aliveCount += 1;
  }

  /** Register a dead enemy. */
  enemyDied() {
    this._aliveCount -= 1;
  }

  get remaining() {
    return this._aliveCount;
  }

  /** Per-frame spawner tick. */
  update(dt, game) {
    if (!this.active) return;
    if (this._spawnQueue.length === 0) return;

    // Boss waves DO drip-spawn their escorts (the boss itself is
    // configured separately by Game). Previously this method returned
    // early on boss waves so the plan's escorts were never spawned
    // (spec: boss waves feature "Boss + escorts").

    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0 && this._spawnQueue.length > 0) {
      // pop two at a time (left/right) for the classic mirrored entry
      const a = this._spawnQueue.shift();
      const b = this._spawnQueue.shift();
      const slots = [a, b].filter((s) => s);
      this._spawnPair(game, slots);
      this._spawnTimer = 0.5; // spawn interval
    }
  }

  /** Full reset — call when the player restarts the game. */
  reset() {
    this.wave = 0;
    this.active = false;
    this._spawnQueue.length = 0;
    this._spawnTimer = 0;
    this._spawnedCount = 0;
    this._aliveCount = 0;
    this._isBossWave = false;
    this._bossDead = true;
  }

  _spawnPair(game, slots) {
    for (const s of slots) {
      // use a real THREE.Vector3 so Enemy.configure().clone() works
      const slotV = new THREE.Vector3(s.slot.x, s.slot.y, s.slot.z);
      const spawnFrom = new THREE.Vector3(slotV.x * 1.8, 10, -90);
      const enemy = this._game.acquireEnemy(s.type);
      if (!enemy) continue;
      enemy.configure({
        slot: slotV,
        index: this._spawnedCount,
        spawnFrom,
        hpScale: this.hpScale(this.wave),
      });
      this._game.addEnemy(enemy);
      this.enemySpawned();
    }
  }
}
