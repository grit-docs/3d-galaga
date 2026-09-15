/**
 * Game.js
 * ---------------------------------------------------------------
 * The glue class.
 *
 * Owns:
 *   - the requestAnimationFrame game loop (update + render),
 *   - the GameState machine (BOOT / MAIN_MENU / PLAYING / PAUSED /
 *     WAVE_CLEAR / BOSS_INTRO / GAME_OVER),
 *   - every system and entity (see this._context),
 *   - score / combo / high-score / lives / wave tracking,
 *   - all "something just happened" callbacks wired from
 *     CollisionSystem.
 *
 * The loop is strictly:
 *
 *   dt = clamp(clock)
 *   game.update(dt)
 *   renderer.render()
 *
 * No system is given direct access to rAF; everything funnels
 * through Game.update so state transitions stay in one place.
 * ---------------------------------------------------------------
 */
// three/webgpu is the build that EXPOSES THREE.WebGPURenderer.
// The bare 'three' package ships WebGL-only core in 0.182+.
import * as THREE from 'three/webgpu';
import { BOUNDS, COLORS, GAME, PLAYER, POWERUP, WAVE as WAVE_CFG, WEAPON } from '../config.js';
import { Renderer, isWebGPUSupported } from './Renderer.js';
import { InputManager } from './InputManager.js';
import { GameState, States } from './GameState.js';
import { Pool } from './Pool.js';

import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { Boss } from '../entities/Boss.js';
import { ENEMY as ENEMY_CFG } from '../config.js';

import { ProjectileSystem } from '../systems/ProjectileSystem.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { WaveSystem } from '../systems/WaveSystem.js';
import { EnemyAttackSystem } from '../systems/EnemyAttackSystem.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { StarFieldSystem } from '../systems/StarFieldSystem.js';
import { AudioSystem } from '../systems/AudioSystem.js';

import { ExplosionEffect } from '../effects/ExplosionEffect.js';
import { CameraEffects } from '../effects/CameraEffects.js';
import { FloatingText } from '../ui/FloatingText.js';
import { HUD } from '../ui/HUD.js';

export class Game {
  constructor(canvasHost, hudRoot) {
    this._canvasHost = canvasHost;
    this._hudRoot = hudRoot;

    this.state = new GameState();
    this.input = new InputManager();
    this.hud = new HUD(hudRoot);
    this.audio = new AudioSystem();
    this.renderer = new Renderer(canvasHost);

    this.score = 0;
    this.highScore = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this._waveClearTimer = 0;
    this._bossIntroTimer = 0;
    // fire cooldown (seconds remaining) — shared by hold auto-fire and
    // manual taps. After any shot it resets to 1/baseRate (baseRate is
    // FIRE_RATE + RAPID_BONUS while the speed buff is up), capping both
    // holding and rapid tapping at the same cadence.
    this._fireCooldown = 0;

    // context: shared refs handed to entities/systems so they don't
    // need to know about the Game object itself.
    this._context = {
      game: null,
      wave: 1,
      player: null,
      boss: null,
      enemyList: [],   // canonical list of live Enemy instances
      projectiles: null,
      particles: null,
      audio: this.audio,
      // spawn helpers are patched in after projectiles exists:
      spawnEnemyShot: null,
      spawnPlayerShot: null,
      spawnPowerUp: null,
    };

    this._last = performance.now();
    this._raf = null;
    this._webgpuOk = false;
    this._isNewHigh = false;
  }

