// Offboarding workspace export against a real PostgreSQL schema (built with
// `prisma migrate deploy`; docs/workspace-export.md). Two organizations get
// data across finance, communication, documents, media review and files;
// exporting organization A through the operator CLI must produce every
// org-A row, nothing of organization B, no secrets, verified file copies,
// an exception for a missing file, and must refuse a non-empty directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const exporter = path.join(repoRoot, 'scripts', 'export-workspace.js');
const verifier = path.join(repoRoot, 'scripts', 'verify-workspace-export.js');

function runNode(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'development' },
  });
}

function listFiles(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(root, relative) : [relative];
  });
}

const readJsonl = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

test('workspace export: complete, tenant-isolated, secret-free, with verified files', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 12);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-workspace-export-'));
  const uploadsDir = path.join(workDir, 'uploads');
  fs.mkdirSync(uploadsDir);
  const orgs = { a: `wx-org-a-${suffix}`, b: `wx-org-b-${suffix}` };
  // Secret values are generated per run and must never appear in the output.
  const secrets = {};
  const secret = (label) => (secrets[label] = `wxsecret-${label}-${randomUUID()}`);
  const idsOf = {};
  const id = (key, org) => {
    const value = `wx-${key}-${org}-${suffix}`;
    (idsOf[org] ??= []).push(value);
    return value;
  };

  const seed = async (org) => {
    const orgId = orgs[org];
    const i = (key) => id(key, org);
    await raw.organization.create({ data: { id: orgId, name: `Export tenant ${org.toUpperCase()} ${suffix}`, slug: `wx-${org}-${suffix}` } });
    const staff = i('staff');
    await raw.user.create({ data: {
      id: staff, organizationId: orgId, email: `wx-staff-${org}-${suffix}@example.com`, name: `Staff ${org}`, role: 'ADMIN',
      password: secret(`password-${org}`), resetToken: secret(`reset-${org}`), mfaSecret: secret(`mfa-${org}`), mfaRecoveryCodes: [secret(`recovery-${org}`)],
    } });
    const client = i('client');
    await raw.client.create({ data: { id: client, organizationId: orgId, name: `Client ${org}` } });
    // A trashed client (and its contact) is not part of the export.
    const trashed = i('client-trashed');
    await raw.client.create({ data: { id: trashed, organizationId: orgId, name: `Trashed ${org}`, deletedAt: new Date() } });
    await raw.contact.createMany({ data: [
      { id: i('contact'), clientId: client, email: `c-${org}-${suffix}@example.com`, name: 'Contact' },
      { id: i('contact-trashed'), clientId: trashed, email: `t-${org}-${suffix}@example.com`, name: 'Trashed contact' },
    ] });
    const project = i('project');
    await raw.project.create({ data: { id: project, organizationId: orgId, clientId: client, name: `Project ${org}`, viewToken: secret(`project-view-${org}`) } });
    const milestone = i('milestone');
    await raw.milestone.create({ data: { id: milestone, projectId: project, name: 'Launch', dueDate: new Date() } });
    const task = i('task');
    await raw.task.create({ data: { id: task, projectId: project, title: 'Build', milestoneId: milestone, assigneeId: staff } });
    await raw.taskComment.create({ data: { id: i('task-comment'), taskId: task, authorId: staff, content: 'Looks good' } });
    await raw.note.create({ data: { id: i('wiki'), projectId: project, authorId: staff, title: 'Handbook', content: '# Wiki', type: 'WIKI' } });

    // Finance
    const invoice = i('invoice');
    await raw.invoice.create({ data: { id: invoice, invoiceNumber: `WX-${org}-${suffix}`, organizationId: orgId, clientId: client, projectId: project, createdById: staff, total: 113, viewToken: secret(`invoice-view-${org}`), draftData: secret(`draft-${org}`) } });
    await raw.invoiceLineItem.create({ data: { id: i('invoice-line'), invoiceId: invoice, description: 'Design', unitPrice: 100, total: 100 } });
    await raw.invoicePayment.create({ data: { id: i('invoice-payment'), invoiceId: invoice, amount: 113, method: 'BANK', transactionId: `ref-${org}` } });
    const proposal = i('proposal');
    await raw.proposal.create({ data: { id: proposal, title: 'Proposal', clientId: client, projectId: project, createdById: staff, viewToken: secret(`proposal-view-${org}`) } });
    await raw.proposalLineItem.create({ data: { id: i('proposal-line'), proposalId: proposal, description: 'Scope', unitPrice: 50, total: 50 } });
    await raw.contract.create({ data: { id: i('contract'), title: 'MSA', content: 'Terms', clientId: client, createdById: staff, proposalId: proposal, signToken: secret(`sign-${org}`) } });
    await raw.estimate.create({ data: { id: i('estimate'), clientId: client, title: 'Estimate', viewToken: secret(`estimate-view-${org}`) } });
    await raw.expense.create({ data: { id: i('expense'), description: 'Hosting', amount: 20, clientId: client, projectId: project } });
    await raw.retainerPlan.create({ data: { id: i('retainer'), clientId: client, tier: '999', hoursPerMonth: 20 } });
    await raw.timeEntry.create({ data: { id: i('time-entry'), projectId: project, userId: staff, taskId: task, duration: 60 } });

    // Communication
    const thread = i('thread');
    await raw.thread.create({ data: { id: thread, subject: 'Hello', clientId: client, projectId: project } });
    await raw.message.create({ data: { id: i('message'), threadId: thread, direction: 'INBOUND', senderEmail: `s-${org}@example.com`, bodyText: 'Hi', rawEmail: secret(`raw-email-${org}`) } });
    await raw.internalNote.create({ data: { id: i('internal-note'), threadId: thread, authorId: staff, content: 'FYI' } });
    const chatInternal = i('chat-internal');
    await raw.chatMessage.createMany({ data: [
      { id: chatInternal, projectId: project, authorId: staff, content: 'Team only', visibility: 'INTERNAL' },
      { id: i('chat-client'), projectId: project, authorId: staff, content: 'Hello client', visibility: 'CLIENT' },
    ] });
    await raw.chatReaction.create({ data: { id: i('chat-reaction'), messageId: chatInternal, userId: staff, emoji: '+1' } });

    // Files and media review
    const stored = Buffer.from(`file-bytes-${org}-${suffix}`);
    const storedName = `wx-${org}-${suffix}.png`;
    fs.writeFileSync(path.join(uploadsDir, storedName), stored);
    const attachment = i('attachment');
    await raw.attachment.create({ data: { id: attachment, organizationId: orgId, filename: storedName, originalName: `mockup ${org}.png`, mimeType: 'image/png', size: stored.length, path: `/uploads/${storedName}`, entityType: 'PROJECT', entityId: project, uploadedById: staff } });
    const missing = i('attachment-missing');
    await raw.attachment.create({ data: { id: missing, organizationId: orgId, filename: `gone-${org}-${suffix}.pdf`, originalName: 'gone.pdf', mimeType: 'application/pdf', size: 10, path: `/uploads/gone-${org}-${suffix}.pdf`, entityType: 'PROJECT', entityId: project, uploadedById: staff } });
    const session = i('review-session');
    await raw.reviewSession.create({ data: { id: session, organizationId: orgId, projectId: project, attachmentId: attachment, title: 'Mockup review', createdById: staff } });
    await raw.reviewAnnotation.create({ data: { id: i('review-annotation'), sessionId: session, authorType: 'staff', authorUserId: staff, authorName: 'Staff', body: 'Bigger logo' } });
    await raw.reviewDecision.create({ data: { id: i('review-decision'), sessionId: session, decision: 'approved', actorType: 'staff', actorUserId: staff, actorName: 'Staff' } });
    const tokenHash = sha256(secret(`share-${org}`));
    secrets[`share-hash-${org}`] = tokenHash;
    await raw.reviewShareLink.create({ data: { id: i('review-share'), sessionId: session, tokenHash, expiresAt: new Date(Date.now() + 86_400_000), createdById: staff } });

    // Secret-bearing records that must never be exported.
    const apiKeyHash = sha256(secret(`api-key-${org}`));
    secrets[`api-key-hash-${org}`] = apiKeyHash;
    await raw.apiKey.create({ data: { id: i('api-key'), name: 'Bridge', key: apiKeyHash, userId: staff } });
    await raw.credential.create({ data: { id: i('credential'), organizationId: orgId, clientId: client, label: 'Hosting', password: secret(`vault-${org}`) } });
    await raw.integration.create({ data: { id: i('integration'), organizationId: orgId, type: 'QUICKBOOKS', accessToken: secret(`oauth-${org}`), refreshToken: secret(`oauth-refresh-${org}`) } });
    return { stored, attachment, missing, storedName };
  };

  let fixtures;
  try {
    fixtures = { a: await seed('a'), b: await seed('b') };
    const outputDir = path.join(workDir, 'export-a');
    const result = runNode(exporter, ['--organization-id', orgs.a, '--output-dir', outputDir, '--uploads-dir', uploadsDir, '--page-size', '2'], workDir);
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.organizationId, orgs.a);

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.format, 'ashbi-workspace-export-directory');
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.organizationId, orgs.a);
    assert.ok(Date.parse(manifest.generatedAt));
    assert.ok(fs.existsSync(path.join(outputDir, 'README.md')));

    // Manifest counts and checksums match the data files.
    const byName = Object.fromEntries(manifest.entities.map((entity) => [entity.name, entity]));
    const rowsOf = {};
    for (const entity of manifest.entities) {
      const file = path.join(outputDir, entity.file);
      const bytes = fs.readFileSync(file);
      rowsOf[entity.name] = readJsonl(file);
      assert.equal(rowsOf[entity.name].length, entity.rows, `${entity.name} row count`);
      assert.equal(sha256(bytes), entity.sha256, `${entity.name} sha256`);
      assert.equal(bytes.length, entity.bytes, `${entity.name} bytes`);
    }

    // Every org-A row is present, with the expected counts (page size 2
    // exercises the keyset pagination).
    const expected = {
      organization: 1, users: 1, clients: 1, contacts: 1, projects: 1, milestones: 1, tasks: 1, task_comments: 1, notes: 1,
      invoices: 1, invoice_line_items: 1, invoice_payments: 1, proposals: 1, proposal_line_items: 1, contracts: 1,
      estimates: 1, expenses: 1, retainer_plans: 1, time_entries: 1,
      threads: 1, messages: 1, internal_notes: 1, chat_messages: 2, chat_reactions: 1,
      review_sessions: 1, review_annotations: 1, review_decisions: 1, review_share_links: 1, attachments: 2,
    };
    for (const [name, count] of Object.entries(expected)) {
      assert.equal(byName[name]?.rows, count, `${name} should have ${count} org-A row(s)`);
    }
    const exportedIds = new Set(Object.values(rowsOf).flat().map((row) => row.id));
    for (const orgAId of idsOf.a.filter((value) => !/trashed|api-key|credential|integration/.test(value))) {
      assert.ok(exportedIds.has(orgAId), `org-A record ${orgAId} is exported`);
    }
    assert.ok(!exportedIds.has(`wx-client-trashed-a-${suffix}`), 'trashed client is not exported');
    assert.deepEqual(rowsOf.chat_messages.map((row) => row.visibility).sort(), ['CLIENT', 'INTERNAL']);
    assert.equal(rowsOf.users[0].email, `wx-staff-a-${suffix}@example.com`);

    // Zero org-B data anywhere in the output, and no secrets.
    const output = listFiles(outputDir).map((relative) => fs.readFileSync(path.join(outputDir, relative)).toString('latin1')).join('\n');
    for (const needle of [orgs.b, `wx-b-${suffix}`, ...idsOf.b, fixtures.b.stored.toString('latin1'), fixtures.b.storedName]) {
      assert.ok(!output.includes(needle), `org-B value ${needle} must not appear in the export`);
    }
    for (const [label, value] of Object.entries(secrets)) {
      assert.ok(!output.includes(value), `secret ${label} must not appear in the export`);
    }
    const forbiddenKeys = ['password', 'resetToken', 'mfaSecret', 'mfaRecoveryCodes', 'viewToken', 'signToken', 'tokenHash', 'rawEmail', 'draftData', 'accessToken', 'refreshToken'];
    for (const [name, rows] of Object.entries(rowsOf)) {
      for (const row of rows) {
        for (const key of forbiddenKeys) assert.ok(!(key in row), `${name}.${key} must not be exported`);
      }
    }
    for (const model of ['ApiKey', 'Credential', 'Integration', 'AuditEvent']) {
      assert.ok(manifest.exclusions.some((exclusion) => exclusion.model === model), `${model} is listed as excluded`);
    }

    // The stored file is copied and verified; the missing one is an exception.
    assert.equal(manifest.files.length, 1);
    const [copied] = manifest.files;
    assert.equal(copied.recordId, fixtures.a.attachment);
    assert.equal(copied.sha256, sha256(fixtures.a.stored));
    assert.equal(copied.size, fixtures.a.stored.length);
    assert.equal(copied.exportPath, `files/attachments/${fixtures.a.attachment}/mockup a.png`);
    assert.equal(sha256(fs.readFileSync(path.join(outputDir, copied.exportPath))), copied.sha256);
    assert.deepEqual(manifest.exceptions.map(({ code, recordId }) => ({ code, recordId })), [{ code: 'FILE_MISSING', recordId: fixtures.a.missing }]);
    assert.equal(manifest.totals.exceptions, 1);
    assert.match(result.stderr, /1 exception/);

    // SHA256SUMS covers every other file, and the offline verifier passes.
    const sums = fs.readFileSync(path.join(outputDir, 'SHA256SUMS'), 'utf8').trim().split('\n');
    assert.deepEqual(sums.map((line) => line.slice(66)).sort(), listFiles(outputDir).filter((file) => file !== 'SHA256SUMS').sort());
    for (const line of sums) assert.equal(sha256(fs.readFileSync(path.join(outputDir, line.slice(66)))), line.slice(0, 64));
    const verified = runNode(verifier, ['--input-dir', outputDir], workDir);
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    assert.equal(JSON.parse(verified.stdout).valid, true);

    // Tampering is detected.
    fs.appendFileSync(path.join(outputDir, 'data', 'clients.jsonl'), '{"id":"forged"}\n');
    assert.equal(runNode(verifier, ['--input-dir', outputDir], workDir).status, 1);

    // Refuses to write into a non-empty directory, leaving it untouched.
    const manifestBefore = fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8');
    const again = runNode(exporter, ['--organization-id', orgs.a, '--output-dir', outputDir, '--uploads-dir', uploadsDir], workDir);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /Refusing to write into non-empty directory/);
    assert.equal(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'), manifestBefore);
    const occupied = path.join(workDir, 'occupied');
    fs.mkdirSync(occupied);
    fs.writeFileSync(path.join(occupied, 'keep.txt'), 'operator file');
    const refused = runNode(exporter, ['--organization-id', orgs.a, '--output-dir', occupied, '--uploads-dir', uploadsDir], workDir);
    assert.equal(refused.status, 1);
    assert.deepEqual(fs.readdirSync(occupied), ['keep.txt']);

    // --no-files exports records only; an existing empty directory is accepted.
    const recordsOnly = path.join(workDir, 'records-only');
    fs.mkdirSync(recordsOnly);
    const noFiles = runNode(exporter, ['--organization-id', orgs.a, '--output-dir', recordsOnly, '--no-files', '--uploads-dir', uploadsDir], workDir);
    assert.equal(noFiles.status, 0, noFiles.stderr);
    const recordsManifest = JSON.parse(fs.readFileSync(path.join(recordsOnly, 'manifest.json'), 'utf8'));
    assert.equal(recordsManifest.includeFiles, false);
    assert.deepEqual(recordsManifest.files, []);
    assert.ok(!fs.existsSync(path.join(recordsOnly, 'files')));
    assert.equal(recordsManifest.entities.find((entity) => entity.name === 'attachments').rows, 2);

    // Unknown organization: fails without writing a manifest.
    const unknown = path.join(workDir, 'unknown');
    const notFound = runNode(exporter, ['--organization-id', `wx-missing-${suffix}`, '--output-dir', unknown], workDir);
    assert.equal(notFound.status, 1);
    assert.match(notFound.stderr, /Organization not found/);
    assert.ok(!fs.existsSync(path.join(unknown, 'manifest.json')));
  } finally {
    const orgIds = [orgs.a, orgs.b];
    const projectWhere = { project: { organizationId: { in: orgIds } } };
    const clientWhere = { client: { organizationId: { in: orgIds } } };
    await raw.reviewSession.deleteMany({ where: { organizationId: { in: orgIds } } });
    await raw.attachment.deleteMany({ where: { organizationId: { in: orgIds } } });
    await raw.chatReaction.deleteMany({ where: { message: projectWhere } });
    await raw.chatMessage.deleteMany({ where: projectWhere });
    await raw.timeEntry.deleteMany({ where: projectWhere });
    await raw.expense.deleteMany({ where: clientWhere });
    await raw.contract.deleteMany({ where: clientWhere });
    await raw.invoice.deleteMany({ where: clientWhere });
    await raw.proposal.deleteMany({ where: clientWhere });
    await raw.estimate.deleteMany({ where: clientWhere });
    await raw.retainerPlan.deleteMany({ where: clientWhere });
    await raw.thread.deleteMany({ where: clientWhere });
    await raw.note.deleteMany({ where: projectWhere });
    await raw.task.deleteMany({ where: projectWhere });
    await raw.milestone.deleteMany({ where: projectWhere });
    await raw.apiKey.deleteMany({ where: { user: { organizationId: { in: orgIds } } } });
    await raw.credential.deleteMany({ where: { organizationId: { in: orgIds } } });
    await raw.integration.deleteMany({ where: { organizationId: { in: orgIds } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgIds } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgIds } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgIds })) {
      await raw.organization.deleteMany({ where: { id: { in: orgIds } } });
    }
    await raw.$disconnect();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
