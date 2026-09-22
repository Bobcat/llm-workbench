import { escapeAttr } from './ui-helpers.js';

const ICON_NAME_PATTERN = /^[a-z0-9-]+$/;
// A plugin's own icon: a relative path under its own mount, next to its views. Anything else is a
// sprite symbol, and that allowlist is what kept this value safe in markup until now.
const PLUGIN_ICON_PATTERN = /^plugin-static\/[a-z0-9-]+\/[A-Za-z0-9._/-]+$/;
// A built-in plugin's assets live under src/plugins/<id>/, next to its client and its views; a
// package serves them from its own mount. Same rule, different root.
const BUILT_IN_ICON_PATTERN = /^src\/plugins\/[a-z0-9-]+\/[A-Za-z0-9._/-]+$/;
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
  // Refused here as well as in the core: these pass the pattern and then resolve outside the
  // plugin's own mount once the browser decodes and normalises the URL.
  const escapes = value.split('/').includes('..') || /[%\\]/.test(value);
  const isPathIcon = PLUGIN_ICON_PATTERN.test(value) || BUILT_IN_ICON_PATTERN.test(value);
  if (isPathIcon && !escapes) {
    // Resolved against the document base, like a view module, so it also works under a subpath.
    const url = new URL(value, document.baseURI).href;
    return `<img class="${classes}" src="${escapeAttr(url)}" alt="">`;
  }
  const iconName = checkedIconName(value);
  return `<svg class="${classes}" aria-hidden="true"><use href="${ICON_SPRITE_URL}#${iconName}"></use></svg>`;
}
