import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateWithFloor, FLOOR_MIGRATIONS } from '../../../scripts/deploy/migrate-with-floor.mjs';

async function fixture(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ashbi-floor-test-'));
  try { await callback(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
test('recorded or already-applied security floor blocks an older candidate before migration', () => fixture(async root => {
  for (const recorded of [false, true]) {
    if (recorded) await fs.writeFile(path.join(root, 'rollback-floor'), FLOOR_MIGRATIONS[0]+'\n');
    let migrated = false;
    await assert.rejects(migrateWithFloor({ stateDir: root, migrationDir: root, readApplied: async () => recorded ? [] : FLOOR_MIGRATIONS,
      migrate: async () => { migrated = true; } }), /below/);
    assert.equal(migrated, false);
  }
}));
test('security floor persists after successful migration and after a later migration failure', () => fixture(async root => {
  for (const fails of [false, true]) {
    await fs.rm(path.join(root, 'rollback-floor'), { force: true });
    let calls = 0;
    const operation = migrateWithFloor({ stateDir: root, migrationDir: root, readApplied: async () => ++calls === 1 ? [] : FLOOR_MIGRATIONS,
      migrate: async () => { if (fails) throw new Error('synthetic later migration failure'); } });
    if (fails) await assert.rejects(operation, /floor retained/); else await operation;
    assert.equal((await fs.readFile(path.join(root, 'rollback-floor'), 'utf8')).trim(), [...FLOOR_MIGRATIONS].sort().join('\n'));
  }
}));
test('invalid persisted floor cannot become a migration path', () => fixture(async root => {
  await fs.writeFile(path.join(root, 'rollback-floor'), '../outside\n');
  await assert.rejects(migrateWithFloor({ stateDir: root, migrationDir: root }), /Invalid persisted/);
}));


test('OAuth confidentiality floor is retained by direct deploy, migration wrapper and backup catalog proof', async () => {
  const name='20261016060000_mcp_action_binding';
  assert.ok(FLOOR_MIGRATIONS.includes(name));
  const direct=await fs.readFile(new URL('../../../scripts/deploy-vps-direct.sh',import.meta.url),'utf8');
  const backup=await fs.readFile(new URL('../../../scripts/deploy/verify-production-backup.py',import.meta.url),'utf8');
  assert.ok(direct.match(/ROLLBACK_FLOOR_MIGRATIONS=\(([^)]+)\)/)[1].split(/\s+/).includes(name));
  const sql=backup.split('    sql = ')[1].split('\n')[0];
  assert.match(sql,/finished_at IS NOT NULL AND rolled_back_at IS NULL/);
  assert.ok(sql.includes("'"+name+"'"));
  assert.ok(sql.includes("'20260927030000_chat_message_visibility'"));
});
