import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { importScopeLockKey } from '../../services/operator-import-common.js';

// Runs the real MarkUp.io comments importer CLI against a real PostgreSQL
// database (built with `prisma migrate deploy`) to prove the reconciliation
// contract: dry runs write nothing, a live run creates review sessions, pins,
// replies and resolved threads that satisfy the review CHECK constraints,
// reruns are idempotent (and add only new comments), a changed source is
// reported, a finding rolls back the whole live run (rows and files),
// rollback by run id removes exactly one run, and an import for one
// organization never touches another.
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const importer = path.join(repoRoot, 'scripts', 'import-markup.mjs');
const fixtures = path.join(repoRoot, 'src', 'tests', 'fixtures');

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

// The same CLI run without blocking the event loop, so a concurrent writer
// transaction in this process can make progress while it runs.
function runCliAsync(args, workDir) {
  const summaryFile = path.join(workDir, `report-${randomUUID()}.json`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [importer, ...args, '--summary-file', summaryFile], {
      cwd: workDir,
      env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'development' },
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({
      status, stderr, report: fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : null,
    }));
  });
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('MarkUp.io import plans, creates reviews, reruns idempotently, reports conflicts, rolls back, and stays inside its tenant', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 180_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const ids = {
    orgA: `markup-org-a-${suffix}`, orgB: `markup-org-b-${suffix}`,
    clientA: `markup-client-a-${suffix}`, clientB: `markup-client-b-${suffix}`,
    projectA: `markup-project-a-${suffix}`, projectB: `markup-project-b-${suffix}`,
    operator: `markup-operator-${suffix}`, alice: `markup-alice-${suffix}`, userB: `markup-user-b-${suffix}`,
  };
  const emails = {
    operator: `ops+${suffix}@example.test`, alice: `alice+${suffix}@example.test`, carla: `client+${suffix}@not-in-ashbi.test`,
  };
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-markup-import-'));
  const inputDir = path.join(workDir, 'input');
  const uploadsDir = path.join(workDir, 'uploads');
  fs.cpSync(path.join(fixtures, 'markup-import-basic'), inputDir, { recursive: true });
  const csv = path.join(inputDir, 'markup-comments.csv');
  const originalCsv = fs.readFileSync(csv, 'utf8')
    .replaceAll('{{ALICE_EMAIL}}', emails.alice)
    .replaceAll('client@not-in-ashbi.test', emails.carla);
  fs.writeFileSync(csv, originalCsv);
  const base = ['--organization-id', ids.orgA, '--project-id', ids.projectA, '--operator-email', emails.operator, '--input-dir', inputDir];
  const projects = [ids.projectA, ids.projectB];
  const storedFiles = () => (fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : []);
  const annotationsA = () => raw.reviewAnnotation.findMany({ where: { session: { projectId: ids.projectA } }, orderBy: { createdAt: 'asc' } });

  try {
    await raw.organization.createMany({ data: [
      { id: ids.orgA, name: 'MarkUp import tenant A', slug: `markup-a-${suffix}` },
      { id: ids.orgB, name: 'MarkUp import tenant B', slug: `markup-b-${suffix}` },
    ] });
    await raw.client.createMany({ data: [
      { id: ids.clientA, organizationId: ids.orgA, name: 'Client A' },
      { id: ids.clientB, organizationId: ids.orgB, name: 'Client B' },
    ] });
    await raw.project.createMany({ data: [
      { id: ids.projectA, organizationId: ids.orgA, clientId: ids.clientA, name: 'MarkUp project A' },
      { id: ids.projectB, organizationId: ids.orgB, clientId: ids.clientB, name: 'MarkUp project B' },
    ] });
    await raw.user.createMany({ data: [
      { id: ids.operator, organizationId: ids.orgA, email: emails.operator, password: 'test', name: 'Operator', role: 'ADMIN' },
      { id: ids.alice, organizationId: ids.orgA, email: emails.alice, password: 'test', name: 'Alice Staff', role: 'TEAM' },
      // Carla's email belongs to a user of org B only; org A must not map to it.
      { id: ids.userB, organizationId: ids.orgB, email: emails.carla, password: 'test', name: 'Carla in B', role: 'ADMIN' },
    ] });
    const orgBSnapshot = async () => ({
      sessions: await raw.reviewSession.count({ where: { organizationId: ids.orgB } }),
      attachments: await raw.attachment.count({ where: { organizationId: ids.orgB } }),
      records: await raw.markupImportRecord.count({ where: { organizationId: ids.orgB } }),
      runs: await raw.importRun.count({ where: { organizationId: ids.orgB } }),
    });
    const orgBBefore = await orgBSnapshot();

    // Dry run: two reviews planned, the SVG reported, exceptions flagged,
    // every file hashed, nothing written.
    const dryRun = runCli([...base, '--dry-run'], workDir);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.equal(dryRun.report.mode, 'dry-run');
    assert.equal(dryRun.report.complete, true);
    const totals = dryRun.report.totals;
    assert.deepEqual(
      [totals.sessionsPlanned, totals.commentsPlanned, totals.replies, totals.pins, totals.resolved, totals.skipped],
      [2, 9, 3, 3, 2, 1],
    );
    assert.deepEqual(dryRun.report.unsupported.map((item) => [item.code, item.fileName]), [['UNSUPPORTED_TYPE', 'logo.svg']]);
    assert.equal(dryRun.report.exceptions.COORDINATES_OUT_OF_RANGE, 1);
    assert.equal(dryRun.report.exceptions.PARENT_MISSING, 1);
    assert.equal(dryRun.report.exceptions.UNKNOWN_AUTHOR, 1);
    assert.deepEqual(dryRun.report.users.unmapped, [{ email: emails.carla, name: 'Carla Client' }]);
    for (const session of dryRun.report.sessions) assert.equal(session.fileSha256, sha256(path.join(inputDir, session.fileName)));
    assert.equal(await raw.reviewSession.count({ where: { projectId: ids.projectA } }), 0);
    assert.equal(await raw.attachment.count({ where: { organizationId: ids.orgA } }), 0);
    assert.equal(await raw.importRun.count({ where: { organizationId: ids.orgA } }), 0);
    assert.deepEqual(storedFiles(), []);

    // Live run.
    const first = runCli([...base, '--apply'], workDir);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.report.complete, true);
    assert.equal(first.report.totals.sessionsCreated, 2);
    assert.equal(first.report.totals.commentsCreated, 9);
    const runId = first.report.run.id;
    const sessions = await raw.reviewSession.findMany({ where: { projectId: ids.projectA }, include: { attachment: true }, orderBy: { title: 'asc' } });
    assert.deepEqual(sessions.map((session) => session.title), ['Website redesign — brief.pdf', 'Website redesign — homepage.png']);
    for (const session of sessions) {
      assert.equal(session.sharedWithClient, false);
      assert.equal(session.status, 'open');
      assert.equal(session.createdById, ids.operator);
      assert.equal(session.attachment.entityType, 'PROJECT');
      assert.equal(session.attachment.entityId, ids.projectA);
      assert.equal(sha256(path.join(workDir, session.attachment.path)), sha256(path.join(inputDir, session.attachment.originalName)));
    }
    const records = await raw.markupImportRecord.findMany({ where: { runId } });
    const annotationFor = async (commentId) => {
      const record = records.find((candidate) => candidate.commentId === commentId);
      return raw.reviewAnnotation.findUnique({ where: { id: record.annotationId } });
    };
    const c1 = await annotationFor('c1');
    assert.deepEqual([c1.shape, c1.regionX, c1.regionY, c1.regionW, c1.regionH], ['pin', 0.25, 0.4, 0, 0]);
    assert.equal(c1.authorType, 'staff');
    assert.equal(c1.authorUserId, ids.alice);
    assert.equal(c1.authorName, 'Alice Staff');
    assert.equal(c1.createdAt.toISOString(), '2025-06-01T08:00:00.000Z');
    const c2 = await annotationFor('c2');
    assert.equal(c2.parentId, c1.id);
    assert.deepEqual([c2.authorType, c2.authorUserId, c2.authorName, c2.authorEmail], ['guest', null, 'Carla Client', emails.carla]);
    const c3 = await annotationFor('c3');
    assert.ok(c3.resolvedAt);
    assert.equal(c3.resolvedById, ids.operator);
    assert.equal((await annotationFor('c5')).parentId, c3.id, 'a reply to a reply joins the thread');
    const c6 = await annotationFor('c6');
    assert.deepEqual([c6.shape, c6.regionX], [null, null], 'out-of-range coordinates are imported without a pin');
    assert.equal((await annotationFor('c7')).parentId, null, 'a reply whose parent is missing is imported at top level');
    const p1 = await annotationFor('p1');
    assert.deepEqual([p1.pageNumber, p1.shape, p1.regionX], [2, 'pin', 0.5]);
    const p2 = await annotationFor('p2');
    assert.equal(p2.body, 'General note on the brief:\ntwo lines');
    assert.ok(p2.resolvedAt);
    assert.equal(records.length, 11);
    assert.equal(storedFiles().length, 2);
    assert.equal(await raw.auditEvent.count({ where: { organizationId: ids.orgA, action: 'migration_import.applied', entityId: runId } }), 1);

    // Rerun is a no-op.
    const rerun = runCli([...base, '--apply'], workDir);
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.equal(rerun.report.totals.sessionsCreated + rerun.report.totals.commentsCreated, 0);
    assert.equal(rerun.report.totals.commentsUnchanged, 9);
    assert.equal(rerun.report.totals.sessionsUnchanged, 2);
    assert.equal((await annotationsA()).length, 9);
    assert.equal(storedFiles().length, 2);

    // A later export with a new reply adds only that reply, to the existing
    // thread, as a second run.
    const withReply = `${originalCsv}Website redesign,homepage.png,c8,,,,${emails.alice},Alice,Later reply,open,2025-06-06T09:00:00+02:00,t1,c1\n`;
    fs.writeFileSync(csv, withReply);
    const second = runCli([...base, '--apply'], workDir);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.report.totals.sessionsCreated, 0);
    assert.equal(second.report.totals.commentsCreated, 1);
    const secondRunId = second.report.run.id;
    const c8Record = await raw.markupImportRecord.findFirst({ where: { runId: secondRunId, commentId: 'c8' } });
    assert.equal((await raw.reviewAnnotation.findUnique({ where: { id: c8Record.annotationId } })).parentId, c1.id);

    // Changed comment text and a changed file are reported, not overwritten.
    fs.writeFileSync(csv, withReply.replace('Make the hero bigger', 'Make the hero much bigger'));
    const changedComment = runCli([...base, '--dry-run'], workDir);
    assert.equal(changedComment.report.complete, false);
    assert.deepEqual(changedComment.report.errors.map((error) => error.code), ['SOURCE_CHANGED']);
    fs.writeFileSync(csv, withReply);
    const png = path.join(inputDir, 'homepage.png');
    const pngBytes = fs.readFileSync(png);
    fs.appendFileSync(png, 'x');
    const changedFile = runCli([...base, '--dry-run'], workDir);
    assert.equal(changedFile.report.complete, false);
    assert.deepEqual(changedFile.report.errors.map((error) => [error.code, error.fileName]), [['SOURCE_CHANGED', 'homepage.png']]);
    fs.writeFileSync(png, pngBytes);

    // A finding rolls back the whole live run: a new review listed after a
    // changed comment is created and then removed with the transaction.
    fs.copyFileSync(png, path.join(inputDir, 'about.png'));
    fs.appendFileSync(path.join(inputDir, 'about.png'), 'about');
    fs.writeFileSync(csv, `${withReply.replace('The logo is blurry', 'The logo is very blurry')}`
      + `Website redesign,about.png,a1,,5,5,${emails.alice},Alice,New page,open,2025-06-07T09:00:00+02:00,t30,\n`);
    const runsBefore = await raw.importRun.count({ where: { organizationId: ids.orgA } });
    const blocked = runCli([...base, '--apply'], workDir);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /SOURCE_CHANGED/);
    assert.equal(blocked.report, null, 'a refused live run writes no report file');
    assert.equal(await raw.reviewSession.count({ where: { projectId: ids.projectA } }), 2);
    assert.equal((await annotationsA()).length, 10);
    assert.equal(await raw.importRun.count({ where: { organizationId: ids.orgA } }), runsBefore);
    assert.equal(storedFiles().length, 2, 'files stored by the failed run are removed');

    // Exception taxonomy: a missing file blocks; so does an unknown project
    // (here another tenant's), and an invalid status.
    fs.writeFileSync(csv, `${withReply}Website redesign,missing.png,m1,,5,5,${emails.alice},Alice,Where is it,open,2025-06-07T09:00:00+02:00,t40,\n`
      + `Website redesign,homepage.png,c9,,5,5,${emails.alice},Alice,Bad status,pending,2025-06-07T09:00:00+02:00,t41,\n`);
    const invalid = runCli([...base, '--dry-run'], workDir);
    assert.equal(invalid.status, 0, invalid.stderr);
    assert.equal(invalid.report.complete, false);
    assert.deepEqual(invalid.report.errors.map((error) => error.code).sort(), ['INVALID_ROW', 'MISSING_FILE']);
    fs.writeFileSync(csv, withReply);
    const crossTenant = runCli(['--organization-id', ids.orgA, '--project-id', ids.projectB, '--operator-email', emails.operator, '--input-dir', inputDir, '--apply'], workDir);
    assert.equal(crossTenant.status, 1);
    assert.match(crossTenant.stderr, /UNKNOWN_PROJECT/);

    // Rollback of the first run is refused while the second run's reply sits
    // in its review; roll back the second run first.
    const refused = runCli(['--organization-id', ids.orgA, '--rollback', runId], workDir);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Later work depends on this run/);
    const rollbackSecond = runCli(['--organization-id', ids.orgA, '--rollback', secondRunId], workDir);
    assert.equal(rollbackSecond.status, 0, rollbackSecond.stderr);
    assert.deepEqual(rollbackSecond.report.deleted, { sessions: 0, comments: 1, attachments: 0, files: 0, records: 1 });

    // The rollback locks the imported sessions before its dependency checks.
    // A comment whose transaction is still open when the rollback starts is
    // waited for, and then blocks the rollback instead of being cascaded away.
    let releaseWriter;
    const writerHeld = new Promise((resolve) => { releaseWriter = resolve; });
    let raceComment = null;
    const writer = raw.$transaction(async (tx) => {
      // What the review routes do: lockOpenSession, then insert.
      await tx.reviewSession.updateMany({ where: { id: sessions[0].id, status: { not: 'closed' } }, data: { updatedAt: new Date() } });
      raceComment = await tx.reviewAnnotation.create({ data: {
        sessionId: sessions[0].id, authorType: 'staff', authorUserId: ids.operator, authorName: 'Operator', body: 'Written during the rollback',
      } });
      await writerHeld;
    }, { timeout: 60_000 });
    while (!raceComment) await new Promise((resolve) => setTimeout(resolve, 10));
    let racingDone = false;
    const racing = runCliAsync(['--organization-id', ids.orgA, '--rollback', runId], workDir).then((result) => { racingDone = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(racingDone, false, 'the rollback waits for the open comment transaction');
    releaseWriter();
    await writer;
    const raced = await racing;
    assert.equal(raced.status, 1, 'the rollback is refused once the comment commits');
    assert.match(raced.stderr, /Later work depends on this run/);
    assert.ok(await raw.reviewAnnotation.findUnique({ where: { id: raceComment.id } }), 'the concurrent comment survives');
    assert.equal((await raw.importRun.findUnique({ where: { id: runId } })).status, 'APPLIED');
    await raw.reviewAnnotation.delete({ where: { id: raceComment.id } });

    // A staff comment added in the Hub also blocks the rollback.
    const hubComment = await raw.reviewAnnotation.create({ data: {
      sessionId: sessions[0].id, authorType: 'staff', authorUserId: ids.operator, authorName: 'Operator', body: 'Added in the Hub',
    } });
    assert.equal(runCli(['--organization-id', ids.orgA, '--rollback', runId], workDir).status, 1);
    await raw.reviewAnnotation.delete({ where: { id: hubComment.id } });

    // Two operators roll the same run back at once. The run row lock makes
    // them run one after the other: exactly one deletes the rows; the other
    // sees the committed ROLLED_BACK status and either finds nothing left or
    // retries the (idempotent) file cleanup, deleting no rows.
    const concurrent = await Promise.all([
      runCliAsync(['--organization-id', ids.orgA, '--rollback', runId], workDir),
      runCliAsync(['--organization-id', ids.orgA, '--rollback', runId], workDir),
    ]);
    const deleting = concurrent.filter((outcome) => outcome.status === 0 && outcome.report.deleted.records > 0);
    assert.equal(deleting.length, 1, concurrent.map((outcome) => outcome.stderr).join('\n'));
    const rollback = deleting[0];
    const other = concurrent.find((outcome) => outcome !== rollback);
    if (other.status === 0) {
      assert.deepEqual({ ...other.report.deleted, files: 0 }, { sessions: 0, comments: 0, attachments: 0, files: 0, records: 0 });
    } else {
      assert.match(other.stderr, /already rolled back/);
    }
    assert.deepEqual(rollback.report.deleted, { sessions: 2, comments: 9, attachments: 2, files: 2, records: 11 });
    assert.equal((await raw.importRun.findUnique({ where: { id: runId } })).summary.pendingFileCleanup, undefined);

    // The audit events keep the MarkUp-specific reconciliation fields.
    const audit = await raw.auditEvent.findMany({ where: { organizationId: ids.orgA, entityId: runId }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(audit.map((event) => event.action), ['migration_import.applied', 'migration_import.rolled_back']);
    assert.deepEqual(audit[0].metadata, { source: 'MARKUP_CSV', projectId: ids.projectA, sessionsCreated: 2, commentsCreated: 9, commentsUnchanged: 0 });
    assert.deepEqual(audit[1].metadata, { source: 'MARKUP_CSV', deletedSessions: 2, deletedComments: 9, deletedRecords: 11 });
    assert.equal(await raw.reviewSession.count({ where: { projectId: ids.projectA } }), 0);
    assert.equal(await raw.attachment.count({ where: { organizationId: ids.orgA } }), 0);
    assert.deepEqual(storedFiles(), []);
    assert.equal((await raw.importRun.findUnique({ where: { id: runId } })).status, 'ROLLED_BACK');
    assert.equal(runCli(['--organization-id', ids.orgA, '--rollback', runId], workDir).status, 1);
    const wrongTenant = runCli(['--organization-id', ids.orgB, '--rollback', runId], workDir);
    assert.equal(wrongTenant.status, 1);
    assert.match(wrongTenant.stderr, /not found in this organization/);

    // A rolled-back export imports again; a review deleted in the Hub is then
    // a warning, not a blocker, and is not re-imported.
    const reimport = runCli([...base, '--apply'], workDir);
    assert.equal(reimport.status, 0, reimport.stderr);
    assert.equal(reimport.report.totals.commentsCreated, 10);
    const pdfRecord = await raw.markupImportRecord.findFirst({ where: { runId: reimport.report.run.id, kind: 'SESSION', fileName: 'brief.pdf' } });
    await raw.reviewSession.delete({ where: { id: pdfRecord.reviewSessionId } });
    const afterDelete = runCli([...base, '--apply'], workDir);
    assert.equal(afterDelete.status, 0, afterDelete.stderr);
    assert.equal(afterDelete.report.totals.deletedInHub, 1);
    assert.equal(afterDelete.report.totals.commentsCreated, 0);

    // An import that appends to an existing review locks it and re-reads its
    // status: a review closed (superseded) while the import waits for it gets
    // no new comments.
    const homeRecord = await raw.markupImportRecord.findFirst({ where: { runId: reimport.report.run.id, kind: 'SESSION', fileName: 'homepage.png' } });
    const homeSessionId = homeRecord.reviewSessionId;
    const withNewRoot = `${withReply}Website redesign,homepage.png,n1,,10,10,${emails.alice},Alice,A new root comment,open,2025-06-08T09:00:00+02:00,t50,\n`;
    fs.writeFileSync(csv, withNewRoot);
    const holdSession = (work) => {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      let ready = false;
      const done = raw.$transaction(async (tx) => {
        await tx.reviewSession.updateMany({ where: { id: homeSessionId, status: { not: 'closed' } }, data: { updatedAt: new Date() } });
        const value = await work(tx);
        ready = true;
        await held;
        return value;
      }, { timeout: 60_000 });
      return { release: () => release(), done, isReady: () => ready };
    };
    const closer = holdSession(async (tx) => tx.reviewSession.update({ where: { id: homeSessionId }, data: { status: 'closed' } }));
    while (!closer.isReady()) await new Promise((resolve) => setTimeout(resolve, 10));
    const appending = runCliAsync([...base, '--apply'], workDir);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    closer.release();
    await closer.done;
    const appended = await appending;
    assert.equal(appended.status, 0, appended.stderr);
    assert.equal(appended.report.totals.commentsCreated, 0, 'nothing is appended to the review closed while the import waited');
    assert.ok(appended.report.warnings.some((warning) => warning.code === 'SESSION_CLOSED'));
    assert.equal(await raw.reviewAnnotation.count({ where: { sessionId: homeSessionId, body: 'A new root comment' } }), 0);
    await raw.reviewSession.update({ where: { id: homeSessionId }, data: { status: 'open' } });

    // A run that only added comments to an existing review: its rollback
    // locks that review too, so a reply written to its new root while the
    // rollback starts blocks it instead of being cascaded away.
    const rootOnly = runCli([...base, '--apply'], workDir);
    assert.equal(rootOnly.status, 0, rootOnly.stderr);
    assert.equal(rootOnly.report.totals.sessionsCreated, 0);
    assert.equal(rootOnly.report.totals.commentsCreated, 1);
    const rootOnlyRunId = rootOnly.report.run.id;
    const newRoot = await raw.reviewAnnotation.findFirst({ where: { sessionId: homeSessionId, body: 'A new root comment' } });
    const replier = holdSession(async (tx) => tx.reviewAnnotation.create({ data: {
      sessionId: homeSessionId, parentId: newRoot.id, authorType: 'staff', authorUserId: ids.operator, authorName: 'Operator', body: 'Reply during rollback',
    } }));
    while (!replier.isReady()) await new Promise((resolve) => setTimeout(resolve, 10));
    let rootRollbackDone = false;
    const rootRollback = runCliAsync(['--organization-id', ids.orgA, '--rollback', rootOnlyRunId], workDir).then((result) => { rootRollbackDone = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(rootRollbackDone, false, 'the rollback waits for the open reply transaction');
    replier.release();
    const reply = await replier.done;
    const refusedRoot = await rootRollback;
    assert.equal(refusedRoot.status, 1, 'the rollback is refused once the reply commits');
    assert.match(refusedRoot.stderr, /Later work depends on this run/);
    assert.ok(await raw.reviewAnnotation.findUnique({ where: { id: reply.id } }), 'the concurrent reply survives');
    await raw.reviewAnnotation.delete({ where: { id: reply.id } });
    const rootRolledBack = runCli(['--organization-id', ids.orgA, '--rollback', rootOnlyRunId], workDir);
    assert.equal(rootRolledBack.status, 0, rootRolledBack.stderr);
    assert.deepEqual(rootRolledBack.report.deleted, { sessions: 0, comments: 1, attachments: 0, files: 0, records: 1 });

    // Imports and rollbacks of one source in one organization are serialised
    // by an advisory lock taken before the ledger is read. A rollback that
    // deletes a comment-only run while an import waits is therefore seen by
    // the import, which re-creates the comment instead of reporting it
    // unchanged from a stale ledger.
    const rootAgain = runCli([...base, '--apply'], workDir);
    assert.equal(rootAgain.status, 0, rootAgain.stderr);
    assert.equal(rootAgain.report.totals.commentsCreated, 1);
    const scopeKey = importScopeLockKey('MARKUP_CSV', ids.orgA);
    let releaseScope;
    const scopeHeld = new Promise((resolve) => { releaseScope = resolve; });
    let scopeReady = false;
    const rollbackLike = raw.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`;
      // What rolling back that comment-only run removes.
      const again = await tx.markupImportRecord.findMany({ where: { runId: rootAgain.report.run.id } });
      await tx.reviewAnnotation.deleteMany({ where: { id: { in: again.map((record) => record.annotationId) } } });
      await tx.markupImportRecord.deleteMany({ where: { runId: rootAgain.report.run.id } });
      await tx.importRun.update({ where: { id: rootAgain.report.run.id }, data: { status: 'ROLLED_BACK', rolledBackAt: new Date() } });
      scopeReady = true;
      await scopeHeld;
    }, { timeout: 60_000 });
    while (!scopeReady) await new Promise((resolve) => setTimeout(resolve, 10));
    let waitingDone = false;
    const waiting = runCliAsync([...base, '--apply'], workDir).then((result) => { waitingDone = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(waitingDone, false, 'the import waits for the rollback of the same organization and source');
    releaseScope();
    await rollbackLike;
    const afterRollback = await waiting;
    assert.equal(afterRollback.status, 0, afterRollback.stderr);
    assert.equal(afterRollback.report.totals.commentsCreated, 1, 'the rolled-back comment is imported again, not reported unchanged');
    assert.equal(await raw.reviewAnnotation.count({ where: { sessionId: homeSessionId, body: 'A new root comment' } }), 1);
    const cleanup = runCli(['--organization-id', ids.orgA, '--rollback', afterRollback.report.run.id], workDir);
    assert.equal(cleanup.status, 0, cleanup.stderr);
    fs.writeFileSync(csv, withReply);

    // Kind and outcome vocabularies are enforced by the database.
    await assert.rejects(raw.markupImportRecord.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, runId, kind: 'BOGUS', sourceKey: `markup:bogus-${suffix}`,
      markupProject: 'x', fileName: 'x.png', contentSha256: 'a'.repeat(64),
    } }), /markup_import_records_kind_check/);

    assert.deepEqual(await orgBSnapshot(), orgBBefore, 'organization B is untouched');
  } finally {
    await raw.reviewAnnotation.deleteMany({ where: { session: { projectId: { in: projects } }, parentId: { not: null } } });
    await raw.reviewSession.deleteMany({ where: { projectId: { in: projects } } });
    await raw.markupImportRecord.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
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
