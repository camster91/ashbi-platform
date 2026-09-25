import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, { setApiErrorCallback, setReauthHandler } from '../lib/api.js';

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  };
}

const reauthRequired = () => response(403, { error: 'Confirm your identity to continue.', code: 'REAUTH_REQUIRED' });

describe('step-up re-authentication in the API layer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    setReauthHandler(null);
    setApiErrorCallback(null);
    vi.unstubAllGlobals();
  });

  it('prompts on 403 REAUTH_REQUIRED and retries the original request once', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    setReauthHandler(handler);
    fetch
      .mockResolvedValueOnce(reauthRequired())
      .mockResolvedValueOnce(response(200, { id: 'key-1' }));

    await expect(api.request('/api-keys', { method: 'POST', body: { name: 'CI' } })).resolves.toEqual({ id: 'key-1' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ endpoint: '/api-keys' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ name: 'CI' }));
    expect(fetch.mock.calls[1][1].method).toBe('POST');
  });

  it('retries only once, even if the server asks again', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    setReauthHandler(handler);
    fetch.mockResolvedValue(reauthRequired());

    await expect(api.request('/credentials/c1/password')).rejects.toMatchObject({ status: 403, data: { code: 'REAUTH_REQUIRED' } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry or toast when the user cancels', async () => {
    const onError = vi.fn();
    setApiErrorCallback(onError);
    setReauthHandler(vi.fn().mockResolvedValue(false));
    fetch.mockResolvedValueOnce(reauthRequired());

    await expect(api.request('/settings/ai-provider', { method: 'POST', body: { provider: 'gemini' } }))
      .rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('shares one prompt between concurrent requests', async () => {
    let finish;
    const handler = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    setReauthHandler(handler);
    fetch
      .mockResolvedValueOnce(reauthRequired())
      .mockResolvedValueOnce(reauthRequired())
      .mockResolvedValue(response(200, { ok: true }));

    const first = api.request('/credentials/a/password');
    const second = api.request('/credentials/b/password');
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    finish(true);

    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('treats other 403s as ordinary errors', async () => {
    const handler = vi.fn();
    setReauthHandler(handler);
    fetch.mockResolvedValueOnce(response(403, { error: 'Admin access required' }));

    await expect(api.request('/team/u1', { method: 'PUT', body: {} })).rejects.toMatchObject({ status: 403 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('sends a password or a code to /auth/reauth', async () => {
    fetch.mockResolvedValue(response(200, { reauthenticated: true }));
    await api.reauth({ password: 'pw' });
    await api.reauth({ code: '123456' });
    expect(fetch.mock.calls[0][0]).toMatch(/\/auth\/reauth$/);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ password: 'pw' });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ code: '123456' });
  });
});
