import { api, ReplayWebSocket } from '../../api-client.js';
import { escapeHtml } from '../../shared/ui-helpers.js';
import { resetReplayMetricsState } from './metrics.js';
import { resetRecordedReplayTimer, syncRecordedReplayTimer } from './recorded-timer.js';
import { handleReplayWebSocketMessage } from './socket-handler.js';
import { clearReplayView, setSampleFileSelection } from './transcript.js';
import { setStatusBadge, syncSelectTitle } from './ui.js';

export function createReplaySessionControls(options) {
  const {
    container,
    sampleFileSelect,
    startBtn,
    pauseBtn,
    resetBtn,
    exportFinalLink,
    policySelect,
    modelSelect,
    correctionModelSelect,
    defaultFirstPassPromptId,
    defaultSecondPassPromptId,
    defaultSamplePath,
    getCurrentPolicy,
    getCurrentSpeed,
    getCurrentSourceLanguage,
    getCurrentTargetLanguage,
    getCurrentModel,
    updateModelDisplay,
    updateCorrectionModelDisplay,
    updatePolicyDisplay,
    updateParamsDisplay,
    updateFirstPassPromptDisplay,
    updateSecondPassPromptDisplay,
    updateSourceLanguageDisplay,
    updateTargetLanguageDisplay,
    getCurrentFirstPassPromptId,
    getCurrentSecondPassPromptId,
    applyFirstPassPromptToSession,
    applySecondPassPromptToSession,
    applyFirstPassLanguagesToSession,
  } = options;

  let ws = null;
  let sessionId = null;
  let isStarting = false;
  let totalEvents = 0;
  let currentEventIndex = '-';
  let currentStatus = 'idle';
  let currentSamplePath = defaultSamplePath;
  let replaySampleFiles = [];
  let isResetUiState = false;

  container.__replaySampleFiles = replaySampleFiles;

  sampleFileSelect.addEventListener('change', async () => {
    const nextPath = String(sampleFileSelect.value || '').trim();
    if (!nextPath || nextPath === currentSamplePath) {
      syncSelectTitle(sampleFileSelect);
      return;
    }

    if (sessionId) {
      try {
        if (currentStatus === 'playing') {
          await api.pauseReplay(sessionId);
        }
        await api.resetReplay(sessionId);
      } catch (err) {
        console.error('Failed to reset before sample switch:', err);
      }
      closeSocket();
      sessionId = null;
      totalEvents = 0;
      currentEventIndex = '-';
      currentStatus = 'idle';
      isStarting = false;
      isResetUiState = false;
      resetRecordedReplayTimer(container);
      clearReplayView(container);
      updateButtonStates('idle');
    }

    currentSamplePath = nextPath;
    setSampleFileSelection(container, currentSamplePath, defaultSamplePath);
    syncSelectTitle(sampleFileSelect);
  });

  startBtn.addEventListener('click', async () => {
    if (!sessionId) {
      try {
        const samplePath = currentSamplePath;
        const result = await api.createSession(samplePath);
        sessionId = result.session_id;
        updateFirstPassPromptDisplay(
          result.first_pass_prompt_id || getCurrentFirstPassPromptId()
        );
        updateSecondPassPromptDisplay(
          result.second_pass_prompt_id || getCurrentSecondPassPromptId()
        );

        currentSamplePath = setSampleFileSelection(container, samplePath, defaultSamplePath);
        resetReplayMetricsState(container);
        resetRecordedReplayTimer(container);

        await api.setReplayPolicy(sessionId, getCurrentPolicy());
        await api.setSpeed(sessionId, getCurrentSpeed());
        const selectedModel = getCurrentModel();
        await api.setModel(sessionId, selectedModel);
        const selectedCorrectionModel = correctionModelSelect.value;
        await api.setCorrectionModel(sessionId, selectedCorrectionModel);
        await applyFirstPassPromptToSession(sessionId, getCurrentFirstPassPromptId());
        await applySecondPassPromptToSession(sessionId, getCurrentSecondPassPromptId());
        await applyFirstPassLanguagesToSession(sessionId, {
          sourceLanguage: getCurrentSourceLanguage(),
          targetLanguage: getCurrentTargetLanguage(),
        });
        updateCorrectionModelDisplay(selectedCorrectionModel);

        ws = new ReplayWebSocket(sessionId, (msg) => {
          handleReplayWebSocketMessage(msg, {
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
            getTotalEvents: () => totalEvents,
            setTotalEvents: (val) => { totalEvents = val; },
            getCurrentEventIndex: () => currentEventIndex,
            setCurrentEventIndex: (val) => { currentEventIndex = val; },
            getResetUiState: () => isResetUiState,
            setResetUiState: (val) => { isResetUiState = val; },
            defaultFirstPassPromptId,
            defaultSecondPassPromptId,
            defaultSamplePath,
          });
        });
        ws.connect();

        isStarting = true;
        updateButtonStates('starting');

        setTimeout(async () => {
          try {
            await api.startReplay(sessionId);
          } catch (err) {
            isStarting = false;
            updateButtonStates('idle');
            throw err;
          }
        }, 500);
      } catch (err) {
        console.error('Failed to start:', err);
        alert('Failed to start: ' + err.message);
        updateButtonStates('idle');
      }
      return;
    }

    try {
      if (currentStatus === 'completed') {
        resetReplayMetricsState(container);
        resetRecordedReplayTimer(container);
        clearReplayView(container);
        currentEventIndex = '-';
        isResetUiState = false;
      }
      isStarting = true;
      updateButtonStates('starting');
      await api.startReplay(sessionId);
    } catch (err) {
      console.error('Failed to resume:', err);
      alert('Failed to resume: ' + err.message);
      isStarting = false;
      updateButtonStates(currentStatus || 'paused');
    }
  });

  pauseBtn.addEventListener('click', async () => {
    if (!sessionId) return;

    try {
      if (currentStatus === 'paused') {
        isStarting = true;
        updateButtonStates('starting');
        await api.startReplay(sessionId);
      } else {
        await api.pauseReplay(sessionId);
      }
    } catch (err) {
      console.error('Failed to toggle pause/resume:', err);
      isStarting = false;
      updateButtonStates(currentStatus || 'paused');
    }
  });

  resetBtn.addEventListener('click', async () => {
    if (!sessionId) return;

    try {
      isStarting = false;
      updateButtonStates('idle');
      resetReplayMetricsState(container);
      resetRecordedReplayTimer(container);

      await api.resetReplay(sessionId);
    } catch (err) {
      console.error('Failed to reset:', err);
      alert('Failed to reset: ' + err.message);
      updateButtonStates('idle');
    }
  });

  exportFinalLink.addEventListener('click', (event) => {
    event.preventDefault();
    if (!sessionId) return;
    window.open(`/api/replay/${sessionId}/export`, '_blank');
  });

  updateButtonStates('idle');

  return {
    getSessionId: () => sessionId,
    loadReplaySampleFiles,
  };

  function updateButtonStates(status, options = {}) {
    const fromWebSocket = options.fromWebSocket === true;
    const normalized = String(status || 'idle').toLowerCase();
    const hasSession = Boolean(sessionId);

    if (isStarting && fromWebSocket && normalized !== 'playing') {
      return;
    }

    if (isStarting && fromWebSocket && normalized === 'playing') {
      isStarting = false;
    }

    currentStatus = normalized;

    if (!hasSession) {
      startBtn.hidden = false;
      pauseBtn.hidden = true;
      resetBtn.hidden = true;
      exportFinalLink.hidden = true;
      pauseBtn.textContent = 'Pause';
      if (policySelect) policySelect.disabled = false;
      setStatusBadge(container, normalized);
      syncRecordedReplayTimer(container, normalized, { speed: getCurrentSpeed() });
      return;
    }

    if (policySelect) {
      policySelect.disabled = normalized !== 'idle';
    }

    if (normalized === 'starting') {
      startBtn.hidden = true;
      pauseBtn.hidden = true;
      pauseBtn.textContent = 'Pause';
      resetBtn.hidden = false;
      exportFinalLink.hidden = true;
    } else if (normalized === 'playing') {
      startBtn.hidden = true;
      pauseBtn.hidden = false;
      pauseBtn.textContent = 'Pause';
      resetBtn.hidden = false;
      exportFinalLink.hidden = true;
    } else if (normalized === 'paused') {
      startBtn.hidden = true;
      pauseBtn.hidden = false;
      pauseBtn.textContent = 'Resume';
      resetBtn.hidden = false;
      exportFinalLink.hidden = false;
    } else if (normalized === 'completed') {
      startBtn.hidden = false;
      pauseBtn.hidden = true;
      pauseBtn.textContent = 'Pause';
      resetBtn.hidden = false;
      exportFinalLink.hidden = false;
    } else {
      startBtn.hidden = false;
      pauseBtn.hidden = true;
      pauseBtn.textContent = 'Pause';
      resetBtn.hidden = true;
      exportFinalLink.hidden = true;
    }

    setStatusBadge(container, normalized === 'starting' ? 'playing' : normalized);
    syncRecordedReplayTimer(container, normalized, { speed: getCurrentSpeed() });
  }

  async function loadReplaySampleFiles() {
    if (sampleFileSelect) {
      sampleFileSelect.innerHTML = '<option value="">Loading samples...</option>';
      sampleFileSelect.disabled = true;
      syncSelectTitle(sampleFileSelect);
    }
    try {
      const result = await api.getReplaySamples();
      replaySampleFiles = Array.isArray(result?.samples) ? result.samples : [];
      container.__replaySampleFiles = replaySampleFiles;
      if (sampleFileSelect) {
        sampleFileSelect.innerHTML = replaySampleFiles.map((item) => (
          `<option value="${escapeHtml(item.path)}">${escapeHtml(item.name)}</option>`
        )).join('');
        sampleFileSelect.disabled = replaySampleFiles.length === 0;
      }
      currentSamplePath = setSampleFileSelection(container, currentSamplePath, defaultSamplePath);
    } catch (err) {
      console.error('Failed to load replay sample files:', err);
      replaySampleFiles = [];
      container.__replaySampleFiles = replaySampleFiles;
      if (sampleFileSelect) {
        sampleFileSelect.innerHTML = '<option value="">Samples unavailable</option>';
        sampleFileSelect.disabled = true;
        syncSelectTitle(sampleFileSelect);
      }
    }
  }

  function closeSocket() {
    if (ws?.ws) {
      try {
        ws.ws.close();
      } catch {}
    }
    ws = null;
  }
}
