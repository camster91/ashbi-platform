import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inventoryMigrationSource, runInventory } from '../../../scripts/inventory-migration-source.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ashbi-inventory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputDir = path.join(root, 'export');
  await mkdir(inputDir);
  return { root, inputDir };
}

test('inventory preserves source bytes, hashes nested files and surfaces database/assets gaps', async t => {
  const { inputDir } = await fixture(t);
  await mkdir(path.join(inputDir, 'nested'));
  await writeFile(path.join(inputDir, 'nested', 'page.md'), '# Private content');
  await writeFile(path.join(inputDir, 'records.csv'), 'Name\nClient');
  await writeFile(path.join(inputDir, 'image.png'), Buffer.from([1, 2, 3]));
  const first = await inventoryMigrationSource({ source: 'notion', inputDir });
  const second = await inventoryMigrationSource({ source: 'notion', inputDir });
  assert.equal(first.fileCount, 3);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.equal(first.migrationReady, false);
  assert.equal(first.findings.filter(f => f.code === 'MAPPING_REQUIRED').length, 2);
  assert.ok(!JSON.stringify(first).includes('Private content'));
  assert.equal(await readFile(path.join(inputDir, 'nested', 'page.md'), 'utf8'), '# Private content');
  await writeFile(path.join(inputDir, 'records.csv'), 'Name\nChanged');
  assert.notEqual((await inventoryMigrationSource({ source: 'notion', inputDir })).manifestSha256, first.manifestSha256);
});

test('reports refuse overwrite, source-directory writes and live-import flags', async t => {
  const { root, inputDir } = await fixture(t);
  await writeFile(path.join(inputDir, 'board.json'), '{}');
  const summary = path.join(root, 'report.json');
  const args = ['--source', 'fluentboards', '--input-dir', inputDir, '--summary-file', summary];
  await runInventory(args);
  const saved = await readFile(summary, 'utf8');
  await assert.rejects(runInventory(args), { code: 'EEXIST' });
  assert.equal(await readFile(summary, 'utf8'), saved);
  await assert.rejects(runInventory([...args.slice(0, 5), path.join(inputDir, 'report.json')]), /outside/);
  await assert.rejects(runInventory([...args, '--confirm', 'true']), /Usage/);
  assert.equal(JSON.parse(saved).files[0].coverage, 'board-mapping-required');
});

test('symlink contents are never followed', async t => {
  const { root, inputDir } = await fixture(t);
  const outside = path.join(root, 'private.txt');
  await writeFile(outside, 'secret');
  try { await symlink(outside, path.join(inputDir, 'link')); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Host cannot create symlinks'); return; } throw error; }
  const report = await inventoryMigrationSource({ source: 'bonsai', inputDir });
  assert.equal(report.fileCount, 0);
  assert.ok(report.findings.some(f => f.code === 'SYMLINK_REFUSED'));
});
