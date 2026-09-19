// Plugin registry — turns the plugin list the backend generated into the sidebar, the route
// table and a lazy view loader.
//
// The list itself lives in `app/plugins.py` and reaches the browser as `window.<GLOBAL>`, served
// at `/plugins.js` and loaded with a blocking script tag in static/index.html before this module
// runs. Python is the source of truth because it is also what mounts the routers, so the route
// table and the sidebar cannot drift apart.
//
// The payload is deliberately data-only — strings, booleans and arrays, no functions.
//
// Plugin fields:
//   id          stable plugin id
//   label       sidebar section label; empty for auxiliary plugins
//   auxiliary   true => rendered as a standalone item at the bottom of the sidebar
//   views       view descriptors, in sidebar order
//
// View fields:
//   id          stable view id
//   route       hash route name
//   name        sidebar label
//   icon        symbol id in static/assets/icons.svg
//   tooltip     optional sidebar tooltip; defaults to `name`
//   aliases     retired route names that resolve to this view
//   persistent  keep the mounted view alive while navigating away
//   module      module path under the static root, resolved against the document base
//   factory     exported factory name in that module; returns the view element
const PLUGIN_GLOBAL = '__LLM_WORKBENCH_PLUGINS__';

const payload = globalThis[PLUGIN_GLOBAL];
if (!Array.isArray(payload)) {
  throw new Error(
    `Plugin list missing: globalThis.${PLUGIN_GLOBAL} is not set. static/index.html loads the `
    + 'generated /plugins.js before this module; if you are importing this outside a browser, '
    + 'stub that global first.',
  );
}

export const PLUGINS = payload;

// Retired route names stay reachable so existing bookmarks keep working. They travel with the
// view that replaced them, so disabling a plugin also retires its aliases.
export const ROUTE_ALIASES = new Map(
  PLUGINS.flatMap((plugin) => plugin.views.flatMap(
    (view) => (view.aliases || []).map((alias) => [alias, view.route]),
  )),
);

export const WORKFLOWS = PLUGINS.flatMap((plugin) => plugin.views);

const WORKFLOWS_BY_ROUTE = new Map(WORKFLOWS.map((view) => [view.route, view]));

export function normalizeRoute(route) {
  const name = String(route || '').trim();
  return ROUTE_ALIASES.get(name) || name;
}

export function getWorkflow(route) {
  return WORKFLOWS_BY_ROUTE.get(normalizeRoute(route)) || null;
}

// Load and construct one view. The module URL is resolved against document.baseURI so the
// registry keeps working if the app is ever served from a subpath.
//
// `retry` is a failed-attempt counter. A browser memoises a failed dynamic import in its module
// map, so re-importing the same URL rejects again without touching the network; a changed query
// string is a different URL and therefore a real request.
export async function loadView(route, { retry = 0 } = {}) {
  const workflow = getWorkflow(route);
  if (!workflow) throw new Error(`Unknown workflow: ${route}`);

  const moduleUrl = new URL(workflow.module, document.baseURI);
  if (retry > 0) moduleUrl.searchParams.set('retry', String(retry));

  let module;
  try {
    module = await import(moduleUrl.href);
  } catch (error) {
    // The module never evaluated, so a later attempt with a fresh URL may still succeed. The
    // factory check below is deterministic and stays non-retryable.
    if (error && typeof error === 'object') error.retryable = true;
    throw error;
  }

  const factory = module[workflow.factory];
  if (typeof factory !== 'function') {
    throw new Error(
      `Workflow ${workflow.route}: ${workflow.module} does not export ${workflow.factory}()`,
    );
  }
  return factory();
}
