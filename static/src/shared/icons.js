const ICON_NAME_PATTERN = /^[a-z0-9-]+$/;
const ICON_SPRITE_URL = new URL('../../assets/icons.svg', import.meta.url).href;

function checkedIconName(name) {
  const value = String(name || '');
  if (!ICON_NAME_PATTERN.test(value)) {
    throw new Error(`Invalid icon name: ${value}`);
  }
  return value;
}

export function iconMarkup(name, className = '') {
  const iconName = checkedIconName(name);
  const classes = ['app-icon', className].filter(Boolean).join(' ');
  return `<svg class="${classes}" aria-hidden="true"><use href="${ICON_SPRITE_URL}#${iconName}"></use></svg>`;
}
