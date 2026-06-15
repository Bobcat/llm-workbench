import { api } from '../../api-client.js';
import { populateTranslationLanguageSelect } from '../../shared/translation-languages.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

// The prompt library now lives in translation-services (/v1/prompts), domain-agnostic:
// image-translation prompts and the realtime first/second-pass prompts share one store.
// A prompt is a {system, user} template pair with {{var}} placeholders; the variables a
// template references depend on its domain (image uses {{category}}/{{target_lang}}/
// {{source_window}}, realtime adds {{draft_translation}}/{{source_lang}}).
const DEFAULT_SOURCE_TEXT = 'This is a sample source sentence.';
const DEFAULT_SOURCE_LANGUAGE = 'English';
const DEFAULT_TARGET_LANGUAGE = 'Dutch';
const DEFAULT_CATEGORY = 'sign';
const DEFAULT_USER_TEMPLATE = '{{source_window}}';
const DEFAULT_PROMPT_ID = 'img_translate_default';

export function createTranslationPromptsView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <div class="translation-prompts-content-area">
          <section class="translation-prompts-pane translation-prompts-pane-editor">
            <details class="translation-prompts-system-details" id="promptLibraryDetails" open>
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
                    <button type="button" id="deletePromptBtn">Delete</button>
                  </div>
                </div>
                <label class="translation-prompts-field">
                  <span>Prompt ID</span>
                  <input id="promptIdInput" type="text" placeholder="<translate_image_menu>">
                </label>
              </div>
            </details>
            <div class="translation-prompts-inline-status" id="promptEditorStatus">Loading...</div>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <details class="translation-prompts-system-details">
              <summary>Model</summary>
              <label class="translation-prompts-field">
                <select id="promptTestModelSelect"></select>
              </label>
            </details>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <details class="translation-prompts-system-details" open>
              <summary>System prompt</summary>
              <label class="translation-prompts-field">
                <textarea id="systemPromptInput" rows="6" placeholder="<System prompt; use {{target_lang}}, {{category}}>"></textarea>
              </label>
            </details>
            <details class="translation-prompts-system-details">
              <summary>User prompt</summary>
              <label class="translation-prompts-field">
                <textarea id="userPromptInput" rows="4" placeholder="<Use {{source_window}}, {{draft_translation}} where needed>"></textarea>
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
              <summary>Variables</summary>
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
                <span>{{category}}</span>
                <input id="categoryInput" type="text" placeholder="<image category, e.g. sign / menu>">
              </label>
              <label class="translation-prompts-field">
                <span>{{source_window}}</span>
                <textarea id="sourceInput" rows="4" placeholder="<Source text>"></textarea>
              </label>
              <label class="translation-prompts-field">
                <span>{{draft_translation}}</span>
                <textarea id="draftTranslationInput" rows="4" placeholder="<Draft translation (realtime second pass)>"></textarea>
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
  const testBtn = container.querySelector('#testPromptBtn');
  const savePromptBtn = container.querySelector('#savePromptBtn');
  const loadPromptBtn = container.querySelector('#loadPromptBtn');
  const newPromptBtn = container.querySelector('#newPromptBtn');
  const deletePromptBtn = container.querySelector('#deletePromptBtn');
  const promptLibrarySelect = container.querySelector('#promptLibrarySelect');
  const promptIdInput = container.querySelector('#promptIdInput');
  const systemPromptInput = container.querySelector('#systemPromptInput');
  const userPromptInput = container.querySelector('#userPromptInput');
  const sourceLanguageSelect = container.querySelector('#sourceLanguageSelect');
  const targetLanguageSelect = container.querySelector('#targetLanguageSelect');
  const categoryInput = container.querySelector('#categoryInput');
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
  let currentPromptBuiltin = false;
  let isBusy = false;
  let savedPromptSnapshot = '';

  userPromptInput.value = DEFAULT_USER_TEMPLATE;
  sourceInput.value = DEFAULT_SOURCE_TEXT;
  categoryInput.value = DEFAULT_CATEGORY;
  populateLanguageSelect(sourceLanguageSelect, DEFAULT_SOURCE_LANGUAGE);
  populateLanguageSelect(targetLanguageSelect, DEFAULT_TARGET_LANGUAGE);

  function refreshStatus() {
    const dirty = isPromptDirty();
    if (!editorStatusEl.classList.contains('is-error')) {
      const msgs = [];
      if (dirty) msgs.push('Unsaved changes');
      if (currentPromptBuiltin) msgs.push(`Built-in prompt ${currentPromptId} (edit saves an override)`);
      editorStatusEl.textContent = msgs.join(' · ');
    }
    editorStatusEl.classList.toggle('is-dirty', dirty);
    savePromptBtn.classList.toggle('is-unsaved', dirty);
    deletePromptBtn.disabled = isBusy || !currentPromptId || currentPromptBuiltin;
  }

  function setBusy(nextBusy) {
    isBusy = nextBusy;
    [testBtn, savePromptBtn, loadPromptBtn, newPromptBtn, promptLibrarySelect, promptIdInput,
      testModelSelect, systemPromptInput, userPromptInput, sourceLanguageSelect,
      targetLanguageSelect, categoryInput, sourceInput, draftTranslationInput]
      .forEach((el) => { el.disabled = nextBusy; });
    refreshStatus();
  }

  function setStatus(message, isError = false) {
    editorStatusEl.classList.toggle('is-error', Boolean(message) && isError);
    if (message) {
      editorStatusEl.textContent = String(message);
    } else {
      editorStatusEl.classList.remove('is-error');
      refreshStatus();
    }
  }

  function setActionErrorStatus(action, message) {
    setStatus(`${action} failed: ${String(message || '').trim()}`, true);
  }

  function renderVars() {
    return {
      sourceWindow: String(sourceInput.value || ''),
      draftTranslation: String(draftTranslationInput.value || ''),
      sourceLanguage: sourceLanguageSelect.value,
      targetLanguage: targetLanguageSelect.value,
      category: String(categoryInput.value || ''),
    };
  }

  function renderUserPromptPreview() {
    const rendered = renderTemplate(String(userPromptInput.value || ''), renderVars());
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

  function populateModelOptions() {
    const previousValue = String(testModelSelect.value || '').trim();
    const loaded = adminModels.filter((m) => isLoadedRuntime(m.runtimeState));
    const others = adminModels.filter((m) => !isLoadedRuntime(m.runtimeState));
    const markup = ['<option value="">Select model...</option>'];
    if (loaded.length) {
      markup.push('<optgroup label="Loaded">');
      loaded.forEach((m) => markup.push(`<option value="${escapeAttr(m.id)}">${escapeHtml(m.name)}</option>`));
      markup.push('</optgroup>');
    }
    if (others.length) {
      markup.push('<optgroup label="Other known">');
      others.forEach((m) => markup.push(`<option value="${escapeAttr(m.id)}" disabled>${escapeHtml(`${m.name} (${m.runtimeState})`)}</option>`));
      markup.push('</optgroup>');
    }
    testModelSelect.innerHTML = markup.join('');
    testModelSelect.value = loaded.some((m) => m.id === previousValue) ? previousValue : (loaded[0]?.id || '');
  }

  function promptOptionLabel(record) {
    if (!record) return '';
    const withLock = record.builtin ? `${record.id} [built-in]` : record.id;
    return isPromptDirty() && record.id === currentPromptId ? `${withLock} [unsaved]` : withLock;
  }

  function populatePromptLibraryOptions() {
    const currentSelection = String(promptLibrarySelect.value || '').trim();
    const markup = ['<option value="">Select prompt...</option>'];
    promptRecords.forEach((record) => {
      markup.push(`<option value="${escapeAttr(record.id)}">${escapeHtml(promptOptionLabel(record))}</option>`);
    });
    promptLibrarySelect.innerHTML = markup.join('');
    promptLibrarySelect.value = promptRecords.some((r) => r.id === currentSelection)
      ? currentSelection
      : (promptRecords.some((r) => r.id === currentPromptId) ? currentPromptId : '');
    updateLoadButtonState();
  }

  function resetDraftFields() {
    currentPromptId = '';
    currentPromptBuiltin = false;
    promptIdInput.value = '';
    systemPromptInput.value = '';
    userPromptInput.value = DEFAULT_USER_TEMPLATE;
    populatePromptLibraryOptions();
    promptLibrarySelect.value = '';
    updateLoadButtonState();
    captureSavedPromptSnapshot();
    updateSaveButtonLabel();
    renderUserPromptPreview();
    clearRunResult();
    refreshStatus();
  }

  function applyPromptRecord(record) {
    currentPromptId = String(record?.id || '');
    currentPromptBuiltin = Boolean(record?.builtin);
    promptIdInput.value = currentPromptId;
    systemPromptInput.value = String(record?.system || '');
    userPromptInput.value = String(record?.user || DEFAULT_USER_TEMPLATE);
    captureSavedPromptSnapshot();
    populatePromptLibraryOptions();
    updateSaveButtonLabel();
    renderUserPromptPreview();
    clearRunResult();
    refreshStatus();
  }

  function currentPromptPayload() {
    return {
      system: String(systemPromptInput.value || ''),
      user: String(userPromptInput.value || ''),
      tags: [],
    };
  }

  function currentPromptSnapshotSignature() {
    return JSON.stringify({ prompt_id: currentPromptIdInput(), payload: currentPromptPayload() });
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
    savePromptBtn.textContent = isSamePrompt ? 'Save changes' : 'Save new';
  }

  function updateLoadButtonState() {
    const selectedPromptId = String(promptLibrarySelect.value || '').trim();
    loadPromptBtn.classList.toggle('is-pending-load', selectedPromptId !== '' && selectedPromptId !== currentPromptId);
  }

  async function loadPromptLibrary() {
    const result = await api.listTranslationPrompts();
    promptRecords = (result && result.prompts) || [];
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
      const defaultPrompt = promptRecords.find((r) => r.id === DEFAULT_PROMPT_ID) || promptRecords[0];
      if (defaultPrompt) {
        applyPromptRecord(defaultPrompt);
        promptLibrarySelect.value = defaultPrompt.id;
        setStatus('');
      } else {
        renderUserPromptPreview();
        clearRunResult();
        setStatus('');
      }
    } catch (err) {
      console.error('Failed to load prompt library data:', err);
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
      const record = await api.getTranslationPrompt(selectedPromptId);
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

  async function savePrompt() {
    const promptId = currentPromptIdInput();
    if (!promptId) {
      setActionErrorStatus('Save', 'Prompt ID is required.');
      promptIdInput.focus();
      return;
    }
    if (!String(systemPromptInput.value || '').trim()) {
      setActionErrorStatus('Save', 'System prompt is required.');
      systemPromptInput.focus();
      return;
    }
    const isSamePrompt = currentPromptId !== '' && promptId === currentPromptId;
    const payload = currentPromptPayload();
    setBusy(true);
    setStatus(isSamePrompt ? `Saving changes to ${promptId}...` : `Saving new prompt ${promptId}...`);
    try {
      const savedRecord = isSamePrompt
        ? await api.updateTranslationPrompt(promptId, payload)
        : await api.createTranslationPrompt({ id: promptId, ...payload });
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

  async function deletePrompt() {
    if (!currentPromptId || currentPromptBuiltin) return;
    setBusy(true);
    setStatus(`Deleting ${currentPromptId}...`);
    try {
      await api.deleteTranslationPrompt(currentPromptId);
      await loadPromptLibrary();
      resetDraftFields();
      setStatus('');
    } catch (err) {
      console.error('Failed to delete prompt:', err);
      setActionErrorStatus('Delete', formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function runPromptTest() {
    const model = String(testModelSelect.value || '').trim();
    if (!model) {
      setActionErrorStatus('Run', 'Choose a model first.');
      return;
    }
    const vars = renderVars();
    // {{category}} is image-domain only; the realtime test endpoint substitutes the other
    // variables, so resolve {{category}} client-side before sending.
    const system = String(systemPromptInput.value || '').replaceAll('{{category}}', vars.category);
    const userTemplate = String(userPromptInput.value || '').replaceAll('{{category}}', vars.category);
    const renderedUserPrompt = renderUserPromptPreview();
    if (!userTemplate.trim()) {
      setActionErrorStatus('Run', 'User prompt is required.');
      userPromptInput.focus();
      return;
    }
    setBusy(true);
    setStatus('Running prompt test...');
    try {
      const result = await api.testTranslationPrompt({
        model,
        system_prompt: system,
        user_prompt_template: userTemplate,
        source_text: vars.sourceWindow,
        draft_translation: vars.draftTranslation,
        source_language: vars.sourceLanguage,
        target_language: vars.targetLanguage,
      });
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

  [promptIdInput].forEach((element) => {
    element.addEventListener('input', () => {
      populatePromptLibraryOptions();
      updateSaveButtonLabel();
      if (!isBusy) refreshStatus();
    });
  });

  promptLibrarySelect.addEventListener('change', updateLoadButtonState);

  [systemPromptInput, userPromptInput].forEach((element) => {
    element.addEventListener('input', () => {
      populatePromptLibraryOptions();
      updateSaveButtonLabel();
      renderUserPromptPreview();
      if (!isBusy) refreshStatus();
    });
  });

  [sourceInput, draftTranslationInput, categoryInput].forEach((element) => {
    element.addEventListener('input', renderUserPromptPreview);
  });

  [sourceLanguageSelect, targetLanguageSelect].forEach((element) => {
    element.addEventListener('change', renderUserPromptPreview);
  });

  loadPromptBtn.addEventListener('click', loadSelectedPrompt);
  newPromptBtn.addEventListener('click', () => { resetDraftFields(); setStatus(''); });
  deletePromptBtn.addEventListener('click', deletePrompt);
  savePromptBtn.addEventListener('click', savePrompt);
  testBtn.addEventListener('click', runPromptTest);

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

function renderTemplate(template, { sourceWindow, draftTranslation, sourceLanguage, targetLanguage, category }) {
  return String(template || '')
    .replaceAll('{{source_window}}', String(sourceWindow || ''))
    .replaceAll('{{draft_translation}}', String(draftTranslation || ''))
    .replaceAll('{{source_lang}}', String(sourceLanguage || ''))
    .replaceAll('{{target_lang}}', String(targetLanguage || ''))
    .replaceAll('{{category}}', String(category || ''));
}
