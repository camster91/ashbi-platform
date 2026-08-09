import { useState, useEffect } from 'react';

function storageKey(scopeId) {
  return scopeId ? `theme:${scopeId}` : 'theme:public';
}

export function useTheme(scopeId = null) {
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem(storageKey(scopeId));
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem(storageKey(scopeId), theme);
  }, [scopeId, theme]);

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return { theme, toggle, isDark: theme === 'dark' };
}
