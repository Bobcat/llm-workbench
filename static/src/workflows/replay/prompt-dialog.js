import { api } from '../../api-client.js';
import { escapeHtml } from '../../shared/ui-helpers.js';
import { normalizeTranslationLanguage as normalizeReplayLanguage } from '../../shared/translation-languages.js';
import {
  formatPromptOptionLabel,
  resolvePromptSelectionId,
} from './prompt-utils.js';
import { closeDialog, openDialog, syncSelectTitle } from './ui.js';

export function createReplayPromptDialog(options) {
  const {
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
    defaultFirstPassPromptId,
    defaultSecondPassPromptId,
    getSessionId,
    getCurrentSourceLanguage,
    getCurrentTargetLanguage,
    updateSourceLanguageDisplay,
    updateTargetLanguageDisplay,
    applyFirstPassPromptToSession,
    applySecondPassPromptToSession,
    applyFirstPassLanguagesToSession,
    populateLanguageSelect,
  } = options;

  let firstPassPromptRecords = [];
  let secondPassPromptRecords = [];
  let currentFirstPassPromptId = defaultFirstPassPromptId;
  let currentSecondPassPromptId = defaultSecondPassPromptId;
  let pendingFirstPassPromptId = defaultFirstPassPromptId;
  let pendingSecondPassPromptId = defaultSecondPassPromptId;
  let activePromptPass = 'first';
  let pendingSourceLanguage = normalizeReplayLanguage(getCurrentSourceLanguage());
  let pendingTargetLanguage = normalizeReplayLanguage(getCurrentTargetLanguage());

  populateLanguageSelect(firstPassSourceLanguageSelect, pendingSourceLanguage);
  populateLanguageSelect(firstPassTargetLanguageSelect, pendingTargetLanguage);
  populateLanguageSelect(targetLanguageQuickSelect, pendingTargetLanguage);

  firstPassPromptsBtn.addEventListener('click', async () => {
    await loadPromptRecords();
    if (firstPassPromptRecords.length === 0 && secondPassPromptRecords.length === 0) {
      return;
    }
    pendingFirstPassPromptId = resolvePromptSelectionId(
      currentFirstPassPromptId,
      firstPassPromptRecords,
      defaultFirstPassPromptId,
    );
    pendingSecondPassPromptId = resolvePromptSelectionId(
      currentSecondPassPromptId,
      secondPassPromptRecords,
      defaultSecondPassPromptId,
    );
    activePromptPass = firstPassPromptRecords.length > 0 ? 'first' : 'second';
    pendingSourceLanguage = getCurrentSourceLanguage();
    pendingTargetLanguage = getCurrentTargetLanguage();
    syncActivePromptDialog();
    openDialog(firstPassPromptsDialog);
  });

  firstPassPromptTabBtn.addEventListener('click', () => {
    setActivePromptPass('first');
  });

  secondPassPromptTabBtn.addEventListener('click', () => {
    setActivePromptPass('second');
  });

  firstPassPromptSelect.addEventListener('change', () => {
    const records = getPromptRecordsForPass(activePromptPass);
    const resolvedId = resolvePromptSelectionId(
      firstPassPromptSelect.value,
      records,
      getDefaultPromptIdForPass(activePromptPass),
    );
    setPendingPromptIdForPass(activePromptPass, resolvedId);
    syncPromptPreview(activePromptPass, resolvedId);
  });

  firstPassSourceLanguageSelect.addEventListener('change', () => {
    pendingSourceLanguage = normalizeReplayLanguage(firstPassSourceLanguageSelect.value);
    syncDialogLanguageControls();
  });

  firstPassTargetLanguageSelect.addEventListener('change', () => {
    pendingTargetLanguage = normalizeReplayLanguage(firstPassTargetLanguageSelect.value);
    syncDialogLanguageControls();
  });

  targetLanguageQuickSelect.addEventListener('change', async () => {
    const previousTargetLanguage = getCurrentTargetLanguage();
    try {
      await setFirstPassLanguages({
        sourceLanguage: getCurrentSourceLanguage(),
        targetLanguage: targetLanguageQuickSelect.value,
      });
    } catch (err) {
      console.error('Failed to set target language:', err);
      alert('Failed to set target language: ' + err.message);
      updateTargetLanguageDisplay(previousTargetLanguage);
    }
  });

  cancelFirstPassPromptBtn.addEventListener('click', () => {
    closeDialog(firstPassPromptsDialog);
  });

  firstPassPromptsDialog.addEventListener('click', (event) => {
    if (event.target === firstPassPromptsDialog) {
      closeDialog(firstPassPromptsDialog);
    }
  });

  applyFirstPassPromptBtn.addEventListener('click', async () => {
    const records = getPromptRecordsForPass(activePromptPass);
    const nextPromptId = resolvePromptSelectionId(
      getPendingPromptIdForPass(activePromptPass),
      records,
      getDefaultPromptIdForPass(activePromptPass),
    );
    if (!nextPromptId) {
      return;
    }
    try {
      applyFirstPassPromptBtn.disabled = true;
      const sessionId = getSessionId();
      if (sessionId) {
        if (activePromptPass === 'second') {
          await applySecondPassPromptToSession(sessionId, nextPromptId);
        } else {
          await applyFirstPassPromptToSession(sessionId, nextPromptId);
        }
        await applyFirstPassLanguagesToSession(sessionId, {
          sourceLanguage: pendingSourceLanguage,
          targetLanguage: pendingTargetLanguage,
        });
      }
      setCurrentPromptIdForPass(activePromptPass, nextPromptId);
      updateSourceLanguageDisplay(pendingSourceLanguage);
      updateTargetLanguageDisplay(pendingTargetLanguage);
      syncQuickTargetLanguageVisibility();
      closeDialog(firstPassPromptsDialog);
    } catch (err) {
      console.error(`Failed to set ${activePromptPass}-pass prompt:`, err);
      alert(`Failed to set ${activePromptPass === 'second' ? 'second' : 'first'}-pass prompt: ` + err.message);
    } finally {
      applyFirstPassPromptBtn.disabled = false;
      syncActivePromptDialog();
    }
  });

  return {
    loadPromptRecords,
    updateFirstPassPromptDisplay,
    updateSecondPassPromptDisplay,
    getCurrentFirstPassPromptId: () => currentFirstPassPromptId,
    getCurrentSecondPassPromptId: () => currentSecondPassPromptId,
  };

  function getPromptRecordsForPass(pass) {
    return pass === 'second' ? secondPassPromptRecords : firstPassPromptRecords;
  }

  function getDefaultPromptIdForPass(pass) {
    return pass === 'second' ? defaultSecondPassPromptId : defaultFirstPassPromptId;
  }

  function getCurrentPromptIdForPass(pass) {
    return pass === 'second' ? currentSecondPassPromptId : currentFirstPassPromptId;
  }

  function setCurrentPromptIdForPass(pass, promptId) {
    if (pass === 'second') {
      currentSecondPassPromptId = promptId;
      return;
    }
    currentFirstPassPromptId = promptId;
  }

  function getPendingPromptIdForPass(pass) {
    return pass === 'second' ? pendingSecondPassPromptId : pendingFirstPassPromptId;
  }

  function setPendingPromptIdForPass(pass, promptId) {
    if (pass === 'second') {
      pendingSecondPassPromptId = promptId;
      return;
    }
    pendingFirstPassPromptId = promptId;
  }

  function updateFirstPassPromptDisplay(promptId) {
    const normalizedPromptId = String(promptId || '').trim();
    if (firstPassPromptRecords.length === 0) {
      currentFirstPassPromptId = normalizedPromptId || defaultFirstPassPromptId;
    } else {
      currentFirstPassPromptId = resolvePromptSelectionId(
        normalizedPromptId,
        firstPassPromptRecords,
        defaultFirstPassPromptId,
      );
    }
    syncQuickTargetLanguageVisibility();
  }

  function updateSecondPassPromptDisplay(promptId) {
    const normalizedPromptId = String(promptId || '').trim();
    if (secondPassPromptRecords.length === 0) {
      currentSecondPassPromptId = normalizedPromptId || defaultSecondPassPromptId;
    } else {
      currentSecondPassPromptId = resolvePromptSelectionId(
        normalizedPromptId,
        secondPassPromptRecords,
        defaultSecondPassPromptId,
      );
    }
    syncQuickTargetLanguageVisibility();
  }

  function currentPromptRecordForPass(pass) {
    const records = getPromptRecordsForPass(pass);
    const currentPromptId = getCurrentPromptIdForPass(pass);
    return records.find((record) => record.id === currentPromptId) || null;
  }

  function pendingPromptRecordForPass(pass) {
    const records = getPromptRecordsForPass(pass);
    const pendingPromptId = getPendingPromptIdForPass(pass);
    return records.find((record) => record.id === pendingPromptId) || null;
  }

  function promptUsesPlaceholder(record, placeholder) {
    if (!record || !placeholder) return false;
    return String(record.system_prompt || '').includes(placeholder)
      || String(record.prompt_text || '').includes(placeholder);
  }

  function syncQuickTargetLanguageVisibility() {
    const row = container.querySelector('#replayTargetLanguageRow');
    if (!row) return;
    const usesTargetLanguage = (
      promptUsesPlaceholder(currentPromptRecordForPass('first'), '{{target_lang}}')
      || promptUsesPlaceholder(currentPromptRecordForPass('second'), '{{target_lang}}')
    );
    row.hidden = !usesTargetLanguage;
    if (targetLanguageQuickSelect) {
      targetLanguageQuickSelect.disabled = !usesTargetLanguage;
    }
  }

  function syncDialogLanguageControls() {
    const record = pendingPromptRecordForPass(activePromptPass);
    const usesSourceLanguage = promptUsesPlaceholder(record, '{{source_lang}}');
    const usesTargetLanguage = promptUsesPlaceholder(record, '{{target_lang}}');
    if (firstPassSourceLanguageSelect) {
      firstPassSourceLanguageSelect.value = pendingSourceLanguage;
      firstPassSourceLanguageSelect.disabled = !usesSourceLanguage;
      syncSelectTitle(firstPassSourceLanguageSelect);
    }
    if (firstPassSourceLanguageHint) {
      firstPassSourceLanguageHint.hidden = usesSourceLanguage;
    }
    if (firstPassTargetLanguageSelect) {
      firstPassTargetLanguageSelect.value = pendingTargetLanguage;
      firstPassTargetLanguageSelect.disabled = !usesTargetLanguage;
      syncSelectTitle(firstPassTargetLanguageSelect);
    }
    if (firstPassTargetLanguageHint) {
      firstPassTargetLanguageHint.hidden = usesTargetLanguage;
    }
  }

  function syncPromptPassTabs() {
    const firstTabActive = activePromptPass === 'first';
    if (firstPassPromptTabBtn) {
      firstPassPromptTabBtn.classList.toggle('is-active', firstTabActive);
      firstPassPromptTabBtn.setAttribute('aria-selected', String(firstTabActive));
      firstPassPromptTabBtn.disabled = firstPassPromptRecords.length === 0;
    }
    if (secondPassPromptTabBtn) {
      secondPassPromptTabBtn.classList.toggle('is-active', !firstTabActive);
      secondPassPromptTabBtn.setAttribute('aria-selected', String(!firstTabActive));
      secondPassPromptTabBtn.disabled = secondPassPromptRecords.length === 0;
    }
  }

  function syncActivePromptDialog() {
    const records = getPromptRecordsForPass(activePromptPass);
    const resolvedId = resolvePromptSelectionId(
      getPendingPromptIdForPass(activePromptPass),
      records,
      getDefaultPromptIdForPass(activePromptPass),
    );
    setPendingPromptIdForPass(activePromptPass, resolvedId);
    firstPassPromptSelect.innerHTML = records.map((record) => (
      `<option value="${escapeHtml(record.id)}">${escapeHtml(formatPromptOptionLabel(record))}</option>`
    )).join('');
    firstPassPromptSelect.disabled = records.length === 0;
    firstPassPromptSelect.value = resolvedId;
    syncPromptPreview(activePromptPass, resolvedId);
    syncSelectTitle(firstPassPromptSelect);
    syncPromptPassTabs();
  }

  function setActivePromptPass(pass) {
    const nextPass = pass === 'second' ? 'second' : 'first';
    if (nextPass === 'second' && secondPassPromptRecords.length === 0) {
      activePromptPass = 'first';
    } else if (nextPass === 'first' && firstPassPromptRecords.length === 0) {
      activePromptPass = secondPassPromptRecords.length > 0 ? 'second' : 'first';
    } else {
      activePromptPass = nextPass;
    }
    syncActivePromptDialog();
  }

  function syncPromptPreview(pass, promptId) {
    const records = getPromptRecordsForPass(pass);
    const record = records.find((item) => item.id === promptId);
    firstPassPromptSystemPreview.value = record?.system_prompt || '';
    firstPassPromptUserPreview.value = record?.prompt_text || '';
    syncDialogLanguageControls();
  }

  async function loadPromptRecords() {
    firstPassPromptsBtn.disabled = true;
    firstPassPromptSelect.innerHTML = '';
    try {
      const result = await api.listTranslationPrompts();
      // One flat library, shared with the image pipeline. A prompt has no pass of its own;
      // both selectors show the full list and you pick whichever for each slot.
      const prompts = ((result && result.prompts) || []).map((e) => ({
        id: e.id,
        enabled: true,
        system_prompt: e.system,
        prompt_text: e.user,
      }));
      const sortBy = (defaultId) => (a, b) => {
        if (a.id === defaultId) return -1;
        if (b.id === defaultId) return 1;
        return formatPromptOptionLabel(a).localeCompare(formatPromptOptionLabel(b));
      };
      firstPassPromptRecords = [...prompts].sort(sortBy(defaultFirstPassPromptId));
      secondPassPromptRecords = [...prompts].sort(sortBy(defaultSecondPassPromptId));

      currentFirstPassPromptId = resolvePromptSelectionId(
        currentFirstPassPromptId,
        firstPassPromptRecords,
        defaultFirstPassPromptId,
      );
      currentSecondPassPromptId = resolvePromptSelectionId(
        currentSecondPassPromptId,
        secondPassPromptRecords,
        defaultSecondPassPromptId,
      );
      pendingFirstPassPromptId = currentFirstPassPromptId;
      pendingSecondPassPromptId = currentSecondPassPromptId;
      setActivePromptPass(activePromptPass);
      syncQuickTargetLanguageVisibility();
      firstPassPromptsBtn.disabled = firstPassPromptRecords.length === 0 && secondPassPromptRecords.length === 0;
    } catch (err) {
      console.error('Failed to load replay prompts:', err);
      firstPassPromptRecords = [];
      secondPassPromptRecords = [];
      currentFirstPassPromptId = '';
      currentSecondPassPromptId = '';
      pendingFirstPassPromptId = '';
      pendingSecondPassPromptId = '';
      firstPassPromptSystemPreview.value = '';
      firstPassPromptUserPreview.value = '';
      firstPassPromptsBtn.disabled = true;
      syncPromptPassTabs();
      syncQuickTargetLanguageVisibility();
    }
  }

  async function setFirstPassLanguages({ sourceLanguage, targetLanguage }) {
    const normalizedSourceLanguage = normalizeReplayLanguage(sourceLanguage ?? getCurrentSourceLanguage());
    const normalizedTargetLanguage = normalizeReplayLanguage(targetLanguage ?? getCurrentTargetLanguage());
    const sessionId = getSessionId();

    if (sessionId) {
      await applyFirstPassLanguagesToSession(sessionId, {
        sourceLanguage: normalizedSourceLanguage,
        targetLanguage: normalizedTargetLanguage,
      });
    } else {
      updateSourceLanguageDisplay(normalizedSourceLanguage);
      updateTargetLanguageDisplay(normalizedTargetLanguage);
    }

    pendingSourceLanguage = getCurrentSourceLanguage();
    pendingTargetLanguage = getCurrentTargetLanguage();
    syncDialogLanguageControls();
  }
}
