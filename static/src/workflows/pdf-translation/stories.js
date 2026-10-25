// The stories a bounded page set, over the page: each story's frames numbered along its thread,
// the lines each frame holds, the source it gives up, where it ran over or was refused, and the
// attempts of its fitting (translation-services docs/omnidoc/story-design.md §10). Reads the
// run's story records (`omnidoc-stories`) beside its placement status; inspection only.
import { api } from '../../plugins/translation-services/api.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const KINDS = {
  'running-text': 'Running text',
  title: 'Title',
  label: 'Label',
  caption: 'Caption',
  'table-cell': 'Table cell',
  'footnote-block': 'Footnote block',
  'author-block': 'Author block',
};

const REFUSALS = {
  overset: 'overset: the thread is full',
  horizontal: 'horizontal: a word or the anchor does not fit the width',
  mapping: 'mapping: the set lines do not map back onto the supplied text',
  object: 'object: an inline formula or link would leave its page',
};

const LAYERS = {
  frames: 'Frames',
  threads: 'Threads',
  sources: 'Source given up',
  lines: 'Set lines',
  marks: 'Overset and refusals',
  attempts: 'Other attempts',
};

const number = (value, digits = 2) => (value == null ? '—' : Number(value).toFixed(digits));
const rectText = (rect) => `${rect.map((value) => number(value, 1)).join(', ')} pt`;

// Every story of the run, keyed by the page that set it and its id: a story's frames may stand
// on another page than the one that set it (a lane over a page turn).
function collect(storiesDocument, statusDocument) {
  const statuses = new Map((statusDocument?.pages || []).map((page) => [page.page, page]));
  return (storiesDocument?.pages || []).flatMap((page) => (page.stories || []).map((record) => {
    const preserved = (statuses.get(page.page)?.diagnostics?.preserved_parts || [])
      .filter((part) => part.unit_id === record.unit_id && cellMatches(part, record));
    const tried = record.attempts.filter((attempt) => attempt.derived).length;
    return {
      key: `${page.page}:${record.id}`,
      page: page.page,
      record,
      // What the adapter decided after the fitting: the part kept its source.
      kept: preserved.map((part) => part.reason),
      // The attempt the page reports: the chosen one, else the last one set.
      reported: record.chosen ?? Math.max(0, tried - 1),
    };
  }));
}

// A table's preserved cell names its cells; a story of a cell names them in its selection.
function cellMatches(part, record) {
  if (!part.cell_ids) return true;
  const selection = record.attempts[0]?.requested.parts.flatMap((item) => item.selection) || [];
  return part.cell_ids.some((id) => selection.includes(String(id)));
}

function outcome(story) {
  const { record } = story;
  if (record.chosen != null && !story.kept.length) {
    return { set: true, text: `Set by attempt ${record.chosen + 1} of ${record.attempts.length}` };
  }
  if (record.chosen != null) return { set: false, text: `Fitted by attempt ${record.chosen + 1}, then kept its source: ${story.kept.join(', ')}` };
  const refusal = record.attempts[story.reported]?.derived?.refusal;
  return { set: false, text: `Kept its source: ${refusal ? REFUSALS[refusal.reason] || refusal.reason : 'no attempt fitted'}` };
}

