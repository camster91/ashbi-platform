import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('scripts/export-operating-destination-inventory.mjs', 'utf8');

test('destination inventory exporter is sandbox-bound and creates immutable owner-only evidence', () => {
  assert.match(source, /assessMigrationSandboxTarget/);
  assert.match(source, /requireMutationAuthorization: false/);
  assert.match(source, /fs\.openSync\(output, 'wx', 0o600\)/);
  assert.match(source, /fs\.chmodSync\(output, 0o600\)/);
  assert.match(source, /fs\.rmSync\(output, \{ force: true \}\)/);
});

test('destination inventory exporter uses tenant filters and bounded identity selects', () => {
  assert.match(source, /where: \{ organizationId, deletedAt: null \}/);
  assert.match(source, /project: \{ organizationId, deletedAt: null \}/);
  assert.match(source, /select: \{ id: true, organizationId: true \}/);
  assert.match(source, /select: \{ id: true, organizationId: true, clientId: true, name: true, status: true \}/);
  assert.match(source, /select: \{ id: true, projectId: true, title: true, status: true \}/);
  for (const forbidden of ['email: true', 'contactPerson: true', 'description: true', 'content: true', 'budget: true', 'credentials: true', 'invoice']) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }
});
