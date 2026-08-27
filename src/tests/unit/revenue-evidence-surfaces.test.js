import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildRevenueEvidenceManifest, REVENUE_EVIDENCE_COLLECTIONS } from '../../services/revenueEvidenceExport.service.js';

const root = new URL('../../../', import.meta.url);

test('revenue evidence has an authenticated admin route before the invoice id route', async () => {
  const source = await readFile(new URL('src/routes/invoice.routes.js', root), 'utf8');
  const exportIndex = source.indexOf("fastify.get('/evidence-export'");
  assert.ok(exportIndex > 0);
  assert.ok(exportIndex < source.indexOf("fastify.get('/:id'"));
  assert.match(source.slice(exportIndex, exportIndex + 900), /fastify\.authenticate/);
  assert.match(source.slice(exportIndex, exportIndex + 900), /request\.user\.role !== 'ADMIN'/);
  assert.match(source.slice(exportIndex, exportIndex + 900), /request\.prisma/);
  assert.match(source.slice(exportIndex, exportIndex + 900), /createRevenueEvidenceExport/);
});

test('invoice UI offers the evidence export only to administrators', async () => {
  const [apiSource, pageSource] = await Promise.all([
    readFile(new URL('web/src/lib/api.js', root), 'utf8'),
    readFile(new URL('web/src/pages/Invoices.jsx', root), 'utf8'),
  ]);
  assert.match(apiSource, /getRevenueEvidence:\s*\(\) =>\s*request\('\/invoices\/evidence-export'\)/);
  assert.match(pageSource, /isAdmin\s*&&[\s\S]{0,500}Export evidence/);
  assert.match(pageSource, /application\/json/);
  assert.match(pageSource, /URL\.revokeObjectURL/);
});

test('revenue evidence runbook documents offline verification and cutover limits', async () => {
  const source = await readFile(new URL('docs/revenue-evidence-export.md', root), 'utf8');
  assert.match(source, /npm run verify:revenue-evidence/);
  assert.match(source, /does not authorize.*cutover/i);
  assert.match(source, /recipient|email address/i);
  assert.match(source, /notes|access token/i);
});

test('offline verifier accepts intact exports and rejects changed records', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ashbi-evidence-'));
  try {
    const records = Object.fromEntries(REVENUE_EVIDENCE_COLLECTIONS.map(collection => [collection, []]));
    const valid = {
      format: 'ashbi-revenue-evidence-export', version: 1, organizationId: 'org-1', records,
      manifest: buildRevenueEvidenceManifest(records),
    };
    const validPath = path.join(directory, 'valid.json');
    const invalidPath = path.join(directory, 'invalid.json');
    await writeFile(validPath, JSON.stringify(valid));
    await writeFile(invalidPath, JSON.stringify({ ...valid, records: { ...records, invoices: [{ id: 'changed' }] } }));

    const accepted = spawnSync(process.execPath, ['scripts/verify-revenue-evidence-export.js', validPath], { cwd: fileURLToPath(root), encoding: 'utf8' });
    const rejected = spawnSync(process.execPath, ['scripts/verify-revenue-evidence-export.js', invalidPath], { cwd: fileURLToPath(root), encoding: 'utf8' });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /"valid": true/);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stdout, /"valid": false/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