export function createStoryInspector(host) {
  let generation = 0;
  let controller = null;
  let requestId = '';
  let source = null;
  let stories = [];
  let statusDocument = null;
  let pageIndex = 0;
  let selected = '';
  let background = 'source';
  // Per story the attempt shown, where the reader chose another than the reported one.
  const shown = new Map();
  const hiddenKinds = new Set();
  const hiddenStories = new Set();
  const layers = { frames: true, threads: true, sources: true, lines: true, marks: true, attempts: true };

  const artifactUrl = (name) => `/api/pdf-translation/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(name)}`;
  const attemptOf = (story) => story.record.attempts[shown.get(story.key) ?? story.reported];
  const framesOf = (attempt) => attempt.requested.thread.frames;
  const box = (rect, classes, extra = '', title = '') => {
    const [left, top, right, bottom] = rect;
    return `<rect x="${left}" y="${top}" width="${Math.max(0, right - left)}" height="${Math.max(0, bottom - top)}" class="${classes}"${extra}>${title ? `<title>${escapeHtml(title)}</title>` : ''}</rect>`;
  };

  function overlay(visible, pageNo) {
    const parts = { frames: [], threads: [], sources: [], lines: [], marks: [], attempts: [] };
    // Larger frames first, so a small one inside them stays on top and can be chosen.
    const ordered = [...visible].sort((a, b) => {
      const area = (story) => Math.max(...framesOf(attemptOf(story)).map(({ rect }) => (rect[2] - rect[0]) * (rect[3] - rect[1])));
      return area(b) - area(a);
    });
    for (const story of ordered) {
      const attempt = attemptOf(story);
      const index = story.record.attempts.indexOf(attempt);
      const chosen = story.key === selected ? ' selected' : '';
      const state = outcome(story).set ? 'set' : 'kept';
      const target = ` data-story="${escapeAttr(story.key)}" tabindex="0" role="button"`;
      const frames = framesOf(attempt);
      frames.forEach((frame, position) => {
        if (frame.page !== pageNo) return;
        parts.frames.push(box(frame.rect, `story-frame kind-${story.record.kind} ${state}${chosen}`,
          target, `${story.record.id} · frame ${position + 1} of ${frames.length}`));
        if (frames.length > 1) {
          parts.threads.push(`<text x="${frame.rect[0] + 1.5}" y="${frame.rect[1] + 7}" class="story-frame-number">${position + 1}</text>`);
        }
        const next = frames[position + 1];
        if (next && next.page === pageNo) {
          const [x0, , x1, y1] = frame.rect;
          parts.threads.push(`<line x1="${(x0 + x1) / 2}" y1="${y1}" x2="${(next.rect[0] + next.rect[2]) / 2}" y2="${next.rect[1]}" class="story-thread${chosen}" marker-end="url(#story-arrow)"/>`);
        } else if (next) {
          parts.threads.push(`<text x="${frame.rect[2] - 1.5}" y="${frame.rect[3] - 2}" class="story-frame-number end">→ p${next.page}</text>`);
        }
      });
      for (const part of attempt.requested.parts) {
        for (const fragment of part.fragments) {
          const frame = frames.find((item) => item.id === fragment.frame);
          if (frame?.page !== pageNo) continue;
          for (const rect of fragment.source_boxes) parts.sources.push(box(rect, `story-source${chosen}`));
        }
      }
      const derived = attempt.derived;
      if (derived) {
        const delivered = index === story.record.chosen && !story.kept.length;
        for (const piece of derived.pieces) {
          if (frames.find((item) => item.id === piece.frame)?.page !== pageNo) continue;
          for (const line of piece.lines) parts.lines.push(box(line.box, `story-line${delivered ? '' : ' unset'}`));
        }
        const refusal = derived.refusal;
        if (refusal) {
          const frame = frames.find((item) => item.id === refusal.frame) || frames[frames.length - 1];
          if (frame.page === pageNo) {
            const [, , x1, y1] = frame.rect;
            parts.marks.push(`<g class="story-mark"${target}><title>${escapeHtml(REFUSALS[refusal.reason] || refusal.reason)}</title><rect x="${x1 - 7}" y="${y1 - 7}" width="7" height="7"/><text x="${x1 - 3.5}" y="${y1 - 1.6}">${refusal.reason === 'overset' ? '+' : '!'}</text></g>`);
          }
          for (const line of refusal.held_lines || []) {
            if (frame.page === pageNo) parts.lines.push(box(line.box, 'story-line held'));
          }
        }
      }
      if (story.key === selected) {
        story.record.attempts.forEach((other) => {
          if (other === attempt) return;
          for (const frame of framesOf(other)) {
            if (frame.page === pageNo) parts.attempts.push(box(frame.rect, 'story-attempt'));
          }
        });
      }
    }
    return Object.entries(parts)
      .map(([name, items]) => `<g class="story-layer-${name}">${items.join('')}</g>`)
      .join('');
  }

  // A part's supplied text, by what the shown attempt did with it: each frame's stretch in turn,
  // and where it stopped, the rest that no frame holds.
  function partText(part, derived) {
    const text = part.cursor.text;
    if (!derived) return `<span class="story-text untried">${escapeHtml(text)}</span>`;
    const pieces = derived.pieces.filter((piece) => piece.part === part.id);
    const chunks = [];
    let at = 0;
    pieces.forEach((piece, index) => {
      if (piece.start > at) chunks.push(`<span class="story-text before">${escapeHtml(text.slice(at, piece.start))}</span>`);
      chunks.push(`<span class="story-text piece-${index % 2}" title="${escapeAttr(`${piece.frame} · ${piece.start}–${piece.end}`)}">${escapeHtml(text.slice(piece.start, piece.end))}</span>`);
      at = piece.end;
    });
    const refusal = derived.refusal;
    if (refusal?.part === part.id) {
      chunks.push(`<span class="story-text stopped" title="${escapeAttr(REFUSALS[refusal.reason] || refusal.reason)}">${escapeHtml(text.slice(refusal.position))}</span>`);
    } else if (at < text.length) {
      chunks.push(`<span class="story-text before">${escapeHtml(text.slice(at))}</span>`);
    }
    return chunks.join('');
  }

  function details(story) {
    if (!story) return '<p>Select a story on the page or in the list to see its thread, its parts and the attempts of its fitting.</p>';
    const { record } = story;
    const attempt = attemptOf(story);
    const index = record.attempts.indexOf(attempt);
    const requested = attempt.requested;
    const derived = attempt.derived;
    const thread = requested.thread;
    const sizes = [...new Set((derived?.pieces || []).flatMap((piece) => piece.lines.map((line) => line.size)))];
    const rows = record.attempts.map((item, position) => {
      const refusal = item.derived?.refusal;
      const result = !item.derived ? 'not set'
        : item.derived.fits ? 'fits'
          : `${escapeHtml(refusal.reason)} at ${refusal.position}`;
      const measures = [...new Set(item.requested.parts.map((part) => part.geometry.break_measure))].join(', ');
      return `<tr data-attempt="${position}" class="${position === index ? 'shown' : ''}${position === record.chosen ? ' chosen' : ''}">
        <td>${position + 1}</td><td>${escapeHtml(measures)}</td>
        <td>×${number(item.requested.settings.size_scale)}</td>
        <td>${item.requested.hyphen_rule ? 'yes' : 'no'}</td>
        <td>${escapeHtml(framesOf(item).map((frame) => rectText(frame.rect)).join(' → '))}</td>
        <td>${result}</td></tr>`;
    }).join('');
    const parts = requested.parts.map((part) => `
      <details open><summary>${escapeHtml(part.id)} · ${escapeHtml(part.label)}</summary>
        <dl class="omnidoc-origin">
          <dt>Element</dt><dd>${escapeHtml(part.element)}${part.selection.length ? ` · cells ${escapeHtml(part.selection.join(', '))}` : ''}</dd>
          <dt>Geometry</dt><dd>break at ${escapeHtml(part.geometry.break_measure)} · fit by ${escapeHtml(part.geometry.fit)}${part.geometry.lane ? ' · lane' : ' · free, checked against its frame'}</dd>
          <dt>Keeps</dt><dd>${part.whole ? 'whole' : 'may split'}${part.keep_with_next ? ' · with next' : ''}${part.gap_before ? ` · gap ${number(part.gap_before, 1)} pt` : ''}</dd>
          <dt>Fragments</dt><dd>${part.fragments.map((fragment) => `${escapeHtml(fragment.frame)}${fragment.shift ? ` moved ${number(fragment.shift, 1)} pt` : ''} · ${fragment.source_boxes.length} source box(es)`).join('<br>')}</dd>
          ${part.settings.size_scale != null || part.settings.leading_scale != null ? `<dt>Own typography</dt><dd>size ×${number(part.settings.size_scale)} · leading ×${number(part.settings.leading_scale)}</dd>` : ''}
        </dl>
        <p class="story-text-block">${partText(part, derived)}</p>
      </details>`).join('');
    return `<strong>${escapeHtml(record.id)}</strong>
      <code>${escapeHtml(KINDS[record.kind] || record.kind)} · unit ${escapeHtml(String(record.unit_id))} · set on page ${story.page}</code>
      <dl class="omnidoc-origin">
        <dt>Outcome</dt><dd>${escapeHtml(outcome(story).text)}</dd>
        <dt>Thread</dt><dd>${escapeHtml(thread.id)} · ${escapeHtml(thread.origin)} · ${thread.frames.map((frame, position) => `${position + 1}: ${escapeHtml(frame.id)} (p${frame.page}, ${escapeHtml(frame.origin)}${frame.pinned ? ', pinned' : ''})`).join('<br>')}</dd>
        <dt>Requested</dt><dd>size ×${number(requested.settings.size_scale)} · leading ${requested.settings.leading_scale == null ? 'source' : `×${number(requested.settings.leading_scale)}`} · hyphen rule ${requested.hyphen_rule ? 'on' : 'off'}</dd>
        <dt>Derived</dt><dd>${derived ? `size ×${number(derived.size_scale)} · leading ×${number(derived.leading_scale)} · lines at ${sizes.map((size) => `${number(size, 1)} pt`).join(', ') || '—'}` : 'not set'}</dd>
        ${derived?.refusal ? `<dt>Stopped</dt><dd>${escapeHtml(REFUSALS[derived.refusal.reason] || derived.refusal.reason)} · part ${escapeHtml(derived.refusal.part)} at ${derived.refusal.position}${derived.refusal.frame ? ` in ${escapeHtml(derived.refusal.frame)}` : ''}${derived.refusal.detail ? ` · ${escapeHtml(derived.refusal.detail)}` : ''}</dd>` : ''}
      </dl>
      <details open><summary>Fitting · attempt ${index + 1} shown</summary>
        <table class="story-attempts"><thead><tr><th>#</th><th>break</th><th>size</th><th>hyphen rule</th><th>frames</th><th>outcome</th></tr></thead><tbody>${rows}</tbody></table>
      </details>
      <h4>Parts</h4>${parts}
      <details><summary>Record</summary><pre>${escapeHtml(JSON.stringify(record, null, 2))}</pre></details>`;
  }

  function render() {
    const page = source.pages[pageIndex];
    const pageNo = page.index + 1;
    const statusPage = (statusDocument?.pages || []).find((item) => item.page_id === page.id) || null;
    const onPage = stories.filter((story) => story.record.attempts.some(
      (attempt) => framesOf(attempt).some((frame) => frame.page === pageNo)));
    const visible = onPage.filter((story) => !hiddenKinds.has(story.record.kind) && !hiddenStories.has(story.key));
    const active = stories.find((story) => story.key === selected) || null;
    const kinds = [...new Set(onPage.map((story) => story.record.kind))]
      .sort((a, b) => Object.keys(KINDS).indexOf(a) - Object.keys(KINDS).indexOf(b));
    const setCount = onPage.filter((story) => outcome(story).set).length;
    const ownIds = new Set(stories.filter((story) => story.page === pageNo).map((story) => story.record.unit_id));
    const withoutStory = (statusPage?.diagnostics?.preserved_parts || []).filter((part) => !ownIds.has(part.unit_id));
    const imageName = background === 'translated'
      ? `page-${String(pageNo).padStart(3, '0')}`
      : `page-${String(pageNo).padStart(3, '0')}-source`;
    const pageNote = onPage.length
      ? `${onPage.length} stories · ${setCount} set · ${onPage.length - setCount} kept source`
      : statusPage?.diagnostics?.mode === 'bounded-regions'
        ? 'No story on this page'
        : `No story records: ${escapeHtml(statusPage?.diagnostics?.mode || statusPage?.reason || 'not set in bounded areas')}`;
    const list = kinds.map((kind) => `
      <div class="story-kind">
        <label><input type="checkbox" data-kind="${escapeAttr(kind)}" ${hiddenKinds.has(kind) ? '' : 'checked'}> ${escapeHtml(KINDS[kind] || kind)} · ${onPage.filter((story) => story.record.kind === kind).length}</label>
        <ul>${onPage.filter((story) => story.record.kind === kind).map((story) => `
          <li class="${story.key === selected ? 'selected' : ''}"><input type="checkbox" data-hide="${escapeAttr(story.key)}" ${hiddenStories.has(story.key) ? '' : 'checked'} aria-label="Show ${escapeAttr(story.record.id)}">
            <button type="button" data-choose="${escapeAttr(story.key)}" class="${outcome(story).set ? 'set' : 'kept'}">${escapeHtml(story.record.id)}${story.page !== pageNo ? ` (from p${story.page})` : ''}</button></li>`).join('')}</ul>
      </div>`).join('');

    // The view is built anew on every choice; where the reader had scrolled to stays.
    const scrolled = ['.omnidoc-page-scroll', '.story-list', '.story-panel']
      .map((selector) => [selector, host.querySelector(selector)])
      .map(([selector, node]) => [selector, node?.scrollTop || 0, node?.scrollLeft || 0]);
    host.innerHTML = `
      <div class="omnidoc-toolbar">
        <a href="${artifactUrl('omnidoc-stories')}" download="omnidoc-stories.json">Download story records</a>
        <label>Page <select data-page>${source.pages.map((item, index) => `<option value="${index}" ${index === pageIndex ? 'selected' : ''}>${item.index + 1}</option>`).join('')}</select> / ${source.pages.length}</label>
        <label>Background <select data-background>
          <option value="source" ${background === 'source' ? 'selected' : ''}>Source page</option>
          <option value="translated" ${background === 'translated' ? 'selected' : ''}>Delivered page</option>
        </select></label>
        ${Object.entries(LAYERS).map(([name, label]) => `<label><input type="checkbox" data-layer="${name}" ${layers[name] ? 'checked' : ''}> ${label}</label>`).join('')}
        <span>${pageNote}</span>
        <span>Frame colour: kind (red: kept source) · numbers and arrows: thread · dark: source given up · green: set lines (orange: not delivered) · red +: overset · grey dotted: the selected story's other attempts</span>
      </div>
      <div class="omnidoc-body">
        <div class="omnidoc-page-scroll"><div class="omnidoc-page" style="aspect-ratio:${page.width}/${page.height}">
          <img src="${artifactUrl(imageName)}" alt="${background === 'translated' ? 'Delivered' : 'Source'} page ${pageNo}">
          <svg viewBox="0 0 ${page.width} ${page.height}" aria-label="Stories" class="${Object.entries(layers).filter(([, on]) => !on).map(([name]) => `story-hide-${name}`).join(' ')}">
            <defs><marker id="story-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 z"/></marker></defs>
            ${overlay(visible, pageNo)}
          </svg>
        </div></div>
        <aside class="omnidoc-details story-panel">
          ${list ? `<div class="story-list">${list}</div>` : `<p>${pageNote}</p>`}
          ${withoutStory.length ? `<details><summary>${withoutStory.length} part(s) kept their source before any story</summary><pre>${escapeHtml(JSON.stringify(withoutStory, null, 2))}</pre></details>` : ''}
          <div class="story-selected">${details(active)}</div>
        </aside>
      </div>`;
    for (const [selector, top, left] of scrolled) {
      const node = host.querySelector(selector);
      if (node) Object.assign(node, { scrollTop: top, scrollLeft: left });
    }
    host.querySelector('[data-page]').addEventListener('change', (event) => {
      pageIndex = Number(event.target.value);
      selected = '';
      render();
    });
    host.querySelector('[data-background]').addEventListener('change', (event) => {
      background = event.target.value;
      render();
    });
    host.querySelectorAll('[data-layer]').forEach((node) => node.addEventListener('change', (event) => {
      layers[node.dataset.layer] = event.target.checked;
      render();
    }));
    host.querySelectorAll('[data-kind]').forEach((node) => node.addEventListener('change', (event) => {
      if (event.target.checked) hiddenKinds.delete(node.dataset.kind); else hiddenKinds.add(node.dataset.kind);
      render();
    }));
    host.querySelectorAll('[data-hide]').forEach((node) => node.addEventListener('change', (event) => {
      if (event.target.checked) hiddenStories.delete(node.dataset.hide); else hiddenStories.add(node.dataset.hide);
      render();
    }));
    host.querySelectorAll('[data-choose]').forEach((node) => node.addEventListener('click', () => {
      select(node.dataset.choose);
      // Chosen in the list: its frame may stand outside the visible part of the page.
      host.querySelector('.story-frame.selected')?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }));
    host.querySelectorAll('[data-story]').forEach((node) => {
      const choose = () => {
        select(node.dataset.story);
        // Chosen on the page: its entry may stand outside the visible part of the list.
        host.querySelector('.story-kind li.selected')?.scrollIntoView({ block: 'nearest' });
      };
      node.addEventListener('click', choose);
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose();
        }
      });
    });
    host.querySelectorAll('[data-attempt]').forEach((node) => node.addEventListener('click', () => {
      shown.set(selected, Number(node.dataset.attempt));
      render();
    }));
    host.querySelector('img').addEventListener('error', (event) => {
      event.target.alt = 'Page image unavailable';
    });
  }

  function select(key) {
    selected = key;
    render();
  }

  function hide() {
    generation += 1;
    controller?.abort();
    host.hidden = true;
    host.replaceChildren();
    source = null;
    stories = [];
    statusDocument = null;
    shown.clear();
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
      host.textContent = 'Loading stories…';
      try {
        const [loadedSource, loadedStories, loadedStatus] = await Promise.all([
          api.getPdfArtifactJson(id, 'omnidoc', { signal: controller.signal }),
          api.getPdfArtifactJson(id, 'omnidoc-stories', { signal: controller.signal }),
          api.getPdfArtifactJson(id, 'omnidoc-placement-status', { signal: controller.signal }),
        ]);
        if (current !== generation) return;
        if (!loadedSource.pages?.length) throw new Error('This representation contains no PDF pages.');
        if (!Array.isArray(loadedStories.pages)) throw new Error('This artifact holds no story records.');
        source = loadedSource;
        statusDocument = loadedStatus;
        stories = collect(loadedStories, loadedStatus);
        render();
      } catch (error) {
        if (current === generation && error.name !== 'AbortError') {
          host.textContent = formatApiError(error);
        }
      }
    },
  };
}
