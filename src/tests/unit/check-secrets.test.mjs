import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const scanner = fileURLToPath(new URL('../../../scripts/check-secrets.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'secret-regression-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function scan(root) {
  return spawnSync(process.execPath, [scanner, root], { encoding: 'utf8' });
}
function roster(address = '123 Main St') {
  return JSON.stringify(Array.from({ length: 5 }, (_, i) => ({
    contactPerson: `Fixture ${i}`, email: `fixture${i}@example.invalid`,
    totalRevenueUsd: i, postalCode: 'A1A 1A1', address,
  })));
}
function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}
function localImport(t) {
  const root = fixture(t);
  git(root, 'init', '--quiet');
  mkdirSync(join(root, 'prisma'));
  writeFileSync(join(root, '.gitignore'), '/prisma/bonsai-seed.local.json\n');
  writeFileSync(join(root, 'prisma/bonsai-seed.local.json'), roster('123 Main Street'));
  return root;
}

test('approved ignored local import passes a repository scan', t => {
  const root = localImport(t);
  assert.equal(scan(root).status, 0);
  assert.equal(scan(join(root, 'prisma')).status, 0);
});
test('force-added local import is rejected without exposing values', t => {
  const root = localImport(t);
  git(root, 'add', '--force', 'prisma/bonsai-seed.local.json');
  const result = scan(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /value redacted/);
  assert.ok(!result.stderr.includes('123 Main Street'));
  assert.ok(!result.stderr.includes('fixture0@example.invalid'));
});
test('committed local import remains rejected despite its ignore rule', t => {
  const root = localImport(t);
  git(root, 'add', '--force', 'prisma/bonsai-seed.local.json');
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic scanner fixture');
  assert.equal(scan(root).status, 1);
});
test('unignored local import is rejected', t => {
  const root = localImport(t);
  writeFileSync(join(root, '.gitignore'), '');
  assert.equal(scan(root).status, 1);
});
test('standalone and nested lookalike local imports remain scanned', t => {
  const root = fixture(t);
  mkdirSync(join(root, 'prisma'));
  writeFileSync(join(root, 'prisma/bonsai-seed.local.json'), roster('123 Main Street'));
  assert.equal(scan(root).status, 1);
  git(root, 'init', '--quiet');
  writeFileSync(join(root, '.gitignore'), '**/bonsai-seed.local.json\n');
  mkdirSync(join(root, 'nested/prisma'), { recursive: true });
  writeFileSync(join(root, 'nested/prisma/bonsai-seed.local.json'), roster('123 Main Street'));
  assert.equal(scan(root).status, 1);
});
for (const suffix of ['Street', 'Drive', 'Avenue', 'Road', 'Boulevard', 'Lane', 'Court', 'Place',
  'St', 'Dr', 'Ave', 'Rd', 'Blvd', 'St.', 'Dr.', 'Ave.', 'Rd.', 'Blvd.']) {
  test(`rejects realistic roster addresses with suffix ${suffix}`, t => {
    const root = fixture(t);
    writeFileSync(join(root, 'clients.json'), roster(`2260 E University ${suffix}`));
    assert.equal(scan(root).status, 1);
  });
}
test('address protection works without email and with lowercase suffixes', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'clients.json'), JSON.stringify({
    contactPerson: 'Fixture', postalCode: 'A1A 1A1', address: '7 Main st.',
  }));
  assert.equal(scan(root).status, 1);
});
test('documentation-only roster and placeholder addresses pass', t => {
  const root = fixture(t);
  for (const address of ['', '123 Example St', '123 Sample Ave.', '123 Placeholder Road', '123 Fake Blvd']) {
    writeFileSync(join(root, 'clients.json'), roster(address));
    assert.equal(scan(root).status, 0);
  }
});
test('a non-documentation email roster remains rejected', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'clients.json'), roster('').replaceAll('@example.invalid', '@fixture-client.co'));
  assert.equal(scan(root).status, 1);
});
