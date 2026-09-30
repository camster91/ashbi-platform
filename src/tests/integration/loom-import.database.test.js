import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

// Runs the real Loom manifest importer CLI against a real PostgreSQL database
// (built with `prisma migrate deploy`) to prove the reconciliation contract:
// dry runs write nothing, a live run stores files through the upload path,
// reruns are idempotent, a changed source is reported and blocks, a finding
// rolls back the whole live run (rows and files), rollback by run id removes
// exactly one run, and an import for one organization never touches another.
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const importer = path.join(repoRoot, 'scripts', 'import-loom.mjs');
const fixtures = path.join(repoRoot, 'src', 'tests', 'fixtures');
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

// The CLI runs in `workDir`, so stored uploads land in workDir/uploads.
function runCli(args, workDir, { summary = true } = {}) {
  const summaryFile = path.join(workDir, `report-${randomUUID()}.json`);
  const result = spawnSync(process.execPath, [importer, ...args, ...(summary ? ['--summary-file', summaryFile] : [])], {
    cwd: workDir,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'development' },
  });
  const report = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : null;
  return { status: result.status, stderr: result.stderr, report };
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('Loom manifest import plans, stores files, reruns idempotently, reports conflicts, rolls back, and stays inside its tenant', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 180_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const ids = {
    orgA: `loom-org-a-${suffix}`, orgB: `loom-org-b-${suffix}`,
    clientA: `loom-client-a-${suffix}`, clientB: `loom-client-b-${suffix}`,
    projectA: `loom-project-a-${suffix}`, projectB: `loom-project-b-${suffix}`,
    operator: `loom-operator-${suffix}`, alice: `loom-alice-${suffix}`, userB: `loom-user-b-${suffix}`,
  };
  const emails = { operator: `ops+${suffix}@example.test`, alice: `alice+${suffix}@example.test`, someone: `someone+${suffix}@not-in-ashbi.test` };
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-loom-import-'));
  const inputDir = path.join(workDir, 'input');
  const uploadsDir = path.join(workDir, 'uploads');
  fs.cpSync(path.join(fixtures, 'loom-import-basic'), inputDir, { recursive: true });
  const manifest = path.join(inputDir, 'loom-manifest.csv');
  const originalManifest = fs.readFileSync(manifest, 'utf8')
    .replaceAll('{{PROJECT_ID}}', ids.projectA)
    .replaceAll('{{ALICE_EMAIL}}', emails.alice.toUpperCase())
    .replaceAll('someone@not-in-ashbi.test', emails.someone);
  fs.writeFileSync(manifest, originalManifest);
  const base = ['--organization-id', ids.orgA, '--operator-email', emails.operator, '--input-dir', inputDir];
  const projects = [ids.projectA, ids.projectB];
  const storedFiles = () => (fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).filter((name) => name !== 'quarantine') : []);

  try {
    await raw.organization.createMany({ data: [
      { id: ids.orgA, name: 'Loom import tenant A', slug: `loom-a-${suffix}` },
      { id: ids.orgB, name: 'Loom import tenant B', slug: `loom-b-${suffix}` },
    ] });
    await raw.client.createMany({ data: [
      { id: ids.clientA, organizationId: ids.orgA, name: 'Client A' },
      { id: ids.clientB, organizationId: ids.orgB, name: 'Client B' },
    ] });
    await raw.project.createMany({ data: [
      { id: ids.projectA, organizationId: ids.orgA, clientId: ids.clientA, name: 'Loom project A' },
      { id: ids.projectB, organizationId: ids.orgB, clientId: ids.clientB, name: 'Loom project B' },
    ] });
    await raw.user.createMany({ data: [
      { id: ids.operator, organizationId: ids.orgA, email: emails.operator, password: 'test', name: 'Operator', role: 'ADMIN' },
      { id: ids.alice, organizationId: ids.orgA, email: emails.alice, password: 'test', name: 'Alice', role: 'TEAM' },
      // The homepage owner exists only in org B; org A must not map to it.
      { id: ids.userB, organizationId: ids.orgB, email: emails.someone, password: 'test', name: 'B user', role: 'ADMIN' },
    ] });
    await raw.attachment.create({ data: {
      organizationId: ids.orgB, filename: 'b.mp4', originalName: 'b.mp4', mimeType: 'video/mp4', size: 1,
      path: '/uploads/b.mp4', entityType: 'PROJECT', entityId: ids.projectB, uploadedById: ids.userB,
    } });
    const orgBSnapshot = async () => ({
      attachments: await raw.attachment.findMany({ where: { organizationId: ids.orgB }, orderBy: { id: 'asc' } }),
      records: await raw.loomImportRecord.count({ where: { organizationId: ids.orgB } }),
      runs: await raw.importRun.count({ where: { organizationId: ids.orgB } }),
    });
    const orgBBefore = await orgBSnapshot();

    // Dry run plans the two supported recordings, reports the two unsupported
    // ones and the unknown owner, hashes every file, and writes nothing.
    const dryRun = runCli([...base, '--dry-run'], workDir);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.equal(dryRun.report.mode, 'dry-run');
    assert.equal(dryRun.report.complete, true);
    assert.equal(dryRun.report.totals.planned, 2);
    assert.equal(dryRun.report.totals.skipped, 2);
    assert.deepEqual(dryRun.report.unsupported.map((item) => item.code), ['UNSUPPORTED_TYPE', 'INVALID_CONTENT']);
    assert.deepEqual(dryRun.report.owners.unmapped, [emails.someone]);
    assert.equal(dryRun.report.exceptions.UNKNOWN_OWNER, 1);
    for (const file of dryRun.report.files) assert.equal(file.sha256, sha256(path.join(inputDir, file.fileName)));
    assert.equal(await raw.attachment.count({ where: { organizationId: ids.orgA } }), 0);
    assert.equal(await raw.importRun.count({ where: { organizationId: ids.orgA } }), 0);
    assert.deepEqual(storedFiles(), []);

    // Live run: project media attachments with provenance, stored through
    // the upload path.
    const first = runCli([...base, '--apply'], workDir);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.report.complete, true);
    assert.equal(first.report.totals.created, 2);
    const runId = first.report.run.id;
    const attachments = await raw.attachment.findMany({ where: { organizationId: ids.orgA }, orderBy: { createdAt: 'asc' } });
    assert.equal(attachments.length, 2);
    const [kickoff, homepage] = attachments;
    assert.equal(kickoff.entityType, 'PROJECT');
    assert.equal(kickoff.entityId, ids.projectA);
    assert.equal(kickoff.mimeType, 'video/mp4');
    assert.equal(kickoff.originalName, 'Kickoff walkthrough.mp4');
    assert.equal(kickoff.uploadedById, ids.alice, 'owner matched by email, case-insensitively');
    assert.equal(kickoff.createdAt.toISOString(), '2025-03-04T15:15:00.000Z');
    assert.equal(homepage.mimeType, 'video/webm');
    assert.equal(homepage.uploadedById, ids.operator, 'unknown owner is attributed to the operator');
    assert.match(kickoff.path, /^\/uploads\/[0-9a-f-]{36}\.mp4$/);
    assert.equal(sha256(path.join(workDir, kickoff.path)), sha256(path.join(inputDir, 'kickoff.mp4')));
    const records = await raw.loomImportRecord.findMany({ where: { runId }, orderBy: { sourceCreatedAt: 'asc' } });
    assert.equal(records.length, 2);
    assert.equal(records[0].loomUrl, 'https://www.loom.com/share/0123456789abcdef0123456789abcdef');
    assert.equal(records[0].sourceCreatedAt.toISOString(), '2025-03-04T15:15:00.000Z');
    assert.equal(records[0].attachmentId, kickoff.id);
    assert.equal(records[1].ownerUserId, null);
    assert.equal(records[1].loomUrl, 'https://www.loom.com/share/fedcba9876543210fedcba9876543210');
    assert.equal(storedFiles().length, 2);
    assert.equal((await raw.importRun.findUnique({ where: { id: runId } })).source, 'LOOM_MANIFEST');
    assert.equal(await raw.auditEvent.count({ where: { organizationId: ids.orgA, action: 'migration_import.applied', entityId: runId } }), 1);

    // Rerun is a no-op.
    const rerun = runCli([...base, '--apply'], workDir);
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.equal(rerun.report.totals.created, 0);
    assert.equal(rerun.report.totals.unchanged, 2);
    assert.equal(await raw.attachment.count({ where: { organizationId: ids.orgA } }), 2);
    assert.equal(await raw.loomImportRecord.count({ where: { organizationId: ids.orgA } }), 2);
    assert.equal(storedFiles().length, 2);

    // A changed recording is reported, not overwritten.
    const kickoffFile = path.join(inputDir, 'kickoff.mp4');
    const kickoffBytes = fs.readFileSync(kickoffFile);
    fs.appendFileSync(kickoffFile, 'edited');
    const changed = runCli([...base, '--dry-run'], workDir);
    assert.equal(changed.status, 0, changed.stderr);
    assert.equal(changed.report.complete, false);
    assert.deepEqual(changed.report.errors.map((error) => error.code), ['SOURCE_CHANGED']);
    fs.writeFileSync(kickoffFile, kickoffBytes);

    // A finding rolls back the whole live run: the new recording listed after
    // a changed row is stored and then removed with the transaction.
    fs.copyFileSync(kickoffFile, path.join(inputDir, 'followup.mp4'));
    fs.appendFileSync(path.join(inputDir, 'followup.mp4'), 'followup');
    fs.writeFileSync(manifest, `${originalManifest.replace('Kickoff walkthrough', 'Kickoff walkthrough (renamed)')}`
      + `https://www.loom.com/share/99990000999900009999000099990000,Follow-up,2025-06-01T08:00:00+01:00,${emails.alice},followup.mp4,${ids.projectA},\n`);
    const runsBefore = await raw.importRun.count({ where: { organizationId: ids.orgA } });
    const blocked = runCli([...base, '--apply'], workDir);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /SOURCE_CHANGED/);
    assert.equal(blocked.report, null, 'a refused live run writes no report file');
    assert.equal(await raw.attachment.count({ where: { organizationId: ids.orgA } }), 2);
    assert.equal(await raw.loomImportRecord.count({ where: { organizationId: ids.orgA } }), 2);
    assert.equal(await raw.importRun.count({ where: { organizationId: ids.orgA } }), runsBefore);
    assert.equal(storedFiles().length, 2, 'files stored by the failed run are removed');
    fs.writeFileSync(manifest, originalManifest);

    // Exception taxonomy: missing file and unknown (other-tenant) project
    // block; an oversized file is reported and not imported.
    fs.writeFileSync(path.join(inputDir, 'big.mp4'), kickoffBytes);
    fs.truncateSync(path.join(inputDir, 'big.mp4'), MAX_UPLOAD_SIZE + 1);
    fs.writeFileSync(manifest, `${originalManifest}`
      + `https://www.loom.com/share/aaaa0000aaaa0000aaaa0000aaaa0000,Too big,2025-06-02T08:00:00Z,${emails.alice},big.mp4,${ids.projectA},\n`);
    const oversized = runCli([...base, '--dry-run'], workDir);
    assert.equal(oversized.status, 0, oversized.stderr);
    assert.equal(oversized.report.complete, true);
    assert.deepEqual(oversized.report.unsupported.map((item) => item.code), ['UNSUPPORTED_TYPE', 'INVALID_CONTENT', 'FILE_TOO_LARGE']);
    fs.writeFileSync(manifest, `${originalManifest}`
      + `https://www.loom.com/share/bbbb0000bbbb0000bbbb0000bbbb0000,Missing,2025-06-02T08:00:00Z,${emails.alice},missing.mp4,${ids.projectA},\n`
      + `https://www.loom.com/share/cccc0000cccc0000cccc0000cccc0000,Other tenant,2025-06-02T08:00:00Z,${emails.alice},homepage.webm,${ids.projectB},\n`);
    const invalid = runCli([...base, '--dry-run'], workDir);
    assert.equal(invalid.status, 0, invalid.stderr);
    assert.equal(invalid.report.complete, false);
    assert.deepEqual(invalid.report.errors.map((error) => error.code).sort(), ['DUPLICATE_FILE', 'MISSING_FILE']);
    fs.writeFileSync(manifest, `${originalManifest}`
      + `https://www.loom.com/share/cccc0000cccc0000cccc0000cccc0000,Other tenant,2025-06-02T08:00:00Z,${emails.alice},kickoff-copy.mp4,${ids.projectB},\n`);
    fs.copyFileSync(kickoffFile, path.join(inputDir, 'kickoff-copy.mp4'));
    const crossTenant = runCli([...base, '--apply'], workDir);
    assert.equal(crossTenant.status, 1);
    assert.match(crossTenant.stderr, /UNKNOWN_PROJECT/);
    fs.writeFileSync(manifest, originalManifest);

    // Rollback is refused while a review uses an imported file.
    const review = await raw.reviewSession.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, attachmentId: kickoff.id, title: 'Review', createdById: ids.operator,
    } });
    const refused = runCli(['--organization-id', ids.orgA, '--rollback', runId], workDir);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /review session/);
    await raw.reviewSession.delete({ where: { id: review.id } });

    // Rollback removes exactly the run's attachments, files and records.
    const rollback = runCli(['--organization-id', ids.orgA, '--rollback', runId], workDir);
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.deepEqual(rollback.report.deleted, { attachments: 2, files: 2, records: 2 });
    assert.equal(await raw.attachment.count({ where: { organizationId: ids.orgA } }), 0);
    assert.deepEqual(storedFiles(), []);
    assert.equal((await raw.importRun.findUnique({ where: { id: runId } })).status, 'ROLLED_BACK');
    assert.equal(runCli(['--organization-id', ids.orgA, '--rollback', runId], workDir).status, 1);
    const wrongTenant = runCli(['--organization-id', ids.orgB, '--rollback', runId], workDir);
    assert.equal(wrongTenant.status, 1);
    assert.match(wrongTenant.stderr, /not found in this organization/);

    // A rolled-back manifest imports again; a file later deleted in the Hub
    // is then a warning, not a blocker, and is not re-imported.
    const reimport = runCli([...base, '--apply'], workDir);
    assert.equal(reimport.status, 0, reimport.stderr);
    assert.equal(reimport.report.totals.created, 2);
    const reimported = await raw.loomImportRecord.findFirst({ where: { runId: reimport.report.run.id, fileName: 'homepage.webm' } });
    await raw.attachment.delete({ where: { id: reimported.attachmentId } });
    const afterDelete = runCli([...base, '--apply'], workDir);
    assert.equal(afterDelete.status, 0, afterDelete.stderr);
    assert.equal(afterDelete.report.totals.deletedInHub, 1);
    assert.equal(afterDelete.report.totals.created, 0);

    // Outcome vocabulary and hash shape are enforced by the database.
    await assert.rejects(raw.loomImportRecord.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, runId, sourceKey: `loom:bogus-${suffix}`,
      loomUrl: 'https://www.loom.com/share/abc', title: 'x', sourceCreatedAt: new Date(), fileName: 'x.mp4', fileSize: 1,
      fileSha256: 'a'.repeat(64), contentSha256: 'a'.repeat(64), outcome: 'BOGUS',
    } }), /loom_import_records_outcome_check/);

    assert.deepEqual(await orgBSnapshot(), orgBBefore, 'organization B is untouched');
  } finally {
    await raw.reviewSession.deleteMany({ where: { projectId: { in: projects } } });
    await raw.loomImportRecord.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await raw.importRun.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await raw.attachment.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await raw.user.deleteMany({ where: { id: { in: [ids.operator, ids.alice, ids.userB] } } });
    await raw.project.deleteMany({ where: { id: { in: projects } } });
    await raw.client.deleteMany({ where: { id: { in: [ids.clientA, ids.clientB] } } });
    await purgeFixtureAuditEvents(raw, { ids: [ids.orgA, ids.orgB] });
    await raw.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
    await raw.$disconnect();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
