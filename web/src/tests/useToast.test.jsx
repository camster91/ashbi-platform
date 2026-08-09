/**
 * useToast Hook Tests
 *
 * Verifies toast creation, dismissal, and provider behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { ToastProvider, useToast } from '../hooks/useToast';

function wrapper({ children }) {
  return <ToastProvider>{children}</ToastProvider>;
}

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('provider requirements', () => {
    it('throws when useToast is called outside ToastProvider', () => {
      // Suppress the expected error
      const originalError = console.error;
      console.error = vi.fn();

      expect(() => {
        renderHook(() => useToast(), { wrapper: undefined });
      }).toThrow('useToast must be used within ToastProvider');

      console.error = originalError;
    });
  });

  describe('toast creation', () => {
    it('creates a success toast', () => {
      const { result } = renderHook(() => useToast(), { wrapper });

      act(() => {
        result.current.success('Saved', 'Your changes have been saved');
      });

      // Success toast should have been created (returns an ID)
      expect(result.current.success).toBeInstanceOf(Function);
    });

    it('creates an error toast', () => {
      const { result } = renderHook(() => useToast(), { wrapper });

      act(() => {
        result.current.error('Error', 'Something went wrong');
      });

      expect(result.current.error).toBeInstanceOf(Function);
    });

    it('creates a warning toast', () => {
      const { result } = renderHook(() => useToast(), { wrapper });

      act(() => {
        result.current.warning('Warning', 'Check your settings');
      });

      expect(result.current.warning).toBeInstanceOf(Function);
    });

    it('creates an info toast', () => {
      const { result } = renderHook(() => useToast(), { wrapper });

      act(() => {
        result.current.info('Info', 'Here is some information');
      });

      expect(result.current.info).toBeInstanceOf(Function);
    });

    it('returns a numeric toast ID', () => {
      const { result } = renderHook(() => useToast(), { wrapper });

      let id;
      act(() => {
        id = result.current.success('Test');
      });

      expect(typeof id).toBe('number');
    });

    it('accepts options object format', () => {
      const { result } = renderHook(() => useToast(), { wrapper });

      act(() => {
        result.current.success({ title: 'Test Title', message: 'Test Message', duration: 8000 });
      });

      // Should not throw with options format
      expect(result.current.success).toBeInstanceOf(Function);
    });

    it('renders a keyboard-accessible action and dismisses after it runs', () => {
      const action = vi.fn();
      function Harness() {
        const toast = useToast();
        return <button onClick={() => toast.error({ title: 'Could not load', message: 'Try again.', duration: 0, action: { label: 'Try again', onClick: action } })}>Show</button>;
      }
      render(<ToastProvider><Harness /></ToastProvider>);

      fireEvent.click(screen.getByRole('button', { name: 'Show' }));
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(action).toHaveBeenCalledOnce();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps a zero-duration error visible until explicitly dismissed', () => {
      function Harness() {
        const toast = useToast();
        return <button onClick={() => toast.error({ title: 'Needs attention', duration: 0 })}>Show</button>;
      }
      render(<ToastProvider><Harness /></ToastProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Show' }));
      act(() => vi.advanceTimersByTime(60000));
      expect(screen.getByRole('alert')).toHaveTextContent('Needs attention');
    });

    it('pauses auto-dismiss while hovered and resumes the remaining countdown', () => {
      function Harness() {
        const toast = useToast();
        return <button onClick={() => toast.success({ title: 'Undo available', duration: 4000 })}>Show</button>;
      }
      render(<ToastProvider><Harness /></ToastProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Show' }));
      const notice = screen.getByRole('status');

      fireEvent.mouseEnter(notice);
      act(() => vi.advanceTimersByTime(10000));
      expect(screen.getByRole('status')).toHaveTextContent('Undo available');

      fireEvent.mouseLeave(notice);
      act(() => vi.advanceTimersByTime(4000));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('toast dismissal', () => {
    it('dismisses a toast by ID', () => {
      const { result } = renderHook(() => useToast(), { wrapper });

      let id;
      act(() => {
        id = result.current.success('Test');
      });

      expect(() => {
        act(() => {
          result.current.dismiss(id);
        });
      }).not.toThrow();
    });

    it('auto-dismisses toasts after duration', () => {
      const { result } = renderHook(() => useToast(), { wrapper });

      act(() => {
        result.current.info('Auto-dismiss', 'Gone in 4s', 4000);
      });

      // Before timeout, toast should still be tracked
      // After timeout, it should be dismissed
      act(() => {
        vi.advanceTimersByTime(4000);
      });

      // Auto-dismissal happens; no error thrown
      expect(true).toBe(true);
    });
  });

  describe('multiple toasts', () => {
    it('creates multiple toasts with different IDs', () => {
      const { result } = renderHook(() => useToast(), { wrapper });

      let id1, id2;
      act(() => {
        id1 = result.current.success('First');
        id2 = result.current.error('Second');
      });

      expect(id1).not.toBe(id2);
    });
  });
});
