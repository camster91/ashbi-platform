import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Runs the real controlled importer CLI against a real PostgreSQL database
// (built with `prisma migrate deploy`) to prove the reconciliation contract:
// reruns are idempotent, changed or colliding sources are reported as
// conflicts, and a live run with any finding rolls back every write.
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const importer = path.join(repoRoot, 'scripts', 'import-notion-markdown.js');

function writeExport(directory, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function runImport({ organizationId, projectId, inputDir, workDir, confirm }) {
  const summaryFile = path.join(workDir, `report-${randomUUID()}.json`);
  const args = [importer, '--organization-id', organizationId, '--project-id', projectId, '--input-dir', inputDir, '--summary-file', summaryFile];
  if (confirm) args.push('--confirm');
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const report = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : null;
  return { status: result.status, stderr: result.stderr, report };
}

test('Notion Markdown import is idempotent, reports conflicts, and rolls back live runs with findings', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const ids = {
    org: `notion-org-${suffix}`,
    client: `notion-client-${suffix}`,
    project: `notion-project-${suffix}`,
    rollbackProject: `notion-rollback-${suffix}`,
    user: `notion-user-${suffix}`,
  };
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-notion-import-'));
  const exportDir = path.join(workDir, 'export');
  const rollbackExportDir = path.join(workDir, 'rollback-export');
  const projects = [ids.project, ids.rollbackProject];

  try {
    await raw.organization.create({ data: { id: ids.org, name: 'Notion import tenant', slug: `notion-${suffix}` } });
    await raw.client.create({ data: { id: ids.client, organizationId: ids.org, name: 'Notion client' } });
    await raw.project.createMany({ data: [
      { id: ids.project, organizationId: ids.org, clientId: ids.client, name: 'Notion project' },
      { id: ids.rollbackProject, organizationId: ids.org, clientId: ids.client, name: 'Notion rollback project' },
    ] });
    await raw.user.create({
      data: { id: ids.user, organizationId: ids.org, email: `notion-${suffix}@example.test`, password: 'test', name: 'Importer' },
    });

    writeExport(exportDir, {
      'Handbook.md': '# Handbook\n\nTop-level page.\n',
      'Handbook/Onboarding.md': '# Onboarding\n\nNested page.\n',
    });
    const options = { organizationId: ids.org, projectId: ids.project, inputDir: exportDir, workDir };

    // Dry run plans both pages and writes nothing.
    const dryRun = runImport({ ...options, confirm: false });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.equal(dryRun.report.mode, 'dry-run');
    assert.equal(dryRun.report.notes.planned, 2);
    assert.equal(await raw.note.count({ where: { projectId: ids.project } }), 0);
    assert.equal(await raw.notionImportRecord.count({ where: { projectId: ids.project } }), 0);

    // First live import creates both notes, preserves hierarchy, and records provenance.
    const first = runImport({ ...options, confirm: true });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.report.complete, true);
    assert.equal(first.report.notes.created, 2);
    const notes = await raw.note.findMany({ where: { projectId: ids.project }, orderBy: { title: 'asc' } });
    assert.deepEqual(notes.map((note) => note.title), ['Handbook', 'Onboarding']);
    const [handbook, onboarding] = notes;
    assert.equal(handbook.parentId, null);
    assert.equal(onboarding.parentId, handbook.id);
    assert.equal(await raw.notionImportRecord.count({ where: { projectId: ids.project, outcome: 'IMPORTED' } }), 2);

    // Rerunning the same export is a no-op.
    const rerun = runImport({ ...options, confirm: true });
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.equal(rerun.report.complete, true);
    assert.equal(rerun.report.notes.created, 0);
    assert.equal(rerun.report.notes.unchanged, 2);
    assert.equal(rerun.report.records.existing, 2);
    assert.equal(await raw.note.count({ where: { projectId: ids.project } }), 2);
    assert.equal(await raw.notionImportRecord.count({ where: { projectId: ids.project } }), 2);

    // A changed source is a conflict: reported on dry run, refused on live run,
    // and the previously imported note is never overwritten.
    writeExport(exportDir, { 'Handbook/Onboarding.md': '# Onboarding\n\nEdited after import.\n' });
    const changedDryRun = runImport({ ...options, confirm: false });
    assert.equal(changedDryRun.status, 0, changedDryRun.stderr);
    assert.equal(changedDryRun.report.complete, false);
    assert.equal(changedDryRun.report.notes.conflicts, 1);
    assert.deepEqual(changedDryRun.report.errors.map((error) => error.code), ['SOURCE_CHANGED']);
    const changedLive = runImport({ ...options, confirm: true });
    assert.equal(changedLive.status, 1);
    assert.match(changedLive.stderr, /unresolved reconciliation findings/);
    assert.equal((await raw.note.findUnique({ where: { id: onboarding.id } })).content, onboarding.content);

    // A soft-deleted destination is reported instead of silently re-created.
    await raw.note.update({ where: { id: onboarding.id }, data: { deletedAt: new Date() } });
    const missing = runImport({ ...options, confirm: false });
    assert.ok(missing.report.errors.some((error) => error.code === 'MISSING_DESTINATION'));

    // Rollback: a live run whose later page collides with an unmapped note must
    // not leave the earlier, otherwise-valid page or its import record behind.
    await raw.note.create({
      data: { title: 'Zeta', content: 'Pre-existing Ashbi note', type: 'DOC', projectId: ids.rollbackProject, authorId: ids.user },
    });
    writeExport(rollbackExportDir, { 'Alpha.md': '# Alpha\n', 'Zeta.md': '# Zeta from Notion\n' });
    const rollbackOptions = { organizationId: ids.org, projectId: ids.rollbackProject, inputDir: rollbackExportDir, workDir };
    const conflictDryRun = runImport({ ...rollbackOptions, confirm: false });
    assert.equal(conflictDryRun.report.notes.planned, 1);
    assert.deepEqual(conflictDryRun.report.errors.map((error) => error.code), ['DESTINATION_CONFLICT']);
    const rolledBack = runImport({ ...rollbackOptions, confirm: true });
    assert.equal(rolledBack.status, 1);
    assert.equal(rolledBack.report, null, 'a failed live import must not write a completion report');
    const remaining = await raw.note.findMany({ where: { projectId: ids.rollbackProject } });
    assert.deepEqual(remaining.map((note) => note.title), ['Zeta']);
    assert.equal(await raw.notionImportRecord.count({ where: { projectId: ids.rollbackProject } }), 0);
  } finally {
    await raw.notionImportRecord.deleteMany({ where: { projectId: { in: projects } } });
    await raw.note.deleteMany({ where: { projectId: { in: projects } } });
    await raw.user.deleteMany({ where: { id: ids.user } });
    await raw.project.deleteMany({ where: { id: { in: projects } } });
    await raw.client.deleteMany({ where: { id: ids.client } });
    await raw.organization.deleteMany({ where: { id: ids.org } });
    await raw.$disconnect();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
