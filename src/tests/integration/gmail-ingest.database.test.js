import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ingestGmailMessage } from '../../services/gmail-ingest.service.js';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('Gmail ingestion native identity is atomic under real PostgreSQL concurrent scans, failures and raw target attacks', {
  skip: !url && 'Disposable PostgreSQL is not configured', timeout: 60000,
}, async () => {
  assertDisposableDatabase({ NODE_ENV: process.env.NODE_ENV, DATABASE_URL: url });
  const db = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = [randomUUID(), randomUUID()];
  try {
    for (const id of orgs) await db.organization.create({ data: { id, name: 'Synthetic Gmail ingestion', slug: id } });
    const clients = [];
    for (const organizationId of orgs) clients.push(await db.client.create({ data: { organizationId, name: 'Ingest fixture', domain: `ingest-${randomUUID()}.test` } }));
    const input = { organizationId: orgs[0], mailbox: 'mailbox@example.invalid', providerMessageId: 'native1', providerThreadId: 'native-thread1',
      senderEmail: `client@${clients[0].domain}`, senderName: null, subject: 'Fixture', bodyText: 'Synthetic local message only', receivedAt: new Date(), tags: [] };
    const raced = await Promise.allSettled([ingestGmailMessage(db, input), ingestGmailMessage(db, input)]);
    assert.ok(raced.some(r => r.status === 'fulfilled'));
    for (const result of raced) if (result.status === 'rejected') assert.ok(['P2034', 'P2002'].includes(result.reason.code), 'Serializable or receipt uniqueness contention is surfaced, never silently retried');
    assert.equal((await ingestGmailMessage(db, input)).replay, true);
    assert.equal(await db.gmailIngestReceipt.count({ where: { organizationId: orgs[0] } }), 1);
    assert.equal(await db.message.count({ where: { thread: { clientId: clients[0].id } } }), 1);
    assert.equal(await db.thread.count({ where: { clientId: clients[0].id } }), 1);
    await ingestGmailMessage(db, { ...input, mailbox: 'second@example.invalid' });
    await ingestGmailMessage(db, { ...input, organizationId: orgs[1], senderEmail: `client@${clients[1].domain}` });
    assert.equal(await db.gmailIngestReceipt.count({ where: { providerMessageId: 'native1', organizationId: { in: orgs } } }), 3);
    const receipt = await db.gmailIngestReceipt.findFirstOrThrow({ where: { organizationId: orgs[0], mailbox: input.mailbox } });
    for (const lifecycle of [{ status: 'PAUSED' }, { status: 'CHURNED' }, { relationshipStatus: 'ARCHIVED' }, { relationshipStatus: 'CHURNED' }]) {
      await db.client.update({ where: { id: clients[0].id }, data: lifecycle });
      await assert.rejects(db.gmailIngestReceipt.create({ data: { organizationId: orgs[0], mailbox: input.mailbox,
        providerMessageId: randomUUID(), providerThreadId: 'inactive-target', outcome: 'MESSAGE', clientId: clients[0].id, threadId: receipt.threadId, messageId: receipt.messageId } }));
      await db.client.update({ where: { id: clients[0].id }, data: { status: 'ACTIVE', relationshipStatus: 'ACTIVE' } });
    }
    await assert.rejects(db.gmailIngestReceipt.update({ where: { id: receipt.id }, data: { mailbox: 'changed@example.invalid' } }));
    await assert.rejects(db.gmailIngestReceipt.delete({ where: { id: receipt.id } }));
    await assert.rejects(db.gmailIngestReceipt.create({ data: { organizationId: orgs[1], mailbox: input.mailbox,
      providerMessageId: 'foreign', providerThreadId: 'foreign', outcome: 'MESSAGE', clientId: clients[0].id, threadId: receipt.threadId, messageId: receipt.messageId } }));
    await assert.rejects(db.gmailIngestReceipt.create({ data: { organizationId: orgs[0], mailbox: input.mailbox,
      providerMessageId: 'invalid', providerThreadId: 'invalid', outcome: 'TRIAGE', triageItemId: 'missing' } }));
    // Inject a local failure AFTER actual message/thread writes, inside the real
    // transaction. No external provider call is involved or retried.
    const broken = new Proxy(db, { get(target, key) {
      if (key === '$transaction') return (fn, options) => target.$transaction(tx => fn(new Proxy(tx, { get(t, k) {
        if (k === 'gmailIngestReceipt') return new Proxy(t[k], { get(d, method) {
          if (method === 'create') return () => { throw Error('Synthetic receipt failure'); };
          const value = d[method]; return typeof value === 'function' ? value.bind(d) : value;
        } });
        const value = t[k]; return typeof value === 'function' ? value.bind(t) : value;
      } })), options);
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const before = await db.message.count({ where: { thread: { clientId: clients[0].id } } });
    await assert.rejects(ingestGmailMessage(broken, { ...input, providerMessageId: 'rollback', providerThreadId: 'rollback-thread' }), /Synthetic/);
    assert.equal(await db.message.count({ where: { thread: { clientId: clients[0].id } } }), before);
    assert.equal(await db.gmailIngestReceipt.count({ where: { organizationId: orgs[0], providerMessageId: 'rollback' } }), 0);
    assert.equal(await db.thread.count({ where: { clientId: clients[0].id, messages: { none: {} } } }), 0);
    const activityBeforeFailure = await db.thread.findUniqueOrThrow({ where: { id: receipt.threadId } });
    await assert.rejects(ingestGmailMessage(broken, { ...input, providerMessageId: 'rollback-existing', receivedAt: new Date('2099-01-01'), tags: ['urgent'] }), /Synthetic/);
    assert.deepEqual(await db.thread.findUniqueOrThrow({ where: { id: receipt.threadId } }), activityBeforeFailure);
    assert.equal(await db.message.count({ where: { thread: { clientId: clients[0].id } } }), before);
    assert.equal(await db.gmailIngestReceipt.count({ where: { organizationId: orgs[0], providerMessageId: 'rollback-existing' } }), 0);
    // Exact legacy overlap is retained without adding another message.
    const legacy = await db.thread.create({ data: { clientId: clients[0].id, subject: 'Old synthetic email' } });
    await db.message.create({ data: { threadId: legacy.id, direction: 'INBOUND', senderEmail: input.senderEmail, bodyText: 'Old synthetic body',
      aiExtracted: JSON.stringify({ source: 'gmail-sync', gmailMessageId: 'legacy-id', gmailThreadId: 'legacy-thread' }) } });
    assert.equal((await ingestGmailMessage(db, { ...input, providerMessageId: 'legacy-id', providerThreadId: 'legacy-thread' })).outcome, 'HELD_LEGACY_OVERLAP');
    assert.equal(await db.message.count({ where: { threadId: legacy.id } }), 1);
    // Receipt survives message deletion and continues to fence replay.
    await db.message.delete({ where: { id: receipt.messageId } });
    assert.equal((await ingestGmailMessage(db, input)).replay, true);
    assert.equal(await db.message.count({ where: { id: receipt.messageId } }), 0);
  } finally {
    try {
      await db.message.deleteMany({ where: { thread: { client: { organizationId: { in: orgs } } } } });
      await db.thread.deleteMany({ where: { client: { organizationId: { in: orgs } } } });
      await db.client.deleteMany({ where: { organizationId: { in: orgs } } });
      await db.organization.deleteMany({ where: { id: { in: orgs } } });
    }
    finally { await db.$disconnect(); }
  }
});


const barrier = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function observeLock(db, { beforeLock, afterLock } = {}) {
  return new Proxy(db, { get(target, key) {
    if (key === '$transaction') return (fn, options) => target.$transaction(tx => fn(new Proxy(tx, { get(t, k) {
      if (k === '$executeRaw') return async (...args) => {
        const matchingLock = args[0].join('').startsWith('LOCK TABLE');
        if (matchingLock) await beforeLock?.();
        const result = await t.$executeRaw(...args);
        if (matchingLock) await afterLock?.();
        return result;
      };
      const value = t[k]; return typeof value === 'function' ? value.bind(t) : value;
    } })), options);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
}
async function waitUntil(query, description) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { if (await query()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail(description);
}

test('concurrent native activity remains the maximum committed received time, with serialization failures surfaced once', {
  skip: !url && 'Disposable PostgreSQL is not configured', timeout: 60000,
}, async () => {
  assertDisposableDatabase({ NODE_ENV: process.env.NODE_ENV, DATABASE_URL: url });
  const db = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const organizationId = randomUUID();
  const holder = new pg.Client({ connectionString: url });
  let pending;
  try {
    await holder.connect();
    await db.organization.create({ data: { id: organizationId, name: 'Synthetic native activity', slug: organizationId } });
    const client = await db.client.create({ data: { organizationId, name: 'Activity fixture', domain: `activity-${randomUUID()}.test` } });
    const input = { organizationId, mailbox: 'mailbox@example.invalid', providerMessageId: 'activity-seed', providerThreadId: 'activity-thread',
      senderEmail: `person@${client.domain}`, senderName: null, subject: 'Activity fixture', bodyText: 'Synthetic fixture only', receivedAt: new Date('2020-01-01'), tags: [] };
    await ingestGmailMessage(db, input);
    const thread = await db.thread.findFirstOrThrow({ where: { clientId: client.id } });
    assert.deepEqual(thread.lastActivityAt, input.receivedAt, 'creation uses native activity rather than ingestion time');
    const workflow = { status: 'RESOLVED', slaBreached: true, lastEscalationLevel: 2, lastEscalatedAt: new Date('2019-12-31') };
    await db.thread.update({ where: { id: thread.id }, data: workflow });
    const nativeKey = createHash('sha256').update(JSON.stringify([organizationId, input.mailbox, input.providerThreadId])).digest('hex');
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [nativeKey]);
    let attempts = 0;
    const counted = new Proxy(db, { get(target, key) {
      if (key === '$transaction') return (...args) => { attempts++; return target.$transaction(...args); };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const deliveries = ['2020-01-03', '2020-01-02', '2020-01-04'].map((date, index) => ({ ...input, providerMessageId: `activity-race-${index}`, receivedAt: new Date(date) }));
    pending = Promise.allSettled(deliveries.map(delivery => ingestGmailMessage(counted, delivery)));
    // All three snapshots wait on this fixture's exact held advisory lock.
    // Releasing it exercises overlapping Serializable writers, without sleeps
    // in the ingestion path or automatic transaction retries.
    await waitUntil(async () => Number((await holder.query(`SELECT count(*) FROM pg_locks waiting JOIN pg_locks held
      ON waiting.locktype=held.locktype AND waiting.database=held.database AND waiting.classid=held.classid
      AND waiting.objid=held.objid AND waiting.objsubid=held.objsubid
      WHERE held.pid=$1 AND held.locktype='advisory' AND held.granted AND NOT waiting.granted`, [holder.processID])).rows[0].count) === 3,
    'all activity writers must reach the same native advisory lock');
    await holder.query('COMMIT');
    const results = await pending;
    assert.equal(attempts, deliveries.length, 'each ingestion invokes its transaction once');
    assert.ok(results.some(result => result.status === 'fulfilled'));
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') assert.equal(result.reason.code, 'P2034');
      assert.equal(await db.gmailIngestReceipt.count({ where: { organizationId, providerMessageId: deliveries[index].providerMessageId } }), result.status === 'fulfilled' ? 1 : 0);
      assert.equal(await db.message.count({ where: { threadId: thread.id,
        aiExtracted: { contains: `"gmailMessageId":"${deliveries[index].providerMessageId}"` } } }), result.status === 'fulfilled' ? 1 : 0);
    }
    const committedTimes = [input.receivedAt, ...deliveries.filter((_, index) => results[index].status === 'fulfilled').map(delivery => delivery.receivedAt)];
    const expected = new Date(Math.max(...committedTimes.map(date => date.getTime())));
    assert.equal(await db.message.count({ where: { threadId: thread.id } }), committedTimes.length);
    const racedThread = await db.thread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.deepEqual(racedThread.lastActivityAt, expected); assert.equal(racedThread.priority, 'NORMAL');
    await ingestGmailMessage(db, { ...input, providerMessageId: 'activity-older-urgent', receivedAt: new Date('2019-01-01'), tags: ['urgent'] });
    await ingestGmailMessage(db, { ...input, providerMessageId: 'activity-equal', receivedAt: expected });
    const after = await db.thread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.deepEqual(after.lastActivityAt, expected); assert.equal(after.priority, 'HIGH');
    for (const [key, value] of Object.entries(workflow)) assert.deepEqual(after[key], value, key);
    assert.deepEqual(await ingestGmailMessage(db, { ...input, receivedAt: new Date('2099-01-01'), tags: ['urgent'] }), { replay: true, outcome: 'MESSAGE' });
    assert.deepEqual(await db.thread.findUniqueOrThrow({ where: { id: thread.id } }), after);
  } finally {
    await holder.query('ROLLBACK').catch(() => {});
    if (pending) await pending;
    await holder.end();
    try {
      await db.message.deleteMany({ where: { thread: { client: { organizationId } } } });
      await db.thread.deleteMany({ where: { client: { organizationId } } });
      await db.client.deleteMany({ where: { organizationId } });
      await db.organization.deleteMany({ where: { id: organizationId } });
    } finally { await db.$disconnect(); }
  }
});

test('mapping table barriers precede the Serializable snapshot and fence client edits plus new ambiguous contact phantoms', {
  skip: !url && 'Disposable PostgreSQL is not configured', timeout: 60000,
}, async () => {
  assertDisposableDatabase({ NODE_ENV: process.env.NODE_ENV, DATABASE_URL: url });
  const db = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const organizationId = randomUUID();
  const holder = new pg.Client({ connectionString: url }), writer = new pg.Client({ connectionString: url }), observer = new pg.Client({ connectionString: url });
  try {
    await Promise.all([holder.connect(), writer.connect(), observer.connect()]);
    await writer.query("SET statement_timeout='8s'");
    await db.organization.create({ data: { id: organizationId, name: 'Synthetic mapping races', slug: organizationId } });
    const first = await db.client.create({ data: { organizationId, name: 'Original fixture', domain: `mapping-${randomUUID()}.test` } });
    const second = await db.client.create({ data: { organizationId, name: 'Other fixture' } });
    const input = { organizationId, mailbox: 'mailbox@example.invalid', providerMessageId: 'base', providerThreadId: 'base-thread',
      senderEmail: `person@${first.domain}`, senderName: null, subject: 'Mapping race fixture', bodyText: 'Synthetic fixture only', receivedAt: new Date(), tags: [] };
    await db.contact.create({ data: { name: 'Original contact', email: input.senderEmail, clientId: first.id } });
    await ingestGmailMessage(db, input);

    // Transaction already began, but NO snapshot-taking statement ran. A writer
    // that commits before the SHARE barrier must be visible to fresh matching.
    const entered = barrier(), proceed = barrier();
    const paused = ingestGmailMessage(observeLock(db, { beforeLock: async () => { entered.resolve(); await proceed.promise; } }), { ...input, providerMessageId: 'paused-before-lock' });
    await entered.promise;
    await db.client.update({ where: { id: first.id }, data: { status: 'PAUSED' } });
    proceed.resolve();
    assert.equal((await paused).outcome, 'HELD_MAPPING_CHANGE');
    await db.client.update({ where: { id: first.id }, data: { status: 'ACTIVE' } });

    // An ordinary writer already holding RowExclusive makes NOWAIT abort the
    // ingestion immediately, with no receipt or stale canonical message.
    await writer.query('BEGIN');
    await writer.query("UPDATE clients SET status='CHURNED' WHERE id=$1", [first.id]);
    await assert.rejects(ingestGmailMessage(db, { ...input, providerMessageId: 'busy-writer' }), error => error.code === 'P2010' && (error.meta?.driverAdapterError?.cause?.originalCode ?? error.meta?.code) === '55P03');
    assert.equal(await db.gmailIngestReceipt.count({ where: { organizationId, providerMessageId: 'busy-writer' } }), 0);
    await writer.query('COMMIT');
    assert.equal((await ingestGmailMessage(db, { ...input, providerMessageId: 'busy-writer' })).outcome, 'HELD_MAPPING_CHANGE');
    await db.client.update({ where: { id: first.id }, data: { status: 'ACTIVE' } });

    // Hold the native lock externally. Ingestion obtains SHARE BEFORE waiting
    // on that SELECT; a newly ambiguous contact insertion cannot commit while
    // ingestion waits, nor slip between its authority check and commit.
    const waiting = { ...input, providerMessageId: 'wait-native', providerThreadId: 'wait-native-thread' };
    const nativeKey = createHash('sha256').update(JSON.stringify([organizationId, input.mailbox, waiting.providerThreadId])).digest('hex');
    await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [nativeKey]);
    const protectedRead = barrier();
    const pending = ingestGmailMessage(observeLock(db, { afterLock: () => protectedRead.resolve() }), waiting);
    await protectedRead.promise;
    await waitUntil(async () => (await observer.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rowCount > 0, 'ingestion must be waiting for the held native lock');
    const inserted = writer.query('INSERT INTO contacts(id,name,email,"clientId","isPrimary","createdAt","updatedAt") VALUES($1,$2,$3,$4,false,NOW(),NOW())', [randomUUID(), 'Ambiguous new contact', input.senderEmail, second.id]);
    await waitUntil(async () => (await observer.query("SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='contacts'::regclass AND mode='RowExclusiveLock' AND NOT granted", [writer.processID])).rowCount > 0, 'new ambiguous contact writer must wait on the ingestion SHARE barrier');
    await holder.query('COMMIT');
    assert.equal((await pending).outcome, 'MESSAGE');
    await inserted;
    // A later native message observes the committed ambiguity: existing native
    // mapping is held; an unrelated native thread is stored only in triage.
    assert.equal((await ingestGmailMessage(db, { ...waiting, providerMessageId: 'after-ambiguity' })).outcome, 'HELD_MAPPING_CHANGE');
    assert.equal((await ingestGmailMessage(db, { ...input, providerMessageId: 'new-ambiguous', providerThreadId: 'new-ambiguous-thread' })).outcome, 'TRIAGE');
    assert.equal(await db.message.count({ where: { thread: { clientId: second.id } } }), 0);
  } finally {
    await Promise.allSettled([holder.query('ROLLBACK'), writer.query('ROLLBACK')]);
    await Promise.allSettled([holder.end(), writer.end(), observer.end()]);
    try {
      await db.message.deleteMany({ where: { thread: { client: { organizationId } } } });
      await db.thread.deleteMany({ where: { client: { organizationId } } });
      await db.client.deleteMany({ where: { organizationId } });
      await db.organization.deleteMany({ where: { id: organizationId } });
    } finally { await db.$disconnect(); }
  }
});
