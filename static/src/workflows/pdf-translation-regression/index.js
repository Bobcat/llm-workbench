import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';
import { publishWorkflowBusy } from '../../shared/workflow-activity.js';

// PDF translation regression — the document counterpart of the image regression view
// (translation-services docs/pdf-benchmark-regression-design.md, slice 2b/2c). One page, no
// sub-tabs: a fixture tree on the left, and on the right the selected document's replay result
// (per-page snapshot/actual/diff) TOGETHER with its benchmark-on-replay score against the frozen
// accepted score. Fixtures are captured from the PDF translation view, not here.
//
// Two failure classes, different meaning (design doc §"Regression for translate_pdf"):
//   - frozen-input diffs (census / page raster / text-layer extraction): the fixture no longer
//     reproduces from its source PDF; Accept is blocked, a fresh capture is required.
//   - replay diffs (align / render / assembled geometry): behaviour changed; Accept re-baselines.

const REG_BASE = '/api/pdf-regression';

const AXES = [
  { key: 'layout', label: 'L' },
  { key: 'anchors', label: 'A' },
  { key: 'typography', label: 'T' },
];

export function createPdfTranslationRegressionView() {
  const container = document.createElement('div');
  container.className = 'pdf-translation-regression-view';
  container.innerHTML = `
    <div class="pdf-translation-regression-toolbar">
      <button type="button" id="pdfRegRunAll">Run all</button>
      <button type="button" id="pdfRegRefresh">Refresh</button>
      <span class="translation-prompts-inline-status" id="pdfRegStatus"></span>
    </div>
    <div class="pdf-translation-regression-body">
      <section class="pdf-translation-regression-tree-pane">
        <ul class="pdf-translation-regression-tree" id="pdfRegTree"></ul>
      </section>
      <section class="pdf-translation-regression-detail-pane" id="pdfRegDetail">
        <div class="translation-preview-empty">Select a fixture</div>
      </section>
    </div>
  `;

  const treeEl = container.querySelector('#pdfRegTree');
  const detailEl = container.querySelector('#pdfRegDetail');
  const statusEl = container.querySelector('#pdfRegStatus');
  const runAllBtn = container.querySelector('#pdfRegRunAll');
  const refreshBtn = container.querySelector('#pdfRegRefresh');

  let fixtures = [];              // GET /pdf-regression/fixtures -> [{name, target_lang, variant, pages, analysis_dpi, has_accepted_scores, accepted}]
  let selected = null;           // {name, lang, variant}
  const results = new Map();     // "name/lang/variant" -> run response (session only); score present iff scored
  let runningAll = false;
  let busy = false;              // a single replay/accept in flight (GPU serial upstream)
  const collapsed = new Set();   // collapsed document (name) nodes
  let imgVer = 0;                // cache-buster for page PNGs, bumped on run/accept

  const key = (n, l, v) => `${n}/${l}/${v}`;
  const selKey = () => (selected ? key(selected.name, selected.lang, selected.variant) : null);

  // The service loads its Python once, at start. A replay runs INSIDE it, so a process
  // whose source has changed since compares the fixture against code that is no longer on
  // disk — and the CLI, which imports the modules directly, then disagrees with this view
  // for no visible reason. The run answer carries the stamp; say so loudly.
  function staleNote(result) {
    const code = result && result.code;
    if (!code || !code.stale) return '';
    const mins = Math.round(Number(code.behind_seconds || 0) / 60);
    return `  \u26a0 SERVICE RUNS STALE CODE (source is ${mins} min newer) \u2014 restart before trusting this.`;
  }

  function setStatus(message, kind = '') {
    statusEl.textContent = String(message || '');
    statusEl.classList.toggle('is-error', kind === 'error');
  }

  function findFixture(n, l, v) {
    return fixtures.find((fx) => fx.name === n && fx.target_lang === l && fx.variant === v) || null;
  }

  function axesLine(scores) {
    if (!scores) return '—';
    const axes = scores.axes || {};
    const unchanged = Number(scores.indicators?.unchanged_share);
    const parts = AXES.map(({ key: k, label }) => {
      const value = Number(axes[k]);
      return `${label} ${Number.isFinite(value) ? value.toFixed(1) : '—'}`;
    });
    if (Number.isFinite(unchanged)) parts.push(`U ${unchanged.toFixed(1)}%`);
    return parts.join(' · ');
  }

  // --- tree -----------------------------------------------------------------

  function glyph(n, l, v) {
    const result = results.get(key(n, l, v));
    if (!result) return '<span class="reg-glyph reg-glyph-none">—</span>';
    if (result.frozen_input_diffs?.length) return '<span class="reg-glyph reg-fail" title="frozen input changed">⚠</span>';
    return result.passed ? '<span class="reg-glyph reg-pass">✓</span>' : '<span class="reg-glyph reg-fail">✗</span>';
  }

  // A document (name) groups its language/variant fixtures; aggregate glyph = pass iff every
  // ran variant passed, fail if any ran variant failed, dash if none ran.
  function nameState(name) {
    const ran = fixtures.filter((fx) => fx.name === name).map((fx) => results.get(key(fx.name, fx.target_lang, fx.variant))).filter(Boolean);
    if (!ran.length) return 'none';
    return ran.every((r) => r.passed) ? 'pass' : 'fail';
  }
  function aggGlyph(state) {
    if (state === 'pass') return '<span class="reg-glyph reg-pass">✓</span>';
    if (state === 'fail') return '<span class="reg-glyph reg-fail">✗</span>';
    return '<span class="reg-glyph reg-glyph-none">—</span>';
  }

  function fixturesByName() {
    const names = new Map();
    for (const fx of fixtures) {
      if (!names.has(fx.name)) names.set(fx.name, []);
      names.get(fx.name).push(fx);
    }
    return names;
  }

  function renderTree() {
    if (!fixtures.length) {
      treeEl.innerHTML = '<li class="translation-preview-empty">No document fixtures. Capture one from the PDF translation view.</li>';
      return;
    }
    const names = fixturesByName();
    treeEl.innerHTML = [...names.entries()].map(([name, variants]) => {
      const isCollapsed = collapsed.has(name);
      const caret = `<span class="reg-caret${isCollapsed ? '' : ' is-open'}" aria-hidden="true"></span>`;
      let body = '';
      if (!isCollapsed) {
        body = `<ul>${variants.map((fx) => {
          const isSel = selected && selected.name === fx.name && selected.lang === fx.target_lang && selected.variant === fx.variant;
          return `<li class="reg-variant ${isSel ? 'is-selected' : ''}"
              data-name="${escapeAttr(fx.name)}" data-lang="${escapeAttr(fx.target_lang)}" data-variant="${escapeAttr(fx.variant)}">
            ${glyph(fx.name, fx.target_lang, fx.variant)}
            <span class="reg-label">${escapeHtml(fx.target_lang)}/${escapeHtml(fx.variant)}</span>
            <span class="reg-timing" title="pages">${fx.pages}p</span>
          </li>`;
        }).join('')}</ul>`;
      }
      return `<li class="reg-name">
        <div class="reg-row reg-name-head" data-collapse="${escapeAttr(name)}">${caret}${aggGlyph(nameState(name))}<span class="reg-label">${escapeHtml(name)}</span></div>
        ${body}</li>`;
    }).join('');
  }

  // --- detail ---------------------------------------------------------------

  function pageImageUrl(fx, page, file) {
    return `${REG_BASE}/fixtures/${encodeURIComponent(fx.name)}/${encodeURIComponent(fx.target_lang)}/${encodeURIComponent(fx.variant)}/pages/${page}/${file}?v=${imgVer}`;
  }
  function documentArtifactUrl(fx, artifact) {
    return `${REG_BASE}/fixtures/${encodeURIComponent(fx.name)}/${encodeURIComponent(fx.target_lang)}/${encodeURIComponent(fx.variant)}/artifact/${artifact}`;
  }

  // What the fixture was frozen under. A replay only means something against the
  // settings that produced the baseline, and the tree can show only the target
  // language — so two fixtures that look like peers may have been captured through
  // different planners or at different type scales, and nothing said so.
  function settingsPanel(fx) {
    const captured = fx.captured_with || {};
    const keys = Object.keys(captured);
    if (!keys.length) {
      return '<div class="pdf-reg-settings"><span class="pdf-reg-none">'
        + 'captured before the settings were recorded</span></div>';
    }
    // The ones that decide which code runs lead; the rest keep their own order.
    const lead = ['page_layout_mode', 'page_scale', 'analysis_dpi', 'width_fit_mode',
      'erase_fill_mode', 'pdf_structure_mode'];
    const ordered = [
      ...lead.filter((k) => k in captured),
      ...keys.filter((k) => !lead.includes(k)),
    ];
    const cells = ordered.map((k) => `<div class="pdf-reg-setting">
        <span>${escapeHtml(k)}</span><strong>${escapeHtml(String(captured[k]))}</strong>
      </div>`).join('');
    return `<div class="pdf-reg-settings">${cells}</div>`;
  }

  function scorePanel(fx, result) {
    const accepted = fx.accepted || null;
    const replay = result?.score?.replay || null;
    const scoreDiffs = (result?.diffs || []).filter((d) => String(d).startsWith('score.'));
    let delta;
    if (!accepted) delta = '<span class="pdf-reg-none">no accepted score frozen (capture ran with score off)</span>';
    else if (!replay) delta = '<span class="pdf-reg-none">run with score to compare against the accepted baseline</span>';
    else if (!scoreDiffs.length) delta = '<span class="reg-pass">replay score identical to accepted</span>';
    else delta = `<ul class="pdf-reg-diffs">${scoreDiffs.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`;
    return `
      <div class="pdf-reg-score">
        <div class="pdf-reg-score-row"><span>accepted</span><strong>${accepted ? escapeHtml(axesLine(accepted)) : '—'}</strong></div>
        <div class="pdf-reg-score-row"><span>replay</span><strong>${replay ? escapeHtml(axesLine(replay)) : '—'}</strong></div>
        <div class="pdf-reg-score-delta">${delta}</div>
      </div>`;
  }

  function renderDetail() {
    if (!selected) {
      detailEl.innerHTML = '<div class="translation-preview-empty">Select a fixture</div>';
      return;
    }
    const fx = findFixture(selected.name, selected.lang, selected.variant);
    if (!fx) {
      detailEl.innerHTML = '<div class="translation-preview-empty">Select a fixture</div>';
      return;
    }
    const result = results.get(selKey());
    const frozen = result?.frozen_input_diffs || [];
    const verdict = result
      ? (frozen.length
          ? '<span class="reg-fail">FROZEN INPUT CHANGED</span>'
          : (result.passed ? '<span class="reg-pass">PASS</span>' : '<span class="reg-fail">FAIL</span>'))
      : '<span class="reg-glyph-none">not run yet</span>';

    const frozenBlock = frozen.length
      ? `<div class="pdf-reg-frozen"><strong>Frozen inputs no longer reproduce from source.pdf — re-capture from a fresh PDF run; Accept is blocked:</strong>
           <ul class="pdf-reg-diffs">${frozen.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul></div>`
      : '';

    const docDiffs = (result?.diffs || []).filter((d) => !String(d).startsWith('page ') && !String(d).startsWith('score.'));
    const docDiffsBlock = docDiffs.length
      ? `<ul class="pdf-reg-diffs">${docDiffs.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : '';

    const pagesBlock = (result?.pages || []).map((page) => {
      const pv = page.passed ? '<span class="reg-pass">✓</span>' : '<span class="reg-fail">✗</span>';
      const diffs = page.diffs?.length
        ? `<ul class="pdf-reg-diffs">${page.diffs.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : '';
      // A failed page left actual.png + snapshot_diff.png (the snapshot with a box around every
      // mismatched re-OCR segment) — the same side-by-side a reviewer gets on image fixtures.
      const frames = page.passed ? '' : `
        <div class="pdf-reg-frames">
          <figure><img src="${pageImageUrl(fx, page.page, 'snapshot_diff.png')}" loading="lazy"
                       onerror="this.onerror=null;this.src='${pageImageUrl(fx, page.page, 'snapshot.png')}'"
                       alt="snapshot page ${page.page}"><figcaption>snapshot (boxed diffs)</figcaption></figure>
          <figure><img src="${pageImageUrl(fx, page.page, 'actual.png')}" loading="lazy"
                       alt="actual page ${page.page}"><figcaption>actual (current replay)</figcaption></figure>
        </div>`;
      return `<div class="pdf-reg-page">
        <div class="pdf-reg-page-head"><strong>page ${page.page}</strong> ${pv}</div>
        ${diffs}${frames}</div>`;
    }).join('');

    const links = [
      `<a href="${documentArtifactUrl(fx, 'source.pdf')}" target="_blank" rel="noopener">source.pdf</a>`,
      `<a href="${documentArtifactUrl(fx, 'accepted.pdf')}" target="_blank" rel="noopener">accepted.pdf</a>`,
      ...(result && !result.passed && !frozen.length ? [`<a href="${documentArtifactUrl(fx, 'actual.pdf')}" target="_blank" rel="noopener">actual.pdf</a>`] : []),
    ].join(' · ');

    detailEl.innerHTML = `
      <div class="pdf-reg-detail-head">${escapeHtml(fx.name)} / ${escapeHtml(fx.target_lang)} / ${escapeHtml(fx.variant)}
        <span class="pdf-reg-detail-meta">${fx.pages} page(s) @ ${fx.analysis_dpi} dpi</span>
        <span class="pdf-reg-verdict">${verdict}</span></div>
      <div class="translation-prompts-run-actions">
        <button type="button" id="pdfRegRun" ${busy ? 'disabled' : ''}>Run replay</button>
        <button type="button" id="pdfRegRunScore" ${busy ? 'disabled' : ''} title="Replay + benchmark-on-replay against the accepted score">Run with score</button>
        <button type="button" id="pdfRegAccept" ${busy || frozen.length ? 'disabled' : ''}
          title="${frozen.length ? 'Blocked: frozen inputs changed — re-capture instead' : 'Re-baseline: overwrite snapshots, accepted.pdf and the accepted score with the current replay'}">Accept (re-baseline)</button>
        <button type="button" id="pdfRegDelete" ${busy ? 'disabled' : ''}>Delete</button>
      </div>
      <div class="pdf-reg-links">${links}</div>
      ${settingsPanel(fx)}
      ${scorePanel(fx, result)}
      ${frozenBlock}
      ${docDiffsBlock}
      ${pagesBlock || (result ? '<div class="translation-preview-empty">All pages equal to their snapshots.</div>' : '<div class="translation-preview-empty">Run the replay to see per-page results.</div>')}
    `;
  }

  // --- actions --------------------------------------------------------------

  async function refresh() {
    try {
      const payload = await api.listPdfRegressionFixtures();
      fixtures = Array.isArray(payload?.documents) ? payload.documents : [];
    } catch (err) {
      setStatus(formatApiError(err), 'error');
      return;
    }
    if (selected && !findFixture(selected.name, selected.lang, selected.variant)) selected = null;
    renderTree();
    renderDetail();
  }

  // One sidebar indicator for the view: either flag counts, and a run-all keeps runningAll set
  // across its sequential replays so the icon does not blink between fixtures.
  function syncBusy() {
    publishWorkflowBusy('pdf-translation-regression', busy || runningAll);
  }

  async function runOne(n, l, v, { withScore = false } = {}) {
    const fx = findFixture(n, l, v);
    if (!fx || busy) return;
    busy = true;
    syncBusy();
    renderDetail();
    setStatus(`Running ${key(n, l, v)}…${withScore ? ' (replay + benchmark measurement)' : ''}`);
    try {
      const result = await api.runPdfRegression({ name: n, lang: l, variant: v, score: withScore });
      results.set(key(n, l, v), result);
      const flavour = result.frozen_input_diffs?.length ? 'frozen input changed' : (result.passed ? 'passed' : 'failed');
      setStatus(`${key(n, l, v)} — ${flavour}.${staleNote(result)}`, staleNote(result) ? 'error' : '');
    } catch (err) {
      results.set(key(n, l, v), { passed: false, frozen_input_diffs: [], diffs: [formatApiError(err)], pages: [] });
      setStatus(formatApiError(err), 'error');
    } finally {
      busy = false;
      syncBusy();
      imgVer += 1;  // a run rewrites actual.png / snapshot_diff.png
    }
    renderTree();
    renderDetail();
  }

  async function runAll() {
    if (runningAll || busy) return;
    runningAll = true;
    syncBusy();
    runAllBtn.disabled = true;
    results.clear();
    renderTree();
    renderDetail();
    // Replay-only sweep (fast): scoring is on-demand per fixture. Sequential — the replay chain is
    // serialized on the GPU/OCR locks upstream; the loop survives sidebar navigation (persistent view).
    for (let i = 0; i < fixtures.length; i += 1) {
      const fx = fixtures[i];
      setStatus(`Running ${i + 1}/${fixtures.length}…`);
      await runOne(fx.name, fx.target_lang, fx.variant);
    }
    const failed = fixtures.filter((fx) => !(results.get(key(fx.name, fx.target_lang, fx.variant))?.passed)).length;
    setStatus(`Done — ${fixtures.length - failed}/${fixtures.length} passed.`);
    runningAll = false;
    syncBusy();
    runAllBtn.disabled = false;
  }

  async function accept(n, l, v) {
    const fx = findFixture(n, l, v);
    if (!fx || busy) return;
    if (!window.confirm(`Re-baseline ${key(n, l, v)} from the current replay?\nSnapshots, accepted.pdf and the accepted score will be overwritten.`)) return;
    busy = true;
    syncBusy();
    setStatus(`Accepting ${key(n, l, v)}… (replay + re-OCR + score freeze)`);
    try {
      const out = await api.acceptPdfRegression({ name: n, lang: l, variant: v });
      if (!out.ok) {
        setStatus(out.error || 'Accept refused', 'error');
        return;
      }
      results.delete(key(n, l, v));
      setStatus(`Accepted ${key(n, l, v)}.`);
    } catch (err) {
      setStatus(formatApiError(err), 'error');
      return;
    } finally {
      busy = false;
      syncBusy();
      imgVer += 1;
    }
    await refresh();               // accepted score changed
    await runOne(n, l, v);         // confirm the new baseline is green
  }

  async function del(n, l, v) {
    if (busy || !window.confirm(`Delete fixture ${key(n, l, v)}?`)) return;
    try {
      await api.deletePdfRegressionFixture(n, l, v);
    } catch (err) {
      setStatus(formatApiError(err), 'error');
      return;
    }
    results.delete(key(n, l, v));
    if (selected && selKey() === key(n, l, v)) selected = null;
    setStatus(`Deleted ${key(n, l, v)}.`);
    await refresh();
  }

  // --- events ---------------------------------------------------------------

  treeEl.addEventListener('click', (event) => {
    const collapseEl = event.target.closest('[data-collapse]');
    if (collapseEl) {
      const name = collapseEl.dataset.collapse;
      if (collapsed.has(name)) collapsed.delete(name); else collapsed.add(name);
      renderTree();
      return;
    }
    const variantEl = event.target.closest('.reg-variant');
    if (variantEl) {
      selected = { name: variantEl.dataset.name, lang: variantEl.dataset.lang, variant: variantEl.dataset.variant };
      renderTree();
      renderDetail();
    }
  });

  detailEl.addEventListener('click', (event) => {
    if (!selected) return;
    const { name, lang, variant } = selected;
    if (event.target.id === 'pdfRegRun') runOne(name, lang, variant);
    if (event.target.id === 'pdfRegRunScore') runOne(name, lang, variant, { withScore: true });
    if (event.target.id === 'pdfRegAccept') accept(name, lang, variant);
    if (event.target.id === 'pdfRegDelete') del(name, lang, variant);
  });

  runAllBtn.addEventListener('click', runAll);
  refreshBtn.addEventListener('click', refresh);

  // Persistent view: refresh on (re)activation, but never disturb a running "run all" loop.
  container.__onActivate = () => { if (!runningAll && !busy) refresh(); };
  container.__onDeactivate = () => {};

  refresh();
  return container;
}
