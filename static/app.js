import {
  RouterCore,
  ShellState,
  createShellPersistence,
  bindMobileSidebarDismiss,
} from './foundation/spa-foundation/index.js';
import { WORKFLOW_BUSY_EVENT } from './src/shared/workflow-activity.js';
import { PLUGINS, WORKFLOWS, loadView, normalizeRoute, pluginLoadError } from './src/plugins/registry.js';
import { iconMarkup } from './src/shared/icons.js';
import { escapeAttr, escapeHtml } from './src/shared/ui-helpers.js';

// === Initialization ===
const byId = (id) => document.getElementById(id);

const appRoot = byId('appRoot');
const sidebar = byId('sidebar');
const sidebarToggle = byId('sidebarToggle');
const workflowList = byId('workflowList');
const presetStylesheet = byId('presetStylesheet');
const themeToggle = byId('themeToggle');
const themeToggleIcon = byId('themeToggleIcon').querySelector('use');
const themeToggleLabel = byId('themeToggleLabel');
const sidebarTooltip = document.createElement('div');
sidebarTooltip.className = 'sidebar-tooltip';
sidebarTooltip.hidden = true;
sidebarTooltip.setAttribute('role', 'tooltip');
document.body.append(sidebarTooltip);
const SHELL_STORAGE_KEY = 'llm-workbench.shell';
const initialShell = window.__LLM_WORKBENCH_INITIAL_SHELL__ || {};
let activePreset = initialShell.preset === 'dark' ? 'dark' : 'modern';

// State - start met open sidebar
const shellState = new ShellState({
  sidebarOpen: typeof initialShell.sidebarOpen === 'boolean' ? initialShell.sidebarOpen : true,
});
const shellPersistence = createShellPersistence({
  storageKey: SHELL_STORAGE_KEY,
  shellState,
  getPreset: () => activePreset,
  getRoundedSidebar: () => false,
});

function applyPreset(preset) {
  activePreset = preset === 'dark' ? 'dark' : 'modern';
  const dark = activePreset === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  presetStylesheet.href = dark
    ? presetStylesheet.dataset.darkHref
    : presetStylesheet.dataset.modernHref;
  const themeAction = dark ? 'Light theme' : 'Dark theme';
  themeToggleIcon.setAttribute('href', `assets/icons.svg#${dark ? 'sun' : 'moon'}`);
  themeToggleLabel.textContent = themeAction;
  themeToggle.setAttribute('aria-label', themeAction);
  themeToggle.title = themeAction;
}

// === Sidebar / plugin rendering ===
// The sidebar is derived from the plugin registry (static/src/plugins/). Categories render in
// registry order; auxiliary plugins render as standalone items at the bottom.
// Everything here comes from the plugin list, and since phase 5 that list can carry data from an
// installed package, so the values are escaped instead of interpolated raw.
function pluginItemMarkup(wf, extraClass = '') {
  const className = extraClass ? ` class="${extraClass}"` : '';
  return `
      <li data-route="${escapeAttr(wf.route)}" data-tooltip="${escapeAttr(wf.tooltip || wf.name)}"${className}>
        ${iconMarkup(wf.icon, 'sidebar-icon')}
        <span class="link-text">${escapeHtml(wf.name)}</span>
      </li>
    `;
}

function renderWorkflows() {
  const groupedMarkup = PLUGINS
    .filter((plugin) => !plugin.auxiliary)
    .map((plugin) => {
      const sectionItems = plugin.views.map((wf) => pluginItemMarkup(wf)).join('');
      return `
      <li class="sidebar-section-label" aria-hidden="true">${escapeHtml(plugin.label)}</li>
      ${sectionItems}
    `;
    })
    .join('');

  const auxiliaryMarkup = PLUGINS
    .filter((plugin) => plugin.auxiliary)
    .flatMap((plugin) => plugin.views)
    .map((wf) => pluginItemMarkup(wf, 'sidebar-route-bottom'))
    .join('');

  workflowList.innerHTML = `${groupedMarkup}${auxiliaryMarkup}`;
  updateSidebarScrollState();
}

