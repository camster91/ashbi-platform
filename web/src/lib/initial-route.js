// The login screen is lazy-loaded, but on a cold visit to /login React would
// first commit the route loader, then hold the real page back behind
// Suspense's reveal throttle. Resolving the login module before the first
// render (it is already modulepreloaded by index.html) lets /login render its
// content in the first commit. Every other route keeps the lazy path.
let preloadedLogin = null;

export async function preloadInitialRoute(pathname, loadLogin = () => import('../pages/Login')) {
  if (pathname !== '/login') return;
  try {
    preloadedLogin = (await loadLogin()).default;
  } catch {
    preloadedLogin = null; // The lazy route will retry and show its own error.
  }
}

export function getPreloadedLogin() {
  return preloadedLogin;
}
