// The story inspector: a page's stories drawn from the run's story records, each frame along its
// thread, the lines it holds, the source it gives up and where it stopped; and what the placement
// and the delivery decided after a fitting.
//
// Run from the repo root with:  node --test 'tests/js/**/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';

import { api } from '../../static/src/plugins/translation-services/api.js';
import { createStoryInspector } from '../../static/src/workflows/pdf-translation/stories.js';

const frame = (id, page, rect) => ({
  id, page, coordinates: 'page-pt', rect, inset: [0, 0, 0, 0], origin: 'lane', pinned: false,
});

const line = (box, text = 'Invented words') => ({ text, box, size: 10 });
const quad = ([left, top, right, bottom]) => [[left, top], [right, top], [right, bottom], [left, bottom]];

// One attempt of a story of one part: its frames, and what its setting derived (null: not set).
const attempt = (id, frames, derived) => ({
  requested: {
    settings: { size_scale: 1, leading_scale: null },
    hyphen_rule: true,
    thread: { id, origin: 'plan', frames },
    parts: [{
      id, element: `element-${id}`, selection: [], label: 'text', whole: false,
      keep_with_next: false, gap_before: 0,
      geometry: { break_measure: 'source', fit: 'ink', lane: true },
      settings: { size_scale: null, leading_scale: null },
      cursor: { text: 'Invented words that run on', spans: [], position: 0 },
      fragments: frames.map((item) => ({ frame: item.id, shift: 0, unit_id: 1, source_quads: [quad(item.rect)] })),
    }],
  },
  derived,
});

const setting = (pieces, refusal = null) => ({
  size_scale: 1, leading_scale: 1, fits: refusal === null, pieces, refusal,
});

const piece = (part, frameId, lines, start, end, initial = null) => ({
  part, frame: frameId, start, end, offset: 0, top: lines[0].box[1], bottom: lines[lines.length - 1].box[3], lines, initial,
});

const lanes = [frame('item-4-lane-0', 1, [50, 100, 250, 140]), frame('item-4-lane-1', 1, [300, 40, 500, 80])];
const turn = [frame('item-7-lane-0', 1, [50, 700, 250, 740]), frame('item-7-lane-1', 2, [50, 40, 250, 80])];
const record = (id, unitId, kind, chosen, attempts, planGroups = []) => ({
  unit_id: unitId, id, kind, group: null, chosen, saved: false, attempts, plan_groups: planGroups,
});

const stories = {
  version: 1,
  coordinates: 'page-pt',
  pages: [{
    page: 1,
    page_id: 'p1',
    stories: [
      record('item-4', 4, 'running-text', 0, [
        attempt('item-4', lanes, setting([
          piece('item-4', 'item-4-lane-0', [line([70, 100, 240, 112]), line([70, 112, 240, 124])], 0, 12,
            { text: 'I', box: [50, 98, 66, 124], size: 30 }),
          piece('item-4', 'item-4-lane-1', [line([300, 40, 420, 52])], 12, 26),
        ])),
        { ...attempt('item-4', lanes, null), requested: { ...attempt('item-4', lanes, null).requested, hyphen_rule: false } },
      ], [{ erase_box: [50, 98, 500, 124] }]),
      record('area-5', 5, 'running-text', null, [
        attempt('area-5', [frame('area-5', 1, [50, 200, 250, 224])], setting(
          [piece('area-5', 'area-5', [line([50, 200, 240, 212]), line([50, 212, 240, 224])], 0, 14)],
          { reason: 'overset', part: 'area-5', position: 14, frame: null, detail: '', held_lines: [] },
        )),
      ]),
      record('area-6', 6, 'title', 0, [
        attempt('area-6', [frame('area-6', 1, [50, 300, 500, 330])], setting(
          [piece('area-6', 'area-6', [line([60, 300, 480, 330])], 0, 26)],
        )),
      ]),
      record('item-7', 7, 'running-text', 0, [
        attempt('item-7', turn, setting([
          piece('item-7', 'item-7-lane-0', [line([50, 700, 240, 712])], 0, 12),
          piece('item-7', 'item-7-lane-1', [line([50, 40, 240, 52])], 12, 26),
        ])),
      ]),
    ],
  }],
};

const admitted = {
  pages: [{
    page: 1,
    page_id: 'p1',
    status: 'admitted',
    diagnostics: {
      mode: 'bounded-regions',
      // Fitted, then kept: what the placement decided after the story was set.
      preserved_parts: [
        { unit_id: 5, reason: 'text_area_cannot_fit' },
        { unit_id: 6, reason: 'own_object_on_other_page' },
        { unit_id: 9, reason: 'mixed_member_translation' },
      ],
    },
  }],
};

