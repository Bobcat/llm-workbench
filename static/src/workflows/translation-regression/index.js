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
  const collapsed = new Set();  // collapsed image (name) nodes
  let snapshotVer = 0;          // bumped when snapshot.png changes (resnapshot), for cache-busting
  let actualVer = 0;            // bumped when actual.png changes (a run)
  let imgZoom = 100;            // detail image size (%)

  const key = (n, l, v) => `${n}/${l}/${v}`;

  // One persistent <img>, re-appended into each rebuilt detail frame so it keeps showing its last
  // decoded pixels until the next image is fully loaded — that swap is what removes the black flash
  // on fixture/view switches (rebuilding a fresh <img> blanks while the new bytes fetch).
  const detailImg = document.createElement('img');
  detailImg.alt = 'render';
  detailImg.hidden = true;  // stay hidden until the first image actually decodes (no broken-icon band)
  let detailImgToken = 0;
  function loadDetailImage(src) {
    const token = (detailImgToken += 1);
    const apply = () => {
      if (token !== detailImgToken) return;
      detailImg.src = src;
      detailImg.hidden = false;
    };
    const pre = new Image();
    pre.onload = apply;
    pre.onerror = () => { if (token === detailImgToken) { detailImg.removeAttribute('src'); detailImg.hidden = true; } };
    pre.src = src;
    if (pre.complete) apply();  // already cached: onload may not fire
  }

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

  // Aggregate state for a lang / image node: a language counts as passed if ≥1 of its variants is
  // green; an image as passed if every language has a green variant.
  function aggGlyph(state) {
    if (state === 'pass') return '<span class="reg-glyph reg-pass">✓</span>';
    if (state === 'fail') return '<span class="reg-glyph reg-fail">✗</span>';
    return '<span class="reg-glyph reg-glyph-none">—</span>';
  }
  function langState(image, lang) {
    const run = image.langs[lang].map((v) => results.get(key(image.name, lang, v.variant))).filter(Boolean);
    if (!run.length) return 'none';
    return run.some((r) => r.passed) ? 'pass' : 'fail';
  }
  function nameState(image) {
    const states = Object.keys(image.langs).map((lang) => langState(image, lang));
    if (states.every((s) => s === 'none')) return 'none';
    return states.every((s) => s === 'pass') ? 'pass' : 'fail';
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
      const isCollapsed = collapsed.has(image.name);
      let body = '';
      if (!isCollapsed) {
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
            <div class="reg-row reg-lang-head">${aggGlyph(langState(image, lang))}<span class="reg-label">${escapeHtml(lang)}</span>${delButton('lang', image.name, lang)}</div>
            <ul>${variants}</ul></li>`;
        }).join('');
        body = `<ul>${langs}</ul>`;
      }
      const badge = image.in_testset ? '' : '<span class="reg-warn" title="not in testset">⚠</span>';
      const caret = `<span class="reg-caret">${isCollapsed ? '▸' : '▾'}</span>`;
      return `<li class="reg-name">
        <div class="reg-row reg-name-head" data-collapse="${escapeAttr(image.name)}">${caret}${aggGlyph(nameState(image))}<span class="reg-label">${escapeHtml(image.name)}</span>${badge}${delButton('name', image.name)}</div>
        ${body}</li>`;
    }).join('');
  }

  function imageUrl(name, lang, variant, file) {
    // Stable per-file version (not Date.now): re-renders and toggles reuse the cached image instead
    // of re-fetching it — the re-fetch was the black flash. Bumped only when the file changes.
    const version = file === 'actual.png' ? actualVer : (file === 'snapshot.png' ? snapshotVer : null);
    const base = `${REG_BASE}/fixtures/${encodeURIComponent(name)}/${encodeURIComponent(lang)}/${encodeURIComponent(variant)}/${file}`;
    return version === null ? base : `${base}?v=${version}`;
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
    if (detailView === 'source') src = imageUrl(name, lang, variant, 'source');
    else if (detailView === 'actual') src = imageUrl(name, lang, variant, 'actual.png');
    else src = imageUrl(name, lang, variant, 'snapshot.png');

    const resultLabel = result
      ? (result.passed ? '<span class="reg-pass">PASS</span>' : '<span class="reg-fail">FAIL</span>')
      : '<span class="reg-glyph-none">not run</span>';
    const diffs = result && !result.passed && result.diffs.length
      ? `<ul class="reg-diffs">${result.diffs.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`
      : '';

    detailEl.innerHTML = `
      <div class="reg-detail-head">${escapeHtml(name)} / ${escapeHtml(lang)} / ${escapeHtml(variant)} <span class="reg-detail-verdict">${resultLabel}</span></div>
      <div class="reg-toggles">
        <button type="button" data-view="snapshot" class="${detailView === 'snapshot' ? 'is-active' : ''}">Snapshot</button>
        <button type="button" data-view="source" class="${detailView === 'source' ? 'is-active' : ''}">Source</button>
        ${hasActual ? `<button type="button" data-view="actual" class="${detailView === 'actual' ? 'is-active' : ''}">Actual</button>` : ''}
        <label class="reg-zoom" title="Image size"><input id="regZoom" type="range" min="25" max="200" step="5" value="${imgZoom}"><output>${imgZoom}%</output></label>
      </div>
      <div class="reg-detail-frame"></div>
      <div class="reg-detail-meta">${meta ? `${escapeHtml(meta.target_lang)} · ${meta.units} units · ${meta.reocr_rows} ocr-rows` : ''}</div>
      <div class="translation-prompts-run-actions">
        <button type="button" id="regRun">Run replay</button>
        <button type="button" id="regAccept" title="Re-baseline: overwrite the snapshot with the current replay">Accept (re-snapshot)</button>
      </div>
      ${diffs}
    `;
    detailImg.style.width = `${imgZoom}%`;
    detailEl.querySelector('.reg-detail-frame').appendChild(detailImg);
    loadDetailImage(src);
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
    actualVer += 1;  // a run may have written/changed actual.png
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

  async function accept(name, lang, variant) {
    if (!window.confirm(`Re-snapshot ${name}/${lang}/${variant} from the current replay?`)) return;
    setStatus(`Re-snapshotting ${name}/${lang}/${variant}… (re-OCR)`);
    try {
      const out = await api.resnapshotRegression({ name, lang, variant });
      if (!out.ok) { setStatus(out.error || 'Re-snapshot failed', 'error'); return; }
    } catch (err) {
      setStatus(formatApiError(err), 'error');
      return;
    }
    setStatus('Re-snapshotted.');
    snapshotVer += 1;  // snapshot.png was overwritten
    // The fixture now matches its new baseline — re-run to confirm the green and refresh the image.
    await runOne(name, lang, variant);
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
    // Delete first: its ✕ sits inside the collapsible name row, so it must win over the toggle.
    const delBtn = event.target.closest('[data-del]');
    if (delBtn) {
      event.stopPropagation();
      del(delBtn.dataset.name, delBtn.dataset.lang, delBtn.dataset.variant);
      return;
    }
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
      detailView = 'snapshot';
      renderTree();
      renderDetail();
    }
  });

  detailEl.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-view]');
    if (toggle) { detailView = toggle.dataset.view; renderDetail(); return; }
    if (event.target.id === 'regRun' && selected) runOne(selected.name, selected.lang, selected.variant);
    if (event.target.id === 'regAccept' && selected) accept(selected.name, selected.lang, selected.variant);
  });

  // Live image resize — update the img/output directly so dragging never rebuilds the DOM.
  detailEl.addEventListener('input', (event) => {
    if (event.target.id !== 'regZoom') return;
    imgZoom = Number(event.target.value);
    const img = detailEl.querySelector('.reg-detail-frame img');
    if (img) img.style.width = `${imgZoom}%`;
    const output = detailEl.querySelector('.reg-zoom output');
    if (output) output.textContent = `${imgZoom}%`;
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
