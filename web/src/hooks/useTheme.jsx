import { useState, useEffect } from 'react';
import { applyTheme, getInitialTheme, themeStorageKey } from '../lib/theme';

export function useTheme(scopeId = null) {
  const [theme, setTheme] = useState(() => {
    return getInitialTheme(scopeId);
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(themeStorageKey(scopeId), theme);
    } catch {
      // Theme switching remains usable when optional browser storage is blocked.
    }
  }, [scopeId, theme]);

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return { theme, toggle, isDark: theme === 'dark' };
}
