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
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
const payload = JSON.parse(execFileSync(
  pythonExecutable(),
  ['-c', 'import json; from app.plugins import frontend_payload; print(json.dumps(frontend_payload()))'],
  { cwd: REPO_ROOT, encoding: 'utf8' },
));
globalThis.__LLM_WORKBENCH_PLUGINS__ = payload;

const registry = await import(pathToFileURL(REGISTRY).href);
const { PLUGINS, WORKFLOWS, ROUTE_ALIASES } = registry;

test('the registry reads the payload Python generated', () => {
  assert.ok(Array.isArray(PLUGINS) && PLUGINS.length > 0, 'no plugins in the payload');
  assert.equal(WORKFLOWS.length, payload.flatMap((plugin) => plugin.views).length);
  assert.ok(ROUTE_ALIASES.size > 0, 'no aliases in the payload');
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

test('importing the registry without the generated global fails loudly', () => {
  // Without /plugins.js the sidebar has nothing to render. That has to be a clear error rather
  // than a silently empty sidebar, so the guard itself is pinned here.
  let failure = null;
  try {
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `globalThis.window = {}; await import(${JSON.stringify(pathToFileURL(REGISTRY).href)});`,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'importing the registry without the global unexpectedly succeeded');
  assert.match(
    String(failure.stderr),
    /__LLM_WORKBENCH_PLUGINS__/,
    'the failure does not name the missing global',
  );
});
