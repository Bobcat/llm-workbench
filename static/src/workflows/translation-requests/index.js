import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';
import { TRANSLATION_LANGUAGES } from '../../shared/translation-languages.js';

const POLL_INTERVAL_MS = 800;
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const IMAGE_ARTIFACT_ORDER = ['rendered', 'grouping_overlay_debug', 'projected_overlay_debug', 'rectified_debug', 'debug_overlay'];
const IMAGE_ARTIFACT_LABELS = {
  rendered: 'Translated',
  grouping_overlay_debug: 'Grouping',
  projected_overlay_debug: 'Text planes',
  rectified_debug: 'Rectified debug',
  debug_overlay: 'Debug overlay',
};

export function createTranslationRequestsView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view translation-requests-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <div class="translation-prompts-content-area translation-requests-content">
          <section class="translation-prompts-pane translation-prompts-pane-editor translation-requests-form-pane">
            <label class="translation-prompts-field">
              <span>Image</span>
              <input id="translationRequestFile" type="file" accept="image/png,image/jpeg,image/webp">
            </label>
            <div class="translation-prompts-language-grid translation-requests-grid">
              <label class="translation-prompts-field">
                <span>Source language</span>
                <input id="translationRequestSource" value="en" placeholder="en" autocomplete="off">
              </label>
              <label class="translation-prompts-field">
                <span>Target language</span>
                <input id="translationRequestTarget" value="nl" placeholder="nl" autocomplete="off">
              </label>
            </div>
            <label class="translation-prompts-field">
              <span>Model (grouping + translation)</span>
              <select id="translationRequestModel"><option value="">Loading models…</option></select>
            </label>
            <div class="translation-requests-options-row">
              <label class="translation-requests-option">
                <input id="translationPreserveHeuristicText" type="checkbox" checked>
                <span>Preserve heuristic text</span>
              </label>
              <label class="translation-requests-option">
                <input id="translationPreserveUnchangedText" type="checkbox">
                <span>Preserve unchanged text</span>
              </label>
            </div>
            <div class="translation-prompts-run-actions">
              <button type="button" id="translationRequestSubmit">Submit</button>
              <button type="button" id="translationRequestCancel" disabled>Cancel</button>
            </div>
            <div class="translation-prompts-inline-status" id="translationRequestStatus"></div>
            <section class="translation-prompts-stats-block">
              <div class="translation-prompts-stat translation-requests-id-stat">
                <span>Request</span>
                <strong id="translationRequestStatId">-</strong>
              </div>
              <div class="translation-prompts-stats-grid translation-requests-stats">
                <div class="translation-prompts-stat">
                  <span>State</span>
                  <strong id="translationRequestStatState">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Stage</span>
                  <strong id="translationRequestStatStage">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Queue</span>
                  <strong id="translationRequestStatQueue">-</strong>
                </div>
              </div>
            </section>
            <section class="translation-prompts-stats-block">
              <div class="translation-requests-timings-title">Timings</div>
              <div class="translation-requests-timings" id="translationRequestTimings"></div>
            </section>
            <details class="translation-prompts-system-details translation-requests-details">
              <summary>Prompts &amp; responses</summary>
              <div class="translation-requests-details-body">
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>VLM grouping — input</span>
                  <textarea id="trtVlmInput" rows="6" spellcheck="false" placeholder="The user prompt sent to the grouping VLM."></textarea>
                </label>
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>VLM grouping — response</span>
                  <textarea id="trtVlmResponse" rows="6" spellcheck="false"></textarea>
                </label>
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>Translation — system / instructions</span>
                  <textarea id="trtXlateSystem" rows="6" spellcheck="false"></textarea>
                </label>
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>Translation — input</span>
                  <textarea id="trtXlateInput" rows="6" spellcheck="false"></textarea>
                </label>
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>Translation — response</span>
                  <textarea id="trtXlateResponse" rows="6" spellcheck="false"></textarea>
                </label>
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>Fallback calls (prompts + responses)</span>
                  <textarea id="trtFallbacks" rows="6" spellcheck="false" placeholder="Any per-unit / batch fallback calls, with their prompts and responses."></textarea>
                </label>
              </div>
            </details>
            <label class="translation-prompts-field translation-prompts-field-response">
              <span>Raw response</span>
              <textarea id="translationRequestRaw" rows="10" readonly></textarea>
            </label>
            <section class="translation-prompts-stats-block translation-requests-retranslate">
              <div class="translation-requests-timings-title">Re-translate (cached units)</div>
              <div class="translation-prompts-language-grid translation-requests-grid">
                <label class="translation-prompts-field">
                  <span>Target language</span>
                  <select id="translationRetranslateLang"></select>
                </label>
                <label class="translation-prompts-field">
                  <span>Prompt</span>
                  <select id="translationRetranslatePrompt"></select>
                </label>
              </div>
              <div class="translation-prompts-run-actions">
                <button type="button" id="translationRetranslate" disabled title="Re-run translation + render on the last completed run's cached units with this prompt and language (no VLM/OCR/grouping)">Re-translate</button>
              </div>
              <div class="translation-prompts-inline-status" id="translationPromptStatus"></div>
            </section>
          </section>
          <section class="translation-prompts-pane translation-requests-preview-pane">
            <div class="translation-prompts-pane-title">Preview</div>
            <label class="translation-preview-zoom">
              <span>Preview size</span>
              <input id="translationPreviewZoom" type="range" min="25" max="180" step="5" value="70">
              <output id="translationPreviewZoomValue">70%</output>
            </label>
            <label class="translation-preview-artifact">
              <span>Artifact</span>
              <select id="translationPreviewArtifact" disabled>
                <option value="">No artifact</option>
              </select>
            </label>
            <div class="translation-preview-block">
              <span>Input</span>
              <div class="translation-preview-frame">
                <img id="translationInputPreview" alt="Selected input preview" hidden>
                <div id="translationInputEmpty" class="translation-preview-empty">No image selected</div>
              </div>
            </div>
            <div class="translation-preview-block">
              <span id="translationOutputLabel">Artifact</span>
              <div class="translation-preview-frame">
                <img id="translationComparePreview" alt="Original for comparison" hidden>
                <img id="translationOutputPreview" alt="Image pool output preview" hidden>
                <div id="translationOutputEmpty" class="translation-preview-empty">No output yet</div>
              </div>
              <label class="translation-preview-toggle" id="translationPreviewToggleLabel" hidden>
                <input type="checkbox" id="translationPreviewShowOriginal">
                <span>Show original</span>
              </label>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  const fileInput = container.querySelector('#translationRequestFile');
  const sourceInput = container.querySelector('#translationRequestSource');
  const targetInput = container.querySelector('#translationRequestTarget');
  const submitBtn = container.querySelector('#translationRequestSubmit');
  const cancelBtn = container.querySelector('#translationRequestCancel');
  const statusEl = container.querySelector('#translationRequestStatus');
  const statIdEl = container.querySelector('#translationRequestStatId');
  const statStateEl = container.querySelector('#translationRequestStatState');
  const statStageEl = container.querySelector('#translationRequestStatStage');
  const statQueueEl = container.querySelector('#translationRequestStatQueue');
  const timingsEl = container.querySelector('#translationRequestTimings');
  const rawEl = container.querySelector('#translationRequestRaw');
  const modelSelect = container.querySelector('#translationRequestModel');
  const preserveHeuristicTextInput = container.querySelector('#translationPreserveHeuristicText');
  const preserveUnchangedTextInput = container.querySelector('#translationPreserveUnchangedText');
  const detailEls = {
    vlmInput: container.querySelector('#trtVlmInput'),
    vlmResponse: container.querySelector('#trtVlmResponse'),
    xlateSystem: container.querySelector('#trtXlateSystem'),
    xlateInput: container.querySelector('#trtXlateInput'),
    xlateResponse: container.querySelector('#trtXlateResponse'),
    fallbacks: container.querySelector('#trtFallbacks'),
  };
  const inputPreview = container.querySelector('#translationInputPreview');
  const inputEmpty = container.querySelector('#translationInputEmpty');
  const outputPreview = container.querySelector('#translationOutputPreview');
  const outputEmpty = container.querySelector('#translationOutputEmpty');
  const outputLabel = container.querySelector('#translationOutputLabel');
  const previewZoomInput = container.querySelector('#translationPreviewZoom');
  const previewZoomValue = container.querySelector('#translationPreviewZoomValue');
  const previewArtifactSelect = container.querySelector('#translationPreviewArtifact');
  const comparePreview = container.querySelector('#translationComparePreview');
  const toggleInput = container.querySelector('#translationPreviewShowOriginal');
  const toggleLabel = container.querySelector('#translationPreviewToggleLabel');
  const retranslateLangSelect = container.querySelector('#translationRetranslateLang');
  const retranslatePromptSelect = container.querySelector('#translationRetranslatePrompt');
  const retranslateBtn = container.querySelector('#translationRetranslate');
  const promptStatusEl = container.querySelector('#translationPromptStatus');

  let isBusy = false;
  let currentRequestId = '';
  let pollTimer = null;
  let inputObjectUrl = '';
  let lastPreviewResult = null;
  let savedPrompts = [];

  function setStatus(message, kind = '') {
    statusEl.textContent = String(message || '');
    statusEl.classList.toggle('is-error', kind === 'error');
  }

  function setBusy(nextBusy) {
    isBusy = Boolean(nextBusy);
    submitBtn.disabled = isBusy || !selectedFile();
    fileInput.disabled = isBusy;
    sourceInput.disabled = isBusy;
    targetInput.disabled = isBusy;
    modelSelect.disabled = isBusy;
    preserveHeuristicTextInput.disabled = isBusy;
    preserveUnchangedTextInput.disabled = isBusy;
    cancelBtn.disabled = !currentRequestId || isTerminalState(currentState());
    retranslateLangSelect.disabled = isBusy;
    retranslatePromptSelect.disabled = isBusy;
    updateRetranslateState();
  }

  function updateRetranslateState() {
    const ready = Boolean(currentRequestId) && currentState() === 'completed';
    retranslateBtn.disabled = isBusy || !ready;
  }

  function setPromptStatus(message, kind = '') {
    promptStatusEl.textContent = String(message || '');
    promptStatusEl.classList.toggle('is-error', kind === 'error');
  }

  function selectedFile() {
    return fileInput.files && fileInput.files.length > 0 ? fileInput.files[0] : null;
  }

  function currentState() {
    return String(statStateEl.textContent || '').trim().toLowerCase();
  }

  function isTerminalState(state) {
    return TERMINAL_STATES.has(String(state || '').trim().toLowerCase());
  }

  function buildRequestPayload() {
    const payload = {
      task: 'translate_image',
      priority: 'normal',
      // Ask the pipeline for the OCR ("Text planes") + grouping debug overlays. They are off by
      // default (a non-debug caller like the asr app skips that ~1s of full-image rendering); the
      // workbench is the debug surface, so it opts in to populate those artifact previews.
      debug_overlays: true,
      preserve_heuristic_text: Boolean(preserveHeuristicTextInput.checked),
      preserve_unchanged_text: Boolean(preserveUnchangedTextInput.checked),
    };
    const sourceLang = String(sourceInput.value || '').trim();
    if (sourceLang) payload.source_lang_code = sourceLang;
    const targetLang = String(targetInput.value || '').trim();
    if (targetLang) payload.target_lang_code = targetLang;
    // One picked model drives both grouping (VLM) and translation. Empty = the
    // service's configured defaults.
    const model = String(modelSelect.value || '').trim();
    if (model) {
      payload.grouping_model = model;
      payload.translator_model = model;
    }
    return payload;
  }

  async function submitRequest() {
    const file = selectedFile();
    if (!file) {
      setStatus('Select an image first.', 'error');
      return;
    }

    stopPolling();
    clearOutputPreview();
    setBusy(true);
    setStatus('Submitting image request...');
    try {
      const formData = new FormData();
      formData.append('request_json', JSON.stringify(buildRequestPayload()));
      formData.append('image_file', file);
      const result = await api.submitImageRequest(formData);
      applyLifecycle(result);
      currentRequestId = String(result?.request_id || '');
      setStatus(currentRequestId ? 'Request submitted.' : 'Request submitted without id.');
      if (currentRequestId && !isTerminalState(result?.state)) {
        startPolling();
      } else {
        renderOutputPreview(result);
      }
    } catch (err) {
      setStatus(formatApiError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function pollOnce() {
    if (!currentRequestId) return;
    try {
      const result = await api.getImageRequest(currentRequestId);
      applyLifecycle(result);
      if (isTerminalState(result?.state)) {
        stopPolling();
        renderOutputPreview(result);
      }
    } catch (err) {
      stopPolling();
      setStatus(formatApiError(err), 'error');
    } finally {
      setBusy(isBusy);
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(pollOnce, POLL_INTERVAL_MS);
    pollOnce();
  }

  function stopPolling() {
    if (pollTimer === null) return;
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  async function cancelRequest() {
    if (!currentRequestId) return;
    setBusy(true);
    setStatus('Cancelling request...');
    try {
      const result = await api.cancelImageRequest(currentRequestId);
      applyLifecycle(result);
      setStatus('Cancel sent.');
      if (isTerminalState(result?.state)) {
        stopPolling();
      }
    } catch (err) {
      setStatus(formatApiError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  function populateLanguageSelect() {
    retranslateLangSelect.innerHTML = TRANSLATION_LANGUAGES
      .map((l) => `<option value="${escapeAttr(l.code)}">${escapeHtml(`${l.flag} ${l.name}`)}</option>`)
      .join('');
  }

  // Prompts are authored in the prompt library (#prompt-library); this view only selects
  // one from the flat list to re-translate the cached units with.
  async function loadPromptChoices() {
    try {
      const result = await api.listTranslationPrompts();
      savedPrompts = (result && result.prompts) || [];
    } catch (err) {
      savedPrompts = [];
      setPromptStatus(formatApiError(err), 'error');
    }
    const previous = String(retranslatePromptSelect.value || '');
    retranslatePromptSelect.innerHTML = savedPrompts.length
      ? savedPrompts.map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.id)}</option>`).join('')
      : '<option value="">(no prompts)</option>';
    if (savedPrompts.some((p) => p.id === previous)) retranslatePromptSelect.value = previous;
    setBusy(isBusy);
  }

  async function retranslateRequest() {
    const sourceRequestId = currentRequestId;
    if (!sourceRequestId || currentState() !== 'completed') return;
    const body = {};
    const promptId = String(retranslatePromptSelect.value || '');
    if (promptId) body.translation_prompt_id = promptId;
    const lang = String(retranslateLangSelect.value || '');
    if (lang) body.target_lang_code = lang;
    // Re-translate reuses cached grouping, so only the translator model applies.
    const model = String(modelSelect.value || '').trim();
    if (model) body.translator_model = model;
    body.preserve_heuristic_text = Boolean(preserveHeuristicTextInput.checked);
    body.preserve_unchanged_text = Boolean(preserveUnchangedTextInput.checked);
    stopPolling();
    clearOutputPreview();
    setBusy(true);
    setStatus('Submitting re-translate...');
    setPromptStatus('Re-translating cached units...');
    try {
      const result = await api.retranslateImageRequest(sourceRequestId, body);
      applyLifecycle(result);
      currentRequestId = String(result?.request_id || '');
      setStatus('Re-translate submitted.');
      if (currentRequestId && !isTerminalState(result?.state)) {
        startPolling();
      } else {
        renderOutputPreview(result);
      }
    } catch (err) {
      setStatus(formatApiError(err), 'error');
      setPromptStatus(formatApiError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  function applyLifecycle(result) {
    const requestId = String(result?.request_id || '');
    if (requestId) currentRequestId = requestId;
    statIdEl.textContent = requestId || '-';
    statIdEl.title = requestId || '';
    statStateEl.textContent = String(result?.state || '-');
    statStageEl.textContent = String(result?.stage || '-');
    statQueueEl.textContent = result?.queue_position == null ? '-' : String(result.queue_position);
    rawEl.value = JSON.stringify(result || {}, null, 2);
    fillCallDetails(result);
    renderTimings(result);
    setBusy(isBusy);
  }

  // The grouping/translation prompts + responses come from response.llm_calls, which the
  // service carries only on the terminal response. While running it's absent, so we only
  // fill when present and never clobber what the user may be editing after completion.
  function fillCallDetails(result) {
    const calls = result?.response?.llm_calls;
    if (!Array.isArray(calls) || calls.length === 0) return;
    const grouping = calls.find((c) => String(c?.role) === 'grouping_vlm');
    const main = calls.find((c) => {
      const role = String(c?.role);
      return role === 'translation_main' || role === 'translation_main_numbered';
    });
    const fallbacks = calls.filter((c) => c !== grouping && c !== main);
    detailEls.vlmInput.value = grouping ? callInputText(grouping) : '';
    detailEls.vlmResponse.value = grouping ? callResponseText(grouping) : '';
    detailEls.xlateSystem.value = main ? String(main?.payload?.instructions || '') : '';
    detailEls.xlateInput.value = main ? callInputText(main) : '';
    detailEls.xlateResponse.value = main ? callResponseText(main) : '';
    detailEls.fallbacks.value = fallbacks.length ? fallbacks.map(formatCall).join('\n\n──────────\n\n') : '';
  }

  function clearCallDetails() {
    for (const el of Object.values(detailEls)) el.value = '';
  }

  function callInputText(call) {
    const input = call?.payload?.input;
    if (Array.isArray(input)) {
      return input.filter((p) => p && p.type === 'text').map((p) => String(p.text || '')).join('\n');
    }
    return String(input || '');
  }

  function callResponseText(call) {
    return String(call?.response?.output_text || '');
  }

  function formatCall(call) {
    const system = String(call?.payload?.instructions || '');
    return [
      `# ${String(call?.role || 'call')}`,
      system ? `[system]\n${system}` : '',
      `[input]\n${callInputText(call)}`,
      `[response]\n${callResponseText(call)}`,
    ].filter(Boolean).join('\n');
  }

  // Only the currently-loaded pool models (green). The service's configured default model
  // always appears too: green if it happens to be loaded, otherwise added in red so it's
  // clear the default isn't loaded right now. One pick drives grouping + translation.
  async function loadModelChoices() {
    let models = [];
    let defaultModel = '';
    try {
      const [adminPayload, statusPayload] = await Promise.all([
        api.getAdminModels(),
        api.getTranslationStatus().catch(() => null),
      ]);
      models = Array.isArray(adminPayload?.models) ? adminPayload.models : [];
      defaultModel = String(statusPayload?.llm_pool?.translator_model || '');
    } catch {
      models = [];
    }
    const loaded = models
      .filter((m) => String(m?.runtime_state || '').toLowerCase() === 'loaded')
      .map((m) => String(m?.name || ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'nl', { sensitivity: 'base' }));
    const entries = loaded.map((name) => ({ name, loaded: true }));
    if (defaultModel && !loaded.includes(defaultModel)) {
      entries.push({ name: defaultModel, loaded: false });
    }
    const previous = String(modelSelect.value || '');
    modelSelect.innerHTML = entries.length
      ? entries.map((m) => `<option value="${escapeAttr(m.name)}" class="${m.loaded ? 'is-loaded' : 'is-unloaded'}">${escapeHtml(m.name)}</option>`).join('')
      : '<option value="">(no models)</option>';
    if (previous && entries.some((m) => m.name === previous)) {
      modelSelect.value = previous;
    } else if (defaultModel && entries.some((m) => m.name === defaultModel)) {
      modelSelect.value = defaultModel;
    } else {
      modelSelect.value = entries[0]?.name || '';
    }
    updateModelSelectColor();
    setBusy(isBusy);
  }

  function updateModelSelectColor() {
    const option = modelSelect.selectedOptions && modelSelect.selectedOptions[0];
    modelSelect.classList.toggle('is-loaded', Boolean(option && option.classList.contains('is-loaded')));
    modelSelect.classList.toggle('is-unloaded', Boolean(option && option.classList.contains('is-unloaded')));
  }

  function renderTimings(result) {
    const timings = result?.timings || {};
    const metrics = result?.response?.metrics || {};
    const secMs = (s) => (typeof s === 'number' ? `${Math.round(s * 1000)} ms` : '—');
    const ms = (v) => (typeof v === 'number' ? `${Math.round(v)} ms` : '—');
    const total = metrics.translate_image_total_wall_ms;
    const hasData = ['pool_queue_wait_s', 'pool_run_wall_s'].some((k) => typeof timings[k] === 'number')
      || typeof total === 'number';
    if (!hasData) {
      timingsEl.innerHTML = '<div class="trt-row trt-placeholder"><span>Run a request to see stage timings.</span></div>';
      return;
    }
    const row = (label, value, cls = '') => `<div class="trt-row ${cls}"><span>${label}</span><strong>${value}</strong></div>`;
    // Stage row with its share of the pipeline total — so the breakdown reads as "what does the
    // pipeline itself cost". grouping = the VLM hint (inference); align = our cell->unit matching;
    // render = re-placement; the two overlays are 0 unless debug_overlays was requested.
    const stage = (label, v) => {
      if (typeof v !== 'number') return row(label, '—', 'trt-l1');
      const pct = typeof total === 'number' && total > 0 ? ` · ${Math.round((v / total) * 100)}%` : '';
      return row(label, `${Math.round(v)} ms${pct}`, 'trt-l1');
    };
    timingsEl.innerHTML = [
      row('Queue wait', secMs(timings.pool_queue_wait_s)),
      row('Pipeline total', ms(total), 'trt-total'),
      stage('OCR', metrics.ocr_wall_ms),
      stage('Grouping (VLM)', metrics.grouping_wall_ms),
      stage('Align', metrics.align_wall_ms),
      stage('Translation', metrics.translation_wall_ms),
      stage('Render', metrics.replacement_wall_ms),
      stage('OCR overlay', metrics.ocr_overlay_wall_ms),
      stage('Grouping overlay', metrics.grouping_overlay_wall_ms),
    ].join('');
  }

  function updateInputPreview() {
    const file = selectedFile();
    if (inputObjectUrl) {
      URL.revokeObjectURL(inputObjectUrl);
      inputObjectUrl = '';
    }
    if (!file) {
      inputPreview.hidden = true;
      inputPreview.removeAttribute('src');
      inputEmpty.hidden = false;
      setBusy(isBusy);
      return;
    }
    inputObjectUrl = URL.createObjectURL(file);
    inputPreview.src = inputObjectUrl;
    inputPreview.hidden = false;
    inputEmpty.hidden = true;
    setBusy(isBusy);
  }

  function clearOutputPreview() {
    clearCallDetails();
    lastPreviewResult = null;
    previewArtifactSelect.innerHTML = '<option value="">No artifact</option>';
    previewArtifactSelect.disabled = true;
    outputLabel.textContent = 'Artifact';
    outputPreview.hidden = true;
    outputPreview.removeAttribute('src');
    outputEmpty.hidden = false;
    comparePreview.hidden = true;
    comparePreview.removeAttribute('src');
    toggleInput.checked = false;
    toggleLabel.hidden = true;
  }

  function updatePreviewZoom() {
    const value = Math.max(25, Math.min(180, Number(previewZoomInput.value) || 70));
    container.style.setProperty('--translation-preview-size', `${value}%`);
    previewZoomValue.textContent = `${value}%`;
  }

  function renderOutputPreview(result) {
    lastPreviewResult = result || null;
    const requestId = String(result?.request_id || currentRequestId || '');
    const entries = updateArtifactOptions(result);
    const artifactName = String(previewArtifactSelect.value || '');
    if (!requestId || !artifactName || !entries.some((entry) => entry.name === artifactName)) {
      clearOutputPreview();
      return;
    }
    outputLabel.textContent = artifactLabel(artifactName);
    outputPreview.src = `/api/translation/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(artifactName)}?ts=${Date.now()}`;
    outputPreview.hidden = false;
    outputEmpty.hidden = true;
    const hasInput = Boolean(result?.response?.artifacts?.input);
    if (hasInput) {
      comparePreview.src = `/api/translation/requests/${encodeURIComponent(requestId)}/artifacts/input`;
      toggleLabel.hidden = false;
    } else {
      comparePreview.removeAttribute('src');
      toggleInput.checked = false;
      toggleLabel.hidden = true;
    }
    applyToggle();
  }

  function applyToggle() {
    if (!outputPreview.getAttribute('src')) return;
    const showOriginal = toggleInput.checked && Boolean(comparePreview.getAttribute('src'));
    outputPreview.hidden = showOriginal;
    comparePreview.hidden = !showOriginal;
  }

  function updateArtifactOptions(result) {
    const entries = imageArtifactEntries(result);
    const previous = String(previewArtifactSelect.value || '');
    previewArtifactSelect.innerHTML = entries.length > 0
      ? entries.map((entry) => `<option value="${escapeAttr(entry.name)}">${escapeHtml(artifactLabel(entry.name))}</option>`).join('')
      : '<option value="">No artifact</option>';
    previewArtifactSelect.disabled = entries.length === 0;
    if (entries.some((entry) => entry.name === previous)) {
      previewArtifactSelect.value = previous;
    } else {
      previewArtifactSelect.value = entries[0]?.name || '';
    }
    return entries;
  }

  function imageArtifactEntries(result) {
    const artifacts = result?.response?.artifacts || {};
    const names = Object.keys(artifacts).filter((name) => {
      const artifact = artifacts[name] || {};
      return name !== 'input' && String(artifact.mime_type || '').startsWith('image/');
    });
    return names
      .sort((left, right) => artifactRank(left) - artifactRank(right) || left.localeCompare(right, 'nl', { sensitivity: 'base' }))
      .map((name) => ({ name, artifact: artifacts[name] }));
  }

  function artifactRank(name) {
    const index = IMAGE_ARTIFACT_ORDER.indexOf(String(name || ''));
    return index === -1 ? IMAGE_ARTIFACT_ORDER.length : index;
  }

  function artifactLabel(name) {
    return IMAGE_ARTIFACT_LABELS[name] || String(name || 'Artifact');
  }

  fileInput.addEventListener('change', updateInputPreview);
  toggleInput.addEventListener('change', applyToggle);
  previewZoomInput.addEventListener('input', updatePreviewZoom);
  previewArtifactSelect.addEventListener('change', () => {
    if (lastPreviewResult) renderOutputPreview(lastPreviewResult);
  });
  modelSelect.addEventListener('change', updateModelSelectColor);
  submitBtn.addEventListener('click', () => submitRequest());
  cancelBtn.addEventListener('click', cancelRequest);
  retranslateBtn.addEventListener('click', retranslateRequest);

  container.__onDeactivate = () => {
    stopPolling();
  };
  container.__destroy = () => {
    stopPolling();
    if (inputObjectUrl) {
      URL.revokeObjectURL(inputObjectUrl);
      inputObjectUrl = '';
    }
  };

  clearOutputPreview();
  updatePreviewZoom();
  updateInputPreview();
  renderTimings(null);
  populateLanguageSelect();
  retranslateLangSelect.value = String(targetInput.value || 'nl').trim() || 'nl';
  setBusy(false);
  loadPromptChoices();
  loadModelChoices();
  return container;
}
