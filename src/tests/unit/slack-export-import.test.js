import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTenantJob } from '../../jobs/tenant-iteration.js';
import {
  MAX_EXPORT_JSON_BYTES,
  SlackImportBlockedError,
  parseSlackChannelMapping,
  readSlackExport,
  renderSlackText,
  resolveInsideExport,
  rollbackSlackImportRun,
  runSlackExportImport,
  parseSlackMessages,
  sanitizeDisplayText,
} from '../../services/slack-export-import.service.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const basicExport = path.join(fixtures, 'slack-export-basic');
const traversalExport = path.join(fixtures, 'slack-export-traversal');

// Minimal in-memory Prisma stand-in: equality, `in`, `not`, AND and the
// relation hops the tenant proxy adds (chatMessage -> project -> client).
// Interactive transactions snapshot and restore every table on failure.
function createFakeDb() {
  let sequence = 0;
  let tables = {
    organization: [{ id: 'org-a' }, { id: 'org-b' }],
    client: [{ id: 'client-a', organizationId: 'org-a' }, { id: 'client-b', organizationId: 'org-b' }],
    project: [
      { id: 'project-a', organizationId: 'org-a', clientId: 'client-a', name: 'A' },
      { id: 'project-a2', organizationId: 'org-a', clientId: 'client-a', name: 'A2' },
      { id: 'project-b', organizationId: 'org-b', clientId: 'client-b', name: 'B' },
    ],
    user: [
      { id: 'user-alice', organizationId: 'org-a', email: 'alice@example.test', isActive: true },
      { id: 'user-b', organizationId: 'org-b', email: 'bob@not-in-ashbi.test', isActive: true },
    ],
    chatMessage: [
      { id: 'b-existing', projectId: 'project-b', content: 'Org B history', parentId: null, externalSource: null, externalMessageId: null },
    ],
    chatReaction: [],
    slackImportRecord: [],
    slackChannelMapping: [],
    importRun: [],
    auditEvent: [],
  };
  const calls = [];
  const relations = {
    project: { client: ['client', 'clientId'] },
    chatMessage: { project: ['project', 'projectId'] },
    chatReaction: { message: ['chatMessage', 'messageId'] },
  };
  const matches = (table, row, where) => Object.entries(where ?? {}).every(([key, condition]) => {
    if (key === 'AND') return condition.every((part) => matches(table, row, part));
    const relation = relations[table]?.[key];
    if (relation) {
      const target = tables[relation[0]].find((candidate) => candidate.id === row[relation[1]]);
      return Boolean(target) && matches(relation[0], target, condition);
    }
    const value = row[key] ?? null;
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('in' in condition && !condition.in.includes(value)) return false;
      if ('not' in condition && (condition.not === null ? value === null : value === condition.not)) return false;
      return true;
    }
    return value === (condition ?? null);
  });
  const pick = (row, select) => (select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : { ...row });
  const unique = {
    slackImportRecord: (row) => `${row.organizationId}:${row.sourceKey}`,
    chatReaction: (row) => `${row.messageId}:${row.userId}:${row.emoji}`,
  };
  const assertUnique = (table, rows) => {
    const keyOf = unique[table];
    if (!keyOf) return;
    const seen = new Set(tables[table].map(keyOf));
    for (const row of rows) {
      if (seen.has(keyOf(row))) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      seen.add(keyOf(row));
    }
  };
  const log = (table, method) => (fn) => (...args) => { calls.push(`${table}.${method}`); return fn(...args); };
  const delegate = (table) => Object.fromEntries(Object.entries({
    findMany: async ({ where, select } = {}) => tables[table].filter((row) => matches(table, row, where)).map((row) => pick(row, select)),
    findFirst: async ({ where, select } = {}) => {
      const row = tables[table].find((candidate) => matches(table, candidate, where));
      return row ? pick(row, select) : null;
    },
    findUnique: async ({ where, select } = {}) => {
      const row = tables[table].find((candidate) => matches(table, candidate, where));
      return row ? pick(row, select) : null;
    },
    count: async ({ where } = {}) => tables[table].filter((row) => matches(table, row, where)).length,
    create: async ({ data }) => {
      assertUnique(table, [data]);
      const row = { id: `${table}-${++sequence}`, createdAt: new Date(), ...data, updatedAt: new Date() };
      tables[table].push(row);
      return { ...row };
    },
    createMany: async ({ data }) => {
      assertUnique(table, data);
      for (const row of data) tables[table].push({ id: `${table}-${++sequence}`, ...row });
      return { count: data.length };
    },
    update: async ({ where, data }) => {
      const row = tables[table].find((candidate) => matches(table, candidate, where));
      if (!row) throw new Error('Record not found');
      Object.assign(row, data);
      return { ...row };
    },
    deleteMany: async ({ where } = {}) => {
      const removed = tables[table].filter((row) => matches(table, row, where));
      tables[table] = tables[table].filter((row) => !removed.includes(row));
      if (table === 'chatMessage') {
        const ids = new Set(removed.map((row) => row.id));
        tables.chatReaction = tables.chatReaction.filter((row) => !ids.has(row.messageId));
      }
      return { count: removed.length };
    },
  }).map(([method, fn]) => [method, log(table, method)(fn)]));
  const db = {
    get tables() { return tables; },
    calls,
    async $transaction(callback) {
      const snapshot = structuredClone(tables);
      try {
        return await callback(db);
      } catch (error) {
        tables = snapshot;
        throw error;
      }
    },
  };
  for (const table of Object.keys(tables)) {
    Object.defineProperty(db, table, { get: () => delegate(table), enumerable: true });
  }
  return db;
}

