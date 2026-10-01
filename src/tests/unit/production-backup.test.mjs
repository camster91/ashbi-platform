import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackupProof, productionBackup } from '../../../scripts/deploy/production-backup.mjs';

const sha = 'a'.repeat(40), nonce = 'b'.repeat(32), now = Date.now();
const proof = { status: 'ok', releaseSha: sha, nonce, archive: '/opt/ashbi-platform/backups/encrypted/ashbi-full-20261001_003000-c81024e.tar.age', sha256: 'c'.repeat(64), bytes: 1000, completedAt: new Date(now).toISOString(), manifestVerified: true, databaseCatalogVerified: true };
test('backup proof requires current nonce, exact candidate, verified recovery contents and a fresh artifact', () => {
  validateBackupProof(proof, sha, nonce, now);
  for (const patch of [{ status: 'failed' }, { releaseSha: 'd'.repeat(40) }, { nonce: 'e'.repeat(32) }, { manifestVerified: false }, { databaseCatalogVerified: false }, { bytes: 0 }, { archive: '/tmp/other.tar.age' }, { sha256: 'invalid' }, { completedAt: 'invalid' }, { completedAt: new Date(now - 300001).toISOString() }, { completedAt: new Date(now + 60001).toISOString() }]) {
    assert.throws(() => validateBackupProof({ ...proof, ...patch }, sha, nonce, now));
  }
});
test('missing SSH credentials or pinned host identity cannot start a backup', async () => {
  await assert.rejects(productionBackup({ RELEASE_SHA: sha }), /SSH configuration/);
});
