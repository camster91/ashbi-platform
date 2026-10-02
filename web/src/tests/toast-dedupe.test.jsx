import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import api, { setApiErrorCallback } from '../lib/api.js';
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

  it('always shows an action toast that opts out with dedupe: false', () => {
    let toast;
    render(<ToastProvider><Trigger onReady={(t) => { toast = t; }} /></ToastProvider>);
    const undoToast = () => toast.success({ title: 'Shared 2 files with the client', duration: 10000, dedupe: false, action: { label: 'Undo', onClick: () => {} } });
    act(() => { undoToast(); undoToast(); });
    expect(screen.getAllByText('Shared 2 files with the client')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(2);
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

  it('toasts a failed read the user triggered directly (userInitiated)', () => {
    expect(apiErrorToast({ status: 500, userInitiated: true }, retry)).toMatchObject({ title: 'Server error', action: { label: 'Try again' } });
    expect(apiErrorToast({ status: 403, message: 'Not allowed', userInitiated: true }, retry)).toEqual({ title: 'Request failed', message: 'Not allowed' });
    expect(apiErrorToast({ name: 'TimeoutError', userInitiated: true }, retry)).toMatchObject({ title: 'Request timed out' });
  });
});

describe('api request userInitiated option', () => {
  afterEach(() => {
    setApiErrorCallback(null);
    vi.unstubAllGlobals();
  });

  it('marks the dispatched error so the global handler toasts it', async () => {
    const onError = vi.fn();
    setApiErrorCallback(onError);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Vault unavailable' }) })));
    await expect(api.request('/credentials/c1/password', { userInitiated: true })).rejects.toMatchObject({ status: 500 });
    const [error, , retry] = onError.mock.calls[0];
    expect(error.userInitiated).toBe(true);
    expect(apiErrorToast(error, retry)).toMatchObject({ title: 'Server error' });

    onError.mockClear();
    await expect(api.request('/credentials')).rejects.toMatchObject({ status: 500 });
    expect(onError.mock.calls[0][0].userInitiated).toBeUndefined();
  });
});
