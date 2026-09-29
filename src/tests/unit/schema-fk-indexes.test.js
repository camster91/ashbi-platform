/**
 * Every relation foreign-key column must lead some index (an @@index,
 * @@unique, @@id, or a single-column @unique/@id), otherwise joins, cascades
 * and "list children of X" queries scan the child table. Intentional
 * exceptions go in ALLOWED_UNINDEXED_FOREIGN_KEYS with the reason.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const SCHEMA = fs.readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');

// Actor/audit references: rows are always listed through their parent (thread,
// project, invoice...), never by who wrote them, and users are deactivated
// rather than deleted, so the FK is not on a hot path.
const ACTOR = 'actor reference; queried via the parent row, users are deactivated not deleted';

/** `Model.field` → reason. Keep this short; prefer adding the index. */
export const ALLOWED_UNINDEXED_FOREIGN_KEYS = {
  'InternalNote.authorId': ACTOR,
  'Response.draftedById': ACTOR,
  'Response.approvedById': ACTOR,
  'ChatMessage.authorId': ACTOR,
  'Note.authorId': ACTOR,
  'Attachment.uploadedById': ACTOR,
  'TaskComment.authorId': ACTOR,
  'CalendarEvent.createdById': ACTOR,
  'ProposalVersion.createdById': ACTOR,
  'Proposal.createdById': ACTOR,
  'Contract.createdById': ACTOR,
  'Invoice.createdById': ACTOR,
  'Snippet.createdById': ACTOR,
};

export function parseModels(schema) {
  const models = [];
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    models.push({ name: match[1], body: match[2] });
  }
  return models;
}

function listFields(text) {
  return text.split(',').map((part) => part.trim().split(/[\s(]/)[0]).filter(Boolean);
}

export function foreignKeyColumns(body) {
  const keys = [];
  for (const line of body.split('\n')) {
    const code = line.replace(/\/\/.*$/, '');
    const relation = code.match(/@relation\(([^)]*)\)/);
    if (!relation) continue;
    const fields = relation[1].match(/fields:\s*\[([^\]]*)\]/);
    if (fields) keys.push(listFields(fields[1]));
  }
  return keys;
}

export function indexedPrefixes(body) {
  const indexes = [];
  for (const match of body.matchAll(/@@(?:index|unique|id)\(\s*(?:fields:\s*)?\[([^\]]*)\]/g)) {
    indexes.push(listFields(match[1]));
  }
  for (const line of body.split('\n')) {
    const code = line.replace(/\/\/.*$/, '');
    const field = code.trim().split(/\s+/)[0];
    if (/@(?:id|unique)\b/.test(code) && !code.trim().startsWith('@@')) indexes.push([field]);
  }
  return indexes;
}

export function missingForeignKeyIndexes(schema) {
  const missing = [];
  for (const { name, body } of parseModels(schema)) {
    const indexes = indexedPrefixes(body);
    for (const columns of foreignKeyColumns(body)) {
      const covered = indexes.some((index) => columns.every((column, position) => index[position] === column));
      if (!covered) missing.push(`${name}.${columns.join('+')}`);
    }
  }
  return missing;
}

test('the schema parser sees relations and indexes', () => {
  const models = parseModels(SCHEMA);
  assert.ok(models.length > 50, 'models parsed');
  const sample = `
  id String @id
  invoiceId String
  invoice Invoice @relation(fields: [invoiceId], references: [id])
  userId String @unique
  user User @relation("x", fields: [userId], references: [id])
  @@index([createdAt])`;
  assert.deepEqual(foreignKeyColumns(sample), [['invoiceId'], ['userId']]);
  assert.deepEqual(missingForeignKeyIndexes(`model A {${sample}\n}`), ['A.invoiceId']);
});

test('every relation foreign key leads an index', () => {
  const missing = missingForeignKeyIndexes(SCHEMA).filter((key) => !Object.hasOwn(ALLOWED_UNINDEXED_FOREIGN_KEYS, key));
  assert.deepEqual(missing, [], `add @@index for: ${missing.join(', ')}`);
  const stale = Object.keys(ALLOWED_UNINDEXED_FOREIGN_KEYS)
    .filter((key) => !missingForeignKeyIndexes(SCHEMA).includes(key));
  assert.deepEqual(stale, [], 'remove allowlist entries that are now indexed');
});

test('the FK index migration fails fast on locks; the messages swap runs concurrently, one statement per file', () => {
  const dir = new URL('../../../prisma/migrations/', import.meta.url);
  const read = (name) => fs.readFileSync(new URL(`${name}/migration.sql`, dir), 'utf8');
  const statements = (sql) => sql.replace(/--.*$/gm, '').split(';').map((part) => part.trim()).filter(Boolean);

  const fk = read('20260927070000_fk_indexes');
  // Explicit transaction: Prisma does not wrap PostgreSQL migrations itself,
  // so without it a failure part-way would leave earlier indexes committed.
  assert.equal(statements(fk)[0], 'BEGIN');
  assert.match(statements(fk)[1], /^SET LOCAL lock_timeout = '5s'$/);
  assert.equal(statements(fk).at(-1), 'COMMIT');
  assert.doesNotMatch(fk.replace(/--.*$/gm, ''), /"messages"|DROP INDEX|CONCURRENTLY/);

  const create = statements(read('20260927070100_messages_thread_received_index'));
  assert.equal(create.length, 1);
  assert.match(create[0], /^CREATE INDEX CONCURRENTLY "messages_threadId_receivedAt_idx" ON "messages"\("threadId", "receivedAt"\)$/);
  const drop = statements(read('20260927070200_drop_messages_thread_index'));
  assert.deepEqual(drop, ['DROP INDEX CONCURRENTLY IF EXISTS "messages_threadId_idx"']);
});
