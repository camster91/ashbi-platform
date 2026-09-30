import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
