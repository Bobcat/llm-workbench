import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const REG_BASE = '/api/translation/regression';

export function createRegressionView() {
  const container = document.createElement('div');
  container.className = 'translation-regression-view';
  container.innerHTML = `
    <div class="translation-regression-toolbar">
      <button type="button" id="regRunAll">Run all</button>
      <button type="button" id="regRefresh">Refresh</button>
      <span class="translation-prompts-inline-status" id="regStatus"></span>
    </div>
    <div class="translation-regression-body">
      <section class="translation-regression-tree-pane">
        <ul class="translation-regression-tree" id="regTree"></ul>
      </section>
      <section class="translation-regression-detail-pane" id="regDetail">
        <div class="translation-preview-empty">Select a fixture</div>
      </section>
    </div>
  `;

  const treeEl = container.querySelector('#regTree');
  const detailEl = container.querySelector('#regDetail');
  const statusEl = container.querySelector('#regStatus');
  const runAllBtn = container.querySelector('#regRunAll');
  const refreshBtn = container.querySelector('#regRefresh');

  let images = [];              // the inventory tree from GET /fixtures
  let selected = null;          // {name, lang, variant}
  const results = new Map();    // "name/lang/variant" -> {passed, diffs, has_actual}  (this session only)
  let runningAll = false;
  let detailView = 'snapshot';  // 'snapshot' | 'source' | 'actual'

  const key = (n, l, v) => `${n}/${l}/${v}`;

  function setStatus(message, kind = '') {
    statusEl.textContent = String(message || '');
    statusEl.classList.toggle('is-error', kind === 'error');
  }

  function findVariant(name, lang, variant) {
    const image = images.find((entry) => entry.name === name);
    return image ? (image.langs[lang] || []).find((v) => v.variant === variant) || null : null;
  }

  function glyph(name, lang, variant) {
    const result = results.get(key(name, lang, variant));
    if (!result) return '<span class="reg-glyph reg-glyph-none">—</span>';
    return result.passed ? '<span class="reg-glyph reg-pass">✓</span>' : '<span class="reg-glyph reg-fail">✗</span>';
  }

  function delButton(kind, name, lang, variant) {
    const attrs = `data-del="${kind}" data-name="${escapeAttr(name)}"`
      + (lang ? ` data-lang="${escapeAttr(lang)}"` : '')
      + (variant ? ` data-variant="${escapeAttr(variant)}"` : '');
    return `<button type="button" class="reg-del" ${attrs} title="Delete">✕</button>`;
  }

  function renderTree() {
    if (!images.length) {
      treeEl.innerHTML = '<li class="translation-preview-empty">No fixtures</li>';
      return;
    }
    treeEl.innerHTML = images.map((image) => {
      const langs = Object.keys(image.langs).map((lang) => {
        const variants = image.langs[lang].map((vr) => {
          const isSel = selected && selected.name === image.name && selected.lang === lang && selected.variant === vr.variant;
          return `<li class="reg-variant ${isSel ? 'is-selected' : ''}"
              data-name="${escapeAttr(image.name)}" data-lang="${escapeAttr(lang)}" data-variant="${escapeAttr(vr.variant)}">
            ${glyph(image.name, lang, vr.variant)}
            <span class="reg-label">${escapeHtml(vr.variant)}</span>
            ${delButton('variant', image.name, lang, vr.variant)}
          </li>`;
        }).join('');
        return `<li class="reg-lang">
          <div class="reg-row reg-lang-head"><span class="reg-label">${escapeHtml(lang)}</span>${delButton('lang', image.name, lang)}</div>
          <ul>${variants}</ul></li>`;
      }).join('');
      const badge = image.in_testset ? '' : '<span class="reg-warn" title="not in testset">⚠</span>';
      return `<li class="reg-name">
        <div class="reg-row reg-name-head"><span class="reg-label">${escapeHtml(image.name)}</span>${badge}${delButton('name', image.name)}</div>
        <ul>${langs}</ul></li>`;
    }).join('');
  }

  function imageUrl(name, lang, variant, file) {
    return `${REG_BASE}/fixtures/${encodeURIComponent(name)}/${encodeURIComponent(lang)}/${encodeURIComponent(variant)}/${file}?ts=${Date.now()}`;
  }

  function renderDetail() {
    if (!selected) {
      detailEl.innerHTML = '<div class="translation-preview-empty">Select a fixture</div>';
      return;
    }
    const { name, lang, variant } = selected;
    const result = results.get(key(name, lang, variant));
    const meta = findVariant(name, lang, variant);
    const hasActual = Boolean(result && result.has_actual);
    if (detailView === 'actual' && !hasActual) detailView = 'snapshot';

    let src;
    if (detailView === 'source') src = `${REG_BASE}/source/${encodeURIComponent(name)}?ts=${Date.now()}`;
    else if (detailView === 'actual') src = imageUrl(name, lang, variant, 'actual.png');
    else src = imageUrl(name, lang, variant, 'snapshot.png');

    const resultLabel = result
      ? (result.passed ? '<span class="reg-pass">PASS</span>' : '<span class="reg-fail">FAIL</span>')
      : '<span class="reg-glyph-none">not run</span>';
    const diffs = result && !result.passed && result.diffs.length
      ? `<ul class="reg-diffs">${result.diffs.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`
      : '';

    detailEl.innerHTML = `
      <div class="reg-detail-head">${escapeHtml(name)} / ${escapeHtml(lang)} / ${escapeHtml(variant)} ${resultLabel}</div>
      <div class="reg-toggles">
        <button type="button" data-view="snapshot" class="${detailView === 'snapshot' ? 'is-active' : ''}">Snapshot</button>
        <button type="button" data-view="source" class="${detailView === 'source' ? 'is-active' : ''}">Source</button>
        ${hasActual ? `<button type="button" data-view="actual" class="${detailView === 'actual' ? 'is-active' : ''}">Actual</button>` : ''}
      </div>
      <div class="reg-detail-frame"><img alt="render" src="${src}"></div>
      <div class="reg-detail-meta">${meta ? `${escapeHtml(meta.target_lang)} · ${meta.units} units · ${meta.reocr_rows} ocr-rows` : ''}</div>
      <div class="translation-prompts-run-actions">
        <button type="button" id="regRun">Run replay</button>
        <button type="button" id="regDelVariant">Delete</button>
      </div>
      ${diffs}
    `;
  }

  async function refresh() {
    try {
      const data = await api.listRegressionFixtures();
      images = data.images || [];
    } catch (err) {
      setStatus(formatApiError(err), 'error');
      return;
    }
    if (selected && !findVariant(selected.name, selected.lang, selected.variant)) selected = null;
    renderTree();
    renderDetail();
  }

  async function runOne(name, lang, variant) {
    setStatus(`Running ${name}/${lang}/${variant}…`);
    try {
      const result = await api.runRegressionVariant({ name, lang, variant });
      results.set(key(name, lang, variant), {
        passed: Boolean(result.passed),
        diffs: result.diffs || [],
        has_actual: Boolean(result.has_actual),
      });
    } catch (err) {
      results.set(key(name, lang, variant), { passed: false, diffs: [formatApiError(err)], has_actual: false });
    }
    renderTree();
    if (selected && selected.name === name && selected.lang === lang && selected.variant === variant) renderDetail();
  }

  function allVariants() {
    const out = [];
    images.forEach((image) => Object.keys(image.langs).forEach((lang) =>
      image.langs[lang].forEach((vr) => out.push([image.name, lang, vr.variant]))));
    return out;
  }

  async function runAll() {
    if (runningAll) return;
    runningAll = true;
    runAllBtn.disabled = true;
    const all = allVariants();
    // Sequential, image by image — the loop keeps running across sidebar navigation (the view is
    // persistent), so progress survives. Each /run is serialized by the OCR lock server-side.
    for (let i = 0; i < all.length; i += 1) {
      setStatus(`Running ${i + 1}/${all.length}…`);
      await runOne(all[i][0], all[i][1], all[i][2]);
    }
    const failed = all.filter(([n, l, v]) => { const r = results.get(key(n, l, v)); return r && !r.passed; }).length;
    setStatus(`Done — ${all.length - failed}/${all.length} passed.`);
    runningAll = false;
    runAllBtn.disabled = false;
  }

  async function del(name, lang, variant) {
    const label = [name, lang, variant].filter(Boolean).join('/');
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      await api.deleteRegressionFixture(name, lang, variant);
    } catch (err) {
      setStatus(formatApiError(err), 'error');
      return;
    }
    const prefix = label;
    Array.from(results.keys()).forEach((k) => {
      if (k === prefix || k.startsWith(`${prefix}/`)) results.delete(k);
    });
    if (selected && selected.name === name && (!lang || selected.lang === lang) && (!variant || selected.variant === variant)) {
      selected = null;
    }
    setStatus(`Deleted ${label}.`);
    await refresh();
  }

  treeEl.addEventListener('click', (event) => {
    const delBtn = event.target.closest('[data-del]');
    if (delBtn) {
      event.stopPropagation();
      del(delBtn.dataset.name, delBtn.dataset.lang, delBtn.dataset.variant);
      return;
    }
    const variantEl = event.target.closest('.reg-variant');
    if (variantEl) {
      selected = { name: variantEl.dataset.name, lang: variantEl.dataset.lang, variant: variantEl.dataset.variant };
      detailView = 'snapshot';
      renderTree();
      renderDetail();
    }
  });

  detailEl.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-view]');
    if (toggle) { detailView = toggle.dataset.view; renderDetail(); return; }
    if (event.target.id === 'regRun' && selected) runOne(selected.name, selected.lang, selected.variant);
    if (event.target.id === 'regDelVariant' && selected) del(selected.name, selected.lang, selected.variant);
  });

  runAllBtn.addEventListener('click', runAll);
  refreshBtn.addEventListener('click', refresh);

  // Persistent view: refresh the list on (re)activation, but never touch a running "run all" loop —
  // it keeps going while the view is detached so a mid-run navigation does not lose progress.
  container.__onActivate = () => { if (!runningAll) refresh(); };
  container.__onDeactivate = () => {};

  refresh();
  return container;
}