const mapping = parseSlackChannelMapping({ channels: { general: 'project-a', G01ACME: 'project-a2' } });

function run(db, organizationId, callback) {
  return runTenantJob(db, organizationId, (tenantDb) => callback(tenantDb));
}

function copyExport(source) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-slack-export-'));
  fs.cpSync(source, target, { recursive: true });
  return target;
}

test('parses channels, private groups, threads, edits, reactions and file references', async () => {
  const exportData = await readSlackExport(basicExport);
  assert.deepEqual(exportData.channels.map((channel) => [channel.name, channel.isPrivate, channel.messages.length]), [
    ['general', false, 7], ['random', false, 1], ['client-acme', true, 1],
  ]);
  const general = exportData.channels[0];
  assert.deepEqual(general.skipped, { channel_join: 1, bot_message: 1 });
  const [root, reply, fileShare, broadcast] = general.messages;
  assert.equal(root.editedTs, '1767600100.000000');
  assert.equal(root.reactions[0].name, 'thumbsup');
  assert.equal(reply.isReply, true);
  assert.equal(reply.threadTs, root.ts);
  assert.equal(broadcast.subtype, 'thread_broadcast');
  assert.deepEqual(fileShare.files, [{ id: 'F01BRIEF', name: 'brief.pdf', mimetype: 'application/pdf', size: 2048 }]);
  assert.doesNotMatch(JSON.stringify(exportData), /xoxe|files-pri/, 'file URLs (which may embed tokens) are never retained');
  assert.equal(exportData.users.get('U01ALICE').email, 'alice@example.test');
  assert.deepEqual(exportData.findings.unsupportedFiles, ['general/canvas.html']);
  assert.deepEqual(exportData.findings.unsupportedConversations.map((item) => item.file), ['dms.json']);
});

test('renders Slack mrkdwn entities as plain text', () => {
  const users = new Map([['U01ALICE', { name: 'Alice' }]]);
  const channelsById = new Map([['C02RANDOM', { name: 'random' }]]);
  assert.equal(
    renderSlackText('Hi <@U01ALICE>, see <#C02RANDOM> &amp; <https://x.test|docs> <!here> &lt;ok&gt;', { users, channelsById }),
    'Hi @Alice, see #random & docs (https://x.test) @here <ok>',
  );
});

