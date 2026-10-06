// The bounded-frames inspector: which frame rule each area took, what came of it, and that the
// page draws the frame, the source box and the set lines it reads from the placement status.
//
// Run from the repo root with:  node --test 'tests/js/**/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';

import { api } from '../../static/src/plugins/translation-services/api.js';
import {
  createBoundedFramesInspector,
  pageFrames,
} from '../../static/src/workflows/pdf-translation/bounded-frames.js';

const area = (unitId, kinds, source, frame, extra = {}) => ({
  unit_id: unitId, kinds, source_box_pt: source, frame_pt: frame,
  text_boxes_pt: [source], lanes: null, unplaced_reason: null, source_extent_only: false, ...extra,
});

const boundedPage = {
  page: 1,
  page_id: 'p1',
  status: 'admitted',
  placement: {
    layout_policy: 'bounded',
    areas: [
      area(1, ['heading'], [50, 40, 150, 52], [50, 40, 300, 52]),
      area(2, ['text'], [50, 60, 300, 96], [40, 60, 320, 140], {
        text_boxes_pt: [[50, 60, 300, 72], [50, 72, 300, 84], [50, 84, 240, 96]],
      }),
      area(3, ['table'], [50, 150, 300, 170], [50, 150, 300, 170], {
        text_boxes_pt: [[50, 150, 120, 160], [130, 150, 300, 160], [50, 160, 120, 170]],
      }),
      area(4, ['text'], [50, 180, 300, 200], [50, 180, 500, 230], {
        unplaced_reason: 'multi_lane_group_not_supported',
        lanes: [
          { region_id: 'r1', source_box_pt: [50, 180, 300, 200], frame_pt: [50, 180, 300, 230] },
          { region_id: 'r2', source_box_pt: [320, 180, 500, 200], frame_pt: [320, 180, 500, 230] },
        ],
      }),
      area(5, ['text'], [50, 240, 300, 252], [40, 240, 320, 252]),
      area(6, ['footer'], [50, 260, 300, 272], [40, 260, 320, 272]),
      area(7, ['header'], [50, 280, 120, 292], [50, 280, 500, 292], { source_extent_only: true }),
    ],
  },
  diagnostics: {
    mode: 'bounded-regions',
    typography_profile: 'reference',
    placements: [
      { unit_id: 1, lines_pt: [[50, 39, 210, 53]] },
      { unit_id: 2, lines_pt: [[50, 59, 298, 73], [50, 71, 299, 85], [50, 83, 290, 97], [50, 95, 120, 109]] },
      { unit_id: 3, lines_pt: [[50, 149, 118, 161]] },
      { unit_id: 4, lane_region_id: 'r1', lines_pt: [[50, 179, 299, 191]] },
      { unit_id: 4, lane_region_id: 'r2', lines_pt: [[320, 179, 450, 191]] },
      { unit_id: 7, lines_pt: [[50, 279, 280, 293]] },
    ],
    preserved_parts: [
      { unit_id: 3, reason: 'text_area_cannot_fit', cell_ids: [9] },
      { unit_id: 5, reason: 'text_area_cannot_fit' },
    ],
    unchanged_unit_ids: [6],
  },
};

test('each area reads the frame rule the plan applied to it', () => {
  const rules = Object.fromEntries(pageFrames(boundedPage).map((record) => [record.area.unit_id, record.rule]));
  assert.deepEqual(rules, { 1: 'heading', 2: 'text', 3: 'table', 4: 'lanes', 5: 'text', 6: 'text', 7: 'text' });
});

test('each area says what became of it, with the reason a part kept its source ink', () => {
  const records = new Map(pageFrames(boundedPage).map((record) => [record.area.unit_id, record]));
  assert.equal(records.get(1).outcome, 'set');
  assert.equal(records.get(3).outcome, 'partly-set');
  assert.deepEqual(records.get(3).reasons, ['text_area_cannot_fit']);
  assert.equal(records.get(4).outcome, 'set');
  assert.equal(records.get(4).lines.length, 2);
  assert.equal(records.get(5).outcome, 'source-ink');
  assert.equal(records.get(6).outcome, 'unchanged');
});

test('frame growth and set ink are both measured against the source box', () => {
  const records = new Map(pageFrames(boundedPage).map((record) => [record.area.unit_id, record]));
  assert.deepEqual(records.get(2).growth, { left: 10, top: 0, right: 20, bottom: 44 });
  assert.deepEqual(records.get(1).inkBeyond, { left: 0, right: 60 });
  assert.deepEqual(records.get(2).inkBeyond, { left: 0, right: -1 });
  assert.equal(records.get(5).inkBeyond, null);
});

test('source lines are counted per printed line, not per text box', () => {
  const records = new Map(pageFrames(boundedPage).map((record) => [record.area.unit_id, record]));
  assert.equal(records.get(1).sourceLines, 1);
  assert.equal(records.get(2).sourceLines, 3);
  assert.equal(records.get(3).sourceLines, 2);
});

test('a page not set in bounded areas has no frames to show', () => {
  assert.equal(pageFrames({ ...boundedPage, diagnostics: { ...boundedPage.diagnostics, mode: 'column-flow' } }), null);
  assert.equal(pageFrames({ page: 1, page_id: 'p1', status: 'withheld', reason: 'page_not_admitted' }), null);
  assert.equal(pageFrames(null), null);
});

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

test('the page draws every frame, source box and set line of the placement status', async () => {
  const original = api.getPdfArtifactJson;
  api.getPdfArtifactJson = async (_id, name) => (name === 'omnidoc'
    ? { pages: [{ id: 'p1', index: 0, width: 600, height: 800 }] }
    : { pages: [boundedPage] });
  try {
    const host = fakeHost();
    await createBoundedFramesInspector(host).show('req_test');
    const count = (pattern) => (host.innerHTML.match(pattern) || []).length;
    // Six single frames, and the lane item draws its two lane frames instead of its outer one.
    assert.equal(count(/class="bounded-frame /g), 8);
    assert.equal(count(/class="bounded-frame rule-lanes/g), 2);
    assert.equal(count(/class="bounded-source /g), 7);
    assert.equal(count(/class="bounded-line"/g), 9);
    assert.match(host.innerHTML, /page-001-source/);
    assert.match(host.innerHTML, /7 areas · 4 set · 1 partly set · 1 kept source ink · profile reference/);
  } finally {
    api.getPdfArtifactJson = original;
  }
});
