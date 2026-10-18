import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setApiErrorCallback, setUnauthorizedCallback } from '../lib/api';

// lib/api.js request builders: paths, methods, bodies and error handling
// for the staff agent, service-panel, task-action, resource-link and AI
// connection endpoints, and the portal assistant and hand-off endpoints.

describe('api-ai-connection.test.js', () => {
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
});

describe('api-client-agent-conversations.test.js', () => {
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
});

describe('api-client-assistant.test.js', () => {
  describe('client assistant authentication', () => {
    let unauthorized;
    let apiError;
    beforeEach(() => {
      unauthorized = vi.fn(); apiError = vi.fn();
      setUnauthorizedCallback(unauthorized); setApiErrorCallback(apiError);
      vi.stubGlobal('fetch', vi.fn());
    });
    afterEach(() => {
      setUnauthorizedCallback(null); setApiErrorCallback(null); vi.unstubAllGlobals();
    });
    it('handles expiry without exposing provider errors in a global toast', async () => {
      fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Session expired' }) });
      await expect(api.previewClientAssistant('a/b', { message: 'Status?' })).rejects.toMatchObject({ status: 401 });
      expect(unauthorized).toHaveBeenCalledExactlyOnceWith('Session expired');
      expect(apiError).not.toHaveBeenCalled();
      expect(fetch.mock.calls[0][0]).toBe('/api/client-assistants/a%2Fb/preview');
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('keeps provider failures local to the component', async () => {
      fetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: 'private upstream body' }) });
      await expect(api.previewClientAssistant('a', { message: 'Status?' })).rejects.toMatchObject({ status: 502 });
      expect(unauthorized).not.toHaveBeenCalled(); expect(apiError).not.toHaveBeenCalled();
    });
    it('preserves silent anonymous session probes', async () => {
      fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
      await expect(api.me()).rejects.toMatchObject({ status: 401 });
      expect(unauthorized).not.toHaveBeenCalled(); expect(apiError).not.toHaveBeenCalled();
    });
  });
});

describe('api-client-service-panels.test.js', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })));
  afterEach(() => { setApiErrorCallback(null); setUnauthorizedCallback(null); vi.unstubAllGlobals(); });
  it('encodes saved report paths and preserves bounded explicit mutation bodies', async () => {
    const create = { provider: 'OPENSEO', providerProjectId: 'project', displayLabel: 'SEO' };
    const update = { revision: 1, displayLabel: 'SEO', enabled: false };
    const publish = { mappingRevision: 2, providerProjectIdMatch: 'project', outcome: 'OK', complete: false, failureCode: null, reports: [{ providerReportId: 'r1', title: 'Report', summary: 'Summary', sourceReportedAt: null }] };
    await api.getClientServicePanels('c/a'); await api.createClientServiceMapping('c/a', create); await api.updateClientServiceMapping('c/a', 'm/b', update); await api.publishClientServiceSnapshot('c/a', 'm/b', publish);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/clients/c%2Fa/service-panels', '/api/clients/c%2Fa/service-panels', '/api/clients/c%2Fa/service-panels/m%2Fb', '/api/clients/c%2Fa/service-panels/m%2Fb/snapshots']);
    expect(fetch.mock.calls.slice(1).map(([, options]) => JSON.parse(options.body))).toEqual([create, update, publish]);
  });


  it('uses explicit refresh and metadata-only selection paths without accepting an alternate provider endpoint', async () => {
    await api.getClientServiceCredentials('c/a');
    await api.refreshClientServiceReports('c/a', 'm/b', { mappingRevision: 3 });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/clients/c%2Fa/service-panel-credentials', '/api/clients/c%2Fa/service-panels/m%2Fb/refresh']);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ mappingRevision: 3 });
  });
});

