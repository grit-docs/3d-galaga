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
1. `Player.update()`: negative clamp `velocityX < -max → velocityX = max` (wrong sign).
2. Asymmetric collision planes (player shots x/z vs enemy shots full 3D).
3. StarField NDC projection applies projectionMatrix without w-divide.
4. Boss invuln window + `entering` double-counted in `hit()`.
