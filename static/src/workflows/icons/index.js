import { iconMarkup } from '../../shared/icons.js';

const ICON_GROUPS = [
  {
    title: 'Domain workflows',
    icons: [
      { id: 'languages', label: 'Replay & Translate', source: 'Lucide' },
      { id: 'volume-2', label: 'Replay & Speak', source: 'Lucide' },
      { id: 'file-plus', label: 'Text generation', source: 'Lucide' },
      { id: 'messages-square', label: 'Chat', source: 'Lucide' },
      { id: 'image-plus', label: 'Image generation', source: 'Lucide' },
      { id: 'layers-3', label: 'LoRA Library', source: 'Lucide' },
      { id: 'sliders-horizontal', label: 'Tuning', source: 'Lucide' },
      { id: 'video-plus', label: 'Video generation', source: 'Workbench' },
      { id: 'image', label: 'Image translation', source: 'Lucide' },
      { id: 'clipboard-check', label: 'Regression testing', source: 'Lucide' },
      { id: 'book-open-text', label: 'Prompt Library', source: 'Lucide' },
      { id: 'shapes', label: 'Icons', source: 'Lucide' },
    ],
  },
  {
    title: 'Pool family',
    icons: [
      { id: 'pool-llm', label: 'LLM Pool', source: 'Workbench' },
      { id: 'pool-asr', label: 'ASR Pool', source: 'Workbench' },
      { id: 'pool-tts', label: 'TTS Pool', source: 'Workbench' },
      { id: 'pool-image', label: 'Image Pool', source: 'Workbench' },
      { id: 'pool-video', label: 'Video Pool', source: 'Workbench' },
    ],
  },
  {
    title: 'Shared UI',
    icons: [
      { id: 'settings', label: 'Settings', source: 'Lucide' },
      { id: 'search', label: 'Search', source: 'Lucide' },
      { id: 'refresh-cw', label: 'Refresh', source: 'Lucide' },
      { id: 'upload', label: 'Upload', source: 'Lucide' },
      { id: 'download', label: 'Download', source: 'Lucide' },
      { id: 'trash-2', label: 'Delete', source: 'Lucide' },
      { id: 'folder', label: 'Folder', source: 'Lucide' },
      { id: 'copy', label: 'Copy', source: 'Lucide' },
      { id: 'moon', label: 'Dark theme', source: 'Lucide' },
      { id: 'sun', label: 'Light theme', source: 'Lucide' },
      { id: 'camera', label: 'Snapshot', source: 'Lucide' },
      { id: 'workflow', label: 'Workflow', source: 'Lucide' },
    ],
  },
];

function renderStateSample(iconId, state) {
  return `<span class="icons-view-state-sample ${state}">${iconMarkup(iconId)}</span>`;
}

function renderIconRow(icon) {
  return `
    <div class="icons-view-row">
      <div class="icons-view-identity">
        <span class="icons-view-label">${icon.label}</span>
        <code>${icon.id}</code>
        <span class="icons-view-source">${icon.source}</span>
      </div>
      <div class="icons-view-sample icons-view-size-16">${iconMarkup(icon.id)}</div>
      <div class="icons-view-sample icons-view-size-20">${iconMarkup(icon.id)}</div>
      <div class="icons-view-sample icons-view-size-24">${iconMarkup(icon.id)}</div>
      <div class="icons-view-sample">${renderStateSample(icon.id, 'is-active')}</div>
      <div class="icons-view-sample">${renderStateSample(icon.id, 'is-running')}</div>
      <div class="icons-view-sample">${renderStateSample(icon.id, 'is-collapsed')}</div>
    </div>
  `;
}

function renderIconGroup(group) {
  return `
    <section class="icons-view-group">
      <h2>${group.title}</h2>
      <div class="icons-view-matrix">
        <div class="icons-view-row icons-view-header">
          <span>Icon</span>
          <span>16</span>
          <span>20</span>
          <span>24</span>
          <span>Active</span>
          <span>Running</span>
          <span>Collapsed</span>
        </div>
        ${group.icons.map(renderIconRow).join('')}
      </div>
    </section>
  `;
}

export function createIconsView() {
  const container = document.createElement('div');
  container.className = 'icons-view';
  container.innerHTML = `
    <div class="icons-view-content-area">
      <div class="icons-view-pane">
        ${ICON_GROUPS.map(renderIconGroup).join('')}
      </div>
    </div>
  `;
  return container;
}
