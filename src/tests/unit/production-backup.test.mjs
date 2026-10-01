import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackupProof, productionBackup, verifiedProductionBackup } from '../../../scripts/deploy/production-backup.mjs';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const sha = 'a'.repeat(40), nonce = 'b'.repeat(32), now = Date.now();
const proof = { status: 'ok', releaseSha: sha, nonce, archive: '/opt/ashbi-platform/backups/encrypted/ashbi-full-20261001_003000-c81024e.tar.age', sha256: 'c'.repeat(64), bytes: 1000, completedAt: new Date(now).toISOString(), manifestVerified: true, databaseCatalogVerified: true, rollbackFloorMigrations: [] };
test('backup proof requires current nonce, exact candidate, verified recovery contents and a fresh artifact', () => {
  validateBackupProof(proof, sha, nonce, now);
  for (const patch of [{ status: 'failed' }, { releaseSha: 'd'.repeat(40) }, { nonce: 'e'.repeat(32) }, { manifestVerified: false }, { databaseCatalogVerified: false }, { bytes: 0 }, { archive: '/tmp/other.tar.age' }, { sha256: 'invalid' }, { completedAt: 'invalid' }, { completedAt: new Date(now - 300001).toISOString() }, { completedAt: new Date(now + 60001).toISOString() }]) {
    assert.throws(() => validateBackupProof({ ...proof, ...patch }, sha, nonce, now));
  }
});
test('missing SSH credentials or pinned host identity cannot start a backup', async () => {
  await assert.rejects(productionBackup({ RELEASE_SHA: sha }), /SSH configuration/);
});
test('persisted proof must belong to this runner and candidate must meet the database security floor', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ashbi-proof-test-'));
  try {
    const directory = path.join(root, 'ashbi-release-backup');
    await fs.mkdir(directory);
    const bytes = Buffer.from('synthetic encrypted archive for proof validation');
    await fs.writeFile(path.join(directory, path.basename(proof.archive)), bytes);
    const current = { ...proof, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, offServerCopyVerified: true, workflowRunId: '123', rollbackFloorMigrations: ['20260927030000_chat_message_visibility'] };
    const env = { RUNNER_TEMP: root, RELEASE_SHA: sha, GITHUB_RUN_ID: '123' };
    const save = value => fs.writeFile(path.join(directory, 'proof.json'), JSON.stringify(value));
    await save(current);
    await verifiedProductionBackup(env);
    await save({ ...current, workflowRunId: 'other' });
    await assert.rejects(verifiedProductionBackup(env), /this release workflow/);
    await save({ ...current, rollbackFloorMigrations: ['20990101000000_future_security_floor'] });
    await assert.rejects(verifiedProductionBackup(env), /below the database rollback floor/);
    await save({ ...current, rollbackFloorMigrations: ['../escape'] });
    await assert.rejects(verifiedProductionBackup(env), /mismatched/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
