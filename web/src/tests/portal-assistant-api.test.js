import { beforeEach, expect, it, vi } from 'vitest';
import { portalAssistant } from '../lib/portal-assistant';
const { portalFetch } = vi.hoisted(() => ({ portalFetch: vi.fn() }));
vi.mock('../pages/client-portal/shared', () => ({ portalFetch }));
beforeEach(() => { vi.resetAllMocks(); portalFetch.mockResolvedValue({ ok: true, json: async () => ({ run: { id: 'r1' } }) }); });
it('encodes canonical project/run/intent paths and only explicit mutation methods POST empty bodies', async () => {
  await portalAssistant.list('a/b', 'token', 'cursor'); await portalAssistant.byIntent('a/b', 'token', 'key/x'); await portalAssistant.get('a/b', 'token', 'run/x');
  for (const method of ['dispatch', 'cancel', 'recover']) await portalAssistant[method]('a/b', 'token', 'run/x');
  expect(portalFetch.mock.calls.slice(0, 3).map(call => call[0])).toEqual(['/api/client-portal/projects/a%2Fb/assistant?limit=20&after=cursor', '/api/client-portal/projects/a%2Fb/assistant/runs/by-intent/key%2Fx', '/api/client-portal/projects/a%2Fb/assistant/runs/run%2Fx']);
  for (const call of portalFetch.mock.calls.slice(3)) expect(call[2]).toMatchObject({ method: 'POST', body: '{}' });
});
it('create is an explicit POST with the original bounded message/opaque key', async () => {
  const body = { message: 'Status?', idempotencyKey: 'opaque-key' }; await portalAssistant.create('p1', undefined, body); expect(portalFetch.mock.calls[0][2]).toMatchObject({ method: 'POST', body: JSON.stringify(body) });
});
it('denied or unknown errors expose generic copy without private response details', async () => {
  portalFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'private credential' }) }); await expect(portalAssistant.list('p1')).rejects.toMatchObject({ status: 403, message: 'Assistant request unavailable.' });
});
