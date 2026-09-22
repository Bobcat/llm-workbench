// Where a plugin's own files may live.
//
// A package serves them from its mount (`plugin-static/<id>/…`), a built-in plugin keeps them in its
// folder under `src/plugins/<id>/`. Both the icon and the stylesheet of a plugin go through this
// check, so the two fields cannot drift apart: one root pattern, one escape rule. The escapes are
// refused because the browser decodes `%2e` and treats a backslash as a separator, so a path that
// looks contained can still resolve outside the folder.
const PACKAGE_PATTERN = /^plugin-static\/[a-z0-9-]+\/[A-Za-z0-9._/-]+$/;
const BUILT_IN_PATTERN = /^src\/plugins\/[a-z0-9-]+\/[A-Za-z0-9._/-]+$/;
const ESCAPES = /[%\\]/;

export function isPluginAssetPath(value) {
  const path = String(value || '');
  if (!path || ESCAPES.test(path) || path.split('/').includes('..')) return false;
  return PACKAGE_PATTERN.test(path) || BUILT_IN_PATTERN.test(path);
}
