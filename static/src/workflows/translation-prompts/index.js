import { api } from '../../api-client.js';
import { populateTranslationLanguageSelect } from '../../shared/translation-languages.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const DEFAULT_SOURCE_TEXT = 'This is a sample source sentence.';
const DEFAULT_SOURCE_LANGUAGE = 'English';
const DEFAULT_TARGET_LANGUAGE = 'Dutch';
const DEFAULT_DRAFT_TRANSLATION = '';
const DEFAULT_USER_PROMPT_TEMPLATE = [
  'Translate the attachment from {{source_lang}} to {{target_lang}}.',
  'ATTACHMENTS:',
  'Name: source.txt',
  'Contents:',
  '=====',
  '{{source_window}}',
  '=====',
].join('\n');
const DEFAULT_PROMPT_ID = 'translation/first-pass/current-default';
const FIRST_PASS_TRANSLATION_SECTIONS = {translation: {stage: 'first_pass'}};
const SECOND_PASS_TRANSLATION_SECTIONS = {translation: {stage: 'second_pass'}};

export function createTranslationPromptsView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <div class="translation-prompts-content-area">
          <section class="translation-prompts-pane translation-prompts-pane-editor">
            <details class="translation-prompts-system-details" id="promptLibraryDetails">
              <summary>Prompt library</summary>
              <div class="translation-prompts-library-block">
                <div class="translation-prompts-library-picker">
                  <label class="translation-prompts-field">
                    <span>Saved prompts</span>
                    <select id="promptLibrarySelect"></select>
                  </label>
                  <div class="translation-prompts-library-actions">
                    <button type="button" id="loadPromptBtn">Load</button>
                    <button type="button" id="newPromptBtn">New</button>
                  </div>
                </div>
                <label class="translation-prompts-field">
                  <span>Prompt ID</span>
                  <input id="promptIdInput" type="text" placeholder="<translation/first-pass/example-v1>">
                </label>
                <label class="translation-prompts-field">
                  <span>Title</span>
                  <input id="promptTitleInput" type="text" placeholder="<Prompt title>">
                </label>
              </div>
            </details>
            <div class="translation-prompts-inline-status" id="promptEditorStatus">Loading models...</div>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <details class="translation-prompts-system-details">
              <summary>Model</summary>
              <label class="translation-prompts-field">
                <select id="promptTestModelSelect"></select>
              </label>
            </details>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <details class="translation-prompts-system-details">
              <summary>System prompt</summary>
              <label class="translation-prompts-field">
                <textarea id="systemPromptInput" rows="4" placeholder="<Optional system prompt>"></textarea>
              </label>
            </details>
            <details class="translation-prompts-system-details">
              <summary>User prompt</summary>
              <label class="translation-prompts-field">
                <textarea id="userPromptInput" rows="4" placeholder="<Use {{source_window}} and {{draft_translation}} where needed>"></textarea>
              </label>
            </details>
            <div class="translation-prompts-run-actions">
              <button type="button" id="testPromptBtn">Run</button>
              <button type="button" id="savePromptBtn">Save new</button>
            </div>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <details class="translation-prompts-system-details">
              <summary>Response</summary>
              <label class="translation-prompts-field translation-prompts-field-response">
                <textarea id="promptTestOutput" rows="4" readonly></textarea>
              </label>
            </details>
            <details class="translation-prompts-system-details">
              <summary>Stats</summary>
              <section class="translation-prompts-stats-block">
                <div class="translation-prompts-stats-grid">
                  <div class="translation-prompts-stat">
                    <span>Model</span>
                    <strong id="promptStatModel">-</strong>
                  </div>
                  <div class="translation-prompts-stat">
                    <span>Request</span>
                    <strong id="promptStatRequest">-</strong>
                  </div>
                  <div class="translation-prompts-stat">
                    <span>Wall</span>
                    <strong id="promptStatWall">-</strong>
                  </div>
                  <div class="translation-prompts-stat">
                    <span>Tok/s</span>
                    <strong id="promptStatTps">-</strong>
                  </div>
                </div>
              </section>
            </details>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <details class="translation-prompts-system-details">
              <summary>Source, draft &amp; languages</summary>
              <div class="translation-prompts-language-grid">
                <label class="translation-prompts-field">
                  <span>{{source_lang}}</span>
                  <select id="sourceLanguageSelect"></select>
                </label>
                <label class="translation-prompts-field">
                  <span>{{target_lang}}</span>
                  <select id="targetLanguageSelect"></select>
                </label>
              </div>
              <label class="translation-prompts-field">
                <span>{{source_window}}</span>
                <textarea id="sourceInput" rows="4" placeholder="<Source text>"></textarea>
              </label>
              <label class="translation-prompts-field">
                <span>{{draft_translation}}</span>
                <textarea id="draftTranslationInput" rows="4" placeholder="<Draft translation>"></textarea>
              </label>
            </details>
            <details class="translation-prompts-system-details">
              <summary>Rendered user prompt</summary>
              <label class="translation-prompts-field">
                <textarea id="renderedUserPrompt" rows="4" readonly></textarea>
              </label>
            </details>
          </section>
        </div>
      </div>
    </div>
  `;

  const editorStatusEl = container.querySelector('#promptEditorStatus');
  const promptLibraryDetails = container.querySelector('#promptLibraryDetails');
  const testBtn = container.querySelector('#testPromptBtn');
  const savePromptBtn = container.querySelector('#savePromptBtn');
  const loadPromptBtn = container.querySelector('#loadPromptBtn');
  const newPromptBtn = container.querySelector('#newPromptBtn');
  const promptLibrarySelect = container.querySelector('#promptLibrarySelect');
  const promptIdInput = container.querySelector('#promptIdInput');
  const promptTitleInput = container.querySelector('#promptTitleInput');
  const systemPromptInput = container.querySelector('#systemPromptInput');
  const userPromptInput = container.querySelector('#userPromptInput');
  const sourceLanguageSelect = container.querySelector('#sourceLanguageSelect');
  const targetLanguageSelect = container.querySelector('#targetLanguageSelect');
  const sourceInput = container.querySelector('#sourceInput');
  const draftTranslationInput = container.querySelector('#draftTranslationInput');
  const testModelSelect = container.querySelector('#promptTestModelSelect');
  const renderedUserPromptEl = container.querySelector('#renderedUserPrompt');
  const testOutputEl = container.querySelector('#promptTestOutput');
  const statModelEl = container.querySelector('#promptStatModel');
  const statRequestEl = container.querySelector('#promptStatRequest');
  const statWallEl = container.querySelector('#promptStatWall');
  const statTpsEl = container.querySelector('#promptStatTps');

  let adminModels = [];
  let promptRecords = [];
  let currentPromptId = '';
  let currentPromptEditable = true;
  let currentPromptEnabled = true;
  let currentGoodForModels = [];
  let currentPromptTranslationStage = FIRST_PASS_TRANSLATION_SECTIONS.translation.stage;
  let isBusy = false;
  let hasRunCompleted = false;
  let transientStatus = '';
  let transientStatusTone = 'info';
  let savedPromptSnapshot = '';

  userPromptInput.value = DEFAULT_USER_PROMPT_TEMPLATE;
  sourceInput.value = DEFAULT_SOURCE_TEXT;
  draftTranslationInput.value = DEFAULT_DRAFT_TRANSLATION;
  populateLanguageSelect(sourceLanguageSelect, DEFAULT_SOURCE_LANGUAGE);
  populateLanguageSelect(targetLanguageSelect, DEFAULT_TARGET_LANGUAGE);

  function persistentStatus() {
    const messages = [];
    if (isPromptDirty()) {
      messages.push('Unsaved changes');
    }
    if (currentPromptId !== '' && currentPromptEditable === false) {
      messages.push(`Loaded locked prompt ${currentPromptId}.`);
    }
    return messages.join(' · ');
  }

  function refreshStatus() {
    editorStatusEl.textContent = transientStatus || persistentStatus();
    editorStatusEl.classList.toggle('is-dirty', !transientStatus && isPromptDirty());
    editorStatusEl.classList.toggle('is-error', Boolean(transientStatus) && transientStatusTone === 'error');
    savePromptBtn.classList.toggle('is-unsaved', isPromptDirty());
  }

  function setBusy(nextBusy) {
    isBusy = nextBusy;
    testBtn.disabled = nextBusy;
    savePromptBtn.disabled = nextBusy;
    loadPromptBtn.disabled = nextBusy;
    newPromptBtn.disabled = nextBusy;
    promptLibrarySelect.disabled = nextBusy;
    promptIdInput.disabled = nextBusy;
    promptTitleInput.disabled = nextBusy;
    testModelSelect.disabled = nextBusy;
    systemPromptInput.disabled = nextBusy;
    userPromptInput.disabled = nextBusy;
    sourceLanguageSelect.disabled = nextBusy;
    targetLanguageSelect.disabled = nextBusy;
    draftTranslationInput.disabled = nextBusy;
    updateLoadButtonState();
  }

  function setStatus(message, tone = 'info') {
    transientStatus = String(message || '');
    transientStatusTone = transientStatus ? String(tone || 'info') : 'info';
    refreshStatus();
  }

  function setActionErrorStatus(action, message) {
    setStatus(`${action} failed: ${String(message || '').trim()}`, 'error');
  }

  function setPromptLibrarySaveErrorStatus(openMessage, closedMessage) {
    const libraryIsOpen = Boolean(promptLibraryDetails?.open);
    setActionErrorStatus('Save', libraryIsOpen ? openMessage : closedMessage);
  }

  function renderUserPromptPreview() {
    const template = String(userPromptInput.value || '');
    const sourceText = String(sourceInput.value || '');
    const draftTranslation = String(draftTranslationInput.value || '');
    const rendered = renderTranslationPromptTemplate(template, {
      sourceWindow: sourceText,
      draftTranslation,
      sourceLanguage: sourceLanguageSelect.value,
      targetLanguage: targetLanguageSelect.value,
    });
    renderedUserPromptEl.value = rendered;
    return rendered;
  }

  function clearStats() {
    statModelEl.textContent = '-';
    statRequestEl.textContent = '-';
    statWallEl.textContent = '-';
    statTpsEl.textContent = '-';
  }

  function clearRunResult() {
    hasRunCompleted = false;
    testOutputEl.value = '';
    clearStats();
  }

  function applyStats(result) {
    const metrics = result?.metrics || {};
    statModelEl.textContent = result?.model || '-';
    statRequestEl.textContent = result?.request_id || '-';
    statWallEl.textContent = metrics.transport_completed_ms != null
      ? `${Number(metrics.transport_completed_ms).toFixed(1)} ms`
      : '-';
    statTpsEl.textContent = metrics.engine_tokens_per_second != null
      ? Number(metrics.engine_tokens_per_second).toFixed(1)
      : '-';
  }

  function isLoadedRuntime(state) {
    return String(state || '').trim().toLowerCase() === 'loaded';
  }

  function normalizeAdminModelsPayload(payload) {
    const list = Array.isArray(payload?.models) ? payload.models : [];
    return list
      .map((model) => ({
        id: String(model?.name || '').trim(),
        name: String(model?.name || '').trim(),
        runtimeState: String(model?.runtime_state || 'unloaded').trim().toLowerCase(),
      }))
      .filter((model) => model.id !== '');
  }

  function getSelectableModelIds() {
    return new Set(adminModels.filter((model) => isLoadedRuntime(model.runtimeState)).map((model) => model.id));
  }

  function buildModelGroups() {
    const byId = new Map(adminModels.map((model) => [model.id, model]));
    const seen = new Set();
    const groups = [];

    const associated = currentGoodForModels.map((modelId) => {
      const model = byId.get(modelId);
      seen.add(modelId);
      if (model) {
        return model;
      }
      return {
        id: modelId,
        name: modelId,
        runtimeState: 'unknown',
      };
    });

    if (associated.length > 0) {
      groups.push({
        label: 'Good for prompt',
        options: associated.sort(compareModelOptions),
      });
    }

    const loaded = adminModels.filter((model) => isLoadedRuntime(model.runtimeState) && !seen.has(model.id));
    loaded.forEach((model) => seen.add(model.id));
    if (loaded.length > 0) {
      groups.push({label: 'Loaded', options: loaded.sort(compareModelOptions)});
    }

    const otherKnown = adminModels.filter((model) => !seen.has(model.id));
    if (otherKnown.length > 0) {
      groups.push({label: 'Other known', options: otherKnown.sort(compareModelOptions)});
    }

    return groups;
  }

  function compareModelOptions(left, right) {
    const leftLoaded = isLoadedRuntime(left.runtimeState) ? 0 : 1;
    const rightLoaded = isLoadedRuntime(right.runtimeState) ? 0 : 1;
    if (leftLoaded !== rightLoaded) return leftLoaded - rightLoaded;
    return String(left.name || '').localeCompare(String(right.name || ''), 'nl', {sensitivity: 'base'});
  }

  function formatModelOptionLabel(model) {
    if (model.runtimeState === 'unknown') {
      return `${model.name} (unknown)`;
    }
    if (!isLoadedRuntime(model.runtimeState)) {
      return `${model.name} (${model.runtimeState})`;
    }
    return model.name;
  }

  function populateModelOptions() {
    const previousValue = String(testModelSelect.value || '').trim();
    const selectableIds = getSelectableModelIds();
    const groups = buildModelGroups();
    let firstSelectable = '';

    const markup = ['<option value="">Select model...</option>'];
    groups.forEach((group) => {
      markup.push(`<optgroup label="${escapeAttr(group.label)}">`);
      group.options.forEach((model) => {
        const isSelectable = selectableIds.has(model.id);
        if (!firstSelectable && isSelectable) {
          firstSelectable = model.id;
        }
        markup.push(
          `<option value="${escapeAttr(model.id)}"${isSelectable ? '' : ' disabled'}>${escapeHtml(formatModelOptionLabel(model))}</option>`
        );
      });
      markup.push('</optgroup>');
    });

    testModelSelect.innerHTML = markup.join('');

    const nextValue = selectableIds.has(previousValue)
      ? previousValue
      : firstSelectable;
    testModelSelect.value = nextValue || '';
  }

  function isTranslationFirstPassPrompt(record) {
    return String(record?.sections?.translation?.stage || '').trim().toLowerCase() === 'first_pass';
  }

  function isTranslationSecondPassPrompt(record) {
    return String(record?.sections?.translation?.stage || '').trim().toLowerCase() === 'second_pass';
  }

  function isSupportedTranslationPrompt(record) {
    return isTranslationFirstPassPrompt(record) || isTranslationSecondPassPrompt(record);
  }

  function promptOptionLabel(record) {
    if (!record) return '';
    const stage = isTranslationSecondPassPrompt(record)
      ? '2nd pass'
      : (isTranslationFirstPassPrompt(record) ? '1st pass' : '');
    const title = String(record.title || '').trim();
    const base = title && title !== record.id ? `${title} (${record.id})` : record.id;
    const withStage = stage ? `${base} [${stage}]` : base;
    const withLock = record.editable === false ? `${withStage} [locked]` : withStage;
    return isPromptDirty() && record.id === currentPromptId ? `${withLock} [unsaved]` : withLock;
  }

  function populatePromptLibraryOptions() {
    const currentSelection = String(promptLibrarySelect.value || '').trim();
    const markup = ['<option value="">Select prompt...</option>'];
    promptRecords.forEach((record) => {
      markup.push(`<option value="${escapeAttr(record.id)}">${escapeHtml(promptOptionLabel(record))}</option>`);
    });
    promptLibrarySelect.innerHTML = markup.join('');
    promptLibrarySelect.value = promptRecords.some((record) => record.id === currentSelection)
      ? currentSelection
      : (promptRecords.some((record) => record.id === currentPromptId) ? currentPromptId : '');
    updateLoadButtonState();
  }

  function normalizeModelList(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const normalized = [];
    value.forEach((item) => {
      const cleaned = String(item || '').trim();
      if (!cleaned || seen.has(cleaned)) return;
      seen.add(cleaned);
      normalized.push(cleaned);
    });
    return normalized;
  }

  function resetDraftFields() {
    currentPromptId = '';
    currentPromptEditable = true;
    currentPromptEnabled = true;
    currentGoodForModels = [];
    currentPromptTranslationStage = FIRST_PASS_TRANSLATION_SECTIONS.translation.stage;
    promptIdInput.value = '';
    promptTitleInput.value = '';
    systemPromptInput.value = '';
    userPromptInput.value = DEFAULT_USER_PROMPT_TEMPLATE;
    populatePromptLibraryOptions();
    promptLibrarySelect.value = '';
    updateLoadButtonState();
    populateModelOptions();
    captureSavedPromptSnapshot();
    updateSaveButtonLabel();
    renderUserPromptPreview();
    clearRunResult();
    refreshStatus();
  }

  function applyPromptRecord(record) {
    currentPromptId = String(record?.id || '');
    currentPromptEditable = record?.editable !== false;
    currentPromptEnabled = Boolean(record?.enabled ?? true);
    currentGoodForModels = normalizeModelList(record?.good_for_models || []);
    currentPromptTranslationStage = isTranslationSecondPassPrompt(record)
      ? SECOND_PASS_TRANSLATION_SECTIONS.translation.stage
      : FIRST_PASS_TRANSLATION_SECTIONS.translation.stage;
    promptIdInput.value = currentPromptId;
    promptTitleInput.value = String(record?.title || '');
    systemPromptInput.value = String(record?.system_prompt || '');
    userPromptInput.value = String(record?.prompt_text || DEFAULT_USER_PROMPT_TEMPLATE);
    captureSavedPromptSnapshot();
    populatePromptLibraryOptions();
    populateModelOptions();
    updateSaveButtonLabel();
    renderUserPromptPreview();
    clearRunResult();
    refreshStatus();
  }

  function currentSectionsPayload() {
    return {translation: {stage: currentPromptTranslationStage}};
  }

  function currentPromptPayload() {
    return {
      title: String(promptTitleInput.value || '').trim(),
      prompt_text: String(userPromptInput.value || ''),
      system_prompt: String(systemPromptInput.value || ''),
      editable: currentPromptEditable,
      enabled: currentPromptEnabled,
      tags: [],
      notes: '',
      good_for_models: normalizeModelList(currentGoodForModels),
      sections: currentSectionsPayload(),
    };
  }

  function currentPromptSnapshot() {
    return {
      prompt_id: currentPromptIdInput(),
      payload: currentPromptPayload(),
    };
  }

  function currentPromptSnapshotSignature() {
    return JSON.stringify(currentPromptSnapshot());
  }

  function captureSavedPromptSnapshot() {
    savedPromptSnapshot = currentPromptSnapshotSignature();
  }

  function isPromptDirty() {
    return currentPromptSnapshotSignature() !== savedPromptSnapshot;
  }

  function currentPromptIdInput() {
    return String(promptIdInput.value || '').trim();
  }

  function updateSaveButtonLabel() {
    const promptId = currentPromptIdInput();
    const isSamePrompt = currentPromptId !== '' && promptId !== '' && promptId === currentPromptId;
    if (isSamePrompt && currentPromptEditable) {
      savePromptBtn.textContent = 'Save changes';
      return;
    }
    if (isSamePrompt && !currentPromptEditable) {
      savePromptBtn.textContent = 'Save copy';
      return;
    }
    savePromptBtn.textContent = 'Save new';
  }

  function updateLoadButtonState() {
    const selectedPromptId = String(promptLibrarySelect.value || '').trim();
    const shouldHighlight = selectedPromptId !== '' && selectedPromptId !== currentPromptId;
    loadPromptBtn.classList.toggle('is-pending-load', shouldHighlight);
  }

  async function loadPromptLibrary() {
    const promptData = await api.getPrompts(false);
    promptRecords = Array.isArray(promptData)
      ? promptData.filter(isSupportedTranslationPrompt)
      : [];
    populatePromptLibraryOptions();
  }

  async function loadAdminModels() {
    const adminModelsPayload = await api.getAdminModels();
    adminModels = normalizeAdminModelsPayload(adminModelsPayload);
    populateModelOptions();
  }

  async function loadInitialData() {
    setBusy(true);
    setStatus('Loading prompts and models...');
    try {
      await Promise.all([loadPromptLibrary(), loadAdminModels()]);
      const defaultPrompt = promptRecords.find((record) => record.id === DEFAULT_PROMPT_ID);
      if (defaultPrompt) {
        applyPromptRecord(defaultPrompt);
        promptLibrarySelect.value = defaultPrompt.id;
        setStatus('');
      } else {
        renderUserPromptPreview();
        clearRunResult();
        setStatus(adminModels.length > 0 ? '' : 'No models available.');
      }
    } catch (err) {
      console.error('Failed to load prompt lab data:', err);
      setActionErrorStatus('Load', formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadSelectedPrompt() {
    const selectedPromptId = String(promptLibrarySelect.value || '').trim();
    if (!selectedPromptId) {
      setActionErrorStatus('Load', 'Choose a saved prompt first.');
      return;
    }

    setBusy(true);
    setStatus(`Loading prompt ${selectedPromptId}...`);
    try {
      const record = await api.getPrompt(selectedPromptId);
      applyPromptRecord(record);
      promptLibrarySelect.value = record.id;
      setStatus('');
    } catch (err) {
      console.error('Failed to load prompt:', err);
      setActionErrorStatus('Load', formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  function startNewPrompt() {
    resetDraftFields();
    setStatus('');
  }

  async function savePrompt() {
    const promptId = currentPromptIdInput();

    if (!promptId) {
      setPromptLibrarySaveErrorStatus(
        'Prompt ID is required.',
        'Prompt ID is required. Open Prompt library and enter a Prompt ID.'
      );
      promptIdInput.focus();
      return;
    }
    const title = String(promptTitleInput.value || '').trim();
    if (!title) {
      setPromptLibrarySaveErrorStatus(
        'Title is required.',
        'Title is required. Open Prompt library and enter a Title.'
      );
      promptTitleInput.focus();
      return;
    }
    if (!String(userPromptInput.value || '').trim()) {
      setActionErrorStatus('Save', 'User prompt is required.');
      userPromptInput.focus();
      return;
    }

    const isSamePrompt = currentPromptId !== '' && promptId === currentPromptId;
    if (isSamePrompt && !currentPromptEditable) {
      setPromptLibrarySaveErrorStatus(
        'This prompt is locked. Change Prompt ID to save a copy.',
        'This prompt is locked. Open Prompt library and change Prompt ID to save a copy.'
      );
      promptIdInput.focus();
      return;
    }

    const isSaveChanges = isSamePrompt && currentPromptEditable;
    const payload = {
      ...currentPromptPayload(),
      title,
      editable: isSaveChanges ? currentPromptEditable : true,
    };
    setBusy(true);
    setStatus(isSaveChanges ? `Saving changes to ${promptId}...` : `Saving new prompt ${promptId}...`);
    try {
      const savedRecord = isSaveChanges
        ? await api.updatePrompt(promptId, payload)
        : await api.createPrompt({prompt_id: promptId, ...payload});
      await loadPromptLibrary();
      applyPromptRecord(savedRecord);
      promptLibrarySelect.value = savedRecord.id;
      setStatus('');
    } catch (err) {
      console.error('Failed to save prompt:', err);
      setActionErrorStatus('Save', formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function runPromptTest() {
    const model = String(testModelSelect.value || '').trim();
    const userPromptTemplate = String(userPromptInput.value || '');
    const renderedUserPrompt = renderUserPromptPreview();
    if (!model) {
      setActionErrorStatus('Run', 'Choose a model first.');
      return;
    }
    if (!userPromptTemplate.trim()) {
      setActionErrorStatus('Run', 'User prompt is required.');
      userPromptInput.focus();
      return;
    }
    if (!renderedUserPrompt.trim()) {
      setActionErrorStatus('Run', 'Rendered user prompt is empty.');
      sourceInput.focus();
      return;
    }

    setBusy(true);
    setStatus('Running prompt test...');
    try {
      const result = await api.testTranslationPrompt({
        model,
        system_prompt: String(systemPromptInput.value || ''),
        user_prompt_template: userPromptTemplate,
        source_text: String(sourceInput.value || ''),
        draft_translation: String(draftTranslationInput.value || ''),
        source_language: String(sourceLanguageSelect.value || ''),
        target_language: String(targetLanguageSelect.value || ''),
      });
      hasRunCompleted = true;
      renderedUserPromptEl.value = result.rendered_user_prompt || renderedUserPrompt;
      testOutputEl.value = result.output_text || '';
      applyStats(result);
      setStatus('');
    } catch (err) {
      console.error('Failed to run prompt test:', err);
      clearStats();
      testOutputEl.value = '';
      setActionErrorStatus('Run', formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  [promptIdInput, promptTitleInput].forEach((element) => {
    element.addEventListener('input', () => {
      populatePromptLibraryOptions();
      updateSaveButtonLabel();
      if (!isBusy) {
        refreshStatus();
      }
    });
  });

  promptLibrarySelect.addEventListener('change', () => {
    updateLoadButtonState();
  });

  [systemPromptInput, userPromptInput, sourceInput, draftTranslationInput].forEach((element) => {
    element.addEventListener('input', () => {
      if (element === systemPromptInput || element === userPromptInput) {
        populatePromptLibraryOptions();
        updateSaveButtonLabel();
      }
      renderUserPromptPreview();
      if (hasRunCompleted && !isBusy) {
        setStatus('');
      } else if (!isBusy) {
        refreshStatus();
      }
    });
  });

  [sourceLanguageSelect, targetLanguageSelect].forEach((element) => {
    element.addEventListener('change', () => {
      renderUserPromptPreview();
      if (hasRunCompleted && !isBusy) {
        setStatus('');
      }
    });
  });

  testModelSelect.addEventListener('change', () => {
    if (hasRunCompleted && !isBusy) {
      setStatus('');
    }
  });

  loadPromptBtn.addEventListener('click', () => {
    loadSelectedPrompt();
  });

  newPromptBtn.addEventListener('click', () => {
    startNewPrompt();
  });

  savePromptBtn.addEventListener('click', () => {
    savePrompt();
  });

  testBtn.addEventListener('click', () => {
    runPromptTest();
  });
  renderUserPromptPreview();
  clearStats();
  captureSavedPromptSnapshot();
  updateSaveButtonLabel();
  refreshStatus();
  loadInitialData();

  return container;
}
function populateLanguageSelect(select, selectedName) {
  populateTranslationLanguageSelect(select, selectedName);
}

function renderTranslationPromptTemplate(template, {sourceWindow, draftTranslation, sourceLanguage, targetLanguage}) {
  return String(template || '')
    .replaceAll('{{source_window}}', String(sourceWindow || ''))
    .replaceAll('{{draft_translation}}', String(draftTranslation || ''))
    .replaceAll('{{source_lang}}', String(sourceLanguage || ''))
    .replaceAll('{{target_lang}}', String(targetLanguage || ''));
}
