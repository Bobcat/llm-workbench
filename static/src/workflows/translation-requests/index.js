import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';
import { TRANSLATION_LANGUAGES } from '../../shared/translation-languages.js';

const POLL_INTERVAL_MS = 800;
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const IMAGE_ARTIFACT_ORDER = ['rendered', 'grouping_overlay_debug', 'projected_overlay_debug', 'output', 'rectified_debug', 'debug_overlay'];
const IMAGE_ARTIFACT_LABELS = {
  rendered: 'Translated',
  grouping_overlay_debug: 'Grouping',
  projected_overlay_debug: 'Text planes',
  output: 'Output',
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
            <label class="translation-prompts-field translation-prompts-field-response">
              <span>LLM input (sent)</span>
              <textarea id="translationRequestInput" rows="10" readonly placeholder="The user-prompt input sent to the LLM — copy into the Prompt Library to experiment."></textarea>
            </label>
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
  const inputEl = container.querySelector('#translationRequestInput');
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
    };
    const sourceLang = String(sourceInput.value || '').trim();
    if (sourceLang) payload.source_lang_code = sourceLang;
    const targetLang = String(targetInput.value || '').trim();
    if (targetLang) payload.target_lang_code = targetLang;
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
    inputEl.value = String(result?.response?.metadata?.translation_input || '');
    renderTimings(result);
    setBusy(isBusy);
  }

  function renderTimings(result) {
    const timings = result?.timings || {};
    const metrics = result?.response?.metrics || {};
    const secMs = (s) => (typeof s === 'number' ? `${Math.round(s * 1000)} ms` : '—');
    const ms = (v) => (typeof v === 'number' ? `${Math.round(v)} ms` : '—');
    const hasData = ['pool_queue_wait_s', 'pool_run_wall_s'].some((k) => typeof timings[k] === 'number')
      || typeof metrics.translate_image_total_wall_ms === 'number';
    if (!hasData) {
      timingsEl.innerHTML = '<div class="trt-row trt-placeholder"><span>Run a request to see stage timings.</span></div>';
      return;
    }
    const row = (label, value, cls = '') => `<div class="trt-row ${cls}"><span>${label}</span><strong>${value}</strong></div>`;
    timingsEl.innerHTML = [
      row('Queue wait', secMs(timings.pool_queue_wait_s)),
      row('Pool run', secMs(timings.pool_run_wall_s), 'trt-total'),
      row('Pipeline total', ms(metrics.translate_image_total_wall_ms), 'trt-l1'),
      row('OCR', ms(metrics.ocr_wall_ms), 'trt-l2'),
      row('Grouping', ms(metrics.grouping_wall_ms), 'trt-l2'),
      row('Translation', ms(metrics.translation_wall_ms), 'trt-l2'),
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
  return container;
}
