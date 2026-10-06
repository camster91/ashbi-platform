import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoiceTotals, lineTotal } from '../lib/money-totals';
import useIsSmUp from '../hooks/useIsSmUp';

describe('shared money totals (mirrors src/utils/money-totals.js)', () => {
  it.each([
    [1000.5, 130.07, 1130.57],
    [2500.5, 325.07, 2825.57],
    [350.5, 45.57, 396.07],
    [4.5, 0.59, 5.09],
  ])('rounds half-cent tax on %s at 13%% up, as the API does', (subtotal, tax, total) => {
    expect(invoiceTotals([{ total: lineTotal(1, subtotal) }], 13)).toEqual({ subtotal, preTax: subtotal, tax, total });
  });

  it('takes the discount off before tax and never below zero', () => {
    expect(invoiceTotals([{ total: 1500 }], 5, 100)).toMatchObject({ preTax: 1400, tax: 70, total: 1470 });
    expect(invoiceTotals([{ total: 50 }], 13, 100)).toMatchObject({ preTax: 0, tax: 0, total: 0 });
  });
});

describe('useIsSmUp', () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });

  it('falls back to addListener on browsers without addEventListener', () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    window.matchMedia = () => ({ matches: true, addListener, removeListener });
    const { result, unmount } = renderHook(() => useIsSmUp());
    expect(result.current).toBe(true);
    expect(addListener).toHaveBeenCalledTimes(1);
    unmount();
    expect(removeListener).toHaveBeenCalledWith(addListener.mock.calls[0][0]);
  });
});
