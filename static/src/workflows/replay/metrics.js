export function createReplayMetricsState() {
  return {
    executedCalls: 0,
    previewCalls: 0,
    commitCalls: 0,
    totals: {
      replayRequestWallMs: null,
      transportFirstByteMs: null,
      transportCompletedMs: null,
      engineQueueWaitMs: null,
      backendInferenceWallMs: null,
      engineTotalWallMs: null,
      engineOutsideBackendWallMs: null,
      poolTotalWallMs: null,
    },
    last: null,
  };
}

export function resetReplayMetricsState(container) {
  if (!container) return;
  container.__replayMetricsState = createReplayMetricsState();
  renderReplayMetrics(container);
}

export function applyReplayTranslationOutcomeMetrics(container, data) {
  if (!container || !data || typeof data !== 'object') return;
  if (Boolean(data.request_executed) !== true) return;
  const state = container.__replayMetricsState || createReplayMetricsState();
  const last = {
    eventKind: normalizeReplayEventKind(data.event_kind),
    applied: Boolean(data.translated),
    replayRequestWallMs: readReplayMetric(data, 'replay_request_wall_ms'),
    transportFirstByteMs: readReplayMetric(data, 'transport_first_byte_ms'),
    transportFirstTextDeltaMs: readReplayMetric(data, 'transport_first_text_delta_ms'),
    transportCompletedMs: readReplayMetric(data, 'transport_completed_ms'),
    engineQueueWaitMs: readReplayMetric(data, 'engine_queue_wait_ms'),
    backendInferenceWallMs: readReplayMetric(data, 'backend_inference_wall_ms'),
    engineTotalWallMs: readReplayMetric(data, 'engine_total_wall_ms'),
    engineOutsideBackendWallMs: readReplayMetric(data, 'engine_outside_backend_wall_ms'),
    poolTotalWallMs: readReplayMetric(data, 'pool_total_wall_ms'),
  };
  state.executedCalls += 1;
  if (last.eventKind === 'preview') {
    state.previewCalls += 1;
  } else if (last.eventKind === 'commit') {
    state.commitCalls += 1;
  }
  addReplayMetricTotal(state.totals, 'replayRequestWallMs', last.replayRequestWallMs);
  addReplayMetricTotal(state.totals, 'transportFirstByteMs', last.transportFirstByteMs);
  addReplayMetricTotal(state.totals, 'transportCompletedMs', last.transportCompletedMs);
  addReplayMetricTotal(state.totals, 'engineQueueWaitMs', last.engineQueueWaitMs);
  addReplayMetricTotal(state.totals, 'backendInferenceWallMs', last.backendInferenceWallMs);
  addReplayMetricTotal(state.totals, 'engineTotalWallMs', last.engineTotalWallMs);
  addReplayMetricTotal(state.totals, 'engineOutsideBackendWallMs', last.engineOutsideBackendWallMs);
  addReplayMetricTotal(state.totals, 'poolTotalWallMs', last.poolTotalWallMs);
  state.last = last;
  container.__replayMetricsState = state;
  renderReplayMetrics(container);
}

export function renderReplayMetrics(container) {
  const metricsText = container?.querySelector('#replayRunMetricsText');
  if (!metricsText) return;
  const state = container.__replayMetricsState || createReplayMetricsState();
  if (state.executedCalls <= 0) {
    metricsText.textContent = 'Run metrics appear here once LLM calls start arriving.';
    metricsText.classList.add('is-placeholder');
    return;
  }
  metricsText.classList.remove('is-placeholder');
  const inferenceTotalMs = finiteReplayMetric(state.totals.backendInferenceWallMs);
  const engineTotalMs = finiteReplayMetric(state.totals.engineTotalWallMs);
  const engineQueueMs = finiteReplayMetric(state.totals.engineQueueWaitMs);
  const engineNonInferenceMs = (
    finiteReplayMetric(state.totals.engineOutsideBackendWallMs)
    ?? deriveReplayExclusiveMs(engineTotalMs, inferenceTotalMs)
  );
  const poolTotalMs = finiteReplayMetric(state.totals.poolTotalWallMs);
  const poolNonEngineMs = deriveReplayExclusiveMs(poolTotalMs, engineTotalMs);
  const replayerWallMs = finiteReplayMetric(state.totals.replayRequestWallMs);
  const replayerNonPoolMs = deriveReplayExclusiveMs(replayerWallMs, poolTotalMs);
  const lines = [
    `LLM calls: ${state.executedCalls} | preview ${state.previewCalls} | commit ${state.commitCalls}`,
    'Timing notes:',
    '- percentages use Inference = 100%',
    formatReplayInferenceLine(inferenceTotalMs),
    formatReplayEngineLine(engineTotalMs, engineQueueMs, engineNonInferenceMs, inferenceTotalMs),
    formatReplayPoolLine(poolTotalMs, poolNonEngineMs, inferenceTotalMs),
    formatReplayReplayerLine(replayerWallMs, replayerNonPoolMs, inferenceTotalMs, state.executedCalls),
  ];
  if (state.last) {
    const lastInferenceMs = finiteReplayMetric(state.last.backendInferenceWallMs);
    const lastEngineTotalMs = finiteReplayMetric(state.last.engineTotalWallMs);
    const lastEngineQueueMs = finiteReplayMetric(state.last.engineQueueWaitMs);
    const lastEngineNonInferenceMs = (
      finiteReplayMetric(state.last.engineOutsideBackendWallMs)
      ?? deriveReplayExclusiveMs(lastEngineTotalMs, lastInferenceMs)
    );
    const lastPoolTotalMs = finiteReplayMetric(state.last.poolTotalWallMs);
    const lastPoolNonEngineMs = deriveReplayExclusiveMs(lastPoolTotalMs, lastEngineTotalMs);
    const lastReplayerWallMs = finiteReplayMetric(state.last.replayRequestWallMs);
    const lastReplayerNonPoolMs = deriveReplayExclusiveMs(lastReplayerWallMs, lastPoolTotalMs);
    lines.push(
      '',
      'Last LLM call',
      formatReplayInferenceLine(lastInferenceMs),
      formatReplayEngineLine(lastEngineTotalMs, lastEngineQueueMs, lastEngineNonInferenceMs, lastInferenceMs),
      formatReplayPoolLine(lastPoolTotalMs, lastPoolNonEngineMs, lastInferenceMs),
      formatReplayReplayerLine(lastReplayerWallMs, lastReplayerNonPoolMs, lastInferenceMs),
    );
  }
  metricsText.textContent = lines.join('\n');
}

