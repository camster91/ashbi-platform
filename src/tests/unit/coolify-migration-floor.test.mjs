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
    assert.equal((await fs.readFile(path.join(root, 'rollback-floor'), 'utf8')).trim(), FLOOR_MIGRATIONS[0]);
  }
}));
test('invalid persisted floor cannot become a migration path', () => fixture(async root => {
  await fs.writeFile(path.join(root, 'rollback-floor'), '../outside\n');
  await assert.rejects(migrateWithFloor({ stateDir: root, migrationDir: root }), /Invalid persisted/);
}));
