import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, { IMPERSONATION_ENDED, setApiErrorCallback } from '../lib/api.js';

// #416: when a support view ends while a screen still shows the viewed person,
// the server refuses the request (409 IMPERSONATION_ENDED); the client reloads
// so nothing continues under a mixed identity, and shows no error toast.
describe('ended support view in the API layer', () => {
  const reload = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    reload.mockReset();
    vi.stubGlobal('location', { ...window.location, reload });
  });

  afterEach(() => {
    setApiErrorCallback(null);
    vi.unstubAllGlobals();
  });

  it('reloads the page and does not toast on 409 IMPERSONATION_ENDED', async () => {
    const onError = vi.fn();
    setApiErrorCallback(onError);
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({ error: 'The support view has ended.', code: IMPERSONATION_ENDED }),
    });

    await expect(api.request('/tasks/t1', { method: 'PUT', body: { title: 'x' } }))
      .rejects.toMatchObject({ status: 409, data: { code: 'IMPERSONATION_ENDED' } });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not reload on other 409 conflicts', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({ error: 'Already paid', code: 'INVOICE_NOT_PAYABLE' }),
    });
    await expect(api.request('/invoices/i1/mark-paid', { method: 'POST', body: {}, silent: true })).rejects.toMatchObject({ status: 409 });
    expect(reload).not.toHaveBeenCalled();
  });
});
