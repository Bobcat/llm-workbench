import {
  RouterCore,
  ShellState,
  createShellPersistence,
  bindMobileSidebarDismiss,
} from './foundation/spa-foundation/index.js';
import { WORKFLOW_BUSY_EVENT } from './src/shared/workflow-activity.js';
import { createReplayView } from './src/workflows/replay/index.js';
import { createReplaySpeakView } from './src/workflows/replay-speak/index.js';
import { createLlmPoolView } from './src/workflows/llm-pool/index.js';
import { createTtsPoolView } from './src/workflows/tts-pool/index.js';
import { createImagePoolView } from './src/workflows/image-pool/index.js';
import { createImageTrainView } from './src/workflows/image-train/index.js';
import { createLoraLibraryView } from './src/workflows/lora-library/index.js';
import { createVideoPoolView } from './src/workflows/video-pool/index.js';
import { createTranslationRequestsView } from './src/workflows/translation-requests/index.js';
import { createPdfTranslationView } from './src/workflows/pdf-translation/index.js';
import { createPdfTranslationRegressionView } from './src/workflows/pdf-translation-regression/index.js';
import { createPdfTestingView } from './src/workflows/pdf-testing/index.js';
import { createPdfAnatomyView } from './src/workflows/pdf-anatomy/index.js';
import { createTranslationPromptsView } from './src/workflows/translation-prompts/index.js';
import { createImageTranslationRegressionView } from './src/workflows/image-translation-regression/index.js';
import { createTextGenerationView } from './src/workflows/text-generation/index.js';
import { createImageGenerationView } from './src/workflows/image-generation/index.js';
import { createVideoGenerationView } from './src/workflows/video-generation/index.js';
import { createChatView } from './src/workflows/chat/index.js';
import { createIconsView } from './src/workflows/icons/index.js';
import { iconMarkup } from './src/shared/icons.js';

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
let replayIsRunning = false;
const PERSISTENT_WORKFLOW_IDS = new Set([
  'replay-translate',
  'replay-speak',
  'prompt-library',
  'llm-pool-models',
  'text-generation',
  'chat',
  'tts-pool-models',
  'image-pool-models',
  'image-generation',
  'image-lora-library',
  'image-train',
  'video-pool-models',
  'video-generation',
  'image-translation',
  'image-translation-regression',
  'pdf-translation',
  'pdf-translation-regression',
  'pdf-testing',
  'pdf-anatomy',
]);

const ROUTE_ALIASES = new Map([
  ['ad-hoc-prompt', 'text-generation'],
  ['vlm-test', 'text-generation'],
  ['translation-requests', 'image-translation'],
  // Old route from before the image/pdf regression split; keep bookmarks working.
  ['translation-regression', 'image-translation-regression'],
]);

function normalizeRoute(route) {
  const name = String(route || '').trim();
  return ROUTE_ALIASES.get(name) || name;
}

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

// === Hardcoded workflow for testing ===
const WORKFLOW_GROUPS = [
  {
    label: 'Realtime Translation',
    items: [
      {
        id: 'replay-translate',
        route: 'replay-translate',
        name: 'Replay & Translate',
        icon: 'languages',
      },
    ],
  },
  {
    label: 'Realtime TTS',
    items: [
      {
        id: 'replay-speak',
        route: 'replay-speak',
        name: 'Replay & Speak',
        icon: 'volume-2',
      },
    ],
  },
  {
    label: 'LLM Pool',
    items: [
      {
        id: 'llm-pool-models',
        route: 'llm-pool-models',
        name: 'Models',
        tooltip: 'LLM pool models',
        icon: 'pool-llm',
      },
      {
        id: 'text-generation',
        route: 'text-generation',
        name: 'Text generation',
        icon: 'file-plus',
      },
      {
        id: 'chat',
        route: 'chat',
        name: 'Chat',
        icon: 'messages-square',
      },
    ],
  },
  {
    label: 'TTS Pool',
    items: [
      {
        id: 'tts-pool-models',
        route: 'tts-pool-models',
        name: 'Models',
        tooltip: 'TTS pool models',
        icon: 'pool-tts',
      },
    ],
  },
  {
    label: 'Image Pool',
    items: [
      {
        id: 'image-pool-models',
        route: 'image-pool-models',
        name: 'Models',
        tooltip: 'Image pool models',
        icon: 'pool-image',
      },
      {
        id: 'image-generation',
        route: 'image-generation',
        name: 'Image generation',
        icon: 'image-plus',
      },
      {
        id: 'image-lora-library',
        route: 'image-lora-library',
        name: 'LoRA Library',
        icon: 'layers-3',
      },
      {
        id: 'image-train',
        route: 'image-train',
        name: 'Tuning',
        icon: 'sliders-horizontal',
      },
    ],
  },
  {
    label: 'Video Pool',
    items: [
      {
        id: 'video-pool-models',
        route: 'video-pool-models',
        name: 'Models',
        tooltip: 'Video pool models',
        icon: 'pool-video',
      },
      {
        id: 'video-generation',
        route: 'video-generation',
        name: 'Video generation',
        icon: 'video-plus',
      },
    ],
  },
  {
    label: 'Translation Services',
    items: [
      {
        id: 'image-translation',
        route: 'image-translation',
        name: 'Image translation',
        icon: 'image',
      },
      {
        id: 'image-translation-regression',
        route: 'image-translation-regression',
        name: 'Image regression testing',
        icon: 'clipboard-check',
      },
      {
        id: 'pdf-translation',
        route: 'pdf-translation',
        name: 'PDF translation',
        icon: 'file-text',
      },
      {
        id: 'pdf-translation-regression',
        route: 'pdf-translation-regression',
        name: 'PDF regression testing',
        icon: 'clipboard-check',
      },
      {
        id: 'pdf-testing',
        route: 'pdf-testing',
        name: 'PDF benchmark',
        icon: 'gauge',
      },
      {
        id: 'pdf-anatomy',
        route: 'pdf-anatomy',
        name: 'PDF Anatomy',
        icon: 'layers-3',
      },
      {
        id: 'prompt-library',
        route: 'prompt-library',
        name: 'Prompt Library',
        icon: 'book-open-text',
      },
    ],
  },
];

