import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, { setApiErrorCallback } from '../lib/api.js';

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(data) };
}

describe('API error console logging', () => {
  let group;
  let error;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(500, { error: 'Boom', detail: 'client@example.com' })));
    group = vi.spyOn(console, 'group').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    setApiErrorCallback(null);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs response data and the stack trace in development builds', async () => {
    vi.stubEnv('DEV', true);
    await expect(api.request('/widgets')).rejects.toMatchObject({ status: 500 });

    expect(group).toHaveBeenCalled();
    const logged = error.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('Response data:');
    expect(logged).toContain('Stack trace:');
  });

  it('logs one line without response data or stack in production builds', async () => {
    vi.stubEnv('DEV', false);
    const onError = vi.fn();
    setApiErrorCallback(onError);
    await expect(api.request('/widgets')).rejects.toMatchObject({ status: 500 });

    expect(group).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('API error 500: /widgets');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