test('dry run plans per-channel counts and reports unmapped users, channels and unsupported items without writing', async () => {
  const db = createFakeDb();
  const exportData = await readSlackExport(basicExport);
  const report = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping }));
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.complete, true);
  assert.equal(report.totals.planned, 8);
  assert.equal(report.totals.threadReplies, 4);
  assert.deepEqual(report.channels.map((channel) => [channel.name, channel.projectId, channel.planned]), [
    ['general', 'project-a', 7], ['client-acme', 'project-a2', 1],
  ]);
  assert.deepEqual(report.unmappedChannels, [{ id: 'C02RANDOM', name: 'random', messages: 1 }]);
  assert.deepEqual(report.users, { mapped: 1, unmapped: [{ id: 'U02BOB', name: 'Bob Outside' }] });
  assert.deepEqual(report.skippedSubtypes, { channel_join: 1, bot_message: 1 });
  assert.deepEqual(report.reactionsDropped, { unmappedUser: 1, emojiTooLong: 1 });
  assert.deepEqual(report.unsupported.assets.map((asset) => asset.fileId), ['F01BRIEF']);
  assert.ok(report.warnings.some((warning) => warning.code === 'THREAD_PARENT_MISSING'));
  assert.equal(db.tables.chatMessage.length, 1);
  assert.equal(db.tables.importRun.length, 0);
  assert.equal(db.tables.slackImportRecord.length, 0);
});

test('apply imports threads, authors and reactions, records the run, and a rerun creates no duplicates', async () => {
  const db = createFakeDb();
  const exportData = await readSlackExport(basicExport);
  const report = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping, apply: true }));
  assert.equal(report.complete, true);
  assert.equal(report.totals.created, 8);
  assert.ok(report.run.id);
  const imported = db.tables.chatMessage.filter((message) => message.projectId === 'project-a');
  assert.equal(imported.length, 7);
  const byTs = new Map(imported.map((message) => [message.externalMessageId, message]));
  const root = byTs.get('1767600000.000100');
  assert.equal(root.authorId, 'user-alice');
  assert.equal(root.parentId, null);
  assert.equal(root.isEdited, true);
  assert.equal(root.content, 'Kickoff notes for #random & the brief (https://example.test/brief)');
  assert.equal(root.createdAt.toISOString(), '2026-01-05T08:00:00.000Z');
  const reply = byTs.get('1767600200.000300');
  assert.equal(reply.parentId, root.id);
  assert.equal(reply.authorId, null);
  assert.equal(reply.externalAuthorName, 'Bob Outside');
  assert.equal(reply.content, 'Thanks @Alice!');
  assert.equal(byTs.get('1767686500.000200').parentId, root.id, 'a reply in a later day file joins its thread');
  assert.equal(byTs.get('1767686600.000300').parentId, null, 'a reply whose root is outside the export stays top level');
  assert.equal(byTs.get('1767600400.000500').content, '[Slack file not imported: brief.pdf]');
  assert.deepEqual(db.tables.chatReaction.map((reaction) => [reaction.messageId, reaction.userId, reaction.emoji]), [[root.id, 'user-alice', '👍']]);
  assert.equal(db.tables.slackImportRecord.length, 8);
  assert.ok(db.tables.slackImportRecord.every((record) => record.runId === report.run.id && record.organizationId === 'org-a'));
  assert.deepEqual(db.tables.importRun.map((entry) => [entry.source, entry.status, entry.createdCount]), [['SLACK_EXPORT', 'APPLIED', 8]]);
  assert.deepEqual(db.tables.auditEvent.map((event) => [event.action, event.organizationId, event.entityId]), [['migration_import.applied', 'org-a', report.run.id]]);
  // Writes are batched, and the tenant proxy verifies each owner once per batch.
  assert.ok(!db.calls.includes('chatMessage.create') && !db.calls.includes('slackImportRecord.create'));
  assert.equal(db.calls.filter((call) => call === 'chatMessage.createMany').length, 2, 'one batch per channel');
  assert.ok(db.calls.filter((call) => call === 'project.findFirst').length <= 6, 'owner checks are per batch, not per row');

  const rerun = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping, apply: true }));
  assert.equal(rerun.totals.created, 0);
  assert.equal(rerun.totals.unchanged, 8);
  assert.equal(db.tables.chatMessage.length, 9);
  assert.equal(db.tables.slackImportRecord.length, 8);
  assert.equal(db.tables.chatReaction.length, 1);
});

