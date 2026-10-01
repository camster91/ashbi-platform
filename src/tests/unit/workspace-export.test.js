import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import prismaPkg from '@prisma/client';
import {
  EXPORT_ENTITIES,
  EXCLUDED_MODELS,
  EXCLUDED_FIELD_REASONS,
  EXPORTED_DIGEST_FIELDS,
  SECRET_FIELD_PATTERN,
  buildExclusions,
  checksumLine,
  exportFilePath,
  exportWorkspace,
  omitArgs,
  pageWhere,
  paginateEntity,
  parseExportArgs,
  prepareOutputDir,
  resolveStoredUploadPath,
  safeExportFileName,
  serializeRow,
  verifyWorkspaceExportDirectory,
} from '../../services/workspace-export.service.js';

const models = prismaPkg.Prisma.dmmf.datamodel.models;

test('every Prisma model is either exported or explicitly excluded, never both', () => {
  const exported = new Set(EXPORT_ENTITIES.map((entity) => entity.model));
  const excluded = new Set(Object.keys(EXCLUDED_MODELS));
  for (const model of models) {
    assert.ok(exported.has(model.name) !== excluded.has(model.name), `${model.name} must be exported xor excluded`);
  }
  const known = new Set(models.map((model) => model.name));
  for (const name of [...exported, ...excluded]) assert.ok(known.has(name), `${name} is a Prisma model`);
  assert.equal(new Set(EXPORT_ENTITIES.map((entity) => entity.name)).size, EXPORT_ENTITIES.length, 'entity names are unique');
});

test('no exported column looks like a secret unless it is signature/content evidence', () => {
  for (const entity of EXPORT_ENTITIES) {
    const model = models.find((candidate) => candidate.name === entity.model);
    const scalars = model.fields.filter((field) => field.kind === 'scalar' || field.kind === 'enum' || field.kind === 'unsupported').map((field) => field.name);
    for (const field of entity.omit ?? []) {
      assert.ok(scalars.includes(field), `${entity.model}.${field} exists`);
      assert.ok(EXCLUDED_FIELD_REASONS[field], `${field} has a documented reason`);
    }
    const exported = scalars.filter((field) => !(entity.omit ?? []).includes(field));
    for (const field of exported) {
      if (EXPORTED_DIGEST_FIELDS.has(field) || /Sha256$/.test(field)) continue;
      assert.doesNotMatch(field, SECRET_FIELD_PATTERN, `${entity.model}.${field} looks secret; omit it or document why it is evidence`);
    }
  }
});

test('every entity is scoped by the organization id', () => {
  for (const entity of EXPORT_ENTITIES) {
    const where = JSON.stringify(entity.where('org-under-test'));
    assert.match(where, /org-under-test/, `${entity.name} filters by organization`);
  }
});

test('parseExportArgs: directory mode, defaults and validation', () => {
  assert.deepEqual(parseExportArgs(['--organization-id', 'org1', '--output-dir', 'out']), {
    mode: 'directory', organizationId: 'org1', outputDir: 'out', includeFiles: true, uploadsDir: null, pageSize: 500,
  });
  const noFiles = parseExportArgs(['--organization-id', 'org1', '--output-dir', 'out', '--no-files', '--uploads-dir', '/srv/uploads', '--page-size', '50']);
  assert.equal(noFiles.includeFiles, false);
  assert.equal(noFiles.uploadsDir, '/srv/uploads');
  assert.equal(noFiles.pageSize, 50);
  assert.equal(parseExportArgs(['--output-dir', 'out'], { EXPORT_ORGANIZATION_ID: 'env-org' }).organizationId, 'env-org');
  assert.match(parseExportArgs(['--output-dir', 'out']).error, /organization-id/);
  assert.match(parseExportArgs(['--organization-id', 'o']).error, /--output-dir is required/);
  assert.match(parseExportArgs(['--organization-id', 'o', '--output-dir', 'x', '--include-files', '--no-files']).error, /mutually exclusive/);
  assert.match(parseExportArgs(['--organization-id', 'o', '--output-dir', 'x', '--page-size', '0']).error, /page-size/);
  assert.match(parseExportArgs(['--organization-id', 'o', '--output-dir']).error, /needs a value/);
  assert.match(parseExportArgs(['--organization-id', 'o', '--output-dir', 'x', '--bogus']).error, /Unknown argument/);
});

