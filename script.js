'use strict';

// ─────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────
const RING_R = 160;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R; // 1005.31

// Phase durations in seconds
const PHASE_DURATIONS = {
  focus: 25 * 60,
  short:  5 * 60,
  long:  15 * 60,
};

// ─────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────
let state = {
  phase: 'focus',
  running: false,
  secondsLeft: PHASE_DURATIONS.focus,
  totalSeconds: PHASE_DURATIONS.focus,
  pomodoroCount: 0,
  focusModeActive: false,
};

let timerInterval = null;
let audioCtx = null;

// ─────────────────────────────────────────────────
//  AUDIO MODULE
// ─────────────────────────────────────────────────
const Audio = {
  getCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  },

  /** Beep-beep alarm: two short beeps */
  playAlarm() {
    const ctx = this.getCtx();

    const beep = (startTime, freq = 880, duration = 0.18) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.6, startTime + 0.02);
      gain.gain.setValueAtTime(0.6, startTime + duration - 0.04);
      gain.gain.linearRampToValueAtTime(0, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    beep(now,        880, 0.18);   // first beep
    beep(now + 0.28, 880, 0.18);   // second beep — "beep beep"
  },

  /** Soft click for button presses */
  playClick() {
    const ctx = this.getCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = 700;
    osc.type = 'sine';
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  },
};

// ─────────────────────────────────────────────────
//  TIMER MODULE
// ─────────────────────────────────────────────────
const Timer = {
  setPhase(phase) {
    state.phase = phase;
    state.secondsLeft = PHASE_DURATIONS[phase];
    state.totalSeconds = PHASE_DURATIONS[phase];
    state.running = false;

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    document.body.dataset.phase = phase;
    UI.renderTimer();
    UI.updatePhaseTabs();
    UI.updateSessionDots();
    UI.updateStartBtn();

    const wrapper = document.querySelector('.timer-wrapper');
    if (wrapper) wrapper.classList.remove('running');
  },

  start() {
    if (state.running) return;
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    state.running = true;
    UI.updateStartBtn();
    document.querySelector('.timer-wrapper').classList.add('running');

    timerInterval = setInterval(() => Timer.tick(), 1000);
  },

  pause() {
    if (!state.running) return;
    state.running = false;
    clearInterval(timerInterval);
    timerInterval = null;
    UI.updateStartBtn();
    document.querySelector('.timer-wrapper').classList.remove('running');
  },

  toggle() {
    Audio.playClick();
    if (state.running) this.pause();
    else this.start();
  },

  reset() {
    Audio.playClick();
    this.pause();
    state.secondsLeft = PHASE_DURATIONS[state.phase];
    state.totalSeconds = PHASE_DURATIONS[state.phase];
    UI.renderTimer();
  },

  skip() {
    Audio.playClick();
    this.pause();

    if (state.phase === 'focus') {
      // Skip to appropriate break
      const nextPhase = (state.pomodoroCount > 0 && state.pomodoroCount % 4 === 0) ? 'long' : 'short';
      this.setPhase(nextPhase);
    } else {
      this.setPhase('focus');
    }
  },

  tick() {
    if (state.secondsLeft <= 0) {
      this.complete();
      return;
    }
    state.secondsLeft--;
    UI.renderTimer();
  },

  complete() {
    clearInterval(timerInterval);
    timerInterval = null;
    state.running = false;
    document.querySelector('.timer-wrapper').classList.remove('running');
    UI.updateStartBtn();

    // Play beep-beep alarm
    Audio.playAlarm();

    if (state.phase === 'focus') {
      state.pomodoroCount++;

      // Show confetti every 4 pomodoros
      if (state.pomodoroCount % 4 === 0) {
        Confetti.burst();
      }

      // Auto-transition: determine next break type
      const nextPhase = (state.pomodoroCount % 4 === 0) ? 'long' : 'short';

      // Small delay so the alarm is heard before phase switches
      setTimeout(() => {
        this.setPhase(nextPhase);
        // Auto-start the break
        this.start();
        UI.showAlert(nextPhase === 'long'
          ? '🏆 4 sessions done! Long break started.'
          : '✅ Focus done! Short break started.');
      }, 600);

    } else {
      // Break ended → go back to focus, let user start manually
      setTimeout(() => {
        this.setPhase('focus');
        UI.showAlert('☕ Break over! Press Start when ready.');
      }, 600);
    }
  },
};

