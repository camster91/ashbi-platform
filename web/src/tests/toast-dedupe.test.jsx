import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../hooks/useToast';
import { apiErrorToast } from '../lib/apiErrorToast';

function Trigger({ onReady }) {
  const toast = useToast();
  onReady(toast);
  return null;
}

describe('toast deduplication', () => {
  it('shows identical error toasts once, but still shows different ones', () => {
    let toast;
    render(<ToastProvider><Trigger onReady={(t) => { toast = t; }} /></ToastProvider>);
    act(() => {
      toast.error('Request failed', 'content: Expected string');
      toast.error('Request failed', 'content: Expected string');
      toast.error('Request failed', 'content: Expected string');
    });
    expect(screen.getAllByText('content: Expected string')).toHaveLength(1);
    act(() => { toast.error('Request failed', 'Another problem'); });
    expect(screen.getByText('Another problem')).toBeInTheDocument();
  });
});

describe('global API error toasts', () => {
  const retry = vi.fn();

  it('does not toast failed background reads — pages show inline error states', () => {
    expect(apiErrorToast({ status: 500, message: 'boom' }, retry)).toBeNull();
    expect(apiErrorToast({ status: 404, message: 'Not found' }, retry)).toBeNull();
    expect(apiErrorToast({ name: 'TimeoutError' }, retry)).toBeNull();
  });

  it('still reports a lost connection once, and failed writes', () => {
    expect(apiErrorToast({ name: 'NetworkError' }, retry)).toMatchObject({ title: 'Network error' });
    expect(apiErrorToast({ status: 400, message: 'Title is required' }, undefined)).toEqual({ title: 'Request failed', message: 'Title is required' });
    expect(apiErrorToast({ status: 503 }, undefined)).toMatchObject({ title: 'Server error' });
    expect(apiErrorToast({ status: 401 }, undefined)).toBeNull();
  });
});
