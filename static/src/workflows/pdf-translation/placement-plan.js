import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

export function createPlacementPlanInspector(host) {
  let generation = 0;
  let controller = null;
  let requestId = '';
  let source = null;
  let target = null;
  let plan = null;
  let pageIndex = 0;
  let selected = '';
  let showFurniture = false;

  const artifactUrl = (name) => `/api/pdf-translation/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(name)}`;
  const boxPoints = (box) => box
    ? `${box.left},${box.top} ${box.right},${box.top} ${box.right},${box.bottom} ${box.left},${box.bottom}`
    : '';
  const polygonPoints = (polygon) => (polygon || []).map((point) => `${point.x},${point.y}`).join(' ');
  const elementText = (element) => (element?.content || [])
    .map((item) => item.kind === 'text' ? item.text : '◻')
    .join('');

  function render() {
    const page = source.pages[pageIndex];
    const targetElements = new Map(target.elements.map((element) => [element.id, element]));
    const sourceRegions = new Map((source.regions || []).map((region) => [region.id, region]));
    const pageFixedObjectIds = new Set(plan.page_fixed_object_ids);
    const pageTargets = plan.targets.filter((item) => item.page_ids.includes(page.id));
    const pageObjects = plan.physical_objects.filter((item) => item.page_id === page.id);
    const allItems = [
      ...plan.targets.map((item) => ({ ...item, record_kind: 'target' })),
      ...plan.physical_objects.map((item) => ({ ...item, record_kind: 'physical_object' })),
    ];
    const pageItems = [
      ...pageTargets.map((item) => ({ ...item, record_kind: 'target' })),
      ...pageObjects.map((item) => ({ ...item, record_kind: 'physical_object' })),
    ];
    const withoutPage = allItems.filter(
      (item) => item.record_kind === 'target' && item.page_ids.length === 0
    );
    const visibleItems = showFurniture
      ? pageItems
      : pageItems.filter((item) => (
        item.record_kind === 'target'
          ? item.mobility !== 'page_fixed'
          : !pageFixedObjectIds.has(item.id)
      ));
    const active = allItems.find((item) => item.id === selected) || null;
    const linkedIds = new Set([
      ...(active?.attachment_ids || []),
      ...allItems.filter((item) => (item.attachment_ids || []).includes(active?.id)).map((item) => item.id),
    ]);
    const targetOverlay = pageTargets
      .filter((item) => item.bounding_box && (showFurniture || item.mobility !== 'page_fixed'))
      .map((item) => {
        const label = `${item.content_class} · ${item.shape} · ${item.mobility} · ${item.decision_code}`;
        const classes = [
          'placement-item', 'placement-target',
          item.flow_eligible ? 'eligible' : 'withheld',
          item.id === selected ? 'selected' : '',
          linkedIds.has(item.id) ? 'linked' : '',
        ].filter(Boolean).join(' ');
        return `<polygon points="${boxPoints(item.bounding_box)}" class="${classes}" data-placement="${escapeAttr(item.id)}" tabindex="0" role="button" aria-label="${escapeAttr(label)}"><title>${escapeHtml(label)}</title></polygon>`;
      }).join('');
    const objectOverlay = pageObjects
      .filter((item) => showFurniture || !pageFixedObjectIds.has(item.id))
      .map((item) => {
        const label = `${item.object_kind} · rigid · ${pageFixedObjectIds.has(item.id) ? 'page_fixed' : 'movable'}`;
        const classes = [
          'placement-item', 'placement-object',
          item.id === selected ? 'selected' : '',
          linkedIds.has(item.id) ? 'linked' : '',
        ].filter(Boolean).join(' ');
        return `<polygon points="${polygonPoints(item.polygon)}" class="${classes}" data-placement="${escapeAttr(item.id)}" tabindex="0" role="button" aria-label="${escapeAttr(label)}"><title>${escapeHtml(label)}</title></polygon>`;
      }).join('');
    const activeRegionIds = new Set(
      active?.record_kind === 'target'
        ? (active.regions || []).map((region) => region.region_id)
        : active?.source_kind === 'region' ? [active.source_id] : []
    );
    const sourceRegionOverlay = Array.from(activeRegionIds).map((regionId) => {
      const region = sourceRegions.get(regionId);
      return region?.page_id === page.id
        ? `<polygon points="${polygonPoints(region.polygon)}" class="placement-source-region" aria-hidden="true"/>`
        : '';
    }).join('');
    const targetElement = active?.record_kind === 'target'
      ? targetElements.get(active.target_element_id) : null;
    const activeTitle = !active ? '' : active.record_kind === 'target'
      ? `${active.content_class} · ${elementText(targetElement).slice(0, 90) || active.target_element_id}`
      : `${active.object_kind} · ${active.source_id}`;

    host.innerHTML = `
      <div class="omnidoc-toolbar">
        <a href="${artifactUrl('omnidoc-placement-plan')}" download="omnidoc-placement-plan.json">Download placement plan</a>
        <label>Page <select data-page>${source.pages.map((item, index) => `<option value="${index}" ${index === pageIndex ? 'selected' : ''}>${item.index + 1}</option>`).join('')}</select> / ${source.pages.length}</label>
        <span>${pageTargets.length} targets · ${pageObjects.length} physical objects · ${pageObjects.filter((item) => pageFixedObjectIds.has(item.id)).length} page-fixed · ${withoutPage.length} targets without page</span>
        <label><input type="checkbox" data-furniture ${showFurniture ? 'checked' : ''}> Show page-fixed objects</label>
        <span>Green: flow eligible · dashed blue: withheld · purple: physical object</span>
        <span class="omnidoc-coverage" role="status">Inspection only · PDF placement unchanged</span>
      </div>
      <div class="omnidoc-body">
        <div class="omnidoc-page-scroll"><div class="omnidoc-page" style="aspect-ratio:${page.width}/${page.height}">
          <img src="${artifactUrl(`page-${String(page.index + 1).padStart(3, '0')}-source`)}" alt="Source page ${page.index + 1}">
          <svg viewBox="0 0 ${page.width} ${page.height}" aria-label="Placement inventory">${targetOverlay}${objectOverlay}${sourceRegionOverlay}</svg>
        </div></div>
        <aside class="omnidoc-details">
          <label>Placement item <select data-select><option value="">Choose on the page</option>${visibleItems.map((item) => `<option value="${escapeAttr(item.id)}" ${selected === item.id ? 'selected' : ''}>${escapeHtml(item.record_kind === 'target' ? item.content_class : item.object_kind)} · ${escapeHtml(item.id)}</option>`).join('')}${withoutPage.length ? `<optgroup label="Without page">${withoutPage.map((item) => `<option value="${escapeAttr(item.id)}" ${selected === item.id ? 'selected' : ''}>${escapeHtml(item.content_class)} · ${escapeHtml(item.id)}</option>`).join('')}</optgroup>` : ''}</select></label>
          ${active ? `<strong>${escapeHtml(activeTitle)}</strong><code>${escapeHtml(active.id)}</code>
            <dl class="omnidoc-origin">
              <dt>Record</dt><dd>${escapeHtml(active.record_kind)}</dd>
              <dt>Shape</dt><dd>${escapeHtml(active.shape)}</dd>
              ${active.record_kind === 'target'
                ? `<dt>Mobility</dt><dd>${escapeHtml(active.mobility)}</dd><dt>Flow eligible</dt><dd>${String(active.flow_eligible)}</dd><dt>Decision</dt><dd>${escapeHtml(active.decision_code)}</dd>`
                : `<dt>Source</dt><dd>${escapeHtml(active.source_kind)} · ${escapeHtml(active.source_id)}</dd><dt>Page-fixed</dt><dd>${String(pageFixedObjectIds.has(active.id))}</dd>`}
            </dl>
            ${targetElement ? `<details open><summary>Target content</summary><pre class="omnidoc-text">${escapeHtml(elementText(targetElement) || '(No text)')}</pre></details>` : ''}
            <details open><summary>Attachments · ${(active.attachment_ids || []).length}</summary><pre>${escapeHtml(JSON.stringify(active.attachment_ids || [], null, 2))}</pre></details>
            <details><summary>Placement evidence</summary><pre>${escapeHtml(JSON.stringify(active, null, 2))}</pre></details>`
            : '<p>Select a target or physical object to inspect its evidence and placement policy.</p>'}
          <details><summary>Plan summary</summary><pre>${escapeHtml(JSON.stringify(plan.summary, null, 2))}</pre></details>
          <details><summary>Plan revision</summary><code>${escapeHtml(plan.id)}</code><p>Policy ${escapeHtml(plan.policy_version)}</p><p>Source ${escapeHtml(plan.source_revision_id)}</p><p>Target ${escapeHtml(plan.target_revision_id)}</p></details>
        </aside>
      </div>`;
    host.querySelector('[data-page]').addEventListener('change', (event) => {
      pageIndex = Number(event.target.value);
      selected = '';
      render();
    });
    host.querySelector('[data-furniture]').addEventListener('change', (event) => {
      showFurniture = event.target.checked;
      if (!showFurniture && (
        active?.record_kind === 'target'
          ? active.mobility === 'page_fixed'
          : pageFixedObjectIds.has(active?.id)
      )) selected = '';
      render();
    });
    host.querySelector('[data-select]').addEventListener('change', (event) => {
      selected = event.target.value;
      render();
    });
    host.querySelectorAll('[data-placement]').forEach((node) => {
      const choose = () => { selected = node.dataset.placement; render(); };
      node.addEventListener('click', choose);
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose();
        }
      });
    });
    host.querySelector('img').addEventListener('error', (event) => {
      event.target.alt = 'Source page image unavailable';
    });
  }

  function hide() {
    generation += 1;
    controller?.abort();
    host.hidden = true;
    host.replaceChildren();
    source = null;
    target = null;
    plan = null;
  }

  return {
    hide,
    async show(id) {
      hide();
      requestId = id;
      pageIndex = 0;
      selected = '';
      controller = new AbortController();
      const current = generation;
      host.hidden = false;
      host.textContent = 'Loading placement plan…';
      try {
        const [loadedSource, loadedTarget, loadedPlan] = await Promise.all([
          api.getPdfArtifactJson(id, 'omnidoc', { signal: controller.signal }),
          api.getPdfArtifactJson(id, 'omnidoc-target', { signal: controller.signal }),
          api.getPdfArtifactJson(id, 'omnidoc-placement-plan', { signal: controller.signal }),
        ]);
        if (current !== generation) return;
        source = loadedSource;
        target = loadedTarget;
        plan = loadedPlan;
        if (!source.pages?.length) throw new Error('This representation contains no PDF pages.');
        if (
          !Array.isArray(plan.targets)
          || !Array.isArray(plan.physical_objects)
          || !Array.isArray(plan.page_fixed_object_ids)
        ) {
          throw new Error('This artifact is not a placement-plan inventory.');
        }
        render();
      } catch (error) {
        if (current === generation && error.name !== 'AbortError') {
          host.textContent = formatApiError(error);
        }
      }
    },
  };
}