function fakeHost() {
  const control = { addEventListener() {} };
  return {
    hidden: true,
    innerHTML: '',
    textContent: '',
    replaceChildren() { this.innerHTML = ''; this.textContent = ''; },
    querySelector() { return control; },
    querySelectorAll() { return []; },
  };
}

async function shown(pages, { status = admitted, turns = null, document = null } = {}) {
  const original = api.getPdfArtifactJson;
  api.getPdfArtifactJson = async (_id, name) => {
    if (name === 'omnidoc-page-turns' && !turns) throw new Error('404');
    return ({
      omnidoc: { pages },
      'omnidoc-stories': stories,
      'omnidoc-placement-status': status,
      'omnidoc-page-turns': turns,
      document,
    })[name];
  };
  try {
    const host = fakeHost();
    await createStoryInspector(host).show('req_test');
    return host.innerHTML;
  } finally {
    api.getPdfArtifactJson = original;
  }
}

const count = (html, pattern) => (html.match(pattern) || []).length;

test('the page draws each story frame along its thread, with its lines and its source', async () => {
  const html = await shown([{ id: 'p1', index: 0, width: 600, height: 800 }]);
  // Two lanes of item-4, one frame each of area-5 and area-6, and item-7's frame on this page.
  assert.equal(count(html, /class="story-frame /g), 5);
  // item-4's two frames and item-7's first are numbered; one arrow joins item-4's lanes, and
  // item-7's thread goes on to the next page.
  assert.equal(count(html, /class="story-frame-number">/g), 3);
  assert.equal(count(html, /class="story-thread"/g), 1);
  assert.equal(count(html, /→ p2/g), 1);
  assert.equal(count(html, /<polygon points="[^"]+" class="story-source"/g), 5);
  // Delivered lines: item-4's three and its initial, and item-7's one here; area-5 and area-6
  // were not delivered.
  assert.equal(count(html, /class="story-line"/g), 5);
  assert.equal(count(html, /class="story-line unset"/g), 3);
  // Only the overset story carries a mark.
  assert.equal(count(html, /class="story-mark"/g), 1);
  assert.match(html, /4 stories · 2 set · 2 kept source/);
  // A part kept before any story is named apart.
  assert.match(html, /1 part\(s\) kept their source before any story/);
});

test('a story kept after its fitting reads as kept, with the reason the placement gave', async () => {
  const html = await shown([{ id: 'p1', index: 0, width: 600, height: 800 }]);
  assert.match(html, /class="story-frame kind-title kept"/);
  assert.match(html, /class="kept">area-6</);
  assert.match(html, /class="set">item-4</);
});

test('a story set on another page is listed on the page its frame stands on', async () => {
  const html = await shown([{ id: 'p2', index: 1, width: 600, height: 800 }]);
  assert.equal(count(html, /class="story-frame /g), 1);
  assert.match(html, /item-7 \(from p1\)/);
  assert.match(html, /page-002-source/);
});

test('a page withheld at delivery shows its stories withheld, not delivered and not kept', async () => {
  // A notice page stands where the export held the page: nothing of its stories is delivered,
  // and neither is its source.
  const status = { pages: [{ ...admitted.pages[0], status: 'withheld', reason: 'export_held:INVENTED' }] };
  const html = await shown([{ id: 'p1', index: 0, width: 600, height: 800 }], { status });
  assert.match(html, /Page withheld at delivery: export_held:INVENTED · 4 stories · 0 set · 0 kept source · 4 withheld/);
  assert.equal(count(html, /class="story-line"/g), 0);
  assert.match(html, /class="story-frame kind-running-text withheld"/);
});

test('a page turn the export held reads as kept, though its story fitted', async () => {
  const turns = { turns: [{ tail: { page: 1, unit_id: 7 }, head: { page: 2, unit_id: 3 }, status: 'source',
    placement: { status: 'source', reason: 'export_held' } }] };
  const html = await shown([{ id: 'p1', index: 0, width: 600, height: 800 }], { turns });
  assert.match(html, /class="kept">item-7</);
  assert.match(html, /4 stories · 1 set · 3 kept source/);
});

test('a group the export kept in its source reads as kept for the story it delivers, and no other', async () => {
  // The export reports such a group by the box of the source it would erase; the record names
  // the groups that deliver a story by the same box. An unmatched box is counted, not guessed.
  const document = { pages: [{ page: 1, vector: { groups_held: 2,
    held_group_boxes_pt: [[50, 98, 500, 124], [10, 10, 20, 20]] } }] };
  const html = await shown([{ id: 'p1', index: 0, width: 600, height: 800 }], { document });
  assert.match(html, /class="kept">item-4</);
  assert.match(html, /class="set">item-7</);
  assert.match(html, /4 stories · 1 set · 3 kept source · 1 group\(s\) the export kept in source match no story/);
  // item-4's lines are no longer drawn as delivered: item-7's one line is.
  assert.equal(count(html, /class="story-line"/g), 1);
});
