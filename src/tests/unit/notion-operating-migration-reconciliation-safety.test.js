import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const script = fs.readFileSync('scripts/reconcile-notion-operating-migration.mjs', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

test('reconciliation CLI is immutable, owner-only, package-addressable, and read-only', () => {
  assert.match(script, /prepareNotionOperatingMigrationReconciliation/);
  assert.match(script, /verifyNotionOperatingMigrationReconciliation/);
  assert.match(script, /fs\.openSync\(output, 'wx', 0o600\)/);
  assert.match(script, /fs\.chmodSync\(output, 0o600\)/);
  assert.doesNotMatch(script, /fetch\s*\(|PrismaClient|stripe\.|mailgun\./);
  assert.equal(pkg.scripts['reconcile:notion-operating-migration'], 'node scripts/reconcile-notion-operating-migration.mjs');
});
