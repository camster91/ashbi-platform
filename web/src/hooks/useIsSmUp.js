import { useEffect, useState } from 'react';

// Tailwind's `sm` breakpoint.
export const SM_UP_QUERY = '(min-width: 640px)';

function mediaQuery() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(SM_UP_QUERY)
    : null;
}

/**
 * True at the `sm` breakpoint and up. Forms with separate mobile and desktop
 * line-item layouts render only the one in use, so a `required` input is
 * never a hidden duplicate the browser cannot focus ("An invalid form control
 * is not focusable").
 */
export default function useIsSmUp() {
  const [matches, setMatches] = useState(() => Boolean(mediaQuery()?.matches));
  useEffect(() => {
    const media = mediaQuery();
    if (!media) return undefined;
    const onChange = () => setMatches(media.matches);
    onChange();
    // Older Safari (before 14) only has the deprecated addListener API.
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener?.(onChange);
    return () => media.removeListener?.(onChange);
  }, []);
  return matches;
}
