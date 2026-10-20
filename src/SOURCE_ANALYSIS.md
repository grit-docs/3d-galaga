# NEBULA STRIKE — Source Analysis

## Structure
- `core`: Game (loop/FSM), GameState, InputManager, Renderer (WebGPU), Pool
- `entities`: Player, Enemy(4), Boss, Projectile, PowerUp, ShipBuilder
- `systems`: WaveSystem, CollisionSystem, EnemyAttackSystem, ProjectileSystem,
  ParticleSystem, StarFieldSystem, AudioSystem
- `effects`: CameraEffects, ExplosionEffect
- `ui`: HUD, FloatingText
- Entry: `main.js` gates on WebGPU support.

## Issues
> All four items below were found in an earlier pass and are **now RESOLVED** in the
> current code (re-verified 2026-10-20). Kept here as a changelog, not an open bug list.

1. ~~`Player.update()`: negative clamp `velocityX < -max → velocityX = max` (wrong sign).~~
   **RESOLVED** — `entities/Player.js` now clamps correctly:
   `velocityX > max → max` / `velocityX < -max → -max`.
2. ~~Asymmetric collision planes (player shots x/z vs enemy shots full 3D).~~
   **RESOLVED** — `systems/CollisionSystem.js` judges player-shot↔enemy,
   enemy-shot↔player, and power-up↔player all on the **x/z plane**. Only the
   diving-enemy ram check uses full 3D (intentional: dive curves vary in y).
3. ~~StarField NDC projection applies projectionMatrix without w-divide.~~
   **RESOLVED** — `systems/StarFieldSystem.js` divides by `w`
   (`v.x/=v.w; v.y/=v.w`) guarded by `|w| > 1e-6` to avoid NaN colours.
4. ~~Boss invuln window + `entering` double-counted in `hit()`.~~
   **RESOLVED** — `entities/Boss.js hit()` uses a single `entering || _invuln > 0`
   gate that returns immediately (no double damage / no double timer decay). The
   overlap is intentional ("fly-in arrival OR 3s grace, whichever ends later").
