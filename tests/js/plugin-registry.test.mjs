// Guards the frontend plugin contract.
//
// The sidebar, routes and lazy view loader are derived from the manifests in
// static/src/plugins/. Those manifests reference view modules and factory functions by
// string, so a rename breaks the app at click time rather than at import time. These tests
// pin the shipped sidebar field by field and resolve every manifest reference statically.
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

// The shipped sidebar, in order. This is a regression pin, not a comparison against the old
// hardcoded structure: a rename, a reordered or dropped view, a swapped icon, a changed tooltip
// or a flipped `persistent` flag must fail here rather than silently change the app.
const EXPECTED_CATEGORIES = [
  ['Realtime Translation', [
    { id: 'replay-translate', route: 'replay-translate', name: 'Replay & Translate', icon: 'languages', persistent: true },
  ]],
  ['Realtime TTS', [
    { id: 'replay-speak', route: 'replay-speak', name: 'Replay & Speak', icon: 'volume-2', persistent: true },
  ]],
  ['LLM Pool', [
    { id: 'llm-pool-models', route: 'llm-pool-models', name: 'Models', icon: 'pool-llm', persistent: true, tooltip: 'LLM pool models' },
    { id: 'text-generation', route: 'text-generation', name: 'Text generation', icon: 'file-plus', persistent: true },
    { id: 'chat', route: 'chat', name: 'Chat', icon: 'messages-square', persistent: true },
  ]],
  ['TTS Pool', [
    { id: 'tts-pool-models', route: 'tts-pool-models', name: 'Models', icon: 'pool-tts', persistent: true, tooltip: 'TTS pool models' },
  ]],
  ['Image Pool', [
    { id: 'image-pool-models', route: 'image-pool-models', name: 'Models', icon: 'pool-image', persistent: true, tooltip: 'Image pool models' },
    { id: 'image-generation', route: 'image-generation', name: 'Image generation', icon: 'image-plus', persistent: true },
    { id: 'image-lora-library', route: 'image-lora-library', name: 'LoRA Library', icon: 'layers-3', persistent: true },
    { id: 'image-train', route: 'image-train', name: 'Tuning', icon: 'sliders-horizontal', persistent: true },
  ]],
  ['Video Pool', [
    { id: 'video-pool-models', route: 'video-pool-models', name: 'Models', icon: 'pool-video', persistent: true, tooltip: 'Video pool models' },
    { id: 'video-generation', route: 'video-generation', name: 'Video generation', icon: 'video-plus', persistent: true },
  ]],
  ['Translation Services', [
    { id: 'image-translation', route: 'image-translation', name: 'Image translation', icon: 'image', persistent: true },
    { id: 'image-translation-regression', route: 'image-translation-regression', name: 'Image regression testing', icon: 'clipboard-check', persistent: true },
    { id: 'pdf-translation', route: 'pdf-translation', name: 'PDF translation', icon: 'file-text', persistent: true },
    { id: 'pdf-translation-regression', route: 'pdf-translation-regression', name: 'PDF regression testing', icon: 'clipboard-check', persistent: true },
    { id: 'pdf-testing', route: 'pdf-testing', name: 'PDF benchmark', icon: 'gauge', persistent: true },
    { id: 'pdf-anatomy', route: 'pdf-anatomy', name: 'PDF anatomy', icon: 'venetian-mask', persistent: true },
    { id: 'prompt-library', route: 'prompt-library', name: 'Prompt Library', icon: 'book-open-text', persistent: true },
  ]],
];
const EXPECTED_AUXILIARY = [
  { id: 'icons', route: 'icons', name: 'Icons', icon: 'shapes', persistent: false },
];
const EXPECTED_ALIASES = new Map([
  ['ad-hoc-prompt', 'text-generation'],
  ['vlm-test', 'text-generation'],
  ['translation-requests', 'image-translation'],
  ['translation-regression', 'image-translation-regression'],
]);

// Only the fields a user can see, plus the ids the loader and future settings key on.
function viewShape(view) {
  const shape = {
    id: view.id,
    route: view.route,
    name: view.name,
    icon: view.icon,
    persistent: view.persistent,
  };
  if (view.tooltip) shape.tooltip = view.tooltip;
  return shape;
}

test('sidebar categories and their views match the shipped sidebar', () => {
  const categories = PLUGINS
    .filter((plugin) => !plugin.auxiliary)
    .map((plugin) => [plugin.label, plugin.views.map(viewShape)]);
  assert.deepEqual(categories, EXPECTED_CATEGORIES);

  const auxiliary = PLUGINS
    .filter((plugin) => plugin.auxiliary)
    .flatMap((plugin) => plugin.views.map(viewShape));
  assert.deepEqual(auxiliary, EXPECTED_AUXILIARY);

  assert.equal(WORKFLOWS.length, 20);
  const persistent = new Set(WORKFLOWS.filter((view) => view.persistent).map((view) => view.route));
  assert.deepEqual(
    [...persistent],
    WORKFLOWS.filter((view) => view.route !== 'icons').map((view) => view.route),
    'the persistent set must be every view except the auxiliary icons view',
  );
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
