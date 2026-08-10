// background.js
// Service worker — owns the "source of truth" for timer state.
// Manifest V3 service workers get suspended after ~30s idle, so we
// never rely on setInterval here to track seconds. Instead we store
// an endTime timestamp, and anyone who needs "remaining seconds"
// just computes (endTime - Date.now()) on demand.

const STORAGE_KEY = 'focusflow_timer';

const DEFAULT_STATE = {
  isRunning: false,
  totalSeconds: 0,      // full duration of the current timer
  remainingSeconds: 0,  // snapshot used only while paused/stopped
  endTime: null,        // timestamp (ms) the timer will hit 0, while running
  task: '',
  showTime: true,
  showTask: true
};
// ── Clear timer on browser start or extension enable ─────
// We don't want stale timers persisting across sessions.

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.local.set({ [STORAGE_KEY]: { ...DEFAULT_STATE } });
  console.log('FocusFlow: timer cleared on browser start');
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ [STORAGE_KEY]: { ...DEFAULT_STATE } });
  chrome.alarms.clear('focusflow_complete');
  console.log('FocusFlow: timer cleared on install/enable');
});
// ── Helpers ──────────────────────────────────────────────

async function getState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || { ...DEFAULT_STATE };
}

async function setState(partialState) {
  const current = await getState();
  const updated = { ...current, ...partialState };
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
  return updated;
}

// Returns remaining seconds right now, whether running or paused.
function computeRemaining(state) {
  if (!state.isRunning || !state.endTime) {
    return state.remainingSeconds;
  }
  const msLeft = state.endTime - Date.now();
  return Math.max(0, Math.round(msLeft / 1000));
}

// ── Broadcast state to all tabs ──────────────────────────
// Called after any state change so content.js can react
// immediately without waiting for a poll cycle.

async function broadcastState() {
  const state = await getState();
  const stateWithRemaining = { ...state, remainingSeconds: computeRemaining(state) };

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'STATE_UPDATED',
        state: stateWithRemaining
      });
    } catch (e) {
      // Tab might not have content script (e.g. chrome:// pages)
    }
  }
}

// ── Message Handling ─────────────────────────────────────
// popup.js (and later content.js) send these actions.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // keep the message channel open for the async response
});

async function handleMessage(message) {
  switch (message.type) {

    case 'GET_STATE': {
      const state = await getState();
      return { ...state, remainingSeconds: computeRemaining(state) };
    }

    case 'START': {
      const state = await getState();
      // If there's no time left to resume, use the newly provided duration.
      let remaining = state.remainingSeconds > 0
        ? state.remainingSeconds
        : message.totalSeconds;

      const totalSeconds = state.remainingSeconds > 0
        ? state.totalSeconds
        : message.totalSeconds;

      if (!remaining || remaining <= 0) {
        return { ...state, remainingSeconds: computeRemaining(state) };
      }

      const endTime = Date.now() + remaining * 1000;

      const updated = await setState({
        isRunning: true,
        totalSeconds,
        remainingSeconds: remaining,
        endTime,
        task: message.task ?? state.task,
        showTime: message.showTime ?? state.showTime,
        showTask: message.showTask ?? state.showTask
      });

      scheduleCompletionAlarm(endTime);
      broadcastState();
      return { ...updated, remainingSeconds: computeRemaining(updated) };
    }

    case 'PAUSE': {
      const state = await getState();
      const remaining = computeRemaining(state);

      const updated = await setState({
        isRunning: false,
        remainingSeconds: remaining,
        endTime: null
      });

      chrome.alarms.clear('focusflow_complete');
      broadcastState();
      return updated;
    }

    case 'RESET': {
      chrome.alarms.clear('focusflow_complete');
      const updated = await setState({ ...DEFAULT_STATE });
      broadcastState();
      return updated;
    }

    case 'UPDATE_SETTINGS': {
      // Task text / toggle changes while not running (or live, while running)
      const updated = await setState({
        task: message.task,
        showTime: message.showTime,
        showTask: message.showTask
      });
      broadcastState();
      return updated;
    }

    default:
      return { error: 'Unknown message type: ' + message.type };
  }
}

// ── Completion Alarm ─────────────────────────────────────
// chrome.alarms survives service worker suspension, unlike setTimeout.
// We use it purely to know "the timer finished" even if nothing
// was open to notice via Date.now() polling.

function scheduleCompletionAlarm(endTime) {
  chrome.alarms.clear('focusflow_complete');
  chrome.alarms.create('focusflow_complete', { when: endTime });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'focusflow_complete') return;

  const state = await getState();
  await setState({
    isRunning: false,
    remainingSeconds: 0,
    endTime: null
  });

  broadcastState();

  // Placeholder for a future notification / sound / etc.
  console.log('FocusFlow: timer complete', state.task);
});
