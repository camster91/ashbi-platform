import { useLayoutEffect } from 'react';

/**
 * Client-facing pages (the client portal and the public `Portal*` token pages)
 * are light-only. `main.jsx` applies the visitor's stored or OS theme to
 * `<html>` before React renders, so this removes `.dark` while the page is
 * mounted and restores it on unmount. Every colour on those pages is a design
 * token, so this single switch keeps the whole route on the light token set.
 *
 * Kept in its own tiny module so public pages can use it without pulling in
 * the client portal's shared bundle.
 */
export default function usePortalLightTheme() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    root.classList.remove('dark');
    return () => {
      if (wasDark) root.classList.add('dark');
    };
  }, []);
}
