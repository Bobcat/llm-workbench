import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const POLL_INTERVAL_MS = 800;
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const IMAGE_ARTIFACT_ORDER = ['document_unwarped_debug', 'projected_overlay_debug', 'output', 'rectified_debug', 'debug_overlay'];
const IMAGE_ARTIFACT_LABELS = {
  document_unwarped_debug: 'Document unwarped',
  projected_overlay_debug: 'Text planes',
  output: 'Output',
  rectified_debug: 'Rectified debug',
  debug_overlay: 'Debug overlay',
};

export function createImagePoolRequestsView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view image-pool-requests-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <div class="translation-prompts-content-area image-pool-requests-content">
          <section class="translation-prompts-pane translation-prompts-pane-editor image-pool-requests-form-pane">
            <label class="translation-prompts-field">
              <span>Image</span>
              <input id="imagePoolRequestFile" type="file" accept="image/png,image/jpeg,image/webp">
            </label>
            <div class="translation-prompts-language-grid image-pool-requests-grid">
              <label class="translation-prompts-field">
                <span>Task</span>
                <select id="imagePoolRequestTask">
                  <option value="translate_text">translate_text</option>
                  <option value="edit_image">edit_image</option>
                </select>
              </label>
              <label class="translation-prompts-field">
                <span>Model</span>
                <select id="imagePoolRequestModel"></select>
              </label>
            </div>
            <div class="translation-prompts-language-grid image-pool-requests-grid">
              <label class="translation-prompts-field">
                <span>Source language</span>
                <input id="imagePoolRequestSource" value="en" placeholder="en" autocomplete="off">
              </label>
              <label class="translation-prompts-field">
                <span>Target language</span>
                <input id="imagePoolRequestTarget" value="nl" placeholder="nl" autocomplete="off">
              </label>
            </div>
            <div class="translation-prompts-language-grid image-pool-requests-grid">
              <label class="translation-prompts-field">
                <span>OCR route</span>
                <select id="imagePoolRequestOcrRoute">
                  <option value="scene">Scene OCR</option>
                  <option value="document">Document OCR</option>
                </select>
              </label>
              <label class="translation-prompts-field">
                <span>Document unwarp</span>
                <select id="imagePoolRequestOcrUnwarp">
                  <option value="false">off</option>
                  <option value="true">on</option>
                </select>
              </label>
            </div>
            <label class="translation-prompts-field">
              <span>Translator model</span>
              <input id="imagePoolRequestTranslator" placeholder="leave empty for image-pool default">
            </label>
            <label class="translation-prompts-field">
              <span>Translator mode</span>
              <select id="imagePoolRequestTranslatorMode">
                <option value="auto">auto</option>
                <option value="translategemma">translategemma</option>
                <option value="generic">generic</option>
              </select>
            </label>
            <label class="translation-prompts-field">
              <span>Instruction</span>
              <textarea id="imagePoolRequestInstruction" rows="4" placeholder="For edit_image: remove the cars in the background"></textarea>
            </label>
            <label class="translation-prompts-field">
              <span>Request id</span>
              <input id="imagePoolRequestId" placeholder="leave empty for automatic id">
            </label>
            <div class="translation-prompts-run-actions">
              <button type="button" id="imagePoolRequestSubmit">Submit</button>
              <button type="button" id="imagePoolRequestCancel" disabled>Cancel</button>
              <button type="button" id="imagePoolRequestRefreshModels">Refresh models</button>
            </div>
            <div class="translation-prompts-inline-status" id="imagePoolRequestStatus">Loading image models...</div>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <section class="translation-prompts-stats-block">
              <div class="translation-prompts-stats-grid image-pool-requests-stats">
                <div class="translation-prompts-stat">
                  <span>Request</span>
                  <strong id="imagePoolRequestStatId">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>State</span>
                  <strong id="imagePoolRequestStatState">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Stage</span>
                  <strong id="imagePoolRequestStatStage">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Queue</span>
                  <strong id="imagePoolRequestStatQueue">-</strong>
                </div>
              </div>
            </section>
            <label class="translation-prompts-field translation-prompts-field-response">
              <span>Raw response</span>
              <textarea id="imagePoolRequestRaw" rows="10" readonly></textarea>
            </label>
          </section>
          <section class="translation-prompts-pane image-pool-requests-preview-pane">
            <div class="translation-prompts-pane-title">Preview</div>
            <label class="image-pool-preview-zoom">
              <span>Preview size</span>
              <input id="imagePoolPreviewZoom" type="range" min="25" max="180" step="5" value="70">
              <output id="imagePoolPreviewZoomValue">70%</output>
            </label>
            <label class="image-pool-preview-artifact">
              <span>Artifact</span>
              <select id="imagePoolPreviewArtifact" disabled>
                <option value="">No artifact</option>
              </select>
            </label>
            <div class="image-pool-preview-block">
              <span>Input</span>
              <div class="image-pool-preview-frame">
                <img id="imagePoolInputPreview" alt="Selected input preview" hidden>
                <div id="imagePoolInputEmpty" class="image-pool-preview-empty">No image selected</div>
              </div>
            </div>
            <div class="image-pool-preview-block">
              <span id="imagePoolOutputLabel">Artifact</span>
              <div class="image-pool-preview-frame">
                <img id="imagePoolOutputPreview" alt="Image pool output preview" hidden>
                <div id="imagePoolOutputEmpty" class="image-pool-preview-empty">No output yet</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  const fileInput = container.querySelector('#imagePoolRequestFile');
  const taskSelect = container.querySelector('#imagePoolRequestTask');
  const modelSelect = container.querySelector('#imagePoolRequestModel');
  const sourceInput = container.querySelector('#imagePoolRequestSource');
  const targetInput = container.querySelector('#imagePoolRequestTarget');
  const ocrRouteSelect = container.querySelector('#imagePoolRequestOcrRoute');
  const ocrUnwarpSelect = container.querySelector('#imagePoolRequestOcrUnwarp');
  const translatorInput = container.querySelector('#imagePoolRequestTranslator');
  const translatorModeSelect = container.querySelector('#imagePoolRequestTranslatorMode');
  const instructionInput = container.querySelector('#imagePoolRequestInstruction');
  const requestIdInput = container.querySelector('#imagePoolRequestId');
  const submitBtn = container.querySelector('#imagePoolRequestSubmit');
  const cancelBtn = container.querySelector('#imagePoolRequestCancel');
  const refreshModelsBtn = container.querySelector('#imagePoolRequestRefreshModels');
  const statusEl = container.querySelector('#imagePoolRequestStatus');
  const statIdEl = container.querySelector('#imagePoolRequestStatId');
  const statStateEl = container.querySelector('#imagePoolRequestStatState');
  const statStageEl = container.querySelector('#imagePoolRequestStatStage');
  const statQueueEl = container.querySelector('#imagePoolRequestStatQueue');
  const rawEl = container.querySelector('#imagePoolRequestRaw');
  const inputPreview = container.querySelector('#imagePoolInputPreview');
  const inputEmpty = container.querySelector('#imagePoolInputEmpty');
  const outputPreview = container.querySelector('#imagePoolOutputPreview');
  const outputEmpty = container.querySelector('#imagePoolOutputEmpty');
  const outputLabel = container.querySelector('#imagePoolOutputLabel');
  const previewZoomInput = container.querySelector('#imagePoolPreviewZoom');
  const previewZoomValue = container.querySelector('#imagePoolPreviewZoomValue');
  const previewArtifactSelect = container.querySelector('#imagePoolPreviewArtifact');

  let models = [];
  let isBusy = false;
  let currentRequestId = '';
  let pollTimer = null;
  let inputObjectUrl = '';
  let lastPreviewResult = null;

  function setStatus(message, kind = '') {
    statusEl.textContent = String(message || '');
    statusEl.classList.toggle('is-error', kind === 'error');
  }

  function setBusy(nextBusy) {
    isBusy = Boolean(nextBusy);
    submitBtn.disabled = isBusy || !selectedFile() || loadedModels().length === 0;
    fileInput.disabled = isBusy;
    taskSelect.disabled = isBusy;
    modelSelect.disabled = isBusy;
    sourceInput.disabled = isBusy;
    targetInput.disabled = isBusy;
    ocrRouteSelect.disabled = isBusy || String(taskSelect.value || '') !== 'translate_text';
    ocrUnwarpSelect.disabled = isBusy || String(taskSelect.value || '') !== 'translate_text';
    translatorInput.disabled = isBusy;
    translatorModeSelect.disabled = isBusy;
    instructionInput.disabled = isBusy;
    requestIdInput.disabled = isBusy;
    refreshModelsBtn.disabled = isBusy;
    cancelBtn.disabled = !currentRequestId || isTerminalState(currentState());
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

  function loadedModels() {
    return models
      .filter((model) => model.runtimeState === 'loaded')
      .sort((left, right) => left.name.localeCompare(right.name, 'nl', { sensitivity: 'base' }));
  }

  function renderModelOptions() {
    const loaded = loadedModels();
    const previous = String(modelSelect.value || '');
    modelSelect.innerHTML = loaded.length > 0
      ? loaded.map((model) => `<option value="${escapeAttr(model.id)}">${escapeHtml(model.name)}</option>`).join('')
      : '<option value="">No loaded image models</option>';
    if (loaded.some((model) => model.id === previous)) {
      modelSelect.value = previous;
    }
    setBusy(isBusy);
  }

  function normalizeModelsPayload(payload) {
    const list = Array.isArray(payload?.models) ? payload.models : [];
    return list
      .map((model) => ({
        id: String(model?.name || '').trim(),
        name: String(model?.name || '').trim(),
        runtimeState: String(model?.runtime_state || 'unloaded').trim().toLowerCase(),
      }))
      .filter((model) => model.id !== '');
  }

  async function loadModels() {
    setBusy(true);
    setStatus('Loading image models...');
    try {
      models = normalizeModelsPayload(await api.getImageAdminModels());
      renderModelOptions();
      setStatus(loadedModels().length > 0 ? '' : 'No loaded image models available.', loadedModels().length > 0 ? '' : 'error');
    } catch (err) {
      models = [];
      renderModelOptions();
      setStatus(formatApiError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  function buildRequestPayload() {
    const payload = {
      task: String(taskSelect.value || 'translate_text'),
      model: String(modelSelect.value || '').trim(),
      priority: 'normal',
    };
    const requestId = String(requestIdInput.value || '').trim();
    if (requestId) payload.request_id = requestId;
    const sourceLang = String(sourceInput.value || '').trim();
    if (sourceLang) payload.source_lang_code = sourceLang;
    const targetLang = String(targetInput.value || '').trim();
    if (targetLang) payload.target_lang_code = targetLang;
    const ocrRoute = String(ocrRouteSelect.value || '').trim();
    if (payload.task === 'translate_text' && ocrRoute) payload.ocr_route = ocrRoute;
    if (payload.task === 'translate_text') {
      payload.ocr_unwarp = String(ocrUnwarpSelect.value || '') === 'true';
    }
    const translatorModel = String(translatorInput.value || '').trim();
    if (translatorModel) payload.translator_model = translatorModel;
    const translatorMode = String(translatorModeSelect.value || '').trim();
    if (translatorMode) payload.translator_mode = translatorMode;
    const instruction = String(instructionInput.value || '').trim();
    if (instruction) payload.instruction = instruction;
    return payload;
  }

  async function submitRequest() {
    const file = selectedFile();
    if (!file) {
      setStatus('Select an image first.', 'error');
      return;
    }
    if (!String(modelSelect.value || '').trim()) {
      setStatus('Select a loaded image model.', 'error');
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

  function applyLifecycle(result) {
    const requestId = String(result?.request_id || '');
    if (requestId) currentRequestId = requestId;
    statIdEl.textContent = requestId || '-';
    statStateEl.textContent = String(result?.state || '-');
    statStageEl.textContent = String(result?.stage || '-');
    statQueueEl.textContent = result?.queue_position == null ? '-' : String(result.queue_position);
    rawEl.value = JSON.stringify(result || {}, null, 2);
    setBusy(isBusy);
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
  }

  function updatePreviewZoom() {
    const value = Math.max(25, Math.min(180, Number(previewZoomInput.value) || 70));
    container.style.setProperty('--image-pool-preview-size', `${value}%`);
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
    outputPreview.src = `/api/image-pool/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(artifactName)}?ts=${Date.now()}`;
    outputPreview.hidden = false;
    outputEmpty.hidden = true;
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
  previewZoomInput.addEventListener('input', updatePreviewZoom);
  previewArtifactSelect.addEventListener('change', () => {
    if (lastPreviewResult) renderOutputPreview(lastPreviewResult);
  });
  submitBtn.addEventListener('click', submitRequest);
  cancelBtn.addEventListener('click', cancelRequest);
  refreshModelsBtn.addEventListener('click', loadModels);
  taskSelect.addEventListener('change', () => {
    const task = String(taskSelect.value || '');
    if (task === 'edit_image' && !instructionInput.value.trim()) {
      instructionInput.placeholder = 'remove the cars in the background';
    }
    setBusy(isBusy);
  });
  ocrRouteSelect.addEventListener('change', () => {
    setBusy(isBusy);
  });

  container.__onActivate = () => {
    loadModels();
  };
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
  loadModels();
  return container;
}
