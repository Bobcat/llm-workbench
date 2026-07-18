import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';
import { TRANSLATION_LANGUAGES } from '../../shared/translation-languages.js';

// Mirrors the image-translation view (../translation-requests/), but the input and both
// preview frames are PDFs shown in <iframe>s, and the workflow proxies to the translation-
// services PDF endpoints (/api/pdf-translation/*). The upstream translate_pdf pipeline is not
// built yet; until it lands a submit surfaces the backend's error in the status line.

const TRANSLATE_PROMPT_FORMAT = 'translategemma_template';
const POLL_INTERVAL_MS = 900;
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);

export function createPdfTranslationView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view translation-requests-view pdf-translation-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <div class="translation-requests-content translation-requests-stacked">

          <section class="translation-requests-stage">
            <div class="translation-requests-stage-bar">
              <div class="translation-requests-bar-left">
                <label class="translation-requests-barfield">
                  <span>Target</span>
                  <select id="pdfTarget"></select>
                </label>
                <label class="translation-requests-showtoggle translation-requests-loaded-only">
                  <span>Show original</span>
                  <input type="checkbox" id="pdfShowOriginal">
                  <span class="translation-requests-switch" aria-hidden="true"></span>
                </label>
              </div>
              <div class="translation-requests-bar-right translation-requests-loaded-only">
                <button type="button" id="pdfBenchmarkBtn" class="pdf-translation-benchmark" hidden
                  title="Measure &amp; score this result against its source (layout / anchors / typography); the run lands in the PDF-testing comparison as 'ours'">Benchmark this run</button>
                <a id="pdfDownload" class="pdf-translation-download" download hidden>Download PDF</a>
                <button type="button" id="pdfReset" class="translation-requests-reset" title="Choose another PDF" aria-label="Choose another PDF">✕</button>
              </div>
            </div>

            <!-- Empty state: drop zone + browse (picking a file auto-submits). -->
            <div class="translation-requests-dropzone" id="pdfDropzone">
              <input id="pdfFile" type="file" accept="application/pdf" hidden>
              <div class="translation-requests-dropzone-drop">
                <svg class="translation-requests-dropzone-cloud" viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M7 18a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.5-1.5A3.5 3.5 0 0 1 18 18H7z"/>
                  <path d="M12 15V9m-2.5 2.5L12 9l2.5 2.5"/>
                </svg>
                <div class="translation-requests-dropzone-hint">Drag and drop a PDF</div>
              </div>
              <div class="translation-requests-dropzone-sep"></div>
              <div class="translation-requests-dropzone-choose">
                <span>Or choose a file</span>
                <button type="button" id="pdfBrowseBtn" class="translation-requests-browse-btn">Browse your files</button>
              </div>
            </div>

            <!-- Loaded state: the two document frames. -->
            <div class="translation-requests-stage-loaded" id="pdfStageLoaded" hidden>
              <div class="translation-requests-frames">
                <div class="translation-preview-block translation-requests-frame-original">
                  <div class="translation-preview-frame pdf-translation-frame">
                    <iframe id="pdfInputPreview" title="Original PDF" hidden></iframe>
                    <div id="pdfInputEmpty" class="translation-preview-empty">No PDF</div>
                  </div>
                </div>
                <div class="translation-preview-block translation-requests-frame-translated">
                  <div class="translation-preview-frame pdf-translation-frame">
                    <iframe id="pdfOutputPreview" title="Translated PDF" hidden></iframe>
                    <div id="pdfOutputEmpty" class="translation-preview-empty">No output yet</div>
                    <div id="pdfOutputPending" class="translation-preview-pending" hidden>
                      <div class="translation-spinner" aria-hidden="true"></div>
                      <div class="translation-preview-pending-label">Translating…</div>
                      <button type="button" id="pdfCancelBtn" class="translation-preview-cancel">Cancel</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="translation-prompts-inline-status translation-requests-status" id="pdfStatus"></div>
          </section>

          <section class="translation-requests-controls">
            <details class="translation-prompts-system-details translation-requests-details">
              <summary>Settings</summary>
              <div class="translation-requests-details-body">
                <div class="translation-requests-model-grid">
                  <label class="translation-prompts-field">
                    <span>Grouping model</span>
                    <select id="pdfModel"><option value="">Loading models…</option></select>
                  </label>
                  <label class="translation-prompts-field">
                    <span>Translation model</span>
                    <select id="pdfTranslatorModel"><option value="">Same as grouping model</option></select>
                  </label>
                </div>
              </div>
            </details>
            <div class="translation-requests-controls-cols">
              <section class="translation-prompts-stats-block">
                <div class="translation-prompts-stat translation-requests-id-stat">
                  <span>Request</span>
                  <strong id="pdfStatId">-</strong>
                </div>
                <div class="translation-prompts-stats-grid translation-requests-stats">
                  <div class="translation-prompts-stat">
                    <span>State</span>
                    <strong id="pdfStatState">-</strong>
                  </div>
                  <div class="translation-prompts-stat">
                    <span>Stage</span>
                    <strong id="pdfStatStage">-</strong>
                  </div>
                  <div class="translation-prompts-stat">
                    <span>Pages</span>
                    <strong id="pdfStatPages">-</strong>
                  </div>
                  <div class="translation-prompts-stat">
                    <span>Queue</span>
                    <strong id="pdfStatQueue">-</strong>
                  </div>
                </div>
              </section>
            </div>
            <!-- Freeze this completed run as a document regression fixture (frozen per-page
                 cells/hint/translations + approved snapshots + accepted benchmark score). The
                 fixture then lives in the PDF translation regression view. Same shape as the
                 image "Regression fixture" panel: a status badge + a Capture button. PDF capture
                 is self-contained (it stores source.pdf inside the fixture), so there is no
                 separate "add to testset" step — the source is matched to a testset document by
                 content hash, or captured under a name you type. -->
            <details class="translation-prompts-system-details translation-requests-details">
              <summary>Regression fixture</summary>
              <div class="translation-requests-details-body pdf-translation-capture">
                <div class="translation-prompts-inline-status" id="pdfRegInfo"></div>
                <label class="translation-prompts-field pdf-translation-capture-namefield">
                  <span>Name (blank = matching testset document)</span>
                  <input type="text" id="pdfRegName" spellcheck="false" placeholder="auto">
                </label>
                <label class="pdf-translation-capture-check">
                  <input type="checkbox" id="pdfRegScore" checked>
                  <span>freeze accepted score</span>
                </label>
                <div class="translation-prompts-run-actions">
                  <button type="button" id="pdfRegCaptureBtn" disabled
                    title="Freeze this completed result as a document regression fixture">Capture fixture</button>
                </div>
                <div class="translation-prompts-inline-status" id="pdfRegCaptureStatus"></div>
              </div>
            </details>
            <details class="translation-prompts-system-details translation-requests-details">
              <summary>Raw response</summary>
              <div class="translation-requests-details-body">
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>Raw response</span>
                  <textarea id="pdfRaw" rows="10" readonly></textarea>
                </label>
              </div>
            </details>
          </section>

        </div>
      </div>
    </div>
  `;

  const fileInput = container.querySelector('#pdfFile');
  const targetInput = container.querySelector('#pdfTarget');
  const statusEl = container.querySelector('#pdfStatus');
  const statIdEl = container.querySelector('#pdfStatId');
  const statStateEl = container.querySelector('#pdfStatState');
  const statStageEl = container.querySelector('#pdfStatStage');
  const statPagesEl = container.querySelector('#pdfStatPages');
  const statQueueEl = container.querySelector('#pdfStatQueue');
  const rawEl = container.querySelector('#pdfRaw');
  const modelSelect = container.querySelector('#pdfModel');
  const translatorSelect = container.querySelector('#pdfTranslatorModel');
  const inputPreview = container.querySelector('#pdfInputPreview');
  const inputEmpty = container.querySelector('#pdfInputEmpty');
  const outputPreview = container.querySelector('#pdfOutputPreview');
  const outputEmpty = container.querySelector('#pdfOutputEmpty');
  const outputPending = container.querySelector('#pdfOutputPending');
  const outputPendingLabel = container.querySelector('.translation-preview-pending-label');
  const cancelBtn = container.querySelector('#pdfCancelBtn');
  const downloadLink = container.querySelector('#pdfDownload');
  const benchmarkBtn = container.querySelector('#pdfBenchmarkBtn');
  const regInfoEl = container.querySelector('#pdfRegInfo');
  const regNameInput = container.querySelector('#pdfRegName');
  const regScoreInput = container.querySelector('#pdfRegScore');
  const regCaptureBtn = container.querySelector('#pdfRegCaptureBtn');
  const regCaptureStatusEl = container.querySelector('#pdfRegCaptureStatus');
  const stageEl = container.querySelector('.translation-requests-stage');
  const dropzone = container.querySelector('#pdfDropzone');
  const stageLoaded = container.querySelector('#pdfStageLoaded');
  const browseBtn = container.querySelector('#pdfBrowseBtn');
  const resetBtn = container.querySelector('#pdfReset');
  const showOriginalToggle = container.querySelector('#pdfShowOriginal');

  let isBusy = false;
  let modelFormats = {};  // model name -> prompt_format, to route a translategemma translator model
  let currentRequestId = '';
  let pollTimer = null;
  let inputObjectUrl = '';
  let lastTargetLang = '';
  let regStatus = null;   // {name, in_testset, langs} for the current completed run (capture badge)

  function setStatus(message, kind = '') {
    statusEl.textContent = kind === 'error' ? String(message || '') : '';
    statusEl.classList.toggle('is-error', kind === 'error');
  }

  function setBusy(nextBusy) {
    isBusy = Boolean(nextBusy);
    fileInput.disabled = isBusy;
    if (browseBtn) browseBtn.disabled = isBusy;
    targetInput.disabled = isBusy;
    modelSelect.disabled = isBusy;
    translatorSelect.disabled = isBusy;
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

  // Translator fields for a request: the explicit "Translation model" pick, else the grouping model.
  // A translategemma_template model routes with translator_mode "translategemma"; other models leave
  // the mode to the service default.
  function translatorFields(groupingModel) {
    const translatorModel = String(translatorSelect.value || '').trim() || groupingModel;
    if (!translatorModel) return {};
    const fields = { translator_model: translatorModel };
    if (modelFormats[translatorModel] === TRANSLATE_PROMPT_FORMAT) fields.translator_mode = 'translategemma';
    return fields;
  }

  function buildRequestPayload() {
    const payload = {
      task: 'translate_pdf',
      priority: 'normal',
      // Source is auto-detected downstream; send a fixed 'auto' to satisfy the pipeline's guard.
      source_lang_code: 'auto',
    };
    const targetLang = String(targetInput.value || '').trim();
    if (targetLang) payload.target_lang_code = targetLang;
    lastTargetLang = targetLang;
    const model = String(modelSelect.value || '').trim();
    if (model) payload.grouping_model = model;
    Object.assign(payload, translatorFields(model));
    return payload;
  }

  async function submitRequest() {
    const file = selectedFile();
    if (!file) {
      setStatus('Select a PDF first.', 'error');
      return;
    }
    stopPolling();
    clearOutputPreview();
    setBusy(true);
    showPending('Translating…');
    try {
      const formData = new FormData();
      formData.append('request_json', JSON.stringify(buildRequestPayload()));
      formData.append('document_file', file);
      const result = await api.submitPdfRequest(formData);
      applyLifecycle(result);
      currentRequestId = String(result?.request_id || '');
      if (currentRequestId && !isTerminalState(result?.state)) {
        startPolling();
      } else {
        renderOutputPreview(result);
      }
    } catch (err) {
      hidePending();
      setStatus(formatApiError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function pollOnce() {
    if (!currentRequestId) return;
    try {
      const result = await api.getPdfRequest(currentRequestId);
      applyLifecycle(result);
      if (isTerminalState(result?.state)) {
        stopPolling();
        renderOutputPreview(result);
      }
    } catch (err) {
      stopPolling();
      hidePending();
      setStatus(formatApiError(err), 'error');
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
    try {
      const result = await api.cancelPdfRequest(currentRequestId);
      applyLifecycle(result);
      if (isTerminalState(result?.state)) {
        stopPolling();
        renderOutputPreview(result);
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
    statIdEl.title = requestId || '';
    statStateEl.textContent = String(result?.state || '-');
    statStageEl.textContent = String(result?.stage || '-');
    statQueueEl.textContent = result?.queue_position == null ? '-' : String(result.queue_position);
    statPagesEl.textContent = formatPages(result);
    rawEl.value = JSON.stringify(result || {}, null, 2);
  }

  // Per-page progress if the pipeline reports it: a done/total pair carried on the lifecycle
  // record or the document response. Absent until the upstream reports it, then shows "x/y".
  function formatPages(result) {
    const done = result?.pages_done ?? result?.response?.document?.pages_done;
    const total = result?.pages_total ?? result?.response?.document?.pages_total ?? result?.page_count;
    if (total == null && done == null) return '-';
    if (total == null) return String(done);
    return `${done == null ? 0 : done}/${total}`;
  }

  function populateLanguageSelect() {
    targetInput.innerHTML = TRANSLATION_LANGUAGES
      .map((l) => `<option value="${escapeAttr(l.code)}">${escapeHtml(`${l.flag} ${l.name}`)}</option>`)
      .join('');
    targetInput.value = 'nl';
  }

  // Only the currently-loaded pool models (green), plus the service's configured default (added
  // in red if not loaded). One pick drives grouping + translation, like the image view.
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
    modelFormats = Object.fromEntries(
      models.map((m) => [String(m?.name || ''), String(m?.definition?.prompt_format || '').trim().toLowerCase()]),
    );
    const loaded = models
      .filter((m) => String(m?.runtime_state || '').toLowerCase() === 'loaded')
      .map((m) => String(m?.name || ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'nl', { sensitivity: 'base' }));
    const entries = loaded.map((name) => ({ name, loaded: true }));
    if (defaultModel && !loaded.includes(defaultModel)) entries.push({ name: defaultModel, loaded: false });
    const optionsMarkup = entries.length
      ? entries.map((m) => `<option value="${escapeAttr(m.name)}" class="${m.loaded ? 'is-loaded' : 'is-unloaded'}">${escapeHtml(m.name)}</option>`).join('')
      : '<option value="">(no models)</option>';
    const pick = (select, preferDefault) => {
      const previous = String(select.value || '');
      select.innerHTML = optionsMarkup;
      if (previous && entries.some((m) => m.name === previous)) select.value = previous;
      else if (preferDefault && defaultModel && entries.some((m) => m.name === defaultModel)) select.value = defaultModel;
      else select.value = entries[0]?.name || '';
    };
    pick(modelSelect, true);
    pick(translatorSelect, true);
    updateModelSelectColor();
    setBusy(isBusy);
  }

  function updateModelSelectColor() {
    const option = modelSelect.selectedOptions && modelSelect.selectedOptions[0];
    modelSelect.classList.toggle('is-loaded', Boolean(option && option.classList.contains('is-loaded')));
    modelSelect.classList.toggle('is-unloaded', Boolean(option && option.classList.contains('is-unloaded')));
  }

  function applyViewMode() {
    if (stageEl) stageEl.classList.toggle('is-single', !(showOriginalToggle && showOriginalToggle.checked));
  }

  function updateStageVisibility() {
    const loaded = Boolean(selectedFile()) || Boolean(currentRequestId);
    if (dropzone) dropzone.hidden = loaded;
    if (stageLoaded) stageLoaded.hidden = !loaded;
    if (stageEl) stageEl.classList.toggle('has-image', loaded);
  }

  function showOriginalFrame() {
    const hasInput = Boolean(inputPreview.getAttribute('src'));
    inputPreview.hidden = !hasInput;
    inputEmpty.hidden = hasInput;
    updateStageVisibility();
  }

  function updateInputPreview() {
    const file = selectedFile();
    if (inputObjectUrl) {
      URL.revokeObjectURL(inputObjectUrl);
      inputObjectUrl = '';
    }
    if (!file) {
      inputPreview.removeAttribute('src');
    } else {
      inputObjectUrl = URL.createObjectURL(file);
      inputPreview.src = inputObjectUrl;
    }
    showOriginalFrame();
  }

  function clearOutputPreview() {
    outputPreview.hidden = true;
    outputPreview.removeAttribute('src');
    downloadLink.hidden = true;
    downloadLink.removeAttribute('href');
    benchmarkBtn.hidden = true;
    benchmarkBtn.textContent = 'Benchmark this run';
    outputPending.hidden = true;
    outputEmpty.hidden = false;
    regStatus = null;
    renderRegInfo();
    setCaptureStatus('');
  }

  function setCaptureStatus(message, kind = '') {
    regCaptureStatusEl.textContent = String(message || '');
    regCaptureStatusEl.classList.toggle('is-error', kind === 'error');
  }

  // The capture badge + button state, mirroring the image "Regression fixture" panel: it shows
  // the fixture name this run maps to (a testset document matched by content hash), the fixtures
  // that already exist for it, and enables Capture accordingly.
  function renderRegInfo() {
    const completed = currentState() === 'completed';
    const typedName = String(regNameInput.value || '').trim();
    const lang = String(lastTargetLang || '').toLowerCase() || '?';
    if (!completed || !regStatus) {
      regInfoEl.textContent = completed ? '' : 'Translate a PDF to capture it as a fixture.';
      regCaptureBtn.disabled = true;
      regCaptureBtn.textContent = 'Capture fixture';
      return;
    }
    const langs = regStatus.langs || {};
    const hasForLang = Array.isArray(langs[lang]) && langs[lang].length > 0;
    if (regStatus.name) {
      const fixtures = Object.keys(langs).length
        ? Object.keys(langs).sort().map((l) => `${l}: ${langs[l].join(', ')}`).join(' · ')
        : 'no fixture yet';
      regInfoEl.textContent = `${regStatus.name} · testset document · ${fixtures}`;
    } else {
      regInfoEl.textContent = typedName
        ? `${typedName} · not a testset document (capturing under this name)`
        : 'Not a testset document — type a name to capture.';
    }
    regCaptureBtn.disabled = !(regStatus.name || typedName);
    regCaptureBtn.textContent = `${hasForLang ? 'Capture variant' : 'Capture fixture'} (${lang})`;
  }

  async function refreshRegStatus() {
    if (!currentRequestId || currentState() !== 'completed') {
      regStatus = null;
      renderRegInfo();
      return;
    }
    try {
      regStatus = await api.getPdfRegressionStatus(currentRequestId);
    } catch {
      regStatus = null;  // status is a nicety; capture still works with a typed name
    }
    renderRegInfo();
  }

  function showPending(label) {
    outputPendingLabel.textContent = String(label || 'Translating…');
    outputEmpty.hidden = true;
    outputPending.hidden = false;
  }

  function hidePending() {
    outputPending.hidden = true;
    outputEmpty.hidden = !outputPreview.hidden;
  }

  // The translated document is whichever completed artifact carries a PDF mime type (the pipeline
  // names it, e.g. rendered.pdf); pick the first non-input PDF so the view survives the exact name.
  function pdfArtifactName(result) {
    const artifacts = result?.response?.artifacts || {};
    return Object.keys(artifacts).find((name) => {
      const artifact = artifacts[name] || {};
      return name !== 'input' && String(artifact.mime_type || '').toLowerCase().includes('pdf');
    }) || '';
  }

  function renderOutputPreview(result) {
    const requestId = String(result?.request_id || currentRequestId || '');
    const artifactName = pdfArtifactName(result);
    if (!requestId || !artifactName) {
      clearOutputPreview();
      return;
    }
    const url = `/api/pdf-translation/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(artifactName)}?ts=${Date.now()}`;
    outputPreview.src = url;
    outputPreview.hidden = false;
    outputEmpty.hidden = true;
    outputPending.hidden = true;
    const base = (selectedFile()?.name || 'document').replace(/\.[^.]+$/, '') || 'document';
    const lang = String(lastTargetLang || '').toLowerCase() || 'out';
    downloadLink.href = url;
    downloadLink.setAttribute('download', `${base}_${lang}.pdf`);
    downloadLink.hidden = false;
    benchmarkBtn.hidden = false;
    // Capture is only meaningful once the run completed (the fixture freezes its per-page
    // artifacts); resolve the fixture name + existing fixtures for the badge.
    refreshRegStatus();
  }

  // Freeze the completed run as a document regression fixture (design doc slice 2b). The capture
  // verifies the replay per page before writing, so a refusal (frozen-input drift, or a source not
  // in the testset without a name) comes back as a clear message.
  async function captureFixture() {
    if (!currentRequestId || currentState() !== 'completed') return;
    regCaptureBtn.disabled = true;
    setCaptureStatus('Capturing… (per-page verification replay, then the accepted-score measurement)');
    try {
      const body = { request_id: currentRequestId, freeze_score: Boolean(regScoreInput.checked) };
      const name = String(regNameInput.value || '').trim();
      if (name) body.name = name;
      const out = await api.capturePdfRegression(body);
      const scoreNote = out.accepted_scores?.axes
        ? ` · L ${out.accepted_scores.axes.layout} · A ${out.accepted_scores.axes.anchors} · T ${out.accepted_scores.axes.typography}`
        : '';
      setCaptureStatus(`Captured ${out.name}/${out.target_lang}/${out.variant}: ${out.pages} page(s), ${out.units} unit(s)${scoreNote}. See the PDF translation regression view.`);
      await refreshRegStatus();  // the new variant now shows in the badge
    } catch (err) {
      setCaptureStatus(formatApiError(err), 'error');
      renderRegInfo();
    }
  }

  // Scores the completed run against its own source (translation-services keeps
  // both artifacts); the result appears as an "ours" row in the PDF-testing view.
  async function benchmarkRun() {
    if (!currentRequestId || currentState() !== 'completed') return;
    benchmarkBtn.disabled = true;
    setStatus('');
    const originalLabel = benchmarkBtn.textContent;
    benchmarkBtn.textContent = 'Measuring…';
    try {
      const formData = new FormData();
      formData.append('request_json', JSON.stringify({ request_id: currentRequestId }));
      const result = await api.runPdfBenchmark(formData);
      const axes = result?.axes || {};
      benchmarkBtn.textContent = `L ${axes.layout} · A ${axes.anchors} · T ${axes.typography}`;
      benchmarkBtn.title = 'Scored — see the PDF testing view for the comparison';
    } catch (err) {
      benchmarkBtn.textContent = originalLabel;
      setStatus(formatApiError(err), 'error');
    } finally {
      benchmarkBtn.disabled = false;
    }
  }

  // Picking (or dropping) a PDF previews it and immediately submits — no explicit Submit.
  function onFileChosen() {
    updateInputPreview();
    if (selectedFile()) submitRequest();
  }
  fileInput.addEventListener('change', onFileChosen);

  function resetView() {
    if (currentRequestId && !isTerminalState(currentState())) cancelRequest();
    stopPolling();
    fileInput.value = '';
    currentRequestId = '';
    clearOutputPreview();
    updateInputPreview();
    setStatus('');
    updateStageVisibility();
  }

  if (browseBtn) browseBtn.addEventListener('click', () => fileInput.click());
  if (resetBtn) resetBtn.addEventListener('click', resetView);
  benchmarkBtn.addEventListener('click', benchmarkRun);
  regCaptureBtn.addEventListener('click', captureFixture);
  // Typing a name for a non-testset document enables Capture and updates the badge live.
  regNameInput.addEventListener('input', renderRegInfo);
  if (cancelBtn) cancelBtn.addEventListener('click', cancelRequest);
  if (showOriginalToggle) showOriginalToggle.addEventListener('change', applyViewMode);
  modelSelect.addEventListener('change', updateModelSelectColor);

  if (dropzone) {
    const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
    ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => {
      stop(event);
      if (!isBusy) dropzone.classList.add('is-dragover');
    }));
    ['dragleave', 'dragend'].forEach((type) => dropzone.addEventListener(type, (event) => {
      stop(event);
      dropzone.classList.remove('is-dragover');
    }));
    dropzone.addEventListener('drop', (event) => {
      stop(event);
      dropzone.classList.remove('is-dragover');
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file || isBusy) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      onFileChosen();
    });
  }

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
  applyViewMode();
  updateInputPreview();
  populateLanguageSelect();
  setBusy(false);
  loadModelChoices();
  return container;
}
