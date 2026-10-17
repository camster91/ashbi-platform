import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestGmailMessage } from '../../services/gmail-ingest.service.js';
import { scanGmailInbox, parseGmailSyncSummary } from '../../services/gmail-sync-scan.js';

const input = { organizationId: 'org-a', mailbox: 'mailbox@example.test', providerMessageId: 'message1', providerThreadId: 'thread1',
  senderEmail: 'person@acme.test', senderName: 'Person', subject: 'Same subject', bodyText: 'Stored body', receivedAt: new Date('2026-10-16'), tags: [] };

function fixture() {
  let state = { receipts: [], threads: [], messages: [], triage: [], clients: [
    { id: 'client-a', organizationId: 'org-a', domain: 'acme.test', deletedAt: null, status: 'ACTIVE', relationshipStatus: 'ACTIVE' },
    { id: 'client-b', organizationId: 'org-b', domain: 'acme.test', deletedAt: null, status: 'ACTIVE', relationshipStatus: 'ACTIVE' },
  ], contacts: [] };
  let failReceipt = false, transactions = 0;
  const equal = (row, where) => Object.entries(where).every(([k, v]) => k === 'status' ? v.in.includes(row.status ?? 'ACTIVE') : k === 'relationshipStatus' ? !v.notIn.includes(row.relationshipStatus ?? 'ACTIVE') : row[k] === v);
  const db = { $transaction: async (fn, options) => {
    transactions++; assert.equal(options.isolationLevel, 'Serializable');
    const draft = structuredClone(state);
    let locked = false;
    const tx = {
      $executeRaw: async strings => {
        const sql = strings.join('');
        if (!locked) { assert.match(sql, /^LOCK TABLE clients, contacts IN SHARE MODE NOWAIT$/); locked = true; }
        else assert.match(sql, /pg_advisory_xact_lock/);
        return 0;
      }, organization: { findUnique: async ({ where }) => ['org-a', 'org-b'].includes(where.id) ? { id: where.id } : null },
      contact: { findMany: async ({ where }) => draft.contacts.filter(c => c.email.toLowerCase() === where.email.equals.toLowerCase()).map(c => ({ ...c, client: draft.clients.find(x => x.id === c.clientId) })).filter(c => c.client.organizationId === where.client.organizationId) },
      client: { findFirst: async ({ where }) => draft.clients.find(c => equal(c, where)) ?? null,
        findMany: async ({ where }) => draft.clients.filter(c => c.organizationId === where.organizationId && !c.deletedAt && c.domain && where.status.in.includes(c.status ?? 'ACTIVE') && !where.relationshipStatus.notIn.includes(c.relationshipStatus ?? 'ACTIVE')) },
      gmailIngestReceipt: { findFirst: async ({ where }) => draft.receipts.find(r => equal(r, where)) ?? null,
        create: async ({ data }) => { if (failReceipt) throw new Error('synthetic commit failure'); const row = { id: `r${draft.receipts.length}`, ...data }; draft.receipts.push(row); return row; } },
      message: { findMany: async ({ where }) => draft.messages.filter(m => draft.threads.some(t => t.id === m.threadId && draft.clients.some(c => c.id === t.clientId && c.organizationId === where.thread.client.organizationId))
          && where.OR.some(or => m.aiExtracted?.includes(or.aiExtracted.contains))).map(m => ({ aiExtracted: m.aiExtracted })),
        create: async ({ data }) => { const row = { id: `m${draft.messages.length}`, ...data }; draft.messages.push(row); return row; } },
      thread: { findFirst: async ({ where }) => draft.threads.find(t => t.id === where.id && t.clientId === where.clientId && draft.clients.some(c => c.id === t.clientId && c.organizationId === where.client.organizationId && !c.deletedAt)) ?? null,
        create: async ({ data }) => { const row = { id: `t${draft.threads.length}`, ...data }; draft.threads.push(row); return row; },
        updateMany: async ({ where, data }) => {
          const rows = draft.threads.filter(t => t.id === where.id && t.lastActivityAt < where.lastActivityAt.lt);
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
        update: async ({ where, data }) => Object.assign(draft.threads.find(t => t.id === where.id), data) },
      emailTriageItem: { create: async ({ data }) => { const row = { id: `triage${draft.triage.length}`, ...data }; draft.triage.push(row); return row; } },
    };
    const result = await fn(tx); state = draft; return result;
  } };
  return { db, state: () => state, transactions: () => transactions, failReceipt: () => { failReceipt = true; } };
}

test('native message identity replays once; case-normalized mailbox, tenant and mailbox boundaries remain distinct', async () => {
  const f = fixture();
  assert.equal((await ingestGmailMessage(f.db, input)).outcome, 'MESSAGE');
  assert.deepEqual(await ingestGmailMessage(f.db, { ...input, mailbox: ' MAILBOX@EXAMPLE.TEST ' }), { replay: true, outcome: 'MESSAGE' });
  await ingestGmailMessage(f.db, { ...input, mailbox: 'other@example.test' });
  await ingestGmailMessage(f.db, { ...input, organizationId: 'org-b' });
  assert.equal(f.state().messages.length, 3); assert.equal(f.state().threads.length, 3);
});

test('thread linking uses native identity, never equal subjects or substring IDs', async () => {
  const f = fixture(); await ingestGmailMessage(f.db, input);
  await ingestGmailMessage(f.db, { ...input, providerMessageId: 'message2' });
  await ingestGmailMessage(f.db, { ...input, providerMessageId: 'message3', providerThreadId: 'thread12' });
  assert.equal(f.state().threads.length, 2); assert.equal(f.state().messages.length, 3);
  assert.equal(f.state().messages[0].threadId, f.state().messages[1].threadId);
  assert.notEqual(f.state().messages[0].threadId, f.state().messages[2].threadId);
});

test('new threads and stored messages use native received time, including descending historical deliveries and replay', async () => {
  const f = fixture();
  const newest = new Date('2020-06-03T12:34:56.789Z');
  await ingestGmailMessage(f.db, { ...input, receivedAt: newest });
  assert.deepEqual(f.state().threads[0].lastActivityAt, newest);
  assert.deepEqual(f.state().messages[0].receivedAt, newest);
  for (const [index, receivedAt] of ['2020-06-02', '2020-06-01'].entries()) {
    await ingestGmailMessage(f.db, { ...input, providerMessageId: `historical${index}`, receivedAt });
    assert.deepEqual(f.state().threads[0].lastActivityAt, newest);
    assert.deepEqual(f.state().messages.at(-1).receivedAt, new Date(receivedAt));
  }
  const before = structuredClone(f.state());
  assert.deepEqual(await ingestGmailMessage(f.db, { ...input, receivedAt: new Date('2030-01-01'), tags: ['urgent'] }), { replay: true, outcome: 'MESSAGE' });
  assert.deepEqual(f.state(), before, 'replay cannot change activity, priority, messages or receipts');
});

test('older, equal and newer native activity preserve thread workflow; older urgency remains independent', async () => {
  const f = fixture(); await ingestGmailMessage(f.db, input);
  const workflow = { status: 'SNOOZED', assignedToId: 'staff', snoozedUntil: new Date('2026-11-01'),
    slaDeadline: new Date('2026-10-20'), slaBreached: true, lastEscalationLevel: 2,
    lastEscalatedAt: new Date('2026-10-15'), inboundPipelineStage: 'COMPLETED' };
  Object.assign(f.state().threads[0], workflow);
  for (const [id, receivedAt, tags, expected] of [
    ['older', '2026-10-14', ['urgent'], input.receivedAt],
    ['equal', '2026-10-16', [], input.receivedAt],
    ['newer', '2026-10-18', [], new Date('2026-10-18')],
  ]) {
    await ingestGmailMessage(f.db, { ...input, providerMessageId: id, receivedAt, tags });
    const thread = f.state().threads[0];
    assert.deepEqual(thread.lastActivityAt, expected);
    assert.equal(thread.priority, 'HIGH', 'ordinary subsequent mail does not downgrade urgent priority');
    for (const [key, value] of Object.entries(workflow)) assert.deepEqual(thread[key], value, key);
  }
  f.state().threads[0].priority = 'LOW'; // A later manual priority choice must also survive rollback.
  const before = structuredClone(f.state()); f.failReceipt();
  await assert.rejects(ingestGmailMessage(f.db, { ...input, providerMessageId: 'failed-newer', receivedAt: '2026-10-19', tags: ['urgent'] }), /synthetic/);
  assert.deepEqual(f.state(), before, 'receipt failure rolls back existing activity, priority and message changes');
});

test('ineligible exact contacts cannot fall through into another active client domain on new or existing threads', async () => {
  for (const lifecycle of [{ status: 'PAUSED' }, { status: 'CHURNED' }, { relationshipStatus: 'ARCHIVED' }, { relationshipStatus: 'CHURNED' }, { deletedAt: new Date() }]) {
    for (const prior of [false, true]) {
      const f = fixture();
      if (prior) await ingestGmailMessage(f.db, input);
      f.state().clients.push({ id: 'historical', organizationId: 'org-a', domain: 'different.test', deletedAt: null, status: 'ACTIVE', relationshipStatus: 'ACTIVE', ...lifecycle });
      f.state().contacts.push({ id: 'historical-contact', clientId: 'historical', email: input.senderEmail });
      const result = await ingestGmailMessage(f.db, { ...input, providerMessageId: prior ? 'next-native-message' : input.providerMessageId });
      assert.equal(result.outcome, prior ? 'HELD_MAPPING_CHANGE' : 'TRIAGE');
      assert.equal(f.state().messages.length, prior ? 1 : 0);
      assert.equal(f.state().threads.length, prior ? 1 : 0);
      assert.equal(f.state().receipts.length, prior ? 2 : 1);
    }
  }
});

test('exact legacy ID overlap is held durably without adoption, duplication or legacy mutation', async () => {
  const f = fixture();
  f.state().threads.push({ id: 'legacy', clientId: 'client-a' });
  f.state().messages.push({ id: 'old', threadId: 'legacy', aiExtracted: JSON.stringify({ source: 'gmail-sync', gmailMessageId: 'message1', gmailThreadId: 'thread1' }) });
  const before = structuredClone(f.state().messages);
  assert.equal((await ingestGmailMessage(f.db, input)).outcome, 'HELD_LEGACY_OVERLAP');
  assert.deepEqual(await ingestGmailMessage(f.db, input), { replay: true, outcome: 'HELD_LEGACY_OVERLAP' });
  assert.deepEqual(f.state().messages, before); assert.equal(f.state().receipts.length, 1);
});

test('legacy substring and invalid JSON do not prove exact overlap', async () => {
  const f = fixture(); f.state().threads.push({ id: 'legacy', clientId: 'client-a' });
  f.state().messages.push({ id: 'old', threadId: 'legacy', aiExtracted: JSON.stringify({ source: 'gmail-sync', gmailMessageId: 'message12', gmailThreadId: 'thread12' }) });
  f.state().messages.push({ id: 'bad', threadId: 'legacy', aiExtracted: '{message1' });
  assert.equal((await ingestGmailMessage(f.db, input)).outcome, 'MESSAGE');
});

test('ambiguous contacts and unmatched/Upwork messages each create one triage item, with no client guess', async () => {
  const f = fixture(); f.state().clients.push({ id: 'client-other', organizationId: 'org-a', domain: 'other.test', deletedAt: null });
  f.state().contacts.push({ email: input.senderEmail, clientId: 'client-a' }, { email: input.senderEmail, clientId: 'client-other' });
  assert.equal((await ingestGmailMessage(f.db, input)).outcome, 'TRIAGE');
  await ingestGmailMessage(f.db, input);
  assert.equal(f.state().triage.length, 1); assert.match(f.state().triage[0].tags, /ambiguous-client/);
  await ingestGmailMessage(f.db, { ...input, providerMessageId: 'unmatched', senderEmail: 'x@gmail.com' });
  await ingestGmailMessage(f.db, { ...input, providerMessageId: 'upwork', upwork: true });
  assert.equal(f.state().triage.length, 3); assert.equal(f.state().messages.length, 0);
});

test('native thread mapping changes and archived clients are held, never split into a different client', async () => {
  for (const change of ['remap', 'archive', 'PAUSED', 'CHURNED', 'relationship-ARCHIVED', 'relationship-CHURNED']) {
    const f = fixture(); await ingestGmailMessage(f.db, input);
    if (change === 'archive') f.state().clients[0].deletedAt = new Date();
    else if (change.startsWith('relationship-')) f.state().clients[0].relationshipStatus = change.slice('relationship-'.length);
    else if (['PAUSED', 'CHURNED'].includes(change)) f.state().clients[0].status = change;
    else { f.state().clients.push({ id: 'new', organizationId: 'org-a', domain: 'new.test', deletedAt: null }); f.state().contacts.push({ email: input.senderEmail, clientId: 'new' }); }
    assert.equal((await ingestGmailMessage(f.db, { ...input, providerMessageId: 'newmessage' })).outcome, 'HELD_MAPPING_CHANGE');
    assert.equal(f.state().messages.length, 1); assert.equal(f.state().triage.length, 0);
  }
});

test('deleted target remains a replay tombstone; failure rolls back receipt, message and thread together', async () => {
  const f = fixture(); await ingestGmailMessage(f.db, input); f.state().threads.length = 0; f.state().messages.length = 0;
  assert.equal((await ingestGmailMessage(f.db, input)).replay, true); assert.equal(f.state().threads.length, 0);
  const broken = fixture(); broken.failReceipt(); await assert.rejects(ingestGmailMessage(broken.db, input), /synthetic/);
  assert.deepEqual([broken.state().receipts.length, broken.state().messages.length, broken.state().threads.length], [0, 0, 0]);
});

test('invalid mailbox fails before transaction; serialization failures are surfaced without retry', async () => {
  const f = fixture(); await assert.rejects(ingestGmailMessage(f.db, { ...input, mailbox: '' })); assert.equal(f.transactions(), 0);
  let attempts = 0; const db = { $transaction: async () => { attempts++; throw Object.assign(new Error('serialization'), { code: 'P2034' }); } };
  await assert.rejects(ingestGmailMessage(db, input), { code: 'P2034' }); assert.equal(attempts, 1);
});

test('bounded scan follows pages with one frozen query, deduplicates native IDs, and states partial errors and holds', async () => {
  const requests = []; const seen = [];
  const result = await scanGmailInbox({ query: 'in:inbox after:123', fetchPage: async args => {
    requests.push(args); return args.pageToken ? { messages: [{ id: 'one' }, { id: 'two' }, { id: 'three' }] } : { messages: [{ id: 'one' }], nextPageToken: 'next' };
  }, processMessage: async id => { seen.push(id); if (id === 'two') throw Error('private'); return { outcome: id === 'three' ? 'HELD_LEGACY_OVERLAP' : 'MESSAGE' }; } });
  assert.equal(requests.length, 2); assert.ok(requests.every(x => x.query === 'in:inbox after:123' && x.maxResults === 200));
  assert.deepEqual(seen, ['one', 'two', 'three']); assert.equal(result.partial, true); assert.equal(result.errors, 1); assert.equal(result.held, 1);
});

test('five-page cap and cyclic tokens remain partial; exhausted empty INBOX window is the only empty success', async () => {
  const capped = await scanGmailInbox({ query: 'fixed', fetchPage: async ({ pageToken }) => ({ messages: [], nextPageToken: `${pageToken ?? ''}x` }), processMessage: async () => {} });
  assert.equal(capped.pages, 5); assert.equal(capped.partial, true);
  const cycle = await scanGmailInbox({ query: 'fixed', fetchPage: async () => ({ nextPageToken: 'same' }), processMessage: async () => {} });
  assert.equal(cycle.pages, 2); assert.equal(cycle.partial, true);
  assert.equal((await scanGmailInbox({ query: 'fixed', fetchPage: async () => ({}), processMessage: async () => {} })).partial, false);
});

test('sync status parser rejects arbitrary child output, unknown fields and provider text', () => {
  const good = { version: 1, scope: 'INBOX_WINDOW', lookbackHours: 48, pages: 1, listed: 0, stored: 0, replayed: 0, skipped: 0, held: 0, errors: 0, partial: false };
  assert.deepEqual(parseGmailSyncSummary(`private preceding text\nGMAIL_SYNC_SUMMARY ${JSON.stringify(good)}`), good);
  for (const value of ['private subject', `GMAIL_SYNC_SUMMARY ${JSON.stringify({ ...good, output: 'secret' })}`, `GMAIL_SYNC_SUMMARY ${JSON.stringify({ ...good, pages: 6 })}`]) assert.equal(parseGmailSyncSummary(value), null);
});
