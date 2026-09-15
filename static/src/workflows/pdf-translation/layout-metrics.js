import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const percentage = (value) => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const number = (value) => value == null ? '—' : Number(value).toFixed(1);
const coverage = (item) => `${item.status} · ${item.known}/${item.population} ${item.unit}`;
const table = (headings, rows) => `<table><thead><tr>${headings.map((value) => `<th scope="col">${escapeHtml(value)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(String(value))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

export function createLayoutMetricsInspector(host) {
  let generation = 0;
  let controller = null;
  let artifact = null;
  let scope = '';

  function render() {
    const profile = artifact.profile;
    const page = profile.pages.find((item) => item.page_id === scope);
    const metrics = page ? page.measurements : profile.document;
    const text = metrics.text_area;
    const visual = metrics.visual_area;
    const sizes = metrics.region_sizes;
    const typography = metrics.typography;
    const origins = page ? [page] : profile.pages;
    host.innerHTML = `
      <div class="omnidoc-toolbar">
        <label>Scope <select data-scope><option value="">Document total</option>${profile.pages.map((item) => `<option value="${escapeAttr(item.page_id)}" ${item.page_id === scope ? 'selected' : ''}>Page ${item.page_index + 1}</option>`).join('')}</select></label>
        <span>Passive measurements · placement unchanged</span>
        <span>Definition ${escapeHtml(profile.definition_version)} · implementation ${escapeHtml(profile.implementation_version)}</span>
      </div>
      <div class="omnidoc-metrics-panel">
        <p>Source revision <code>${escapeHtml(profile.revision_id)}</code> · schema ${profile.document_schema_version}</p>
        <p>Input: ${origins.map((item) => `page ${item.page_index + 1}: ${escapeHtml(item.cell_source || 'provenance unavailable')}`).join(' · ')}</p>
        <h3>Text area</h3>
        ${table(['Area (pt²)', 'Page area share', 'Geometry input'], [[number(text.area), percentage(text.ratio), coverage(text.coverage)]])}
        <h3>Regions by kind</h3>
        ${table(['Kind', 'Count', 'Union area (pt²)', 'Page area share', 'Geometry input'], metrics.region_kinds.kinds.map((item) => [item.kind, item.count, number(item.area), percentage(item.ratio), coverage(item.coverage)]))}
        <p>All encountered kinds are listed. An absent kind has zero count and area in this stored region list.</p>
        <h3>Visual regions</h3>
        ${table(['Group', 'Selected kinds', 'Count', 'Union area (pt²)', 'Page area share', 'Geometry input'], [
          ['All visual groups', 'Union of the groups below', visual.inputs.region_ids.length, number(visual.area), percentage(visual.ratio), coverage(visual.coverage)],
          ...visual.groups.map((item) => [item.group, item.kinds.join(', '), item.region_ids.length, number(item.area), percentage(item.ratio), coverage(item.coverage)]),
        ])}
        <p>Text and visual areas may overlap. These shares do not add up to 100%.</p>
        <h3>Text-bearing region sizes</h3>
        ${table(['Selected', 'Quantified', 'Nested', 'Q1', 'Median', 'Q3', 'Geometry input'], [[sizes.count, sizes.quantified_count, sizes.nested_count, percentage(sizes.q1), percentage(sizes.median), percentage(sizes.q3), coverage(sizes.coverage)]])}
        ${table(['Excluded kind', 'Count', 'Without fragment membership'], sizes.excluded.map((item) => [item.kind, item.count, item.without_fragment_ids]))}
        <p>Sizes are shares of each region’s own page. Detector granularity and geometric nesting affect this distribution.</p>
        <h3>Typography</h3>
        <p>Logical text mapped to a page: ${escapeHtml(coverage(typography.page_mapping))}. Page scopes show only assigned text; missing assignments are reported in the document total.</p>
        ${typography.properties.map((item) => `<h4>${escapeHtml(item.property)}</h4><p>${escapeHtml(coverage(item.coverage))} · missing ${percentage(item.coverage.missing_ratio)}</p>${table(['Source value / normalized class', 'Codepoints', 'Share of known input'], item.categories.map((category) => [item.property === 'font_size' ? `${category.value} pt` : category.value, category.codepoints, percentage(category.share)]))}`).join('')}
        <p>Weights count Unicode codepoints without whitespace. Coverage describes available input, not detection accuracy.</p>
        <details><summary>Definitions, input references and integrity</summary>
          <p>Document <code>${escapeHtml(profile.document_id)}</code></p>
          <p>Input fingerprint <code>${escapeHtml(profile.input_fingerprint)}</code></p>
          <p>Payload checksum <code>${escapeHtml(artifact.payload_sha256)}</code></p>
          <pre>${escapeHtml(JSON.stringify(profile.rules, null, 2))}</pre>
          <pre>${escapeHtml(JSON.stringify({ text: text.inputs, regions: metrics.region_kinds.inputs, visual: visual.inputs, sizes: sizes.inputs, typography: typography.inputs }, null, 2))}</pre>
        </details>
        <details><summary>Geometry diagnostics · ${profile.diagnostics.length}</summary><pre>${escapeHtml(JSON.stringify(profile.diagnostics, null, 2))}</pre></details>
      </div>`;
    host.querySelector('[data-scope]').addEventListener('change', (event) => {
      scope = event.target.value;
      render();
    });
  }

  function hide() {
    generation += 1;
    controller?.abort();
    host.hidden = true;
    host.replaceChildren();
    artifact = null;
  }

  return {
    hide,
    async show(id, { statusOnly = false } = {}) {
      hide();
      controller = new AbortController();
      const current = generation;
      host.hidden = false;
      host.textContent = 'Loading layout measurements…';
      scope = '';
      try {
        if (statusOnly) {
          const status = await api.getPdfArtifactJson(id, 'omnidoc-layout-metrics-status', { signal: controller.signal });
          if (current === generation) host.textContent = `Layout measurements unavailable: ${status.error || status.status}`;
          return;
        }
        const [loaded, source] = await Promise.all([
          api.getPdfArtifactJson(id, 'omnidoc-layout-metrics', { signal: controller.signal }),
          api.getPdfArtifactJson(id, 'omnidoc', { signal: controller.signal }),
        ]);
        if (current !== generation) return;
        const profile = loaded.profile;
        if (profile?.profile_version !== 1) throw new Error('Unsupported layout metric artifact format.');
        if (profile.document_id !== source.id || profile.revision_id !== source.revision_id
          || profile.document_schema_version !== source.schema_version) {
          throw new Error('Layout measurements belong to a different source revision.');
        }
        artifact = loaded;
        render();
      } catch (error) {
        if (current === generation && error.name !== 'AbortError') host.textContent = formatApiError(error);
      }
    },
  };
}
