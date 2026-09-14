/**
 * InputManager.js
 * ---------------------------------------------------------------
 * Keyboard input abstraction with "just pressed" detection and a
 * small hook system for one-shot actions (pause, restart...).
 * Keeps entity/system code free from raw DOM event handling.
 * ---------------------------------------------------------------
 */
const MOVE_LEFT = new Set(['KeyA', 'ArrowLeft']);
const MOVE_RIGHT = new Set(['KeyD', 'ArrowRight']);
const FIRE = new Set(['Space', 'KeyJ']);
const DASH = new Set(['ShiftLeft', 'ShiftRight', 'KeyK']);

export class InputManager {
  constructor() {
    this._down = new Set();
    this._justPressed = new Set();
    this._pressedOnceFired = new Set();
    this._actions = new Map(); // key -> [fn]

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }

  _onKeyDown(e) {
    if (e.repeat) return;
    if (
      e.code === 'Space' ||
      e.code.startsWith('Arrow') ||
      e.code === 'ShiftLeft' ||
      e.code === 'ShiftRight'
    ) {
      e.preventDefault();
    }
    this._down.add(e.code);
    if (!this._pressedOnceFired.has(e.code)) {
      this._justPressed.add(e.code);
      this._pressedOnceFired.add(e.code);
    }
    const fns = this._actions.get(e.code);
    if (fns) for (const fn of fns) fn(e);
  }

  _onKeyUp(e) {
    this._down.delete(e.code);
  }

  _onBlur() {
    this._down.clear();
  }

  /** Register a one-shot action for a key code (e.g. 'KeyP'). */
  onAction(code, fn) {
    if (!this._actions.has(code)) this._actions.set(code, []);
    this._actions.get(code).push(fn);
  }

  isDown(code) {
    return this._down.has(code);
  }

  isAnyDown(set) {
    for (const c of set) if (this._down.has(c)) return true;
    return false;
  }

  /** Accepts a Set or an array of key codes. */
  wasPressed(codes) {
    for (const code of this._justPressed) {
      if (codes instanceof Set ? codes.has(code) : codes.includes(code)) return true;
    }
    return false;
  }

  get dashPressed() {
    return this.wasPressed(DASH);
  }

  /** -1 left, +1 right, 0 center (movement axis). */
  get axisX() {
    let axis = 0;
    if (this.isAnyDown(MOVE_LEFT)) axis -= 1;
    if (this.isAnyDown(MOVE_RIGHT)) axis += 1;
    return axis;
  }

  /** True while ANY fire key (Space/J) is held down — drives auto-fire. */
  get firing() {
    return this.isAnyDown(FIRE);
  }

  /** True exactly for one frame per physical fire-key press (OS
   *  auto-repeat is swallowed via e.repeat) — drives the manual-tap
   *  first shot; both paths are gated by the shared fire cooldown. */
  get firePressed() {
    return this.wasPressed(FIRE);
  }

  /** Call once per frame at the end of update: clears pressed flags. */
  endFrame() {
    this._justPressed.clear();
    this._pressedOnceFired.clear();
  }
}
