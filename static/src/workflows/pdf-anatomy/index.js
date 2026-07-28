import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

// PDF anatomy — what the frozen source is MADE OF against what the accepted output is made of
// (translation-services docs/pdf-structure-inspector-design.md). Every other view here asks how
// a page looks; four defects shipped in one day that no such view could see, because each was a
// property of the file that renders identically either way.
//
// Not a gate. The regression view decides whether a fixture passes; this answers why two
// documents differ. Each row carries its own reading:
//   identical — the source's own structure, which translating has no business changing
//   differs   — what translating legitimately changes, with how much to expect
//   zero      — not a comparison: only ever right at zero
// A row with a caveat has a legitimate exception, shown BEFORE its numbers rather than after.

export function createPdfAnatomyView() {
  const container = document.createElement('div');
  container.className = 'pdf-anatomy-view';
  container.innerHTML = `
    <div class="pdf-anatomy-toolbar">
      <button type="button" id="pdfAnatomyRefresh">Refresh</button>
      <label class="pdf-anatomy-filter">
        <input type="checkbox" id="pdfAnatomyOnlyDiff"> Only rows that differ
      </label>
      <span class="translation-prompts-inline-status" id="pdfAnatomyStatus"></span>
    </div>
    <div class="pdf-anatomy-body">
      <section class="pdf-anatomy-tree-pane">
        <ul class="pdf-anatomy-tree" id="pdfAnatomyTree"></ul>
      </section>
      <section class="pdf-anatomy-detail-pane" id="pdfAnatomyDetail">
        <div class="translation-preview-empty">Select a fixture</div>
      </section>
    </div>
  `;

  const treeEl = container.querySelector('#pdfAnatomyTree');
  const detailEl = container.querySelector('#pdfAnatomyDetail');
  const statusEl = container.querySelector('#pdfAnatomyStatus');
  const refreshBtn = container.querySelector('#pdfAnatomyRefresh');
  const onlyDiffEl = container.querySelector('#pdfAnatomyOnlyDiff');

  let fixtures = [];
  let selected = null;             // {name, lang, variant}
  const anatomies = new Map();     // "name/lang/variant" -> response
  const collapsed = new Set();
  let onlyDiff = false;

  const key = (n, l, v) => `${n}/${l}/${v}`;

  function setStatus(message, kind = '') {
    statusEl.textContent = String(message || '');
    statusEl.classList.toggle('is-error', kind === 'error');
  }

  // --- reading a row --------------------------------------------------------

  // A row is "off" when its own kind says the two sides should have matched, or when a
  // zero row is not zero. Everything else is information, not alarm.
  function isOff(row) {
    if (row.kind === 'identical') return !row.equal;
    if (row.kind === 'zero') return Number(row.translated || 0) !== 0;
    return false;
  }

  function value(v) {
    if (v === true) return 'yes';
    if (v === false) return 'no';
    if (v === null || v === undefined) return '—';
    return typeof v === 'number' ? v.toLocaleString('en-US') : String(v);
  }

  function deltaCell(row) {
    if (typeof row.delta !== 'number' || row.delta === 0) return '';
    const sign = row.delta > 0 ? '+' : '';
    return `<span class="anatomy-delta">${sign}${row.delta.toLocaleString('en-US')}</span>`;
  }

  function rowHtml(row) {
    const off = isOff(row);
    const caveat = row.caveat
      ? `<span class="anatomy-caveat" title="${escapeAttr(row.caveat)}">!</span>` : '';
    const note = row.note ? `<div class="anatomy-note">${escapeHtml(row.note)}</div>` : '';
    return `
      <tr class="anatomy-row anatomy-${escapeAttr(row.kind)}${off ? ' is-off' : ''}">
        <td class="anatomy-label">${escapeHtml(row.label)} ${caveat}${note}</td>
        <td class="anatomy-num">${value(row.source)}</td>
        <td class="anatomy-num">${value(row.translated)}</td>
        <td class="anatomy-num">${deltaCell(row)}</td>
      </tr>`;
  }

  // Colour alone would not say what it means, and would say nothing at all to a reader who
  // cannot see it. Each class gets a mark and a word.
  function legendHtml(route) {
    const routeNote = route
      ? `<span class="anatomy-route">written as <strong>${escapeHtml(route)}</strong></span>` : '';
    return `<div class="anatomy-legend">
      <span><i class="anatomy-key anatomy-key-identical"></i> should stay the same</span>
      <span><i class="anatomy-key anatomy-key-differs"></i> translating changes it</span>
      <span><i class="anatomy-key anatomy-key-zero"></i> only right at zero</span>
      <span><i class="anatomy-caveat">!</i> has an exception — hover it</span>
      ${routeNote}
    </div>`;
  }

  // "The file grew" is not a finding until it names its cause.
  function bytesHtml(bytes) {
    if (!bytes) return '';
    const kinds = ['images', 'fonts', 'content', 'other'];
    const mb = (n) => `${(Number(n || 0) / 1e6).toFixed(2)} MB`;
    return `
      <table class="anatomy-table">
        <caption>Where the bytes are</caption>
        <thead><tr><th></th><th>source</th><th>translated</th><th></th></tr></thead>
        <tbody>${kinds.map((k) => {
          const delta = Number(bytes.translated[k] || 0) - Number(bytes.source[k] || 0);
          const sign = delta > 0 ? '+' : '';
          return `<tr class="anatomy-row">
            <td class="anatomy-label">${escapeHtml(k)}</td>
            <td class="anatomy-num">${mb(bytes.source[k])}</td>
            <td class="anatomy-num">${mb(bytes.translated[k])}</td>
            <td class="anatomy-num">${delta ? `<span class="anatomy-delta">${sign}${mb(delta)}</span>` : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  }

  function tableHtml(title, rows) {
    const shown = onlyDiff ? rows.filter((r) => !r.equal || isOff(r)) : rows;
    if (!shown.length) return '';
    return `
      <table class="anatomy-table">
        <caption>${escapeHtml(title)}</caption>
        <thead><tr><th></th><th>source</th><th>translated</th><th></th></tr></thead>
        <tbody>${shown.map(rowHtml).join('')}</tbody>
      </table>`;
  }

  // --- faces ----------------------------------------------------------------

  // The question this answers keeps coming back: the document names its own font, so why is
  // the translation not set in it? Usually because a PDF embeds only the letters that document
  // printed, and a translation needs letters it never printed.
  // One name can be several font objects — referenced once unembedded and once embedded. Show
  // the name once with how many objects carry it, rather than repeating the row.
  function groupFaces(list) {
    const byName = new Map();
    for (const face of list) {
      const seen = byName.get(face.name);
      if (!seen) { byName.set(face.name, { ...face, count: 1 }); continue; }
      seen.count += 1;
      seen.bytes = Math.max(seen.bytes || 0, face.bytes || 0);
      seen.embedded = seen.embedded || face.embedded;
      if (face.covers_output !== undefined && seen.covers_output === undefined) {
        seen.covers_output = face.covers_output;
        seen.missing_for_output = face.missing_for_output;
      }
    }
    return [...byName.values()];
  }

  function facesHtml(faces) {
    const side = (label, list) => `
      <table class="anatomy-table anatomy-faces">
        <caption>${escapeHtml(label)}</caption>
        <thead><tr><th>face</th><th>embedded</th><th>bytes</th><th>covers output</th><th>permission</th></tr></thead>
        <tbody>${groupFaces(list).map((f) => {
          const kind = !f.embedded ? 'not embedded' : (f.subset ? 'subset' : 'whole');
          const covers = f.covers_output === undefined ? '—'
            : (f.covers_output ? 'yes' : `no — missing ${escapeHtml((f.missing_for_output || []).slice(0, 8).join(' '))}`);
          const times = f.count > 1 ? ` <span class="anatomy-delta">×${f.count}</span>` : '';
          return `<tr>
            <td>${escapeHtml(f.name)}${times}</td>
            <td>${escapeHtml(kind)}</td>
            <td class="anatomy-num">${f.bytes ? f.bytes.toLocaleString('en-US') : '—'}</td>
            <td>${covers}</td>
            <td>${escapeHtml(f.embedding_permission || '—')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    return side('Faces in the source', faces.source) + side('Faces in the output', faces.translated);
  }

  // --- detail ---------------------------------------------------------------

  function renderDetail() {
    if (!selected) {
      detailEl.innerHTML = '<div class="translation-preview-empty">Select a fixture</div>';
      return;
    }
    const data = anatomies.get(key(selected.name, selected.lang, selected.variant));
    if (!data) {
      detailEl.innerHTML = '<div class="translation-preview-empty">Reading…</div>';
      return;
    }
    const pages = data.pages.map((p) => tableHtml(p.title, p.rows)).filter(Boolean).join('');
    detailEl.innerHTML = `
      <header class="anatomy-header">
        <h3>${escapeHtml(selected.name)}</h3>
        <span>${escapeHtml(selected.lang)}/${escapeHtml(selected.variant)}</span>
      </header>
      ${legendHtml(data.route)}
      ${tableHtml(data.document.title, data.document.rows)}
      ${bytesHtml(data.bytes)}
      ${facesHtml(data.faces)}
      <details class="anatomy-pages"${pages ? '' : ' hidden'}>
        <summary>Per page (${data.pages.length})</summary>
        ${pages}
      </details>`;
  }

  // --- tree -----------------------------------------------------------------

  function renderTree() {
    if (!fixtures.length) {
      treeEl.innerHTML = '<li class="translation-preview-empty">No document fixtures. Capture one from the PDF translation view.</li>';
      return;
    }
    const names = new Map();
    for (const fx of fixtures) {
      if (!names.has(fx.name)) names.set(fx.name, []);
      names.get(fx.name).push(fx);
    }
    treeEl.innerHTML = [...names.entries()].map(([name, variants]) => {
      const isCollapsed = collapsed.has(name);
      const caret = `<span class="reg-caret${isCollapsed ? '' : ' is-open'}" aria-hidden="true"></span>`;
      const body = isCollapsed ? '' : `<ul>${variants.map((fx) => {
        const isSel = selected && selected.name === fx.name
          && selected.lang === fx.target_lang && selected.variant === fx.variant;
        return `<li class="reg-variant ${isSel ? 'is-selected' : ''}"
            data-name="${escapeAttr(fx.name)}" data-lang="${escapeAttr(fx.target_lang)}" data-variant="${escapeAttr(fx.variant)}">
          <span class="reg-label">${escapeHtml(fx.target_lang)}/${escapeHtml(fx.variant)}</span>
          <span class="reg-timing" title="pages">${fx.pages}p</span>
        </li>`;
      }).join('')}</ul>`;
      return `<li class="reg-name" data-name="${escapeAttr(name)}">
        <div class="reg-row">${caret}<span class="reg-label">${escapeHtml(name)}</span></div>${body}
      </li>`;
    }).join('');
  }

  // --- loading --------------------------------------------------------------

  async function loadFixtures() {
    try {
      const data = await api.listPdfRegressionFixtures();
      fixtures = Array.isArray(data?.documents) ? data.documents : [];
      setStatus(`${fixtures.length} fixture(s)`);
    } catch (error) {
      fixtures = [];
      setStatus(formatApiError(error), 'error');
    }
    renderTree();
  }

  async function loadAnatomy(fx) {
    const cacheKey = key(fx.name, fx.lang, fx.variant);
    renderDetail();
    try {
      const data = await api.getPdfAnatomy(fx.name, fx.lang, fx.variant);
      anatomies.set(cacheKey, data);
      setStatus(`${fx.name} ${fx.lang}/${fx.variant}`);
    } catch (error) {
      setStatus(formatApiError(error), 'error');
    }
    renderDetail();
  }

  treeEl.addEventListener('click', (event) => {
    const variant = event.target.closest('.reg-variant');
    if (variant) {
      selected = {
        name: variant.dataset.name, lang: variant.dataset.lang, variant: variant.dataset.variant,
      };
      renderTree();
      loadAnatomy(selected);
      return;
    }
    const nameRow = event.target.closest('.reg-row');
    if (nameRow) {
      const name = nameRow.parentElement.dataset.name;
      if (collapsed.has(name)) collapsed.delete(name); else collapsed.add(name);
      renderTree();
    }
  });

  refreshBtn.addEventListener('click', () => {
    anatomies.clear();
    loadFixtures().then(() => selected && loadAnatomy(selected));
  });
  onlyDiffEl.addEventListener('change', () => {
    onlyDiff = onlyDiffEl.checked;
    renderDetail();
  });

  loadFixtures();
  return container;
}