test('parseExportArgs: legacy single-file mode keeps requiring --confirm', () => {
  assert.deepEqual(parseExportArgs(['--organization-id', 'o', '--output', 'x.json', '--confirm']), { mode: 'legacy', organizationId: 'o', output: 'x.json' });
  assert.match(parseExportArgs(['--organization-id', 'o', '--output', 'x.json']).error, /--confirm/);
  assert.match(parseExportArgs(['--organization-id', 'o', '--output', 'x.json', '--output-dir', 'd', '--confirm']).error, /mutually exclusive/);
});

test('resolveStoredUploadPath keeps files inside the upload root', () => {
  const root = path.resolve('/srv/uploads');
  assert.deepEqual(resolveStoredUploadPath('/uploads/a.png', root), { absolutePath: path.join(root, 'a.png') });
  assert.equal(resolveStoredUploadPath('/uploads/../etc/passwd', root).code, 'FILE_PATH_INVALID');
  assert.equal(resolveStoredUploadPath('/uploads/', root).code, 'FILE_PATH_INVALID');
  assert.equal(resolveStoredUploadPath('/uploads/quarantine/x.png', root).code, 'FILE_QUARANTINED');
  // Normalized before the quarantine check.
  assert.equal(resolveStoredUploadPath('/uploads/./quarantine/bad.exe', root).code, 'FILE_QUARANTINED');
  // Only flat names, or brand logos one level down, are accepted.
  assert.deepEqual(resolveStoredUploadPath('/uploads/brand/logo-1.png', root), { absolutePath: path.join(root, 'brand', 'logo-1.png') });
  assert.equal(resolveStoredUploadPath('/uploads/sub/x.png', root).code, 'FILE_PATH_INVALID');
  assert.equal(resolveStoredUploadPath('/uploads/brand/deeper/x.png', root).code, 'FILE_PATH_INVALID');
  assert.equal(resolveStoredUploadPath('/uploads/.hidden', root).code, 'FILE_PATH_INVALID');
  assert.equal(resolveStoredUploadPath('/uploads/a\\b.png', root).code, 'FILE_PATH_INVALID');
  assert.equal(resolveStoredUploadPath('https://cdn.example.com/a.png', root).code, 'FILE_NOT_LOCAL');
  assert.equal(resolveStoredUploadPath(null, root).code, 'FILE_PATH_MISSING');
});

test('safeExportFileName produces portable basenames', () => {
  assert.equal(safeExportFileName('mockup a.png'), 'mockup a.png');
  assert.equal(safeExportFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeExportFileName('..\\..\\win.ini'), 'win.ini');
  assert.equal(safeExportFileName('.hidden'), 'hidden');
  assert.equal(safeExportFileName('résumé?.pdf'), 'r_sum__.pdf');
  assert.equal(safeExportFileName(''), 'file');
  assert.equal(safeExportFileName(undefined), 'file');
  const long = safeExportFileName(`${'a'.repeat(300)}.pdf`);
  assert.equal(long.length, 150);
  assert.ok(long.endsWith('.pdf'));
  assert.equal(exportFilePath('attachments', 'att1', 'x/y.png'), 'files/attachments/att1/y.png');
});

test('serialization, omit and pagination helpers', () => {
  assert.equal(serializeRow({ id: 'a', size: 12n, at: new Date('2026-01-01T00:00:00Z') }), '{"id":"a","size":"12","at":"2026-01-01T00:00:00.000Z"}\n');
  assert.equal(omitArgs({ omit: [] }), undefined);
  assert.deepEqual(omitArgs({ omit: ['password'] }), { password: true });
  assert.deepEqual(pageWhere({ organizationId: 'o' }, null), { organizationId: 'o' });
  assert.deepEqual(pageWhere({ organizationId: 'o' }, 'c9'), { AND: [{ organizationId: 'o' }, { id: { gt: 'c9' } }] });
  assert.equal(checksumLine('ab', 'data/x.jsonl'), 'ab  data/x.jsonl\n');
  const exclusions = buildExclusions();
  assert.ok(exclusions.some((entry) => entry.scope === 'field' && entry.entity === 'users' && entry.field === 'password'));
  assert.ok(exclusions.some((entry) => entry.scope === 'model' && entry.model === 'Credential'));
});

