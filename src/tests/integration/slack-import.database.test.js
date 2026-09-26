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
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

// Runs the real Slack export importer CLI against a real PostgreSQL database
// (built with `prisma migrate deploy`) to prove the reconciliation contract:
// dry runs write nothing, reruns are idempotent, a changed source is a
// conflict that blocks the live run, rollback removes exactly one run, and an
// import for one organization never touches another.
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const importer = path.join(repoRoot, 'scripts', 'import-slack-export.mjs');
const fixtures = path.join(repoRoot, 'src', 'tests', 'fixtures');

function runCli(args, workDir, { summary = true } = {}) {
  const summaryFile = path.join(workDir, `report-${randomUUID()}.json`);
  const result = spawnSync(process.execPath, [importer, ...args, ...(summary ? ['--summary-file', summaryFile] : [])], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'development' },
  });
  const report = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : null;
  return { status: result.status, stderr: result.stderr, report };
}

test('Slack export import plans, applies idempotently, reports conflicts, rolls back, and stays inside its tenant', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 180_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const ids = {
    orgA: `slack-org-a-${suffix}`, orgB: `slack-org-b-${suffix}`,
    clientA: `slack-client-a-${suffix}`, clientB: `slack-client-b-${suffix}`,
    projectA: `slack-project-a-${suffix}`, projectB: `slack-project-b-${suffix}`,
    userA: `slack-user-a-${suffix}`, userB: `slack-user-b-${suffix}`,
  };
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-slack-import-'));
  const exportDir = path.join(workDir, 'export');
  fs.cpSync(path.join(fixtures, 'slack-export-basic'), exportDir, { recursive: true });
  const mappingFile = path.join(workDir, 'mapping.json');
  const crossTenantMappingFile = path.join(workDir, 'cross-tenant-mapping.json');
  fs.writeFileSync(mappingFile, JSON.stringify({ channels: { general: ids.projectA } }));
  fs.writeFileSync(crossTenantMappingFile, JSON.stringify({ channels: { general: ids.projectB } }));
  const base = ['--organization-id', ids.orgA, '--input-dir', exportDir, '--mapping-file', mappingFile];
  const projects = [ids.projectA, ids.projectB];

  try {
    await raw.organization.createMany({ data: [
      { id: ids.orgA, name: 'Slack import tenant A', slug: `slack-a-${suffix}` },
      { id: ids.orgB, name: 'Slack import tenant B', slug: `slack-b-${suffix}` },
    ] });
    await raw.client.createMany({ data: [
      { id: ids.clientA, organizationId: ids.orgA, name: 'Client A' },
      { id: ids.clientB, organizationId: ids.orgB, name: 'Client B' },
    ] });
    await raw.project.createMany({ data: [
      { id: ids.projectA, organizationId: ids.orgA, clientId: ids.clientA, name: 'Slack project A' },
      { id: ids.projectB, organizationId: ids.orgB, clientId: ids.clientB, name: 'Slack project B' },
    ] });
    await raw.user.createMany({ data: [
      { id: ids.userA, organizationId: ids.orgA, email: `alice+${suffix}@example.test`, password: 'test', name: 'Alice' },
      // Bob's export email belongs to a user in org B only; org A must not map to it.
      { id: ids.userB, organizationId: ids.orgB, email: `bob+${suffix}@elsewhere.test`, password: 'test', name: 'Bob in B' },
    ] });
    // Point the export's Alice at org A's user and Bob at org B's user.
    const usersFile = path.join(exportDir, 'users.json');
    fs.writeFileSync(usersFile, fs.readFileSync(usersFile, 'utf8')
      .replace('Alice@Example.test', `alice+${suffix}@example.test`)
      .replace('bob@not-in-ashbi.test', `bob+${suffix}@elsewhere.test`));
    await raw.chatMessage.create({ data: { projectId: ids.projectB, content: 'Org B history', type: 'TEXT' } });
    const orgBSnapshot = async () => ({
      messages: await raw.chatMessage.findMany({ where: { projectId: ids.projectB }, orderBy: { id: 'asc' } }),
      records: await raw.slackImportRecord.count({ where: { organizationId: ids.orgB } }),
      runs: await raw.importRun.count({ where: { organizationId: ids.orgB } }),
    });
    const orgBBefore = await orgBSnapshot();

    // Dry run plans the mapped channel and writes nothing.
    const dryRun = runCli([...base, '--dry-run'], workDir);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.equal(dryRun.report.mode, 'dry-run');
    assert.equal(dryRun.report.totals.planned, 7);
    assert.deepEqual(dryRun.report.unmappedChannels.map((channel) => channel.name), ['random', 'client-acme']);
    assert.deepEqual(dryRun.report.users.unmapped.map((user) => user.id), ['U02BOB']);
    assert.equal(await raw.chatMessage.count({ where: { projectId: ids.projectA } }), 0);
    assert.equal(await raw.importRun.count({ where: { organizationId: ids.orgA } }), 0);

    // Live run imports threads and authors, and records a run.
    const first = runCli([...base, '--apply'], workDir);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.report.complete, true);
    assert.equal(first.report.totals.created, 7);
    const runId = first.report.run.id;
    const imported = await raw.chatMessage.findMany({ where: { projectId: ids.projectA }, orderBy: { createdAt: 'asc' } });
    assert.equal(imported.length, 7);
    const root = imported.find((message) => message.externalMessageId === '1767600000.000100');
    assert.equal(root.authorId, ids.userA);
    assert.equal(root.externalSource, 'SLACK');
    const reply = imported.find((message) => message.externalMessageId === '1767600200.000300');
    assert.equal(reply.parentId, root.id);
    assert.equal(reply.authorId, null, 'a user from another organization is never mapped');
    assert.equal(await raw.chatReaction.count({ where: { messageId: root.id } }), 1);
    assert.equal(await raw.slackImportRecord.count({ where: { runId } }), 7);
    assert.equal((await raw.importRun.findUnique({ where: { id: runId } })).status, 'APPLIED');
    assert.equal(await raw.auditEvent.count({ where: { organizationId: ids.orgA, action: 'migration_import.applied', entityId: runId } }), 1);

    // Rerun is a no-op.
    const rerun = runCli([...base, '--apply'], workDir);
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.equal(rerun.report.totals.created, 0);
    assert.equal(rerun.report.totals.unchanged, 7);
    assert.equal(await raw.chatMessage.count({ where: { projectId: ids.projectA } }), 7);
    assert.equal(await raw.slackImportRecord.count({ where: { organizationId: ids.orgA } }), 7);

    // A changed source is a conflict and blocks the live run without writes.
    const dayFile = path.join(exportDir, 'general', '2026-01-05.json');
    fs.writeFileSync(dayFile, fs.readFileSync(dayFile, 'utf8').replace('Thanks <@U01ALICE>!', 'Edited later in Slack'));
    const changedDryRun = runCli([...base, '--dry-run'], workDir);
    assert.equal(changedDryRun.status, 0, changedDryRun.stderr);
    assert.equal(changedDryRun.report.complete, false);
    assert.deepEqual(changedDryRun.report.errors.map((error) => error.code), ['SOURCE_CHANGED']);
    const runsBefore = await raw.importRun.count({ where: { organizationId: ids.orgA } });
    const changedLive = runCli([...base, '--apply'], workDir);
    assert.equal(changedLive.status, 1);
    assert.match(changedLive.stderr, /unresolved reconciliation findings/);
    assert.equal(changedLive.report, null, 'a refused live run writes no report file');
    assert.equal((await raw.chatMessage.findUnique({ where: { id: reply.id } })).content, reply.content);
    assert.equal(await raw.importRun.count({ where: { organizationId: ids.orgA } }), runsBefore);

    // Mapping org A's import to org B's project is refused.
    const crossTenant = runCli(['--organization-id', ids.orgA, '--input-dir', exportDir, '--mapping-file', crossTenantMappingFile, '--apply'], workDir);
    assert.equal(crossTenant.status, 1);
    assert.match(crossTenant.stderr, /UNKNOWN_PROJECT/);

    // Rollback removes exactly the first run's messages, reactions and records.
    const rollback = runCli(['--organization-id', ids.orgA, '--rollback', runId], workDir);
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.deepEqual(rollback.report.deleted, { messages: 7, records: 7 });
    assert.equal(await raw.chatMessage.count({ where: { projectId: ids.projectA } }), 0);
    assert.equal(await raw.chatReaction.count({ where: { messageId: root.id } }), 0);
    assert.equal((await raw.importRun.findUnique({ where: { id: runId } })).status, 'ROLLED_BACK');
    const repeat = runCli(['--organization-id', ids.orgA, '--rollback', runId], workDir);
    assert.equal(repeat.status, 1);
    const wrongTenant = runCli(['--organization-id', ids.orgB, '--rollback', runId], workDir);
    assert.equal(wrongTenant.status, 1);
    assert.match(wrongTenant.stderr, /not found in this organization/);

    // A rolled-back export imports again, one channel per run; a message later
    // deleted in the Hub is then a warning, not a blocker, and stays deleted.
    const reimport = runCli([...base, '--channel', 'general', '--apply'], workDir);
    assert.equal(reimport.status, 0, reimport.stderr);
    assert.equal(reimport.report.totals.created, 7);
    await raw.chatMessage.deleteMany({ where: { projectId: ids.projectA, externalMessageId: '1767686400.000100' } });
    const afterDelete = runCli([...base, '--channel', 'general', '--apply'], workDir);
    assert.equal(afterDelete.status, 0, afterDelete.stderr);
    assert.equal(afterDelete.report.totals.deletedInHub, 1);
    assert.equal(afterDelete.report.totals.created, 0);
    assert.equal(await raw.chatMessage.count({ where: { projectId: ids.projectA } }), 6);

    // Status and outcome vocabularies are enforced by the database.
    await assert.rejects(raw.importRun.create({ data: { organizationId: ids.orgA, source: 'SLACK_EXPORT', status: 'BOGUS' } }), /import_runs_status_check/);

    // Unsafe export entries block only when their channel is mapped.
    const traversalMapping = path.join(workDir, 'traversal-mapping.json');
    fs.writeFileSync(traversalMapping, JSON.stringify({ safe: ids.projectA }));
    const traversalArgs = ['--organization-id', ids.orgA, '--input-dir', path.join(fixtures, 'slack-export-traversal'), '--mapping-file', traversalMapping];
    const traversal = runCli(traversalArgs, workDir);
    assert.equal(traversal.status, 0, traversal.stderr);
    assert.equal(traversal.report.complete, true);
    assert.ok(traversal.report.warnings.some((warning) => warning.code === 'UNSAFE_CHANNEL_NAME'));
    fs.writeFileSync(traversalMapping, JSON.stringify({ safe: ids.projectA, C01ESCAPE: ids.projectA }));
    const mappedTraversal = runCli(traversalArgs, workDir);
    assert.equal(mappedTraversal.report.complete, false);
    assert.ok(mappedTraversal.report.errors.some((error) => error.code === 'UNSAFE_CHANNEL_NAME'));

    assert.deepEqual(await orgBSnapshot(), orgBBefore, 'organization B is untouched');
  } finally {
    await raw.chatMessage.deleteMany({ where: { projectId: { in: projects }, parentId: { not: null } } });
    await raw.chatMessage.deleteMany({ where: { projectId: { in: projects } } });
    await raw.slackImportRecord.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await raw.importRun.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
    await raw.user.deleteMany({ where: { id: { in: [ids.userA, ids.userB] } } });
    await raw.project.deleteMany({ where: { id: { in: projects } } });
    await raw.client.deleteMany({ where: { id: { in: [ids.clientA, ids.clientB] } } });
    await purgeFixtureAuditEvents(raw, { ids: [ids.orgA, ids.orgB] });
    await raw.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
    await raw.$disconnect();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
