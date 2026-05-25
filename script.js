/**
 * FlowState — Premium Pomodoro Timer
 * Complete modular JS implementation
 * ================================================
 */

'use strict';

// ─────────────────────────────────────────────────
//  CONSTANTS & CONFIG
// ─────────────────────────────────────────────────
const QUOTES = [
  '"The secret of getting ahead is getting started." — Mark Twain',
  '"Focus is a matter of deciding what things you\'re not going to do." — John Carmack',
  '"The successful warrior is the average man with laser-like focus." — Bruce Lee',
  '"Where focus goes, energy flows." — Tony Robbins',
  '"Your mind is for having ideas, not holding them." — David Allen',
  '"Deep work is the superpower of the 21st century." — Cal Newport',
  '"The ability to focus attention on important tasks is a defining characteristic of intelligence." — Robert Sheckley',
  '"Work like there is someone working 24 hours a day to take it all away from you." — Mark Cuban',
  '"It\'s not about having time, it\'s about making time." — Unknown',
  '"Do the hard jobs first. The easy jobs will take care of themselves." — Dale Carnegie',
  '"One thought, fully developed, is worth a thousand thoughts half-baked." — Unknown',
  '"The secret of your future is hidden in your daily routine." — Mike Murdock',
];

const ACHIEVEMENTS = [
  { id: 'first',    icon: '🌱', name: 'First Steps',    desc: 'Complete your first Pomodoro',   condition: s => s.total >= 1 },
  { id: 'streak3',  icon: '🔥', name: 'On Fire',        desc: '3-day streak',                  condition: s => s.streak >= 3 },
  { id: 'ten',      icon: '🎯', name: 'Sharp Focus',    desc: 'Complete 10 Pomodoros',          condition: s => s.total >= 10 },
  { id: 'hour',     icon: '⏳', name: 'Time Master',    desc: 'Accumulate 2 hours of focus',    condition: s => s.totalMinutes >= 120 },
  { id: 'fifty',    icon: '🏆', name: 'Champion',       desc: 'Complete 50 Pomodoros',          condition: s => s.total >= 50 },
  { id: 'week',     icon: '📅', name: 'Week Warrior',   desc: '7-day streak',                   condition: s => s.streak >= 7 },
  { id: 'century',  icon: '💯', name: 'Century Club',   desc: 'Complete 100 Pomodoros',         condition: s => s.total >= 100 },
];

const RING_CIRCUMFERENCE = 2 * Math.PI * 140; // 879.65

// ─────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────
let state = {
  phase: 'focus',          // 'focus' | 'short' | 'long'
  running: false,
  muted: false,
  secondsLeft: 25 * 60,
  totalSeconds: 25 * 60,
  pomodoroCount: 0,        // within current cycle (0-3)
  sessionInProgress: false,
  ambientSound: null,
  focusModeActive: false,
  settings: {
    focusDuration:  25,
    shortBreak:     5,
    longBreak:      15,
    autoBreak:      false,
    autoFocus:      false,
    alarmVolume:    80,
    ambientVolume:  30,
    theme:          'cyber',
  },
  stats: {
    total:         0,
    totalMinutes:  0,
    todayPomodoros: 0,
    todayMinutes:  0,
    lastDate:      '',
    streak:        0,
    lastStreakDate:'',
    weekData:      [0,0,0,0,0,0,0],  // Sun-Sat
    history:       [],               // [{type, task, time}]
    tasks:         [],               // [{id, text, done}]
  },
};

let timerInterval = null;
let audioCtx = null;
let ambientNode = null;

