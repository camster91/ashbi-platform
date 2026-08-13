import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantModelPolicy } from '../../utils/prisma-tenant-proxy.js';

test('Google Calendar connections are directly scoped to the owning organization', () => {
  assert.equal(tenantModelPolicy.googlecalendarconnection, 'direct');
});
