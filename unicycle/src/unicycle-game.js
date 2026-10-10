// Browser lifecycle and game coordination. Physics and drawing remain independent.
import { DEFAULT_PARAMS, createState, step } from './physics.js';
import { render, menuRowAt } from './renderer.js';
import { Telemetry } from './telemetry.js';


export class UnicycleGame {
  constructor(container, params = {}) {
    this.p = { ...DEFAULT_PARAMS, ...params };
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none';
    this.canvas.tabIndex = 0; // receives keys only when focused — safe to embed
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.mobile = false; // mobile mode (top-right toggle, never automatic): on-screen ◀ JUMP ▶ buttons
    this.keys = new Set();
    this.manual = false; // manual torso mode (M): arrows pedal, A/D drive the hip
    this.menu = true; // start screen: pick a level (↑/↓ or click), Enter/Space/click starts; Esc in game returns here
    this.levels = null; // [{ name, points: [[x, y], …], start, finish }], fetched from levelUrls
    this.level = null; // the level picked in the menu (selectLevel)
    this.bestTimes = loadBestTimes(); // level name → best finish time, s; kept in localStorage
    this.result = null; // the last finish, shown in the menu: { name, time, record }
    this.run = 0;   // attempts so far; reset() starts the next one
    this.telemetry = new Telemetry(this.p.logEndpoint);
    this.s = createState(0, this.p); // the rider shown behind the menu
    Promise.all(this.p.levelUrls.map((url) => fetch(url).then((r) => r.json()))).then((levels) => {
      this.levels = levels;
      this.selectLevel(0);
    }).catch(() => { this.levelError = true; }); // e.g. opened via file:// instead of the dev server

    this._onKey = (e) => {
      if (e.code === 'KeyL' && e.type === 'keydown') { e.preventDefault(); this.telemetry.downloadLog(); return; }
      if (e.type === 'keydown' && this.menu && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); this._startKey = e.code; this.startGame(); return; }
      if (e.type === 'keydown' && this.menu && this.levels && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { e.preventDefault(); this.selectLevel(this.levelIndex + (e.code === 'ArrowUp' ? -1 : 1)); return; }
      // the key that started the game (Space is also jump) does nothing until it is released
      if (e.code === this._startKey) { e.preventDefault(); if (e.type === 'keyup') this._startKey = null; return; }
      if (e.type === 'keydown' && !this.menu && e.code === 'Escape') { e.preventDefault(); this.toMenu(); return; }
      if (e.code === 'KeyM') { e.preventDefault(); if (e.type === 'keydown' && !e.repeat) { this.manual = !this.manual; this.keys.clear(); } return; }
      const k = (this.manual ? MANUAL_KEY_MAP : KEY_MAP)[e.code];
      if (!k) return;
      e.preventDefault();
      e.type === 'keydown' ? this.keys.add(k) : this.keys.delete(k);
    };
    this._onBlur = () => { this.keys.clear(); this._startKey = null; };
    this._onResize = () => this.resize();
    this.canvas.addEventListener('keydown', this._onKey);
    this.canvas.addEventListener('keyup', this._onKey);
    this.canvas.addEventListener('blur', this._onBlur);
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.focus();
      if (!this.menu) return;
      const row = menuRowAt(this.h, this.levels?.length ?? 0, e.offsetY);
      if (row >= 0) this.selectLevel(row);
      this.startGame();
    });
    this._ro = new ResizeObserver(this._onResize);
    this._ro.observe(container);
    this._buildControls(container);
    this.resize();
  }

  /** Make level i (wrapping around) the current one: its track and finish go into the physics params,
   *  and the rider waits at its start. */
  selectLevel(i) {
    this.levelIndex = (i + this.levels.length) % this.levels.length;
    this.level = this.levels[this.levelIndex];
    this.p.track = this.level.points;
    this.p.finish = this.level.finish;
    this.s = createState(this.level.start, this.p);
  }

  startGame() {
    if (!this.level) return;
    this.reset(); // every start is a fresh attempt, with its own `run` number in the log
    this.menu = false;
    this.result = null;
    this._syncControls();
  }

  /** Back to the level menu (Esc or the top-left button). */
  toMenu() {
    this.menu = true;
    this.keys.clear();
    this._syncControls();
  }

  /** DOM overlay: menu button (top-left), mobile-mode toggle (top-right), ◀ JUMP ▶ bar (bottom centre). */
  _buildControls(container) {
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.canvas.style.touchAction = 'none';
    const btn = 'position:absolute;font:bold 16px sans-serif;border:none;border-radius:8px;background:rgba(18,34,51,0.35);color:#fff;user-select:none;-webkit-user-select:none;touch-action:none';
    this.menuButton = el('button', `${btn};left:10px;top:10px;padding:8px 14px`, '☰ Menu');
    this.menuButton.addEventListener('click', () => { this.toMenu(); this.canvas.focus(); });
    this.mobileToggle = el('label', `${btn};right:10px;top:10px;padding:8px 14px;display:flex;gap:8px;align-items:center;cursor:pointer`, '');
    const box = el('input', 'width:20px;height:20px;margin:0', '');
    box.type = 'checkbox';
    box.addEventListener('change', () => this.setMobile(box.checked));
    this.mobileToggle.append(box, 'Mobile version');
    // bottom row: pedal left, jump, pedal right; each holds its key while pressed
    const pad = `${btn};bottom:16px;height:72px;font-size:22px`;
    const hold = (b, key) => {
      const set = (on) => (e) => { e.preventDefault(); on ? this.keys.add(key) : this.keys.delete(key); };
      b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); set(true)(e); });
      for (const t of ['pointerup', 'pointercancel']) b.addEventListener(t, set(false));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    this.padButtons = [
      hold(el('button', `${pad};left:16px;width:calc(25vw - 24px)`, '◀'), 'left'),
      hold(el('button', `${pad};left:25vw;width:50vw`, 'JUMP'), 'jump'),
      hold(el('button', `${pad};right:16px;width:calc(25vw - 24px)`, '▶'), 'right'),
    ];
    container.append(this.menuButton, this.mobileToggle, ...this.padButtons);
    this._syncControls();
  }

  /** Mobile mode is only ever switched by the player (top-right toggle). */
  setMobile(on) {
    this.mobile = on;
    this.keys.clear();
    this._syncControls();
    this.canvas.focus();
  }

  _syncControls() {
    this.menuButton.style.display = this.menu ? 'none' : '';
    for (const b of this.padButtons) b.style.display = this.mobile && !this.menu ? '' : 'none';
  }

  /** The finish line is crossed: record the time, keep it if it is the level's best, back to the menu. */
  finishRun() {
    const { name } = this.level, time = this.s.t;
    const record = !(this.bestTimes[name] <= time);
    if (record) { this.bestTimes[name] = time; saveBestTimes(this.bestTimes); }
    this.result = { name, time, record };
    if (this.p.consoleLog) console.log(`[unicycle] run ${this.run} finished ${name} in ${time.toFixed(2)}s${record ? ' (best)' : ''}`);
    this.toMenu();
  }


  reset() {
    this.s = createState(this.level.start, this.p);
    this.acc = 0;
    this.run++;
    this.lastInput = 0;
    this.stepCount = 0;
  }

  record(input) {
    this.telemetry.record(this.s, input, this.run, this.levelIndex);
  }


  start() {
    this.canvas.focus();
    if (this.p.logEndpoint) {
      this.telemetry.startSession();
      this._flushTimer = setInterval(() => this.telemetry.flushLog(), 1000);
      this._onHide = () => this.telemetry.flushLog(true);
      window.addEventListener('pagehide', this._onHide);
      console.log(`[unicycle] streaming log to logs/${this.telemetry.session}.csv`);
    }
    let last = performance.now();
    const frame = (now) => {
      this._raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.update(dt);
      this.render();
    };
    this._raf = requestAnimationFrame(frame);
    return this;
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    clearInterval(this._flushTimer);
    if (this._onHide) { this.telemetry.flushLog(true); window.removeEventListener('pagehide', this._onHide); }
    this._ro.disconnect();
    this.canvas.remove();
    this.menuButton.remove(); this.mobileToggle.remove(); this.padButtons.forEach((b) => b.remove());
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    this.w = r.width; this.h = r.height; this.dpr = dpr;
  }

  update(dt) {
    if (this.menu) return;
    if (this.s.fallen) { this.reset(); return; } // restart immediately, stay in game
    const input = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
    // manual mode: A/D drive the torso at the hip; otherwise the pedals also drive it (hip = null)
    const hip = this.manual ? (this.keys.has('torsoForward') ? 1 : 0) - (this.keys.has('torsoBack') ? 1 : 0) : null;
    const jump = this.keys.has('jump');
    const H = 1 / 240;
    this.acc += dt * this.p.timeScale;
    while (this.acc >= H && !this.s.fallen && !this.s.finished) {
      const airborne = this.s.airborne;
      step(this.s, input, jump, H, this.p, hip);
      this.acc -= H;
      // 60 Hz samples + every pedal input change, take-off and touchdown
      if (this.stepCount++ % 4 === 0 || input !== this.lastInput || airborne !== this.s.airborne) this.record(input);
      if (input !== this.lastInput && this.p.consoleLog) {
        const s = this.s;
        console.log(`[unicycle] t=${s.t.toFixed(2)} input ${this.lastInput}→${input} v=${s.v.toFixed(2)} θ=${(s.theta * 180 / Math.PI).toFixed(1)}° ω=${s.omega.toFixed(2)}`);
      }
      this.lastInput = input;
    }
    if (this.s.fallen || this.s.finished) {
      this.record(input);
      if (this.s.fallen && this.p.consoleLog) {
        console.log(`[unicycle] run ${this.run} fell at t=${this.s.t.toFixed(2)}s x=${this.s.x.toFixed(2)}m; last 1s:`);
        console.table(this.telemetry.log.filter((r) => r.run === this.run && r.t > this.s.t - 1));
      }
      window.unicycleLog = this.telemetry.log; // whole session, for devtools analysis
      this.telemetry.flushLog();
      if (this.s.finished) this.finishRun();
    }
  }

  render() {
    render(this.ctx, { w: this.w, h: this.h, dpr: this.dpr }, this.s, this.p, {
      menu: this.menu, levels: this.levels, level: this.level,
      levelIndex: this.levelIndex, bestTimes: this.bestTimes, manual: this.manual, mobile: this.mobile,
      result: this.result, levelError: this.levelError,
    });
  }
}

function el(tag, css, text) {
  const e = document.createElement(tag);
  e.style.cssText = css;
  e.textContent = text;
  return e;
}

const KEY_MAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
};
// Manual mode (M toggles): arrows pedal, A/D drive the torso back/forward at the hip.
const MANUAL_KEY_MAP = {
  ArrowLeft: 'left', ArrowRight: 'right', KeyA: 'torsoBack', KeyD: 'torsoForward',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
};

// Best finish times by level name, s, kept in localStorage. Storage may be unavailable (e.g. blocked
// in an embed): then times last for the session only.
const BEST_TIMES_KEY = 'unicycle-defeat.bestTimes';
function loadBestTimes() {
  try { return JSON.parse(localStorage.getItem(BEST_TIMES_KEY)) ?? {}; } catch { return {}; }
}
function saveBestTimes(times) {
  try { localStorage.setItem(BEST_TIMES_KEY, JSON.stringify(times)); } catch { /* session only */ }
}

