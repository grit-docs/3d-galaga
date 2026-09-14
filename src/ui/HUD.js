/**
 * HUD.js
 * ---------------------------------------------------------------
 * A thin wrapper over the <div id="game-root"> HUD.
 *
 *  - Top bar: Score / High score / Wave / Combo
 *  - Bottom bar: Weapon level, Shield gauge, Life icons
 *  - Boss bar: shown on boss waves
 *  - Menu, Pause, Game Over, Wave Clear overlays
 *
 * All methods are idempotent: calling showMenu() once is fine,
 * calling it again just refreshes it.
 *
 * The HUD does NOT create any DOM nodes at run time except for
 * the floating score text container, which is already part of the
 * page. Everything else is static HTML.
 * ---------------------------------------------------------------
 */
import { GAME } from '../config.js';

export class HUD {
  constructor(root) {
    this._root = root;

    this.scoreEl = root.querySelector('[data-hud="#score"]');
    this.highScoreEl = root.querySelector('[data-hud="#highScore"]');
    this.waveEl = root.querySelector('[data-hud="#wave"]');
    this.comboEl = root.querySelector('[data-hud="#combo"]');
    this.shieldFill = root.querySelector('[data-hud="#shieldFill"]');
    this.lifeEl = root.querySelector('[data-hud="#life"]');
    this.weaponEl = root.querySelector('[data-hud="#weapon"]');
    this.rapidEl = root.querySelector('[data-hud="#rapid"]');
    this.pierceEl = root.querySelector('[data-hud="#pierce"]');
    this.bossEl = root.querySelector('[data-hud="#boss"]');
    this.bossFill = root.querySelector('[data-hud="#bossFill"]');
    this.bossPhaseEl = root.querySelector('[data-hud="#bossPhase"]');

    this.menuEl = root.querySelector('#menu');
    this.pauseEl = root.querySelector('#pause');
    this.gameOverEl = root.querySelector('#gameOver');
    this.waveClearEl = root.querySelector('#waveClear');
    this.startButton = root.querySelector('#startBtn');
    this.resumeButton = root.querySelector('#resumeBtn');
    // note: Restart / Main-Menu buttons are bound by class in bind()
    // because they appear on BOTH the pause and game-over panels.
  }

  // ------- score / wave / combo ----------------------------------
  setScore(n) { this.scoreEl.textContent = String(Math.max(0, Math.floor(n))); }
  setHighScore(n) { this.highScoreEl.textContent = String(Math.max(0, Math.floor(n))); }
  setWave(n) { this.waveEl.textContent = String(n); }
  setCombo(m) {
    this.comboEl.textContent = `x${Math.max(1, m)}`;
    this.comboEl.classList.toggle('hot', m >= 5);
  }
  setShield(ratio) {
    this.shieldFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    this.shieldFill.style.background = ratio > 0.5 ? 'var(--neon)' :
      ratio > 0.2 ? 'var(--neon2)' : 'var(--danger)';
  }
  setLife(n) {
    // render 0..3 as ◆ ◇
    let str = '';
    for (let i = 0; i < 3; i++) str += i < n ? '◆ ' : '◇ ';
    this.lifeEl.textContent = str.trimEnd();
  }
  setWeaponLevel(n) {
    this.weaponEl.textContent = `LV ${Math.max(1, n)}`;
  }
  setTimedBuff(showRapid, showPierce) {
    this.rapidEl.style.display = showRapid ? '' : 'none';
    this.pierceEl.style.display = showPierce ? '' : 'none';
  }

  // ------- boss --------------------------------------------------
  setBoss(hpRatio, phase) {
    this.bossEl.style.visibility = 'visible';
    this.bossFill.style.width = `${Math.max(0, hpRatio) * 100}%`;
    this.bossPhaseEl.textContent = `PHASE ${phase}`;
    this.bossFill.style.background = phase >= 3 ? 'var(--danger)' : phase >= 2 ? 'var(--neon2)' : 'var(--neon3)';
  }
  hideBoss() {
    this.bossEl.style.visibility = 'hidden';
  }

  // ------- overlays ---------------------------------------------
  /** Hide every OTHER overlay so a transition never stacks two popups
   *  (e.g. game-over panel lingering behind the main menu). */
  _hideOthers(except) {
    for (const el of [this.menuEl, this.pauseEl, this.gameOverEl, this.waveClearEl]) {
      if (el && el !== except) el.style.display = 'none';
    }
  }

  showMenu(gpuSupported) {
    this._hideOthers(this.menuEl);
    this.menuEl.style.display = 'flex';
    const webgpu = this.menuEl.querySelector('[data-webgpu]');
    if (webgpu) {
      webgpu.textContent = gpuSupported ? 'WebGPU: OK' : 'WebGPU: required';
      webgpu.classList.toggle('ok', gpuSupported);
      webgpu.classList.toggle('bad', !gpuSupported);
    }
  }
  hideMenu() { this.menuEl.style.display = 'none'; }
  showPause() {
    this._hideOthers(this.pauseEl);
    this.pauseEl.style.display = 'flex';
  }
  hidePause() { this.pauseEl.style.display = 'none'; }
  showWaveClear(wave) {
    this._hideOthers(this.waveClearEl);
    this.waveClearEl.style.display = 'flex';
    this.waveClearEl.querySelector('[data-wc="#num"]').textContent = wave;
    this.waveClearEl.querySelector('[data-wc="#label"]').textContent = `WAVE ${wave} CLEAR`;
  }
  hideWaveClear() { this.waveClearEl.style.display = 'none'; }

  /**
   * @param {object} data { score, highScore, wave, kills }
   * @param {boolean} isNewHigh
   */
  showGameOver({ score, highScore, wave, kills }, isNewHigh) {
    this._hideOthers(this.gameOverEl);
    this.gameOverEl.style.display = 'flex';
    this.gameOverEl.querySelector('[data-go="#score"]').textContent = String(Math.floor(score));
    this.gameOverEl.querySelector('[data-go="#high"]').textContent = String(Math.floor(highScore));
    this.gameOverEl.querySelector('[data-go="#wave"]').textContent = String(wave);
    this.gameOverEl.querySelector('[data-go="#kills"]').textContent = String(kills);
    const newHigh = this.gameOverEl.querySelector('[data-go="#newhigh"]');
    newHigh.style.display = isNewHigh ? '' : 'none';
  }
  hideAll() {
    this.hideMenu(); this.hidePause(); this.hideWaveClear();
    this.gameOverEl.style.display = 'none';
    this.hideBoss();
  }

  // ------- binding ------------------------------------------------
  /**
   * Wire up the control buttons. Restart / Main-Menu appear on both
   * the pause and game-over panels, so they are bound by class
   * (.js-restart / .js-menu) and every match gets a listener.
   */
  bind({ onStart, onResume, onRestartMenu, onRestart, onPauseToggle }) {
    if (this.startButton) {
      this.startButton.addEventListener('click', () => {
        this.startButton.blur();
        onStart?.();
      });
    }
    if (this.resumeButton) {
      this.resumeButton.addEventListener('click', () => {
        this.resumeButton.blur();
        onResume?.();
      });
    }
    for (const btn of this._root.querySelectorAll('.js-restart')) {
      btn.addEventListener('click', () => {
        btn.blur();
        onRestart?.();
      });
    }
    for (const btn of this._root.querySelectorAll('.js-menu')) {
      btn.addEventListener('click', () => {
        btn.blur();
        onRestartMenu?.();
      });
    }
    onPauseToggle?.();
  }

  static title = GAME.TITLE;
}
