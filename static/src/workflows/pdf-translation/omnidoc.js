import { api } from '../../plugins/translation-services/api.js';
import { escapeHtml, escapeAttr, formatApiError } from '../../shared/ui-helpers.js';

const COLORS = {
  text: '#2563eb', content: '#2563eb', abstract: '#16a34a', aside: '#16a34a',
  list: '#0284c7', reference: '#4f46e5', reference_content: '#4f46e5',
  heading: '#ea580c', title: '#ea580c', table: '#9333ea',
  figure: '#059669', image: '#059669', chart: '#059669',
  algorithm: '#0f766e', seal: '#0f766e', vertical_text: '#0f766e',
  formula: '#0d9488', display_formula: '#0d9488', inline_formula: '#0d9488', formula_number: '#0d9488',
  caption: '#ca8a04', figure_caption: '#ca8a04', table_caption: '#ca8a04', footnote: '#c026d3', vision_footnote: '#c026d3',
  header: '#64748b', footer: '#64748b', page_number: '#64748b', decoration: '#94a3b8',
  header_image: '#64748b', footer_image: '#64748b',
};
const FURNITURE = new Set([
  'header', 'footer', 'footnote', 'vision_footnote', 'page_number',
  'header_image', 'footer_image', 'decoration',
]);

export function createOmnidocInspector(host) {
  let generation = 0;
  let documentData = null;
  let requestId = '';
  let selected = '';
  let pageIndex = 0;
  let controller = null;
  let analysis = null;
  let showDecoration = false;
  let showFragments = false;
  let coverage = null;
  let targetData = null;

  const artifactUrl = (name) => `/api/pdf-translation/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(name)}`;
  const logicalText = (element) => (element?.content || []).map((run) => run.kind === 'text' ? run.text : '◻').join('');
  const boxPoints = (polygon) => (polygon || []).map((point) => `${point.x},${point.y}`).join(' ');

  function regionText(region, elements) {
    return region.element_ids.map((id) => logicalText(elements.get(id))).filter(Boolean).join(' ');
  }

  function render() {
    const doc = documentData;
    const page = doc.pages[pageIndex];
    const fragments = new Map(doc.fragments.map((fragment) => [fragment.id, fragment]));
    const sourceElements = new Map(doc.elements.map((element) => [element.id, element]));
    const targetElements = new Map((targetData?.elements || []).map((element) => [element.id, element]));
    const targetIssuesByElement = new Map();
    for (const issue of coverage?.issues || []) {
      if (!issue.element_id) continue;
      const issues = targetIssuesByElement.get(issue.element_id) || [];
      issues.push(issue);
      targetIssuesByElement.set(issue.element_id, issues);
    }
    const targetBySource = new Map((targetData?.correspondences || []).flatMap((group) => (
      group.source_ids.length === 1 && group.target_ids.length === 1
        ? [[group.source_ids[0], targetElements.get(group.target_ids[0])]] : []
    )));
    const elements = targetData ? targetBySource : sourceElements;
    const contentDocument = targetData || doc;
    const regions = (doc.regions || []).filter((region) => region.page_id === page.id)
      .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
    const active = regions.find((region) => region.id === selected) || null;
    const origin = active ? analysis?.region_origins?.[active.id] : null;
    const activeSourceElements = active ? active.element_ids.map((id) => sourceElements.get(id)).filter(Boolean) : [];
    const activeElements = activeSourceElements.map((sourceElement) => ({
      sourceElement,
      element: targetData ? targetBySource.get(sourceElement.id) : sourceElement,
    }));
    const activeFragments = active ? active.fragment_ids.map((id) => fragments.get(id)).filter(Boolean) : [];
    const regionOverlay = regions.map((region) => {
      const text = regionText(region, elements).slice(0, 160);
      const label = `${region.kind}${region.order == null ? '' : ` · order ${region.order + 1}`}${text ? `: ${text}` : ''}`;
      const classes = ['omnidoc-region', region.id === selected ? 'selected' : '', FURNITURE.has(region.kind) ? 'decoration' : ''].filter(Boolean).join(' ');
      return `<polygon points="${boxPoints(region.polygon)}" style="--region-color:${COLORS[region.kind] || '#0891b2'}" class="${classes}" data-region="${escapeAttr(region.id)}" tabindex="0" role="button" aria-label="${escapeAttr(label)}"><title>${escapeHtml(label)}</title></polygon>`;
    }).join('');
    const fragmentOverlay = activeFragments.filter((fragment) => fragment.polygon).map((fragment) =>
      `<polygon points="${boxPoints(fragment.polygon)}" class="omnidoc-fragment" aria-hidden="true"><title>${escapeHtml(fragment.id)}</title></polygon>`).join('');
    const elementDetails = activeElements.map(({ sourceElement, element }) => {
      const elementIssues = targetIssuesByElement.get(sourceElement.id) || [];
      return `<details>
      <summary>${escapeHtml(element?.role || sourceElement.role)} · ${escapeHtml(logicalText(element).slice(0, 80) || element?.id || sourceElement.id)}</summary>
      <code>${escapeHtml(targetData ? `${sourceElement.id} → ${element?.id || 'missing target'}` : sourceElement.id)}</code>
      <pre class="omnidoc-text">${escapeHtml(logicalText(element) || (targetData ? '(No target text)' : '(No text)'))}</pre>
      ${elementIssues.length ? `<details open><summary>${elementIssues.length} target issue(s)</summary><pre>${escapeHtml(JSON.stringify(elementIssues, null, 2))}</pre></details>` : ''}
      <pre>${escapeHtml(JSON.stringify({
        fragment_ids: sourceElement.fragment_ids,
        styles: contentDocument.styles.filter((style) => (element?.content || []).some((run) => run.style_id === style.id)),
        text_mappings: element?.text_mappings || [],
      }, null, 2))}</pre>
    </details>`;
    }).join('');
    const sourceDescription = !active ? '' : origin
      ? `<dl class="omnidoc-origin">
          <dt>Origin</dt><dd>${escapeHtml(origin.origin)}</dd>
          <dt>DocLayout label</dt><dd>${escapeHtml(origin.source_label ?? '—')}</dd>
          <dt>Score</dt><dd>${origin.source_score == null ? '—' : escapeHtml(String(origin.source_score))}</dd>
          <dt>Detector index</dt><dd>${origin.source_index == null ? '—' : escapeHtml(String(origin.source_index))}</dd>
          <dt>Detector order</dt><dd>${origin.source_order == null ? '—' : escapeHtml(String(origin.source_order))}</dd>
        </dl>`
      : '<p>Open “Analysis evidence” to load the recorded DocLayout origin.</p>';

    host.innerHTML = `
      <div class="omnidoc-toolbar">
        <a href="${artifactUrl(targetData ? 'omnidoc-target' : 'omnidoc-bundle')}" download="${targetData ? 'omnidoc-target.json' : 'omnidoc.zip'}">${targetData ? 'Download target JSON' : 'Download capture'}</a>
        <label>Page <select data-page>${doc.pages.map((item, index) => `<option value="${index}" ${index === pageIndex ? 'selected' : ''}>${item.index + 1}</option>`).join('')}</select> / ${doc.pages.length}</label>
        <span>${regions.length} regions · ${doc.fragments.length} document fragments</span>
        <label><input type="checkbox" data-decoration ${showDecoration ? 'checked' : ''}> Show furniture and footnotes</label>
        <label><input type="checkbox" data-fragments ${showFragments ? 'checked' : ''}> Show selected fragments</label>
        <span class="omnidoc-coverage" role="status">${targetData ? `Target structure: ${coverage?.status || 'status unavailable'} · source geometry` : coverage?.status === 'complete' ? 'Complete source coverage' : 'Source representation failed — see coverage'}</span>
      </div>
      <div class="omnidoc-body">
        <div class="omnidoc-page-scroll"><div class="omnidoc-page" style="aspect-ratio:${page.width}/${page.height}">
          <img src="${artifactUrl(`page-${String(page.index + 1).padStart(3, '0')}-source`)}" alt="Source page ${page.index + 1}">
          <svg viewBox="0 0 ${page.width} ${page.height}" aria-label="Document regions">${regionOverlay}${fragmentOverlay}</svg>
        </div></div>
        <aside class="omnidoc-details">
          <label>Region <select data-select><option value="">Choose on the page</option>${regions.map((region) => `<option value="${escapeAttr(region.id)}" ${selected === region.id ? 'selected' : ''}>${escapeHtml(region.kind)}${region.order == null ? '' : ` · ${region.order + 1}`} · ${escapeHtml(regionText(region, elements).slice(0, 65) || region.id)}</option>`).join('')}</select></label>
          ${active ? `<strong>${escapeHtml(active.kind)}</strong><code>${escapeHtml(active.id)}</code>
            <p>Page order: ${active.order == null ? 'not in the content flow' : active.order + 1}</p>
            ${sourceDescription}
            <details open><summary>${activeElements.length} linked element(s)</summary>${elementDetails || '<p>No logical element is linked to this physical region.</p>'}</details>
            <details><summary>${activeFragments.length} linked source fragment(s)</summary><pre>${escapeHtml(JSON.stringify(activeFragments, null, 2))}</pre></details>`
            : '<p>Select a region to inspect its chosen kind, source classification and linked content.</p>'}
          <details><summary>${targetData ? 'Target structural status' : 'Source coverage'} · ${escapeHtml(coverage?.status || 'unavailable')}</summary><pre>${escapeHtml(JSON.stringify(coverage, null, 2))}</pre></details>
          <details data-analysis${analysis ? ' open' : ''}><summary>Analysis evidence for this page</summary><pre data-analysis-text>${analysis ? escapeHtml(JSON.stringify(analysis, null, 2)) : 'Open to load the recorded region origins and coverage.'}</pre></details>
          <details><summary>Document revision</summary><code>${escapeHtml(contentDocument.revision_id)}</code>${targetData ? `<p>Source ${escapeHtml(coverage?.source_revision_id || doc.revision_id)}</p>` : ''}<p>Schema ${contentDocument.schema_version}</p></details>
        </aside>
      </div>`;
    host.classList.toggle('omnidoc-show-decoration', showDecoration);
    host.classList.toggle('omnidoc-show-fragments', showFragments);
    host.querySelector('[data-page]').addEventListener('change', (event) => {
      pageIndex = Number(event.target.value); selected = ''; analysis = null; render();
    });
    host.querySelector('[data-decoration]').addEventListener('change', (event) => {
      showDecoration = event.target.checked;
      host.classList.toggle('omnidoc-show-decoration', showDecoration);
    });
    host.querySelector('[data-fragments]').addEventListener('change', (event) => {
      showFragments = event.target.checked;
      host.classList.toggle('omnidoc-show-fragments', showFragments);
    });
    host.querySelector('[data-select]').addEventListener('change', (event) => select(event.target.value));
    host.querySelectorAll('[data-region]').forEach((node) => {
      node.addEventListener('click', () => select(node.dataset.region));
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.dataset.region); }
      });
    });
    host.querySelector('[data-analysis]').addEventListener('toggle', async (event) => {
      if (!event.target.open || analysis) return;
      const current = generation;
      const currentPage = pageIndex;
      try {
        const data = await api.getPdfArtifactJson(requestId, `page-${String(page.index + 1).padStart(3, '0')}-omnidoc-analysis`, { signal: controller.signal });
        if (generation !== current || pageIndex !== currentPage) return;
        analysis = data;
        render();
      } catch (error) {
        if (generation === current && pageIndex === currentPage && error.name !== 'AbortError') host.querySelector('[data-analysis-text]').textContent = formatApiError(error);
      }
    });
    host.querySelector('img').addEventListener('error', (event) => { event.target.alt = 'Source page image unavailable'; });
  }

  function select(id) {
    selected = id;
    render();
  }

  function hide() {
    generation += 1;
    controller?.abort();
    host.hidden = true;
    host.replaceChildren();
    documentData = null;
    targetData = null;
    analysis = null;
    coverage = null;
  }

  return {
    hide,
    async show(id, { coverageOnly = false, target = false } = {}) {
      hide();
      requestId = id;
      selected = '';
      pageIndex = 0;
      controller = new AbortController();
      const current = generation;
      host.hidden = false;
      host.textContent = 'Loading Omnidoc…';
      try {
        if (coverageOnly) {
          const report = await api.getPdfArtifactJson(id, 'omnidoc-coverage', { signal: controller.signal });
          if (current !== generation) return;
          host.innerHTML = '<p>The source representation could not be completed. Recorded analysis errors:</p><pre></pre>';
          host.querySelector('pre').textContent = JSON.stringify(report, null, 2);
          return;
        }
        const [data, report, targetDocument] = await Promise.all([
          api.getPdfArtifactJson(id, 'omnidoc', { signal: controller.signal }),
          api.getPdfArtifactJson(id, target ? 'omnidoc-target-status' : 'omnidoc-coverage', { signal: controller.signal }),
          target ? api.getPdfArtifactJson(id, 'omnidoc-target', { signal: controller.signal }) : null,
        ]);
        if (current !== generation) return;
        if (!data.pages?.length) throw new Error('This representation contains no PDF pages.');
        if (!Array.isArray(data.regions)) throw new Error('This capture predates physical Omnidoc regions.');
        documentData = data;
        targetData = targetDocument;
        coverage = report;
        render();
      } catch (error) {
        if (current === generation && error.name !== 'AbortError') host.textContent = formatApiError(error);
      }
    },
  };
}
