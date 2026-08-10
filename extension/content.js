// content.js
// Injected into every webpage. Creates the visible bar element,
// then polls background.js every second for the current timer state
// and redraws the bar accordingly.

let bar = null;
let fill = null;
let taskLabel = null;
let timeLabel = null;
let pollInterval = null;

// ── Build the bar DOM ────────────────────────────────────

function createBar() {
  // Don't create duplicates if it already exists
  if (document.getElementById('focusflow-bar')) {
    bar = document.getElementById('focusflow-bar');
    fill = bar.querySelector('.ff-fill');
    taskLabel = bar.querySelector('.ff-task');
    timeLabel = bar.querySelector('.ff-time');
    return;
  }

  bar = document.createElement('div');
  bar.id = 'focusflow-bar';
  bar.classList.add('hidden'); // hidden until a timer is active

  // Task label (left side)
  taskLabel = document.createElement('span');
  taskLabel.className = 'ff-task';

  // Progress track + fill
  const track = document.createElement('div');
  track.className = 'ff-track';

  fill = document.createElement('div');
  fill.className = 'ff-fill';
  track.appendChild(fill);

  // Time label (right side)
  timeLabel = document.createElement('span');
  timeLabel.className = 'ff-time';

  // Assemble: [ task | ===track=== | time ]
  bar.appendChild(taskLabel);
  bar.appendChild(track);
  bar.appendChild(timeLabel);

  // Inject into the page body
  document.body.appendChild(bar);
  console.log('FocusFlow: bar injected into page');
}

// ── Format seconds into h:mm:ss or mm:ss ─────────────────

function formatTime(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');

  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

// ── Update the bar with current state ────────────────────

function updateBar(state) {
  if (!bar) return;

  const { isRunning, totalSeconds, remainingSeconds, task, showTime, showTask } = state;

  // Show or hide the entire bar
  const timerActive = isRunning || (totalSeconds > 0 && remainingSeconds >= 0);

  if (!timerActive || totalSeconds <= 0) {
    bar.classList.add('hidden');
    document.documentElement.classList.remove('focusflow-active');
    return;
  }

  bar.classList.remove('hidden');
  document.documentElement.classList.add('focusflow-active');

  // Progress (fills left to right as time passes)
  const elapsed = totalSeconds - remainingSeconds;
  const progress = (elapsed / totalSeconds) * 100;
  fill.style.width = Math.min(progress, 100) + '%';

  // Done state
  if (remainingSeconds <= 0) {
    fill.classList.add('done');
  } else {
    fill.classList.remove('done');
  }

  // Task text
  taskLabel.textContent = showTask ? task : '';

  // Time text
  timeLabel.textContent = showTime ? formatTime(remainingSeconds) : '';
}

// ── Poll background.js every second ──────────────────────

function startPolling() {
  if (pollInterval) return; // already polling

  pollInterval = setInterval(async () => {
    try {
      const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      updateBar(state);

      // Stop polling if timer is done and not running
      if (!state.isRunning && state.remainingSeconds <= 0 && state.totalSeconds <= 0) {
        stopPolling();
      }
    } catch (err) {
      // Extension context invalidated (e.g. extension was reloaded)
      console.log('FocusFlow: polling stopped —', err.message);
      stopPolling();
    }
  }, 1000);

  console.log('FocusFlow: polling started');
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ── Listen for direct messages from popup/background ─────
// This lets us react immediately to start/pause/reset
// without waiting for the next poll tick.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'STATE_UPDATED') {
    console.log('FocusFlow: received STATE_UPDATED', message.state.isRunning);
    updateBar(message.state);

    // Start polling if timer just started
    if (message.state.isRunning && !pollInterval) {
      startPolling();
    }
  }
});

// ── Init ─────────────────────────────────────────────────

function init() {
  console.log('FocusFlow: content.js init running');
  createBar();

  // Check state immediately on page load
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
    if (chrome.runtime.lastError) {
      console.log('FocusFlow: init GET_STATE failed —', chrome.runtime.lastError.message);
      return;
    }
    if (state) {
      console.log('FocusFlow: init state —', state.isRunning, state.remainingSeconds);
      updateBar(state);
      if (state.isRunning) {
        startPolling();
      }
    }
  });
}

// Wait for document.body to exist before injecting
if (document.body) {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}