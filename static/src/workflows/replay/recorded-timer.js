const RECORDED_TIMER_SPEEDS = new Set([
  'recorded_1x',
  'recorded_2x',
  'recorded_5x',
  'recorded_10x',
  'recorded_max',
]);

export function syncRecordedReplayTimer(container, status = null, options = {}) {
  const state = getRecordedReplayTimerState(container);
  const now = performance.now();
  const nextStatus = status === null
    ? state.status
    : String(status || 'idle').toLowerCase();
  const nextSpeed = String(options.speed || getSelectedSpeed(container)).toLowerCase();
  const nextEnabled = RECORDED_TIMER_SPEEDS.has(nextSpeed);

  state.status = nextStatus;
  state.speed = nextSpeed;
  state.enabled = nextEnabled;

  if (!nextEnabled) {
    stopRecordedTimer(state, now, { accumulate: false });
    state.elapsedWallMs = 0;
    renderRecordedReplayTimer(container, state);
    return;
  }

  if (nextStatus === 'playing') {
    if (!state.running) {
      state.startedAt = now;
      state.running = true;
    }
    scheduleRecordedTimerFrame(container, state);
  } else {
    stopRecordedTimer(state, now, { accumulate: true });
    if (nextStatus === 'idle' || nextStatus === 'starting') {
      state.elapsedWallMs = 0;
    }
  }

  renderRecordedReplayTimer(container, state);
}

export function resetRecordedReplayTimer(container) {
  const state = getRecordedReplayTimerState(container);
  stopRecordedTimer(state, performance.now(), { accumulate: false });
  state.status = 'idle';
  state.elapsedWallMs = 0;
  state.startedAt = null;
  renderRecordedReplayTimer(container, state);
}

function getRecordedReplayTimerState(container) {
  if (!container.__replayRecordedTimerState) {
    container.__replayRecordedTimerState = {
      status: 'idle',
      speed: '',
      enabled: false,
      running: false,
      startedAt: null,
      elapsedWallMs: 0,
      frameId: null,
    };
  }
  return container.__replayRecordedTimerState;
}

function scheduleRecordedTimerFrame(container, state) {
  if (state.frameId !== null) return;
  state.frameId = requestAnimationFrame(() => {
    state.frameId = null;
    if (!container.isConnected) {
      stopRecordedTimer(state, performance.now(), { accumulate: false });
      return;
    }
    renderRecordedReplayTimer(container, state);
    if (state.running) {
      scheduleRecordedTimerFrame(container, state);
    }
  });
}

function stopRecordedTimer(state, now, { accumulate }) {
  if (state.running && accumulate) {
    accumulateRecordedElapsed(state, now);
  }
  state.running = false;
  state.startedAt = null;
  if (state.frameId !== null) {
    cancelAnimationFrame(state.frameId);
    state.frameId = null;
  }
}

function accumulateRecordedElapsed(state, now) {
  if (!state.running || state.startedAt === null || !state.enabled) return;
  const wallDeltaMs = Math.max(0, now - state.startedAt);
  state.elapsedWallMs += wallDeltaMs;
  state.startedAt = now;
}

function renderRecordedReplayTimer(container, state) {
  const timer = container.querySelector('#replayRecordedTimer');
  if (!timer) return;
  const visible = (
    state.enabled
    && state.status !== 'idle'
    && state.status !== 'starting'
  );
  if (!visible) {
    timer.hidden = true;
    timer.textContent = '';
    return;
  }
  const elapsedMs = getCurrentWallElapsedMs(state);
  timer.hidden = false;
  timer.textContent = formatTimerClock(elapsedMs);
}

function getCurrentWallElapsedMs(state) {
  let elapsedMs = Math.max(0, state.elapsedWallMs);
  if (state.running && state.startedAt !== null && state.enabled) {
    elapsedMs += Math.max(0, performance.now() - state.startedAt);
  }
  return elapsedMs;
}

function getSelectedSpeed(container) {
  return container.querySelector('#speedSelect')?.value || '';
}

function formatTimerClock(valueMs) {
  if (!Number.isFinite(valueMs)) return '--:--.-';
  const totalTenths = Math.max(0, Math.floor(valueMs / 100));
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${mm}:${ss}.${tenths}`;
  }
  return `${mm}:${ss}.${tenths}`;
}
