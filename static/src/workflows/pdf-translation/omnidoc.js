import { api } from '../../api-client.js';
import { escapeHtml, escapeAttr, formatApiError } from '../../shared/ui-helpers.js';

const COLORS = { heading: '#ea580c', title: '#ea580c', paragraph: '#2563eb', table: '#9333ea',
  table_cell: '#9333ea', figure: '#059669', footnote: '#c026d3', footer: '#64748b', decoration: '#94a3b8' };

export function createOmnidocInspector(host) {
  let generation = 0;
  let documentData = null;
  let requestId = '';
  let selected = '';
  let pageIndex = 0;
  let controller = null;
  let evidence = null;
  let showDecoration = false;
  let showContainers = true;
  let coverage = null;
  let sourceFragments = new Map();
  let childIds = new Map();
  const artifactUrl = (name) => `/api/pdf-translation/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(name)}`;
  const logicalText = (element) => (element.content || []).map((run) => run.kind === 'text' ? run.text : '◻').join('');

  function render() {
    const doc = documentData;
    const page = doc.pages[pageIndex];
    const fragments = new Map(doc.fragments.map((fragment) => [fragment.id, fragment]));
    const elements = new Map(doc.elements.map((element) => [element.id, element]));
    const parents = new Map(doc.relations.filter((r) => r.kind === 'contains').map((r) => [r.target_id, r.source_id]));
    const ranks = new Map();
    doc.reading_sequences.forEach((sequence) => sequence.element_ids.forEach((id, index) => ranks.set(id, `${sequence.id} · ${index + 1}`)));
    const onPage = doc.elements.filter((element) => (sourceFragments.get(element.id) || []).some((id) => fragments.get(id)?.page_id === page.id));
    const active = elements.get(selected);
    const ancestors = [];
    for (let id = parents.get(selected); id; id = parents.get(id)) ancestors.unshift(id);
    const relations = active ? doc.relations.filter((r) => r.source_id === selected || r.target_id === selected || active.content.some((run) => run.id === r.source_id)) : [];
    const relationLink = (id) => elements.has(id)
      ? `<button type="button" data-element="${escapeAttr(id)}">${escapeHtml(elements.get(id).role)} · ${escapeHtml(id)}</button>`
      : escapeHtml(id || '');
    const containerOverlay = onPage.filter((element) => childIds.has(element.id)).map((element) => {
      const points = (sourceFragments.get(element.id) || []).flatMap((id) => {
        const fragment = fragments.get(id);
        return fragment?.page_id === page.id ? fragment.polygon || [] : [];
      });
      if (!points.length) return '';
      const left = Math.min(...points.map((p) => p.x));
      const top = Math.min(...points.map((p) => p.y));
      const right = Math.max(...points.map((p) => p.x));
      const bottom = Math.max(...points.map((p) => p.y));
      return `<rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}" class="omnidoc-container ${element.id === selected ? 'selected' : ''}" style="--region-color:${COLORS[element.role] || '#0891b2'}" data-element="${escapeAttr(element.id)}" tabindex="0" role="button" aria-label="${escapeAttr(element.role)} container"><title>${escapeHtml(element.role)} · ${childIds.get(element.id).length} children</title></rect>`;
    }).join('');
    const overlay = onPage.flatMap((element) => element.fragment_ids.map((id) => {
      const fragment = fragments.get(id);
      if (fragment?.page_id !== page.id || !fragment.polygon) return '';
      const points = fragment.polygon.map((p) => `${p.x},${p.y}`).join(' ');
      const label = `${element.role}: ${logicalText(element).slice(0, 160)}`;
      return `<polygon points="${points}" style="--region-color:${COLORS[element.role] || '#0891b2'}" class="${element.id === selected ? 'selected' : ''} ${element.role === 'decoration' ? 'decoration' : ''}" data-element="${escapeAttr(element.id)}" tabindex="0" role="button" aria-label="${escapeAttr(label)}"><title>${escapeHtml(label)}</title></polygon>`;
    })).join('');
    host.innerHTML = `
      <div class="omnidoc-toolbar">
        <a href="${artifactUrl('omnidoc-bundle')}" download="omnidoc.zip">Download capture</a>
        <label>Page <select data-page>${doc.pages.map((p, i) => `<option value="${i}" ${i === pageIndex ? 'selected' : ''}>${p.index + 1}</option>`).join('')}</select> / ${doc.pages.length}</label>
        <span>${onPage.length} elements · ${doc.fragments.length} document fragments</span>
        <label><input type="checkbox" data-decoration ${showDecoration ? 'checked' : ''}> Show decoration</label>
        <label><input type="checkbox" data-containers ${showContainers ? 'checked' : ''}> Show containers</label>
        <span class="omnidoc-coverage" role="status">${coverage?.status === 'complete' ? 'Complete source coverage' : coverage?.status === 'partial' ? 'Partial representation — see coverage' : 'Source coverage unavailable'}</span>
      </div>
      <div class="omnidoc-body">
        <div class="omnidoc-page-scroll"><div class="omnidoc-page" style="aspect-ratio:${page.width}/${page.height}">
          <img src="${artifactUrl(`page-${String(page.index + 1).padStart(3, '0')}-source`)}" alt="Source page ${page.index + 1}">
          <svg viewBox="0 0 ${page.width} ${page.height}" aria-label="Document elements">${containerOverlay}${overlay}</svg>
        </div></div>
        <aside class="omnidoc-details">
          <label>Element <select data-select><option value="">Choose on the page</option>${onPage.map((element) => `<option value="${escapeAttr(element.id)}" ${selected === element.id ? 'selected' : ''}>${escapeHtml(element.role)} · ${escapeHtml(logicalText(element).slice(0, 65) || element.id)}</option>`).join('')}</select></label>
          ${active ? `<strong>${escapeHtml(active.role)}</strong><code>${escapeHtml(active.id)}</code>
            <nav aria-label="Element ancestors">${ancestors.map(relationLink).join(' → ')}</nav>
            <p>Reading order: ${escapeHtml(ranks.get(active.id) || (parents.has(active.id) ? `Through parent ${parents.get(active.id)}` : 'Container'))}</p>
            <pre class="omnidoc-text">${escapeHtml(logicalText(active) || (childIds.has(active.id) ? '(Container: text belongs to its children)' : '(No text)'))}</pre>
            ${childIds.has(active.id) ? `<details open><summary>${childIds.get(active.id).length} children</summary>${childIds.get(active.id).map(relationLink).join('<br>')}</details>` : ''}
            <div class="omnidoc-relations">${relations.map((r) => `<div>${escapeHtml(r.kind)}<br>${relationLink(r.source_id)} → ${r.uri ? escapeHtml(r.uri) : relationLink(r.target_id)}</div>`).join('')}</div>
            <details><summary>Source fragments and styles</summary><pre>${escapeHtml(JSON.stringify({
              fragments: active.fragment_ids.map((id) => fragments.get(id)),
              styles: doc.styles.filter((style) => active.content.some((run) => run.style_id === style.id)),
              text_mappings: active.text_mappings,
              table_shape: active.table_shape,
              row_index: active.row_index,
              cell_position: active.cell_position,
            }, null, 2))}</pre></details>` : '<p>Select an element to inspect its text, role and source links.</p>'}
          <details><summary>Source coverage · ${escapeHtml(coverage?.status || 'unavailable')}</summary><pre>${escapeHtml(JSON.stringify(coverage, null, 2))}</pre></details>
          <details data-evidence><summary>Analysis evidence for this page</summary><pre data-evidence-text>${evidence ? escapeHtml(JSON.stringify(evidence, null, 2)) : 'Open to load the recorded decisions and coverage.'}</pre></details>
          <details><summary>Document revision</summary><code>${escapeHtml(doc.revision_id)}</code><p>Schema ${doc.schema_version}</p></details>
        </aside>
      </div>`;
    host.classList.toggle('omnidoc-show-decoration', showDecoration);
    host.classList.toggle('omnidoc-show-containers', showContainers);
    host.querySelector('[data-containers]').addEventListener('change', (event) => {
      showContainers = event.target.checked;
      host.classList.toggle('omnidoc-show-containers', showContainers);
    });
    host.querySelector('[data-page]').addEventListener('change', (event) => {
      pageIndex = Number(event.target.value); evidence = null; render();
    });
    host.querySelector('[data-decoration]').addEventListener('change', (event) => {
      showDecoration = event.target.checked;
      host.classList.toggle('omnidoc-show-decoration', showDecoration);
    });
    host.querySelector('[data-select]').addEventListener('change', (event) => select(event.target.value));
    host.querySelectorAll('[data-element]').forEach((node) => {
      node.addEventListener('click', () => select(node.dataset.element));
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.dataset.element); }
      });
    });
    host.querySelector('[data-evidence]').addEventListener('toggle', async (event) => {
      if (!event.target.open || evidence) return;
      const current = generation;
      const currentPage = pageIndex;
      try {
        const data = await api.getPdfArtifactJson(requestId, `page-${String(page.index + 1).padStart(3, '0')}-omnidoc-analysis`, { signal: controller.signal });
        if (generation !== current || pageIndex !== currentPage) return;
        evidence = data;
        host.querySelector('[data-evidence-text]').textContent = JSON.stringify(data, null, 2);
      } catch (error) {
        if (generation === current && pageIndex === currentPage && error.name !== 'AbortError') host.querySelector('[data-evidence-text]').textContent = formatApiError(error);
      }
    });
    host.querySelector('img').addEventListener('error', (event) => { event.target.alt = 'Source page image unavailable'; });
  }

  function select(id) {
    selected = id;
    const members = sourceFragments.get(id) || [];
    const fragment = documentData.fragments.find((item) => members.includes(item.id) && item.page_id);
    if (fragment && !members.some((key) => documentData.fragments.some((f) => f.id === key && f.page_id === documentData.pages[pageIndex].id))) {
      pageIndex = documentData.pages.findIndex((page) => page.id === fragment.page_id);
      evidence = null;
    }
    render();
  }

  function hide() {
    generation += 1;
    controller?.abort();
    host.hidden = true;
    host.replaceChildren();
    documentData = null;
    evidence = null;
    coverage = null;
    sourceFragments.clear();
    childIds.clear();
  }

  return {
    hide,
    async show(id, { coverageOnly = false } = {}) {
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
        const [data, report] = await Promise.all([
          api.getPdfArtifactJson(id, 'omnidoc', { signal: controller.signal }),
          api.getPdfArtifactJson(id, 'omnidoc-coverage', { signal: controller.signal }),
        ]);
        if (current !== generation) return;
        if (!data.pages?.length) throw new Error('This representation contains no PDF pages.');
        documentData = data;
        coverage = report;
        const elements = new Map(data.elements.map((element) => [element.id, element]));
        data.relations.filter((relation) => relation.kind === 'contains').forEach((relation) => {
          if (!childIds.has(relation.source_id)) childIds.set(relation.source_id, []);
          childIds.get(relation.source_id).push(relation.target_id);
        });
        function collect(id) {
          if (!sourceFragments.has(id)) sourceFragments.set(id, [
            ...(elements.get(id)?.fragment_ids || []),
            ...(childIds.get(id) || []).flatMap(collect),
          ]);
          return sourceFragments.get(id);
        }
        data.elements.forEach((element) => collect(element.id));
        render();
      } catch (error) {
        if (current === generation && error.name !== 'AbortError') host.textContent = formatApiError(error);
      }
    },
  };
}
