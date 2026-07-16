import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';
import { TRANSLATION_LANGUAGES } from '../../shared/translation-languages.js';

const TRANSLATE_PROMPT_FORMAT = 'translategemma_template';

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
        <div class="translation-requests-content translation-requests-stacked">

          <section class="translation-requests-stage">
            <!-- Bar above the images. The target language is ALWAYS shown (so it can be set
                 before the first drop); the image-only controls appear once an image is loaded.
                 Two cells mirror the image grid, so the Artifact control lines up above the
                 left edge of the right (translated) image. -->
            <div class="translation-requests-stage-bar">
              <div class="translation-requests-bar-left">
                <label class="translation-requests-barfield">
                  <span>Target</span>
                  <select id="translationRequestTarget"></select>
                </label>
                <label class="translation-requests-showtoggle translation-requests-loaded-only">
                  <span>Show original</span>
                  <input type="checkbox" id="translationShowOriginal">
                  <span class="translation-requests-switch" aria-hidden="true"></span>
                </label>
              </div>
              <div class="translation-requests-bar-right translation-requests-loaded-only">
                <label class="translation-preview-artifact">
                  <span>Artifact</span>
                  <select id="translationPreviewArtifact" disabled>
                    <option value="">No artifact</option>
                  </select>
                </label>
                <label class="translation-preview-zoom">
                  <input id="translationPreviewZoom" type="range" min="25" max="180" step="5" value="70">
                  <output id="translationPreviewZoomValue">70%</output>
                </label>
                <button type="button" id="translationResetImage" class="translation-requests-reset" title="Choose another image" aria-label="Choose another image">✕</button>
              </div>
            </div>

            <!-- Empty state: drop zone + browse (picking a file auto-submits). -->
            <div class="translation-requests-dropzone" id="translationDropzone">
              <input id="translationRequestFile" type="file" accept="image/png,image/jpeg,image/webp" hidden>
              <div class="translation-requests-dropzone-drop">
                <svg class="translation-requests-dropzone-cloud" viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M7 18a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.5-1.5A3.5 3.5 0 0 1 18 18H7z"/>
                  <path d="M12 15V9m-2.5 2.5L12 9l2.5 2.5"/>
                </svg>
                <div class="translation-requests-dropzone-hint">Drag and drop</div>
              </div>
              <div class="translation-requests-dropzone-sep"></div>
              <div class="translation-requests-dropzone-choose">
                <span>Or choose a file</span>
                <button type="button" id="translationBrowseBtn" class="translation-requests-browse-btn">Browse your files</button>
              </div>
            </div>

            <!-- Loaded state: the images. -->
            <div class="translation-requests-stage-loaded" id="translationStageLoaded" hidden>
              <div class="translation-requests-frames">
                <div class="translation-preview-block translation-requests-frame-original">
                  <div class="translation-preview-frame">
                    <img id="translationInputPreview" alt="Original" hidden>
                    <img id="translationComparePreview" alt="Original" hidden>
                    <div id="translationInputEmpty" class="translation-preview-empty">No image</div>
                  </div>
                </div>
                <div class="translation-preview-block translation-requests-frame-translated">
                  <div class="translation-preview-frame">
                    <img id="translationOutputPreview" alt="Translated" hidden>
                    <div id="translationOutputEmpty" class="translation-preview-empty">No output yet</div>
                    <div id="translationOutputPending" class="translation-preview-pending" hidden>
                      <div class="translation-spinner" aria-hidden="true"></div>
                      <div class="translation-preview-pending-label">Translating…</div>
                      <button type="button" id="translationCancelBtn" class="translation-preview-cancel">Cancel</button>
                    </div>
                  </div>
                  <div class="translation-requests-save-row">
                    <button type="button" id="translationSaveBtn" hidden>Save image</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Progress / result status, below the images. -->
            <div class="translation-prompts-inline-status translation-requests-status" id="translationRequestStatus"></div>
          </section>

          <section class="translation-requests-controls">
            <details class="translation-prompts-system-details translation-requests-details">
              <summary>Render</summary>
              <div class="translation-requests-details-body translation-requests-render-grid">
                <label class="translation-prompts-field">
                  <span>Render size mode</span>
                  <select id="translationRenderSizeMode" title="How a render group's one font size is chosen from its lines: median resists one under-measured (lowercase) line dragging the whole block down; min never overflows the smallest line's band. Changing this re-renders the shown result from its cached translations (no new translation).">
                    <option value="median" selected>median — default</option>
                    <option value="min">min — never overflow</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Erase fill</span>
                  <select id="translationEraseFillMode" title="How erased source text is filled. flat paints each erased line with its sampled background colour; inpaint is the hybrid model-based fill — flat paint on designed flat ground, model reconstruction where the ground varies (GPU-only).">
                    <option value="flat">flat — one colour</option>
                    <option value="inpaint" selected>inpaint — hybrid fill</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Size metric</span>
                  <select id="translationSizeMetricMode" title="Where a line's source size comes from. extent sizes from the OCR polygon's full ink extent; band clamps each line to its strong ink band scaled by the document's own norm, so sparse tall glyphs (parentheses, brackets) cannot inflate a line past its siblings (one-sided, only shrinks an outlier). fill sizes each line so its rendered ink is as tall as the source line's ink — a direct per-line pixel match that fixes translated body text reading ~10-20% smaller/airier than the print. Changing this re-renders from the cached translations (no new translation). Flat, non-CJK groups only.">
                    <option value="extent" selected>extent — polygon</option>
                    <option value="band">band — clamp outliers</option>
                    <option value="fill">fill — match source ink</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Size cohort</span>
                  <select id="translationSizeCohortMode" title="Cross-element size uniformity from the VLM font-size (pt) label. off sizes each element from its own OCR true-height. vlm groups elements the VLM gave one pt and, when their OCR heights agree, snaps the whole cohort to its OCR median — so a list the VLM judged one size renders uniform, and a short item sizes up and re-wraps over its lines instead of collapsing to one tiny line. A cohort whose OCR heights disagree keeps per-element sizing.">
                    <option value="off">off — per element</option>
                    <option value="vlm" selected>vlm — snap siblings</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Width fit</span>
                  <select id="translationWidthFitMode" title="How a translation wider than its original line is fitted. footprint keeps it inside the original line's width (condense, then shrink); extend first widens into verified clean background right of the line (never over other text, ink or a surface change), so short list items keep their size.">
                    <option value="footprint" selected>footprint — exact fit</option>
                    <option value="extend">extend — grow</option>
                  </select>
                </label>
                <label class="translation-requests-option" title="Text inside a detected image/chart region (a screenshot's labels, a figure that is really a table) keeps its original pixels by default. Uncheck to translate and render it too. Changing this re-aligns from the cached OCR + hint (no VLM/OCR) and re-translates, so it takes a translation pass, not just a re-render.">
                  <input id="translationPreserveImageRegions" type="checkbox" checked>
                  <span>Preserve figures/screenshots</span>
                </label>
              </div>
            </details>
            <details class="translation-prompts-system-details translation-requests-details">
              <summary>Settings</summary>
              <div class="translation-requests-details-body">
                <div class="translation-requests-model-grid">
                  <label class="translation-prompts-field">
                    <span>Grouping model</span>
                    <select id="translationRequestModel"><option value="">Loading models…</option></select>
                  </label>
                  <label class="translation-prompts-field">
                    <span>Translation model</span>
                    <select id="translationRequestTranslatorModel"><option value="">Same as grouping model</option></select>
                  </label>
                </div>
                <div class="translation-requests-options-row">
                  <label class="translation-requests-option">
                    <input id="translationPreserveHeuristicText" type="checkbox" checked>
                    <span>Preserve heuristic text</span>
                  </label>
                  <label class="translation-requests-option">
                    <input id="translationPreserveUnchangedText" type="checkbox">
                    <span>Preserve unchanged text</span>
                  </label>
                  <label class="translation-requests-option">
                    <input id="translationUseGeometryColumns" type="checkbox" checked>
                    <span>Geometry columns</span>
                  </label>
                </div>
                <label class="translation-prompts-field">
                  <span>Translation prompt</span>
                  <select id="translationRetranslatePrompt" title="Used by the automatic re-translate when you switch target language on a completed run; the initial run uses the pipeline default"></select>
                </label>
              </div>
            </details>
            <details class="translation-prompts-system-details translation-requests-details">
              <summary>Regression fixture</summary>
              <div class="translation-requests-details-body translation-requests-regression">
                <div class="translation-prompts-inline-status" id="translationRegressionInfo"></div>
                <div class="translation-prompts-run-actions">
                  <label class="translation-reg-subdir" title="Destination folder in the testset (the fixture mirrors it)">
                    <span>Subdir</span>
                    <select id="translationRegressionSubdir"></select>
                  </label>
                  <input type="text" id="translationRegressionSubdirNew" class="translation-reg-subdir-new" placeholder="new subdir, e.g. docpack" style="display:none">
                  <button type="button" id="translationRegressionAddTestset" disabled title="Copy this image into the testset">Add to testset</button>
                  <button type="button" id="translationRegressionCapture" disabled title="Freeze this completed result as a regression fixture (frozen units + re-OCR snapshot)">Capture fixture</button>
                </div>
                <div class="translation-prompts-inline-status" id="translationRegressionStatus"></div>
              </div>
            </details>
            <details class="translation-prompts-system-details translation-requests-details">
              <summary>Timings</summary>
              <div class="translation-requests-details-body">
                <div class="translation-requests-timings" id="translationRequestTimings"></div>
              </div>
            </details>
            <div class="translation-requests-controls-cols">
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
            </div>
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
                  <span>Geometry-adjusted columns (py)</span>
                  <textarea id="trtGeometryColumns" rows="6" spellcheck="false" placeholder="Lines where the geometry pass injected a column | the VLM missed (raw → adjusted). Fed to translation only with 'Geometry columns' on."></textarea>
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
            <details class="translation-prompts-system-details translation-requests-details">
              <summary>Raw response</summary>
              <div class="translation-requests-details-body">
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>Raw response</span>
                  <textarea id="translationRequestRaw" rows="10" readonly></textarea>
                </label>
              </div>
            </details>
          </section>

        </div>
      </div>
    </div>
  `;

  const fileInput = container.querySelector('#translationRequestFile');
  const targetInput = container.querySelector('#translationRequestTarget');
  const statusEl = container.querySelector('#translationRequestStatus');
  const statIdEl = container.querySelector('#translationRequestStatId');
  const statStateEl = container.querySelector('#translationRequestStatState');
  const statStageEl = container.querySelector('#translationRequestStatStage');
  const statQueueEl = container.querySelector('#translationRequestStatQueue');
  const timingsEl = container.querySelector('#translationRequestTimings');
  const rawEl = container.querySelector('#translationRequestRaw');
  const modelSelect = container.querySelector('#translationRequestModel');
  const translatorSelect = container.querySelector('#translationRequestTranslatorModel');
  const preserveHeuristicTextInput = container.querySelector('#translationPreserveHeuristicText');
  const preserveUnchangedTextInput = container.querySelector('#translationPreserveUnchangedText');
  const useGeometryColumnsInput = container.querySelector('#translationUseGeometryColumns');
  const preserveImageRegionsInput = container.querySelector('#translationPreserveImageRegions');
  const renderSizeModeSelect = container.querySelector('#translationRenderSizeMode');
  const eraseFillModeSelect = container.querySelector('#translationEraseFillMode');
  const widthFitModeSelect = container.querySelector('#translationWidthFitMode');
  const sizeMetricModeSelect = container.querySelector('#translationSizeMetricMode');
  const sizeCohortModeSelect = container.querySelector('#translationSizeCohortMode');
  const detailEls = {
    vlmInput: container.querySelector('#trtVlmInput'),
    vlmResponse: container.querySelector('#trtVlmResponse'),
    geometryColumns: container.querySelector('#trtGeometryColumns'),
    xlateSystem: container.querySelector('#trtXlateSystem'),
    xlateInput: container.querySelector('#trtXlateInput'),
    xlateResponse: container.querySelector('#trtXlateResponse'),
    fallbacks: container.querySelector('#trtFallbacks'),
  };
  const inputPreview = container.querySelector('#translationInputPreview');
  const inputEmpty = container.querySelector('#translationInputEmpty');
  const outputPreview = container.querySelector('#translationOutputPreview');
  const saveBtn = container.querySelector('#translationSaveBtn');
  const outputEmpty = container.querySelector('#translationOutputEmpty');
  const outputPending = container.querySelector('#translationOutputPending');
  const outputPendingLabel = container.querySelector('.translation-preview-pending-label');
  const cancelBtn = container.querySelector('#translationCancelBtn');
  const previewZoomInput = container.querySelector('#translationPreviewZoom');
  const previewZoomValue = container.querySelector('#translationPreviewZoomValue');
  const previewArtifactSelect = container.querySelector('#translationPreviewArtifact');
  const comparePreview = container.querySelector('#translationComparePreview');
  const stageEl = container.querySelector('.translation-requests-stage');
  const dropzone = container.querySelector('#translationDropzone');
  const stageLoaded = container.querySelector('#translationStageLoaded');
  const browseBtn = container.querySelector('#translationBrowseBtn');
  const resetBtn = container.querySelector('#translationResetImage');
  const showOriginalToggle = container.querySelector('#translationShowOriginal');
  const retranslatePromptSelect = container.querySelector('#translationRetranslatePrompt');
  // The fixture name is derived from the uploaded file name (the visible input was removed); shown
  // back to the user in the regression info line.
  let regressionNameValue = '';
  const regressionInfoEl = container.querySelector('#translationRegressionInfo');
  const regressionAddTestsetBtn = container.querySelector('#translationRegressionAddTestset');
  const regressionCaptureBtn = container.querySelector('#translationRegressionCapture');
  const regressionSubdirSel = container.querySelector('#translationRegressionSubdir');
  const regressionSubdirNew = container.querySelector('#translationRegressionSubdirNew');
  const regressionStatusEl = container.querySelector('#translationRegressionStatus');

  let isBusy = false;
  let modelFormats = {};  // model name -> prompt_format, to route a translategemma translator model
  let currentRequestId = '';
  let regressionStatus = null;
  let pollTimer = null;
  let inputObjectUrl = '';
  let lastPreviewResult = null;
  let savedPrompts = [];
  // The target language the last completed run actually produced — set on submit and on
  // re-translate so the capture-fixture button reflects what would be captured, not the form.
  let lastTargetLang = '';
  // 'retranslate' | 'rerender' between a re-entry submit and its terminal poll, so the shared
  // poller can replace the lingering "…ing" status with a done message when the run completes.
  let pendingAction = '';

  function setStatus(message, kind = '') {
    // Only errors are shown; the routine "Request submitted." / "Re-rendered." chatter is
    // suppressed so the status line stays empty (and collapses, see CSS :empty) and the
    // control groups sit close under the images. Progress still shows via the pending overlay.
    statusEl.textContent = kind === 'error' ? String(message || '') : '';
    statusEl.classList.toggle('is-error', kind === 'error');
  }

  function setBusy(nextBusy) {
    isBusy = Boolean(nextBusy);
    fileInput.disabled = isBusy;
    if (browseBtn) browseBtn.disabled = isBusy;
    targetInput.disabled = isBusy;
    modelSelect.disabled = isBusy;
    preserveHeuristicTextInput.disabled = isBusy;
    preserveUnchangedTextInput.disabled = isBusy;
    useGeometryColumnsInput.disabled = isBusy;
    renderSizeModeSelect.disabled = isBusy;
    eraseFillModeSelect.disabled = isBusy;
    widthFitModeSelect.disabled = isBusy;
    sizeMetricModeSelect.disabled = isBusy;
    sizeCohortModeSelect.disabled = isBusy;
    retranslatePromptSelect.disabled = isBusy;
    renderRegressionInfo();
  }

  // A completed run is in view whose caches (grouping/translations, TTL-bound) the re-entry
  // endpoints can reuse. "Still cached" is the server's call: an expired source comes back as a
  // 409 and surfaces in the status line.
  function canReenter() {
    return !isBusy && Boolean(currentRequestId) && currentState() === 'completed';
  }

  function selectedFile() {
    return fileInput.files && fileInput.files.length > 0 ? fileInput.files[0] : null;
  }

  // Download the currently shown translated-frame artifact as "<source-basename>_<target>.png".
  // WYSIWYG: saves whichever artifact the preview selector shows (usually the rendered translation);
  // same-origin /api URL, so the <a download> filename is honoured.
  function saveOutputImage() {
    const src = outputPreview.getAttribute('src');
    if (outputPreview.hidden || !src) return;
    const base = (selectedFile()?.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    const lang = String(lastTargetLang || '').toLowerCase() || 'out';
    const link = document.createElement('a');
    link.href = src;
    link.download = `${base}_${lang}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  saveBtn.addEventListener('click', saveOutputImage);

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
      use_geometry_columns: Boolean(useGeometryColumnsInput.checked),
      preserve_image_regions: Boolean(preserveImageRegionsInput.checked),
      render_size_mode: String(renderSizeModeSelect.value || 'median'),
      erase_fill_mode: String(eraseFillModeSelect.value || 'inpaint'),
      width_fit_mode: String(widthFitModeSelect.value || 'footprint'),
      size_metric_mode: String(sizeMetricModeSelect.value || 'extent'),
      size_cohort_mode: String(sizeCohortModeSelect.value || 'vlm'),
    };
    // Source is auto-detected downstream (llm-pool for translategemma) and unused by the generic
    // prompt; the dropdown was removed. Send a fixed 'auto' to satisfy the pipeline's required guard.
    payload.source_lang_code = 'auto';
    const targetLang = String(targetInput.value || '').trim();
    if (targetLang) payload.target_lang_code = targetLang;
    lastTargetLang = targetLang;
    // Grouping uses the picked model; translation uses the optional "Translation model" override
    // (else the same model). Empty = the service's configured defaults.
    const model = String(modelSelect.value || '').trim();
    if (model) payload.grouping_model = model;
    Object.assign(payload, translatorFields(model));
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
    setRegressionStatus('');
    setBusy(true);
    setStatus('Submitting image request...');
    showPending('Translating…');
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
      hidePending();
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
        finishReentry(result);
      }
    } catch (err) {
      stopPolling();
      hidePending();
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
        renderOutputPreview(result);
      }
    } catch (err) {
      setStatus(formatApiError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  function populateLanguageSelect() {
    targetInput.innerHTML = TRANSLATION_LANGUAGES
      .map((l) => `<option value="${escapeAttr(l.code)}">${escapeHtml(`${l.flag} ${l.name}`)}</option>`)
      .join('');
    targetInput.value = 'nl';
  }

  // Prompts are authored in the prompt library (#prompt-library); this view only selects
  // one from the flat list to re-translate the cached units with.
  async function loadPromptChoices() {
    try {
      const result = await api.listTranslationPrompts();
      savedPrompts = (result && result.prompts) || [];
    } catch (err) {
      savedPrompts = [];
      setStatus(formatApiError(err), 'error');
    }
    const previous = String(retranslatePromptSelect.value || '');
    retranslatePromptSelect.innerHTML = savedPrompts.length
      ? savedPrompts.map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.id)}</option>`).join('')
      : '<option value="">(no prompts)</option>';
    if (savedPrompts.some((p) => p.id === previous)) retranslatePromptSelect.value = previous;
    setBusy(isBusy);
  }

  // Fired by the top-bar language select changing while a completed run is in view.
  async function retranslateRequest() {
    if (!canReenter()) return;
    const body = {};
    const promptId = String(retranslatePromptSelect.value || '');
    if (promptId) body.translation_prompt_id = promptId;
    const lang = String(targetInput.value || '').trim();
    if (lang) {
      body.target_lang_code = lang;
      lastTargetLang = lang;
    }
    // Re-translate reuses cached grouping, so only the translator model/mode applies.
    Object.assign(body, translatorFields(String(modelSelect.value || '').trim()));
    body.preserve_heuristic_text = Boolean(preserveHeuristicTextInput.checked);
    body.preserve_unchanged_text = Boolean(preserveUnchangedTextInput.checked);
    body.use_geometry_columns = Boolean(useGeometryColumnsInput.checked);
    body.preserve_image_regions = Boolean(preserveImageRegionsInput.checked);
    body.render_size_mode = String(renderSizeModeSelect.value || 'median');
    body.erase_fill_mode = String(eraseFillModeSelect.value || 'inpaint');
    body.width_fit_mode = String(widthFitModeSelect.value || 'footprint');
    body.size_metric_mode = String(sizeMetricModeSelect.value || 'extent');
    body.size_cohort_mode = String(sizeCohortModeSelect.value || 'vlm');
    await submitReentry('retranslate', `Re-translating cached units to ${lang || '?'}...`,
      (sourceRequestId) => api.retranslateImageRequest(sourceRequestId, body));
  }

  // Fired by a Render select changing while a completed run is in view: re-render the shown
  // result from its cached translations with the new flag — no new translation, so the A/B
  // compares exactly the render.
  async function rerenderRequest() {
    if (!canReenter()) return;
    const body = {
      render_size_mode: String(renderSizeModeSelect.value || 'median'),
      erase_fill_mode: String(eraseFillModeSelect.value || 'inpaint'),
      width_fit_mode: String(widthFitModeSelect.value || 'footprint'),
      size_metric_mode: String(sizeMetricModeSelect.value || 'extent'),
      size_cohort_mode: String(sizeCohortModeSelect.value || 'vlm'),
    };
    await submitReentry('rerender', 'Re-rendering with the new render params...',
      (sourceRequestId) => api.rerenderImageRequest(sourceRequestId, body));
  }

  async function submitReentry(action, message, submit) {
    const sourceRequestId = currentRequestId;
    stopPolling();
    // Keep the previous render visible until the new one replaces it — a re-entry reuses the
    // same image, so blanking the preview here only produces a flash.
    setRegressionStatus('');  // a new run invalidates any prior "captured / already captured" notice
    setBusy(true);
    setStatus(message);
    showPending(action === 'rerender' ? 'Rendering…' : 'Translating…');
    pendingAction = action;
    try {
      const result = await submit(sourceRequestId);
      applyLifecycle(result);
      currentRequestId = String(result?.request_id || '');
      if (currentRequestId && !isTerminalState(result?.state)) {
        startPolling();
      } else {
        renderOutputPreview(result);
        finishReentry(result);
      }
    } catch (err) {
      pendingAction = '';
      hidePending();
      setStatus(formatApiError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  function finishReentry(result) {
    if (!pendingAction) return;
    const action = pendingAction;
    pendingAction = '';
    if (String(result?.state) !== 'completed') {
      setStatus(`${action === 'rerender' ? 'Re-render' : 'Re-translate'} ${String(result?.state || 'ended')}.`);
    } else if (action === 'rerender') {
      setStatus(`Re-rendered (${String(renderSizeModeSelect.value)}, ${String(eraseFillModeSelect.value)}, ${String(widthFitModeSelect.value)}).`);
    } else {
      setStatus(`Re-translated to ${lastTargetLang || '?'}.`);
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
    const changes = result?.response?.ocr?.field_geometry_changes;
    if (Array.isArray(changes)) {
      detailEls.geometryColumns.value = changes.length
        ? changes.map((c) => `${c.raw}\n  → ${c.adjusted}${c.mapped_into_vlm_line ? '' : '   [cell-segmented]'}`).join('\n\n')
        : '(no column | the VLM missed — geometry changed nothing)';
    }
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
    modelFormats = Object.fromEntries(
      models.map((m) => [String(m?.name || ''), String(m?.definition?.prompt_format || '').trim().toLowerCase()]),
    );
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
    // Translation model: same list as grouping, defaulting to the configured translator. A
    // translategemma_template pick is routed with translator_mode in translatorFields().
    const prevTranslator = String(translatorSelect.value || '');
    translatorSelect.innerHTML = entries.length
      ? entries.map((m) => `<option value="${escapeAttr(m.name)}" class="${m.loaded ? 'is-loaded' : 'is-unloaded'}">${escapeHtml(m.name)}</option>`).join('')
      : '<option value="">(no models)</option>';
    if (prevTranslator && entries.some((m) => m.name === prevTranslator)) {
      translatorSelect.value = prevTranslator;
    } else if (defaultModel && entries.some((m) => m.name === defaultModel)) {
      translatorSelect.value = defaultModel;
    } else {
      translatorSelect.value = entries[0]?.name || '';
    }
    updateModelSelectColor();
    setBusy(isBusy);
  }

  function updateModelSelectColor() {
    const option = modelSelect.selectedOptions && modelSelect.selectedOptions[0];
    modelSelect.classList.toggle('is-loaded', Boolean(option && option.classList.contains('is-loaded')));
    modelSelect.classList.toggle('is-unloaded', Boolean(option && option.classList.contains('is-unloaded')));
  }

  // Translator fields for a request: the explicit "Translation model" pick, else the grouping model.
  // A translategemma_template model routes with translator_mode "translategemma" (source/target codes
  // instead of the structured prompt); other models leave the mode to the service default.
  function translatorFields(groupingModel) {
    const translatorModel = String(translatorSelect.value || '').trim() || groupingModel;
    if (!translatorModel) return {};
    const fields = { translator_model: translatorModel };
    if (modelFormats[translatorModel] === TRANSLATE_PROMPT_FORMAT) fields.translator_mode = 'translategemma';
    return fields;
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

  // The "Original" frame shows the freshly SELECTED file when there is one; otherwise the run's
  // input artifact from the server (a re-translate, or a completed run opened without re-picking).
  function showOriginalFrame() {
    const hasSelected = Boolean(inputPreview.getAttribute('src'));
    const hasServer = Boolean(comparePreview.getAttribute('src'));
    inputPreview.hidden = !hasSelected;
    comparePreview.hidden = hasSelected || !hasServer;
    inputEmpty.hidden = hasSelected || hasServer;
    updateStageVisibility();
  }

  // "Show original" OFF (default) -> translated only, centered; ON -> original + translated side
  // by side. Off == the ``is-single`` layout.
  function applyViewMode() {
    if (stageEl) stageEl.classList.toggle('is-single', !(showOriginalToggle && showOriginalToggle.checked));
  }

  // Empty (no image, no result) shows the drop zone; anything loaded shows the image stage.
  function updateStageVisibility() {
    const loaded = Boolean(selectedFile()) || Boolean(currentRequestId) || Boolean(lastPreviewResult);
    if (dropzone) dropzone.hidden = loaded;
    if (stageLoaded) stageLoaded.hidden = !loaded;
    // The bar's image-only controls (show-original, artifact, zoom, reset) show only with an
    // image; the target-language select stays visible always (set before the first drop).
    if (stageEl) stageEl.classList.toggle('has-image', loaded);
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
    setBusy(isBusy);
  }

  function clearOutputPreview() {
    clearCallDetails();
    lastPreviewResult = null;
    previewArtifactSelect.innerHTML = '<option value="">No artifact</option>';
    previewArtifactSelect.disabled = true;
    outputPreview.hidden = true;
    outputPreview.removeAttribute('src');
    saveBtn.hidden = true;
    outputPending.hidden = true;
    outputEmpty.hidden = false;
    comparePreview.removeAttribute('src');
    showOriginalFrame();
  }

  // The progress overlay in the translated frame: spinner + label + cancel. Shown over the
  // previous render on a re-entry (the image stays visible under it).
  function showPending(label) {
    outputPendingLabel.textContent = String(label || 'Translating…');
    outputEmpty.hidden = true;
    outputPending.hidden = false;
  }

  function hidePending() {
    outputPending.hidden = true;
    outputEmpty.hidden = !outputPreview.hidden;
  }

  function updatePreviewZoom() {
    const value = Math.max(25, Math.min(180, Number(previewZoomInput.value) || 70));
    // Zoom is relative to the image's NATIVE size (CSS ``zoom`` on the img), so the frame —
    // and with it the whole page — grows or shrinks with the image instead of scrolling a
    // fixed-height box.
    container.style.setProperty('--translation-preview-zoom', String(value / 100));
    previewZoomValue.textContent = `${value}%`;
  }

  function renderOutputPreview(result) {
    lastPreviewResult = result || null;
    refreshRegression();
    const requestId = String(result?.request_id || currentRequestId || '');
    const entries = updateArtifactOptions(result);
    const artifactName = String(previewArtifactSelect.value || '');
    if (!requestId || !artifactName || !entries.some((entry) => entry.name === artifactName)) {
      clearOutputPreview();
      return;
    }
    outputPreview.src = `/api/translation/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(artifactName)}?ts=${Date.now()}`;
    outputPreview.hidden = false;
    outputEmpty.hidden = true;
    outputPending.hidden = true;
    saveBtn.hidden = false;
    const hasInput = Boolean(result?.response?.artifacts?.input);
    if (hasInput) {
      comparePreview.src = `/api/translation/requests/${encodeURIComponent(requestId)}/artifacts/input`;
    } else {
      comparePreview.removeAttribute('src');
    }
    showOriginalFrame();
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

  function regressionName() {
    return regressionNameValue;
  }

  function setRegressionStatus(message, kind = '') {
    regressionStatusEl.textContent = String(message || '');
    regressionStatusEl.classList.toggle('is-error', kind === 'error');
  }

  // Destination-subdir picker for Add-to-testset. The fixture mirrors the source's subdir, so this
  // chooses where a fresh image is filed; '' = flat testset root. The sentinel option reveals a
  // free-text field for a brand-new subdir.
  const NEW_SUBDIR = ' new';
  async function populateSubdirs() {
    let dirs = [];
    try {
      dirs = (await api.listRegressionSubdirs()).subdirs || [];
    } catch (err) { /* backend down or old: root-only picker */ }
    regressionSubdirSel.innerHTML = ['<option value="">(root)</option>']
      .concat(dirs.map((d) => `<option value="${escapeAttr(d)}">${escapeHtml(d)}</option>`))
      .concat([`<option value="${NEW_SUBDIR}">+ new subdir…</option>`])
      .join('');
    syncSubdirNew();
  }
  function syncSubdirNew() {
    regressionSubdirNew.style.display = regressionSubdirSel.value === NEW_SUBDIR ? '' : 'none';
  }
  function subdirValue() {
    const raw = regressionSubdirSel.value === NEW_SUBDIR ? regressionSubdirNew.value : regressionSubdirSel.value;
    return String(raw || '').trim().replace(/^\/+|\/+$/g, '');
  }

  function renderRegressionInfo() {
    const name = regressionName();
    const status = regressionStatus;
    const hasName = Boolean(name);
    const ready = Boolean(currentRequestId) && currentState() === 'completed';
    const langs = (status && status.langs) || {};
    const langKeys = Object.keys(langs);
    if (!hasName) {
      regressionInfoEl.textContent = '';
    } else if (!status) {
      regressionInfoEl.textContent = name;
    } else if (!status.in_testset) {
      regressionInfoEl.textContent = `${name} · not in testset`;
    } else if (!langKeys.length) {
      regressionInfoEl.textContent = `${name} · in testset · no fixture yet`;
    } else {
      regressionInfoEl.textContent = `${name} · ` + langKeys.map((lang) => `${lang}: ${langs[lang].join(',')}`).join(' · ');
    }
    const inTestset = Boolean(status && status.in_testset);
    const targetLang = (lastTargetLang || String(targetInput.value || '')).trim();
    const hasForLang = Boolean(langs[targetLang] && langs[targetLang].length);
    regressionAddTestsetBtn.disabled = isBusy || !ready || !hasName || inTestset;
    // The subdir picker only matters while the image can still be added (not yet in the testset).
    const canAdd = !regressionAddTestsetBtn.disabled;
    regressionSubdirSel.disabled = !canAdd;
    regressionSubdirNew.disabled = !canAdd;
    regressionCaptureBtn.disabled = isBusy || !ready || !hasName || !inTestset;
    regressionCaptureBtn.textContent = `${hasForLang ? 'Capture variant' : 'Capture fixture'} (${targetLang || '?'})`;
  }

  async function refreshRegression() {
    const name = regressionName();
    if (!name) {
      regressionStatus = null;
      renderRegressionInfo();
      return;
    }
    try {
      regressionStatus = await api.getRegressionStatus(name);
    } catch (err) {
      regressionStatus = null;
      setRegressionStatus(formatApiError(err), 'error');
    }
    renderRegressionInfo();
  }

  async function addToTestset() {
    if (!currentRequestId || !regressionName()) return;
    setRegressionStatus('Adding to testset…');
    try {
      regressionStatus = await api.addRegressionTestset({ request_id: currentRequestId, name: regressionName(), subdir: subdirValue() });
      setRegressionStatus('Added to testset.');
      populateSubdirs();  // a freshly-typed subdir now exists — offer it next time
    } catch (err) {
      setRegressionStatus(formatApiError(err), 'error');
    }
    renderRegressionInfo();
  }

  // Modal for the duplicate-capture choice. The default (autofocus + Esc + Enter) is "Don't add" so
  // the safe choice needs no deliberate click; "Add anyway" forces a new variant via allow_duplicate.
  function confirmDuplicateCapture(reason, where) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'translation-dup-dialog';
      dlg.innerHTML = `
        <div class="translation-dup-card" style="max-width:34rem;padding:1rem 1.1rem;">
          <div style="font-weight:600;margin-bottom:.45rem;">Duplicate of ${escapeHtml(where)}</div>
          <p style="margin:.2rem 0 1rem;opacity:.85;line-height:1.4;">${escapeHtml(reason)}</p>
          <div style="display:flex;gap:.5rem;justify-content:flex-end;">
            <button type="button" data-dup="skip" autofocus>Don't add</button>
            <button type="button" data-dup="add">Add as new variant anyway</button>
          </div>
        </div>`;
      const finish = (add) => { try { dlg.close(); } catch (_e) { /* already closed */ } dlg.remove(); resolve(add); };
      dlg.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-dup]');
        if (btn) finish(btn.dataset.dup === 'add');
      });
      dlg.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });  // Esc = don't add
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  async function captureFixture() {
    if (!currentRequestId || !regressionName()) return;
    setRegressionStatus('Capturing… (re-OCR)');
    setBusy(true);
    try {
      // The server places it under <name>/<target_lang>/ and assigns the next variant. A capture that
      // would replay identically to an existing variant comes back as a duplicate (no re-OCR yet);
      // ask the user, defaulting to NOT adding, and only force it (allow_duplicate) on confirmation.
      const body = { request_id: currentRequestId, name: regressionName() };
      regressionStatus = await api.captureRegressionFixture(body);
      if (regressionStatus.duplicate) {
        const where = `${regressionStatus.target_lang || ''}/${regressionStatus.variant || ''}`;
        const add = await confirmDuplicateCapture(regressionStatus.reason || `Identical to ${where}.`, where);
        if (add) {
          regressionStatus = await api.captureRegressionFixture({ ...body, allow_duplicate: true });
          setRegressionStatus(`Captured ${regressionStatus.target_lang || ''}/${regressionStatus.variant || ''} (duplicate, added on request).`);
        } else {
          setRegressionStatus(`Not added — duplicate of ${where}.`);
        }
      } else {
        setRegressionStatus(`Captured ${regressionStatus.target_lang || ''}/${regressionStatus.variant || ''}.`);
      }
    } catch (err) {
      setRegressionStatus(formatApiError(err), 'error');
    } finally {
      setBusy(false);
    }
    renderRegressionInfo();
  }

  // Picking (or dropping) an image previews it and immediately submits — no explicit Submit.
  function onFileChosen() {
    const file = selectedFile();
    regressionNameValue = file ? String(file.name || '').replace(/\.[^.]+$/, '').trim() : '';
    updateInputPreview();
    refreshRegression();
    if (file) submitRequest();
  }
  fileInput.addEventListener('change', onFileChosen);

  // "Choose another image": stop a run in flight, clear everything, back to the drop zone.
  function resetImage() {
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
  if (resetBtn) resetBtn.addEventListener('click', resetImage);
  if (cancelBtn) cancelBtn.addEventListener('click', cancelRequest);
  if (showOriginalToggle) showOriginalToggle.addEventListener('change', applyViewMode);

  // Drag-and-drop onto the empty-state zone.
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

  regressionAddTestsetBtn.addEventListener('click', addToTestset);
  regressionCaptureBtn.addEventListener('click', captureFixture);
  regressionSubdirSel.addEventListener('change', syncSubdirNew);
  populateSubdirs();
  previewZoomInput.addEventListener('input', updatePreviewZoom);
  previewArtifactSelect.addEventListener('change', () => {
    if (lastPreviewResult) renderOutputPreview(lastPreviewResult);
  });
  modelSelect.addEventListener('change', updateModelSelectColor);
  // Switching target language on a completed run re-translates it in place (cached units, no
  // VLM/OCR); changing a render param re-renders it in place (cached translations, no LLM at
  // all). With nothing loaded these selects just set the values the next submit will use.
  targetInput.addEventListener('change', retranslateRequest);
  // preserve_image_regions changes the align stage (which cells become units), so it re-aligns
  // from cache + re-translates (no VLM/OCR) — a retranslate, not a cheap re-render.
  preserveImageRegionsInput.addEventListener('change', retranslateRequest);
  renderSizeModeSelect.addEventListener('change', rerenderRequest);
  eraseFillModeSelect.addEventListener('change', rerenderRequest);
  widthFitModeSelect.addEventListener('change', rerenderRequest);
  sizeMetricModeSelect.addEventListener('change', rerenderRequest);
  sizeCohortModeSelect.addEventListener('change', rerenderRequest);

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
  updatePreviewZoom();
  updateInputPreview();
  renderTimings(null);
  populateLanguageSelect();
  setBusy(false);
  loadPromptChoices();
  loadModelChoices();
  return container;
}
