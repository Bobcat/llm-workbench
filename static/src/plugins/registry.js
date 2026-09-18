// Plugin registry — the single place that knows which sidebar categories and workflow views
// exist.
//
// A plugin owns one sidebar category (or, with `auxiliary: true`, one standalone item at the
// bottom) and contributes one or more views. Views are loaded lazily from their module URL, so
// a plugin only costs a network request when the user opens one of its views.
//
// The manifest shape is deliberately data-only — strings, booleans, and arrays, no imported
// functions. That keeps the door open for serving the same payload from the backend later
// (a plugin list endpoint) without touching this loader: only the source of PLUGINS changes.
//
// Plugin fields:
//   id          stable plugin id, equal to the folder name
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
//   persistent  keep the mounted view alive while navigating away
//   module      module path under the static root, resolved against the document base
//   factory     exported factory name in that module; returns the view element
import realtimeTranslation from './realtime-translation/manifest.js';
import realtimeTts from './realtime-tts/manifest.js';
import llmPool from './llm-pool/manifest.js';
import ttsPool from './tts-pool/manifest.js';
import imagePool from './image-pool/manifest.js';
import videoPool from './video-pool/manifest.js';
import translationServices from './translation-services/manifest.js';
import developer from './developer/manifest.js';

export const PLUGINS = [
  realtimeTranslation,
  realtimeTts,
  llmPool,
  ttsPool,
  imagePool,
  videoPool,
  translationServices,
  developer,
];

// Retired route names stay reachable so existing bookmarks keep working.
export const ROUTE_ALIASES = new Map([
  ['ad-hoc-prompt', 'text-generation'],
  ['vlm-test', 'text-generation'],
  ['translation-requests', 'image-translation'],
  // Old route from before the image/pdf regression split.
  ['translation-regression', 'image-translation-regression'],
]);

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
