import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setApiErrorCallback, setUnauthorizedCallback } from '../lib/api';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ scope: 'SHARED_STAFF', items: [] }) })); });
afterEach(() => { setApiErrorCallback(null); setUnauthorizedCallback(null); vi.unstubAllGlobals(); });

describe('client agent conversation API', () => {
  it('encodes client, conversation, run and cursor segments and omits absent cursors', async () => {
    await api.listClientAgentConversations('client/a', { limit: 50, after: undefined });
    await api.getClientAgentConversation('client/a', 'conversation/b', { after: 'cursor/c', limit: 25 });
    await api.getClientAgentRun('client/a', 'conversation/b', 'run/c');
    await api.getClientAgentRunByIntent('client/a', 'conversation/b', 'key/d');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/clients/client%2Fa/assistant/conversations?limit=50',
      '/api/clients/client%2Fa/assistant/conversations/conversation%2Fb?after=cursor%2Fc&limit=25',
      '/api/clients/client%2Fa/assistant/conversations/conversation%2Fb/runs/run%2Fc',
      '/api/clients/client%2Fa/assistant/conversations/conversation%2Fb/runs/by-intent/key%2Fd',
    ]);
  });

  it('preserves the explicit start intent and sends only the requested mutation bodies', async () => {
    await api.createClientAgentConversation('c', { title: 'Planning' });
    await api.startClientAgentRun('c', 'conversation', { question: 'Status?', idempotencyKey: 'same-key' });
    await api.cancelClientAgentRun('c', 'conversation', 'run');
    await api.reviewClientAgentRun('c/a', 'conversation/b', 'run/c');
    expect(fetch.mock.calls.map(([url, options]) => [url, options.method, JSON.parse(options.body)])).toEqual([
      ['/api/clients/c/assistant/conversations', 'POST', { title: 'Planning' }],
      ['/api/clients/c/assistant/conversations/conversation/runs', 'POST', { question: 'Status?', idempotencyKey: 'same-key' }],
      ['/api/clients/c/assistant/conversations/conversation/runs/run/cancel', 'POST', {}],
      ['/api/clients/c%2Fa/assistant/conversations/conversation%2Fb/runs/run%2Fc/review', 'POST', {}],
    ]);
  });

  it('keeps denied reads local while still notifying session expiry', async () => {
    const unauthorized = vi.fn(); const errors = vi.fn();
    setUnauthorizedCallback(unauthorized); setApiErrorCallback(errors);
    fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Session expired' }) });
    await expect(api.getClientAgentRunByIntent('c', 'conversation', 'key')).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledExactlyOnceWith('Session expired');
    expect(errors).not.toHaveBeenCalled();
  });

  it('does not retry an ambiguous or failed start automatically', async () => {
    const errors = vi.fn(); setApiErrorCallback(errors);
    fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Private provider detail' }) });
    await expect(api.startClientAgentRun('c', 'conversation', { question: 'Status?', idempotencyKey: 'same-key' })).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  });
});
