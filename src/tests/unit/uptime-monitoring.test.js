import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { MiniMaxMonitoringProvider } from '../../ai/providers/minimax-monitoring.js';
import uptimeMonitoringRoutes from '../../routes/uptime-monitoring.routes.js';
import { normalizeUptimeKumaEvent, triageMonitoringIncident } from '../../services/uptime-triage.service.js';

const payload = {
  eventId: 'valen-incident-20260821-001',
  monitor: { name: 'Valen Group — Website', url: 'https://www.valengroup.com/' },
  heartbeat: { status: 0, msg: 'HTTP 500', ping: 1200, time: '2026-08-21T18:00:00.000Z' }
};

test('normalizes a Uptime Kuma down event without forwarding arbitrary payload fields', () => {
  const event = normalizeUptimeKumaEvent({ ...payload, credential: 'never forward this' });
  assert.deepEqual(event, {
    externalEventId: payload.eventId,
    monitorName: 'Valen Group — Website',
    monitorUrl: 'https://www.valengroup.com',
    status: 'DOWN',
    message: 'HTTP 500',
    pingMs: 1200,
    emittedAt: new Date('2026-08-21T18:00:00.000Z')
  });
});

test('skips triage safely when MiniMax credentials are unavailable', async () => {
  const result = await triageMonitoringIncident(normalizeUptimeKumaEvent(payload), {
    provider: { isConfigured: () => false }
  });
  assert.deepEqual(result, { status: 'SKIPPED', reason: 'MINIMAX_MONITORING_UNAVAILABLE' });
});

test('uses the documented server-side MiniMax chat-completions contract', async () => {
  const calls = [];
  const provider = new MiniMaxMonitoringProvider({
    apiKey: 'test-key',
    model: 'MiniMax-M2.5',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"severity":"LOW"}' } }] })
      };
    }
  });

  const result = await provider.chatJSON({ system: 'system', prompt: 'prompt', maxTokens: 123 });
  assert.deepEqual(result, { severity: 'LOW' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.minimax.io/v1/chat/completions');
  assert.equal(calls[0].request.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(calls[0].request.body), {
    model: 'MiniMax-M2.5',
    messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'prompt' }],
    stream: false,
    temperature: 0.1,
    max_completion_tokens: 123
  });
});

test('requires the shared secret and records a shadow-mode incident', async () => {
  const rows = [];
  const app = Fastify();
  app.decorate('prisma', {
    wPSite: { findFirst: async () => ({ id: 'site_1', organizationId: 'org_1' }) },
    monitoringIncident: {
      upsert: async ({ create }) => {
        rows.push(create);
        return { id: 'incident_1', triageStatus: create.triageStatus, notificationDisposition: create.notificationDisposition };
      }
    }
  });
  await app.register(uptimeMonitoringRoutes, {
    secret: 'test-secret',
    triage: async () => ({
      status: 'COMPLETED',
      provider: 'minimax-monitoring',
      model: 'MiniMax-M2.5',
      triage: { severity: 'HIGH', confidence: 0.92, summary: 'The site returned HTTP 500.', recommendedAction: 'CHECK_SITE', humanActionRequired: true }
    })
  });

  const denied = await app.inject({ method: 'POST', url: '/', payload });
  assert.equal(denied.statusCode, 401);

  const accepted = await app.inject({ method: 'POST', url: '/', headers: { 'x-ashbi-uptime-secret': 'test-secret' }, payload: { ...payload, credential: 'never store this' } });
  assert.equal(accepted.statusCode, 202);
  assert.deepEqual(accepted.json(), { accepted: true, incidentId: 'incident_1', triageStatus: 'COMPLETED', notificationDisposition: 'SHADOW' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].notificationDisposition, 'SHADOW');
  assert.equal(rows[0].rawPayload.credential, '[redacted]');
  await app.close();
});
