import { api } from '../../api-client.js';
import {
  normalizeTranslationLanguage as normalizeReplayLanguage,
} from '../../shared/translation-languages.js';
import { loadModelsAndSelectDefault } from './model-options.js';
import { syncRecordedReplayTimer } from './recorded-timer.js';
import { renderSourceTranscript } from './transcript.js';
import {
  getStoredReplaySourceLanguageSelection,
  getStoredReplayTargetLanguageSelection,
  initializeStoredPolicySelection,
  initializeStoredSpeedSelection,
  normalizePolicyForStorage,
  persistReplayPolicySelection,
  persistReplaySourceLanguageSelection,
  persistReplaySpeedSelection,
  persistReplayTargetLanguageSelection,
  persistReviserModelSelection,
  persistReviserModelSelectionOverride,
  persistTranslatorModelSelection,
  persistTranslatorModelSelectionOverride,
} from './preferences.js';
import { closeDialog, openDialog, syncSelectTitle } from './ui.js';

export function createReplayViewControls(options) {
  const {
    container,
    modelSelect,
    correctionModelSelect,
    replaySettingsBtn,
    replaySettingsDialog,
    replaySettingsSummary,
    closeReplaySettingsBtn,
    replayDevToggleBtn,
    replayDevSection,
    policySelect,
    speedSelect,
    sampleFileSelect,
    firstPassSourceLanguageSelect,
    firstPassTargetLanguageSelect,
    targetLanguageQuickSelect,
    getSessionId,
  } = options;

  let currentSpeed = 'normal';
  let currentModel = '(none)';
  let currentCorrectionModel = '';
  let currentSourceLanguage = normalizeReplayLanguage(getStoredReplaySourceLanguageSelection() || 'English');
  let currentTargetLanguage = normalizeReplayLanguage(getStoredReplayTargetLanguageSelection() || 'Dutch');
  let currentPolicy = 'replay';
  let currentParamsLabel = 'Loading replay settings...';
  let replayDevToolsOpen = false;

  initializeStoredSpeedSelection(speedSelect, (speed) => {
    currentSpeed = speed;
  });
  initializeStoredPolicySelection(policySelect, (policy) => {
    currentPolicy = policy;
  });

  loadModelsAndSelectDefault(
    container,
    (model) => {
      currentModel = model || '(none)';
    },
    (model) => {
      currentCorrectionModel = model || '';
    },
  );
  syncSelectTitle(modelSelect);
  syncSelectTitle(correctionModelSelect);
  syncSelectTitle(policySelect);
  syncSelectTitle(speedSelect);
  syncSelectTitle(sampleFileSelect);
  updateParamsDisplay(currentParamsLabel);
  updateReplayDevToolsVisibility();
  loadReplaySettingsSummary();

  if (replayDevToggleBtn) {
    replayDevToggleBtn.addEventListener('click', () => {
      replayDevToolsOpen = !replayDevToolsOpen;
      updateReplayDevToolsVisibility();
    });
  }

  modelSelect.addEventListener('change', async () => {
    const selectedModel = modelSelect.value;
    const sessionId = getSessionId();

    if (sessionId) {
      try {
        await api.setModel(sessionId, selectedModel);
        persistTranslatorModelSelectionOverride(true);
        updateModelDisplay(selectedModel || '(none)');
        syncSelectTitle(modelSelect);
      } catch (err) {
        console.error('Failed to set model:', err);
        modelSelect.value = currentModel === '(none)' ? '' : currentModel;
        syncSelectTitle(modelSelect);
      }
      return;
    }

    persistTranslatorModelSelectionOverride(true);
    currentModel = selectedModel || '(none)';
    updateModelDisplay(currentModel);
    syncSelectTitle(modelSelect);
  });

  correctionModelSelect.addEventListener('change', async () => {
    const selectedCorrectionModel = correctionModelSelect.value;
    const sessionId = getSessionId();

    if (sessionId) {
      try {
        await api.setCorrectionModel(sessionId, selectedCorrectionModel);
        persistReviserModelSelectionOverride(true);
        updateCorrectionModelDisplay(selectedCorrectionModel);
        syncSelectTitle(correctionModelSelect);
      } catch (err) {
        console.error('Failed to set correction model:', err);
        correctionModelSelect.value = currentCorrectionModel;
        syncSelectTitle(correctionModelSelect);
      }
      return;
    }

    persistReviserModelSelectionOverride(true);
    updateCorrectionModelDisplay(selectedCorrectionModel);
    syncSelectTitle(correctionModelSelect);
  });

  speedSelect.addEventListener('change', () => {
    void setSpeed(speedSelect.value);
  });

  policySelect.addEventListener('change', async () => {
    const previousPolicy = currentPolicy;
    try {
      await setPolicy(policySelect.value);
    } catch (err) {
      console.error('Failed to set policy:', err);
      alert('Failed to set policy: ' + err.message);
      updatePolicyDisplay(previousPolicy);
    }
  });

  replaySettingsBtn.addEventListener('click', () => {
    updateParamsDisplay(currentParamsLabel);
    openDialog(replaySettingsDialog);
  });

  closeReplaySettingsBtn.addEventListener('click', () => {
    closeDialog(replaySettingsDialog);
  });

  replaySettingsDialog.addEventListener('click', (event) => {
    if (event.target === replaySettingsDialog) {
      closeDialog(replaySettingsDialog);
    }
  });

  return {
    getCurrentSpeed: () => currentSpeed,
    getCurrentModel: () => currentModel,
    getCurrentCorrectionModel: () => currentCorrectionModel,
    getCurrentSourceLanguage: () => currentSourceLanguage,
    getCurrentTargetLanguage: () => currentTargetLanguage,
    getCurrentPolicy: () => currentPolicy,
    applyFirstPassPromptToSession,
    applySecondPassPromptToSession,
    applyFirstPassLanguagesToSession,
    updateModelDisplay,
    updateCorrectionModelDisplay,
    updatePolicyDisplay,
    updateParamsDisplay,
    updateSourceLanguageDisplay,
    updateTargetLanguageDisplay,
  };

  function updateModelDisplay(model) {
    currentModel = model;
    persistTranslatorModelSelection(currentModel);
  }

  function updatePolicyDisplay(policy) {
    currentPolicy = normalizePolicyForStorage(policy);
    persistReplayPolicySelection(currentPolicy);
    if (policySelect && policySelect.value !== currentPolicy) {
      policySelect.value = currentPolicy;
    }
    syncSelectTitle(policySelect);
  }

  function updateCorrectionModelDisplay(model) {
    currentCorrectionModel = model || '';
    persistReviserModelSelection(currentCorrectionModel);
  }

  function updateParamsDisplay(paramsLabel) {
    currentParamsLabel = String(paramsLabel || 'No active session.');
    if (replaySettingsSummary) {
      replaySettingsSummary.value = currentParamsLabel;
    }
  }

  function updateReplayDevToolsVisibility() {
    if (replayDevSection) {
      replayDevSection.hidden = !replayDevToolsOpen;
    }
    if (replayDevToggleBtn) {
      replayDevToggleBtn.textContent = replayDevToolsOpen ? 'Hide Dev Tools' : 'Dev Tools';
      replayDevToggleBtn.setAttribute('aria-expanded', replayDevToolsOpen ? 'true' : 'false');
      replayDevToggleBtn.title = replayDevToolsOpen ? 'Hide Dev Tools' : 'Dev Tools';
    }
  }

  function updateSourceLanguageDisplay(language) {
    currentSourceLanguage = normalizeReplayLanguage(language);
    persistReplaySourceLanguageSelection(currentSourceLanguage);
    if (firstPassSourceLanguageSelect && firstPassSourceLanguageSelect.value !== currentSourceLanguage) {
      firstPassSourceLanguageSelect.value = currentSourceLanguage;
    }
    syncSelectTitle(firstPassSourceLanguageSelect);
  }

  function updateTargetLanguageDisplay(language) {
    currentTargetLanguage = normalizeReplayLanguage(language);
    persistReplayTargetLanguageSelection(currentTargetLanguage);
    if (firstPassTargetLanguageSelect && firstPassTargetLanguageSelect.value !== currentTargetLanguage) {
      firstPassTargetLanguageSelect.value = currentTargetLanguage;
    }
    if (targetLanguageQuickSelect && targetLanguageQuickSelect.value !== currentTargetLanguage) {
      targetLanguageQuickSelect.value = currentTargetLanguage;
    }
    syncSelectTitle(firstPassTargetLanguageSelect);
    syncSelectTitle(targetLanguageQuickSelect);
  }

  async function setSpeed(speed) {
    currentSpeed = speed;
    persistReplaySpeedSelection(currentSpeed);
    const sessionId = getSessionId();

    if (speedSelect && speedSelect.value !== speed) {
      speedSelect.value = speed;
    }
    syncSelectTitle(speedSelect);
    syncRecordedReplayTimer(container, null, { speed: currentSpeed });
    renderSourceTranscript(container);

    if (!sessionId) {
      return;
    }

    try {
      await api.setSpeed(sessionId, speed);
    } catch (err) {
      console.error('Failed to set speed:', err);
    }
  }

  async function setPolicy(policy) {
    const normalized = normalizePolicyForStorage(policy);
    updatePolicyDisplay(normalized);
    const sessionId = getSessionId();

    if (!sessionId) {
      return;
    }

    const result = await api.setReplayPolicy(sessionId, normalized);
    if (result?.error) {
      throw new Error(result.error);
    }
    updatePolicyDisplay(result.policy || normalized);
  }

  async function loadReplaySettingsSummary() {
    try {
      const config = await api.getDefaultModel();
      updateParamsDisplay(String(config?.replay_params_label || 'Replay settings unavailable.'));
    } catch (err) {
      console.error('Failed to load replay settings summary:', err);
      updateParamsDisplay('Replay settings unavailable.');
    }
  }

  async function applyFirstPassPromptToSession(targetSessionId, promptId) {
    const result = await api.setFirstPassPrompt(targetSessionId, promptId);
    if (result?.error) {
      throw new Error(result.error);
    }
    return result;
  }

  async function applySecondPassPromptToSession(targetSessionId, promptId) {
    const result = await api.setSecondPassPrompt(targetSessionId, promptId);
    if (result?.error) {
      throw new Error(result.error);
    }
    return result;
  }

  async function applyFirstPassLanguagesToSession(targetSessionId, { sourceLanguage, targetLanguage }) {
    const result = await api.setFirstPassLanguages(targetSessionId, {
      source_language: normalizeReplayLanguage(sourceLanguage),
      target_language: normalizeReplayLanguage(targetLanguage),
    });
    if (result?.error) {
      throw new Error(result.error);
    }
    updateSourceLanguageDisplay(result.source_language || sourceLanguage);
    updateTargetLanguageDisplay(result.target_language || targetLanguage);
    return result;
  }
}
