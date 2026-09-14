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
    if (w === 1) return this._triangle(3, ['fighter']);
    if (w === 2) return this._triangle(3, ['fighter', 'interceptor']);
    if (w === 3) return this._vShape(['fighter', 'heavy']);
    if (w === 4) return this._twinColumns(['interceptor', 'elite']);
    if (w === 5) return this._triangle(4, ['fighter', 'heavy', 'elite']);
    if (w === 6) return this._ring(8, ['interceptor', 'elite']);
    // beyond 6: mix, escalating sizes
    return this._grid(w);
  }

  // ---- shape generators (return {type, pos}[]) ---------------------

  _triangle(rows, typeCycle) {
    const out = [];
    let t = 0;
    for (let r = 0; r < rows; r++) {
      const count = 2 * (rows - r) + 1; // 7,5,3 for 3 rows
      const z = BOUNDS.FORMATION_Z_MAX - r * 3;
      const span = BOUNDS.FORMATION_X_SPREAD - r * 1.5;
      for (let c = 0; c < count; c++) {
        const x = count === 1 ? 0 : -span + (c / (count - 1)) * span * 2;
        out.push({ type: typeCycle[t++ % typeCycle.length], pos: { x, y: 0, z } });
      }
    }
    return out;
  }

  _vShape(typeCycle) {
    const out = [];
    const arm = 5;
    const spread = 12; // tightened from 14 so edge units stay in player reach
    let t = 0;
    for (let i = 0; i < arm; i++) {
      const x = -spread + i * (spread / (arm - 1));
      const z = BOUNDS.FORMATION_Z_MAX - i * 1.2;
      out.push({ type: typeCycle[t++ % typeCycle.length], pos: { x, y: 0, z } });
    }
    out.push({ type: typeCycle[t++ % typeCycle.length], pos: { x: 0, y: 0, z: BOUNDS.FORMATION_Z_MIN } });
    for (let i = 1; i < arm; i++) {
      const x = i * (spread / (arm - 1));
      const z = BOUNDS.FORMATION_Z_MAX - i * 1.2;
      out.push({ type: typeCycle[t++ % typeCycle.length], pos: { x, y: 0, z } });
    }
    return out;
  }

  _twinColumns(typeCycle) {
    const out = [];
    const h = 6;
    let t = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < h; i++) {
        const z = BOUNDS.FORMATION_Z_MIN - i * 2;
        out.push({ type: typeCycle[t++ % typeCycle.length], pos: { x: side * 9, y: 0, z } });
      }
    }
    return out;
  }

  _ring(count, typeCycle) {
    const out = [];
    const rx = 12; // tightened from 13
    const rz = 7;
    let t = 0;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const x = Math.cos(a) * rx;
      const z = BOUNDS.FORMATION_Z_MIN + Math.sin(a) * rz;
      out.push({ type: typeCycle[t++ % typeCycle.length], pos: { x, y: 0, z } });
    }
    return out;
  }

  _grid(wave) {
    const out = [];
    const rows = Math.min(5, 2 + Math.floor(wave / 2));
    const cols = Math.min(7, 4 + Math.floor(wave / 3));
    const types = ['fighter', 'interceptor', 'heavy', 'elite'];
    let t = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -14 + c * (28 / (cols - 1));
        const z = BOUNDS.FORMATION_Z_MAX - r * 2.5;
        // center of the grid gets the tougher types
        const centerBias = 1 - Math.abs(c - (cols - 1) / 2) / (cols / 2);
        const pick = types[Math.min(types.length - 1, Math.floor((t + centerBias * 3) * 0.7) % types.length)];
        out.push({ type: pick, pos: { x, y: 0, z } });
        t++;
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
    if (this._isBossWave) return false; // boss handled separately
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