test('messages already delivered by the live Slack integration are not imported twice', async () => {
  const db = createFakeDb();
  db.tables.chatMessage.push({ id: 'live-1', projectId: 'project-a2', externalSource: 'SLACK', externalMessageId: '1767600700.000100', parentId: null, metadata: JSON.stringify({ channelId: 'G01ACME' }) });
  const exportData = await readSlackExport(basicExport);
  const report = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping, apply: true }));
  assert.equal(report.totals.alreadyPresent, 1);
  assert.equal(db.tables.chatMessage.filter((message) => message.projectId === 'project-a2').length, 1);
});

test('a changed source message is a conflict: reported on dry run, refused on apply, never overwritten', async () => {
  const db = createFakeDb();
  const directory = copyExport(basicExport);
  try {
    await run(db, 'org-a', async (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData: await readSlackExport(directory), mapping, apply: true }));
    const dayFile = path.join(directory, 'general', '2026-01-05.json');
    fs.writeFileSync(dayFile, fs.readFileSync(dayFile, 'utf8').replace('Thanks <@U01ALICE>!', 'Thanks again, edited in Slack'));
    const changed = await readSlackExport(directory);

    const dryRun = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData: changed, mapping }));
    assert.equal(dryRun.complete, false);
    assert.equal(dryRun.totals.conflicts, 1);
    assert.deepEqual(dryRun.errors.map((error) => [error.code, error.sourceKey]), [['SOURCE_CHANGED', 'slack-export:C01GENERAL:1767600200.000300']]);

    await assert.rejects(
      run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData: changed, mapping, apply: true })),
      (error) => error instanceof SlackImportBlockedError && /unresolved reconciliation findings/.test(error.message),
    );
    assert.equal(db.tables.chatMessage.find((message) => message.externalMessageId === '1767600200.000300').content, 'Thanks @Alice!');
    assert.equal(db.tables.importRun.length, 1, 'a refused live run records nothing');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rollback removes exactly one run, refuses when outside messages depend on it, and cannot repeat', async () => {
  const db = createFakeDb();
  const exportData = await readSlackExport(basicExport);
  const applied = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping, apply: true }));
  const root = db.tables.chatMessage.find((message) => message.externalMessageId === '1767600000.000100');

  db.tables.chatMessage.push({ id: 'native-reply', projectId: 'project-a', content: 'Ashbi reply', parentId: root.id });
  await assert.rejects(
    run(db, 'org-a', (tenantDb) => rollbackSlackImportRun(tenantDb, { organizationId: 'org-a', runId: applied.run.id })),
    (error) => error.code === 'ROLLBACK_BLOCKED',
  );
  assert.equal(db.tables.slackImportRecord.length, 8);
  db.tables.chatMessage.splice(db.tables.chatMessage.findIndex((message) => message.id === 'native-reply'), 1);

  await assert.rejects(
    run(db, 'org-b', (tenantDb) => rollbackSlackImportRun(tenantDb, { organizationId: 'org-b', runId: applied.run.id })),
    (error) => error.code === 'RUN_NOT_FOUND',
    'another organization cannot roll back this run',
  );

  const report = await run(db, 'org-a', (tenantDb) => rollbackSlackImportRun(tenantDb, { organizationId: 'org-a', runId: applied.run.id }));
  assert.deepEqual(report.deleted, { messages: 8, records: 8 });
  assert.deepEqual(db.tables.chatMessage.map((message) => message.id), ['b-existing']);
  assert.equal(db.tables.chatReaction.length, 0);
  assert.equal(db.tables.slackImportRecord.length, 0);
  assert.equal(db.tables.importRun[0].status, 'ROLLED_BACK');
  assert.ok(db.tables.auditEvent.some((event) => event.action === 'migration_import.rolled_back'));
  await assert.rejects(
    run(db, 'org-a', (tenantDb) => rollbackSlackImportRun(tenantDb, { organizationId: 'org-a', runId: applied.run.id })),
    (error) => error.code === 'ALREADY_ROLLED_BACK',
  );

  const reimported = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping, apply: true }));
  assert.equal(reimported.totals.created, 8, 'a rolled-back export can be imported again');
});

