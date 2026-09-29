/**
 * Full page load of an in-app path. Used when the signed-in identity changes
 * underneath the SPA (starting or stopping a support view, #416) so no query
 * cache, socket or in-memory state from the previous identity survives.
 * @param {string} path
 */
export function reloadTo(path) {
  window.location.assign(path);
}