// ─────────────────────────────────────────────────
//  CONFETTI MODULE
// ─────────────────────────────────────────────────
const Confetti = {
  canvas: null,
  ctx: null,
  particles: [],
  animating: false,
  colors: ['#6c63ff','#00d4ff','#f59e0b','#10b981','#ec4899','#ffffff'],

  init() {
    this.canvas = document.getElementById('confetti-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  },

  burst() {
    for (let i = 0; i < 120; i++) {
      this.particles.push({
        x: Math.random() * window.innerWidth,
        y: -10,
        vx: (Math.random() - 0.5) * 6,
        vy: Math.random() * 4 + 2,
        color: this.colors[Math.floor(Math.random() * this.colors.length)],
        size: Math.random() * 8 + 4,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 8,
        life: 1,
        decay: Math.random() * 0.008 + 0.005,
      });
    }
    if (!this.animating) this.animate();
  },

  animate() {
    this.animating = true;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.particles = this.particles.filter(p => p.life > 0);

    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.rotation += p.rotSpeed;
      p.life -= p.decay;

      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, p.life);
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(p.rotation * Math.PI / 180);
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(-p.size/2, -p.size/4, p.size, p.size/2);
      this.ctx.restore();
    }

    if (this.particles.length > 0) {
      requestAnimationFrame(() => this.animate());
    } else {
      this.animating = false;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  },
};

// ─────────────────────────────────────────────────
//  UI MODULE
// ─────────────────────────────────────────────────
const UI = {
  init() {
    this.buildTickMarks();
    this.renderTimer();
    this.updateStartBtn();
    this.updatePhaseTabs();
    this.updateSessionDots();
  },

  buildTickMarks() {
    const g = document.getElementById('tickMarks');
    if (!g) return;

    const cx = 180, cy = 180, r = RING_R;
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
      const isMajor = i % 5 === 0;
      const inner = r - (isMajor ? 14 : 8);
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + inner * Math.cos(angle);
      const y2 = cy + inner * Math.sin(angle);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      if (isMajor) line.classList.add('tick-major');
      g.appendChild(line);
    }
  },

  renderTimer() {
    const m = Math.floor(state.secondsLeft / 60).toString().padStart(2, '0');
    const s = (state.secondsLeft % 60).toString().padStart(2, '0');
    const timeStr = `${m}:${s}`;

    document.getElementById('timerDisplay').textContent = timeStr;
    document.getElementById('focusTimerDisplay').textContent = timeStr;

    // Progress ring — fill clockwise as time goes on
    const progress = 1 - (state.secondsLeft / state.totalSeconds);
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    document.getElementById('ringProgress').style.strokeDashoffset = offset;

    // Document title
    const phaseNames = { focus: '🎯 Focus', short: '☕ Short Break', long: '🌿 Long Break' };
    document.title = `${timeStr} — ${phaseNames[state.phase]} | FlowState`;
  },

  updateStartBtn() {
    const icon = document.getElementById('startBtnIcon');
    const text = document.getElementById('startBtnText');
    const focusBtn = document.getElementById('focusStartBtn');

    if (state.running) {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
      text.textContent = 'Pause';
      if (focusBtn) focusBtn.textContent = '⏸';
    } else {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      text.textContent = 'Start';
      if (focusBtn) focusBtn.textContent = '▶';
    }
  },

  updatePhaseTabs() {
    document.querySelectorAll('.phase-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.phase === state.phase);
    });

    const labels = {
      focus: 'Focus Time',
      short: 'Short Break',
      long:  'Long Break',
    };
    const label = labels[state.phase];
    document.getElementById('phaseLabel').textContent = label;
    const focusPhase = document.getElementById('focusPhaseLabel');
    if (focusPhase) focusPhase.textContent = label;
  },

  updateSessionDots() {
    const dots = document.querySelectorAll('#sessionDots .dot');
    dots.forEach((dot, i) => {
      dot.classList.remove('active', 'completed');
      if (i < state.pomodoroCount % 4) dot.classList.add('completed');
      if (i === state.pomodoroCount % 4) dot.classList.add('active');
    });
  },

  showAlert(text) {
    const el = document.getElementById('inAppAlert');
    document.getElementById('inAppAlertText').textContent = text;
    el.classList.add('visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('visible'), 4000);
  },
};

// ─────────────────────────────────────────────────
//  EVENT BINDINGS
// ─────────────────────────────────────────────────
function bindEvents() {

  // Phase tabs
  document.querySelectorAll('.phase-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      Audio.playClick();
      Timer.setPhase(tab.dataset.phase);
    });
  });

  // Start/Pause
  document.getElementById('startBtn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    Timer.toggle();
  });

  // Focus overlay Start/Pause
  const focusStartBtn = document.getElementById('focusStartBtn');
  if (focusStartBtn) {
    focusStartBtn.addEventListener('click', (e) => {
      e.currentTarget.blur();
      Timer.toggle();
    });
  }

  // Reset
  document.getElementById('resetBtn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    Timer.reset();
  });

  // Skip
  document.getElementById('skipBtn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    Timer.skip();
  });

  // Focus mode exit
  const focusExitBtn = document.getElementById('focusExitBtn');
  if (focusExitBtn) {
    focusExitBtn.addEventListener('click', () => {
      state.focusModeActive = false;
      document.getElementById('focusOverlay').classList.remove('active');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    switch (e.code) {
      case 'Space': e.preventDefault(); Timer.toggle(); break;
      case 'KeyR':  Timer.reset(); break;
    }
  });
}

// ─────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Timer.setPhase('focus');
  UI.init();
  Confetti.init();
  bindEvents();

  console.log('%c🎯 FlowState loaded', 'color: #6c63ff; font-size: 14px; font-weight: bold;');
  console.log('%cKeyboard: Space = Start/Pause, R = Reset', 'color: #00d4ff; font-size: 12px;');
});
