import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, { MFA_ENROLLMENT_REQUIRED, setApiErrorCallback } from '../lib/api.js';
import { MFA_ENROLLMENT_REQUIRED_EVENT } from '../lib/mfa-enrollment.js';

// Organization MFA requirement: a 403 MFA_ENROLLMENT_REQUIRED is not an error
// to toast; the API layer announces it so the app routes to two-factor setup.
describe('MFA enrollment requirement in the API layer', () => {
  const listener = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    listener.mockReset();
    window.addEventListener(MFA_ENROLLMENT_REQUIRED_EVENT, listener);
  });

  afterEach(() => {
    window.removeEventListener(MFA_ENROLLMENT_REQUIRED_EVENT, listener);
    setApiErrorCallback(null);
    vi.unstubAllGlobals();
  });

  it('announces the requirement and does not toast', async () => {
    const onError = vi.fn();
    setApiErrorCallback(onError);
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ error: 'Your organization requires two-factor authentication.', code: MFA_ENROLLMENT_REQUIRED }),
    });

    await expect(api.request('/clients')).rejects.toMatchObject({ status: 403, data: { code: 'MFA_ENROLLMENT_REQUIRED' } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('leaves other 403 answers alone', async () => {
    const onError = vi.fn();
    setApiErrorCallback(onError);
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ error: 'Admin access required' }),
    });
    await expect(api.request('/team')).rejects.toMatchObject({ status: 403 });
    expect(listener).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reads and changes the organization requirement', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ required: true }) });
    await api.getMfaRequirement();
    expect(fetch).toHaveBeenLastCalledWith('/api/settings/mfa-requirement', expect.objectContaining({ credentials: 'include' }));
    await api.setMfaRequirement(true);
    expect(fetch).toHaveBeenLastCalledWith('/api/settings/mfa-requirement', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ required: true }) }));
  });
});