function normalizeReplayEventKind(kind) {
  const normalized = String(kind || '').trim().toLowerCase();
  if (normalized === 'p' || normalized === 'preview') return 'preview';
  if (normalized === 'c' || normalized === 'commit') return 'commit';
  return normalized;
}

function readReplayMetric(data, key) {
  return finiteReplayMetric(data?.[key]);
}

function finiteReplayMetric(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function addReplayMetricTotal(target, key, value) {
  const numeric = finiteReplayMetric(value);
  if (!target || numeric === null) return;
  if (!Number.isFinite(Number(target[key]))) {
    target[key] = numeric;
    return;
  }
  target[key] = Number(target[key]) + numeric;
}

function deriveReplayExclusiveMs(outerMs, innerMs) {
  const outer = finiteReplayMetric(outerMs);
  const inner = finiteReplayMetric(innerMs);
  if (outer === null || inner === null) {
    return null;
  }
  return Math.max(0, outer - inner);
}

function formatReplayInferenceLine(inferenceMs) {
  return `Inference: wall ${formatReplayTimingMs(inferenceMs)}${formatReplayPctSuffix(inferenceMs, inferenceMs, {identity: true})}`;
}

function formatReplayEngineLine(engineTotalMs, engineQueueMs, engineNonInferenceMs, inferenceMs) {
  return [
    `Engine: wall ${formatReplayTimingMs(engineTotalMs)}${formatReplayPctSuffix(engineTotalMs, inferenceMs)}`,
    `queue ${formatReplayTimingMs(engineQueueMs)}`,
    `non-inference ${formatReplayTimingMs(engineNonInferenceMs)}`,
  ].join(' | ');
}

function formatReplayPoolLine(poolTotalMs, poolNonEngineMs, inferenceMs) {
  return [
    `Pool: wall ${formatReplayTimingMs(poolTotalMs)}${formatReplayPctSuffix(poolTotalMs, inferenceMs)}`,
    `non-engine ${formatReplayTimingMs(poolNonEngineMs)}`,
  ].join(' | ');
}

function formatReplayReplayerLine(replayerWallMs, replayerNonPoolMs, inferenceMs, callCount = null) {
  return [
    `Replayer: wall ${formatReplayTimingMs(replayerWallMs)}${formatReplayPctSuffix(replayerWallMs, inferenceMs)}`,
    `non-pool ${formatReplayTimingMs(replayerNonPoolMs)}${formatReplayPerCallSuffix(replayerNonPoolMs, callCount)}`,
  ].join(' | ');
}

function formatReplayPerCallSuffix(totalMs, callCount) {
  const total = finiteReplayMetric(totalMs);
  const count = finiteReplayMetric(callCount);
  if (total === null) return '';
  if (count === null || count <= 0) return '';
  const perCallMs = total / count;
  return ` (${formatReplayTimingMs(perCallMs)}/call)`;
}

function formatReplayTimingMs(valueMs) {
  const value = finiteReplayMetric(valueMs);
  if (value === null) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }
  if (abs >= 100) {
    return `${value.toFixed(0)}ms`;
  }
  return `${value.toFixed(1)}ms`;
}

function formatReplayTimingPct(valueMs, baseMs) {
  const value = finiteReplayMetric(valueMs);
  const base = finiteReplayMetric(baseMs);
  if (value === null || base === null || base <= 0) {
    return 'n/a';
  }
  return `${(value / base * 100).toFixed(1)}%`;
}

function formatReplayPctSuffix(valueMs, baseMs, options = {}) {
  const identity = options.identity === true;
  const value = finiteReplayMetric(valueMs);
  const base = finiteReplayMetric(baseMs);
  if (value === null || base === null || base <= 0) {
    return '';
  }
  if (identity && value > 0 && value === base) {
    return ' (100%)';
  }
  return ` (${formatReplayTimingPct(value, base)})`;
}
