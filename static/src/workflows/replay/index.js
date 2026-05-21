import { buildReplayMarkup, getReplayElements } from './dom.js';
import {
  refreshModelOptions,
} from './model-options.js';
import {
  renderReplayMetrics,
  createReplayMetricsState,
} from './metrics.js';
import { createReplayPromptDialog } from './prompt-dialog.js';
import { createReplaySessionControls } from './session-controls.js';
import { createReplayViewControls } from './view-controls.js';
import {
  bindSourceTimestampToggle,
  setupPanelAutoScroll,
} from './transcript.js';
import { attachDialogDrag, setStatusBadge, syncSelectTitle } from './ui.js';
import {
  populateTranslationLanguageSelect,
} from '../../shared/translation-languages.js';

const DEFAULT_FIRST_PASS_PROMPT_ID = 'translation/first-pass/current-default';
const DEFAULT_SECOND_PASS_PROMPT_ID = 'translation/second-pass/current-default';
const DEFAULT_SAMPLE_PATH = 'data/realtime_translation/sample/sample_p_c_120s.pc';

export function createReplayView() {
  const container = document.createElement('div');
  container.className = 'replay-view';
  container.innerHTML = buildReplayMarkup();

  container.__replayMetricsState = createReplayMetricsState();
  container.__modelOptionsInitialized = false;

  const {
    modelSelect,
    correctionModelSelect,
    firstPassPromptsBtn,
    firstPassPromptsDialog,
    firstPassPromptsDialogCard,
    firstPassPromptsDialogDragHandle,
    firstPassPromptTabBtn,
    secondPassPromptTabBtn,
    firstPassPromptSelect,
    firstPassPromptSystemPreview,
    firstPassPromptUserPreview,
    firstPassSourceLanguageSelect,
    firstPassTargetLanguageSelect,
    firstPassSourceLanguageHint,
    firstPassTargetLanguageHint,
    cancelFirstPassPromptBtn,
    applyFirstPassPromptBtn,
    replaySettingsBtn,
    replaySettingsDialog,
    replaySettingsDialogCard,
    replaySettingsDialogDragHandle,
    replaySettingsSummary,
    closeReplaySettingsBtn,
    replayDevToggleBtn,
    replayDevSection,
    policySelect,
    speedSelect,
    sampleFileSelect,
    targetLanguageQuickSelect,
    startBtn,
    pauseBtn,
    resetBtn,
    exportFinalLink,
    sourcePanel,
    targetPanel,
  } = getReplayElements(container);
  setStatusBadge(container, 'idle');
  setupPanelAutoScroll(sourcePanel);
  setupPanelAutoScroll(targetPanel);
  bindSourceTimestampToggle(container);
  renderReplayMetrics(container);
  let sessionControls = null;
  const viewControls = createReplayViewControls({
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
    getSessionId: () => sessionControls?.getSessionId() || null,
  });
  const promptDialog = createReplayPromptDialog({
    container,
    firstPassPromptsBtn,
    firstPassPromptsDialog,
    firstPassPromptTabBtn,
    secondPassPromptTabBtn,
    firstPassPromptSelect,
    firstPassPromptSystemPreview,
    firstPassPromptUserPreview,
    firstPassSourceLanguageSelect,
    firstPassTargetLanguageSelect,
    firstPassSourceLanguageHint,
    firstPassTargetLanguageHint,
    cancelFirstPassPromptBtn,
    applyFirstPassPromptBtn,
    targetLanguageQuickSelect,
    defaultFirstPassPromptId: DEFAULT_FIRST_PASS_PROMPT_ID,
    defaultSecondPassPromptId: DEFAULT_SECOND_PASS_PROMPT_ID,
    getSessionId: () => sessionControls?.getSessionId() || null,
    getCurrentSourceLanguage: viewControls.getCurrentSourceLanguage,
    getCurrentTargetLanguage: viewControls.getCurrentTargetLanguage,
    updateSourceLanguageDisplay: viewControls.updateSourceLanguageDisplay,
    updateTargetLanguageDisplay: viewControls.updateTargetLanguageDisplay,
    applyFirstPassPromptToSession: viewControls.applyFirstPassPromptToSession,
    applySecondPassPromptToSession: viewControls.applySecondPassPromptToSession,
    applyFirstPassLanguagesToSession: viewControls.applyFirstPassLanguagesToSession,
    populateLanguageSelect,
  });
  promptDialog.loadPromptRecords();
  sessionControls = createReplaySessionControls({
    container,
    sampleFileSelect,
    startBtn,
    pauseBtn,
    resetBtn,
    exportFinalLink,
    policySelect,
    modelSelect,
    correctionModelSelect,
    defaultFirstPassPromptId: DEFAULT_FIRST_PASS_PROMPT_ID,
    defaultSecondPassPromptId: DEFAULT_SECOND_PASS_PROMPT_ID,
    defaultSamplePath: DEFAULT_SAMPLE_PATH,
    getCurrentPolicy: viewControls.getCurrentPolicy,
    getCurrentSpeed: viewControls.getCurrentSpeed,
    getCurrentSourceLanguage: viewControls.getCurrentSourceLanguage,
    getCurrentTargetLanguage: viewControls.getCurrentTargetLanguage,
    getCurrentModel: () => modelSelect.value,
    updateModelDisplay: viewControls.updateModelDisplay,
    updateCorrectionModelDisplay: viewControls.updateCorrectionModelDisplay,
    updatePolicyDisplay: viewControls.updatePolicyDisplay,
    updateParamsDisplay: viewControls.updateParamsDisplay,
    updateFirstPassPromptDisplay: promptDialog.updateFirstPassPromptDisplay,
    updateSecondPassPromptDisplay: promptDialog.updateSecondPassPromptDisplay,
    updateSourceLanguageDisplay: viewControls.updateSourceLanguageDisplay,
    updateTargetLanguageDisplay: viewControls.updateTargetLanguageDisplay,
    getCurrentFirstPassPromptId: promptDialog.getCurrentFirstPassPromptId,
    getCurrentSecondPassPromptId: promptDialog.getCurrentSecondPassPromptId,
    applyFirstPassPromptToSession: viewControls.applyFirstPassPromptToSession,
    applySecondPassPromptToSession: viewControls.applySecondPassPromptToSession,
    applyFirstPassLanguagesToSession: viewControls.applyFirstPassLanguagesToSession,
  });
  sessionControls.loadReplaySampleFiles();
  attachDialogDrag(firstPassPromptsDialogCard, firstPassPromptsDialogDragHandle);
  attachDialogDrag(replaySettingsDialogCard, replaySettingsDialogDragHandle);

  container.__onActivate = () => {
    if (container.__modelOptionsInitialized !== true) {
      return;
    }
    refreshModelOptions(
      container,
      viewControls.getCurrentModel(),
      viewControls.getCurrentCorrectionModel(),
    );
  };

  return container;
}

function populateLanguageSelect(select, selectedLanguage) {
  populateTranslationLanguageSelect(select, selectedLanguage, { includeUnknown: true });
  syncSelectTitle(select);
}
