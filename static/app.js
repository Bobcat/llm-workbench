import {
  RouterCore,
  ShellState,
  createShellPersistence,
  bindMobileSidebarDismiss,
} from './foundation/spa-foundation/index.js';
import { createReplayView } from './src/workflows/replay/index.js';
import { createReplaySpeakView } from './src/workflows/replay-speak/index.js';
import { createLlmPoolView } from './src/workflows/llm-pool/index.js';
import { createTtsPoolView } from './src/workflows/tts-pool/index.js';
import { createImagePoolView } from './src/workflows/image-pool/index.js';
import { createImageTrainView } from './src/workflows/image-train/index.js';
import { createLoraLibraryView } from './src/workflows/lora-library/index.js';
import { createVideoPoolView } from './src/workflows/video-pool/index.js';
import { createTranslationRequestsView } from './src/workflows/translation-requests/index.js';
import { createTranslationPromptsView } from './src/workflows/translation-prompts/index.js';
import { createRegressionView } from './src/workflows/translation-regression/index.js';
import { createTextGenerationView } from './src/workflows/text-generation/index.js';
import { createImageGenerationView } from './src/workflows/image-generation/index.js';
import { createVideoGenerationView } from './src/workflows/video-generation/index.js';
import { createChatView } from './src/workflows/chat/index.js';
import { createIconsView } from './src/workflows/icons/index.js';

// === Initialization ===
const byId = (id) => document.getElementById(id);

const appRoot = byId('appRoot');
const sidebar = byId('sidebar');
const sidebarToggle = byId('sidebarToggle');
const workflowList = byId('workflowList');
const SHELL_STORAGE_KEY = 'llm-workbench.shell';
const initialShell = window.__LLM_WORKBENCH_INITIAL_SHELL__ || {};
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
  'translation-regression',
]);

const ROUTE_ALIASES = new Map([
  ['ad-hoc-prompt', 'text-generation'],
  ['vlm-test', 'text-generation'],
  ['translation-requests', 'image-translation'],
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
  getPreset: () => '',
  getRoundedSidebar: () => false,
});

// === Hardcoded workflow for testing ===
const WORKFLOW_GROUPS = [
  {
    label: 'Realtime Translation',
    items: [
      {
        id: 'replay-translate',
        route: 'replay-translate',
        name: 'Replay & Translate',
        icon: 'translate',
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
        icon: 'record_voice_over',
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
        icon: 'swap_horiz',
      },
      {
        id: 'text-generation',
        route: 'text-generation',
        name: 'Text generation',
        icon: 'chat',
      },
      {
        id: 'chat',
        route: 'chat',
        name: 'Chat',
        icon: 'forum',
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
        icon: 'record_voice_over',
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
        icon: 'image_search',
      },
      {
        id: 'image-generation',
        route: 'image-generation',
        name: 'Image generation',
        icon: 'image',
      },
      {
        id: 'image-lora-library',
        route: 'image-lora-library',
        name: 'LoRA Library',
        icon: 'style',
      },
      {
        id: 'image-train',
        route: 'image-train',
        name: 'Tuning',
        icon: 'model_training',
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
        icon: 'movie',
      },
      {
        id: 'video-generation',
        route: 'video-generation',
        name: 'Video generation',
        icon: 'movie_creation',
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
        icon: 'upload_file',
      },
      {
        id: 'translation-regression',
        route: 'translation-regression',
        name: 'Regression testing',
        icon: 'fact_check',
      },
      {
        id: 'prompt-library',
        route: 'prompt-library',
        name: 'Prompt Library',
        icon: 'edit_note',
      },
    ],
  },
];

const AUXILIARY_WORKFLOWS = [
  {
    id: 'icons',
    route: 'icons',
    name: 'Icons',
    icon: 'apps',
  }
];

const WORKFLOWS = [
  ...WORKFLOW_GROUPS.flatMap((group) => group.items),
  ...AUXILIARY_WORKFLOWS,
];

function renderWorkflows() {
  const groupedMarkup = WORKFLOW_GROUPS.map((group) => {
    const sectionItems = group.items.map((wf) => `
      <li data-route="${wf.route}" data-tooltip="${wf.name}">
        <span class="material-symbols-outlined" aria-hidden="true">${wf.icon}</span>
        <span class="link-text">${wf.name}</span>
      </li>
    `).join('');
    return `
      <li class="sidebar-section-label" aria-hidden="true">${group.label}</li>
      ${sectionItems}
    `;
  }).join('');

  const auxiliaryMarkup = AUXILIARY_WORKFLOWS.map((wf) => `
    <li data-route="${wf.route}" data-tooltip="${wf.name}" class="sidebar-route-bottom">
      <span class="material-symbols-outlined" aria-hidden="true">${wf.icon}</span>
      <span class="link-text">${wf.name}</span>
    </li>
  `).join('');

  workflowList.innerHTML = `${groupedMarkup}${auxiliaryMarkup}`;
}

function updateReplaySidebarState() {
  const replayItem = workflowList.querySelector('[data-route="replay-translate"]');
  if (!replayItem) return;
  replayItem.classList.toggle('is-running', replayIsRunning);
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
  if (workflowId === 'prompt-library') {
    return createTranslationPromptsView();
  }
  if (workflowId === 'translation-regression') {
    return createRegressionView();
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
function updateSidebarUI(isOpen) {
  sidebar.classList.toggle('expanded', isOpen);
  sidebar.classList.toggle('collapsed', !isOpen);
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

// Navigation clicks
workflowList.addEventListener('click', (e) => {
  const item = e.target.closest('[data-route]');
  if (!item) return;

  const route = normalizeRoute(item.dataset.route);
  if (router.has(route)) {
    router.navigate(route, null, { url: `#${route}` });
  }
});

window.addEventListener('llm-workbench:replay-status', (event) => {
  const status = String(event?.detail?.status || 'idle').toLowerCase();
  replayIsRunning = status === 'playing';
  updateReplaySidebarState();
});

// === Bootstrap ===
function init() {
  // Initialize sidebar UI to match state
  updateSidebarUI(shellState.getSnapshot().sidebarOpen);

  bindMobileSidebarDismiss(shellState, sidebar, 600);
  renderWorkflows();
  updateReplaySidebarState();

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