test('an import for organization A never reads or writes organization B', async () => {
  const db = createFakeDb();
  const before = structuredClone(db.tables);
  const exportData = await readSlackExport(basicExport);
  const crossTenant = parseSlackChannelMapping({ general: 'project-b' });

  const dryRun = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping: crossTenant }));
  assert.deepEqual(dryRun.errors.map((error) => [error.code, error.projectId]), [['UNKNOWN_PROJECT', 'project-b']]);
  assert.equal(dryRun.users.unmapped.length, 0, 'org B users are never candidates');
  await assert.rejects(
    run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping: crossTenant, apply: true })),
    SlackImportBlockedError,
  );

  // Even a direct write through the tenant context cannot target org B.
  await assert.rejects(
    run(db, 'org-a', (tenantDb) => tenantDb.chatMessage.create({ data: { projectId: 'project-b', content: 'x', type: 'TEXT' } })),
    /Tenancy Error/,
  );

  await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping, apply: true }));
  assert.deepEqual(db.tables.chatMessage.filter((message) => message.projectId === 'project-b'), before.chatMessage);
  assert.ok(db.tables.slackImportRecord.every((record) => record.organizationId === 'org-a'));
  assert.ok(db.tables.importRun.every((entry) => entry.organizationId === 'org-a'));
});

