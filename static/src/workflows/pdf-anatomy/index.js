import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';
import { publishWorkflowBusy } from '../../shared/workflow-activity.js';

const PREVIEW_BASE = '/api/pdf-anatomy/analyses';
const MAX_OVERLAY_OBJECTS = 4000;

export function createPdfAnatomyView() {
  const container = document.createElement('div');
  container.className = 'pdf-anatomy-view';
  container.innerHTML = `
    <div class="pdf-anatomy-toolbar">
      <button type="button" id="pdfAnatomyRefresh">Refresh fixtures</button>
      <span class="translation-prompts-inline-status" id="pdfAnatomyStatus"></span>
    </div>
    <div class="pdf-anatomy-body">
      <aside class="pdf-anatomy-tree-pane">
        <div class="pdf-anatomy-tree-title">Captured fixtures</div>
        <ul class="pdf-anatomy-tree" id="pdfAnatomyTree"></ul>
      </aside>
      <main class="pdf-anatomy-detail" id="pdfAnatomyDetail">
        <div class="translation-preview-empty">Select a captured source / accepted pair</div>
      </main>
    </div>
  `;

  const refreshBtn = container.querySelector('#pdfAnatomyRefresh');
  const statusEl = container.querySelector('#pdfAnatomyStatus');
  const treeEl = container.querySelector('#pdfAnatomyTree');
  const detailEl = container.querySelector('#pdfAnatomyDetail');

  let fixtures = [];
  let selected = null;
  let analysis = null;
  let currentPage = 1;
  let currentDetail = null;
  let busy = false;
  const pageCache = new Map();
  const enabledLayers = new Set(['added']);
  const overlayObjects = new Map();

  function setStatus(message, kind = '') {
    statusEl.textContent = String(message || '');
    statusEl.classList.toggle('is-error', kind === 'error');
  }

  function setBusy(value) {
    busy = Boolean(value);
    refreshBtn.disabled = busy;
    publishWorkflowBusy('pdf-anatomy', busy);
    treeEl.querySelectorAll('button').forEach((button) => {
      button.disabled = busy;
    });
  }

  function fixtureKey(fixture) {
    return `${fixture.name}\u0000${fixture.target_lang}\u0000${fixture.variant}`;
  }

  function groupedFixtures() {
    const grouped = new Map();
    for (const fixture of fixtures) {
      const languages = grouped.get(fixture.name) || new Map();
      const variants = languages.get(fixture.target_lang) || [];
      variants.push(fixture);
      languages.set(fixture.target_lang, variants);
      grouped.set(fixture.name, languages);
    }
    return grouped;
  }

  function renderTree() {
    if (!fixtures.length) {
      treeEl.innerHTML = '<li class="pdf-anatomy-tree-empty">No captured PDF fixtures</li>';
      return;
    }
    const selectedKey = selected ? fixtureKey(selected) : '';
    treeEl.innerHTML = [...groupedFixtures().entries()].map(([name, languages]) => `
      <li class="pdf-anatomy-document">
        <div class="pdf-anatomy-document-name" title="${escapeAttr(name)}">${escapeHtml(name)}</div>
        <ul>
          ${[...languages.entries()].map(([lang, variants]) => `
            <li>
              <div class="pdf-anatomy-language">${escapeHtml(lang)}</div>
              <ul>
                ${variants.map((fixture) => {
                  const key = fixtureKey(fixture);
                  const active = key === selectedKey ? ' is-selected' : '';
                  return `
                    <li>
                      <button type="button" class="pdf-anatomy-fixture${active}"
                        data-name="${escapeAttr(fixture.name)}"
                        data-lang="${escapeAttr(fixture.target_lang)}"
                        data-variant="${escapeAttr(fixture.variant)}">
                        <span>${escapeHtml(fixture.variant)}</span>
                        <small>${Number(fixture.pages) || 0}p</small>
                      </button>
                    </li>
                  `;
                }).join('')}
              </ul>
            </li>
          `).join('')}
        </ul>
      </li>
    `).join('');
  }

  async function loadFixtures() {
    setBusy(true);
    setStatus('Loading fixtures…');
    try {
      const response = await api.listPdfAnatomyFixtures();
      fixtures = Array.isArray(response.documents) ? response.documents : [];
      fixtures.sort((a, b) => fixtureKey(a).localeCompare(fixtureKey(b)));
      renderTree();
      setStatus(`${fixtures.length} captured pair${fixtures.length === 1 ? '' : 's'}`);
    } catch (error) {
      setStatus(formatApiError(error), 'error');
      treeEl.innerHTML = '<li class="pdf-anatomy-tree-empty">Could not load fixtures</li>';
    } finally {
      setBusy(false);
    }
  }

  async function selectFixture(fixture) {
    selected = fixture;
    analysis = null;
    currentDetail = null;
    currentPage = 1;
    pageCache.clear();
    renderTree();
    detailEl.innerHTML = '<div class="translation-preview-empty">Analyzing source and accepted PDF…</div>';
    setBusy(true);
    setStatus(`Analyzing ${fixture.name}/${fixture.target_lang}/${fixture.variant}…`);
    try {
      analysis = await api.analyzePdfAnatomyFixture({
        name: fixture.name,
        target_lang: fixture.target_lang,
        variant: fixture.variant,
      });
      const firstFindingPage = analysis.comparison?.findings
        ?.find((finding) => Array.isArray(finding.pages) && finding.pages.length)
        ?.pages?.[0];
      currentPage = Number(firstFindingPage) || 1;
      renderAnalysis();
      await loadPage(currentPage);
      setStatus(analysis.cached ? 'Loaded cached analysis' : 'Analysis complete');
    } catch (error) {
      analysis = null;
      detailEl.innerHTML = `<div class="translation-preview-empty is-error">${escapeHtml(formatApiError(error))}</div>`;
      setStatus(formatApiError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function metric(label, source, translated, formatter = String) {
    const sourceNumber = Number(source);
    const translatedNumber = Number(translated);
    const delta = translatedNumber - sourceNumber;
    const deltaClass = delta > 0 ? ' is-up' : (delta < 0 ? ' is-down' : '');
    const deltaText = Number.isFinite(delta)
      ? `${delta > 0 ? '+' : ''}${formatter(delta)}`
      : '—';
    return `
      <div class="pdf-anatomy-metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(formatter(sourceNumber))} → ${escapeHtml(formatter(translatedNumber))}</strong>
        <small class="${deltaClass}">${escapeHtml(deltaText)}</small>
      </div>
    `;
  }

  function formatBytes(value) {
    const number = Number(value);
    const absolute = Math.abs(number);
    if (absolute >= 1024 * 1024) return `${(number / (1024 * 1024)).toFixed(2)} MB`;
    if (absolute >= 1024) return `${(number / 1024).toFixed(1)} KB`;
    return `${Math.round(number)} B`;
  }

  function renderAnalysis() {
    if (!analysis) return;
    const comparison = analysis.comparison || {};
    const summary = comparison.summary || {};
    const source = analysis.source || {};
    const translated = analysis.translated || {};
    const resources = summary.resources || {};
    const imageSummary = summary.image_resources || {};
    const pages = comparison.pages || [];
    const findings = comparison.findings || [];
    detailEl.innerHTML = `
      <section class="pdf-anatomy-heading">
        <div>
          <h2>${escapeHtml(selected.name)}</h2>
          <p>${escapeHtml(selected.target_lang)} · ${escapeHtml(selected.variant)}
            · source.pdf ↔ accepted.pdf</p>
        </div>
        <span class="pdf-anatomy-cache">${analysis.cached ? 'cached' : 'fresh'}</span>
      </section>

      <section class="pdf-anatomy-metrics">
        ${metric('File size', source.file_size_bytes, translated.file_size_bytes, formatBytes)}
        ${metric('Visible text runs', resources.visible_text_runs?.source, resources.visible_text_runs?.translated)}
        ${metric('Invisible text runs (unclassified)', resources.invisible_text_runs?.source, resources.invisible_text_runs?.translated)}
        ${metric('Declared font faces', source.resources?.font_declared_faces, translated.resources?.font_declared_faces)}
        ${metric('Font resources', source.resources?.font_unique_xrefs, translated.resources?.font_unique_xrefs)}
        ${metric('Embedded font programs', source.resources?.font_embedded_programs, translated.resources?.font_embedded_programs)}
        ${metric('Font page uses', source.resources?.font_page_uses, translated.resources?.font_page_uses)}
        ${metric('Raster resources', resources.image_unique_resources?.source, resources.image_unique_resources?.translated)}
        ${metric('Image placements', resources.image_placements?.source, resources.image_placements?.translated)}
        ${metric('Vector paths', resources.vector_paths?.source, resources.vector_paths?.translated)}
        ${metric('Links', resources.links?.source, resources.links?.translated)}
      </section>

      <section class="pdf-anatomy-retention">
        <strong>Image streams</strong>
        <span>${Number(imageSummary.retained_exact) || 0} exact retained</span>
        <span>${Number(imageSummary.added) || 0} added resources</span>
        <span>${Number(imageSummary.added_placements) || 0} added placements</span>
        <span>${Number(imageSummary.lost) || 0} lost</span>
      </section>

      <section class="pdf-anatomy-findings">
        <h3>Findings</h3>
        <div class="pdf-anatomy-finding-list">
          ${findings.map((finding) => `
            <button type="button" class="pdf-anatomy-finding is-${escapeAttr(finding.severity)}"
              data-page="${Number(finding.pages?.[0]) || ''}">
              <span class="pdf-anatomy-finding-severity">${escapeHtml(finding.severity)}</span>
              <strong>${escapeHtml(finding.title)}</strong>
              <small>${escapeHtml(finding.explanation)}</small>
            </button>
          `).join('') || '<div class="pdf-anatomy-clean">No structural findings</div>'}
        </div>
      </section>

      <section class="pdf-anatomy-pages">
        <h3>Pages</h3>
        <div class="pdf-anatomy-page-list">
          ${pages.map((page) => pageButton(page)).join('')}
        </div>
      </section>

      <section class="pdf-anatomy-page-detail" id="pdfAnatomyPageDetail">
        <div class="translation-preview-empty">Loading page ${currentPage}…</div>
      </section>
    `;
  }

  function pageButton(page) {
    const source = page.source || {};
    const translated = page.translated || {};
    const active = Number(page.page) === currentPage ? ' is-selected' : '';
    const route = page.output_contract?.background_mode || '';
    return `
      <button type="button" class="pdf-anatomy-page-button${active}" data-page="${Number(page.page)}">
        <strong>${Number(page.page)}</strong>
        <span>${escapeHtml(source.page_class || '—')} → ${escapeHtml(translated.page_class || '—')}</span>
        <small>${Number(page.added_raster_resource_count) || 0} new raster
          ${route ? `· ${escapeHtml(route)}` : ''}</small>
      </button>
    `;
  }

  async function loadPage(pageNumber) {
    if (!analysis) return;
    currentPage = Number(pageNumber);
    renderPageSelection();
    const cached = pageCache.get(currentPage);
    if (cached) {
      currentDetail = cached;
      renderPageDetail();
      return;
    }
    const pageEl = detailEl.querySelector('#pdfAnatomyPageDetail');
    if (pageEl) pageEl.innerHTML = `<div class="translation-preview-empty">Loading page ${currentPage}…</div>`;
    try {
      const detail = await api.getPdfAnatomyPage(analysis.analysis_id, currentPage);
      pageCache.set(currentPage, detail);
      currentDetail = detail;
      renderPageDetail();
    } catch (error) {
      if (pageEl) pageEl.innerHTML = `<div class="translation-preview-empty is-error">${escapeHtml(formatApiError(error))}</div>`;
    }
  }

  function renderPageSelection() {
    detailEl.querySelectorAll('.pdf-anatomy-page-button').forEach((button) => {
      button.classList.toggle('is-selected', Number(button.dataset.page) === currentPage);
    });
  }

  function layerControl(key, label, checked = false) {
    return `
      <label>
        <input type="checkbox" data-layer="${escapeAttr(key)}"
          ${enabledLayers.has(key) || checked ? 'checked' : ''}>
        <span class="pdf-anatomy-layer-swatch is-${escapeAttr(key)}"></span>
        ${escapeHtml(label)}
      </label>
    `;
  }

  function renderPageDetail() {
    if (!currentDetail || !analysis) return;
    const pageEl = detailEl.querySelector('#pdfAnatomyPageDetail');
    if (!pageEl) return;
    const comparison = currentDetail.comparison || {};
    const contract = currentDetail.output_contract || {};
    pageEl.innerHTML = `
      <div class="pdf-anatomy-page-toolbar">
        <h3>Page ${currentPage}</h3>
        <span>${escapeHtml(contract.background_mode || 'unknown route')}</span>
        <div class="pdf-anatomy-layer-controls">
          ${layerControl('added', 'Added raster')}
          ${layerControl('visible-text', 'Visible text')}
          ${layerControl('invisible-text', 'Invisible text')}
          ${layerControl('images', 'Images')}
          ${layerControl('vectors', 'Vectors')}
          ${layerControl('forms', 'Top-level forms')}
        </div>
      </div>
      <div class="pdf-anatomy-page-stats">
        <span>${Number(comparison.added_raster_resource_count) || 0} added raster resources</span>
        <span>${Number(comparison.added_raster_placement_count) || 0} placements</span>
        <span>${Number(comparison.retained_image_placement_count) || 0} exact retained image placements</span>
        <span>geometry ${comparison.geometry_equal ? 'equal' : 'changed'}</span>
        <span>${Number(currentDetail.source?.forms?.nested_resource_count) || 0}
          source + ${Number(currentDetail.translated?.forms?.nested_resource_count) || 0}
          translated nested forms inventoried, not overlaid</span>
      </div>
      <div class="pdf-anatomy-previews">
        ${previewPanel('source', currentDetail.source)}
        ${previewPanel('translated', currentDetail.translated)}
      </div>
      <div class="pdf-anatomy-object-detail" id="pdfAnatomyObjectDetail">
        Click an overlay object for its PDF properties.
      </div>
      <div class="pdf-anatomy-page-tables">
        ${fontTable('Source fonts', currentDetail.source?.fonts || {})}
        ${fontTable('Translated fonts', currentDetail.translated?.fonts || {})}
      </div>
    `;
    renderOverlays();
  }

  function previewPanel(side, page) {
    if (!page) return `<figure><figcaption>${escapeHtml(side)}</figcaption><div>Missing page</div></figure>`;
    const geometry = page.geometry || {};
    const width = Number(geometry.width_pt) || 1;
    const height = Number(geometry.height_pt) || 1;
    const url = `${PREVIEW_BASE}/${encodeURIComponent(analysis.analysis_id)}/pages/${currentPage}/preview/${side}`;
    return `
      <figure>
        <figcaption>${side === 'source' ? 'Source' : 'Accepted translation'}</figcaption>
        <div class="pdf-anatomy-preview" style="aspect-ratio:${width}/${height}">
          <img src="${escapeAttr(url)}" alt="${escapeAttr(side)} page ${currentPage}">
          <svg data-side="${escapeAttr(side)}" viewBox="0 0 ${width} ${height}"
            preserveAspectRatio="none" aria-label="${escapeAttr(side)} structural overlay"></svg>
        </div>
      </figure>
    `;
  }

  function collectOverlayObjects(side, page) {
    const objects = [];
    if (!page) return objects;
    if (enabledLayers.has('visible-text')) {
      for (const item of page.text?.runs || []) {
        if (item.visible) objects.push({ layer: 'visible-text', item });
      }
    }
    if (enabledLayers.has('invisible-text')) {
      for (const item of page.text?.runs || []) {
        if (!item.visible) objects.push({ layer: 'invisible-text', item });
      }
    }
    if (enabledLayers.has('images')) {
      for (const item of page.images?.placements || []) objects.push({ layer: 'images', item });
    }
    if (enabledLayers.has('vectors')) {
      for (const item of page.vectors?.paths || []) objects.push({ layer: 'vectors', item });
    }
    if (enabledLayers.has('forms')) {
      for (const item of page.forms?.resources || []) {
        if (item.overlay_supported && item.display_bbox_pt) {
          objects.push({ layer: 'forms', item });
        }
      }
    }
    if (side === 'translated' && enabledLayers.has('added')) {
      for (const item of currentDetail.comparison?.added_raster_placements || []) {
        objects.push({ layer: 'added', item });
      }
    }
    return objects;
  }

  function renderOverlays() {
    overlayObjects.clear();
    for (const side of ['source', 'translated']) {
      const svg = detailEl.querySelector(`.pdf-anatomy-preview svg[data-side="${side}"]`);
      if (!svg) continue;
      const page = currentDetail?.[side];
      const objects = collectOverlayObjects(side, page);
      const shown = objects.slice(0, MAX_OVERLAY_OBJECTS);
      svg.innerHTML = shown.map(({ layer, item }, index) => {
        const bbox = item.display_bbox_pt || [0, 0, 0, 0];
        const objectKey = `${side}:${layer}:${index}`;
        overlayObjects.set(objectKey, { side, layer, item });
        const width = Math.max(0.2, Number(bbox[2]) - Number(bbox[0]));
        const height = Math.max(0.2, Number(bbox[3]) - Number(bbox[1]));
        return `
          <rect class="pdf-anatomy-overlay is-${escapeAttr(layer)}"
            data-object="${escapeAttr(objectKey)}"
            x="${Number(bbox[0])}" y="${Number(bbox[1])}"
            width="${width}" height="${height}">
            <title>${escapeHtml(layer)} · ${escapeHtml(item.id || item.resource_id || '')}</title>
          </rect>
        `;
      }).join('');
      if (objects.length > MAX_OVERLAY_OBJECTS) {
        setStatus(`Overlay limited to ${MAX_OVERLAY_OBJECTS} of ${objects.length} objects`, 'error');
      }
    }
  }

  function triState(values) {
    if (values.size !== 1) return 'mixed';
    return values.has(true) ? 'yes' : 'no';
  }

  function groupedFontFaces(resources) {
    const grouped = new Map();
    for (const font of resources) {
      const name = font.normalized_name || font.base_name || font.resource_name || '(unnamed)';
      const key = String(name).toLocaleLowerCase();
      const face = grouped.get(key) || {
        name,
        types: new Set(),
        resources: 0,
        programs: new Set(),
        embedded: new Set(),
        subset: new Set(),
        uses: new Set(),
      };
      if (font.type) face.types.add(font.type);
      face.resources += 1;
      if (font.program_sha256) face.programs.add(font.program_sha256);
      face.embedded.add(Boolean(font.embedded));
      face.subset.add(Boolean(font.subset));
      if (font.visible_use) face.uses.add('visible');
      if (font.invisible_use) face.uses.add('invisible');
      if (!font.visible_use && !font.invisible_use) face.uses.add('declared');
      grouped.set(key, face);
    }
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function fontTable(title, fontReport) {
    const resources = fontReport.resources || [];
    const faces = groupedFontFaces(resources);
    const rows = faces.slice(0, 80);
    return `
      <details>
        <summary>${escapeHtml(title)} · ${faces.length} declared faces ·
          ${resources.length} page resources ·
          ${Number(fontReport.embedded_program_count) || 0} embedded programs</summary>
        <table>
          <thead><tr><th>Face</th><th>Type</th><th>Resources</th><th>Programs</th><th>Embedded</th><th>Subset</th><th>Use</th></tr></thead>
          <tbody>
            ${rows.map((face) => `
              <tr>
                <td>${escapeHtml(face.name)}</td>
                <td>${escapeHtml([...face.types].join(', '))}</td>
                <td>${face.resources}</td>
                <td>${face.programs.size}</td>
                <td>${triState(face.embedded)}</td>
                <td>${triState(face.subset)}</td>
                <td>${escapeHtml([...face.uses].join(', '))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${faces.length > rows.length ? `<small>Showing ${rows.length} of ${faces.length} declared faces.</small>` : ''}
      </details>
    `;
  }

  treeEl.addEventListener('click', (event) => {
    const button = event.target.closest('.pdf-anatomy-fixture');
    if (!button || busy) return;
    const fixture = fixtures.find((item) => (
      item.name === button.dataset.name
      && item.target_lang === button.dataset.lang
      && item.variant === button.dataset.variant
    ));
    if (fixture) selectFixture(fixture);
  });

  detailEl.addEventListener('click', (event) => {
    const finding = event.target.closest('.pdf-anatomy-finding');
    if (finding?.dataset.page) {
      loadPage(Number(finding.dataset.page));
      return;
    }
    const pageButtonEl = event.target.closest('.pdf-anatomy-page-button');
    if (pageButtonEl) {
      loadPage(Number(pageButtonEl.dataset.page));
      return;
    }
    const overlay = event.target.closest('.pdf-anatomy-overlay');
    if (overlay) {
      const selectedObject = overlayObjects.get(overlay.dataset.object);
      const objectEl = detailEl.querySelector('#pdfAnatomyObjectDetail');
      if (selectedObject && objectEl) {
        objectEl.innerHTML = `
          <strong>${escapeHtml(selectedObject.side)} · ${escapeHtml(selectedObject.layer)}</strong>
          <pre>${escapeHtml(JSON.stringify(selectedObject.item, null, 2))}</pre>
        `;
      }
    }
  });

  detailEl.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[data-layer]');
    if (!checkbox) return;
    if (checkbox.checked) enabledLayers.add(checkbox.dataset.layer);
    else enabledLayers.delete(checkbox.dataset.layer);
    renderOverlays();
  });

  refreshBtn.addEventListener('click', loadFixtures);
  loadFixtures();
  return container;
}
