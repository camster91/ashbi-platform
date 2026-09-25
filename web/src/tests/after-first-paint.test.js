import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterFirstContentfulPaint } from '../hooks/useAuth';

describe('afterFirstContentfulPaint', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs on the next tick when first paint already happened', () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([{ name: 'first-contentful-paint' }]);
    const callback = vi.fn();
    afterFirstContentfulPaint(callback);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('falls back to a timer when paint timing never reports', () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([]);
    const callback = vi.fn();
    afterFirstContentfulPaint(callback, 500);
    vi.advanceTimersByTime(499);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('never runs after it is cancelled', () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([]);
    const callback = vi.fn();
    const cancel = afterFirstContentfulPaint(callback, 500);
    cancel();
    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
  });
});
