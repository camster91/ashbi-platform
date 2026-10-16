import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ request: { id: 'request/one' } }) })); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('closed human handoff API actions', () => {
  it.each(['claim', 'resolve', 'requeue'])('sends the exact literal %s endpoint and revision', async (operation) => {
    const body = { revision: 4, ...(operation === 'requeue' ? { reason: 'RECOVERY' } : {}) };
    await api.transitionPortalHandoff('request/one', operation, body);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/portal-handoffs/request%2Fone/${operation}`, expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(body) }));
  });
  it.each(['delete', 'resolve/../claim', 'CLAIM', '', null, undefined])('rejects unrecognized operation %s before any HTTP call', (operation) => {
    expect(() => api.transitionPortalHandoff('request-one', operation, { revision: 4 })).toThrow('Unsupported human handoff action.');
    expect(fetch).not.toHaveBeenCalled();
  });
});