// ─────────────────────────────────────────────────
//  AUDIO MODULE
// ─────────────────────────────────────────────────
const Audio = {
  getCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  },

  /** Play a premium multi-tone alarm for 2 seconds */
  playAlarm() {
    if (state.muted) return;
    const ctx = this.getCtx();
    const vol = state.settings.alarmVolume / 100;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(vol * 0.6, ctx.currentTime + 0.08);
    master.gain.setValueAtTime(vol * 0.6, ctx.currentTime + 1.6);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.0);
    master.connect(ctx.destination);

    // Three harmonically related tones
    [[528, 0], [660, 0.04], [792, 0.08]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      g.gain.setValueAtTime(0, ctx.currentTime + delay);
      g.gain.linearRampToValueAtTime(1, ctx.currentTime + delay + 0.08);
      osc.connect(g);
      g.connect(master);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + 2.0);
    });
  },

  /** Soft click for interactions */
  playClick() {
    if (state.muted) return;
    const ctx = this.getCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = 800;
    osc.type = 'sine';
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  },

  /** Generate ambient sound via oscillators / noise */
  playAmbient(type, volume) {
    this.stopAmbient();
    if (!type || type === 'off') return;
    const ctx = this.getCtx();
    const masterGain = ctx.createGain();
    masterGain.gain.value = volume / 100 * 0.4;
    masterGain.connect(ctx.destination);
    ambientNode = masterGain;

    if (type === 'whitenoise' || type === 'rain' || type === 'forest' || type === 'cafe' || type === 'keys') {
      // Noise-based sounds using BufferSource
      const bufferSize = ctx.sampleRate * 4;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      // Apply different filter characters per sound type
      const filter = ctx.createBiquadFilter();
      if (type === 'rain') {
        filter.type = 'bandpass'; filter.frequency.value = 1200; filter.Q.value = 0.3;
        masterGain.gain.value = volume / 100 * 0.25;
      } else if (type === 'forest') {
        filter.type = 'lowpass'; filter.frequency.value = 600;
        masterGain.gain.value = volume / 100 * 0.2;
      } else if (type === 'cafe') {
        filter.type = 'bandpass'; filter.frequency.value = 800; filter.Q.value = 0.5;
        masterGain.gain.value = volume / 100 * 0.15;
      } else if (type === 'keys') {
        filter.type = 'highpass'; filter.frequency.value = 2000;
        masterGain.gain.value = volume / 100 * 0.08;
      } else {
        filter.type = 'lowpass'; filter.frequency.value = 3000;
        masterGain.gain.value = volume / 100 * 0.3;
      }

      source.connect(filter);
      filter.connect(masterGain);
      source.start();
      masterGain._source = source; // reference for stopping
    }
  },

  stopAmbient() {
    if (ambientNode) {
      try {
        if (ambientNode._source) ambientNode._source.stop();
        ambientNode.disconnect();
      } catch(e) {}
      ambientNode = null;
    }
  },

  setAmbientVolume(vol) {
    if (ambientNode) ambientNode.gain.value = vol / 100 * 0.4;
  },
};

// ─────────────────────────────────────────────────
//  STORAGE MODULE
// ─────────────────────────────────────────────────
const Store = {
  load() {
    try {
      const saved = localStorage.getItem('flowstate_data');
      if (saved) {
        const parsed = JSON.parse(saved);
        state.settings = { ...state.settings, ...parsed.settings };
        state.stats    = { ...state.stats,    ...parsed.stats };
      }
    } catch(e) { console.warn('Failed to load state', e); }
    this.checkDayReset();
  },

  save() {
    try {
      localStorage.setItem('flowstate_data', JSON.stringify({
        settings: state.settings,
        stats: state.stats,
      }));
    } catch(e) { console.warn('Failed to save state', e); }
  },

  checkDayReset() {
    const today = new Date().toDateString();
    if (state.stats.lastDate !== today) {
      // New day — reset daily counters, update streak
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      if (state.stats.lastStreakDate === yesterday) {
        state.stats.streak++;
      } else if (state.stats.lastDate !== today) {
        state.stats.streak = 0;
      }
      state.stats.todayPomodoros = 0;
      state.stats.todayMinutes   = 0;
      state.stats.lastDate       = today;
      this.save();
    }
  },

  clear() {
    localStorage.removeItem('flowstate_data');
    state.stats = {
      total:0, totalMinutes:0, todayPomodoros:0, todayMinutes:0,
      lastDate:'', streak:0, lastStreakDate:'',
      weekData:[0,0,0,0,0,0,0], history:[], tasks:[],
    };
    this.save();
  }
};

