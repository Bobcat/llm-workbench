// Run: node tests/placement_plan_ui.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../static/src/', import.meta.url);
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const helpers = moduleUrl(await readFile(new URL('shared/ui-helpers.js', root), 'utf8'));
let code = await readFile(new URL('workflows/pdf-translation/placement-plan.js', root), 'utf8');
code = code.replace("import { api } from '../../plugins/translation-services/api.js';", 'const api = globalThis.placementTestApi;')
  .replace("'../../shared/ui-helpers.js'", JSON.stringify(helpers));
const polygon = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const source = { pages: [{ id: 'p1', index: 0, width: 200, height: 300 }], regions: [
  { id: 'left', page_id: 'p1', kind: 'text', polygon: polygon(10, 200, 80, 60) },
  { id: 'right', page_id: 'p1', kind: 'text', polygon: polygon(110, 20, 80, 30) },
] };
const target = { elements: [{ id: 'paragraph', content: [{ kind: 'text', text: 'Invented continuation' }] }] };
const plan = { targets: [{ id: 'target:paragraph', target_element_id: 'paragraph', page_ids: ['p1'],
  shape: 'reflowable', mobility: 'vertical_in_flow', content_class: 'flow_text', flow_eligible: true,
  regions: [{ region_id: 'left' }, { region_id: 'right' }],
  bounding_box: { left: 10, top: 20, right: 190, bottom: 260 },
}], physical_objects: [
  { id: 'fixed-formula', page_id: 'p1', content_class: 'formula', object_kind: 'display_formula', polygon: polygon(10, 100, 80, 20) },
  { id: 'movable-formula', page_id: 'p1', content_class: 'formula', object_kind: 'display_formula', polygon: polygon(110, 100, 80, 20) },
  { id: 'footer', page_id: 'p1', content_class: 'furniture', object_kind: 'footer', polygon: polygon(10, 280, 80, 10) },
], page_fixed_object_ids: ['fixed-formula', 'footer'], summary: {} };
globalThis.placementTestApi = { getPdfArtifactJson: async (_id, name) => ({
  omnidoc: source, 'omnidoc-target': target, 'omnidoc-placement-plan': plan,
})[name] };
const listeners = new Map();
const host = { hidden: true, innerHTML: '', textContent: '', replaceChildren() { this.innerHTML = ''; },
  querySelector(selector) { return { addEventListener(event, callback) { listeners.set(`${selector}:${event}`, callback); } }; },
  querySelectorAll() { return []; },
};
const { createPlacementPlanInspector } = await import(moduleUrl(code));
await createPlacementPlanInspector(host).show('invented');
const svg = () => host.innerHTML.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)[1];
assert.equal((svg().match(/data-placement="target:paragraph"/g) || []).length, 2);
assert.doesNotMatch(svg(), /points="10,20 190,20 190,260 10,260"/);
assert.match(svg(), /placement-object fixed[^>]*data-placement="fixed-formula"/);
assert.match(svg(), /placement-object[^>]*data-placement="movable-formula"/);
assert.doesNotMatch(svg(), /data-placement="footer"/);
listeners.get('[data-furniture]:change')({ target: { checked: true } });
assert.match(svg(), /data-placement="footer"/);
listeners.get('[data-select]:change')({ target: { value: 'fixed-formula' } });
listeners.get('[data-furniture]:change')({ target: { checked: false } });
assert.match(svg(), /fixed selected[^>]*data-placement="fixed-formula"/);
assert.doesNotMatch(svg(), /data-placement="footer"/);
console.log('Placement inspector: separate frames, persistent formula visibility and fixed-object distinction passed.');
