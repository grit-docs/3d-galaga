/**
 * config.js
 * ---------------------------------------------------------------
 * Single source of truth for gameplay tuning values.
 * Keeping every magic number here keeps entity/system code clean
 * and makes balancing easy to iterate on.
 * ---------------------------------------------------------------
 */

export const GAME = {
  TITLE: 'NEBULA STRIKE',
  SUBTITLE: '3D SPACE ARCADE',
  TARGET_FPS: 60,
  MAX_DELTA: 0.05, // clamp large frame deltas (tab switches etc.)
  HIGH_SCORE_KEY: 'nebula-strike.highscore',
};

/** Playable battlefield extents (world units). */
export const BOUNDS = {
  PLAYER_MIN_X: -18,
  PLAYER_MAX_X: 18,
  PLAYER_Y: 1.1,
  PLAYER_Z: 17,

  FORMATION_Z_MIN: -34,
  FORMATION_Z_MAX: -46,
  FORMATION_X_SPREAD: 16,

  ENEMY_SPAWN_Z: -78,
  PROJECTILE_KILL_Z: 34, // below the player + margin
  PROJECTILE_KILL_TOP_Z: -95,
};

export const PLAYER = {
  ACCEL_X: 60, // halved from 120 — accel/drag restored for a controlled,
  // less floaty feel; DRAG 9 pairs with it (steady-state ≈ ACCEL/DRAG)
  MAX_SPEED_X: 34,
  DRAG: 9,
  BANK_TILT: 0.55,
  BANK_Z: 0.18,
  BANK_LERP: 8,

  MAX_LIVES: 3,
  MAX_SHIELD: 100,
  INVULN_TIME: 2.0,
  RESPAWN_INVULN_TIME: 2.6,

  DASH_SPEED: 55,
  DASH_TIME: 0.16,
  DASH_COOLDOWN: 0.9,
  DASH_INVULN: 0.22,

  HIT_DAMAGE: 34,
  CAPTURE_DAMAGE: 12,
};

export const WEAPON = {
  // Shared fire cadence (shots per second) — applies to BOTH hold
  // auto-fire and manual taps: a shot only fires once the previous one's
  // cooldown (1/FIRE_RATE) has elapsed, so rapid tapping can't outrun the 
  // cadence. Base: 2 shots/sec (1 per 0.5s). The RAPID buff adds
  // RAPID_BONUS for its duration (2.0 -> 2.5 sps, i.e. 0.5s -> 0.4s).
  FIRE_RATE: 2.0, // shots per second, base (permanent)
  // RAPID now stacks PERMANENTLY: each Rapid pickup adds one level (capped
  // at RAPID_MAX_LEVEL), and each level adds RAPID_RATE_PER_LEVEL to the rate.
  RAPID_RATE_PER_LEVEL: 0.4,
  RAPID_MAX_LEVEL: 3,
  // Base single-shot laser
  PROJECTILE_SPEED: 52,
  DAMAGE: 10,
  // per-level upgrades (index = weaponLevel-1)
  COUNTS: [1, 2, 3, 3, 3],
  // All shots fire dead straight ahead — the diagonal fan was cut on
  // request (every level = N parallel forward lasers from the same
  // muzzle, so upgrades still scale damage, just with no side spread).
  SPREAD: [0, 0, 0, 0, 0],
  SPEED_BONUS: [0, 0, 4, 8, 12],
  DMG_BONUS: [0, 5, 5, 10, 12],
  MAX_LEVEL: 5,
};

export const SCORE_VALUES = {
  fighter: 100,
  interceptor: 150,
  heavy: 300,
  elite: 500,
  boss: 5000,
  DIVE_BONUS: 120, // bonus per kill while enemy is on a dive
};

export const COMBO = {
  WINDOW: 2.4, // seconds to keep the chain alive
  MAX_MULTIPLIER: 10,
  STEP: 9, // every N kills the multiplier climbs
};

export const ENEMY = {
  BASE_HP: {
    fighter: 1,
    interceptor: 1,
    heavy: 4,
    elite: 3,
  },
  SPEED: {
    fighter: 17,
    interceptor: 23,
    heavy: 11,
    elite: 16,
  },
  RADIUS: {
    fighter: 1.15,
    interceptor: 1.05,
    heavy: 1.6,
    elite: 1.25,
  },
  FORMATION_WOBBLE: 0.16, // seconds per bob cycle
  FORMATION_BOB: 0.35, // world units of vertical bob
};

export const ENEMY_PROJECTILE = {
  BASE_SPEED: 16,
  DAMAGE: 22,
  WAVESPEED_BONUS: 1.6, // + per wave above 1
};