test('paginateEntity walks keyset pages until a short page', async () => {
  const rows = Array.from({ length: 5 }, (_, n) => ({ id: `r${n}` }));
  const calls = [];
  const fake = {
    client: {
      findMany: async (args) => {
        calls.push(args);
        const after = args.where.AND ? args.where.AND[1].id.gt : null;
        const start = after ? rows.findIndex((row) => row.id === after) + 1 : 0;
        return rows.slice(start, start + args.take);
      },
    },
  };
  const entity = EXPORT_ENTITIES.find((candidate) => candidate.name === 'clients');
  const seen = [];
  for await (const row of paginateEntity(fake, entity, 'org1', 2)) seen.push(row.id);
  assert.deepEqual(seen, ['r0', 'r1', 'r2', 'r3', 'r4']);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].orderBy, { id: 'asc' });
  assert.deepEqual(calls[0].where, { organizationId: 'org1', deletedAt: null });
});

test('prepareOutputDir refuses non-empty directories and files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-export-unit-'));
  try {
    const fresh = path.join(root, 'new', 'nested');
    assert.equal(await prepareOutputDir(fresh), fresh);
    assert.equal(await prepareOutputDir(fresh), fresh, 'an existing empty directory is accepted');
    fs.writeFileSync(path.join(fresh, 'x'), 'x');
    await assert.rejects(prepareOutputDir(fresh), /non-empty directory/);
    const file = path.join(root, 'file');
    fs.writeFileSync(file, 'x');
    await assert.rejects(prepareOutputDir(file), /not a directory/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyWorkspaceExportDirectory reports a missing manifest', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-export-unit-'));
  try {
    assert.deepEqual(await verifyWorkspaceExportDirectory(root), { valid: false, findings: [{ code: 'MANIFEST_MISSING' }] });
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ format: 'other' }));
    assert.deepEqual((await verifyWorkspaceExportDirectory(root)).findings, [{ code: 'EXPORT_FORMAT_INVALID' }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Whole-export behaviour with an in-memory Prisma client
// ---------------------------------------------------------------------------

const RECEIPT = 'receipt-0b0e6a4e-7f3a-4c52-9d5e-1a2b3c4d5e6f.png';

function fakePrisma(rowsByModel) {
  const delegate = (model) => ({
    findMany: async (args) => {
      if (args.where?.AND) return []; // one page only
      return (rowsByModel[model] ?? []).slice(0, args.take);
    },
  });
  return new Proxy({
    organization: { ...delegate('Organization'), findUnique: async () => ({ id: 'org1', name: 'Org', slug: 'org' }) },
  }, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key !== 'string') return undefined;
      return delegate(key.charAt(0).toUpperCase() + key.slice(1));
    },
  });
}

