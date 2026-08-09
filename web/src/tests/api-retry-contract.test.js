import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, { setApiErrorCallback } from '../lib/api.js';

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  };
}

describe('global API recovery contract', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    setApiErrorCallback(null);
    vi.unstubAllGlobals();
  });

  it('offers one safe retry for a failed read', async () => {
    const onError = vi.fn();
    setApiErrorCallback(onError);
    fetch
      .mockResolvedValueOnce(response(503, { error: 'Unavailable' }))
      .mockResolvedValueOnce(response(200, { clients: [] }));

    await expect(api.request('/clients')).rejects.toMatchObject({ status: 503 });
    const retry = onError.mock.calls[0][2];
    await expect(retry()).resolves.toEqual({ clients: [] });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('never offers automatic retry for a write with an uncertain outcome', async () => {
    const onError = vi.fn();
    setApiErrorCallback(onError);
    fetch.mockResolvedValue(response(503, { error: 'Unavailable' }));

    await expect(api.request('/clients', { method: 'POST', body: { name: 'Ashbi' } }))
      .rejects.toMatchObject({ status: 503 });

    expect(onError.mock.calls[0][2]).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
