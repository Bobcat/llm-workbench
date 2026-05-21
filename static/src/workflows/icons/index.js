const ICON_GROUPS = [
  {
    title: 'Replay & Translate',
    current: 'translate',
    icons: ['translate', 'play_circle', 'subtitles', 'queue_play_next', 'sync_alt', 'movie'],
  },
  {
    title: 'Translation prompt library',
    current: 'edit_note',
    icons: ['edit_note', 'chat', 'description', 'notes', 'tune', 'auto_fix_high'],
  },
  {
    title: 'LLM pool admin',
    current: 'swap_horiz',
    icons: ['storage', 'swap_horiz', 'sync_alt', 'input', 'output', 'unarchive', 'move_to_inbox'],
  },
];

function renderIconOption(iconName, currentIcon) {
  const isCurrent = iconName === currentIcon;
  return `
    <div class="icons-view-option${isCurrent ? ' is-current' : ''}">
      <span class="material-symbols-outlined icons-view-option-glyph" aria-hidden="true">${iconName}</span>
      <span class="icons-view-option-name">${iconName}</span>
      ${isCurrent ? '<span class="icons-view-option-badge">Current</span>' : ''}
    </div>
  `;
}

function renderIconGroup(group) {
  return `
    <section class="icons-view-group">
      <div class="icons-view-group-header">
        <h2>${group.title}</h2>
      </div>
      <div class="icons-view-grid">
        ${group.icons.map((iconName) => renderIconOption(iconName, group.current)).join('')}
      </div>
    </section>
  `;
}

export function createIconsView() {
  const container = document.createElement('div');
  container.className = 'icons-view';

  container.innerHTML = `
    <div class="icons-view-shell">
      <div class="icons-view-content-area">
        <section class="icons-view-pane">
          ${ICON_GROUPS.map(renderIconGroup).join('')}
        </section>
      </div>
    </div>
  `;

  return container;
}