  // ----------------------------------------------------------------
  // setup
  // ----------------------------------------------------------------
  async bootstrap() {
    this._webgpuOk = isWebGPUSupported();
    window.addEventListener('resize', () => this.renderer.resize());
    if (this._webgpuOk) {
      try {
        await this.renderer.init();
      } catch (err) {
        console.error('WebGPU init failed, falling back.', err);
        this._webgpuOk = false;
      }
    }
    if (!this._webgpuOk) {
      this._failWebGPU();
      return;
    }

    const scene = this.renderer.scene;
    const camera = this.renderer.camera;

    this.input.attach();
    this._buildContext(scene, camera);
    this._buildStateTransitions();
    this._bindHud();
    this._loadHighScore();

    // enter the main menu (game world is visible behind it)
    this._enterMainMenu();

    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  _buildContext(scene, camera) {
    const ctx = this._context;
    ctx.game = this;
    ctx.scene = scene;
    ctx.camera = camera;

    ctx.player = new Player();
    scene.add(ctx.player.group);
    ctx.player.reset();

    ctx.boss = new Boss();
    scene.add(ctx.boss.group);

    ctx.projectiles = new ProjectileSystem(scene);

    // Wire the "spawn" helpers that Enemy / Boss / Game call via
    // ctx.spawn*. They forward to ProjectileSystem internally, so
    // callers don't need to know the shape of ProjectileSystem.opts.
    ctx.spawnPlayerShot = (opts) => ctx.projectiles.spawnPlayerShot(opts);
    // B4: single canonical shape { origin, dir, speed, damage, scale }
    // across every caller (Enemy / Boss / any future system).
    ctx.spawnEnemyShot = (opts) => ctx.projectiles.spawnEnemyShot(opts);
    ctx.spawnPowerUp = (opts) => ctx.projectiles.spawnPowerUp(opts);

    ctx.particles = new ParticleSystem(scene, 1400);
    ctx.starfield = new StarFieldSystem(scene, 2000);

    this._explosion = new ExplosionEffect(scene, ctx.particles);
    this._cameraFx = new CameraEffects(this.renderer, camera);
    this._floatingText = new FloatingText(scene, camera, this._hudRoot);

    ctx.enemyPool = new Pool(() => this._makeEnemy(), 0);
    ctx.enemyList = [];

    this.waveSystem = new WaveSystem(this);
    this.attackSystem = new EnemyAttackSystem(this);
    this._collision = new CollisionSystem(this);
    this._wireCollisionCallbacks();
  }

  _makeEnemy() {
    // pool doesn't have a fixed type; we instantiate a new one via
    // the factory. To avoid waste we lazily add them to the scene.
    const type = 'fighter'; // placeholder; configure will replace
    return new Enemy(type);
  }

  /** Weighted power-up type pick. Lives above the class so no call
   *  site can reference it before the module finishes evaluating. */
  _pickPowerupWeighted() {
    const r = Math.random();
    const rarity = POWERUP.RARITY;
    let acc = 0;
    for (let i = 0; i < rarity.length; i++) {
      acc += rarity[i];
      if (r <= acc) return i;
    }
    return 0;
  }

  _wireCollisionCallbacks() {
    this._collision._game.onEnemyKilled = (enemy, at) =>
      this._onEnemyKilled(enemy, at);
    this._collision._game.onPlayerHit = (dmg) =>
      this._onPlayerHit(dmg);
    this._collision._game.onPowerUpTaken = (pu) =>
      this._onPowerUpTaken(pu);
    this._collision._game.onBossKilled = (boss, at) =>
      this._onBossKilled(boss, at);
  }

  // ----------------------------------------------------------------
  // enemy pool
  // ----------------------------------------------------------------
  acquireEnemy(type) {
    let e = this._context.enemyPool.acquire();
    // the pool returns a pre-built 'fighter' instance; if the type
    // differs, rebuild the ship group (cheap: only a few geos).
    if (e.type !== type) {
      // rebuild: replace the ship group with a fresh one for the
      // requested type
      const g = e.group;
      e.group = new Enemy(type).group;
      e.type = type;
      // userData.radius is never set by ShipBuilder, so read the
      // canonical per-type radius from config (the old code kept the
      // previous type's radius, so heavies/interceptors collided
      // with fighter-sized hitboxes).
      e._baseRadius = ENEMY_CFG.RADIUS[type] ?? e._baseRadius;
      e.radius = e._baseRadius;
      e._collectEngines();
      void g; // old group is orphaned (GC will reclaim)
    }
    return e;
  }

  /**
   * B2: attach the enemy's 3D group to the scene when it becomes
   * active. (Previously enemies were spawned but their group was
   * never added to the scene, so they were invisible and the
   * CollisionSystem could still see them via the list — producing
   * ghost collisions.)
   */
  addEnemy(enemy) {
    this._context.enemyList.push(enemy);
    this.renderer.scene.add(enemy.group);
  }

  /** B2: detach (scene + list + pool). Single point of removal. */
  _releaseEnemy(e) {
    const list = this._context.enemyList;
    const i = list.indexOf(e);
    if (i !== -1) list.splice(i, 1);
    this.renderer.scene.remove(e.group);
    e.onRecycle();
    this._context.enemyPool.release(e);
  }

  // ----------------------------------------------------------------
  // state transitions
  // ----------------------------------------------------------------
  _buildStateTransitions() {
    const s = this.state;
    s.on(States.MAIN_MENU, () => {
      this.hud.showMenu(this._webgpuOk);
      this.hud.hideBoss();
      this._startMenuAmbient();
    });
    // PLAYING listener is intentionally lightweight. The actual
    // "start the world" path is:
    //   START GAME button -> _beginPlay() -> _startWave(1)
    //   where _startWave does state.transition(PLAYING).
    // If we also call _beginPlay() from this listener we loop:
    //   listener -> _beginPlay -> _startWave -> transition(PLAYING)
    //   -> listener -> ...
    s.on(States.PLAYING, () => {
      this.hud.hideAll();
    });
    s.on(States.PAUSED, () => this.hud.showPause());
    s.on(States.GAME_OVER, (_prev, next) => {
      this.hud.showGameOver(
        {
          score: this.score,
          highScore: this.highScore,
          wave: this.waveSystem.wave,
          kills: this.kills,
        },
        this._isNewHigh
      );
      this.audio.play('gameOver');
      void next;
    });
    s.on(States.BOSS_INTRO, () => {
      this.audio.play('bossAlert');
    });

    // pause toggle (P/ESC)
    this.input.onAction('KeyP', () => this._togglePause());
    this.input.onAction('Escape', () => this._togglePause());
  }

  // ----------------------------------------------------------------
  // gameplay helpers
  // ----------------------------------------------------------------
  _startMenuAmbient() {
    // keep the starfield moving for the menu background
    this._context.starfield._points.visible = true;
  }

  _enterMainMenu() {
    this.state.transition(States.MAIN_MENU);
  }

  _beginPlay() {
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this._isNewHigh = false;
    this._fireCooldown = 0;

    // reset the world
    const ctx = this._context;
    ctx.player.reset();
    ctx.boss.onRecycle();
    for (const e of [...ctx.enemyList]) {
      this._releaseEnemy(e);
    }
    ctx.enemyList.length = 0;
    ctx.projectiles.deactivateAll();
    ctx.particles.clear();
    this.waveSystem.reset();
    this.attackSystem.reset();

    this.hud.setScore(0);
    this.hud.setHighScore(this.highScore);
    this.hud.setWave(1);
    this.hud.setCombo(1);
    this.hud.setShield(1);
    this.hud.setLife(ctx.player.lives);
    this.hud.setWeaponLevel(ctx.player.weaponLevel);
    this.hud.setTimedBuff(false, false);
    this.hud.hideBoss();

    this._startWave(1);
  }

  _startWave(wave) {
    // Release any enemies still alive from the previous wave (e.g.
    // leftover boss escorts when the boss fell before they did).
    // On a fresh _beginPlay the list is already empty, so this is a
    // no-op there.
    for (const e of [...this._context.enemyList]) this._releaseEnemy(e);

    this._context.wave = wave; // Boss reads ctx.wave for its firing cadence
    this.waveSystem.startWave(wave);
    this.hud.setWave(wave); // keep HUD in sync (regression: was stuck at 1)
    if (this.waveSystem._isBossWave) {
      this.state.transition(States.BOSS_INTRO);
      this._bossIntroTimer = 1.5;
      this._context.boss.configure(wave);
      this.hud.setBoss(1, 1);
    } else {
      this.state.transition(States.PLAYING);
    }
  }

  _onEnemyKilled(enemy, at) {
    const cfg = {
      fighter: 100,
      interceptor: 150,
      heavy: 300,
      elite: 500,
    }[enemy.type] ?? 100;
    let points = cfg;
    if (enemy.isDiving()) points += 120; // dive bonus
    points = Math.round(points * (1 + Math.min(9, this.combo * 0.25)));

    this.score += points;
    this.kills += 1;
    this.combo += 1;
    this.comboTimer = 2.4;
    this._isNewHigh = this.score > this.highScore;
    if (this._isNewHigh) this.highScore = this.score;

    this.hud.setScore(this.score);
    this.hud.setHighScore(this.highScore);
    this.hud.setCombo(Math.max(1, Math.floor(this.combo)));

    // visuals
    const color = enemy.palette?.core ?? 0xffc24d;
    this._explosion.small(enemy.group.position, color);
    this._cameraFx.addShake(0.18);
    // big golden "credit" popup on high-combo kills, normal on the rest
    const credit = this.combo >= 5;
    this._floatingText.spawnAt(enemy.group.position, `+${points}`, '#bfe9ff', credit);
    this.audio.play('explosion');

    // possibly drop a power-up
    if (Math.random() < POWERUP.CHANCE) {
      const type = POWERUP.TYPES[this._pickPowerupWeighted()];
      this._context.projectiles.spawnPowerUp({
        origin: enemy.group.position,
        type,
        fallSpeed: POWERUP.FALL_SPEED,
      });
    }

    this._releaseEnemy(enemy);

    // wave progress — count the kill so `enemyDied` can flag
    // completion when everything has been spawned AND killed.
    this.waveSystem.enemyDied();
    if (this.waveSystem.isComplete) {
      this._waveClearTimer = WAVE_CFG.WAVE_CLEAR_TIME;
      this.state.transition(States.WAVE_CLEAR);
      this.hud.showWaveClear(this.waveSystem.wave + 1);
      this.audio.play('waveClear');
    }
  }

  _onPlayerHit(dmg) {
    const p = this._context.player;
    const result = p.takeDamage(dmg);
    if (result === false) return; // invulnerable
    this.combo = 0;
    this.hud.setCombo(1);
    this.audio.play('playerHit');
    this._cameraFx.addShake(0.5);
    this.hud.setShield(p.shield / PLAYER.MAX_SHIELD);
    this.hud.setLife(p.lives);

    if (result === 'lostLife') {
      // Ship destroyed: debris burst at the craft, wipe collected items,
      // then respawn centered (invulnerability flash set in takeDamage).
      this._explosion.playerDestroyed(p.group.position);
      this._cameraFx.addShake(1.0);
      p.resetCollected();
      p.group.position.x = 0;
      p.velocityX = 0;
      this.hud.setWeaponLevel(p.weaponLevel);
      this.hud.setTimedBuff(p.rapidLevel > 0, p.rapidLevel);
    } else if (result === 'hit') {
      this._explosion.playerHit(p.group.position);
    }

    if (result === 'dead') {
      // Final destruction, then the game-over panel.
      this._explosion.big(p.group.position, 0x66d9ff);
      this._cameraFx.addShake(1.0);
      this.state.transition(States.GAME_OVER);
    }
  }

  _onPowerUpTaken(pu) {
    const p = this._context.player;
    const type = pu.type;
    this.audio.play('powerUp');
    const at = pu.group.position;
    this._floatingText.spawnAt(at, this._powerupLabel(type), '#9fe8ff', true);
    if (type === 'WEAPON') p.upgradeWeapon();
    else if (type === 'SHIELD') p.heal(POWERUP.SHIELD_AMOUNT);
    else if (type === 'Rapid') p.grantRapid();
    this.hud.setWeaponLevel(p.weaponLevel);
    this.hud.setShield(p.shield / PLAYER.MAX_SHIELD);
    this.hud.setTimedBuff(p.rapidLevel > 0, p.rapidLevel);
    this._explosion.small(at, 0x5cf2ff);
  }

  _powerupLabel(type) {
    return { WEAPON: 'WEAPON UP', SHIELD: 'SHIELD+', Rapid: 'RAPID+' }[type];
  }

  _onBossKilled(boss, at) {
    this.score += 5000 + Math.floor(this.waveSystem.wave / 5) * 1000;
    this.kills += 1;
    this._isNewHigh = this.score > this.highScore;
    if (this._isNewHigh) this.highScore = this.score;

    // CRITICAL: actually hide the boss + reset its state.
    // Without onRecycle the boss ship stays visible in-scene
    // (boss.update early-returns on !alive, so it never clears itself).
    boss.onRecycle();

    // Clear the boss's residual fire so the scene is clean during
    // WAVE_CLEAR. Player's live lasers + falling powerups are kept.
    this._context.projectiles.deactivateHostile();

    this._explosion.big(at, 0xff7bd6);
    this._cameraFx.addShake(1.0);
    this._floatingText.spawnAt(at, 'BOSS DOWN', '', true);
    this.audio.play('bossDestroyed');
    this.hud.setScore(this.score);
    this.hud.setHighScore(this.highScore);
    this.hud.hideBoss();
    // small "bonus" drop
    this._context.projectiles.spawnPowerUp({
      origin: at,
      type: 'SHIELD',
      fallSpeed: POWERUP.FALL_SPEED,
    });
    // Set the boss-dead flag so WaveSystem.isComplete only fires once
    // every escort has also been wiped out.
    this.waveSystem.bossDied();

    // If escorts remain, keep PLAYING — the wave will transition to
    // WAVE_CLEAR via the normal _onEnemyKilled isComplete check once
    // the last escort dies.  If there are no escorts, clear immediately.
    if (this.waveSystem.isComplete) {
      this._waveClearTimer = WAVE_CFG.WAVE_CLEAR_TIME;
      this.state.transition(States.WAVE_CLEAR);
      this.hud.showWaveClear(this.waveSystem.wave + 1);
      this.audio.play('waveClear');
    }
  }

  _togglePause() {
    if (this.state.current !== States.PLAYING && this.state.current !== States.PAUSED) return;
    if (this.state.current === States.PLAYING) this.state.transition(States.PAUSED);
    else this.state.transition(States.PLAYING);
  }

  _restart() {
    this._beginPlay();
  }

  _toMenu() {
    this.state.transition(States.MAIN_MENU);
  }

  _pickEnemyTypeForSlot(type, fallback) {
    return type ?? fallback;
  }

  // ----------------------------------------------------------------
  // main loop
  // ----------------------------------------------------------------
  _now() {
    return performance.now();
  }

  _loop() {
    const t = this._now();
    let dt = (t - this._last) / 1000;
    this._last = t;
    if (dt > 0.05) dt = 0.05; // clamp big frame hitches

    this.update(dt);
    this.render();

    this.input.endFrame();
    this._raf = requestAnimationFrame(this._loop);
  }

  /** Per-frame update: state-dependent work. */
  update(dt) {
    const ctx = this._context;
    const s = this.state.current;

    // ambient systems that run all the time
    ctx.starfield.update(dt, s === States.MAIN_MENU ? 0.7 : 1.0);
    this._floatingText.update(dt);
    this._explosion.update(dt);

    if (s === States.MAIN_MENU) {
      // player hover demo in the menu background.
      // _menuT(dt) accumulates the menu clock each frame so the
      // hover keeps its phase across frames.
      ctx.player.group.position.x = Math.sin(this._menuT(dt)) * 6;
      this._cameraFx.update(dt, 0);
      return;
    }

    if (s === States.GAME_OVER) {
      // slow world decay: particles continue
      ctx.particles.update(dt);
      return;
    }

    if (s === States.PAUSED) {
      return;
    }

    // PLAYING / WAVE_CLEAR / BOSS_INTRO
    const playing = s === States.PLAYING;
    // The player keeps full control during WAVE_CLEAR lull AND during
    // BOSS_INTRO (the 1.5s cinematic) so they can position and fire.
    const controlled = playing || s === States.WAVE_CLEAR || s === States.BOSS_INTRO;

    // player
    const prevDash = this._prevDashTimer ?? 0;
    if (controlled && ctx.player.alive) {
      ctx.player.update(this.input, dt, this._t0(dt));
    }
    // dash just triggered (previously was 0, now > 0) -> play cue
    if (controlled && ctx.player.alive && prevDash <= 0 && ctx.player.dashTimer > 0) {
      this.audio.play('dash');
      this._cameraFx.addShake(0.12);
    }
    this._prevDashTimer = ctx.player.dashTimer;

    // firing — one shared cadence for auto & manual: a shot leaves only
    // when the cooldown has elapsed, then the cooldown resets to one
    // interval (1/baseRate, 0.5s at base). Holding SPACE/J auto-fires at
    // that cadence; tapping can't fire faster because the same cooldown
    // gates it. Player keeps full control (move + fire) through the
    // WAVE_CLEAR lull — leftovers still fly.
    this._fireCooldown -= dt;
    const wantFire =
      controlled && ctx.player.alive &&
      (this.input.firing || this.input.firePressed);
    if (wantFire && this._fireCooldown <= 0) {
      const stats = ctx.player.weaponStats();
      this._firePlayerLaser(stats);
      this.audio.play('laser');
      this._muzzleKick();
      this._fireCooldown = 1 / stats.baseRate;
    }

    // enemies
    if (playing || s === States.WAVE_CLEAR) {
      if (s === States.PLAYING) {
        this.waveSystem.update(dt, this);
      }
      for (const e of [...ctx.enemyList]) {
        if (e.state === 'DIVING' && e.curveDone) {
          // (handled internally)
        }
        e.update(this, dt, this.waveSystem.wave);
        if (!e.active) {
          this._releaseEnemy(e);
        } else {
          // re-add if already in list (no-op)
        }
      }
      // cleanup list
      for (let i = ctx.enemyList.length - 1; i >= 0; i--) {
        if (!ctx.enemyList[i].active) ctx.enemyList.splice(i, 1);
      }
    }

    // boss
    if ((playing || s === States.BOSS_INTRO || s === States.WAVE_CLEAR) && ctx.boss.alive) {
      ctx.boss.update(this, dt);
      this.hud.setBoss(
        ctx.boss.coreHpRatio,
        ctx.boss.phase
      );
      if (!ctx.boss.alive) {
        // handled via _onBossKilled (collision) — also allow the
        // "boss died between frames" case by checking here:
        // (no extra code needed; collision covers it)
      }
    }

    // attack system (dive scheduling)
    if (playing) this.attackSystem.update(dt, this.waveSystem.wave);

    // projectile + powerup systems
    ctx.projectiles.update(dt);

    // collision
    this._collision.update();

    // combo decay
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // wave clear timer
    if (s === States.WAVE_CLEAR) {
      this._waveClearTimer -= dt;
      if (this._waveClearTimer <= 0) {
        this.hud.hideWaveClear();
        this._startWave(this.waveSystem.wave + 1);
      }
    }

    // boss intro timer
    if (s === States.BOSS_INTRO) {
      this._bossIntroTimer -= dt;
      if (this._bossIntroTimer <= 0) {
        this.state.transition(States.PLAYING);
      }
    }

    // HUD live updates
    if (ctx.player.alive) {
      this.hud.setShield(ctx.player.shield / PLAYER.MAX_SHIELD);
      this.hud.setLife(ctx.player.lives);
      this.hud.setWeaponLevel(ctx.player.weaponLevel);
      this.hud.setTimedBuff(ctx.player.rapidLevel > 0, ctx.player.rapidLevel);
      this.hud.setCombo(Math.max(1, Math.min(10, Math.floor(this.combo) + 1)));
    }

    // camera
    this._cameraFx.update(dt, ctx.player.alive ? ctx.player.group.position.x : 0);

    // particles
    ctx.particles.update(dt);
  }

  _menuT(dt) {
    this._menuClock = (this._menuClock ?? 0) + dt;
    return this._menuClock;
  }
  _t0(dt) {
    this._gameClock = (this._gameClock ?? 0) + dt;
    return this._gameClock;
  }

  _firePlayerLaser(stats) {
    const p = this._context.player;
    const origin = p.group.position;
    const count = stats.count;
    // Fan the barrels so the side shots fire FROM the wing guns at the tips
    // of the plane (x=±1.95, where the wing barrels sit), not floating
    // outside the silhouette or stacked on the nose. For 3 shots the
    // outer barrels land exactly on the wing-gun tips; for 2, a tight
    // inboard pair. Shots still fly dead-straight (angle 0).
    const mid = (count - 1) / 2;
    const spacing = 1.95; // world units between adjacent barrels (= wing tip)
    for (let i = 0; i < count; i++) {
      const xOff = (i - mid) * spacing;
      const from = new THREE.Vector3(origin.x + xOff, origin.y, origin.z - 0.4);
      this._context.projectiles.spawnPlayerShot({ origin: from, angle: 0, stats });
    }
    // TOTAL shots = weapon COUNTS (max 3) — no extra drone fire (removed).
    this._muzzleFlash(origin);
  }

  _muzzleFlash(origin) {
    const c = new THREE.Color(COLORS.PLAYER_LASER);
    for (let i = 0; i < 4; i++) {
      this._context.particles.spawn(
        new THREE.Vector3(origin.x, origin.y, origin.z - 1.4),
        {
          color: c,
          vx: (Math.random() - 0.5) * 6,
          vy: (Math.random() - 0.5) * 6,
          vz: -16 - Math.random() * 6,
          life: 0.12,
          drag: 2,
          gravity: 0,
        }
      );
    }
  }

  // Muzzle kick was causing position.z to drift (accumulates per
  // shot). Player Y/Z is now reset each frame inside Player.update
  // (see the clamp block), so no per-shot kick is needed here.
  _muzzleKick() {
    // intentionally a no-op — visual punch is provided by muzzleFlash.
  }

  // ----------------------------------------------------------------
  // render
  // ----------------------------------------------------------------
  render() {
    this.renderer.renderer.render(this.renderer.scene, this.renderer.camera);
  }

  // ----------------------------------------------------------------
  // WebGPU fallback
  // ----------------------------------------------------------------
  _failWebGPU() {
    const host = this._canvasHost;
    host.innerHTML = `
      <div class="webgpu-fallback">
        <h1>NEBULA STRIKE</h1>
        <p>이 게임은 WebGPU를 지원하는 최신 Chrome 또는 Edge 브라우저가 필요합니다.</p>
        <p class="sub">Please use a recent <strong>Chrome</strong> or <strong>Edge</strong> with WebGPU enabled.</p>
      </div>`;
  }

  _loadHighScore() {
    try {
      const v = localStorage.getItem(GAME.HIGH_SCORE_KEY);
      if (v) this.highScore = Math.max(0, parseInt(v, 10) || 0);
    } catch (e) {}
  }

  _saveHighScore() {
    try {
      localStorage.setItem(GAME.HIGH_SCORE_KEY, String(Math.floor(this.highScore)));
    } catch (e) {}
  }

  // ----------------------------------------------------------------
  // HUD binding
  // ----------------------------------------------------------------
  _bindHud() {
    this.hud.bind({
      onStart: () => this._beginPlay(),
      onResume: () => this._togglePause(),
      onRestart: () => this._restart(),
      onRestartMenu: () => this._toMenu(),
    });
    // save high score periodically
    setInterval(() => this._saveHighScore(), 2000);
  }
}