test('path traversal: unsafe channel names, links and oversize files are refused', async () => {
  for (const unsafe of ['../outside', '/etc/passwd', 'a/../../b', 'a\\..\\b', '']) {
    assert.throws(() => resolveInsideExport('/tmp/export', unsafe), /relative to the export root/);
  }
  assert.equal(resolveInsideExport('/tmp/export', 'general/2026-01-01.json'), '/tmp/export/general/2026-01-01.json');

  const exportData = await readSlackExport(traversalExport);
  assert.deepEqual(exportData.findings.channelFindings.map((finding) => finding.code).sort(), ['INVALID_CHANNEL', 'UNSAFE_CHANNEL_NAME', 'UNSAFE_CHANNEL_NAME']);
  assert.deepEqual(exportData.channels.map((channel) => [channel.name, channel.messages.length]), [['safe', 1]]);
  // Unsafe entries for channels this run does not import are warnings only.
  const unmappedUnsafe = await run(createFakeDb(), 'org-a', (tenantDb) => runSlackExportImport(tenantDb, {
    organizationId: 'org-a', exportData, mapping: parseSlackChannelMapping({ safe: 'project-a' }),
  }));
  assert.equal(unmappedUnsafe.complete, true);
  assert.equal(unmappedUnsafe.warnings.filter((warning) => ['INVALID_CHANNEL', 'UNSAFE_CHANNEL_NAME'].includes(warning.code)).length, 3);
  const appliedSafe = await run(createFakeDb(), 'org-a', (tenantDb) => runSlackExportImport(tenantDb, {
    organizationId: 'org-a', exportData, mapping: parseSlackChannelMapping({ safe: 'project-a' }), apply: true,
  }));
  assert.equal(appliedSafe.totals.created, 1);
  // ...but block when the unsafe channel is mapped.
  const blocked = await run(createFakeDb(), 'org-a', (tenantDb) => runSlackExportImport(tenantDb, {
    organizationId: 'org-a', exportData, mapping: parseSlackChannelMapping({ safe: 'project-a', C01ESCAPE: 'project-a' }),
  }));
  assert.equal(blocked.complete, false, 'a mapped unsafe entry keeps the report incomplete');
  assert.deepEqual(blocked.errors.map((error) => [error.code, error.channelId]), [['UNSAFE_CHANNEL_NAME', 'C01ESCAPE']]);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-slack-outside-'));
  const directory = copyExport(basicExport);
  try {
    fs.writeFileSync(path.join(outside, '2026-01-05.json'), JSON.stringify([{ type: 'message', user: 'U01ALICE', text: 'OUTSIDE SECRET', ts: '1767600000.999999' }]));
    // A channel directory that is a symlink out of the export is never followed.
    fs.rmSync(path.join(directory, 'random'), { recursive: true });
    fs.symlinkSync(outside, path.join(directory, 'random'));
    // A symlinked day file inside a real channel directory is reported, not read.
    fs.symlinkSync(path.join(outside, '2026-01-05.json'), path.join(directory, 'client-acme', '2026-01-09.json'));
    const linked = await readSlackExport(directory);
    assert.ok(linked.findings.channelFindings.some((finding) => finding.code === 'UNSAFE_PATH' && finding.channelId === 'C02RANDOM'));
    assert.ok(!linked.channels.some((channel) => channel.id === 'C02RANDOM'));
    assert.ok(linked.findings.unsupportedFiles.includes('client-acme/2026-01-09.json'));
    assert.doesNotMatch(JSON.stringify(linked.channels), /OUTSIDE SECRET/);

    fs.rmSync(path.join(directory, 'users.json'));
    fs.symlinkSync(path.join(outside, '2026-01-05.json'), path.join(directory, 'users.json'));
    await assert.rejects(readSlackExport(directory), (error) => error.code === 'UNSAFE_PATH');

    fs.rmSync(path.join(directory, 'users.json'));
    fs.writeFileSync(path.join(directory, 'users.json'), '[]');
    fs.truncateSync(path.join(directory, 'users.json'), MAX_EXPORT_JSON_BYTES + 1);
    await assert.rejects(readSlackExport(directory), (error) => error.code === 'FILE_TOO_LARGE');

    const zipPath = path.join(outside, 'export.zip');
    fs.writeFileSync(zipPath, 'PK');
    await assert.rejects(readSlackExport(zipPath), (error) => error.code === 'ZIP_NOT_SUPPORTED');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('Slack import records are tenant scoped and unique per organization source', async () => {
  const [schema, tenantProxy, cli] = await Promise.all([
    fs.promises.readFile(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8'),
    fs.promises.readFile(new URL('../../utils/prisma-tenant-proxy.js', import.meta.url), 'utf8'),
    fs.promises.readFile(new URL('../../../scripts/import-slack-export.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(schema, /model SlackImportRecord \{/);
  assert.match(schema, /@@unique\(\[organizationId, sourceKey\]\)/);
  assert.match(schema, /@@map\("import_runs"\)/);
  assert.match(tenantProxy, /'importrun', 'slackimportrecord'/);
  assert.match(cli, /runTenantJob\(prisma, organizationId/);
  assert.match(cli, /flag: 'wx', mode: 0o600/);
});

test('a root that later gains thread_ts == ts hashes the same, so an overlapping rerun succeeds', async () => {
  const bare = { type: 'message', user: 'U01ALICE', text: 'Root', ts: '1767600000.000100' };
  const [withoutThread] = parseSlackMessages([bare]).messages;
  const [withThread] = parseSlackMessages([{ ...bare, thread_ts: bare.ts, reply_count: 1 }]).messages;
  assert.equal(withThread.threadTs, null);
  assert.equal(withThread.isReply, false);
  assert.equal(withThread.contentSha256, withoutThread.contentSha256);

  const db = createFakeDb();
  const directory = copyExport(basicExport);
  try {
    await run(db, 'org-a', async (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData: await readSlackExport(directory), mapping, apply: true }));
    assert.equal(db.tables.slackImportRecord.find((record) => record.messageTs === '1767600000.000100').threadTs, null);
    const dayFile = path.join(directory, 'general', '2026-01-06.json');
    const messages = JSON.parse(fs.readFileSync(dayFile, 'utf8'));
    messages[0].thread_ts = messages[0].ts; // "Day two" later received a reply
    fs.writeFileSync(dayFile, JSON.stringify(messages));
    const rerun = await run(db, 'org-a', async (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData: await readSlackExport(directory), mapping, apply: true }));
    assert.equal(rerun.totals.conflicts, 0);
    assert.equal(rerun.totals.unchanged, 8);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a message deleted in the Hub is a warning on rerun, is not re-imported, and does not block', async () => {
  const db = createFakeDb();
  const exportData = await readSlackExport(basicExport);
  await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping, apply: true }));
  db.tables.chatMessage.splice(db.tables.chatMessage.findIndex((message) => message.externalMessageId === '1767600700.000100'), 1);
  const rerun = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping, apply: true }));
  assert.equal(rerun.complete, true);
  assert.equal(rerun.totals.created, 0);
  assert.equal(rerun.totals.deletedInHub, 1);
  assert.ok(rerun.warnings.some((warning) => warning.code === 'DELETED_IN_HUB'));
  assert.equal(db.tables.chatMessage.filter((message) => message.projectId === 'project-a2').length, 0);
});

test('a live Slack channel mapping to a different project blocks the import', async () => {
  const db = createFakeDb();
  db.tables.slackChannelMapping.push(
    { id: 'map-1', organizationId: 'org-a', installationId: 'inst-a', channelId: 'C01GENERAL', projectId: 'project-a2' },
    { id: 'map-2', organizationId: 'org-a', installationId: 'inst-a', channelId: 'G01ACME', projectId: 'project-a2' },
  );
  const exportData = await readSlackExport(basicExport);
  const report = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping }));
  assert.deepEqual(report.errors.map((error) => [error.code, error.channelId, error.liveProjectId]), [['LIVE_MAPPING_CONFLICT', 'C01GENERAL', 'project-a2']]);
  await assert.rejects(
    run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping, apply: true })),
    SlackImportBlockedError,
  );
  assert.equal(db.tables.importRun.length, 0);
});

