// Guards what only a browser-side test can guard about the plugin contract.
//
// The plugin list itself lives in app/plugins.py and reaches the browser as the global that
// /plugins.js sets. Python owns the pin on its contents (tests/test_plugin_registry.py); this
// suite covers the half that needs a real ES module: that every view module resolves, exports
// the named factory, and that every icon exists in the sprite. It also pins the guard that makes
// a missing /plugins.js fail loudly instead of rendering an empty sidebar.
//
// Run from the repo root with:  node --test 'tests/js/**/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// chat/index.js reads window.markdownit at module scope; index.html provides it through the
// vendored script before app.js runs. Give this module the same minimum so the import works.
globalThis.window = { markdownit: () => ({ renderer: { rules: {} } }) };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const STATIC = path.join(REPO_ROOT, 'static');
const REGISTRY = path.join(STATIC, 'src', 'plugins', 'registry.js');

function pythonExecutable() {
  for (const candidate of [path.join(REPO_ROOT, '.venv', 'bin', 'python'), 'python3']) {
    try {
      execFileSync(candidate, ['-c', ''], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('no python interpreter found to read the plugin list from app/plugins.py');
}

// The same payload /plugins.js is generated from, so this suite never keeps a second copy of the
// sidebar. If Python cannot answer, that is a failure, not a skip.
//
// The payload comes from a copy of config/settings.json with nothing beside it: a machine can
// switch categories off in config/local.json, and this suite has to cover the shipped list on
// every machine. A restricted install is a normal install, not a broken one.
const SHIPPED_SETTINGS_DIR = mkdtempSync(path.join(tmpdir(), 'llm-workbench-plugins-'));
const SHIPPED_SETTINGS = path.join(SHIPPED_SETTINGS_DIR, 'settings.json');
copyFileSync(path.join(REPO_ROOT, 'config', 'settings.json'), SHIPPED_SETTINGS);
process.on('exit', () => rmSync(SHIPPED_SETTINGS_DIR, { recursive: true, force: true }));

const payload = JSON.parse(execFileSync(
  pythonExecutable(),
  [
    '-c',
    'import json, sys; from app.plugins import frontend_payload;'
    + ' print(json.dumps(frontend_payload(sys.argv[1])))',
    SHIPPED_SETTINGS,
  ],
  { cwd: REPO_ROOT, encoding: 'utf8' },
));
globalThis.__LLM_WORKBENCH_PLUGINS__ = payload;

const registry = await import(pathToFileURL(REGISTRY).href);
const { PLUGINS, WORKFLOWS, ROUTE_ALIASES } = registry;

test('the registry reads the payload Python generated', () => {
  assert.ok(Array.isArray(PLUGINS) && PLUGINS.length > 0, 'no plugins in the payload');
  assert.equal(WORKFLOWS.length, payload.flatMap((plugin) => plugin.views).length);
  const expected = payload.flatMap((plugin) => plugin.views.flatMap(
    (view) => (view.aliases || []).map((alias) => [alias, view.route]),
  ));
  assert.deepEqual(
    [...ROUTE_ALIASES].sort(),
    expected.sort(),
    'the alias table does not match the payload',
  );
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
    // A path icon is a file of the plugin itself; the Python suite checks that it exists.
    if (view.icon.includes('/')) continue;
    assert.ok(defined.has(view.icon), `view ${view.route}: icon "${view.icon}" is not in icons.svg`);
  }
});

test('an icon is a sprite symbol or a file of the plugin itself', async () => {
  // A package serves its icon from plugin-static/<id>/, a built-in plugin keeps it in src/plugins/<id>/.
  // Anything else, and anything that climbs out of that folder, is refused instead of rendered.
  const script = [
    'globalThis.document = { baseURI: "http://workbench.test/" };',
    `const { iconMarkup } = await import(${JSON.stringify(pathToFileURL(path.join(STATIC, 'src', 'shared', 'icons.js')).href)});`,
    'const out = {};',
    'for (const value of [',
    '  "languages",',
    '  "plugin-static/mine/icon.svg",',
    '  "src/plugins/image-pool/icon.svg",',
    '  "plugin-static/mine/../../assets/icons.svg",',
    '  "src/plugins/mine/../../assets/icons.svg",',
    '  "https://evil.example/x.svg",',
    ']) {',
    '  try { out[value] = iconMarkup(value); } catch (error) { out[value] = `gooit: ${error.message}`; }',
    '}',
    'console.log(JSON.stringify(out));',
  ].join('\n');

  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const out = JSON.parse(output.trim().split('\n').pop());

  assert.match(out.languages, /<svg/, 'a sprite symbol should stay an svg');
  assert.equal(
    out['plugin-static/mine/icon.svg'],
    '<img class="app-icon" src="http://workbench.test/plugin-static/mine/icon.svg" alt="">',
  );
  assert.equal(
    out['src/plugins/image-pool/icon.svg'],
    '<img class="app-icon" src="http://workbench.test/src/plugins/image-pool/icon.svg" alt="">',
  );
  for (const escaping of [
    'plugin-static/mine/../../assets/icons.svg',
    'src/plugins/mine/../../assets/icons.svg',
    'https://evil.example/x.svg',
  ]) {
    assert.match(out[escaping], /^gooit:/, `${escaping} should be refused`);
  }
});

test('a plugin asset path is its own folder, never someone else\'s and never an url', async () => {
  const script = [
    `const { isPluginAssetPath } = await import(${JSON.stringify(pathToFileURL(path.join(STATIC, 'src', 'shared', 'plugin-assets.js')).href)});`,
    'const out = {};',
    'for (const value of [',
    '  "src/plugins/llm-pool/icon.svg",',
    '  "src/plugins/llm-pool/theme.css",',
    '  "plugin-static/mine/icon.svg",',
    '  "https://evil.example/x.css",',
    '  "//evil.example/x.css",',
    '  "/etc/x.css",',
    '  "src/workflows/chat/x.css",',
    '  "src/plugins/llm-pool/../../assets/icons.svg",',
    '  "src/plugins/llm-pool/%2e%2e/x.svg",',
    '  "src/plugins/llm-pool/..\\\\x.svg",',
    '  "src/plugins//icon.svg",',
    '  "src/plugins/llm-pool/",',
    '  "languages",',
    ']) { out[value] = isPluginAssetPath(value); }',
    'console.log(JSON.stringify(out));',
  ].join('\n');

  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const out = JSON.parse(output.trim().split('\n').pop());

  for (const allowed of [
    'src/plugins/llm-pool/icon.svg',
    'src/plugins/llm-pool/theme.css',
    'plugin-static/mine/icon.svg',
  ]) {
    assert.equal(out[allowed], true, `${allowed} should be a plugin asset path`);
  }
  for (const refused of [
    'https://evil.example/x.css',
    '//evil.example/x.css',
    '/etc/x.css',
    'src/workflows/chat/x.css',
    'src/plugins/llm-pool/../../assets/icons.svg',
    'src/plugins/llm-pool/%2e%2e/x.svg',
    'src/plugins/llm-pool/..\\x.svg',
    'src/plugins//icon.svg',
    'src/plugins/llm-pool/',
    'languages',
  ]) {
    assert.equal(out[refused], false, `${refused} should be refused`);
  }
});

test('a missing generated global is reported, not thrown', () => {
  // app.js has to keep running to be able to show this, so the module reports the problem
  // instead of throwing at import time. The browser check covers that the report reaches the
  // screen; this covers that the module still loads and says what is wrong.
  const script = [
    'globalThis.window = {};',
    `const registry = await import(${JSON.stringify(pathToFileURL(REGISTRY).href)});`,
    'console.log(JSON.stringify({',
    '  plugins: registry.PLUGINS.length,',
    '  error: registry.pluginLoadError ? registry.pluginLoadError.message : null,',
    '}));',
  ].join('\n');

  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const result = JSON.parse(output.trim().split('\n').pop());

  assert.equal(result.plugins, 0, 'PLUGINS should be empty without the global');
  assert.match(
    String(result.error),
    /__LLM_WORKBENCH_PLUGINS__/,
    'the report does not name the missing global',
  );
});
