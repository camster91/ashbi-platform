import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
afterEach(() => vi.unstubAllGlobals());
it('uses plural staff route with encoded client and explicit CAS PATCH body', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ enabled: false, name: 'Guide', instructions: '', revision: 0 }) }));
  await api.getPortalAssistantConfig('a/b'); const body = { revision: 2, name: 'Guide', instructions: 'Client-facing instructions', enabled: false }; await api.updatePortalAssistantConfig('a/b', body);
  expect(fetch.mock.calls[0][0]).toBe('/api/client-assistants/a%2Fb/portal-config'); expect(fetch.mock.calls[1][0]).toBe('/api/client-assistants/a%2Fb/portal-config');
  expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify(body), credentials: 'include' });
});
