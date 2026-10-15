import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setApiErrorCallback, setUnauthorizedCallback } from '../lib/api.js';

describe('client assistant authentication', () => {
  let unauthorized;
  let apiError;
  beforeEach(() => {
    unauthorized = vi.fn(); apiError = vi.fn();
    setUnauthorizedCallback(unauthorized); setApiErrorCallback(apiError);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    setUnauthorizedCallback(null); setApiErrorCallback(null); vi.unstubAllGlobals();
  });
  it('handles expiry without exposing provider errors in a global toast', async () => {
    fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Session expired' }) });
    await expect(api.previewClientAssistant('a/b', { message: 'Status?' })).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledExactlyOnceWith('Session expired');
    expect(apiError).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][0]).toBe('/api/client-assistants/a%2Fb/preview');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps provider failures local to the component', async () => {
    fetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: 'private upstream body' }) });
    await expect(api.previewClientAssistant('a', { message: 'Status?' })).rejects.toMatchObject({ status: 502 });
    expect(unauthorized).not.toHaveBeenCalled(); expect(apiError).not.toHaveBeenCalled();
  });
  it('preserves silent anonymous session probes', async () => {
    fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).not.toHaveBeenCalled(); expect(apiError).not.toHaveBeenCalled();
  });
});

