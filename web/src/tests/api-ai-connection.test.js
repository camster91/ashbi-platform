import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';

const ok = (data) => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue(data) });

describe('BYOK AI connection API client', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({}))));
  afterEach(() => vi.unstubAllGlobals());

  it('calls the admin endpoints with the expected methods and bodies', async () => {
    await api.getAiConnection();
    await api.connectAiProvider({ baseUrl: 'https://llm.example.com', apiKey: 'sk-x-12345678', allowedModels: ['m'], defaultModel: 'm', monthlyBudgetCents: 100, extra: 'dropped' });
    await api.validateAiConnection();
    await api.rotateAiConnectionKey('sk-y-12345678');
    await api.revokeAiConnection();
    await api.updateAiConnectionSettings({ monthlyBudgetCents: 200 });
    await api.setOrganizationAiDisabled(true);
    await api.setOrganizationAiDisabled(false);

    const calls = fetch.mock.calls.map(([url, init]) => [url, init.method ?? 'GET', init.body ? JSON.parse(init.body) : undefined]);
    expect(calls).toEqual([
      ['/api/ai-connections', 'GET', undefined],
      ['/api/ai-connections/connect', 'POST', { baseUrl: 'https://llm.example.com', apiKey: 'sk-x-12345678', allowedModels: ['m'], defaultModel: 'm', monthlyBudgetCents: 100 }],
      ['/api/ai-connections/validate', 'POST', undefined],
      ['/api/ai-connections/rotate', 'POST', { apiKey: 'sk-y-12345678' }],
      ['/api/ai-connections/revoke', 'POST', undefined],
      ['/api/ai-connections/settings', 'PATCH', { monthlyBudgetCents: 200 }],
      ['/api/ai-connections/disable', 'POST', undefined],
      ['/api/ai-connections/enable', 'POST', undefined],
    ]);
  });
});

describe('AI tool approvals API client', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({}))));
  afterEach(() => vi.unstubAllGlobals());

  it('calls the approval queue endpoints with the expected methods and bodies', async () => {
    await api.getAiToolApprovals();
    await api.getAiToolReceipts({ status: 'FAILED', tool: '', limit: 25 });
    await api.approveAiToolAction('a/1');
    await api.rejectAiToolAction('a1', 'unsafe');

    const calls = fetch.mock.calls.map(([url, init]) => [url, init.method ?? 'GET', init.body ? JSON.parse(init.body) : undefined]);
    expect(calls).toEqual([
      ['/api/ai-tools/approvals', 'GET', undefined],
      ['/api/ai-tools/receipts?status=FAILED&limit=25', 'GET', undefined],
      ['/api/ai-tools/approvals/a%2F1/approve', 'POST', {}],
      ['/api/ai-tools/approvals/a1/reject', 'POST', { reason: 'unsafe' }],
    ]);
  });
});