const AUXILIARY_WORKFLOWS = [
  {
    id: 'icons',
    route: 'icons',
    name: 'Icons',
    icon: 'shapes',
  }
];

const WORKFLOWS = [
  ...WORKFLOW_GROUPS.flatMap((group) => group.items),
  ...AUXILIARY_WORKFLOWS,
];

function renderWorkflows() {
  const groupedMarkup = WORKFLOW_GROUPS.map((group) => {
    const sectionItems = group.items.map((wf) => `
      <li data-route="${wf.route}" data-tooltip="${wf.tooltip || wf.name}">
        ${iconMarkup(wf.icon, 'sidebar-icon')}
        <span class="link-text">${wf.name}</span>
      </li>
    `).join('');
    return `
      <li class="sidebar-section-label" aria-hidden="true">${group.label}</li>
      ${sectionItems}
    `;
  }).join('');

  const auxiliaryMarkup = AUXILIARY_WORKFLOWS.map((wf) => `
    <li data-route="${wf.route}" data-tooltip="${wf.tooltip || wf.name}" class="sidebar-route-bottom">
      ${iconMarkup(wf.icon, 'sidebar-icon')}
      <span class="link-text">${wf.name}</span>
    </li>
  `).join('');

  workflowList.innerHTML = `${groupedMarkup}${auxiliaryMarkup}`;
  updateSidebarScrollState();
}

function updateReplaySidebarState() {
  const replayItem = workflowList.querySelector('[data-route="replay-translate"]');
  if (!replayItem) return;
  replayItem.classList.toggle('is-running', replayIsRunning);
}

// Sidebar entries whose view reported work in flight. Held here rather than in the views: the
// indicator has to stay correct while you are looking at another view, and renderWorkflows()
// rebuilds the list markup, so the classes are re-applied from this set afterwards.
const busyWorkflows = new Set();

function updateWorkflowRunningState() {
  workflowList.querySelectorAll('[data-route]').forEach((item) => {
    const route = String(item.dataset.route || '');
    if (route === 'replay-translate') return;  // owns its own signal, below
    item.classList.toggle('is-running', busyWorkflows.has(route));
  });
}

function createWorkflowView(workflowId) {
  if (workflowId === 'replay-translate') {
    return createReplayView();
  }
  if (workflowId === 'replay-speak') {
    return createReplaySpeakView();
  }
  if (workflowId === 'llm-pool-models') {
    return createLlmPoolView();
  }
  if (workflowId === 'tts-pool-models') {
    return createTtsPoolView();
  }
  if (workflowId === 'image-pool-models') {
    return createImagePoolView();
  }
  if (workflowId === 'video-pool-models') {
    return createVideoPoolView();
  }
  if (workflowId === 'image-translation') {
    return createTranslationRequestsView();
  }
  if (workflowId === 'pdf-translation') {
    return createPdfTranslationView();
  }
  if (workflowId === 'pdf-translation-regression') {
    return createPdfTranslationRegressionView();
  }
  if (workflowId === 'pdf-testing') {
    return createPdfTestingView();
  }
  if (workflowId === 'pdf-anatomy') {
    return createPdfAnatomyView();
  }
  if (workflowId === 'prompt-library') {
    return createTranslationPromptsView();
  }
  if (workflowId === 'image-translation-regression') {
    return createImageTranslationRegressionView();
  }
  if (workflowId === 'text-generation') {
    return createTextGenerationView();
  }
  if (workflowId === 'image-generation') {
    return createImageGenerationView();
  }
  if (workflowId === 'video-generation') {
    return createVideoGenerationView();
  }
  if (workflowId === 'image-lora-library') {
    return createLoraLibraryView();
  }
  if (workflowId === 'image-train') {
    return createImageTrainView();
  }
  if (workflowId === 'chat') {
    return createChatView();
  }
  if (workflowId === 'icons') {
    return createIconsView();
  }
  const div = document.createElement('div');
  div.innerHTML = `<h1>Unknown: ${workflowId}</h1>`;
  return div;
}

// === Router Setup ===
const router = new RouterCore(appRoot, {
  onRouteDidMount: ({ to }) => {
    sidebar.querySelectorAll('[data-route]').forEach((item) => {
      const active = item.dataset.route === to.view;
      item.classList.toggle('active', active);
    });
    updateReplaySidebarState();
  }
});

// Register routes
WORKFLOWS.forEach(wf => {
  let cachedView = null;
  let activeView = null;
  router.register(wf.route, {
    mount: (host) => {
      host.innerHTML = '';
      const view = (PERSISTENT_WORKFLOW_IDS.has(wf.id) && cachedView)
        ? cachedView
        : createWorkflowView(wf.id);
      if (PERSISTENT_WORKFLOW_IDS.has(wf.id)) {
        cachedView = view;
      }
      activeView = view;
      host.appendChild(view);
      if (typeof view.__onActivate === 'function') {
        view.__onActivate();
      }
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

window.addEventListener('llm-workbench:replay-status', (event) => {
  const status = String(event?.detail?.status || 'idle').toLowerCase();
  replayIsRunning = status === 'playing';
  updateReplaySidebarState();
});

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
  renderWorkflows();
  updateReplaySidebarState();
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
