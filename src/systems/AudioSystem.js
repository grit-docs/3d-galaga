/**
 * AudioSystem.js
 * ---------------------------------------------------------------
 * A small Web Audio API synthesiser. No external assets, all tones
 * are generated at runtime from oscillator + gain envelopes.
 *
 * Exposes play(name) for a fixed set of cues used across the game:
 *   laser, enemyLaser, explosion, playerHit, powerUp, bossAlert,
 *   bossDestroyed, gameOver, waveClear, dash
 *
 * Falls back to a no-op when audio is unavailable so the game keeps
 * working if the user's environment blocks Web Audio.
 *
 * The API is intentionally swappable: replace _play with a call to
 * an <audio> element / Howler / etc. and everything keeps working.
 * ---------------------------------------------------------------
 */
import { AUDIO } from '../config.js';

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.enabled = AUDIO.ENABLED;
    this.volume = AUDIO.MASTER_VOLUME;
    this._master = null;
  }

  /** Lazy-init: browsers only allow AudioContext after a gesture. */
  ensure() {
    if (this.ctx) return;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this._master = this.ctx.createGain();
      this._master.gain.value = this.volume;
      this._master.connect(this.ctx.destination);
    } catch (err) {
      this.ctx = null;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }
  }

  setMuted(m) {
    if (this._master) this._master.gain.value = m ? 0 : this.volume;
  }

  play(name) {
    if (!this.enabled) return;
    this.ensure();
    this.resume();
    if (!this.ctx) return;
    switch (name) {
      case 'laser': this._laser(); break;
      case 'enemyLaser': this._enemyLaser(); break;
      case 'hitTick': this._hitTick(); break;
      case 'explosion': this._explosion(false); break;
      case 'bigExplosion': this._explosion(true); break;
      case 'playerHit': this._playerHit(); break;
      case 'powerUp': this._powerUp(); break;
      case 'bossAlert': this._bossAlert(); break;
      case 'bossDestroyed': this._bossDestroyed(); break;
      case 'gameOver': this._gameOver(); break;
      case 'waveClear': this._waveClear(); break;
      case 'dash': this._dash(); break;
      default: break;
    }
  }

  // -------- tone building blocks ---------------------------------
  _tone({ freq = 440, type = 'square', peak = 0.3, dur = 0.15, slide = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.linearRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this._master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  _noise({ peak = 0.3, dur = 0.2, lowpass = 800 }) {
    if (!this.ctx) return;
    const buf = this._noiseBuffer(1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const gain = this.ctx.createGain();
    const t0 = this.ctx.currentTime;
    gain.gain.setValueAtTime(peak, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this._master);
    src.start(t0);
    src.stop(t0 + dur + 0.01);
  }

  _noiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // -------- named cues -------------------------------------------
  _laser() {
    this._tone({ freq: 880, type: 'sawtooth', peak: 0.15, dur: 0.08, slide: -500 });
  }
  _hitTick() {
    // short metallic 'clink' — confirms a non-lethal laser impact
    this._tone({ freq: 620, type: 'triangle', peak: 0.10, dur: 0.05, slide: -220 });
  }
  _enemyLaser() {
    this._tone({ freq: 320, type: 'square', peak: 0.12, dur: 0.09, slide: 160 });
  }
  _explosion(big) {
    this._noise({ peak: big ? 0.5 : 0.28, dur: big ? 0.5 : 0.22, lowpass: big ? 260 : 700 });
    this._tone({ freq: big ? 90 : 140, type: 'sine', peak: big ? 0.3 : 0.18, dur: big ? 0.4 : 0.18, slide: -60 });
  }
  _playerHit() {
    this._noise({ peak: 0.24, dur: 0.24, lowpass: 500 });
    this._tone({ freq: 120, type: 'triangle', peak: 0.2, dur: 0.2, slide: 120 });
  }
  _powerUp() {
    this._tone({ freq: 520, type: 'square', peak: 0.15, dur: 0.06 });
    setTimeout(() => this._tone({ freq: 780, type: 'square', peak: 0.15, dur: 0.08 }), 70);
    setTimeout(() => this._tone({ freq: 1100, type: 'square', peak: 0.14, dur: 0.12 }), 150);
  }
  _bossAlert() {
    this._tone({ freq: 180, type: 'sawtooth', peak: 0.22, dur: 0.9, slide: -60 });
  }
  _bossDestroyed() {
    this._noise({ peak: 0.6, dur: 1.2, lowpass: 240 });
    this._tone({ freq: 70, type: 'sine', peak: 0.35, dur: 1.1, slide: -30 });
  }
  _gameOver() {
    const notes = [440, 392, 330, 262];
    notes.forEach((f, i) => {
      setTimeout(() => this._tone({ freq: f, type: 'triangle', peak: 0.2, dur: 0.28 }), i * 180);
    });
  }
  _waveClear() {
    const notes = [523, 659, 784];
    notes.forEach((f, i) => {
      setTimeout(() => this._tone({ freq: f, type: 'square', peak: 0.16, dur: 0.14 }), i * 90);
    });
  }
  _dash() {
    this._tone({ freq: 900, type: 'sawtooth', peak: 0.1, dur: 0.08, slide: -500 });
  }
}
