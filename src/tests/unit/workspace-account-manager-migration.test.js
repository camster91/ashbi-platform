import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const migration = fs.readFileSync(new URL('../../../prisma/migrations/20261016090000_workspace_account_manager_pilot/migration.sql', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');

test('pilot migration names and foreign-key actions match Prisma generated SQL without PostgreSQL implicit truncation', () => {
  // Pure schema-to-SQL compilation; does not connect to or migrate a database.
  const expected = execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'],
    { cwd: root, encoding: 'utf8', timeout: 30000, stdio: ['ignore','pipe','pipe'] });
  const indexes = [...expected.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"\([^;]+;/g)]
    .filter(m => m[2].startsWith('workspace_account_manager_') || /sourceChannelId|sourceBindingId/.test(m[0])
      || ['projects_id_organizationId_key','client_agent_runs_id_organizationId_key','workspace_chat_messages_id_organizationId_key'].includes(m[1]));
  assert.equal(indexes.length, 23);
  for (const [, name] of indexes) {
    assert.ok(migration.includes('"'+name+'"'), 'SQL must explicitly quote exact Prisma name: '+name);
    assert.ok(Buffer.byteLength(name) <= 63);
  }
  const keys = [...expected.matchAll(/ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \(([^)]+)\)[^;]+;/g)]
    .filter(m => m[1].startsWith('workspace_account_manager_') || /sourceChannelId|sourceBindingId/.test(m[0]));
  assert.equal(keys.length, 15);
  for (const fk of keys) {
    const line = migration.split('\n').find(line => line.includes('CONSTRAINT "'+fk[2]+'"'));
    assert.ok(line, 'Explicit FK name: '+fk[2]);
    assert.match(line, /ON UPDATE CASCADE/);
    assert.match(line, /ON DELETE (?:CASCADE|RESTRICT)/);
    assert.equal(/ON DELETE CASCADE/.test(line), /ON DELETE CASCADE/.test(fk[0]));
  }
  for (const model of ['WorkspaceAccountManagerBinding','WorkspaceAccountManagerInvocation']) {
    const block = schema.split('model '+model+' {')[1].split('\n}')[0];
    for (const line of block.split('\n').filter(line => /@@(?:index|unique)|@relation|@unique/.test(line))) assert.match(line, /map: "/);
  }
});

test('shared message index uses exact quoted IF NOT EXISTS name so earlier attention migration is compatible', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "workspace_chat_messages_id_organizationId_key" ON workspace_chat_messages/);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX IF NOT EXISTS workspace_chat_messages_id_organizationId_key/);
  // Behavior guards remain present: metadata repair does not remove safety checks.
  for (const name of ['workspace_agent_authority','workspace_agent_invocation_guard','workspace_agent_run_delivery_guard','workspace_agent_delivery_pair_required']) assert.ok(migration.includes(name));
});
