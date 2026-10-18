import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setApiErrorCallback, setUnauthorizedCallback } from '../lib/api';

// How lib/api.js reacts to 401 and other errors: sign-in and the session
// probe handle their own failures, protected endpoints sign the person out,
// and silent requests never raise the global error toast. (Replaces an older
// node:test file that exercised a copy of request() and never ran.)

function respond(status, body = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status < 400, status, headers: new Headers(), json: async () => body })));
}

describe('API client auth behaviour', () => {
  const onUnauthorized = vi.fn();
  const onApiError = vi.fn();

  beforeEach(() => {
    setUnauthorizedCallback(onUnauthorized);
    setApiErrorCallback(onApiError);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    setUnauthorizedCallback(null);
    setApiErrorCallback(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    onUnauthorized.mockReset();
    onApiError.mockReset();
  });

  it('a 401 from the session probe (/auth/me) signs nobody out and shows no error', async () => {
    respond(401, { error: 'Not signed in' });
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onApiError).not.toHaveBeenCalled();
  });

  it('wrong sign-in credentials (401 on /auth/login) throw to the form without a global sign-out', async () => {
    respond(401, { error: 'Invalid email or password' });
    await expect(api.login('a@example.com', 'wrong')).rejects.toMatchObject({ status: 401, message: 'Invalid email or password' });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onApiError).not.toHaveBeenCalled();
  });

  it('a 401 from a protected endpoint signs the person out and reports the error', async () => {
    respond(401, { error: 'Session expired' });
    await expect(api.getProjects()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledWith('Session expired');
    expect(onApiError).toHaveBeenCalledOnce();
  });

  it('a silent request stays local on 401', async () => {
    respond(401, {});
    await expect(api.forgotPassword('a@example.com')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onApiError).not.toHaveBeenCalled();
  });

  it('a 500 raises the global error on normal requests but not on silent ones', async () => {
    respond(500, { error: 'Boom' });
    await expect(api.getProjects()).rejects.toMatchObject({ status: 500 });
    expect(onApiError).toHaveBeenCalledOnce();
    onApiError.mockReset();
    await expect(api.me()).rejects.toMatchObject({ status: 500 });
    expect(onApiError).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
