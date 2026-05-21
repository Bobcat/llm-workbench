import {
  applyReplayTranslationOutcomeMetrics,
  resetReplayMetricsState,
} from './metrics.js';
import {
  applySourceTranscriptUpdate,
  applyTranscriptDelta,
  buildTranscriptHtml,
  getReplayTranscriptState,
  pinPanelToBottomIfEnabled,
  renderSourceTranscript,
  setSampleFileSelection,
} from './transcript.js';
import { setStatusBadge, syncSelectTitle } from './ui.js';

export function handleReplayWebSocketMessage(msg, options) {
  const {
    container,
    updateModelDisplay,
    updateCorrectionModelDisplay,
    updatePolicyDisplay,
    updateParamsDisplay,
    updateFirstPassPromptDisplay,
    updateSecondPassPromptDisplay,
    updateSourceLanguageDisplay,
    updateTargetLanguageDisplay,
    updateButtonStates,
    getTotalEvents,
    setTotalEvents,
    getCurrentEventIndex,
    setCurrentEventIndex,
    getResetUiState,
    setResetUiState,
    defaultFirstPassPromptId,
    defaultSecondPassPromptId,
    defaultSamplePath,
  } = options;

  if (msg.type === 'source_update') {
    const data = msg.data;
    if (data.status) {
      updateButtonStates(data.status, { fromWebSocket: true });
    }
    const isResetEvent = String(data.kind || '').toLowerCase() === 'reset';
    const transcriptState = getReplayTranscriptState(container);

    const sourceText = container.querySelector('#sourceText');
    if (sourceText) {
      applySourceTranscriptUpdate(transcriptState, data);
      renderSourceTranscript(container);
      pinPanelToBottomIfEnabled(sourceText.closest('.stage-panel'));
    }

    if (data.model) {
      updateModelDisplay(data.model);

      const modelSelect = container.querySelector('#modelSelect');
      if (modelSelect && data.model !== '(none)') {
        modelSelect.value = data.model;
      } else if (modelSelect && data.model === '(none)') {
        modelSelect.value = '';
      }
      syncSelectTitle(modelSelect);
    }

    setResetUiState?.(isResetEvent);

    const eventStat = container.querySelector('#eventStat');
    const kindStat = container.querySelector('#kindStat');
    const sourceRevisionStat = container.querySelector('#sourceRevisionStat');
    if (isResetEvent) {
      resetReplayMetricsState(container);
      setCurrentEventIndex?.('-');
      if (eventStat) eventStat.textContent = '-/-';
      if (kindStat) kindStat.textContent = '-';
      if (sourceRevisionStat) sourceRevisionStat.textContent = '0';

      const translatedStat = container.querySelector('#translatedStat');
      if (translatedStat) {
        translatedStat.textContent = '-';
        translatedStat.className = 'metric-value';
      }
      const timingStat = container.querySelector('#timingStat');
      if (timingStat) {
        timingStat.textContent = '- / -';
      }
      updateSourceTiming(container, null);
    } else {
      setCurrentEventIndex?.(data.event_index);
      if (eventStat) {
        const total = getTotalEvents?.() || '-';
        eventStat.textContent = `${data.event_index}/${total}`;
      }
      if (kindStat) {
        kindStat.textContent = data.kind ? String(data.kind) : '-';
      }
      if (sourceRevisionStat) {
        sourceRevisionStat.textContent = String(data.source_revision ?? 0);
      }
      updateSourceTiming(container, data.source_timing);
    }

    setStatusBadge(container, data.status || 'playing');
  } else if (msg.type === 'model_update') {
    if (msg.data.model) {
      updateModelDisplay(msg.data.model);

      const modelSelect = container.querySelector('#modelSelect');
      if (modelSelect) {
        if (msg.data.model === '(none)') {
          modelSelect.value = '';
        } else {
          modelSelect.value = msg.data.model;
        }
        syncSelectTitle(modelSelect);
      }
    }
  } else if (msg.type === 'second_pass_model_update') {
    const correctionModelSelect = container.querySelector('#correctionModelSelect');
    const model = String(msg.data?.second_pass_model || '');
    updateCorrectionModelDisplay(model);
    if (correctionModelSelect) {
      correctionModelSelect.value = model;
      syncSelectTitle(correctionModelSelect);
    }
  } else if (msg.type === 'policy_update') {
    const policy = String(msg.data?.policy || 'replay');
    updatePolicyDisplay(policy);
  } else if (msg.type === 'first_pass_languages_update') {
    updateSourceLanguageDisplay(String(msg.data?.source_language || 'English'));
    updateTargetLanguageDisplay(String(msg.data?.target_language || 'Dutch'));
  } else if (msg.type === 'state_update') {
    if (msg.data.status) {
      updateButtonStates(msg.data.status, { fromWebSocket: true });
      setStatusBadge(container, msg.data.status);
    }
  } else if (msg.type === 'target_update') {
    const data = msg.data;
    const transcriptState = getReplayTranscriptState(container);
    const targetText = container.querySelector('#targetText');
    if (targetText) {
      transcriptState.targetCommitted = applyTranscriptDelta(transcriptState.targetCommitted, data);
      targetText.innerHTML = buildTranscriptHtml({
        committed: transcriptState.targetCommitted,
        preview: String(data.preview || ''),
        emptyPlaceholder: '(waiting for translation)',
      });
      pinPanelToBottomIfEnabled(targetText.closest('.stage-panel'));
    }

    const translatedStat = container.querySelector('#translatedStat');
    const targetRevisionStat = container.querySelector('#targetRevisionStat');
    const isResetUiState = getResetUiState?.() === true;
    if (targetRevisionStat) {
      targetRevisionStat.textContent = String(data.target_revision ?? 0);
    }
    if (translatedStat && isResetUiState) {
      translatedStat.textContent = '-';
      translatedStat.className = 'metric-value';
    }

    const timingStat = container.querySelector('#timingStat');
    if (timingStat && isResetUiState) {
      timingStat.textContent = '- / -';
    }
  } else if (msg.type === 'translation_outcome') {
    const data = msg.data || {};
    const translatedStat = container.querySelector('#translatedStat');
    const timingStat = container.querySelector('#timingStat');
    const translated = Boolean(data.translated);
    if (translatedStat) {
      translatedStat.textContent = translated ? 'yes' : 'no';
      translatedStat.className = translated ? 'metric-value yes' : 'metric-value no';
    }
    if (timingStat && translated && data.wall_ms !== undefined) {
      const wallMs = Number(data.wall_ms);
      const llmGenMs = data.llm_gen_ms !== undefined && data.llm_gen_ms !== null
        ? Number(data.llm_gen_ms)
        : null;
      if (wallMs > 0 || llmGenMs !== null) {
        const wallText = wallMs.toFixed(1);
        const llmText = llmGenMs !== null ? llmGenMs.toFixed(1) : '-';
        timingStat.textContent = `${wallText} / ${llmText} ms`;
      }
    }
    applyReplayTranslationOutcomeMetrics(container, data);
  } else if (msg.type === 'session_info') {
    const data = msg.data;
    setTotalEvents?.(data.total_events);
    const eventStat = container.querySelector('#eventStat');
    if (eventStat) {
      const current = getCurrentEventIndex?.() ?? '-';
      eventStat.textContent = `${current}/${data.total_events}`;
    }
    const sourceRevisionStat = container.querySelector('#sourceRevisionStat');
    if (sourceRevisionStat && Object.prototype.hasOwnProperty.call(data, 'source_revision')) {
      sourceRevisionStat.textContent = String(data.source_revision ?? 0);
    }
    const targetRevisionStat = container.querySelector('#targetRevisionStat');
    if (targetRevisionStat && Object.prototype.hasOwnProperty.call(data, 'target_revision')) {
      targetRevisionStat.textContent = String(data.target_revision ?? 0);
    }
    setSampleFileSelection(container, data.file_path, defaultSamplePath);
    const correctionModelSelect = container.querySelector('#correctionModelSelect');
    if (correctionModelSelect && Object.prototype.hasOwnProperty.call(data, 'second_pass_model')) {
      const model = String(data.second_pass_model || '');
      correctionModelSelect.value = model;
      updateCorrectionModelDisplay(model);
      syncSelectTitle(correctionModelSelect);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'policy')) {
      updatePolicyDisplay(String(data.policy || 'replay'));
    }
    if (Object.prototype.hasOwnProperty.call(data, 'params')) {
      updateParamsDisplay(String(data.params || 'No active session.'));
    }
    if (Object.prototype.hasOwnProperty.call(data, 'first_pass_prompt_id')) {
      updateFirstPassPromptDisplay(String(data.first_pass_prompt_id || defaultFirstPassPromptId));
    }
    if (Object.prototype.hasOwnProperty.call(data, 'second_pass_prompt_id')) {
      updateSecondPassPromptDisplay(String(data.second_pass_prompt_id || defaultSecondPassPromptId));
    }
    if (Object.prototype.hasOwnProperty.call(data, 'source_language')) {
      updateSourceLanguageDisplay(String(data.source_language || 'English'));
    }
    if (Object.prototype.hasOwnProperty.call(data, 'target_language')) {
      updateTargetLanguageDisplay(String(data.target_language || 'Dutch'));
    }
  }

}