describe('api-client-task-actions.test.js', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ action: { id: 'a1' } }) })));
  afterEach(() => { setApiErrorCallback(null); setUnauthorizedCallback(null); vi.unstubAllGlobals(); });
  describe('client task action API', () => {
    it('encodes every path component and preserves explicit preview and confirmation bodies', async () => {
      const input = { projectId: 'p1', title: 'Follow up', description: '', priority: 'NORMAL' };
      await api.prepareClientTaskAction('c/a', { input, idempotencyKey: 'key-12345' });
      await api.getClientTaskActionByIntent('c/a', 'key/c');
      await api.getClientTaskAction('c/a', 'action/d');
      await api.confirmClientTaskAction('c/a', 'action/d');
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        '/api/clients/c%2Fa/assistant/task-actions',
        '/api/clients/c%2Fa/assistant/task-actions/by-intent/key%2Fc',
        '/api/clients/c%2Fa/assistant/task-actions/action%2Fd',
        '/api/clients/c%2Fa/assistant/task-actions/action%2Fd/confirm',
      ]);
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ input, idempotencyKey: 'key-12345' });
      expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ confirm: true });
    });
    it('does not retry an ambiguous confirmation or expose its internal error through global toasts', async () => {
      const errorToast = vi.fn(); setApiErrorCallback(errorToast);
      fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Private database detail' }) });
      await expect(api.confirmClientTaskAction('c', 'a')).rejects.toMatchObject({ status: 503 });
      expect(fetch).toHaveBeenCalledTimes(1); expect(errorToast).not.toHaveBeenCalled();
    });
  });

  it('withdraws a revoked opaque intent through its encoded recent-auth route without private input', async () => {
    await api.rejectClientTaskAction('c/a', 'intent/b');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/clients/c%2Fa/assistant/task-actions/by-intent/intent%2Fb/reject');
    expect(fetch.mock.calls[0][1].method).toBe('POST'); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({});
  });
});

describe('api-communication-task-actions.test.js', () => {
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
});

describe('api-portal-assistant-settings.test.js', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses plural staff route with encoded client and explicit CAS PATCH body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ enabled: false, name: 'Guide', instructions: '', revision: 0 }) }));
    await api.getPortalAssistantConfig('a/b'); const body = { revision: 2, name: 'Guide', instructions: 'Client-facing instructions', enabled: false }; await api.updatePortalAssistantConfig('a/b', body);
    expect(fetch.mock.calls[0][0]).toBe('/api/client-assistants/a%2Fb/portal-config'); expect(fetch.mock.calls[1][0]).toBe('/api/client-assistants/a%2Fb/portal-config');
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify(body), credentials: 'include' });
  });
});

describe('api-portal-handoffs.test.js', () => {
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
});

describe('api-resource-links.test.js', () => {
  beforeEach(()=>vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({})})));
  afterEach(()=>vi.unstubAllGlobals());
  it('uses bounded exact resource routes, preserves URL payload and caller revisions/intent',async()=>{
    const body={entityType:'TASK',entityId:'t1',title:'Brief',url:'https://example.com/a?x=1#part',clientVisible:false,createIntentId:'711ab336-e252-4090-a4fd-bac8cf004b37'};
    await api.listResourceLinks({entityType:'TASK',entityId:'t/1',limit:100,includeArchived:true});
    await api.createResourceLink(body); await api.updateResourceLink('r/1',{expectedRevision:2,title:'New'});
    await api.archiveResourceLink('r/1',{expectedRevision:3,archived:true});
    await api.reorderResourceLinks({entityType:'TASK',entityId:'t1',ordered:[{id:'r1',expectedRevision:4}]});
    expect(fetch.mock.calls.map(([url])=>url)).toEqual(['/api/resource-links?entityType=TASK&entityId=t%2F1&limit=100&includeArchived=true','/api/resource-links','/api/resource-links/r%2F1','/api/resource-links/r%2F1/archive','/api/resource-links/reorder']);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(body); expect(fetch.mock.calls[2][1].method).toBe('PATCH');
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({expectedRevision:3,archived:true});
  });
  it('loads client resources with current-client token and configured API base',async()=>{
    await api.portalProjectResourceLinks('p/1','portal-session',{limit:100,after:'opaque+cursor'});
    expect(fetch).toHaveBeenCalledWith('/api/client-portal/projects/p%2F1/resource-links?limit=100&after=opaque%2Bcursor',expect.objectContaining({credentials:'include',headers:expect.objectContaining({Authorization:'Bearer portal-session'})}));
  });
});
