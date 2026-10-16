import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '../hooks/useTheme';

describe('useTheme account isolation', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    const values = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
      },
    });
    document.documentElement.classList.remove('dark');
  });

  it('persists a staff preference only for that account', () => {
    const first = renderHook(() => useTheme('account-a'));
    const initialTheme = first.result.current.theme;

    act(() => first.result.current.toggle());
    const selectedTheme = initialTheme === 'dark' ? 'light' : 'dark';
    expect(localStorage.getItem('theme:account-a')).toBe(selectedTheme);
    expect(localStorage.getItem('theme:account-b')).toBeNull();
    first.unmount();

    const second = renderHook(() => useTheme('account-b'));
    expect(second.result.current.theme).toBe(initialTheme);
    expect(localStorage.getItem('theme:account-b')).toBe(initialTheme);
  });

  it('still applies and toggles the theme when preference writes are blocked', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    const theme = renderHook(() => useTheme('blocked-account'));

    expect(theme.result.current.theme).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
    act(() => theme.result.current.toggle());
    expect(theme.result.current.theme).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    act(() => theme.result.current.toggle());
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.setItem).toHaveBeenLastCalledWith('theme:blocked-account', 'light');
  });
});