export const DIVE = {
  // seconds between picking a diver at wave 1
  FIRST_DELAY: 1.4,
  INTERVAL_BY_WAVE: [0, 2.6, 2.1, 1.7, 1.4, 1.15],
  MAX_CONCURRENT: { 1: 1, 2: 2, 3: 2, 4: 3, 5: 3 },
  TRAVEL_TIME: 2.3,
  ENTER_TIME: 1.15,
  RETURN_TIME: 1.9,
};

export const WAVE = {
  HP_SCALE: 0.3, // +30% enemy HP per wave above 1 (capped)
  SPEED_SCALE: 0.06,
  FIRE_CHANCE: 0.32, // base chance per "fire tick"
  FIRE_TICK: 0.5,
  BOSS_EVERY: 5,
  WAVE_CLEAR_TIME: 3.2,
  MAX_WAVE: 99,
};

export const BOSS = {
  HP: 820,
  HP_SCALE: 450, // extra HP per boss cycle
  RADIUS: 12.675, // x/z collision radius — tuned to the 2.34x-scaled visual hull (8.45 x 1.5)
  Z: -50,
  INTRO_TIME: 2.6,
  // Boss.js reads BOSS.BOSS_EVERY — keep a local copy so the boss
  // math doesn't depend on WAVE (cleaner single-import path).
  BOSS_EVERY: 5,
  FIRE_INTERVAL: { p1: 1.05, p2: 0.8, p3: 0.6 },
};

export const POWERUP = {
  FALL_SPEED: 7.5,
  CHANCE: 0.22,
  SHIELD_AMOUNT: 45,
  // PIERCE and DRONE removed on request — remaining pickups only.
  TYPES: ['WEAPON', 'Rapid', 'SHIELD'],
  RARITY: [0.35, 0.3, 0.35],
};

export const CAMERA = {
  FOV: 58,
  NEAR: 0.1,
  FAR: 400,
  POS: { x: 0, y: 13.5, z: 30 },
  // LOOK.y lowered 0 -> -4: the camera looks DOWN from y=13.5, so aiming the
  // look target BELOW the ships tilts the frustum down and pushes the ships
  // UP-frame: the player lands ~25% above the bottom edge (clear of the HUD
  // bar on FHD/QHD) while enemies/boss (further away) stay near mid screen.
  // (The earlier 0->1.2 bump aimed HIGHER, which tilted the camera up and
  // shoved the player toward the bottom edge — wrong direction.)
  LOOK: { x: 0, y: -4, z: -14 },
  // Mobile (coarse pointer) portrait framing: the HUD stacks at the top
  // there, so the ship — framed for the desktop bottom bar — sits too
  // low. cameraBase() aims the camera this much lower (world units) per
  // unit of (1.35 - aspect), lifting the ship on-screen on narrow views.
  MOBILE_LOOK_LIFT: 1.6,
  PLAYER_FOLLOW: 0.06, // lateral follow ratio
  SHAKE_DECAY: 5.5,
  BOSS_ZOOM: { x: 0, y: 15.5, z: 33.5 },
};

export const COLORS = {
  BG: 0x03030c,
  NEBULA_1: 0x071a3a,
  NEBULA_2: 0x1b0a3c,
  PLAYER_HULL: 0x16324f,
  PLAYER_TRIM: 0x2de2ff,
  PLAYER_ENGINE: 0x28c8ff,
  PLAYER_LASER: 0x5cf2ff,
  ENEMY_BULLET: 0xff5d8f,
  SCORE_FLOAT_TEXT: '#bfe9ff',

  ENEMIES: {
    // Fluorescent insect palette (reference art): each bug type is a
    // distinct neon hue — body + wings both glow in that color, with a
    // bright contrasting "eye" core. fighter=green, interceptor=purple,
    // heavy=orange, elite=teal.
    fighter: {
      hull: 0x2fd63a,
      wing: 0x5dff4e,
      core: 0xffe14d,
      glow: 0x66ff55,
    },
    interceptor: {
      hull: 0x9a45ff,
      wing: 0xb866ff,
      core: 0xffd23d,
      glow: 0xc07bff,
    },
    heavy: {
      hull: 0xff9a1f,
      wing: 0xffb53d,
      core: 0xff4444,
      glow: 0xffb53d,
    },
    elite: {
      hull: 0x18d8c8,
      wing: 0x2ff0dc,
      core: 0xff5df0,
      glow: 0x4dffe0,
    },
  },
  BOSS: {
    // brightened (was 0x231038/0x3a1a5e — read as near-black vs the nebula);
    // ShipBuilder's boss branch also adds a self-illuminator override.
    hull: 0x43266e,
    wing: 0x5e3596,
    cannon: 0x8a4fd0,
    core: 0xff2bd6,
    glow: 0xff2bd6,
  },
};

export const AUDIO = {
  MASTER_VOLUME: 0.5,
  ENABLED: true,
};

/** Pool startup sizes — avoids (re)allocations during gameplay. */
export const POOL_DEFAULTS = {
  PROJECTILES: 96,
  POWERUPS: 10,
};