async function withExport(setup, rowsByModel, check) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-export-files-'));
  const uploads = path.join(root, 'uploads');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(uploads);
  fs.mkdirSync(outside);
  try {
    setup({ uploads, outside });
    const outputDir = path.join(root, 'export');
    const result = await exportWorkspace({ prisma: fakePrisma(rowsByModel), organizationId: 'org1', outputDir, uploadsDir: uploads, snapshot: false, now: () => new Date('2026-01-01T00:00:00Z') });
    await check({ result, outputDir, uploads, outside });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const codes = (result) => result.manifest.exceptions.map((exception) => `${exception.recordId}:${exception.code}`).sort();

test('exportWorkspace copies safe files and records unsafe ones as exceptions without aborting', async () => {
  await withExport(({ uploads, outside }) => {
    fs.writeFileSync(path.join(uploads, 'ok.png'), 'ok');
    fs.writeFileSync(path.join(uploads, RECEIPT), 'receipt');
    fs.mkdirSync(path.join(uploads, 'quarantine'));
    fs.writeFileSync(path.join(uploads, 'quarantine', 'bad.exe'), 'bad');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'other tenant');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(uploads, 'link.png'));
    // A symlinked directory where brand logos live.
    fs.symlinkSync(outside, path.join(uploads, 'brand'));
  }, {
    Attachment: [
      { id: 'a1', path: '/uploads/ok.png', originalName: 'ok.png', size: 2 },
      { id: 'a2', path: '/uploads/./quarantine/bad.exe', originalName: 'bad.exe' },
      { id: 'a3', path: '/uploads/link.png', originalName: 'link.png' },
      { id: 'a4', path: '/uploads/missing.png', originalName: 'missing.png' },
    ],
    Expense: [
      { id: 'e1', receiptUrl: `/uploads/${RECEIPT}` },
      // Free text that names another file: never copied.
      { id: 'e2', receiptUrl: '/uploads/ok.png' },
    ],
    BrandSettings: [{ id: 'b1', logoUrl: '/uploads/brand/secret.txt' }],
  }, async ({ result, outputDir }) => {
    assert.deepEqual(result.manifest.files.map((file) => file.recordId).sort(), ['a1', 'e1']);
    assert.deepEqual(codes(result), ['a2:FILE_QUARANTINED', 'a3:FILE_NOT_REGULAR', 'a4:FILE_MISSING', 'b1:FILE_NOT_REGULAR', 'e2:FILE_NOT_RECEIPT']);
    const copied = fs.readdirSync(path.join(outputDir, 'files'), { recursive: true }).map(String);
    assert.ok(!copied.some((name) => name.includes('secret')), 'nothing outside the upload root is copied');
    assert.equal(fs.statSync(outputDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(outputDir, 'manifest.json')).mode & 0o777, 0o600);
    assert.equal((await verifyWorkspaceExportDirectory(outputDir, { expectedManifestSha256: result.manifestSha256 })).valid, true);
  });
});

test('exportWorkspace verifies expense receipts against receiptChecksumSha256', async () => {
  const other = 'receipt-1b0e6a4e-7f3a-4c52-9d5e-1a2b3c4d5e6f.pdf';
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  await withExport(({ uploads }) => {
    fs.writeFileSync(path.join(uploads, RECEIPT), 'receipt');
    fs.writeFileSync(path.join(uploads, other), 'changed on disk');
  }, {
    Expense: [
      { id: 'e1', receiptUrl: `/uploads/${RECEIPT}`, receiptChecksumSha256: sha('receipt') },
      { id: 'e2', receiptUrl: `/uploads/${other}`, receiptChecksumSha256: sha('original') },
    ],
  }, async ({ result }) => {
    const byRecord = Object.fromEntries(result.manifest.files.map((file) => [file.recordId, file]));
    assert.equal(byRecord.e1.recordedSha256, sha('receipt'));
    assert.equal(byRecord.e1.sha256, sha('receipt'));
    assert.equal(byRecord.e2.recordedSha256, sha('original'));
    assert.deepEqual(codes(result), ['e2:FILE_CHECKSUM_MISMATCH']);
  });
});

test('exportWorkspace records an unreadable upload as FILE_UNREADABLE and finishes', {
  skip: typeof process.getuid === 'function' && process.getuid() === 0 && 'root can read a mode-000 file',
}, async () => {
  await withExport(({ uploads }) => {
    fs.writeFileSync(path.join(uploads, 'locked.png'), 'x');
    fs.chmodSync(path.join(uploads, 'locked.png'), 0o000);
  }, {
    Attachment: [{ id: 'a1', path: '/uploads/locked.png', originalName: 'locked.png' }],
  }, async ({ result, outputDir }) => {
    assert.deepEqual(codes(result), ['a1:FILE_UNREADABLE']);
    assert.deepEqual(result.manifest.files, []);
    assert.ok(!fs.existsSync(path.join(outputDir, 'files', 'attachments', 'a1')) || fs.readdirSync(path.join(outputDir, 'files', 'attachments', 'a1')).length === 0, 'no partial copy is left');
    assert.equal((await verifyWorkspaceExportDirectory(outputDir)).valid, true);
  });
});