// ─────────────────────────────────────────────────
//  NOTIFICATIONS MODULE
// ─────────────────────────────────────────────────
const Notif = {
  permission: 'default',

  async request() {
    if ('Notification' in window) {
      this.permission = await Notification.requestPermission();
    }
  },

  send(title, body) {
    if (this.permission === 'granted') {
      new Notification(title, { body, icon: 'assets/icons/icon-192.png' });
    } else {
      UI.showAlert(`${title} — ${body}`);
    }
  }
};

// ─────────────────────────────────────────────────
//  TIMER MODULE
// ─────────────────────────────────────────────────
const Timer = {
  getDuration(phase) {
    if (phase === 'focus') return state.settings.focusDuration * 60;
    if (phase === 'short') return state.settings.shortBreak * 60;
    return state.settings.longBreak * 60;
  },

  setPhase(phase) {
    state.phase = phase;
    state.secondsLeft = this.getDuration(phase);
    state.totalSeconds = state.secondsLeft;
    state.running = false;
    document.body.dataset.phase = phase;
    UI.renderTimer();
    UI.updatePhaseTabs();
    UI.updateSessionDots();
  },

  start() {
    if (state.running) return;
    // Clear any stale interval before starting
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    state.running = true;
    state.sessionInProgress = true;

    if (state.phase === 'focus') {
      Notif.request().then(() => {
        Notif.send('Focus session started', 'Stay productive. You got this 💪');
      });
      UI.setQuote(QUOTES[Math.floor(Math.random() * QUOTES.length)]);
    }

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
    Timer.pause();
    state.secondsLeft = Timer.getDuration(state.phase);
    state.totalSeconds = state.secondsLeft;
    UI.renderTimer();
  },

  tick() {
    if (state.secondsLeft <= 0) {
      Timer.complete();
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

    Audio.playAlarm();

    if (state.phase === 'focus') {
      state.stats.total++;
      state.stats.todayPomodoros++;
      state.stats.totalMinutes += state.settings.focusDuration;
      state.stats.todayMinutes += state.settings.focusDuration;
      state.stats.lastStreakDate = new Date().toDateString();

      const dayIdx = new Date().getDay();
      state.stats.weekData[dayIdx] = (state.stats.weekData[dayIdx] || 0) + 1;

      state.stats.history.unshift({
        type: 'focus',
        task: document.getElementById('currentTask').value || 'Focus session',
        time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
      });
      if (state.stats.history.length > 50) state.stats.history.pop();

      state.pomodoroCount++;
      Store.save();

      Notif.send('Great work!', 'Time for a well-deserved break 🎉');

      const nextPhase = (state.pomodoroCount % 4 === 0) ? 'long' : 'short';

      if (state.pomodoroCount % 4 === 0) {
        Confetti.burst();
      }

      UI.updateAllStats();
      UI.addHistoryItem({ type: 'focus', task: state.stats.history[0].task, time: state.stats.history[0].time });
      UI.checkAchievements();

      if (state.settings.autoBreak) {
        Timer.setPhase(nextPhase);
        Timer.start();
      } else {
        Timer.setPhase(nextPhase);
        UI.renderTimer();
      }

    } else {
      Notif.send('Break over!', 'Ready to get back in the zone? 🎯');

      state.stats.history.unshift({
        type: 'break',
        task: 'Break',
        time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
      });
      UI.addHistoryItem({ type: 'break', task: 'Break', time: state.stats.history[0].time });

      if (state.settings.autoFocus) {
        Timer.setPhase('focus');
        Timer.start();
      } else {
        document.getElementById('breakOverlay').classList.add('active');
      }
    }
  },

  skip() {
    Audio.playClick();
    Timer.pause();
    if (state.phase === 'focus') {
      const nextPhase = (state.pomodoroCount % 4 === 0 && state.pomodoroCount > 0) ? 'long' : 'short';
      Timer.setPhase(nextPhase);
    } else {
      Timer.setPhase('focus');
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
  running: false,
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
    if (!this.running) this.animate();
  },

  animate() {
    this.running = true;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.particles = this.particles.filter(p => p.life > 0);

    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1; // gravity
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
      this.running = false;
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
    this.updateAllStats();
    this.renderTasks();
    this.renderHistory();
    this.renderWeeklyChart();
    this.renderAchievements();
    this.applySettings();
    this.updateSessionDots();
  },

  buildTickMarks() {
    const g = document.getElementById('tickMarks');
    const cx = 160, cy = 160, r = 140;
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
      const isMajor = i % 5 === 0;
      const inner = r - (isMajor ? 12 : 7);
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + inner * Math.cos(angle);
      const y2 = cy + inner * Math.sin(angle);
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      if (isMajor) line.classList.add('tick-major');
      g.appendChild(line);
    }
  },

  renderTimer() {
    const m = Math.floor(state.secondsLeft / 60).toString().padStart(2,'0');
    const s = (state.secondsLeft % 60).toString().padStart(2,'0');
    const timeStr = `${m}:${s}`;

    document.getElementById('timerDisplay').textContent = timeStr;
    document.getElementById('focusTimerDisplay').textContent = timeStr;

    // Progress ring
    const progress = 1 - (state.secondsLeft / state.totalSeconds);
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    document.getElementById('ringProgress').style.strokeDashoffset = offset;

    // Update document title
    const phaseNames = { focus: '🎯 Focus', short: '☕ Break', long: '🌿 Long Break' };
    document.title = `${timeStr} — ${phaseNames[state.phase]} | FlowState`;
  },

  updateStartBtn() {
    const icon = document.getElementById('startBtnIcon');
    const text = document.getElementById('startBtnText');
    const focusBtn = document.getElementById('focusStartBtn');

    if (state.running) {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
      text.textContent = 'Pause';
      focusBtn.textContent = '⏸';
    } else {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      text.textContent = 'Start';
      focusBtn.textContent = '▶';
    }
  },

  updatePhaseTabs() {
    document.querySelectorAll('.phase-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.phase === state.phase);
    });
    const labels = { focus: 'Focus Time', short: 'Short Break', long: 'Long Break' };
    document.getElementById('phaseLabel').textContent = labels[state.phase];
    document.getElementById('focusPhaseLabel').textContent = labels[state.phase];
  },

  updateSessionDots() {
    const dots = document.querySelectorAll('#sessionDots .dot');
    dots.forEach((dot, i) => {
      dot.classList.remove('active', 'completed');
      if (i < state.pomodoroCount % 4) dot.classList.add('completed');
      if (i === state.pomodoroCount % 4) dot.classList.add('active');
    });
  },

  setQuote(q) {
    const el = document.getElementById('focusQuote');
    const el2 = document.getElementById('focusModeQuote');
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = q; el.style.opacity = '1'; }, 300);
    el2.textContent = q;
  },

  updateAllStats() {
    document.getElementById('todayPomodoros').textContent = state.stats.todayPomodoros;
    document.getElementById('todayMinutes').textContent   = state.stats.todayMinutes;
    document.getElementById('totalPomodoros').textContent = state.stats.total;
    document.getElementById('streakCount').textContent    = state.stats.streak;
    // Stats view
    document.getElementById('statTotal').textContent  = state.stats.total;
    document.getElementById('statStreak').textContent = state.stats.streak;
    document.getElementById('statToday').textContent  = state.stats.todayPomodoros;
    const hrs = Math.floor(state.stats.totalMinutes / 60);
    const mins = state.stats.totalMinutes % 60;
    document.getElementById('statHours').textContent = `${hrs}h ${mins}m`;
    this.renderWeeklyChart();
    this.renderAchievements();
  },

  addHistoryItem(item) {
    const list = document.getElementById('historyList');
    const empty = list.querySelector('.history-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <span class="history-dot ${item.type !== 'focus' ? 'break' : ''}"></span>
      <span class="history-text">${escapeHtml(item.task)}</span>
      <span class="history-time">${item.time}</span>
    `;
    list.prepend(div);
    // Keep max 12 visible
    const items = list.querySelectorAll('.history-item');
    if (items.length > 12) items[items.length-1].remove();
  },

  renderHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    const today = new Date().toDateString();
    const todayItems = state.stats.history.filter(() => true).slice(0, 12);
    if (todayItems.length === 0) {
      list.innerHTML = '<div class="history-empty">No sessions yet today.</div>';
      return;
    }
    todayItems.forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <span class="history-dot ${item.type !== 'focus' ? 'break' : ''}"></span>
        <span class="history-text">${escapeHtml(item.task)}</span>
        <span class="history-time">${item.time}</span>
      `;
      list.appendChild(div);
    });
  },

  renderWeeklyChart() {
    const chart = document.getElementById('weeklyChart');
    chart.innerHTML = '';
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const maxVal = Math.max(...state.stats.weekData, 1);
    state.stats.weekData.forEach((val, i) => {
      const pct = (val / maxVal) * 100;
      const wrap = document.createElement('div');
      wrap.className = 'week-bar-wrap';
      wrap.innerHTML = `
        <div class="week-bar-bg">
          <div class="week-bar" style="height: ${pct}%; transition: height 1s ease ${i * 0.1}s;"></div>
        </div>
        <span class="week-label">${days[i]}</span>
      `;
      chart.appendChild(wrap);
    });
  },

  renderAchievements() {
    const grid = document.getElementById('achievementsGrid');
    grid.innerHTML = '';
    ACHIEVEMENTS.forEach(ach => {
      const unlocked = ach.condition(state.stats);
      const div = document.createElement('div');
      div.className = `achievement ${unlocked ? 'unlocked' : 'locked'}`;
      div.innerHTML = `
        <span class="ach-icon">${ach.icon}</span>
        <div class="ach-info">
          <div class="ach-name">${ach.name}</div>
          <div class="ach-desc">${ach.desc}</div>
        </div>
      `;
      grid.appendChild(div);
    });
  },

  checkAchievements() {
    // Toast new unlock
    ACHIEVEMENTS.forEach(ach => {
      const key = `ach_${ach.id}_shown`;
      if (ach.condition(state.stats) && !localStorage.getItem(key)) {
        localStorage.setItem(key, '1');
        UI.showAlert(`🏆 Achievement Unlocked: ${ach.name}!`);
      }
    });
  },

  renderTasks() {
    const container = document.getElementById('tasksList');
    container.innerHTML = '';
    state.stats.tasks.forEach(task => {
      const div = document.createElement('div');
      div.className = `task-item ${task.done ? 'done' : ''}`;
      div.dataset.id = task.id;
      div.innerHTML = `
        <button class="task-check ${task.done ? 'checked' : ''}" data-id="${task.id}">
          ${task.done ? '✓' : ''}
        </button>
        <span class="task-text">${escapeHtml(task.text)}</span>
        <button class="task-delete" data-id="${task.id}" title="Delete">×</button>
      `;
      container.appendChild(div);
    });
  },

  addTask(text) {
    if (!text.trim()) return;
    const task = { id: Date.now().toString(), text: text.trim(), done: false };
    state.stats.tasks.push(task);
    Store.save();
    this.renderTasks();
  },

  toggleTask(id) {
    const task = state.stats.tasks.find(t => t.id === id);
    if (task) { task.done = !task.done; Store.save(); this.renderTasks(); }
  },

  deleteTask(id) {
    state.stats.tasks = state.stats.tasks.filter(t => t.id !== id);
    Store.save();
    this.renderTasks();
  },

  showAlert(text) {
    const el = document.getElementById('inAppAlert');
    document.getElementById('inAppAlertText').textContent = text;
    el.classList.add('visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('visible'), 4000);
  },

  applySettings() {
    document.getElementById('focusDuration').value = state.settings.focusDuration;
    document.getElementById('shortBreak').value    = state.settings.shortBreak;
    document.getElementById('longBreak').value     = state.settings.longBreak;
    document.getElementById('autoBreak').checked   = state.settings.autoBreak;
    document.getElementById('autoFocus').checked   = state.settings.autoFocus;
    document.getElementById('alarmVolume').value   = state.settings.alarmVolume;
    document.getElementById('ambientVolume').value = state.settings.ambientVolume;
    document.getElementById('alarmVolumeVal').textContent = `${state.settings.alarmVolume}%`;
    document.body.dataset.theme = state.settings.theme;
    // Sync theme pills
    document.querySelectorAll('.theme-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.theme === state.settings.theme);
    });
  },

  switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-pill').forEach(p => p.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');
    document.querySelector(`[data-view="${viewId}"]`).classList.add('active');
    if (viewId === 'stats') {
      this.updateAllStats();
    }
  },
};

