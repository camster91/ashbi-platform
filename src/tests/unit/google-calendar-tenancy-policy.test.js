import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantModelPolicy } from '../../utils/prisma-tenant-proxy.js';

test('Google Calendar connections are directly scoped to the owning organization', () => {
  assert.equal(tenantModelPolicy.googlecalendarconnection, 'direct');
});

test('the Google Calendar OAuth callback is tenancy-exempt like the Slack one', async () => {
  const { isTenancyExemptUrl } = await import('../../middleware/tenancy.js');
  // The provider's redirect carries no session cookie (SameSite=Strict in
  // production); the signed, browser-bound state authenticates it instead.
  assert.equal(isTenancyExemptUrl('/api/google-calendar/oauth/callback?code=c&state=s'), true);
  assert.equal(isTenancyExemptUrl('/api/slack/oauth/callback?code=c&state=s'), true);
  // Every other Google Calendar route stays tenant-scoped.
  for (const url of ['/api/google-calendar/oauth/start', '/api/google-calendar/connection', '/api/google-calendar/connection/disconnect']) {
    assert.equal(isTenancyExemptUrl(url), false, url);
  }
});