function updateSourceTiming(container, timing) {
  const metricsText = container.querySelector('#replaySourceTimingText');
  if (!metricsText) return;
  if (!timing || typeof timing !== 'object') {
    metricsText.textContent = 'Source timing appears here once replay events arrive.';
    metricsText.classList.add('is-placeholder');
    return;
  }
  const startMs = numberOrNull(timing.speech_start_ms);
  const endMs = numberOrNull(timing.speech_end_ms);
  const gapMs = numberOrNull(timing.source_gap_ms);
  const durationMs = numberOrNull(timing.source_duration_ms);
  const clockLabel = String(timing.clock_label || 'fixed delay');
  metricsText.classList.remove('is-placeholder');
  metricsText.textContent = [
    `Span: ${formatSourceClock(startMs)} - ${formatSourceClock(endMs)}`,
    `Gap: ${formatSourceDuration(gapMs)}`,
    `Progress: ${formatSourceDuration(endMs)} / ${formatSourceDuration(durationMs)}`,
    `Clock: ${clockLabel}`,
  ].join('\n');
}

function formatSourceClock(value) {
  if (!Number.isFinite(value)) return '-';
  const totalTenths = Math.max(0, Math.round(value / 100));
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

function formatSourceDuration(value) {
  if (!Number.isFinite(value)) return '-';
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  return `${Math.round(value)}ms`;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
