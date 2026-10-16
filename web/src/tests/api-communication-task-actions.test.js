import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setApiErrorCallback, setUnauthorizedCallback } from '../lib/api';
beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ action: { id: 'a1' } }) })));
afterEach(() => { setApiErrorCallback(null); setUnauthorizedCallback(null); vi.unstubAllGlobals(); });
describe('communication task action API', () => {
  it('encodes every path component and preserves explicit preview and confirmation bodies', async () => {
    const input = { projectId: 'p1', title: 'Follow up', description: '', priority: 'NORMAL' };
    await api.prepareCommunicationTask('c/a', 'm/b', { input, idempotencyKey: 'key-12345' });
    await api.getCommunicationTaskByIntent('c/a', 'm/b', 'key/c');
    await api.getCommunicationTaskAction('c/a', 'm/b', 'action/d');
    await api.confirmCommunicationTask('c/a', 'm/b', 'action/d');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/client-communications/c%2Fa/inbox/m%2Fb/task-actions',
      '/api/client-communications/c%2Fa/inbox/m%2Fb/task-actions/by-intent/key%2Fc',
      '/api/client-communications/c%2Fa/inbox/m%2Fb/task-actions/action%2Fd',
      '/api/client-communications/c%2Fa/inbox/m%2Fb/task-actions/action%2Fd/confirm',
    ]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ input, idempotencyKey: 'key-12345' });
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ confirm: true });
  });
  it('does not retry an ambiguous confirmation or expose its internal error through global toasts', async () => {
    const errorToast = vi.fn(); setApiErrorCallback(errorToast);
    fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Private database detail' }) });
    await expect(api.confirmCommunicationTask('c', 'm', 'a')).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1); expect(errorToast).not.toHaveBeenCalled();
  });
});
