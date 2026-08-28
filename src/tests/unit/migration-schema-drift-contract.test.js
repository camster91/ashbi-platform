import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('prisma/schema.prisma', 'utf8');

test('external chat migration makes the optional author foreign key set null', () => {
  const migration = readFileSync(
    'prisma/migrations/20260813140000_slack_external_chat_messages/migration.sql',
    'utf8',
  );

  assert.match(migration, /DROP CONSTRAINT "chat_messages_authorId_fkey"/);
  assert.match(
    migration,
    /ADD CONSTRAINT "chat_messages_authorId_fkey"[\s\S]*ON DELETE SET NULL ON UPDATE CASCADE/,
  );
});

test('intentional delivery and soft-delete indexes are represented in the Prisma schema', () => {
  const deliveryModel = schema.match(/model InvoiceDeliveryEvent \{[\s\S]*?\n\}/)?.[0] || '';
  const milestoneModel = schema.match(/model Milestone \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(deliveryModel, /@@index\(\[providerEventId\]\)/);
  assert.match(milestoneModel, /@@index\(\[deletedAt\]\)/);
});

test('report idempotency migration uses the Prisma requestId column name', () => {
  const migration = readFileSync(
    'prisma/migrations/20260828090000_report_generation_idempotency/migration.sql',
    'utf8',
  );

  assert.match(migration, /ADD COLUMN "requestId" TEXT/);
  assert.match(migration, /ON "reports"\("requestId"\)/);
  assert.doesNotMatch(migration, /request_id/);
});

test('migration index names use Prisma-compatible identifiers within PostgreSQL limits', () => {
  const operatingSourceMigration = readFileSync(
    'prisma/migrations/20260827022000_operating_source_registry/migration.sql',
    'utf8',
  );
  const reviewMigration = readFileSync(
    'prisma/migrations/20260828110000_migration_review_workflow/migration.sql',
    'utf8',
  );
  const generationMigration = readFileSync(
    'prisma/migrations/20260828113000_migration_review_packet_generations/migration.sql',
    'utf8',
  );
  const expectedNames = [
    'operating_source_records_organizationId_sourceSystem_entity_key',
    'operating_source_records_organizationId_entityType_destinat_idx',
    'migration_review_decisions_organizationId_packetId_candidat_idx',
    'migration_review_packets_organizationId_kind_evidenceFinger_key',
    'migration_review_packets_organizationId_kind_sourceReviewSh_idx',
  ];
  const combined = `${operatingSourceMigration}\n${reviewMigration}\n${generationMigration}`;

  for (const name of expectedNames) {
    assert.ok(Buffer.byteLength(name, 'utf8') <= 63, `${name} exceeds PostgreSQL's identifier limit`);
    assert.match(combined, new RegExp(`"${name}"`));
  }
});
