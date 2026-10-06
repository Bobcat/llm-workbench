// What the bounded placement permitted each text area, beside its source box and the lines it
// set there. Reads the run's placement status (`omnidoc-placement-status`); inspection only.
import { api } from '../../plugins/translation-services/api.js';
import { escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const HEADING_KINDS = new Set(['heading', 'title']);

const RULES = {
  heading: 'Heading: its own bound, or its paragraph\'s width where the paragraph starts right below it on the same left edge',
  text: 'Text: to the nearest barrier in its band, else the page\'s text edge; capped by the lane where a gutter is proven',
  table: 'Table: its own bound, no horizontal growth',
  lanes: 'Lanes: set lane by lane in frames of their own',
};

const OUTCOMES = {
  set: 'Set',
  'partly-set': 'Partly set',
  'source-ink': 'Kept source ink',
  unchanged: 'Unchanged',
  'not-set': 'Not set',
};

// The branch of the plan's frame rule an area took (app/pdf/omnidoc/page_placement.py).
function frameRule(area) {
  const kinds = area.kinds || [];
  if ((area.lanes || []).length) return 'lanes';
  if (kinds.includes('table')) return 'table';
  if (kinds.length && kinds.every((kind) => HEADING_KINDS.has(kind))) return 'heading';
  return 'text';
}

// Two boxes are one line where they share at least half the height of the lower one.
function lineCount(boxes) {
  const lines = [];
  for (const box of [...boxes].sort((a, b) => a[1] - b[1])) {
    const line = lines.find((other) => (
      Math.min(other[3], box[3]) - Math.max(other[1], box[1])
        >= 0.5 * Math.min(other[3] - other[1], box[3] - box[1])
    ));
    if (line) {
      line[1] = Math.min(line[1], box[1]);
      line[3] = Math.max(line[3], box[3]);
    } else {
      lines.push([...box]);
    }
  }
  return lines.length;
}

// One record per area of a bounded page, or null where the page was not set in bounded areas.
export function pageFrames(statusPage) {
  const placement = statusPage?.placement;
  const diagnostics = statusPage?.diagnostics || {};
  if (!placement?.areas || diagnostics.mode !== 'bounded-regions') return null;
  const placements = diagnostics.placements || [];
  const preserved = diagnostics.preserved_parts || [];
  const unchanged = new Set(diagnostics.unchanged_unit_ids || []);
  return placement.areas.map((area) => {
    const set = placements.filter((item) => item.unit_id === area.unit_id);
    const reasons = preserved.filter((item) => item.unit_id === area.unit_id).map((item) => item.reason);
    const lines = set.flatMap((item) => item.lines_pt || []);
    const source = area.source_box_pt;
    const frame = area.frame_pt;
    const outcome = set.length
      ? (reasons.length ? 'partly-set' : 'set')
      : reasons.length ? 'source-ink' : unchanged.has(area.unit_id) ? 'unchanged' : 'not-set';
    return {
      area,
      rule: frameRule(area),
      outcome,
      reasons,
      placements: set,
      lines,
      sourceLines: lineCount(area.text_boxes_pt || []),
      growth: {
        left: source[0] - frame[0],
        top: source[1] - frame[1],
        right: frame[2] - source[2],
        bottom: frame[3] - source[3],
      },
      inkBeyond: lines.length ? {
        left: source[0] - Math.min(...lines.map((line) => line[0])),
        right: Math.max(...lines.map((line) => line[2])) - source[2],
      } : null,
    };
  });
}

export function createBoundedFramesInspector(host) {
  let generation = 0;
  let controller = null;
  let requestId = '';
  let source = null;
  let status = null;
  let pageIndex = 0;
  let selected = null;
  let background = 'source';
  const layers = { frames: true, sources: true, lines: true };

  const artifactUrl = (name) => `/api/pdf-translation/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(name)}`;
  const pt = (value) => `${Math.abs(value) < 0.05 ? '0.0' : Number(value).toFixed(1)} pt`;
  const rect = (box, classes, unitId = null) => {
    const [left, top, right, bottom] = box;
    const target = unitId == null ? '' : ` data-unit="${unitId}" tabindex="0" role="button"`;
    return `<rect x="${left}" y="${top}" width="${Math.max(0, right - left)}" height="${Math.max(0, bottom - top)}" class="${classes}"${target}/>`;
  };

  function details(record) {
    if (!record) return '<p>Select an area on the page to compare its source box with the frame it was permitted.</p>';
    const { area, growth, inkBeyond } = record;
    const label = `Unit ${area.unit_id} · ${(area.kinds || []).join(', ') || 'no kind'}`;
    return `<strong>${escapeHtml(label)}</strong>
      <dl class="omnidoc-origin">
        <dt>Outcome</dt><dd>${escapeHtml(OUTCOMES[record.outcome])}${record.reasons.length ? ` · ${escapeHtml(record.reasons.join(', '))}` : ''}</dd>
        <dt>Frame rule</dt><dd>${escapeHtml(RULES[record.rule])}</dd>
        <dt>Source lines</dt><dd>${record.sourceLines}</dd>
        <dt>Frame beyond source box</dt><dd>left ${pt(growth.left)} · right ${pt(growth.right)}<br>top ${pt(growth.top)} · bottom ${pt(growth.bottom)}</dd>
        <dt>Set lines</dt><dd>${record.lines.length}${inkBeyond ? ` · beyond source box: left ${pt(Math.max(0, inkBeyond.left))} · right ${pt(Math.max(0, inkBeyond.right))}` : ''}</dd>
        ${area.source_extent_only ? '<dt>Light ink</dt><dd>Kept to its source bottom</dd>' : ''}
        ${area.unplaced_reason ? `<dt>Plan note</dt><dd>${escapeHtml(area.unplaced_reason)}</dd>` : ''}
      </dl>
      <details><summary>Area evidence</summary><pre>${escapeHtml(JSON.stringify(area, null, 2))}</pre></details>
      <details><summary>Placements · ${record.placements.length}</summary><pre>${escapeHtml(JSON.stringify(record.placements, null, 2))}</pre></details>`;
  }

  function render() {
    const page = source.pages[pageIndex];
    const statusPage = (status.pages || []).find((item) => item.page_id === page.id) || null;
    const records = pageFrames(statusPage);
    const active = records?.find((record) => record.area.unit_id === selected) || null;
    const imageName = background === 'translated'
      ? `page-${String(page.index + 1).padStart(3, '0')}`
      : `page-${String(page.index + 1).padStart(3, '0')}-source`;
    // Larger frames first, so a small one inside them stays on top and can be chosen.
    const ordered = [...(records || [])].sort((a, b) => {
      const size = ({ area }) => (area.frame_pt[2] - area.frame_pt[0]) * (area.frame_pt[3] - area.frame_pt[1]);
      return size(b) - size(a);
    });
    const overlay = ordered.map((record) => {
      const id = record.area.unit_id;
      const chosen = id === selected ? ' selected' : '';
      const frames = record.rule === 'lanes'
        ? record.area.lanes.map((lane) => rect(lane.frame_pt, `bounded-frame rule-lanes${chosen}`, id)).join('')
        : rect(record.area.frame_pt, `bounded-frame rule-${record.rule}${chosen}`, id);
      return frames;
    }).join('') + ordered.map((record) => {
      const id = record.area.unit_id;
      const chosen = id === selected ? ' selected' : '';
      return rect(record.area.source_box_pt, `bounded-source outcome-${record.outcome}${chosen}`, id);
    }).join('') + ordered.flatMap((record) => record.lines.map((line) => rect(line, 'bounded-line'))).join('');
    const counts = (records || []).reduce((total, record) => {
      total[record.outcome] = (total[record.outcome] || 0) + 1;
      return total;
    }, {});
    const pageNote = records
      ? `${records.length} areas · ${counts.set || 0} set · ${counts['partly-set'] || 0} partly set · ${counts['source-ink'] || 0} kept source ink · profile ${escapeHtml(statusPage.diagnostics.typography_profile || '—')}`
      : statusPage
        ? `Not set in bounded areas · ${escapeHtml(statusPage.status || '')}${statusPage.reason ? ` · ${escapeHtml(statusPage.reason)}` : ''}${statusPage.diagnostics?.mode ? ` · ${escapeHtml(statusPage.diagnostics.mode)}` : ''}`
        : 'No placement status for this page';
    const withoutLines = records && records.some((record) => record.placements.length && !record.lines.length);

    host.innerHTML = `
      <div class="omnidoc-toolbar">
        <a href="${artifactUrl('omnidoc-placement-status')}" download="omnidoc-placement-status.json">Download placement status</a>
        <label>Page <select data-page>${source.pages.map((item, index) => `<option value="${index}" ${index === pageIndex ? 'selected' : ''}>${item.index + 1}</option>`).join('')}</select> / ${source.pages.length}</label>
        <label>Background <select data-background>
          <option value="source" ${background === 'source' ? 'selected' : ''}>Source page</option>
          <option value="translated" ${background === 'translated' ? 'selected' : ''}>Delivered page</option>
        </select></label>
        <label><input type="checkbox" data-layer="frames" ${layers.frames ? 'checked' : ''}> Frames</label>
        <label><input type="checkbox" data-layer="sources" ${layers.sources ? 'checked' : ''}> Source boxes</label>
        <label><input type="checkbox" data-layer="lines" ${layers.lines ? 'checked' : ''}> Set lines</label>
        <span>${pageNote}</span>
        <span>Dashed: permitted frame (blue text · orange heading · teal table · purple lane) · solid: source box (red: kept source ink) · green: set lines · amber: selected</span>
        ${withoutLines ? '<span class="omnidoc-coverage" role="status">This run predates set-line provenance</span>' : ''}
      </div>
      <div class="omnidoc-body">
        <div class="omnidoc-page-scroll"><div class="omnidoc-page" style="aspect-ratio:${page.width}/${page.height}">
          <img src="${artifactUrl(imageName)}" alt="${background === 'translated' ? 'Delivered' : 'Source'} page ${page.index + 1}">
          <svg viewBox="0 0 ${page.width} ${page.height}" aria-label="Bounded frames" class="${Object.entries(layers).filter(([, on]) => !on).map(([name]) => `bounded-hide-${name}`).join(' ')}">${overlay}</svg>
        </div></div>
        <aside class="omnidoc-details">
          <label>Area <select data-select><option value="">Choose on the page</option>${(records || []).map((record) => `<option value="${record.area.unit_id}" ${record.area.unit_id === selected ? 'selected' : ''}>Unit ${record.area.unit_id} · ${escapeHtml((record.area.kinds || []).join(', '))} · ${escapeHtml(OUTCOMES[record.outcome])}</option>`).join('')}</select></label>
          ${records ? details(active) : `<p>${pageNote}</p>${statusPage ? `<details><summary>Page status</summary><pre>${escapeHtml(JSON.stringify({ ...statusPage, placement: undefined }, null, 2))}</pre></details>` : ''}`}
        </aside>
      </div>`;
    host.querySelector('[data-page]').addEventListener('change', (event) => {
      pageIndex = Number(event.target.value);
      selected = null;
      render();
    });
    host.querySelector('[data-background]').addEventListener('change', (event) => {
      background = event.target.value;
      render();
    });
    host.querySelectorAll('[data-layer]').forEach((node) => {
      node.addEventListener('change', (event) => {
        layers[node.dataset.layer] = event.target.checked;
        render();
      });
    });
    host.querySelector('[data-select]').addEventListener('change', (event) => {
      selected = event.target.value === '' ? null : Number(event.target.value);
      render();
    });
    host.querySelectorAll('[data-unit]').forEach((node) => {
      const choose = () => { selected = Number(node.dataset.unit); render(); };
      node.addEventListener('click', choose);
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose();
        }
      });
    });
    host.querySelector('img').addEventListener('error', (event) => {
      event.target.alt = 'Page image unavailable';
    });
  }

  function hide() {
    generation += 1;
    controller?.abort();
    host.hidden = true;
    host.replaceChildren();
    source = null;
    status = null;
  }

  return {
    hide,
    async show(id) {
      hide();
      requestId = id;
      pageIndex = 0;
      selected = null;
      controller = new AbortController();
      const current = generation;
      host.hidden = false;
      host.textContent = 'Loading bounded frames…';
      try {
        const [loadedSource, loadedStatus] = await Promise.all([
          api.getPdfArtifactJson(id, 'omnidoc', { signal: controller.signal }),
          api.getPdfArtifactJson(id, 'omnidoc-placement-status', { signal: controller.signal }),
        ]);
        if (current !== generation) return;
        source = loadedSource;
        status = loadedStatus;
        if (!source.pages?.length) throw new Error('This representation contains no PDF pages.');
        if (!Array.isArray(status.pages)) throw new Error('This artifact is not a placement status.');
        render();
      } catch (error) {
        if (current === generation && error.name !== 'AbortError') {
          host.textContent = formatApiError(error);
        }
      }
    },
  };
}
