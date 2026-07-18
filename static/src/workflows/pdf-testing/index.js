import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

// PDF testing — the comparison surface of the benchmark & regression design
// (translation-services docs/pdf-benchmark-regression-design.md). This first
// cut is the Comparison matrix: documents x systems, per cell the axes and the
// unchanged indicator, rows sorted by proven-attainable headroom. The Replay
// and Score panes join once document fixtures exist; until then this view
// deliberately shows no dead tabs.

const AXES = [
  { key: 'layout', label: 'L' },
  { key: 'retention', label: 'R' },
  { key: 'typography', label: 'T' },
];

export function createPdfTestingView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view pdf-testing-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <div class="pdf-testing-content">
          <section class="pdf-testing-matrix-section">
            <div class="pdf-testing-toolbar">
              <h2>Comparison</h2>
              <button type="button" id="pdfTestingRefresh" title="Reload stored benchmark runs">Refresh</button>
            </div>
            <div class="pdf-testing-legend">
              <span><strong>L</strong> layout: region overlap with the source (0-100)</span>
              <span><strong>R</strong> retention: 100 minus the share of text that went missing</span>
              <span><strong>T</strong> typography: penalizes stray text and size-ratio drift</span>
              <span><strong>U</strong> unchanged: share of text left verbatim (indicator, not a verdict; compare it across systems on the same document)</span>
            </div>
            <div class="pdf-testing-note">
              <strong>Informative, not a ranking.</strong> The numbers measure what survived the
              translation, and fundamentally different approaches preserve different things
              by design: a system that re-typesets the document scores low on layout no
              matter how well it executes, and one that returns the source unchanged maxes
              every axis. Read the flags and the unchanged share first; compare axes only
              between comparable approaches, and mainly against our own earlier runs.
              Visual quality and translation adequacy are not measured here.
            </div>
            <div class="pdf-testing-matrix" id="pdfTestingMatrix">Loading…</div>
          </section>

          <section class="pdf-testing-detail" id="pdfTestingDetail" hidden>
            <div class="pdf-testing-toolbar">
              <h2 id="pdfTestingDetailTitle"></h2>
              <button type="button" id="pdfTestingDetailClose" title="Close detail">✕</button>
            </div>
            <div class="pdf-testing-detail-legend">
              <span class="pdf-testing-swatch is-matched"></span> matched (with IoU)
              <span class="pdf-testing-swatch is-covered"></span> covered (detector split/merge/nested; not scored)
              <span class="pdf-testing-swatch is-lost"></span> lost (no counterpart in translation)
              <span class="pdf-testing-swatch is-invented"></span> invented (no counterpart in source)
            </div>
            <div class="pdf-testing-note">
              Region statuses reflect the layout detector's segmentation of each render and
              the 1-to-1 matching behind L. An unmatched region is not necessarily missing
              or new content: detector splits, merges and misses show up here too. Whether
              the text itself survived is measured independently by R.
            </div>
            <div id="pdfTestingDetailPages"></div>
          </section>

          <section class="pdf-testing-import">
            <details class="translation-prompts-system-details">
              <summary>Import an external translation</summary>
              <div class="pdf-testing-import-body">
                <label class="translation-prompts-field">
                  <span>Source document</span>
                  <select id="pdfTestingSource"></select>
                </label>
                <label class="translation-prompts-field" id="pdfTestingSourceUploadField" hidden>
                  <span>Source PDF</span>
                  <input type="file" id="pdfTestingSourceFile" accept="application/pdf">
                </label>
                <label class="translation-prompts-field">
                  <span>Translated PDF</span>
                  <input type="file" id="pdfTestingTranslatedFile" accept="application/pdf">
                </label>
                <label class="translation-prompts-field">
                  <span>System label</span>
                  <input type="text" id="pdfTestingSystem" placeholder="e.g. ref-a" spellcheck="false">
                </label>
                <div class="translation-prompts-run-actions">
                  <button type="button" id="pdfTestingImportBtn">Measure &amp; score</button>
                </div>
                <div class="translation-prompts-inline-status" id="pdfTestingImportStatus"></div>
              </div>
            </details>
          </section>
        </div>
      </div>
    </div>
  `;

  const matrixEl = container.querySelector('#pdfTestingMatrix');
  const refreshBtn = container.querySelector('#pdfTestingRefresh');
  const detailEl = container.querySelector('#pdfTestingDetail');
  const detailTitleEl = container.querySelector('#pdfTestingDetailTitle');
  const detailCloseBtn = container.querySelector('#pdfTestingDetailClose');
  const detailPagesEl = container.querySelector('#pdfTestingDetailPages');
  const sourceSelect = container.querySelector('#pdfTestingSource');
  const sourceUploadField = container.querySelector('#pdfTestingSourceUploadField');
  const sourceFileInput = container.querySelector('#pdfTestingSourceFile');
  const translatedFileInput = container.querySelector('#pdfTestingTranslatedFile');
  const systemInput = container.querySelector('#pdfTestingSystem');
  const importBtn = container.querySelector('#pdfTestingImportBtn');
  const importStatusEl = container.querySelector('#pdfTestingImportStatus');

  const UPLOAD_SOURCE = ' upload';
  let importBusy = false;

  function setImportStatus(message, kind = '') {
    importStatusEl.textContent = String(message || '');
    importStatusEl.classList.toggle('is-error', kind === 'error');
  }

  // --- matrix ---------------------------------------------------------------

  // Latest run per (doc, system); "ours" keeps every run for the spread.
  function organizeRuns(runs) {
    const docs = new Map();
    for (const run of runs) {
      const doc = docs.get(run.doc_id) || { docId: run.doc_id, systems: new Map() };
      const entries = doc.systems.get(run.system) || [];
      entries.push(run);
      doc.systems.set(run.system, entries);
      docs.set(run.doc_id, doc);
    }
    for (const doc of docs.values()) {
      for (const entries of doc.systems.values()) {
        entries.sort((a, b) => String(a.run_id).localeCompare(String(b.run_id)));
      }
    }
    return docs;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // Representative axes for a system's entries: single run as-is, multiple runs
  // (ours, N pipeline runs) the per-axis median.
  function summarize(entries) {
    const axes = {};
    for (const { key } of AXES) {
      axes[key] = median(entries.map((run) => Number(run.axes?.[key])).filter(Number.isFinite));
    }
    const unchanged = median(entries.map((run) => Number(run.indicators?.unchanged_share)).filter(Number.isFinite));
    const flagsBad = entries.some((run) => {
      const flags = run.flags || {};
      return ['page_count_equal', 'image_regions_equal', 'table_regions_equal'].some((key) => flags[key] === false);
    });
    return { axes, unchanged, count: entries.length, flagsBad };
  }

  // Our own progression per doc: the latest ours run against the best earlier
  // ours run, per axis; the axis with the largest movement is shown. Negative =
  // regression against our own best. Same architecture on both sides, so every
  // delta is an execution change, not an approach difference.
  function oursDelta(doc) {
    const ours = doc.systems.get('ours');
    if (!ours || ours.length < 2) return null;
    const earlier = ours.slice(0, -1);
    const latest = ours[ours.length - 1];
    let biggest = null;
    for (const { key } of AXES) {
      const latestValue = Number(latest.axes?.[key]);
      const bestEarlier = Math.max(...earlier.map((run) => Number(run.axes?.[key])).filter(Number.isFinite));
      if (!Number.isFinite(latestValue) || !Number.isFinite(bestEarlier)) continue;
      const delta = latestValue - bestEarlier;
      if (biggest === null || Math.abs(delta) > Math.abs(biggest.delta)) biggest = { axis: key, delta };
    }
    return biggest;
  }

  function cellMarkup(entries) {
    const { axes, unchanged, count, flagsBad } = summarize(entries);
    const axesText = AXES
      .map(({ key, label }) => `${label} ${Number.isFinite(axes[key]) ? axes[key].toFixed(1) : '—'}`)
      .join(' · ');
    const unchangedText = Number.isFinite(unchanged) ? `U ${unchanged.toFixed(1)}%` : '';
    const countBadge = count > 1 ? `<span class="pdf-testing-count" title="median over ${count} runs">×${count}</span>` : '';
    const flagBadge = flagsBad ? '<span class="pdf-testing-flag" title="structure flag raised (page/image/table count changed)">⚑</span>' : '';
    return `<div class="pdf-testing-cell">${escapeHtml(axesText)}<span class="pdf-testing-unchanged">${escapeHtml(unchangedText)}</span>${countBadge}${flagBadge}</div>`;
  }

  function renderMatrix(runs) {
    if (!runs.length) {
      matrixEl.innerHTML = '<div class="pdf-testing-empty">No benchmark runs stored yet. Run one from a completed PDF translation, or import an external translation below.</div>';
      return;
    }
    const docs = [...organizeRuns(runs).values()];
    const systems = ['identity', 'ours',
      ...new Set(docs.flatMap((doc) => [...doc.systems.keys()]).filter((s) => s !== 'identity' && s !== 'ours').sort()),
    ].filter((system) => docs.some((doc) => doc.systems.has(system)));

    docs.sort((a, b) => {
      const da = oursDelta(a), db = oursDelta(b);
      if (Boolean(db) !== Boolean(da)) return db ? 1 : -1;
      if (da && db && da.delta !== db.delta) return da.delta - db.delta; // regressions first
      return a.docId.localeCompare(b.docId);
    });

    const header = ['<th>document</th>', ...systems.map((s) => `<th>${escapeHtml(s)}</th>`),
      '<th title="Latest ours run vs the best earlier ours run; the axis that moved most">Δ ours</th>'].join('');
    const rows = docs.map((doc) => {
      const cells = systems.map((system) => {
        const entries = doc.systems.get(system);
        if (!entries) return '<td><span class="pdf-testing-none">—</span></td>';
        return `<td class="pdf-testing-clickable" data-doc="${escapeAttr(doc.docId)}" data-system="${escapeAttr(system)}" title="Click for per-page region overlays">${cellMarkup(entries)}</td>`;
      }).join('');
      const delta = oursDelta(doc);
      const deltaText = delta
        ? `<span class="${delta.delta < 0 ? 'pdf-testing-delta-down' : 'pdf-testing-delta-up'}">${AXES.find((a) => a.key === delta.axis)?.label} ${delta.delta >= 0 ? '+' : ''}${delta.delta.toFixed(1)}</span>`
        : '<span class="pdf-testing-none">n/a</span>';
      return `<tr><td class="pdf-testing-doc" title="${escapeAttr(doc.docId)}">${escapeHtml(doc.docId)}</td>${cells}<td class="pdf-testing-gap">${deltaText}</td></tr>`;
    }).join('');
    matrixEl.innerHTML = `<table class="pdf-testing-table"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  async function refreshMatrix() {
    try {
      const payload = await api.getPdfBenchmarkResults();
      renderMatrix(Array.isArray(payload?.runs) ? payload.runs : []);
    } catch (err) {
      matrixEl.innerHTML = `<div class="pdf-testing-empty is-error">${escapeHtml(formatApiError(err))}</div>`;
    }
  }

  // --- import ---------------------------------------------------------------

  async function populateSources() {
    let documents = [];
    try {
      documents = (await api.getPdfBenchmarkTestset()).documents || [];
    } catch { /* upstream down: upload-only */ }
    sourceSelect.innerHTML = documents
      .map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`)
      .concat([`<option value="${UPLOAD_SOURCE}">(upload a source PDF…)</option>`])
      .join('');
    syncSourceUpload();
  }

  function syncSourceUpload() {
    sourceUploadField.hidden = sourceSelect.value !== UPLOAD_SOURCE;
  }

  async function runImport() {
    if (importBusy) return;
    const translated = translatedFileInput.files && translatedFileInput.files[0];
    const system = String(systemInput.value || '').trim();
    if (!translated) return setImportStatus('Pick a translated PDF first.', 'error');
    if (!system) return setImportStatus('Type a system label.', 'error');
    const body = { system };
    const formData = new FormData();
    if (sourceSelect.value === UPLOAD_SOURCE) {
      const source = sourceFileInput.files && sourceFileInput.files[0];
      if (!source) return setImportStatus('Pick a source PDF (or choose a testset document).', 'error');
      formData.append('source_file', source);
    } else {
      body.testset_doc = sourceSelect.value;
    }
    formData.append('request_json', JSON.stringify(body));
    formData.append('translated_file', translated);
    importBusy = true;
    importBtn.disabled = true;
    setImportStatus('Measuring… (render + layout + OCR on both documents)');
    try {
      const result = await api.runPdfBenchmark(formData);
      const axes = result?.axes || {};
      setImportStatus(`Scored ${result?.doc_id || ''} / ${result?.system || ''}: layout ${axes.layout} · retention ${axes.retention} · typography ${axes.typography}.`);
      refreshMatrix();
    } catch (err) {
      setImportStatus(formatApiError(err), 'error');
    } finally {
      importBusy = false;
      importBtn.disabled = false;
    }
  }

  // --- detail (per-page region overlays) -------------------------------------

  async function openDetail(docId, system) {
    detailEl.hidden = false;
    detailTitleEl.textContent = `${docId} / ${system}`;
    detailPagesEl.innerHTML = '<div class="pdf-testing-empty">Loading…</div>';
    let payload;
    try {
      payload = await api.getPdfBenchmarkRunDetail(docId, system);
    } catch (err) {
      detailPagesEl.innerHTML = `<div class="pdf-testing-empty is-error">${escapeHtml(formatApiError(err))}</div>`;
      return;
    }
    const runId = String(payload?.run_id || '');
    const perPage = (payload?.scores?.per_page) || [];
    detailTitleEl.textContent = `${docId} / ${system} (${runId})`;
    detailPagesEl.innerHTML = perPage.map((page) => {
      const raw = page.raw || {};
      const overlay = (side) =>
        `/api/pdf-benchmark/runs/${encodeURIComponent(docId)}/${encodeURIComponent(system)}/${encodeURIComponent(runId)}/overlay/${side}/${page.page}`;
      return `
        <div class="pdf-testing-detail-page">
          <div class="pdf-testing-detail-pagehead">
            <strong>page ${page.page}</strong>
            <span>L ${page.layout} · R ${page.retention} · T ${page.typography}</span>
            <span>matched ${raw.regions_matched} · lost ${raw.regions_lost} · invented ${raw.regions_invented} · mean IoU ${raw.mean_matched_iou}</span>
          </div>
          <div class="pdf-testing-detail-frames">
            <figure><img src="${overlay('source')}" loading="lazy" alt="source page ${page.page} regions"><figcaption>source</figcaption></figure>
            <figure><img src="${overlay('translated')}" loading="lazy" alt="translated page ${page.page} regions"><figcaption>translated</figcaption></figure>
          </div>
        </div>`;
    }).join('') || '<div class="pdf-testing-empty">No per-page data in this run.</div>';
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  matrixEl.addEventListener('click', (event) => {
    const cell = event.target.closest('.pdf-testing-clickable');
    if (!cell) return;
    openDetail(cell.dataset.doc, cell.dataset.system);
  });
  detailCloseBtn.addEventListener('click', () => {
    detailEl.hidden = true;
    detailPagesEl.innerHTML = '';
  });

  refreshBtn.addEventListener('click', refreshMatrix);
  sourceSelect.addEventListener('change', syncSourceUpload);
  importBtn.addEventListener('click', runImport);

  container.__onActivate = () => {
    refreshMatrix();
  };

  refreshMatrix();
  populateSources();
  return container;
}
