/**
 * CollisionSystem.js
 * ---------------------------------------------------------------
 * Central place for all gameplay collisions. Uses simple distance
 * checks (bounding-sphere semantics) — plenty fast and matches the
 * spec's "BoundingSphere / BoundingBox" requirement.
 *
 * Detected interactions:
 *   player-shot  ↔ enemy
 *   player-shot  ↔ boss
 *   enemy-shot   ↔ player
 *   power-up     ↔ player
 *   enemy        ↔ player
 * ---------------------------------------------------------------
 */

const RAM_DAMAGE = 40;

export class CollisionSystem {
  constructor(game) {
    this._game = game;
    this._game.onScore = null; // Game wires this up
    this._game.onEnemyKilled = null;
    this._game.onPlayerHit = null;
    this._game.onPowerUpTaken = null;
    this._game.onBossKilled = null;
  }

  update() {
    const g = this._game;
    const ctx = g._context;
    const projectiles = ctx.projectiles.activeProjectiles;
    const powerups = ctx.projectiles.activePowerups;
    // Iterate the live list directly: this pass only READS enemy state
    // (kills go through the Game callback, not this loop), so the old
    // per-frame `[...enemyList]` snapshot was pure GC churn.
    const enemies = g._context.enemyList;
    const boss = ctx.boss;
    const player = ctx.player;

    if (!player.alive) return;

    // player shot -> enemy / boss
    for (const p of projectiles) {
      if (!p.active || p.hostile) continue;
      const pp = p.group.position;
      let consumed = false;

      // enemy collision
      // Horizontal (x/z) test: player lasers fly at a fixed y (~0.8) but
      // enemies swoop in on curves up to y~14, so a strict 3D distance
      // made flying-in enemies effectively invincible. Judging the hit
      // on the x/z plane makes crossing fire reliably connect.
      for (const e of enemies) {
        if (!e.active || e.dying) continue;
        const ep = e.group.position;
        const dx = pp.x - ep.x;
        const dz = pp.z - ep.z;
        const r = p.radius + e.radius;
        if (dx * dx + dz * dz < r * r) {
          const killed = e.hit(p.damage);
          if (p.pierce > 0) {
            p.pierce -= 1;
          } else {
            p.kill();
            consumed = true;
          }
          if (killed) {
            this._game.onEnemyKilled?.(e, pp);
            if (p.active) continue;
          } else {
            // multi-HP enemy (heavy/elite): make the hit readable so it
            // doesn't feel like the shot 'missed'. Sparks + scale punch
            // + a soft tick on every non-lethal impact.
            this._hitFlash(e, pp);
            if (!p.active) break;
          }
          break;
        }
      }

      if (p.active && boss && boss.alive) {
        // same x/z-plane rule as regular enemies
        const dx = pp.x - boss.position.x;
        const dz = pp.z - boss.position.z;
        const r = p.radius + boss.radius;
        if (dx * dx + dz * dz < r * r) {
          const killed = boss.hit(p.damage);
          if (p.pierce > 0) p.pierce -= 1; else p.kill();
          if (killed) {
            this._game.onBossKilled?.(boss, pp);
          } else {
            this._hitFlash(boss, pp);
          }
        }
      }

      if (consumed) continue;
    }

    // enemy shot -> player
    for (const p of projectiles) {
      if (!p.active || !p.hostile) continue;
      const pp = p.group.position;
      const plp = player.group.position;
      const dx = pp.x - plp.x;
      const dy = pp.y - plp.y;
      const dz = pp.z - plp.z;
      const r = p.radius + player.radius;
      if (dx * dx + dy * dy + dz * dz < r * r) {
        this._game.onPlayerHit?.(p.damage);
        p.kill();
      }
    }

    // enemy craft -> player (ram)
    if (player.alive) {
      for (const e of enemies) {
        if (!e.active || e.dying || !e.isDiving()) continue;
        const ep = e.group.position;
        const plp = player.group.position;
        const dx = ep.x - plp.x;
        const dz = ep.z - plp.z;
        const dy = ep.y - plp.y;
        const r = e.radius + player.radius;
        if (dx * dx + dy * dy + dz * dz < r * r) {
          const killed = e.hit(999); // ram = instant kill
          this._game.onPlayerHit?.(RAM_DAMAGE);
          if (killed) this._game.onEnemyKilled?.(e, ep);
        }
      }
    }

    // powerup -> player
    for (const pu of powerups) {
      if (!pu.active) continue;
      const pp = pu.group.position;
      const plp = player.group.position;
      const dx = pp.x - plp.x;
      const dz = pp.z - plp.z;
      const r = 1.6 + player.radius;
      if (dx * dx + dz * dz < r * r) {
        this._game.onPowerUpTaken?.(pu);
        pu.kill();
      }
    }
  }

  /** Small impact spark when a shot connects but does not kill. */
  _hitFlash(entity, at) {
    const ctx = this._game._context;
    entity._hitFlash = 1; // ship scale-punch, read in the entity's update
    for (let i = 0; i < 3; i++) {
      ctx.particles?.spawn(at, {
        color: 0xcfeeff,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        vz: -5 - Math.random() * 3,
        life: 0.22,
        drag: 3,
        gravity: 0,
      });
    }
    this._game.audio?.play?.('hitTick');
  }
}
