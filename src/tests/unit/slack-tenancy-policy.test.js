import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantModelPolicy } from '../../utils/prisma-tenant-proxy.js';

test('Slack integration records are directly scoped to their organization', () => {
  for (const model of ['slackinstallation', 'slackchannelmapping', 'slackeventreceipt']) {
    assert.equal(tenantModelPolicy[model], 'direct', `${model} must not bypass tenant isolation`);
  }
});