// ─────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}

function exportStats() {
  const data = {
    exportDate: new Date().toISOString(),
    totalPomodoros: state.stats.total,
    totalFocusMinutes: state.stats.totalMinutes,
    streak: state.stats.streak,
    weekData: state.stats.weekData,
    recentHistory: state.stats.history.slice(0, 20),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `flowstate_stats_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
}

// ─────────────────────────────────────────────────
//  EVENT BINDINGS
// ─────────────────────────────────────────────────
function bindEvents() {

  // Nav pills → switch views
  document.querySelectorAll('.nav-pill').forEach(pill => {
    pill.addEventListener('click', () => UI.switchView(pill.dataset.view));
  });

  // Phase tabs
  document.querySelectorAll('.phase-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      Timer.setPhase(tab.dataset.phase);
      Audio.playClick();
    });
  });

  // Start/Pause — blur after click so Space key doesn't re-trigger the button
  document.getElementById('startBtn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    Timer.toggle();
  });
  document.getElementById('focusStartBtn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    Timer.toggle();
    UI.updateStartBtn();
  });

  // Reset & Skip — blur so Space doesn't re-trigger
  document.getElementById('resetBtn').addEventListener('click', (e) => { e.currentTarget.blur(); Timer.reset(); });
  document.getElementById('skipBtn').addEventListener('click',  (e) => { e.currentTarget.blur(); Timer.skip(); });

  // Mute
  document.getElementById('muteBtn').addEventListener('click', () => {
    state.muted = !state.muted;
    document.getElementById('muteBtn').classList.toggle('muted', state.muted);
    document.getElementById('muteIcon').innerHTML = state.muted
      ? `<path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`
      : `<path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M15.5 8.5c1.5 1.5 1.5 5.5 0 7M19 6c3 3 3 9 0 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`;
  });

  // Focus Mode
  document.getElementById('focusModeBtn').addEventListener('click', () => toggleFocusMode(true));
  document.getElementById('focusExitBtn').addEventListener('click', () => toggleFocusMode(false));

  // Settings
  document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsOverlay').classList.add('active');
  });
  document.getElementById('settingsClose').addEventListener('click', () => {
    document.getElementById('settingsOverlay').classList.remove('active');
  });
  document.getElementById('settingsOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('active');
  });

  // Num inputs (settings)
  document.querySelectorAll('.num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const delta = parseInt(btn.dataset.delta);
      const newVal = Math.max(parseInt(input.min), Math.min(parseInt(input.max), parseInt(input.value) + delta));
      input.value = newVal;
      input.dispatchEvent(new Event('change'));
    });
  });

  ['focusDuration','shortBreak','longBreak'].forEach(id => {
    document.getElementById(id).addEventListener('change', (e) => {
      state.settings[id] = parseInt(e.target.value) || parseInt(e.target.min);
      // If current phase matches changed setting, reset
      if (
        (id === 'focusDuration' && state.phase === 'focus') ||
        (id === 'shortBreak'    && state.phase === 'short') ||
        (id === 'longBreak'     && state.phase === 'long')
      ) {
        if (!state.running) Timer.reset();
      }
      Store.save();
    });
  });

  document.getElementById('autoBreak').addEventListener('change', e => {
    state.settings.autoBreak = e.target.checked; Store.save();
  });
  document.getElementById('autoFocus').addEventListener('change', e => {
    state.settings.autoFocus = e.target.checked; Store.save();
  });

  document.getElementById('alarmVolume').addEventListener('input', e => {
    state.settings.alarmVolume = parseInt(e.target.value);
    document.getElementById('alarmVolumeVal').textContent = `${e.target.value}%`;
    Store.save();
  });

  // Theme
  document.querySelectorAll('.theme-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.settings.theme = pill.dataset.theme;
      document.body.dataset.theme = pill.dataset.theme;
      document.querySelectorAll('.theme-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      Store.save();
    });
  });

  // Reset data
  document.getElementById('resetAllData').addEventListener('click', () => {
    if (confirm('Reset all statistics? This cannot be undone.')) {
      Store.clear();
      UI.updateAllStats();
      UI.renderTasks();
      UI.renderHistory();
    }
  });

  // Break modal
  document.getElementById('startFocusFromBreak').addEventListener('click', () => {
    document.getElementById('breakOverlay').classList.remove('active');
    Timer.setPhase('focus');
    Timer.start();
  });
  document.getElementById('skipFromBreak').addEventListener('click', () => {
    document.getElementById('breakOverlay').classList.remove('active');
    Timer.setPhase('focus');
  });

  // Ambient sounds
  document.querySelectorAll('.ambient-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ambient-btn').forEach(b => b.classList.remove('active'));
      const sound = btn.dataset.sound;
      if (sound === 'off' || sound === state.ambientSound) {
        state.ambientSound = null;
        Audio.stopAmbient();
        btn.classList.add('active-off');
      } else {
        state.ambientSound = sound;
        btn.classList.add('active');
        Audio.playAmbient(sound, state.settings.ambientVolume);
      }
    });
  });

  document.getElementById('ambientVolume').addEventListener('input', e => {
    state.settings.ambientVolume = parseInt(e.target.value);
    Audio.setAmbientVolume(state.settings.ambientVolume);
    Store.save();
  });

  // Task input
  document.getElementById('addTaskBtn').addEventListener('click', () => {
    const inp = document.getElementById('newTaskInput');
    UI.addTask(inp.value);
    inp.value = '';
    inp.focus();
  });
  document.getElementById('newTaskInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('addTaskBtn').click();
  });

  // Task list delegation
  document.getElementById('tasksList').addEventListener('click', e => {
    const check = e.target.closest('.task-check');
    const del   = e.target.closest('.task-delete');
    if (check) UI.toggleTask(check.dataset.id);
    if (del)   UI.deleteTask(del.dataset.id);
  });

  // Export
  document.getElementById('exportBtn').addEventListener('click', exportStats);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    // Skip if typing in an input
    if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
    switch(e.code) {
      case 'Space':       e.preventDefault(); Timer.toggle(); break;
      case 'KeyR':        Timer.reset(); break;
      case 'KeyF':        toggleFocusMode(!state.focusModeActive); break;
      case 'KeyS':        document.getElementById('settingsBtn').click(); break;
      case 'KeyM':        document.getElementById('muteBtn').click(); break;
      case 'Digit1':      UI.switchView('timer'); break;
      case 'Digit2':      UI.switchView('tasks'); break;
      case 'Digit3':      UI.switchView('stats'); break;
    }
  });

  // Click-outside close for modals
  document.getElementById('breakOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('active');
  });
}

function toggleFocusMode(on) {
  state.focusModeActive = on;
  const overlay = document.getElementById('focusOverlay');
  overlay.classList.toggle('active', on);
  if (on && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else if (!on && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  // Sync focus task
  const task = document.getElementById('currentTask').value;
  document.getElementById('focusTask').textContent = task ? `📌 ${task}` : '';
}

// ─────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Store.load();
  Timer.setPhase('focus');
  UI.init();
  UI.setQuote(QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  Confetti.init();
  bindEvents();

  // Request notification permission early
  if ('Notification' in window && Notification.permission === 'default') {
    // Don't auto-request — do it when user starts session
  }

  // Animate stats numbers on load
  setTimeout(() => {
    UI.renderWeeklyChart();
  }, 200);

  console.log('%c🎯 FlowState loaded', 'color: #6c63ff; font-size: 14px; font-weight: bold;');
  console.log('%cKeyboard shortcuts: Space, R, F, S, M, 1, 2, 3', 'color: #00d4ff; font-size: 12px;');
});