export function themeStorageKey(scopeId = null) {
  return scopeId ? `theme:${scopeId}` : 'theme:public';
}

export function getInitialTheme(scopeId = null) {
  try {
    const stored = localStorage.getItem(themeStorageKey(scopeId));
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // Storage is optional; system preference remains a safe fallback.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme, root = document.documentElement) {
  root.classList.toggle('dark', theme === 'dark');
}
