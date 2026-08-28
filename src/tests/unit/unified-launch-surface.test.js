import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { loadUnifiedLaunchReadiness } from '../../services/unifiedLaunchReport.service.js';

test('launch readiness stays failed and path-free when no manifest is configured', () => {
  assert.deepEqual(loadUnifiedLaunchReadiness(''), {
    configured: false,
    ready: false,
    checks: [{
      id: 'manifest-configured',
      ok: false,
      message: 'Configure the owner-controlled unified launch manifest before evaluating readiness.',
    }],
  });
});
test('launch readiness stays failed and path-free when configured evidence is unreadable', () => {
  const report = loadUnifiedLaunchReadiness('C:/private/owner-evidence/missing.json');
  assert.equal(report.configured, true);
  assert.equal(report.ready, false);
  assert.equal(report.checks[0].id, 'manifest-readable');
  assert.doesNotMatch(JSON.stringify(report), /private|owner-evidence|missing\.json/i);
});

test('admin launch-readiness route and page are wired as a read-only surface', () => {
  const route = fs.readFileSync(new URL('../../routes/launch-readiness.routes.js', import.meta.url), 'utf8');
  const index = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../../../web/src/lib/api.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../../../web/src/App.jsx', import.meta.url), 'utf8');
  const layout = fs.readFileSync(new URL('../../../web/src/components/Layout.jsx', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../../../web/src/pages/LaunchReadiness.jsx', import.meta.url), 'utf8');
  assert.match(route, /fastify\.authenticate, fastify\.adminOnly/);
  assert.match(route, /fastify\.get\('\/'/);
  assert.doesNotMatch(route, /fastify\.(post|put|patch|delete)/);
  assert.match(index, /launchReadinessRoutes[\s\S]*\/api\/launch-readiness/);
  assert.match(api, /getUnifiedLaunchReadiness:[\s\S]*\/launch-readiness/);
  assert.match(app, /AdminRoute><LaunchReadiness/);
  assert.match(layout, /Launch Readiness/);
  assert.match(page, /cannot deploy, import, charge, send, publish, or cancel Bonsai/);
});
