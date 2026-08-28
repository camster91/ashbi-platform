import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const cli = fs.readFileSync('scripts/execute-notion-operating-migration.mjs', 'utf8');
const executor = fs.readFileSync('src/services/notionOperatingMigrationExecutor.service.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

test('execution CLI requires exact recomputation, confirmation, backup, approval, and a bound sandbox', () => {
  assert.match(cli, /verifyNotionOperatingMigrationPlan/);
  assert.match(cli, /verification\.valid \|\| !verification\.ready/);
  assert.match(cli, /process\.argv\.includes\('--confirm'\)/);
  assert.match(cli, /requireMutationAuthorization: true/);
  assert.match(cli, /ASHBI_SANDBOX_BACKUP_REFERENCE/);
  assert.match(cli, /ASHBI_SANDBOX_APPROVAL_REFERENCE/);
  assert.match(cli, /fs\.openSync\(resultPath, 'wx', 0o600\)/);
  assert.match(cli, /status: 'RESERVED'/);
  assert.equal(pkg.scripts['execute:notion-operating-migration'], 'node scripts/execute-notion-operating-migration.mjs');
});

test('executor uses a serializable transaction and has no Notion, Bonsai, owner, or financial mutation surface', () => {
  assert.match(executor, /\$transaction/);
  assert.match(executor, /isolationLevel: 'Serializable'/);
  assert.match(executor, /assertSnapshotUnchanged/);
  assert.match(executor, /operatingSourceRecord\.create/);
  assert.doesNotMatch(executor, /fetch\s*\(/);
  assert.doesNotMatch(executor, /invoice\.(create|update|delete)/);
  assert.doesNotMatch(executor, /payment\.(create|update|delete)/);
  assert.doesNotMatch(executor, /user\.(create|update|delete)/);
});
