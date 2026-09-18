// Guards the frontend plugin contract.
//
// The sidebar, routes and lazy view loader are derived from the manifests in
// static/src/plugins/. Those manifests reference view modules and factory functions by
// string, so a rename breaks the app at click time rather than at import time. These tests
// pin the parity contract and resolve every manifest reference statically.
//
// Run from the repo root with:  node --test 'tests/js/**/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// chat/index.js reads window.markdownit at module scope; index.html provides it through the
// vendored script before app.js runs. Give this module the same minimum so the import works.
globalThis.window = { markdownit: () => ({ renderer: { rules: {} } }) };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(HERE, '..', '..', 'static');

const registry = await import(pathToFileURL(path.join(STATIC, 'src/plugins', 'registry.js')).href);
const { PLUGINS, WORKFLOWS, ROUTE_ALIASES, normalizeRoute, getWorkflow } = registry;

// The shipped sidebar, in order. This is the parity contract: a rename or a dropped view must
// fail here, not silently in the browser.
const EXPECTED_CATEGORIES = [
  ['Realtime Translation', ['replay-translate']],
  ['Realtime TTS', ['replay-speak']],
  ['LLM Pool', ['llm-pool-models', 'text-generation', 'chat']],
  ['TTS Pool', ['tts-pool-models']],
  ['Image Pool', ['image-pool-models', 'image-generation', 'image-lora-library', 'image-train']],
  ['Video Pool', ['video-pool-models', 'video-generation']],
  ['Translation Services', [
    'image-translation',
    'image-translation-regression',
    'pdf-translation',
    'pdf-translation-regression',
    'pdf-testing',
    'pdf-anatomy',
    'prompt-library',
  ]],
];
const EXPECTED_AUXILIARY = ['icons'];
const EXPECTED_ALIASES = new Map([
  ['ad-hoc-prompt', 'text-generation'],
  ['vlm-test', 'text-generation'],
  ['translation-requests', 'image-translation'],
  ['translation-regression', 'image-translation-regression'],
]);
const EXPECTED_PERSISTENT = 19;

test('sidebar plugin list matches the shipped categories', () => {
  const categories = PLUGINS
    .filter((plugin) => !plugin.auxiliary)
    .map((plugin) => [plugin.label, plugin.views.map((view) => view.route)]);
  assert.deepEqual(categories, EXPECTED_CATEGORIES);

  const auxiliary = PLUGINS
    .filter((plugin) => plugin.auxiliary)
    .flatMap((plugin) => plugin.views.map((view) => view.route));
  assert.deepEqual(auxiliary, EXPECTED_AUXILIARY);

  assert.equal(WORKFLOWS.length, 20);
  assert.equal(WORKFLOWS.filter((view) => view.persistent).length, EXPECTED_PERSISTENT);
});

test('every manifest carries the fields the loader reads', () => {
  for (const plugin of PLUGINS) {
    assert.ok(plugin.id, `plugin without id: ${JSON.stringify(plugin)}`);
    assert.ok(Array.isArray(plugin.views) && plugin.views.length > 0, `plugin ${plugin.id}: no views`);
    for (const view of plugin.views) {
      for (const field of ['id', 'route', 'name', 'icon', 'module', 'factory']) {
        assert.ok(view[field], `plugin ${plugin.id} / view ${view.id || '?'}: missing ${field}`);
      }
      assert.ok(
        !view.module.startsWith('/') && !view.module.startsWith('.'),
        `view ${view.route}: module "${view.module}" must be relative to the static root`,
      );
      assert.equal(typeof view.persistent, 'boolean', `view ${view.route}: persistent must be boolean`);
    }
  }
});

test('routes and view ids are unique and do not collide with aliases', () => {
  const routes = WORKFLOWS.map((view) => view.route);
  const ids = WORKFLOWS.map((view) => view.id);
  assert.equal(new Set(routes).size, routes.length, `duplicate route in ${routes}`);
  assert.equal(new Set(ids).size, ids.length, `duplicate view id in ${ids}`);
  for (const alias of ROUTE_ALIASES.keys()) {
    assert.ok(!routes.includes(alias), `alias ${alias} shadows a real route`);
  }
});

test('route aliases resolve to a real view', () => {
  assert.deepEqual(new Map(ROUTE_ALIASES), EXPECTED_ALIASES);
  for (const [alias, target] of EXPECTED_ALIASES) {
    assert.equal(normalizeRoute(alias), target);
    assert.ok(getWorkflow(alias), `alias ${alias} does not resolve to a workflow`);
    assert.ok(getWorkflow(target), `alias target ${target} does not exist`);
  }
});

test('every view module exists and exports its factory', async () => {
  for (const view of WORKFLOWS) {
    const file = path.join(STATIC, view.module);
    assert.ok(existsSync(file), `view ${view.route}: module not found: static/${view.module}`);
    const module = await import(pathToFileURL(file).href);
    assert.equal(
      typeof module[view.factory],
      'function',
      `view ${view.route}: static/${view.module} does not export ${view.factory}()`,
    );
  }
});

test('every view icon exists in the icon sprite', async () => {
  const sprite = await readFile(path.join(STATIC, 'assets', 'icons.svg'), 'utf8');
  const defined = new Set([...sprite.matchAll(/<symbol[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(defined.size > 0, 'no <symbol> ids found in static/assets/icons.svg');
  for (const view of WORKFLOWS) {
    assert.ok(defined.has(view.icon), `view ${view.route}: icon "${view.icon}" is not in icons.svg`);
  }
});