test('dedupe is organization-wide but per channel: same ts in another channel is a different message', async () => {
  const db = createFakeDb();
  db.tables.chatMessage.push(
    // Delivered live from #general into another project of org A: reported, not duplicated.
    { id: 'live-general', projectId: 'project-a2', externalSource: 'SLACK', externalMessageId: '1767686400.000100', parentId: null, metadata: JSON.stringify({ channelId: 'C01GENERAL' }) },
    // Same ts from a different channel in the target project: not a duplicate.
    { id: 'live-other', projectId: 'project-a', externalSource: 'SLACK', externalMessageId: '1767600200.000300', parentId: null, metadata: JSON.stringify({ channelId: 'C99OTHER' }) },
    // Same ts and channel but in org B: never visible to org A.
    { id: 'b-live', projectId: 'project-b', externalSource: 'SLACK', externalMessageId: '1767600000.000100', parentId: null, metadata: JSON.stringify({ channelId: 'C01GENERAL' }) },
  );
  const directory = copyExport(basicExport);
  try {
    // Give #client-acme a message with the same ts as a #general message.
    fs.writeFileSync(path.join(directory, 'client-acme', '2026-01-05.json'), JSON.stringify([
      { type: 'message', user: 'U01ALICE', text: 'Same ts, other channel', ts: '1767600000.000100' },
    ]));
    const exportData = await readSlackExport(directory);
    const sameProject = parseSlackChannelMapping({ general: 'project-a', 'client-acme': 'project-a' });
    const report = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping: sameProject, apply: true }));
    assert.equal(report.totals.created, 7);
    assert.equal(report.totals.alreadyPresentElsewhere, 1);
    assert.ok(report.warnings.some((warning) => warning.code === 'ALREADY_PRESENT_OTHER_PROJECT' && warning.projectId === 'project-a2'));
    const sharedTs = db.tables.chatMessage.filter((message) => message.projectId === 'project-a' && message.externalMessageId === '1767600000.000100');
    assert.equal(sharedTs.length, 2, 'both channels keep their own message');
    assert.ok(db.tables.chatMessage.some((message) => message.projectId === 'project-a' && message.externalMessageId === '1767600200.000300' && message.id !== 'live-other'));
    const rerun = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping: sameProject, apply: true }));
    assert.equal(rerun.totals.created, 0);
    assert.equal(rerun.totals.unchanged, 7);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('author display names are stripped of control and bidi characters and capped', async () => {
  assert.equal(sanitizeDisplayText('Ali‮ce​'), 'Alice');
  assert.equal(sanitizeDisplayText('  Bob\n\t\u0007Outside  '), 'Bob Outside');
  assert.equal(sanitizeDisplayText('x'.repeat(500)).length, 200);
  assert.equal(sanitizeDisplayText('‮\u0000 '), null);

  const db = createFakeDb();
  const directory = copyExport(basicExport);
  try {
    const usersFile = path.join(directory, 'users.json');
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    users[1].profile.real_name = `Bob‮\u0000\n  ${'y'.repeat(300)}`;
    fs.writeFileSync(usersFile, JSON.stringify(users));
    const exportData = await readSlackExport(directory);
    const report = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping, apply: true }));
    const bobName = db.tables.chatMessage.find((message) => message.externalMessageId === '1767600200.000300').externalAuthorName;
    assert.equal(bobName, `Bob ${'y'.repeat(196)}`);
    assert.doesNotMatch(JSON.stringify(report), /‮|\\u0000/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('--channel limits a run to one mapped channel', async () => {
  const db = createFakeDb();
  const exportData = await readSlackExport(basicExport);
  const report = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping, apply: true, channel: 'client-acme' }));
  assert.equal(report.totals.created, 1);
  assert.deepEqual(report.channels.map((channel) => channel.name), ['client-acme']);
  assert.deepEqual(report.notSelectedChannels, ['general']);
  const missing = await run(db, 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping, channel: 'random' }));
  assert.deepEqual(missing.errors.map((error) => error.code), ['CHANNEL_NOT_SELECTABLE']);
});

