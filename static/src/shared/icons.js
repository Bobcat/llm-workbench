import { escapeAttr } from './ui-helpers.js';

const ICON_NAME_PATTERN = /^[a-z0-9-]+$/;
// A plugin's own icon: a relative path under its own mount, next to its views. Anything else is a
// sprite symbol, and that allowlist is what kept this value safe in markup until now.
const PLUGIN_ICON_PATTERN = /^plugin-static\/[a-z0-9-]+\/[A-Za-z0-9._/-]+$/;
const ICON_SPRITE_URL = new URL('../../assets/icons.svg', import.meta.url).href;

function checkedIconName(name) {
  const value = String(name || '');
  if (!ICON_NAME_PATTERN.test(value)) {
    throw new Error(`Invalid icon name: ${value}`);
  }
  return value;
}

export function iconMarkup(name, className = '') {
  const value = String(name || '');
  const classes = ['app-icon', className].filter(Boolean).join(' ');
  if (PLUGIN_ICON_PATTERN.test(value)) {
    // Resolved against the document base, like a view module, so it also works under a subpath.
    const url = new URL(value, document.baseURI).href;
    return `<img class="${classes}" src="${escapeAttr(url)}" alt="">`;
  }
  const iconName = checkedIconName(value);
  return `<svg class="${classes}" aria-hidden="true"><use href="${ICON_SPRITE_URL}#${iconName}"></use></svg>`;
}
