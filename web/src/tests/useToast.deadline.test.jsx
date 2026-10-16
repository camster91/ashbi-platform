import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../hooks/useToast';

function showAction(expiresAt, onClick = vi.fn(), duration = 10000) {
  function Harness() {
    const toast = useToast();
    return <button onClick={() => toast.success({ title: 'Invoice voided', duration, action: { label: 'Undo', expiresAt, onClick } })}>Show</button>;
  }
  render(<ToastProvider><Harness /></ToastProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Show' }));
  return onClick;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('absolute toast action deadlines', () => {
  it.each(['hover', 'focus', 'manual'])('expires the action while %s pauses notification dismissal', pause => {
    const action = showAction(new Date(Date.now() + 2000).toISOString());
    const notice = screen.getByRole('status');
    if (pause === 'hover') fireEvent.mouseEnter(notice);
    if (pause === 'focus') fireEvent.focus(screen.getByRole('button', { name: 'Undo' }));
    if (pause === 'manual') fireEvent.click(screen.getByRole('button', { name: 'Pause notification timer' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('Undo available for 1 second')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('Undo window expired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(action).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(15000));
    expect(notice).toBeInTheDocument();
  });

  it('checks the clock at click time between countdown renders', () => {
    const action = showAction(Date.now() + 100);
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
    vi.setSystemTime(Date.now() + 101);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText('Undo window expired')).toBeInTheDocument();
  });

  it.each(['invalid', '', null, undefined, Infinity, '2026-10-16T11:59:59Z'])('never enables invalid or expired deadline %s', deadline => {
    const action = showAction(deadline);
    expect(screen.getByText('Undo window expired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(action).not.toHaveBeenCalled();
  });

  it('updates deadline actions even when notification duration is zero', () => {
    showAction(Date.now() + 1000, vi.fn(), 0);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('Undo window expired')).toBeInTheDocument();
  });

  it('accepts in-flight success after expiry without a duplicate callback', async () => {
    let resolve;
    const action = showAction(Date.now() + 1000, vi.fn(() => new Promise(done => { resolve = done; })));
    fireEvent.mouseEnter(screen.getByRole('status'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(action).toHaveBeenCalledOnce();
    await act(async () => resolve());
    expect(screen.queryByText('Invoice voided')).not.toBeInTheDocument();
  });
});