test('duplicate channel entries are deduped by id and ambiguous names are reported', async () => {
  const directory = copyExport(basicExport);
  try {
    fs.writeFileSync(path.join(directory, 'groups.json'), JSON.stringify([
      { id: 'G01ACME', name: 'client-acme' },
      { id: 'G01ACME', name: 'client-acme' },
      { id: 'G02DUP', name: 'general' },
    ]));
    const exportData = await readSlackExport(directory);
    assert.deepEqual(exportData.channels.map((channel) => channel.id), ['C01GENERAL', 'C02RANDOM', 'G01ACME']);
    assert.ok(exportData.findings.warnings.some((warning) => warning.code === 'DUPLICATE_CHANNEL'));
    assert.deepEqual(exportData.findings.channelFindings.map((finding) => [finding.code, finding.channelId]), [['DUPLICATE_CHANNEL_NAME', 'G02DUP']]);
    const report = await run(createFakeDb(), 'org-a', (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData, mapping }));
    assert.ok(report.errors.some((error) => error.code === 'DUPLICATE_CHANNEL_NAME'), 'a mapped ambiguous name blocks');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('only active organization users are matched as authors', async () => {
  const db = createFakeDb();
  db.tables.user[0].isActive = false;
  const report = await run(db, 'org-a', async (tenantDb) => runSlackExportImport(tenantDb, { organizationId: 'org-a', exportData: await readSlackExport(basicExport), mapping }));
  assert.equal(report.users.mapped, 0);
  assert.deepEqual(report.users.unmapped.map((user) => user.id), ['U01ALICE', 'U02BOB']);
});
