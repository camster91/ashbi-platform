import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertApprovedBonsaiDryRun, fingerprintBonsaiPlan, fingerprintInputInventory, sourceDifferences } from '../../services/bonsai-import-evidence.service.js';

const inventory = [
  { filename: 'projects.csv', present: true, rows: 2, sha256: 'bbb' },
  { filename: 'clients.csv', present: true, rows: 1, sha256: 'aaa' },
];

test('source fingerprint is deterministic and changes with file evidence', () => {
  const first = fingerprintInputInventory(inventory);
  assert.equal(first, fingerprintInputInventory([...inventory].reverse()));
  assert.notEqual(first, fingerprintInputInventory([{ ...inventory[0], rows: 3 }, inventory[1]]));
  assert.notEqual(first, fingerprintInputInventory([{ ...inventory[0], sha256: 'changed' }, inventory[1]]));
});

test('confirmed import requires the exact clean dry-run source and tenant', () => {
  const sourceFingerprint = fingerprintInputInventory(inventory);
  const planFingerprint = fingerprintBonsaiPlan({ sourceFingerprint, stats: { errors: [] } });
  const approved = { mode: 'dry-run', complete: true, organization: { id: 'org-a' }, stats: { errors: [] }, sourceFingerprint, planFingerprint };
  const current = { organizationId: 'org-a', sourceFingerprint, planFingerprint };
  assert.equal(assertApprovedBonsaiDryRun(approved, current), true);
  assert.throws(() => assertApprovedBonsaiDryRun(approved, { ...current, organizationId: 'org-b' }), /organization/i);
  assert.throws(() => assertApprovedBonsaiDryRun(approved, { ...current, sourceFingerprint: 'changed' }), /source changed/i);
  assert.throws(() => assertApprovedBonsaiDryRun(approved, { ...current, planFingerprint: 'changed' }), /plan changed/i);
  assert.throws(() => assertApprovedBonsaiDryRun({ ...approved, stats: { errors: ['conflict'] } }, current), /unresolved/i);
});

test('existing Hub values are compared without treating absent source fields as overwrites', () => {
  assert.deepEqual(sourceDifferences(
    { name: 'Acme', phone: '', status: 'DESIGN_DEV' },
    { name: 'Acme', phone: 'private', status: 'ON_HOLD' },
    ['name', 'phone', 'status'],
  ), ['status']);
});

test('Bonsai importer has no guessed FX tiering and requires approved evidence for confirm', () => {
  const source = readFileSync('scripts/import-bonsai-full.js', 'utf8');
  assert.doesNotMatch(source, /0\.74|totalUsdEquiv/);
  assert.doesNotMatch(source, /prisma\.client\.update|prisma\.project\.update/);
  assert.match(source, /--approved-summary/);
  assert.match(source, /assertApprovedBonsaiDryRun/);
  assert.match(source, /sourceFingerprint/);
  assert.match(source, /planFingerprint/);
  assert.match(source, /Refusing import without --summary-file/);
  assert.match(source, /state: 'RESERVED'/);
  assert.match(source, /Existing Hub record differs/);
  assert.match(source, /duplicate Bonsai source identity/);
  assert.match(source, /duplicate source rows differ/);
});
