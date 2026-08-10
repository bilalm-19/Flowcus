// popup.js
// Acts as a "remote control" — sends commands to background.js
// and polls it every second while open to update the preview.

const hrsInput = document.getElementById('hrs');
const minsInput = document.getElementById('mins');
const secsInput = document.getElementById('secs');
const taskInput = document.getElementById('taskInput');
const showTimeToggle = document.getElementById('showTime');
const showTaskToggle = document.getElementById('showTask');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const statusDot = document.getElementById('statusDot');
const previewFill = document.getElementById('previewFill');
const previewTime = document.getElementById('previewTime');
const previewTask = document.getElementById('previewTask');

let pollInterval = null;

// ── Normalize overflow (e.g. 75 secs → +1 min, 15 secs) ──

function normalizeTime() {
  let h = parseInt(hrsInput.value) || 0;
  let m = parseInt(minsInput.value) || 0;
  let s = parseInt(secsInput.value) || 0;

  if (s >= 60) {
    m += Math.floor(s / 60);
    s = s % 60;
  }
  if (m >= 60) {
    h += Math.floor(m / 60);
    m = m % 60;
  }

  h = Math.min(h, 99);

  hrsInput.value = h;
  minsInput.value = m;
  secsInput.value = s;

  return h * 3600 + m * 60 + s;
}

// ── Format seconds into readable string ──

function formatTime(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');

  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

// ── Render the popup preview from a state object ──

function renderState(state) {
  const { isRunning, totalSeconds, remainingSeconds, task, showTime, showTask } = state;

  // Progress bar
  const progress = totalSeconds > 0
    ? ((totalSeconds - remainingSeconds) / totalSeconds) * 100
    : 0;
  previewFill.style.width = (isRunning || remainingSeconds <= 0 ? progress : 0) + '%';

  // Done state
  if (totalSeconds > 0 && remainingSeconds <= 0) {
    previewFill.style.width = '100%';
    previewFill.style.background = 'linear-gradient(90deg, #56f9a2, #7c6af5)';
    startBtn.textContent = 'Done!';
    startBtn.disabled = true;
  } else {
    previewFill.style.background = '';
    startBtn.disabled = false;
  }

  // Time and task text
  previewTime.textContent = showTime ? formatTime(remainingSeconds ?? normalizeTime()) : '';
  previewTask.textContent = showTask ? task : '';

  // Button label
  if (isRunning) {
    startBtn.textContent = 'Pause';
    startBtn.classList.add('running');
    statusDot.classList.add('active');
    lockInputs(true);
  } else if (remainingSeconds > 0) {
    startBtn.textContent = 'Resume';
    startBtn.classList.remove('running');
    statusDot.classList.remove('active');
    lockInputs(true);
  } else if (totalSeconds > 0 && remainingSeconds <= 0) {
    // Done — already handled above
    lockInputs(true);
  } else {
    startBtn.textContent = 'Start';
    startBtn.classList.remove('running');
    statusDot.classList.remove('active');
    lockInputs(false);
  }
}

// ── Send a message to background.js ──

async function send(message) {
  return await chrome.runtime.sendMessage(message);
}

// ── Poll background every second while popup is open ──

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    const state = await send({ type: 'GET_STATE' });
    if (state) renderState(state);
  }, 1000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ── Lock / unlock inputs ──

function lockInputs(locked) {
  hrsInput.disabled = locked;
  minsInput.disabled = locked;
  secsInput.disabled = locked;
  document.querySelectorAll('.preset-btn').forEach(b => b.disabled = locked);
}

// ── Normalize on blur ──

[hrsInput, minsInput, secsInput].forEach(input => {
  input.addEventListener('blur', () => {
    normalizeTime();
    updateLocalPreview();
  });

  input.addEventListener('input', () => {
    updateLocalPreview();
  });
});

// Local preview update (only when timer is NOT running — just reflects input fields)
function updateLocalPreview() {
  const secs = normalizeTime();
  previewTime.textContent = showTimeToggle.checked ? formatTime(secs) : '';
  previewTask.textContent = showTaskToggle.checked ? taskInput.value : '';
}

taskInput.addEventListener('input', () => {
  updateLocalPreview();
  send({
    type: 'UPDATE_SETTINGS',
    task: taskInput.value,
    showTime: showTimeToggle.checked,
    showTask: showTaskToggle.checked
  });
});

showTimeToggle.addEventListener('change', () => {
  updateLocalPreview();
  send({
    type: 'UPDATE_SETTINGS',
    task: taskInput.value,
    showTime: showTimeToggle.checked,
    showTask: showTaskToggle.checked
  });
});

showTaskToggle.addEventListener('change', () => {
  updateLocalPreview();
  send({
    type: 'UPDATE_SETTINGS',
    task: taskInput.value,
    showTime: showTimeToggle.checked,
    showTask: showTaskToggle.checked
  });
});

// ── Presets ──

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const [m, s] = btn.dataset.time.split(':').map(Number);
    hrsInput.value = 0;
    minsInput.value = m;
    secsInput.value = s;
    normalizeTime();
    updateLocalPreview();
  });
});

// ── Start / Pause ──

startBtn.addEventListener('click', async () => {
  const state = await send({ type: 'GET_STATE' });

  if (state.isRunning) {
    // Pause
    const updated = await send({ type: 'PAUSE' });
    renderState(updated);
    stopPolling();
  } else {
    // Start or Resume
    const totalSeconds = normalizeTime();
    const updated = await send({
      type: 'START',
      totalSeconds,
      task: taskInput.value,
      showTime: showTimeToggle.checked,
      showTask: showTaskToggle.checked
    });
    renderState(updated);
    startPolling();
  }
});

// ── Reset ──

resetBtn.addEventListener('click', async () => {
  stopPolling();
  const updated = await send({ type: 'RESET' });
  renderState(updated);

  // Clear local inputs
  hrsInput.value = 0;
  minsInput.value = 25;
  secsInput.value = 0;
  taskInput.value = '';
  previewFill.style.width = '0%';
  previewFill.style.background = '';
  updateLocalPreview();
});

// ── Init: restore state from background on popup open ──

async function init() {
  const state = await send({ type: 'GET_STATE' });
  if (!state) return;

  renderState(state);

  // Restore input fields from saved state
  if (state.isRunning || state.remainingSeconds > 0) {
    const remaining = state.remainingSeconds;
    hrsInput.value = Math.floor(remaining / 3600);
    minsInput.value = Math.floor((remaining % 3600) / 60);
    secsInput.value = remaining % 60;
    taskInput.value = state.task || '';
    showTimeToggle.checked = state.showTime;
    showTaskToggle.checked = state.showTask;
    startPolling();
  } else {
    updateLocalPreview();
  }
}

init();