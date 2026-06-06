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
import { createImagePoolRequestsView } from './src/workflows/image-pool-requests/index.js';
import { createTranslationPromptsView } from './src/workflows/translation-prompts/index.js';
import { createPromptRunnerView } from './src/workflows/prompt-runner/index.js';
import { createVlmTestView } from './src/workflows/vlm-test/index.js';
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
  'ad-hoc-prompt',
  'vlm-test',
  'tts-pool-models',
  'image-pool-requests',
]);

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
      {
        id: 'prompt-library',
        route: 'prompt-library',
        name: 'Prompt Library',
        icon: 'edit_note',
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
        id: 'ad-hoc-prompt',
        route: 'ad-hoc-prompt',
        name: 'Ad-hoc Prompt',
        icon: 'chat',
      },
      {
        id: 'vlm-test',
        route: 'vlm-test',
        name: 'VLM Test',
        icon: 'image_search',
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
    label: 'Translation Services',
    items: [
      {
        id: 'image-pool-requests',
        route: 'image-pool-requests',
        name: 'Requests',
        icon: 'upload_file',
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
      <li data-route="${wf.route}">
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
    <li data-route="${wf.route}" class="sidebar-route-bottom">
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
  if (workflowId === 'image-pool-requests') {
    return createImagePoolRequestsView();
  }
  if (workflowId === 'prompt-library') {
    return createTranslationPromptsView();
  }
  if (workflowId === 'ad-hoc-prompt') {
    return createPromptRunnerView();
  }
  if (workflowId === 'vlm-test') {
    return createVlmTestView();
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

  const route = item.dataset.route;
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
      const view = hash.trim();
      return router.has(view) ? { view, data: null } : null;
    }
  });

  const hash = window.location.hash.replace(/^#/, '');
  const defaultRoute = WORKFLOWS[0]?.route || 'replay-translate';
  const initialRoute = router.has(hash) ? hash : defaultRoute;

  router.start(initialRoute, null, { url: `#${initialRoute}` });
}

init();