// A plugin from an installed package can bring its own stylesheet. Loaded once per path, for the
// plugins that are in the menu; the paths are relative, so they resolve like the view modules do.
function applyPluginStyles(plugins) {
  const loaded = new Set(
    [...document.querySelectorAll('link[data-plugin-style]')].map((link) => link.dataset.pluginStyle),
  );
  plugins.forEach((plugin) => {
    (plugin.styles || []).forEach((style) => {
      const path = String(style || '');
      // The core refuses a path outside the plugin's own mount; this is the same guard on the one
      // field that reaches the page through the DOM API instead of through markup.
      if (!path || loaded.has(path) || path.split('/').includes('..') || /[%\\]/.test(path)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL(path, document.baseURI).href;
      link.dataset.pluginStyle = path;
      document.head.append(link);
      loaded.add(path);
    });
  });
}

// Sidebar entries whose view reported work in flight. Held here rather than in the views: the
// indicator has to stay correct while you are looking at another view, and renderWorkflows()
// rebuilds the list markup, so the classes are re-applied from this set afterwards.
const busyWorkflows = new Set();

function updateWorkflowRunningState() {
  workflowList.querySelectorAll('[data-route]').forEach((item) => {
    const route = String(item.dataset.route || '');
    item.classList.toggle('is-running', busyWorkflows.has(route));
  });
}

// === Router Setup ===
const router = new RouterCore(appRoot, {
  onRouteDidMount: ({ to }) => {
    sidebar.querySelectorAll('[data-route]').forEach((item) => {
      const active = item.dataset.route === to.view;
      item.classList.toggle('active', active);
    });
  }
});

// A view module is fetched on first activation. Four things guard that:
//   - an in-flight load is shared, so navigating away and back does not build the view twice;
//   - a generation counter discards a load that resolves after a newer navigation;
//   - a failed load renders a visible error instead of leaving the host empty, because
//     RouterCore ignores the promise mount() returns;
//   - a failed load is retried on the next activation with a fresh module URL.
let mountGeneration = 0;

function buildErrorPanel(title, detail) {
  const panel = document.createElement('div');
  panel.className = 'workflow-error';
  const titleEl = document.createElement('p');
  titleEl.className = 'workflow-error-title';
  titleEl.textContent = title;
  const detailEl = document.createElement('p');
  detailEl.className = 'workflow-error-detail';
  detailEl.textContent = detail;
  panel.append(titleEl, detailEl);
  return panel;
}

function buildViewError(wf, error) {
  return buildErrorPanel(
    `Could not load the "${wf.name}" view`,
    `${wf.module} -> ${wf.factory}()\n${error?.message || String(error)}`,
  );
}

WORKFLOWS.forEach((wf) => {
  let cachedView = null;
  let pendingView = null;
  let activeView = null;
  let failedLoads = 0;

  function obtainView() {
    if (!pendingView) {
      pendingView = loadView(wf.route, { retry: failedLoads })
        .then((view) => {
          if (wf.persistent) cachedView = view;
          return view;
        })
        .catch((error) => {
          // Only a module that never loaded is worth a fresh URL next time; a manifest that names
          // the wrong factory fails identically forever and would refetch on every visit.
          if (error?.retryable) failedLoads += 1;
          throw error;
        })
        .finally(() => {
          pendingView = null;
        });
    }
    return pendingView;
  }

  function activate(host, view) {
    activeView = view;
    host.appendChild(view);
    if (typeof view.__onActivate === 'function') {
      view.__onActivate();
    }
  }

  router.register(wf.route, {
    mount: (host) => {
      const generation = ++mountGeneration;
      host.innerHTML = '';

      // A cached view mounts synchronously; only a cold view needs the placeholder. That
      // placeholder is usually gone before the next paint, but a non-persistent view whose
      // module still has to be fetched can keep it on screen for a frame.
      if (wf.persistent && cachedView) {
        activate(host, cachedView);
        return;
      }

      const placeholder = document.createElement('div');
      placeholder.className = 'workflow-loading';
      placeholder.textContent = `Loading ${wf.name}…`;
      host.appendChild(placeholder);

      return obtainView().then(
        (view) => {
          if (generation !== mountGeneration) {
            // Normal: the user navigated on while the module was still loading.
            console.debug(`Workflow ${wf.route}: discarded a view that loaded after navigation.`);
            return;
          }
          host.innerHTML = '';
          activate(host, view);
        },
        (error) => {
          if (generation !== mountGeneration) {
            console.error(`Workflow ${wf.route}: view load failed after navigation.`, error);
            return;
          }
          host.innerHTML = '';
          host.appendChild(buildViewError(wf, error));
        },
      );
    },
    unmount: () => {
      if (activeView && typeof activeView.__onDeactivate === 'function') {
        activeView.__onDeactivate();
      }
    },
  });
});

// === Sidebar Interactions ===
// When the nav list overflows vertically its scrollbar eats into the collapsed
// sidebar's fixed width and clips the centred icons. Flag the overflow and hand
// the measured scrollbar width to CSS so the collapsed rail can widen to match.
function updateSidebarScrollState() {
  const overflowing = workflowList.scrollHeight > workflowList.clientHeight;
  const scrollbarWidth = workflowList.offsetWidth - workflowList.clientWidth;
  sidebar.classList.toggle('has-scroll', overflowing);
  sidebar.style.setProperty('--sidebar-scrollbar-width', `${scrollbarWidth}px`);
}

function updateSidebarUI(isOpen) {
  sidebar.classList.toggle('expanded', isOpen);
  sidebar.classList.toggle('collapsed', !isOpen);
  sidebarTooltip.hidden = true;
  updateSidebarScrollState();
}

// Subscribe to state changes
shellState.subscribe(({ next }) => {
  updateSidebarUI(next.sidebarOpen);
  shellPersistence.save();
});

// Toggle click handler
sidebarToggle.addEventListener('click', () => {
  shellState.toggleSidebar('app.sidebarToggle');
});

themeToggle.addEventListener('click', () => {
  applyPreset(activePreset === 'dark' ? 'modern' : 'dark');
  shellPersistence.save();
});

// Navigation clicks
workflowList.addEventListener('click', (e) => {
  const item = e.target.closest('[data-route]');
  if (!item) return;

  const route = normalizeRoute(item.dataset.route);
  if (router.has(route)) {
    router.navigate(route, null, { url: `#${route}` });
  }
});

workflowList.addEventListener('pointerover', (event) => {
  const item = event.target.closest('[data-tooltip]');
  if (!item || item.contains(event.relatedTarget) || sidebar.classList.contains('expanded')) return;
  const itemRect = item.getBoundingClientRect();
  sidebarTooltip.textContent = item.dataset.tooltip;
  sidebarTooltip.hidden = false;
  const tooltipRect = sidebarTooltip.getBoundingClientRect();
  sidebarTooltip.style.left = `${itemRect.right + 10}px`;
  sidebarTooltip.style.top = `${Math.min(
    Math.max(8, itemRect.top + (itemRect.height - tooltipRect.height) / 2),
    window.innerHeight - tooltipRect.height - 8,
  )}px`;
});

workflowList.addEventListener('pointerout', (event) => {
  const item = event.target.closest('[data-tooltip]');
  if (!item || item.contains(event.relatedTarget)) return;
  sidebarTooltip.hidden = true;
});

workflowList.addEventListener('scroll', () => {
  sidebarTooltip.hidden = true;
});

window.addEventListener('resize', updateSidebarScrollState);

window.addEventListener(WORKFLOW_BUSY_EVENT, (event) => {
  const workflow = String(event?.detail?.workflow || '');
  if (!workflow) return;
  if (event.detail.busy) busyWorkflows.add(workflow);
  else busyWorkflows.delete(workflow);
  updateWorkflowRunningState();
});

// === Bootstrap ===
function init() {
  // Initialize sidebar UI to match state
  updateSidebarUI(shellState.getSnapshot().sidebarOpen);
  applyPreset(activePreset);

  bindMobileSidebarDismiss(shellState, sidebar, 600);

  // Without the generated plugin list there is no sidebar to render and no route to open, and
  // the shell is already visible by now. Say why, and say what the reader can do about it — a
  // technical message alone is written for whoever debugs this, not for whoever hits it.
  if (pluginLoadError) {
    appRoot.append(buildErrorPanel(
      'Could not load the plugin list',
      'Reload the page. If the list still does not arrive, check that the workbench server is '
      + 'running, and check plugins.enabled in config/settings.json (or config/local.json): a '
      + 'category id that does not exist makes /plugins.js fail, and the server log names the file.'
      + '\n\n'
      + pluginLoadError.message,
    ));
    return;
  }

  applyPluginStyles(PLUGINS);
  renderWorkflows();
  updateWorkflowRunningState();  // renderWorkflows() rebuilt the markup: re-apply from the set

  router.bindPopState({
    parseHash: ({ hash }) => {
      const view = normalizeRoute(hash);
      return router.has(view) ? { view, data: null } : null;
    }
  });

  const hash = window.location.hash.replace(/^#/, '');
  const defaultRoute = WORKFLOWS[0]?.route || 'replay-translate';
  const normalizedHash = normalizeRoute(hash);
  const initialRoute = router.has(normalizedHash) ? normalizedHash : defaultRoute;

  router.start(initialRoute, null, { url: `#${initialRoute}` });
}

init();