test('verifyWorkspaceExportDirectory detects tampering with any file, including the manifest and checksum list', async () => {
  const tamper = [
    ['a deleted checksum list', (dir) => fs.rmSync(path.join(dir, 'SHA256SUMS')), 'CHECKSUM_LIST_MISSING'],
    ['a rewritten README', (dir) => fs.appendFileSync(path.join(dir, 'README.md'), 'x'), 'CHECKSUM_LIST_MISMATCH'],
    ['a deleted README', (dir) => fs.rmSync(path.join(dir, 'README.md')), 'FILE_MISSING'],
    ['edited manifest exceptions', (dir) => {
      const file = path.join(dir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      manifest.exceptions = [];
      fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    }, 'CHECKSUM_LIST_MISMATCH'],
    ['inconsistent manifest totals', (dir) => {
      const file = path.join(dir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      manifest.totals.rows = 999;
      fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    }, 'MANIFEST_TOTALS_MISMATCH'],
    ['a manifest path outside the export', (dir) => {
      const file = path.join(dir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      manifest.files[0].exportPath = '../outside/secret.txt';
      fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    }, 'MANIFEST_PATH_INVALID'],
    ['a tampered copied file', (dir) => {
      const [attachment] = fs.readdirSync(path.join(dir, 'files', 'attachments'));
      const folder = path.join(dir, 'files', 'attachments', attachment);
      fs.appendFileSync(path.join(folder, fs.readdirSync(folder)[0]), 'x');
    }, 'FILE_CHECKSUM_MISMATCH'],
    ['an extra file', (dir) => fs.writeFileSync(path.join(dir, 'data', 'extra.jsonl'), '{}\n'), 'UNEXPECTED_FILE'],
  ];
  for (const [label, change, expectedCode] of tamper) {
    await withExport(({ uploads }) => {
      fs.writeFileSync(path.join(uploads, 'ok.png'), 'ok');
    }, {
      Attachment: [
        { id: 'a1', path: '/uploads/ok.png', originalName: 'ok.png', size: 2 },
        { id: 'a2', path: '/uploads/missing.png', originalName: 'missing.png' },
      ],
    }, async ({ result, outputDir }) => {
      assert.equal((await verifyWorkspaceExportDirectory(outputDir)).valid, true, 'the untouched export verifies');
      change(outputDir);
      const verdict = await verifyWorkspaceExportDirectory(outputDir);
      assert.equal(verdict.valid, false, `${label} was not detected`);
      assert.ok(verdict.findings.some((finding) => finding.code === expectedCode), `${label}: expected ${expectedCode}, got ${JSON.stringify(verdict.findings)}`);
      if (label === 'edited manifest exceptions') {
        const pinned = await verifyWorkspaceExportDirectory(outputDir, { expectedManifestSha256: result.manifestSha256 });
        assert.ok(pinned.findings.some((finding) => finding.code === 'MANIFEST_CHECKSUM_MISMATCH'));
      }
    });
  }
});

test('exportWorkspace compares each attachment with the SHA-256 recorded at upload', async () => {
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  await withExport(({ uploads }) => {
    fs.writeFileSync(path.join(uploads, 'same.png'), 'same');
    fs.writeFileSync(path.join(uploads, 'changed.png'), 'changed on disk');
    fs.writeFileSync(path.join(uploads, 'legacy.png'), 'legacy');
  }, {
    Attachment: [
      { id: 'a1', path: '/uploads/same.png', originalName: 'same.png', size: 4, checksumSha256: sha('same') },
      { id: 'a2', path: '/uploads/changed.png', originalName: 'changed.png', size: 15, checksumSha256: sha('original bytes') },
      { id: 'a3', path: '/uploads/legacy.png', originalName: 'legacy.png', size: 6, checksumSha256: null },
    ],
  }, async ({ result }) => {
    assert.deepEqual(codes(result), ['a2:FILE_CHECKSUM_MISMATCH']);
    const byId = Object.fromEntries(result.manifest.files.map((file) => [file.recordId, file]));
    assert.deepEqual(Object.keys(byId).sort(), ['a1', 'a2', 'a3'], 'a mismatching file is still copied as is');
    assert.equal(byId.a1.recordedSha256, byId.a1.sha256);
    assert.equal(byId.a2.recordedSha256, sha('original bytes'));
    assert.equal(byId.a3.recordedSha256, null);
  });
});
