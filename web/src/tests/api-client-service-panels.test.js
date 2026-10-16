import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, setApiErrorCallback, setUnauthorizedCallback } from '../lib/api';
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
