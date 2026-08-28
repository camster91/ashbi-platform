import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { tenantModelPolicy } from '../../utils/prisma-tenant-proxy.js';

test('operating source registry preserves independent Notion and Bonsai identities per tenant', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const migration = readFileSync('prisma/migrations/20260827022000_operating_source_registry/migration.sql', 'utf8');
  assert.match(schema, /model OperatingSourceRecord/);
  assert.match(schema, /@@unique\(\[organizationId, sourceSystem, entityType, sourceId\]\)/);
  assert.match(schema, /destinationId\s+String\?/);
  assert.match(schema, /decisionFingerprint\s+String\?/);
  assert.match(migration, /CREATE TABLE "operating_source_records"/);
  assert.match(migration, /CHECK \("sourceSystem" IN \('NOTION', 'BONSAI'\)\)/);
  assert.match(migration, /CHECK \("entityType" IN \('PROJECT', 'TASK'\)\)/);
  assert.match(migration, /CHECK \("outcome" IN \('IMPORTED', 'LINKED', 'RETAINED_SOURCE', 'EXCLUDED', 'REPAIR_REQUIRED'\)\)/);
  assert.match(migration, /"sourceFingerprint" ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.equal(tenantModelPolicy.operatingsourcerecord, 'direct');
});

test('operating source registry has no source deletion or merge cascade', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const block = schema.slice(schema.indexOf('model OperatingSourceRecord'), schema.indexOf('model SlackInstallation'));
  assert.doesNotMatch(block, /Project\?|Task\?/);
  assert.doesNotMatch(block, /deletedAt/);
  assert.match(block, /outcome\s+String/);
  assert.match(block, /sourceFingerprint\s+String/);
});
