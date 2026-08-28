import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createWeeklyReportOnce } from '../../services/reportGeneration.service.js';

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';

function harness() {
  const state = { report: null, generated: 0, created: 0 };
  const prisma = {
    client: {
      findFirst: async ({ where }) => (where.id === 'client-1' ? { id: 'client-1', name: 'Client One' } : null),
    },
    report: {
      findFirst: async ({ where }) => (
        state.report?.requestId === where.requestId && state.report?.clientId === where.clientId
          ? state.report
          : null
      ),
      create: async ({ data }) => {
        state.created += 1;
        state.report = { id: 'report-1', ...data, client: { id: 'client-1', name: 'Client One' } };
        return state.report;
      },
    },
  };
  const generate = async (clientId, options) => {
    state.generated += 1;
    assert.equal(clientId, 'client-1');
    assert.equal(options.prismaClient, prisma);
    return { clientId, subject: 'Weekly update', body: 'Completed work and next steps.' };
  };
  return { prisma, generate, state };
}

test('authenticated reporting persistence creates once and reuses the same request', async () => {
  const { prisma, generate, state } = harness();
  const first = await createWeeklyReportOnce({ prisma, clientId: 'client-1', requestId: REQUEST_ID, generate });
  const replay = await createWeeklyReportOnce({ prisma, clientId: 'client-1', requestId: REQUEST_ID, generate });
  assert.equal(first.reused, false);
  assert.equal(replay.reused, true);
  assert.equal(replay.report.id, first.report.id);
  assert.equal(state.generated, 1);
  assert.equal(state.created, 1);
});

test('report generation validates client, request identity, and generated ownership', async () => {
  const { prisma, generate } = harness();
  await assert.rejects(
    createWeeklyReportOnce({ prisma, clientId: 'missing', requestId: REQUEST_ID, generate }),
    error => error?.code === 'CLIENT_NOT_FOUND',
  );
  await assert.rejects(
    createWeeklyReportOnce({ prisma, clientId: 'client-1', requestId: 'retry-me', generate }),
    /UUID requestId/,
  );
  await assert.rejects(
    createWeeklyReportOnce({
      prisma,
      clientId: 'client-1',
      requestId: REQUEST_ID,
      generate: async () => ({ clientId: 'client-other', subject: 'Wrong', body: 'Wrong tenant' }),
    }),
    /another client/,
  );
});

test('a concurrent unique-key winner is recovered without a second durable report', async () => {
  const winner = {
    id: 'report-winner', requestId: REQUEST_ID, clientId: 'client-1',
    subject: 'Weekly update', body: 'Winner', client: { id: 'client-1', name: 'Client One' },
  };
  let lookup = 0;
  const prisma = {
    client: { findFirst: async () => ({ id: 'client-1', name: 'Client One' }) },
    report: {
      findFirst: async () => { lookup += 1; return lookup === 1 ? null : winner; },
      create: async () => { const error = new Error('unique'); error.code = 'P2002'; throw error; },
    },
  };
  const result = await createWeeklyReportOnce({
    prisma,
    clientId: 'client-1',
    requestId: REQUEST_ID,
    generate: async clientId => ({ clientId, subject: 'Weekly update', body: 'Draft' }),
  });
  assert.equal(result.reused, true);
  assert.equal(result.report.id, 'report-winner');
});

test('staff reports are authenticated, tenant-scoped, wired into the Hub, and never auto-sent', () => {
  const route = fs.readFileSync('src/routes/report.routes.js', 'utf8');
  const botRoute = fs.readFileSync('src/routes/bot.routes.js', 'utf8');
  const registrar = fs.readFileSync('src/domains/client-delivery/register-work-management-routes.js', 'utf8');
  const service = fs.readFileSync('src/services/reportGeneration.service.js', 'utf8');
  const page = fs.readFileSync('web/src/pages/Reports.jsx', 'utf8');
  const app = fs.readFileSync('web/src/App.jsx', 'utf8');
  const layout = fs.readFileSync('web/src/components/Layout.jsx', 'utf8');
  const api = fs.readFileSync('web/src/lib/api.js', 'utf8');
  assert.equal((route.match(/fastify\.(?:get|post)\(/g) ?? []).length, 3);
  assert.equal((route.match(/fastify\.authenticate/g) ?? []).length, 3);
  assert.match(route, /request\.prisma\.report\.findMany/);
  assert.match(route, /createWeeklyReportOnce\(\{[\s\S]*prisma: request\.prisma/);
  assert.match(botRoute, /createWeeklyReportOnce\(\{[\s\S]*prisma: request\.prisma/);
  assert.doesNotMatch(botRoute, /fastify\.prisma\.report\.(?:findMany|create)/);
  assert.doesNotMatch(service, /\.send\(|mailgun|stripe|fetch\s*\(/i);
  assert.match(registrar, /reportRoutes[\s\S]*\/api\/reports/);
  assert.match(app, /pages\/Reports/);
  assert.match(app, /path="\/reports"/);
  assert.match(layout, /name: 'Reports', href: '\/reports'/);
  assert.match(api, /generateWeeklyReport[\s\S]*requestId/);
  assert.match(page, /Retry same request/);
  assert.match(page, /Nothing is emailed automatically/);
});
