// Run: node tests/omnidoc_layout_metrics_ui.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceRoot = new URL('../static/src/', import.meta.url);
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const helpers = dataModule(await readFile(new URL('shared/ui-helpers.js', sourceRoot), 'utf8'));
globalThis.metricsTestApi = {};
let source = await readFile(new URL('workflows/pdf-translation/layout-metrics.js', sourceRoot), 'utf8');
source = source.replace("import { api } from '../../api-client.js';", 'const api = globalThis.metricsTestApi;')
  .replace("'../../shared/ui-helpers.js'", JSON.stringify(helpers));
const { createLayoutMetricsInspector } = await import(dataModule(source));

const inputs = { page_ids: [], fragment_ids: [], element_ids: [], run_ids: [], region_ids: [], style_ids: [] };
const full = { population: 6, known: 6, unit: 'codepoints', status: 'full', ratio: 1, missing_ratio: 0 };
const absent = { ...full, known: 0, status: 'unavailable', ratio: 0, missing_ratio: 1 };
const area = { area: 600, ratio: .06, coverage: full, inputs };
const metrics = {
  text_area: area,
  region_kinds: { kinds: [{ ...area, kind: 'chart', count: 1 }], inputs },
  visual_area: { ...area, groups: [{ ...area, group: 'illustrations', kinds: ['chart'], region_ids: [] }] },
  region_sizes: { count: 0, quantified_count: 0, nested_count: 0, q1: null, median: null, q3: null, coverage: full, excluded: [], inputs },
  typography: { page_mapping: full, inputs, properties: [{ property: 'font_name', coverage: absent, categories: [] }] },
};
const canonicalSource = { id: 'doc', revision_id: 'source-1', schema_version: 6 };
const artifact = { payload_sha256: 'payload-checksum', profile: {
  profile_version: 1, document_id: 'doc', revision_id: 'source-1', document_schema_version: 6,
  definition_version: 'layout-v1', implementation_version: 'contours-v1', input_fingerprint: 'input-fingerprint',
  document: metrics, pages: [{ page_id: 'p1', page_index: 0, cell_source: 'pdf_text_layer',
    measurements: { ...metrics, text_area: { ...area, ratio: .4 } } }], diagnostics: [], rules: {},
} };

function host() {
  const select = { addEventListener(event, listener) { this.change = listener; } };
  return { hidden: true, innerHTML: '', textContent: '', select,
    replaceChildren() { this.innerHTML = ''; this.textContent = ''; },
    querySelector(selector) { assert.equal(selector, '[data-scope]'); return select; },
  };
}

metricsTestApi.getPdfArtifactJson = async (_id, name) => name === 'omnidoc' ? canonicalSource : artifact;
const container = host();
const inspector = createLayoutMetricsInspector(container);
await inspector.show('request');
assert.equal(container.hidden, false);
assert.match(container.innerHTML, /6\.0%/);
assert.match(container.innerHTML, /unavailable · 0\/6/);
assert.match(container.innerHTML, /<td>—<\/td>/); // Missing quantiles stay absent.
assert.match(container.innerHTML, /<td>chart<\/td>/);
container.select.change({ target: { value: 'p1' } });
assert.match(container.innerHTML, /40\.0%/);
inspector.hide();
assert.equal(container.hidden, true);
assert.equal(container.innerHTML, '');

metricsTestApi.getPdfArtifactJson = async (_id, name) => name === 'omnidoc'
  ? { ...canonicalSource, revision_id: 'source-2' } : artifact;
await inspector.show('request');
assert.match(container.textContent, /different source revision/);

metricsTestApi.getPdfArtifactJson = async () => ({ status: 'failed', error: 'invalid metric input' });
await inspector.show('request', { statusOnly: true });
assert.match(container.textContent, /invalid metric input/);

const pending = [];
metricsTestApi.getPdfArtifactJson = (_id, name) => new Promise((resolve) => pending.push(() =>
  resolve(name === 'omnidoc' ? canonicalSource : artifact)));
const waiting = inspector.show('request');
inspector.hide();
pending.forEach((resolve) => resolve());
await waiting;
assert.equal(container.hidden, true);
assert.equal(container.innerHTML, ''); // Late API answers cannot reopen a hidden view.
console.log('Layout metrics UI: display, page scope, revision mismatch, failure and cancellation passed.');
