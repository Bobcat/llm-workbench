import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';
import { TRANSLATION_LANGUAGES } from '../../shared/translation-languages.js';
import { publishWorkflowBusy } from '../../shared/workflow-activity.js';

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
                <label class="translation-requests-barfield pdf-translation-history-field" id="pdfHistoryField" hidden>
                  <span>Recent request</span>
                  <select id="pdfHistory" aria-label="Recent PDF request">
                    <option value="new">New request</option>
                  </select>
                </label>
                <label class="translation-requests-showtoggle translation-requests-loaded-only">
                  <span>Show original</span>
                  <input type="checkbox" id="pdfShowOriginal">
                  <span class="translation-requests-switch" aria-hidden="true"></span>
                </label>
              </div>
              <div class="translation-requests-bar-right translation-requests-loaded-only">
                <!-- Which finished document the right-hand frame shows. Only ever holds
                     artifacts this run produced, so layout comparisons are absent unless
                     requested. Sits with the output-side controls because it changes what
                     the right frame shows, not what gets translated. -->
                <label class="translation-requests-barfield">
                  <span>Artifact</span>
                  <select id="pdfArtifact"></select>
                </label>
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
              <summary>Render</summary>
              <div class="translation-requests-details-body translation-requests-render-grid">
                <label class="translation-prompts-field">
                  <span>Output</span>
                  <select id="pdfOutputMode" title="How the translated document is delivered. The translation is always written into a copy of the source PDF: each page keeps its own content, only the replaced glyphs are removed, and the translation goes in as real text — selectable, searchable and sharp at any zoom, with figures and rules still vector. vector hands you that document. raster hands you the same document rasterized, one bitmap per page at the analysis dpi, which turns figures, rules and text into pixels. A document the exporter cannot take is refused with its reason either way. Switching delivery needs no new translation after a completed run, so this re-renders the shown document from its cached translations like the other options here.">
                    <option value="raster">raster — bitmap pages</option>
                    <option value="vector" selected>vector — text in the source pages</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Structure tree</span>
                  <select id="pdfStructureMode" title="Whether the output carries a structure tree — the tags a screen reader follows, and the only place the reading order is stated rather than guessed at. source-only writes one where the source already had one, which keeps the output as close to the original as the rest of this route does. always writes one on every document, including scans: there the tags are built from OCR and the model's grouping, so a wrong grouping produces a confidently wrong tree for exactly the reader who cannot see the page to check it — which is why it is asked for rather than assumed. Whatever tree the source had is replaced, never repaired: it would otherwise keep pointing at text we took out. A rasterized delivery has no text left to carry the tree.">
                    <option value="source_only" selected>source-only — only where the source had one</option>
                    <option value="always">always — also where the source had none</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Page layout</span>
                  <select id="pdfPageLayoutMode" title="How a DOCUMENT page is laid out. auto chooses typeset for each born-digital page and fit for each scanned or hybrid page. fit puts every translated block back into its source box. typeset asks the compositor to re-set every page from its layout. The compositor may still use fit when its existing page gate declines typesetting.">
                    <option value="auto" selected>auto — typeset digital, fit scanned/hybrid</option>
                    <option value="fit">fit — each block back in its own box</option>
                    <option value="typeset">typeset — re-set the page from its layout</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Page scale</span>
                  <select id="pdfPageScale" title="typeset only: the type size as a fraction of the source's own. Dutch runs longer than English, so a re-set page takes lines its source did not have; smaller type in the SAME column buys them back. The design solves one scale per document from what its pages have room for; until that solve is wired in, this picks it by hand. The reference system sets the transformer paper at 0.90 of the source size.">
                    <option value="1.0" selected>1.00 — the source's own size</option>
                    <option value="0.97">0.97</option>
                    <option value="0.94">0.94</option>
                    <option value="0.90">0.90 — what the reference system uses</option>
                    <option value="0.85">0.85</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Doclayout overlay</span>
                  <select id="pdfDoclayoutOverlay" title="Also produce three PDFs showing what PP-DocLayoutV2, plus-L and V3 returned for each page: one box per raw region with its label and confidence, drawn on the source page. V2 feeds the translation pipeline; plus-L and V3 are comparison artifacts. Off by default because the two comparison models and three overlay documents add work. Pick them in the Artifact selector above once the run finishes.">
                    <option value="off" selected>off</option>
                    <option value="on">on — compare plus-L, V2 and V3</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>PaddleOCR V5 overlay</span>
                  <select id="pdfPaddleocrV5Overlay" title="Also run pure PaddleOCR V5 over every rasterized source page and produce one PDF with each detected polygon, confidence and recognized text drawn on the page. This is independent of the production OCR route: it also covers born-digital pages and never includes V6 recovery. Off by default because it adds a V5 pass over the full document. Pick PaddleOCR V5 in the Artifact selector once the run finishes.">
                    <option value="off" selected>off</option>
                    <option value="on">on — inspect pure V5</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Render size mode</span>
                  <select id="pdfRenderSizeMode" title="How a render group's one font size is chosen from its lines: median resists one under-measured (lowercase) line dragging the whole block down; min never overflows the smallest line's band. Changing this re-renders every page of the shown document from its cached translations (no new translation).">
                    <option value="median" selected>median — default</option>
                    <option value="min">min — never overflow</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Erase fill</span>
                  <select id="pdfEraseFillMode" title="How erased source text is filled. flat paints each erased line with its sampled background colour; inpaint is the hybrid model-based fill — flat paint on designed flat ground, model reconstruction where the ground varies (GPU-only).">
                    <option value="flat">flat — one colour</option>
                    <option value="inpaint" selected>inpaint — hybrid fill</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Size metric</span>
                  <select id="pdfSizeMetricMode" title="Where a line's source size comes from. extent sizes from the OCR polygon's full ink extent; band clamps each line to its strong ink band scaled by the document's own norm, so sparse tall glyphs (parentheses, brackets) cannot inflate a line past its siblings (one-sided, only shrinks an outlier). fill sizes each line so its rendered ink is as tall as the source line's ink — note that a born-digital page declares its own sizes, so fill has no effect there.">
                    <option value="extent" selected>extent — polygon</option>
                    <option value="band">band — clamp outliers</option>
                    <option value="fill">fill — match source ink</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Size cohort</span>
                  <select id="pdfSizeCohortMode" title="Cross-element size uniformity from the VLM font-size (pt) label. off sizes each element from its own measured height. vlm groups elements the VLM gave one pt and, when their measured heights agree, snaps the whole cohort to its median — so a list the VLM judged one size renders uniform. A cohort whose heights disagree keeps per-element sizing.">
                    <option value="off">off — per element</option>
                    <option value="vlm" selected>vlm — snap siblings</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Width fit</span>
                  <select id="pdfWidthFitMode" title="How a translation wider than its original line is fitted. footprint keeps it inside the original line's width (condense, then shrink); extend to margin first widens into verified clean background right of the line (never over other text, ink or a surface change), capped at the right margin of the text band the line sits in, so short list items keep their size without crossing a column gutter or running into a page margin.">
                    <option value="footprint" selected>footprint — exact fit</option>
                    <option value="extend_to_margin">extend to margin — grow, stop at the margin</option>
                  </select>
                </label>
              </div>
            </details>
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
                  <label class="translation-prompts-field">
                    <span>Page concurrency</span>
                    <input type="number" id="pdfPageConcurrency" min="1" step="1" placeholder="host default">
                  </label>
                  <label class="translation-prompts-field">
                    <span>Translation prompt</span>
                    <select id="pdfTranslationPrompt">
                      <option value="">host default</option>
                      <option value="translate_image_default">image — every word, keep only proper names, category given</option>
                      <option value="translate_pdf_default">document — descriptive labels translated, no category</option>
                    </select>
                  </label>
                  <!-- The document prompt no longer prints the category above the units, so this
                       choice only reaches it through the category-keyed instruction line. It still
                       decides in full what the image prompt is told, and how many classify calls a
                       document costs. -->
                  <label class="translation-prompts-field">
                    <span>Page category</span>
                    <select id="pdfPageCategoryMode">
                      <option value="">host default</option>
                      <option value="per_page">per page — each page classifies itself</option>
                      <option value="document">document — classified once on page 1</option>
                    </select>
                  </label>
                </div>
              </div>
            </details>
            <!-- Stage timings. The document response carries the run total in response.metrics
                 and each page's stage breakdown in document.pages[].metrics — so the scope picker
                 offers the whole document plus one entry per page. -->
            <details class="translation-prompts-system-details translation-requests-details">
              <summary>Timings</summary>
              <div class="translation-requests-details-body">
                <label class="translation-prompts-field pdf-timings-scope" id="pdfTimingsScopeField">
                  <span>Scope</span>
                  <select id="pdfTimingsScope"></select>
                </label>
                <div class="translation-requests-timings" id="pdfTimings"></div>
              </div>
            </details>
            <!-- Prompts + responses, per page. The document response carries an EMPTY llm_calls
                 on purpose — inlining every page's log would multiply an already multi-MB payload
                 by the page count — so each page's log is its own artifact and this section
                 fetches one at a time, only once opened. -->
            <details class="translation-prompts-system-details translation-requests-details" id="pdfCallsDetails">
              <summary>Prompts &amp; responses</summary>
              <div class="translation-requests-details-body">
                <label class="translation-prompts-field">
                  <span>Page</span>
                  <select id="pdfCallsPage"></select>
                </label>
                <div class="translation-prompts-inline-status" id="pdfCallsStatus"></div>
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>VLM grouping — system / instructions</span>
                  <textarea id="pdfVlmSystem" rows="6" spellcheck="false"></textarea>
                </label>
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>VLM grouping — input</span>
                  <textarea id="pdfVlmInput" rows="6" spellcheck="false" placeholder="The user prompt sent to the grouping VLM for this page."></textarea>
                </label>
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>VLM grouping — response</span>
                  <textarea id="pdfVlmResponse" rows="6" spellcheck="false"></textarea>
                </label>
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>Translation — system / instructions</span>
                  <textarea id="pdfXlateSystem" rows="6" spellcheck="false"></textarea>
                </label>
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>Translation — input</span>
                  <textarea id="pdfXlateInput" rows="6" spellcheck="false"></textarea>
                </label>
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>Translation — response</span>
                  <textarea id="pdfXlateResponse" rows="6" spellcheck="false"></textarea>
                </label>
                <label class="translation-prompts-field translation-prompts-field-response">
                  <span>Other calls (prompts + responses)</span>
                  <textarea id="pdfOtherCalls" rows="8" spellcheck="false" placeholder="Every other call this page made, in order, with its role — the island batch, hint-line and per-unit calls."></textarea>
                </label>
              </div>
            </details>
            <!-- Freeze this completed run as a document regression fixture (frozen per-page
                 cells/hint/translations + approved snapshots + accepted benchmark score). The
                 fixture then lives in the PDF translation regression view. Same shape as the
                 image "Regression fixture" panel: a status badge + a Capture button. PDF capture
                 is self-contained (it stores source.pdf inside the fixture), so there is no
                 separate "add to testset" step — the source is matched to a testset document by
                 content hash, or captured under a name you type. -->
            <details class="translation-prompts-system-details translation-requests-details">
              <summary>Regression fixture</summary>
              <div class="translation-requests-details-body translation-requests-regression pdf-translation-capture">
                <div class="translation-prompts-inline-status" id="pdfRegInfo"></div>
                <div class="translation-prompts-run-actions">
                  <label class="translation-reg-subdir" title="Destination folder in the testset (the fixture mirrors it)">
                    <span>Subdir</span>
                    <select id="pdfRegSubdir"></select>
                  </label>
                  <input type="text" id="pdfRegSubdirNew" class="translation-reg-subdir-new" placeholder="new subdir, e.g. docpack" style="display:none">
                  <button type="button" id="pdfRegAddTestset" disabled title="Copy this PDF into the testset">Add to testset</button>
                  <label class="pdf-translation-capture-check" title="Freeze this run's benchmark score as the fixture's accepted baseline">
                    <input type="checkbox" id="pdfRegScore" checked>
                    <span>freeze score</span>
                  </label>
                  <button type="button" id="pdfRegCaptureBtn" disabled title="Freeze this completed result as a document regression fixture (frozen per-page snapshots)">Capture fixture</button>
                </div>
                <p class="pdf-translation-capture-hint">Freezing the score also files this run in the
                  PDF-testing matrix as “ours”, on the row for this document and target language.
                  Earlier runs are kept: the cell shows the newest one, and Δ ours compares it
                  against the best earlier one.</p>
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
          </section>

        </div>
      </div>
    </div>
  `;

  const fileInput = container.querySelector('#pdfFile');
  const targetInput = container.querySelector('#pdfTarget');
  const historyField = container.querySelector('#pdfHistoryField');
  const historySelect = container.querySelector('#pdfHistory');
  const statusEl = container.querySelector('#pdfStatus');
  const statIdEl = container.querySelector('#pdfStatId');
  const statStateEl = container.querySelector('#pdfStatState');
  const statStageEl = container.querySelector('#pdfStatStage');
  const statPagesEl = container.querySelector('#pdfStatPages');
  const statQueueEl = container.querySelector('#pdfStatQueue');
  const rawEl = container.querySelector('#pdfRaw');
  const modelSelect = container.querySelector('#pdfModel');
  const pageConcurrencyInput = container.querySelector('#pdfPageConcurrency');
  const translatorSelect = container.querySelector('#pdfTranslatorModel');
  const translationPromptSelect = container.querySelector('#pdfTranslationPrompt');
  const pageCategoryModeSelect = container.querySelector('#pdfPageCategoryMode');
  const renderSizeModeSelect = container.querySelector('#pdfRenderSizeMode');
  const eraseFillModeSelect = container.querySelector('#pdfEraseFillMode');
  const sizeMetricModeSelect = container.querySelector('#pdfSizeMetricMode');
  const sizeCohortModeSelect = container.querySelector('#pdfSizeCohortMode');
  const widthFitModeSelect = container.querySelector('#pdfWidthFitMode');
  const outputModeSelect = container.querySelector('#pdfOutputMode');
  const structureModeSelect = container.querySelector('#pdfStructureMode');
  const pageLayoutModeSelect = container.querySelector('#pdfPageLayoutMode');
  const doclayoutOverlaySelect = container.querySelector('#pdfDoclayoutOverlay');
  const paddleocrV5OverlaySelect = container.querySelector('#pdfPaddleocrV5Overlay');
  const artifactSelect = container.querySelector('#pdfArtifact');
  const pageScaleSelect = container.querySelector('#pdfPageScale');
  const inputPreview = container.querySelector('#pdfInputPreview');
  const inputEmpty = container.querySelector('#pdfInputEmpty');
  const outputPreview = container.querySelector('#pdfOutputPreview');
  const outputEmpty = container.querySelector('#pdfOutputEmpty');
  const outputPending = container.querySelector('#pdfOutputPending');
  const outputPendingLabel = container.querySelector('.translation-preview-pending-label');
  const cancelBtn = container.querySelector('#pdfCancelBtn');
  const downloadLink = container.querySelector('#pdfDownload');
  const benchmarkBtn = container.querySelector('#pdfBenchmarkBtn');
  const timingsScopeField = container.querySelector('#pdfTimingsScopeField');
  const timingsScope = container.querySelector('#pdfTimingsScope');
  const timingsEl = container.querySelector('#pdfTimings');
  const callsDetails = container.querySelector('#pdfCallsDetails');
  const callsPageSelect = container.querySelector('#pdfCallsPage');
  const callsStatusEl = container.querySelector('#pdfCallsStatus');
  const callEls = {
    vlmSystem: container.querySelector('#pdfVlmSystem'),
    vlmInput: container.querySelector('#pdfVlmInput'),
    vlmResponse: container.querySelector('#pdfVlmResponse'),
    xlateSystem: container.querySelector('#pdfXlateSystem'),
    xlateInput: container.querySelector('#pdfXlateInput'),
    xlateResponse: container.querySelector('#pdfXlateResponse'),
    other: container.querySelector('#pdfOtherCalls'),
  };
  const regInfoEl = container.querySelector('#pdfRegInfo');
  const regSubdirSel = container.querySelector('#pdfRegSubdir');
  const regSubdirNew = container.querySelector('#pdfRegSubdirNew');
  const regScoreInput = container.querySelector('#pdfRegScore');
  const regAddTestsetBtn = container.querySelector('#pdfRegAddTestset');
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
  let recentRequests = [];
  let transientRequest = null;
  let isInspectingHistory = false;
  let historyOptionsAvailable = true;
  let historicalInputRequestId = '';
  let historicalFilename = '';
  let newRequestDraft = null;
  let activeHistoricalOptions = null;
  let regStatus = null;   // {name, in_testset, langs} for the current completed run (capture badge)
  let isRerendering = false;  // a render-flag re-entry is in flight: report it as a re-render, not a translation
  // The last completed result, so switching the artifact selector can re-point the frame
  // without re-fetching the request.
  let lastResultForArtifact = null;

  function setStatus(message, kind = '') {
    statusEl.textContent = kind === 'error' ? String(message || '') : '';
    statusEl.classList.toggle('is-error', kind === 'error');
  }

  function setBusy(nextBusy) {
    isBusy = Boolean(nextBusy);
    const settingsLocked = isBusy || isInspectingHistory;
    const renderLocked = isBusy || (isInspectingHistory && !historyOptionsAvailable);
    fileInput.disabled = isBusy;
    if (browseBtn) browseBtn.disabled = isBusy;
    targetInput.disabled = settingsLocked;
    modelSelect.disabled = settingsLocked;
    translatorSelect.disabled = settingsLocked;
    pageConcurrencyInput.disabled = settingsLocked;
    translationPromptSelect.disabled = settingsLocked;
    pageCategoryModeSelect.disabled = settingsLocked;
    renderSizeModeSelect.disabled = renderLocked;
    eraseFillModeSelect.disabled = renderLocked;
    sizeMetricModeSelect.disabled = renderLocked;
    sizeCohortModeSelect.disabled = renderLocked;
    widthFitModeSelect.disabled = renderLocked;
    outputModeSelect.disabled = renderLocked;
    structureModeSelect.disabled = renderLocked;
    pageLayoutModeSelect.disabled = renderLocked;
    // Always settable, even while the layout mode is still `fit` — the fit path ignores the
    // flag, so the only thing disabling it bought was an ordering trap: this state is
    // recomputed after a render, so picking `typeset` left the scale locked until a render
    // had already run at 1.00, and only the run after that could carry 0.90.
    pageScaleSelect.disabled = renderLocked;
    doclayoutOverlaySelect.disabled = renderLocked;
    paddleocrV5OverlaySelect.disabled = renderLocked;
    artifactSelect.disabled = isBusy;
    historySelect.disabled = isBusy || Boolean(currentRequestId && !isTerminalState(currentState()));
  }

  // The render flags as the API takes them — one reader for both the initial submit and the
  // re-render, so the two can never drift apart.
  function renderFlags() {
    return {
      render_size_mode: String(renderSizeModeSelect.value || 'median'),
      erase_fill_mode: String(eraseFillModeSelect.value || 'inpaint'),
      size_metric_mode: String(sizeMetricModeSelect.value || 'extent'),
      size_cohort_mode: String(sizeCohortModeSelect.value || 'vlm'),
      width_fit_mode: String(widthFitModeSelect.value || 'footprint'),
      pdf_output_mode: String(outputModeSelect.value || 'vector'),
      pdf_structure_mode: String(structureModeSelect.value || 'source_only'),
      page_layout_mode: String(pageLayoutModeSelect.value || 'auto'),
      page_scale: Number(pageScaleSelect.value || 1),
      doclayout_overlay: String(doclayoutOverlaySelect.value || 'off') === 'on',
      paddleocr_v5_overlay: String(paddleocrV5OverlaySelect.value || 'off') === 'on',
    };
  }

  function captureControlState() {
    return {
      target_lang_code: String(targetInput.value || ''),
      grouping_model: String(modelSelect.value || ''),
      translator_model: String(translatorSelect.value || ''),
      page_concurrency: String(pageConcurrencyInput.value || ''),
      translation_prompt_id: String(translationPromptSelect.value || ''),
      page_category_mode: String(pageCategoryModeSelect.value || ''),
      ...renderFlags(),
    };
  }

  function setSelectValue(select, value, historyLabel = '', numericMatch = false) {
    const wanted = String(value ?? '');
    for (const option of Array.from(select.options)) {
      if (option.dataset.historyValue === 'true') option.remove();
    }
    const existing = Array.from(select.options).find((option) => (
      option.value === wanted
      || (numericMatch && wanted && Number(option.value) === Number(wanted))
    ));
    if (existing) {
      select.value = existing.value;
      return;
    }
    if (wanted) {
      const option = document.createElement('option');
      option.value = wanted;
      option.textContent = historyLabel || `${wanted} — from request`;
      option.dataset.historyValue = 'true';
      select.append(option);
    }
    select.value = wanted;
  }

  function applyControlState(options) {
    setSelectValue(targetInput, options?.target_lang_code);
    setSelectValue(modelSelect, options?.grouping_model);
    setSelectValue(translatorSelect, options?.translator_model);
    pageConcurrencyInput.value = options?.page_concurrency == null
      ? ''
      : String(options.page_concurrency);
    setSelectValue(translationPromptSelect, options?.translation_prompt_id);
    setSelectValue(pageCategoryModeSelect, options?.page_category_mode);
    setSelectValue(renderSizeModeSelect, options?.render_size_mode || 'median');
    setSelectValue(eraseFillModeSelect, options?.erase_fill_mode || 'inpaint');
    setSelectValue(sizeMetricModeSelect, options?.size_metric_mode || 'extent');
    setSelectValue(sizeCohortModeSelect, options?.size_cohort_mode || 'vlm');
    setSelectValue(widthFitModeSelect, options?.width_fit_mode || 'footprint');
    setSelectValue(outputModeSelect, options?.pdf_output_mode || 'vector');
    setSelectValue(structureModeSelect, options?.pdf_structure_mode || 'source_only');
    // Runs from before `auto` existed omitted this field and therefore used the old fit default.
    setSelectValue(pageLayoutModeSelect, options?.page_layout_mode || 'fit');
    const pageScale = Number(options?.page_scale ?? 1);
    setSelectValue(
      pageScaleSelect,
      Number.isFinite(pageScale) ? String(pageScale) : '1',
      `${Number.isFinite(pageScale) ? pageScale.toFixed(2) : '1.00'} — from request`,
      true,
    );
    setSelectValue(doclayoutOverlaySelect, options?.doclayout_overlay ? 'on' : 'off');
    setSelectValue(paddleocrV5OverlaySelect, options?.paddleocr_v5_overlay ? 'on' : 'off');
    lastTargetLang = String(options?.target_lang_code || '');
    updateModelSelectColor();
  }

  // How the document was delivered, and how much of each page the exporter actually
  // set as text. There is one export; a refusal never silently becomes something
  // else, it fails the request with its reason (see lifecycleErrorMessage).
  function outputRouteRow(result, row) {
    const doc = result?.response?.document || {};
    const mode = String(doc.pdf_output_mode || '');
    if (!mode) return '';
    const pages = Array.isArray(doc.pages) ? doc.pages : [];
    const reports = pages.map((p) => p.vector).filter(Boolean);
    // Only what the report actually counts: lines the exporter wrote as text, and
    // local images it placed. groups_drawn counts any prepared group — including one
    // that only moved a source object — and fully_native is set on every successful
    // report, so neither says what a reader would take it to say.
    let detail = mode;
    if (reports.length) {
      const lines = reports.reduce((n, v) => n + (Number(v.lines_drawn) || 0), 0);
      const patches = reports.reduce((n, v) => n + (Number(v.patches) || 0), 0);
      const parts = [`${lines} lines as text`];
      if (patches) parts.push(`${patches} local patches`);
      detail = `${mode} — ${parts.join(', ')}`;
    }
    return row('Output', detail, 'trt-l1',
      'How the document was delivered. vector hands you the exported PDF, whose pages keep their own content with the translation written as real text; raster hands you that same document rasterized one bitmap per page. The counts are what the exporter wrote: text lines it authored, and the local images it placed over erased areas on a scanned page.');
  }

  // What the source asked for and the delivered document does not carry. It is a
  // warning, not a statistic: somebody is being handed a document whose seal or
  // whose encryption is gone, and the raw response is not where they look.
  function surrenderedProtectionsRow(result, row) {
    const given = result?.response?.metadata?.source_protections_surrendered;
    if (!Array.isArray(given) || !given.length) return '';
    const said = {
      PDF_SOURCE_DIGITAL_SIGNATURE: 'digital signature removed',
      PDF_SOURCE_ENCRYPTION_REMOVED: 'encryption removed',
    };
    const detail = escapeHtml(
      given.map((code) => said[code] || String(code)).join(', '),
    );
    return row('Source protections', detail, 'trt-warn',
      'The source carried a protection this translation cannot. A signature seals the exact bytes the translation changes; an encryption belongs to the source file rather than to the document you were handed. Both are dropped rather than left broken, because a viewer would otherwise report the document as altered — and named here, since the delivered file no longer says so itself.');
  }

  function canReenter() {
    return !isBusy
      && (!isInspectingHistory || historyOptionsAvailable)
      && Boolean(currentRequestId)
      && currentState() === 'completed';
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
    // Empty means "host default": omit the field entirely rather than guessing a number here.
    const concurrency = Math.round(Number(pageConcurrencyInput.value));
    if (Number.isFinite(concurrency) && concurrency >= 1) {
      payload.page_concurrency = pageConcurrencyMax ? Math.min(concurrency, pageConcurrencyMax) : concurrency;
    }
    // Empty means "host default" for these two as well: the service decides, and omitting
    // the field is the only way to say so — a value here always wins over settings.json.
    const promptId = String(translationPromptSelect.value || '').trim();
    if (promptId) payload.translation_prompt_id = promptId;
    const categoryMode = String(pageCategoryModeSelect.value || '').trim();
    if (categoryMode) payload.page_category_mode = categoryMode;
    Object.assign(payload, translatorFields(model), renderFlags());
    return payload;
  }

  // Fired by a Render select changing while a completed document is in view: re-render every
  // page of the shown result from its cached per-page translations with the new flag — no new
  // translation, so the A/B compares exactly the render.
  async function rerenderRequest() {
    if (!canReenter()) {
      if (!isBusy && currentState() === 'failed') {
        setStatus('Choose the PDF again to apply the changed render options.', 'error');
      }
      return;
    }
    const sourceRequestId = currentRequestId;
    stopPolling();
    // Keep the previous render visible until the new one replaces it: a re-render reuses the
    // same source, so blanking the preview here would only flash.
    setBusy(true);
    showPending('Rendering…');
    isRerendering = true;
    try {
      const result = await api.rerenderPdfRequest(sourceRequestId, renderFlags());
      applyLifecycle(result);
      currentRequestId = String(result?.request_id || '');
      if (currentRequestId) {
        transientRequest = {
          request_id: currentRequestId,
          label: `Current rerender — ${historicalFilename || selectedFile()?.name || currentRequestId}`,
        };
        renderHistorySelect(`current:${currentRequestId}`);
      }
      if (currentRequestId && !isTerminalState(result?.state)) {
        startPolling();
      } else {
        renderOutputPreview(result);
        syncCallsSection(result);
        syncResultTimings(result);
        if (String(result?.state) === 'failed') {
          setStatus(lifecycleErrorMessage(result), 'error');
        }
        isRerendering = false;
      }
    } catch (err) {
      isRerendering = false;
      hidePending();
      setStatus(formatApiError(err), 'error');
    } finally {
      setBusy(false);
    }
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
      if (currentRequestId) {
        transientRequest = {
          request_id: currentRequestId,
          label: `Current request — ${file.name}`,
        };
        renderHistorySelect(`current:${currentRequestId}`);
      }
      if (currentRequestId && !isTerminalState(result?.state)) {
        startPolling();
      } else {
        renderOutputPreview(result);
        syncCallsSection(result);
        syncResultTimings(result);
        if (String(result?.state) === 'failed') {
          setStatus(lifecycleErrorMessage(result), 'error');
        }
        loadRecentRequests(`current:${currentRequestId}`);
      }
    } catch (err) {
      hidePending();
      setStatus(formatApiError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // A poll is a read of someone else's progress, and one missed read proves nothing: the
  // service's event loop measurably stalls under a document run (assemble pressed polls to
  // ~650ms warm, and one cold run starved a poll past the proxy's 5s budget). Giving up on
  // the first error abandoned a job that COMPLETED server-side moments later — whose record
  // the 30-minute TTL then erased, so the run read as "never a result". Only a run of
  // consecutive failures (~30s of unreachable service) ends the watch.
  const POLL_MAX_CONSECUTIVE_FAILURES = 5;
  let pollFailures = 0;
  let pollInFlight = false;

  async function pollOnce() {
    if (!currentRequestId) return;
    if (pollInFlight) return; // a stalled poll must not stack timeouts behind itself
    pollInFlight = true;
    try {
      const result = await api.getPdfRequest(currentRequestId);
      pollFailures = 0;
      applyLifecycle(result);
      if (isTerminalState(result?.state)) {
        stopPolling();
        renderOutputPreview(result);
        syncCallsSection(result);
        syncResultTimings(result);
        const wasRerendering = isRerendering;
        if (String(result?.state) === 'failed') {
          isRerendering = false;
          setStatus(lifecycleErrorMessage(result), 'error');
          if (!wasRerendering) loadRecentRequests(`current:${currentRequestId}`);
        } else if (isRerendering) {
          isRerendering = false;
          setStatus(String(result?.state) === 'completed'
            ? `Re-rendered (${String(renderSizeModeSelect.value)}, ${String(eraseFillModeSelect.value)}, ${String(widthFitModeSelect.value)}).`
            : `Re-render ${String(result?.state || 'ended')}.`);
        } else {
          loadRecentRequests(`current:${currentRequestId}`);
        }
      }
    } catch (err) {
      pollFailures += 1;
      if (pollFailures >= POLL_MAX_CONSECUTIVE_FAILURES) {
        stopPolling();
        hidePending();
        setStatus(formatApiError(err), 'error');
      } else {
        setStatus(`Poll failed (${pollFailures}/${POLL_MAX_CONSECUTIVE_FAILURES}), retrying — the run continues server-side.`);
      }
    } finally {
      pollInFlight = false;
    }
  }

  // The poll timer is exactly "a request of this view is in flight", so it also drives the
  // sidebar indicator — two call sites instead of one flag to keep in sync at every exit path.
  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(pollOnce, POLL_INTERVAL_MS);
    publishWorkflowBusy('pdf-translation', true);
    pollOnce();
  }

  function stopPolling() {
    if (pollTimer === null) return;
    window.clearInterval(pollTimer);
    pollTimer = null;
    publishWorkflowBusy('pdf-translation', false);
  }

  async function cancelRequest() {
    if (!currentRequestId) return;
    setBusy(true);
    try {
      const result = await api.cancelPdfRequest(currentRequestId);
      applyLifecycle(result);
      if (isTerminalState(result?.state)) {
        isRerendering = false;
        stopPolling();
        renderOutputPreview(result);
        syncCallsSection(result);
        syncResultTimings(result);
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
    setBusy(isBusy);
  }

  function lifecycleErrorMessage(result) {
    const error = result?.error || {};
    const code = String(error.code || '').trim();
    const message = String(error.message || code || 'request failed').trim();
    const details = error.details || {};
    // Every reason the service reports for refusing to export, in the order it
    // decides them: the source itself, then the document census, then what the
    // exporter found in the plan. Leaving one out shows the generic code alone.
    const sourceReasons = Array.isArray(details.pdf_source_declined)
      ? details.pdf_source_declined.map(String).filter(Boolean)
      : [];
    const earlyReason = String(details.vector_declined || '').trim();
    const engineReasons = Array.isArray(details.pdf_engine_declined)
      ? details.pdf_engine_declined.map(String).filter(Boolean)
      : [];
    const reason = sourceReasons.join(', ')
      || earlyReason
      || engineReasons.join(', ');
    const labelled = code && code !== message ? `${message} [${code}]` : message;
    return reason ? `${labelled} — ${reason}` : labelled;
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

  function historyLabel(item) {
    const name = String(item?.source_filename || item?.request_id || 'request');
    const target = String(item?.target_lang_code || '?');
    const date = item?.submitted_at_utc ? new Date(item.submitted_at_utc) : null;
    const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : '';
    return `${name} → ${target}${when ? ` · ${when}` : ''}`;
  }

  function renderHistorySelect(selected = historySelect.value || 'new') {
    const options = [{ value: 'new', label: 'New request' }];
    if (
      transientRequest
      && !recentRequests.some((request) => request.request_id === transientRequest.request_id)
    ) {
      options.push({
        value: `current:${transientRequest.request_id}`,
        label: transientRequest.label,
      });
    }
    for (const item of recentRequests) {
      options.push({ value: `history:${item.request_id}`, label: historyLabel(item) });
    }
    historySelect.innerHTML = '';
    for (const item of options) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      historySelect.append(option);
    }
    historySelect.value = options.some((item) => item.value === selected) ? selected : 'new';
  }

  async function loadRecentRequests(selected = historySelect.value || 'new') {
    try {
      const payload = await api.listPdfRequests();
      recentRequests = Array.isArray(payload?.requests) ? payload.requests : [];
      historyField.hidden = Number(payload?.limit || 0) <= 0;
      let wanted = historySelect.value || selected;
      if (wanted.startsWith('current:')) {
        const requestId = wanted.slice('current:'.length);
        if (recentRequests.some((request) => request.request_id === requestId)) {
          wanted = `history:${requestId}`;
        }
      }
      renderHistorySelect(wanted);
    } catch {
      recentRequests = [];
      historyField.hidden = true;
      renderHistorySelect('new');
    }
  }

  async function fetchHistoricalOptions(requestId) {
    const url = `/api/pdf-translation/requests/${encodeURIComponent(requestId)}/artifacts/request_options`;
    const response = await fetch(url);
    if (response.ok) return { state: 'available', options: await response.json() };
    if (response.status === 404) return { state: 'missing', options: null };
    if (response.status === 410) return { state: 'expired', options: null };
    const payload = await response.json().catch(() => null);
    const error = new Error(`HTTP ${response.status}`);
    error.detail = payload?.detail || payload;
    throw error;
  }

  async function inspectHistoricalRequest(requestId) {
    const item = recentRequests.find((request) => request.request_id === requestId) || {};
    if (!isInspectingHistory) newRequestDraft = captureControlState();
    stopPolling();
    fileInput.value = '';
    clearOutputPreview();
    clearCallFields();
    callsLoadedFor = '';
    callsStatusEl.textContent = '';
    isInspectingHistory = true;
    historyOptionsAvailable = false;
    activeHistoricalOptions = null;
    historicalInputRequestId = requestId;
    historicalFilename = String(item.source_filename || '');
    currentRequestId = requestId;
    setBusy(true);
    setStatus('');
    try {
      const [result, optionsResult] = await Promise.all([
        api.getPdfRequest(requestId),
        fetchHistoricalOptions(requestId),
      ]);
      applyLifecycle(result);
      const options = optionsResult.options;
      if (optionsResult.state === 'available') {
        historicalFilename = String(options.source_filename || historicalFilename);
        activeHistoricalOptions = options;
        applyControlState(options);
        historyOptionsAvailable = true;
      } else if (optionsResult.state === 'missing') {
        setStatus(
          'This older request has no settings snapshot. Its artifacts are available, but it cannot be safely re-rendered after a service restart.',
          'error',
        );
      } else {
        historicalInputRequestId = '';
        updateInputPreview();
        setStatus('The artifacts for this request have expired.', 'error');
        syncHistoricalTimings();
        updateStageVisibility();
        return;
      }
      lastTargetLang = String(options?.target_lang_code || item.target_lang_code || '');
      updateInputPreview();
      renderOutputPreview(result);
      syncCallsSection(result);
      syncResultTimings(result);
      updateStageVisibility();
    } catch (err) {
      const draft = newRequestDraft;
      currentRequestId = '';
      historicalInputRequestId = '';
      historicalFilename = '';
      isInspectingHistory = false;
      historyOptionsAvailable = true;
      activeHistoricalOptions = null;
      newRequestDraft = null;
      if (draft) applyControlState(draft);
      statIdEl.textContent = '-';
      statIdEl.title = '';
      statStateEl.textContent = '-';
      statStageEl.textContent = '-';
      statPagesEl.textContent = '-';
      statQueueEl.textContent = '-';
      rawEl.value = '';
      updateInputPreview();
      syncTimingsSection(null);
      updateStageVisibility();
      renderHistorySelect('new');
      setStatus(formatApiError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Only the currently-loaded pool models (green), plus the service's configured default (added
  // in red if not loaded). One pick drives grouping + translation, like the image view.
  // The host's configured page concurrency is the default and translate_pdf clamps a request to
  // twice it, so mirror both here: the control cannot ask for something the service will refuse,
  // and this box's numbers stay out of the frontend.
  let pageConcurrencyDefault = null;
  let pageConcurrencyMax = null;

  function applyConcurrencyCaps(caps) {
    const dflt = Math.round(Number(caps?.page_concurrency));
    const max = Math.round(Number(caps?.page_concurrency_max));
    if (Number.isFinite(dflt) && dflt >= 1) {
      pageConcurrencyDefault = dflt;
      pageConcurrencyInput.placeholder = `host default (${dflt})`;
    }
    // Name what "leave it to the service" resolves to: an option reading only "host default"
    // says nothing about which behaviour it selects.
    const label = (select, value, fallback) => {
      const option = select?.querySelector('option[value=""]');
      if (option) option.textContent = `host default (${String(value || fallback)})`;
    };
    label(pageCategoryModeSelect, caps?.page_category_mode, 'per_page');
    label(translationPromptSelect, caps?.translation_prompt_id, 'translate_image_default');
    if (Number.isFinite(max) && max >= 1) {
      pageConcurrencyMax = max;
      pageConcurrencyInput.max = String(max);
    }
    pageConcurrencyInput.title = pageConcurrencyDefault
      ? `Pages of this document translated at once. Empty uses the host default (${pageConcurrencyDefault}); the service clamps to ${pageConcurrencyMax ?? pageConcurrencyDefault * 2} and never runs more workers than pages.`
      : 'Pages of this document translated at once. Empty uses the host default.';
  }

  async function loadModelChoices() {
    let models = [];
    let defaultModel = '';
    let pdfCaps = null;
    try {
      const [adminPayload, statusPayload] = await Promise.all([
        api.getAdminModels(),
        api.getTranslationStatus().catch(() => null),
      ]);
      models = Array.isArray(adminPayload?.models) ? adminPayload.models : [];
      defaultModel = String(statusPayload?.llm_pool?.translator_model || '');
      pdfCaps = statusPayload?.pdf || null;
    } catch {
      models = [];
    }
    applyConcurrencyCaps(pdfCaps);
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
    if (isInspectingHistory && activeHistoricalOptions) applyControlState(activeHistoricalOptions);
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
    if (!file && !historicalInputRequestId) {
      inputPreview.removeAttribute('src');
    } else if (!file) {
      inputPreview.src = `/api/pdf-translation/requests/${encodeURIComponent(historicalInputRequestId)}/artifacts/input`;
    } else {
      inputObjectUrl = URL.createObjectURL(file);
      inputPreview.src = inputObjectUrl;
    }
    showOriginalFrame();
  }

  // Stage timings, document total or one page. The scope choice survives a re-run, like the page
  // picker below it. A re-render only re-runs the render stage, so its per-page metrics carry only
  // replacement_wall_ms — the other stages read "—" then, which is honest: they did not run.
  let timingsScopeValue = 'total';
  let lastTimingsResult = null;

  function syncHistoricalTimings() {
    lastTimingsResult = null;
    timingsScope.innerHTML = '';
    timingsScopeField.hidden = true;
    timingsEl.innerHTML = '<div class="trt-row trt-placeholder"><span>Timings are not available for previous requests.</span></div>';
  }

  function syncResultTimings(result) {
    if (result?.response?.metrics) syncTimingsSection(result);
    else if (isInspectingHistory) syncHistoricalTimings();
    else syncTimingsSection(result);
  }

  function syncTimingsSection(result) {
    lastTimingsResult = result;
    const pages = result?.response?.document?.pages || [];
    const total = result?.response?.metrics?.translate_pdf_total_wall_ms;
    // No run yet: hide the scope picker and show the placeholder card, matching the image view.
    if (!pages.length && typeof total !== 'number') {
      timingsScope.innerHTML = '';
      timingsScopeField.hidden = true;
      timingsEl.innerHTML = '<div class="trt-row trt-placeholder"><span>Run a request to see stage timings.</span></div>';
      return;
    }
    timingsScopeField.hidden = false;
    const options = ['<option value="total">Document total</option>']
      .concat(pages.map((p) => `<option value="${p.page}">Page ${p.page}</option>`));
    if (timingsScope.options.length !== options.length) timingsScope.innerHTML = options.join('');
    if (!Array.from(timingsScope.options).some((o) => o.value === timingsScopeValue)) timingsScopeValue = 'total';
    timingsScope.value = timingsScopeValue;
    renderTimings();
  }

  // Integer shares that add to exactly 100: largest-remainder, so the rounding drift lands on the
  // stages with the biggest fractional part instead of leaving the column reading 99 or 101.
  function integerShares(values) {
    const total = values.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return values.map(() => 0);
    const exact = values.map((v) => (v / total) * 100);
    const shares = exact.map(Math.floor);
    let rest = 100 - shares.reduce((a, b) => a + b, 0);
    const byRemainder = exact
      .map((v, i) => ({ frac: v - Math.floor(v), i }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < byRemainder.length && rest > 0; k += 1, rest -= 1) shares[byRemainder[k].i] += 1;
    return shares;
  }

  function renderTimings() {
    const result = lastTimingsResult;
    if (!result) return;
    const ms = (v) => (typeof v === 'number' ? `${Math.round(v)} ms` : '—');
    const row = (label, value, cls = '', title = '') => `<div class="trt-row ${cls}"${title ? ` title="${escapeAttr(title)}"` : ''}><span>${label}</span><strong>${value}</strong></div>`;
    const note = (text) => `<div class="trt-note">${text}</div>`;

    if (timingsScopeValue === 'total') {
      const m = result?.response?.metrics || {};
      const timings = result?.timings || {};
      const pages = result?.response?.document?.pages || [];
      const total = m.translate_pdf_total_wall_ms;
      // Only render and assemble are summed on the document response; the earlier stages are
      // per page, so sum them here across pages for the whole-document breakdown.
      const sum = (key) => {
        const vals = pages.map((p) => p?.metrics?.[key]).filter((v) => typeof v === 'number');
        return vals.length ? vals.reduce((a, b) => a + b, 0) : undefined;
      };
      const secMs = (s) => (typeof s === 'number' ? `${Math.round(s * 1000)} ms` : '—');
      // Pages run concurrently, so these stage times add up to well over the elapsed document
      // total. Sharing each stage against the elapsed total would print percentages over 100 that
      // are only that sum in disguise (they are the work shares scaled by one constant factor), so
      // share against the stage sum instead and state the factor once, on its own row.
      const stages = [
        ['OCR', sum('ocr_wall_ms')],
        ['Grouping (VLM)', sum('grouping_wall_ms')],
        ['Layout', sum('layout_wall_ms')],
        ['Align', sum('align_wall_ms')],
        ['Translation', sum('translation_wall_ms')],
        ['Render', typeof m.replacement_wall_ms_total === 'number' ? m.replacement_wall_ms_total : sum('replacement_wall_ms')],
        ['Assemble PDF', m.assemble_wall_ms],
      ];
      const measured = stages.filter(([, v]) => typeof v === 'number');
      const stageTotal = measured.reduce((a, [, v]) => a + v, 0);
      const shares = integerShares(measured.map(([, v]) => v));
      const shareByLabel = new Map(measured.map(([label], i) => [label, shares[i]]));
      const factor = typeof total === 'number' && total > 0 ? stageTotal / total : null;
      const waited = typeof m.wait_ms_total === 'number' ? m.wait_ms_total : null;
      // Queue time is not work, so the multiplier that means something is the one left after
      // taking it out: that is the parallelism the run actually got out of the pool.
      const effective = factor !== null && waited !== null && total > 0
        ? Math.max(0, stageTotal - waited) / total
        : null;
      const stage = ([label, v]) => {
        if (typeof v !== 'number') return row(label, '—', 'trt-l1');
        return row(label, `${Math.round(v)} ms · ${shareByLabel.get(label)}%`, 'trt-l1');
      };
      timingsEl.innerHTML = [
        // Two different queues meet in this card, so both say which one they mean: this one is the
        // wait BEFORE the run started (translation-services' own runner slots); the llm-pool row
        // below is time inside the run. The field behind this is named pool_queue_wait_s, where
        // "pool" means the service's runner pool — not the model pool.
        row('Queued (runner slot)', secMs(timings.pool_queue_wait_s), '',
          'Waited for a free runner slot in translation-services before this request started — not model time.'),
        row('Document total', ms(total), 'trt-total'),
        // Sum of every row below. Most are per-page totals of overlapping pages, so the sum
        // exceeds the elapsed time; Assemble PDF is document-level and runs after the pages, which
        // is why this is not called "summed over pages". It splits into queued + working, and both
        // get their own row — but neither multiplier is a speed-up, see the note below.
        row('All steps summed', factor
          ? `${Math.round(stageTotal)} ms · ${factor.toFixed(1)}× document total`
          : ms(stageTotal), 'trt-total'),
        typeof waited === 'number' && stageTotal > 0
          ? row('of which queued', `${Math.round(waited)} ms · ${Math.round((waited / stageTotal) * 100)}%`, 'trt-l1',
            'Part of the rows below, not an addition to them: time spent waiting for a shared resource instead of working — model-pool admission and the pool\'s own queue, and the layout detector lock.')
          : '',
        effective !== null
          ? row('working', `${Math.round(stageTotal - waited)} ms · ${effective.toFixed(1)}× document total`, 'trt-l1',
            'The queue taken out. Still not a speed-up: a page costs measurably more work under contention than it does alone, so this multiplier rises as the GPU gets busier — the opposite of what it looks like.')
          : '',
        ...stages.map(stage),
        // Deliberately outside `stages`: the debug overlay is not a step of producing the
        // translation, and folding it in would move every share and the multiplier above,
        // so the same run would read differently for having been inspected. Present only
        // when it was asked for.
        typeof m.doclayout_assemble_wall_ms === 'number'
          ? row('Doclayout overlay (debug)', `${Math.round(m.doclayout_assemble_wall_ms)} ms`, 'trt-l1',
            'Drawing the detector\'s regions on every page and assembling them as a second PDF. Asked for by the Doclayout overlay option; it lengthens the request but is no part of the rows above, whose figures mean the same with or without it.')
          : '',
        typeof m.paddleocr_v5_assemble_wall_ms === 'number'
          ? row('PaddleOCR V5 PDF (debug)', `${Math.round(m.paddleocr_v5_assemble_wall_ms)} ms`, 'trt-l1',
            'Assembling the labelled V5 page overlays into a PDF. The separate V5 inference appears in the timeline; this assembly time is not part of the translation-stage rows above.')
          : '',
        row('Pages', typeof m.page_count === 'number' ? String(m.page_count) : '—', 'trt-l1'),
        row('Page concurrency', typeof m.page_concurrency === 'number' ? String(m.page_concurrency) : '—', 'trt-l1'),
        outputRouteRow(result, row),
        surrenderedProtectionsRow(result, row),
        note(`Pages run in parallel, so the rows below add up to more than the elapsed document total. Their percentages are shares of that sum and add up to 100%.${effective !== null
          ? ' Neither multiplier is a speed-up: the raw one grows with the queue, and <strong>working</strong> grows with per-page slowdown under contention — both rise as the GPU gets more congested. To know what page concurrency actually buys, compare the document total against a run at page concurrency 1.'
          : ''}`),
      ].join('');
      return;
    }

    const page = (result?.response?.document?.pages || []).find((p) => String(p.page) === String(timingsScopeValue));
    const m = page?.metrics || {};
    const total = m.translate_image_total_wall_ms;
    // Stage row with its share of the page total — the same breakdown the image view shows.
    const stage = (label, v) => {
      if (typeof v !== 'number') return row(label, '—', 'trt-l1');
      const pct = typeof total === 'number' && total > 0 ? ` · ${Math.round((v / total) * 100)}%` : '';
      return row(label, `${Math.round(v)} ms${pct}`, 'trt-l1');
    };
    timingsEl.innerHTML = [
      row('Page total', ms(total), 'trt-total'),
      stage('OCR', m.ocr_wall_ms),
      stage('Grouping (VLM)', m.grouping_wall_ms),
      stage('Layout', m.layout_wall_ms),
      stage('Align', m.align_wall_ms),
      stage('Translation', m.translation_wall_ms),
      stage('Render', m.replacement_wall_ms),
    ].join('');
  }

  timingsScope.addEventListener('change', () => {
    timingsScopeValue = String(timingsScope.value || 'total');
    renderTimings();
  });

  // Prompts & responses, one page at a time. The page choice survives a re-run: you are usually
  // studying one page across renders, and being thrown back to page 1 each time defeats that.
  let callsPage = 0;
  let callsLoadedFor = '';

  function pagesWithCalls(result) {
    const artifacts = result?.response?.artifacts || {};
    return Object.keys(artifacts)
      .map((name) => /^page-(\d+)-llm-calls$/.exec(name))
      .filter(Boolean)
      .map((m) => parseInt(m[1], 10))
      .sort((a, b) => a - b);
  }

  function syncCallsSection(result) {
    const pages = pagesWithCalls(result);
    if (!pages.length) {
      callsPageSelect.innerHTML = '';
      clearCallFields();
      callsStatusEl.textContent = 'No call log on this run.';
      callsLoadedFor = '';
      return;
    }
    const wanted = pages.includes(callsPage) ? callsPage : pages[0];
    const changed = callsPageSelect.options.length !== pages.length
      || String(callsPageSelect.value) !== String(wanted);
    if (callsPageSelect.options.length !== pages.length) {
      callsPageSelect.innerHTML = pages.map((p) => `<option value="${p}">Page ${p}</option>`).join('');
    }
    callsPageSelect.value = String(wanted);
    callsPage = wanted;
    if (changed) callsLoadedFor = '';
    if (callsDetails.open) loadCallsForPage();
  }

  function clearCallFields() {
    for (const el of Object.values(callEls)) el.value = '';
  }

  async function loadCallsForPage() {
    const requestId = String(currentRequestId || '');
    const page = parseInt(callsPageSelect.value || '0', 10);
    if (!requestId || !page) return;
    const key = `${requestId}|${page}`;
    if (callsLoadedFor === key) return;
    callsStatusEl.textContent = 'Loading…';
    try {
      const name = `page-${String(page).padStart(3, '0')}-llm-calls`;
      const url = `/api/pdf-translation/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(name)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      fillCallFields(await response.json());
      callsLoadedFor = key;
      callsStatusEl.textContent = '';
    } catch (err) {
      clearCallFields();
      callsLoadedFor = '';
      callsStatusEl.textContent = `Could not load page ${page}: ${err.message || err}`;
    }
  }

  // Same split as the image view, on this page's calls: the grouping call, the page's structured
  // translation call, and everything else in order — the island batch, hint-line and per-unit
  // calls, each labelled with the role that says why it exists.
  function fillCallFields(calls) {
    if (!Array.isArray(calls)) { clearCallFields(); return; }
    const grouping = calls.find((c) => String(c?.role) === 'grouping_vlm');
    const main = calls.find((c) => {
      const role = String(c?.role || '');
      return role === 'translation_main' || role === 'translation_main_numbered';
    });
    const others = calls.filter((c) => c !== grouping && c !== main);
    callEls.vlmSystem.value = grouping ? String(grouping?.payload?.instructions || '') : '';
    callEls.vlmInput.value = grouping ? callInputText(grouping) : '';
    callEls.vlmResponse.value = grouping ? callResponseText(grouping) : '';
    callEls.xlateSystem.value = main ? String(main?.payload?.instructions || '') : '';
    callEls.xlateInput.value = main ? callInputText(main) : '';
    callEls.xlateResponse.value = main ? callResponseText(main) : '';
    callEls.other.value = others.length
      ? others.map(formatCall).join('\n\n──────────\n\n')
      : '(none — the page needed no calls beyond the two above)';
  }

  function callInputText(call) {
    const input = call?.payload?.input;
    if (Array.isArray(input)) {
      return input.filter((p) => p && p.type === 'text').map((p) => String(p.text || '')).join('\n');
    }
    return String(input || '');
  }

  function callResponseText(call) {
    const response = call?.response;
    if (response && typeof response === 'object') {
      return String(response.output_text || JSON.stringify(response, null, 2));
    }
    return String(response || call?.error || '');
  }

  function formatCall(call) {
    const system = String(call?.payload?.instructions || '');
    const ms = call?.wall_ms;
    return [
      `# ${String(call?.role || 'call')}${typeof ms === 'number' ? `   (${(ms / 1000).toFixed(2)}s)` : ''}`,
      system ? `[system]\n${system}` : '',
      `[input]\n${callInputText(call)}`,
      `[response]\n${callResponseText(call)}`,
    ].filter(Boolean).join('\n');
  }

  callsPageSelect.addEventListener('change', () => {
    callsPage = parseInt(callsPageSelect.value || '0', 10);
    callsLoadedFor = '';
    loadCallsForPage();
  });
  callsDetails.addEventListener('toggle', () => {
    if (callsDetails.open) loadCallsForPage();
  });

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

  // Destination-subdir picker for Add-to-testset — mirrors the image panel. The fixture mirrors
  // the source's subdir, so this chooses where a fresh PDF is filed; '' = flat testset/pdf root.
  const NEW_SUBDIR = ' new';
  async function populateSubdirs() {
    let dirs = [];
    try { dirs = (await api.listPdfRegressionSubdirs()).subdirs || []; } catch { /* root-only picker */ }
    regSubdirSel.innerHTML = ['<option value="">(root)</option>']
      .concat(dirs.map((d) => `<option value="${escapeAttr(d)}">${escapeHtml(d)}</option>`))
      .concat([`<option value="${NEW_SUBDIR}">+ new subdir…</option>`])
      .join('');
    syncSubdirNew();
  }
  function syncSubdirNew() {
    regSubdirNew.style.display = regSubdirSel.value === NEW_SUBDIR ? '' : 'none';
  }
  function subdirValue() {
    const raw = regSubdirSel.value === NEW_SUBDIR ? regSubdirNew.value : regSubdirSel.value;
    return String(raw || '').trim().replace(/^\/+|\/+$/g, '');
  }
  // The name to file under: the run's own PDF filename (stem). A source already matched to a
  // testset document by content hash uses that name instead — no add needed.
  function uploadStem() {
    return String(selectedFile()?.name || historicalFilename || '').replace(/\.[^.]+$/, '').trim();
  }

  // Two-step, exactly like the image panel: Add-to-testset files the PDF under a subdir, then
  // Capture freezes the fixture there. The content-hash match is the shortcut — a PDF that is
  // already in the testset skips straight to Capture.
  function renderRegInfo() {
    const completed = currentState() === 'completed';
    const lang = String(lastTargetLang || '').toLowerCase() || '?';
    const inTestset = Boolean(regStatus && regStatus.in_testset);
    const name = inTestset ? regStatus.name : uploadStem();
    if (!completed) {
      regInfoEl.textContent = 'Translate a PDF to capture it as a fixture.';
      regAddTestsetBtn.disabled = true;
      regCaptureBtn.disabled = true;
      regCaptureBtn.textContent = 'Capture fixture';
      return;
    }
    const langs = (regStatus && regStatus.langs) || {};
    const hasForLang = Array.isArray(langs[lang]) && langs[lang].length > 0;
    if (!name) {
      regInfoEl.textContent = 'Re-pick the PDF to name a fixture for it.';
    } else if (inTestset) {
      const at = regStatus.reldir ? `${regStatus.reldir}/` : '';
      const fixtures = Object.keys(langs).length
        ? Object.keys(langs).sort().map((l) => `${l}: ${langs[l].join(', ')}`).join(' · ')
        : 'no fixture yet';
      regInfoEl.textContent = `${at}${name} · in testset · ${fixtures}`;
    } else {
      regInfoEl.textContent = `${name} · not in testset`;
    }
    // Add is for a PDF not yet in the testset; the subdir picker only matters then.
    regAddTestsetBtn.disabled = isBusy || !completed || !name || inTestset;
    const canAdd = !regAddTestsetBtn.disabled;
    regSubdirSel.disabled = !canAdd;
    regSubdirNew.disabled = !canAdd;
    // Capture mirrors the source's subdir, so the source must be in the testset first (or matched).
    regCaptureBtn.disabled = isBusy || !completed || !inTestset;
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
      regStatus = null;
    }
    renderRegInfo();
  }

  async function addToTestset() {
    const name = uploadStem();
    if (!currentRequestId || !name) return;
    regAddTestsetBtn.disabled = true;
    setCaptureStatus('Adding to testset…');
    try {
      regStatus = await api.addPdfRegressionTestset({ request_id: currentRequestId, name, subdir: subdirValue() });
      setCaptureStatus('Added to testset.');
      await populateSubdirs();  // a freshly-typed subdir now exists — offer it next time
    } catch (err) {
      setCaptureStatus(formatApiError(err), 'error');
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

  // Every finished document this run produced, in the order the selector offers them: the
  // translation first, because that is what the view is for.
  const ARTIFACT_LABELS = {
    rendered: 'Translated PDF',
    doclayout: 'PP-DocLayoutV2',
    'doclayout-plus-l': 'PP-DocLayout_plus-L',
    'doclayout-v3': 'PP-DocLayoutV3',
    'paddleocr-v5': 'PaddleOCR V5',
  };

  function pdfArtifactNames(result) {
    const artifacts = result?.response?.artifacts || {};
    const names = Object.keys(artifacts).filter((name) => {
      const artifact = artifacts[name] || {};
      return name !== 'input' && String(artifact.mime_type || '').toLowerCase().includes('pdf');
    });
    const artifactOrder = ['rendered', 'paddleocr-v5', 'doclayout', 'doclayout-plus-l', 'doclayout-v3'];
    const rank = (name) => {
      const index = artifactOrder.indexOf(name);
      return index < 0 ? artifactOrder.length : index;
    };
    return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }

  // The document the right-hand frame shows: whatever the selector holds, falling back to the
  // first available (the translation) when a run does not carry the previous choice — switching
  // the overlay off must not leave the frame pointing at an artifact that is gone.
  function pdfArtifactName(result) {
    const names = pdfArtifactNames(result);
    if (!names.length) return '';
    return names.includes(artifactSelect.value) ? artifactSelect.value : names[0];
  }

  function syncArtifactSelect(result) {
    const names = pdfArtifactNames(result);
    const wanted = names.includes(artifactSelect.value) ? artifactSelect.value : (names[0] || '');
    artifactSelect.innerHTML = names.length
      ? names.map((name) => {
        const label = ARTIFACT_LABELS[name] || name;
        return `<option value="${name}"${name === wanted ? ' selected' : ''}>${label}</option>`;
      }).join('')
      : '<option value="">No document</option>';
    artifactSelect.value = wanted;
  }

  function renderOutputPreview(result) {
    const requestId = String(result?.request_id || currentRequestId || '');
    syncArtifactSelect(result);
    lastResultForArtifact = result;
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
    const base = (selectedFile()?.name || historicalFilename || 'document').replace(/\.[^.]+$/, '') || 'document';
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
      // No name: the source is in the testset now (added, or hash-matched), so capture takes the
      // matched name and mirrors its subdir — exactly what the image capture does.
      const body = { request_id: currentRequestId, freeze_score: Boolean(regScoreInput.checked) };
      const out = await api.capturePdfRegression(body);
      const scoreNote = out.accepted_scores?.axes
        ? ` · L ${out.accepted_scores.axes.layout} · A ${out.accepted_scores.axes.anchors} · T ${out.accepted_scores.axes.typography}`
        : '';
      const benchNote = out.benchmark?.run_id
        ? ' · added to the PDF-testing matrix as "ours"'
        : (out.benchmark?.error ? ` · benchmark mirror failed: ${out.benchmark.error}` : '');
      setCaptureStatus(`Captured ${out.name}/${out.target_lang}/${out.variant}: ${out.pages} page(s), ${out.units} unit(s)${scoreNote}${benchNote}. See the PDF translation regression view.`);
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
      // Send the target language so the measurement's OCR reads the rendered pages with the right
      // model — otherwise A/T/U default to the en model and diverge from the capture's score.
      formData.append('request_json', JSON.stringify({ request_id: currentRequestId, target_lang: String(targetInput.value || '').trim() }));
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
    const draft = isInspectingHistory ? newRequestDraft : null;
    isInspectingHistory = false;
    historyOptionsAvailable = true;
    historicalInputRequestId = '';
    historicalFilename = '';
    newRequestDraft = null;
    activeHistoricalOptions = null;
    transientRequest = null;
    isRerendering = false;
    fileInput.value = '';
    currentRequestId = '';
    clearOutputPreview();
    // A new document: drop the loaded log, but keep the page number — the next document
    // falls back to its first page when it does not go that far.
    callsPageSelect.innerHTML = '';
    callsStatusEl.textContent = '';
    callsLoadedFor = '';
    clearCallFields();
    timingsScope.innerHTML = '';
    timingsEl.innerHTML = '';
    lastTimingsResult = null;
    if (draft) applyControlState(draft);
    updateInputPreview();
    setStatus('');
    updateStageVisibility();
    renderHistorySelect('new');
    setBusy(false);
  }

  if (browseBtn) browseBtn.addEventListener('click', () => fileInput.click());
  if (resetBtn) resetBtn.addEventListener('click', resetView);
  benchmarkBtn.addEventListener('click', benchmarkRun);
  regCaptureBtn.addEventListener('click', captureFixture);
  regAddTestsetBtn.addEventListener('click', addToTestset);
  regSubdirSel.addEventListener('change', () => { syncSubdirNew(); renderRegInfo(); });
  regSubdirNew.addEventListener('input', renderRegInfo);
  populateSubdirs();
  syncTimingsSection(null);  // placeholder card before the first run, matching the image view
  if (cancelBtn) cancelBtn.addEventListener('click', cancelRequest);
  if (showOriginalToggle) showOriginalToggle.addEventListener('change', applyViewMode);
  historySelect.addEventListener('change', () => {
    const selected = String(historySelect.value || 'new');
    if (selected === 'new') {
      resetView();
      return;
    }
    const separator = selected.indexOf(':');
    const requestId = separator >= 0 ? selected.slice(separator + 1) : '';
    if (requestId) inspectHistoricalRequest(requestId);
  });
  modelSelect.addEventListener('change', updateModelSelectColor);
  // A render flag changing on a completed document re-renders it; with nothing loaded the new
  // value simply rides along on the next translation.
  [renderSizeModeSelect, eraseFillModeSelect, sizeMetricModeSelect, sizeCohortModeSelect,
    widthFitModeSelect, outputModeSelect, structureModeSelect, pageLayoutModeSelect,
   pageScaleSelect, doclayoutOverlaySelect, paddleocrV5OverlaySelect].forEach(
    (select) => select.addEventListener('change', rerenderRequest));

  // Choosing another finished document only re-points the frame — nothing is re-run.
  artifactSelect.addEventListener('change', () => {
    if (lastResultForArtifact) renderOutputPreview(lastResultForArtifact);
  });

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

  // Leaving the view stops the poll, but the run keeps going server-side. Resume it on return
  // for a request that was still in flight, so the page counter moves again instead of the
  // spinner hanging on the state the view was left in; startPolling polls once immediately, so
  // a run that finished while away renders its result right away.
  container.__onActivate = () => {
    if (currentRequestId && !isTerminalState(currentState())) startPolling();
  };
  container.__onDeactivate = () => {
    // Keep polling a run that is still going: both the sidebar indicator and the page counter
    // have to be right while you are elsewhere, and one small GET per interval beats being wrong.
    if (!currentRequestId || isTerminalState(currentState())) stopPolling();
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
  loadRecentRequests();
  return container;
}
