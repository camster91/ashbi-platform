import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sendGmailWithReceipt, readGmailSendReceipt, reconcileGmailSendReceipt } from '../../services/gmail-send.service.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

const user = { id: 'staff', organizationId: 'org', name: 'Sender', role: 'ADMIN', isActive: true };
function matches(row, where = {}) {
  if (!row) return false;
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    if (key === 'AND') return (Array.isArray(expected) ? expected : [expected]).every(value => matches(row, value));
    if (key === 'OR') return expected.some(value => matches(row, value));
    if (expected instanceof Date) return +row[key] === +expected;
    if (expected && typeof expected === 'object') return matches(row[key], expected);
    return row[key] === expected || (expected === null && row[key] == null);
  });
}
function fixture() {
  const client = { id: 'client', organizationId: 'org', deletedAt: null };
  const thread = { id: 'thread', clientId: client.id, client, projectId: null, project: null, assignedToId: user.id, status: 'OPEN' };
  let state = { user: [{ ...user }], client: [client], thread: [thread], response: [{ id: 'response', threadId: thread.id, thread, status: 'APPROVED', subject: 'Exact subject', body: 'Exact approved body' }], message: [], gmailSendReceipt: [], auditEvent: [] };
  const flags = { mailbox: 'SENDER@EXAMPLE.TEST', failMessage: false, failAudit: null, send: null };
  const writes = []; let sends = 0, prepares = 0;
  function clone(row) { return row ? structuredClone(row) : null; }
  const db = Object.fromEntries(Object.keys(state).map(model => [model, {
    async findFirst(args) { return clone(state[model].find(row => matches(row, args.where))); },
    async findMany(args) { return clone(state[model].filter(row => matches(row, args.where))); },
    async create({ data }) {
      writes.push([model, 'create', clone(data)]);
      if (model === 'auditEvent' && flags.failAudit === data.action) throw Error('private audit password');
      if (model === 'message' && flags.failMessage) throw Error('private database connection');
      if (model === 'gmailSendReceipt' && state[model].some(row => row.organizationId === data.organizationId && (row.userId === data.userId && row.idempotencyKey === data.idempotencyKey || data.snapshot.responseId && row.snapshot.responseId === data.snapshot.responseId && row.status !== 'REJECTED'))) throw Object.assign(Error('private unique constraint'), { code: 'P2002' });
      const row = { id: `${model}-${state[model].length}`, createdAt: new Date(), updatedAt: new Date(), ...clone(data) };
      state[model].push(row); return clone(row);
    },
    async updateMany({ where, data }) {
      writes.push([model, 'updateMany', clone(data)]);
      const rows = state[model].filter(row => matches(row, where));
      for (const row of rows) Object.assign(row, clone(data), { updatedAt: new Date() });
      return { count: rows.length };
    },
  }]));
  let tail = Promise.resolve();
  db.$transaction = fn => {
    const turn = tail.then(async () => { const before = structuredClone(state); try { return await fn(db); } catch (error) { state = before; throw error; } });
    tail = turn.catch(() => {}); return turn;
  };
  const prepare = async () => { prepares++; return { mailbox: flags.mailbox, send: async snapshot => {
    sends++;
    assert.equal(state.gmailSendReceipt.length, 1);
    assert.equal(state.gmailSendReceipt[0].status, 'DISPATCHING');
    assert.equal(state.auditEvent[0].action, 'gmail_send.claimed');
    return flags.send ? flags.send(snapshot) : { id: 'gmail-message', threadId: 'gmail-thread' };
  } }; };
  const input = { to: 'client@example.test', subject: 'Exact subject', body: 'Exact approved body', hubThreadId: 'thread', responseId: 'response', idempotencyKey: randomUUID() };
  return { db, input, prepare, flags, writes, state: () => state, sends: () => sends, prepares: () => prepares };
}
const send = f => sendGmailWithReceipt(f.db, user, f.input, { prepare: f.prepare });

test('receipt absence is distinct from losing access to an existing claimed send', async () => {
  const f = fixture();
  await assert.rejects(readGmailSendReceipt(f.db, user, f.input.idempotencyKey), { code: 'GMAIL_SEND_NOT_FOUND', statusCode: 404 });
  await send(f);
  f.state().user[0].role = 'TEAM';
  f.state().thread[0].assignedToId = null;
  await assert.rejects(readGmailSendReceipt(f.db, user, f.input.idempotencyKey), { code: 'RECORD_NOT_FOUND', statusCode: 404 });
  assert.equal(f.sends(), 1);
  assert.equal(f.state().gmailSendReceipt.length, 1);
});

test('claim commits before sending; accepted projection, response, thread and audit complete atomically', async () => {
  const f = fixture(); const result = await send(f);
  assert.equal(result.statusCode, 200); assert.equal(result.body.success, true); assert.equal(result.body.status, 'COMPLETED');
  assert.equal(f.sends(), 1); assert.equal(f.state().message.length, 1);
  assert.equal(f.state().message[0].senderEmail, 'sender@example.test'); assert.equal(f.state().message[0].senderName, 'Sender');
  assert.equal(f.state().message[0].bodyText, f.input.body);
  assert.equal(f.state().thread[0].status, 'AWAITING_RESPONSE'); assert.equal(f.state().response[0].status, 'SENT');
  assert.deepEqual(f.state().auditEvent.map(row => row.action), ['gmail_send.claimed', 'gmail_send.accepted', 'gmail_send.completed']);
  assert.doesNotMatch(JSON.stringify(f.state().auditEvent), /Exact approved body|client@example|sender@example|snapshot|tokens/);
  assert.doesNotMatch(JSON.stringify(result), /Exact approved body|client@example|snapshot|payloadHash/);
});
test('successful retry and read preserve original result despite saved response now SENT', async () => {
  const f = fixture(); const original = await send(f); const replay = await send(f);
  assert.deepEqual(replay, original); assert.equal(f.sends(), 1); assert.equal(f.state().message.length, 1);
  const before = f.writes.length;
  assert.equal((await readGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: f.prepare })).body.status, 'COMPLETED');
  assert.equal(f.writes.length, before);
  await assert.rejects(sendGmailWithReceipt(f.db, user, { ...f.input, idempotencyKey: randomUUID() }, { prepare: f.prepare }), { code: 'GMAIL_RESPONSE_CHANGED' });
});
test('standalone human-composed email completes with a receipt without inventing a Hub conversation', async () => {
  const f = fixture(); delete f.input.hubThreadId; delete f.input.responseId;
  const result = await send(f); assert.equal(result.body.status, 'COMPLETED');
  assert.equal(f.state().message.length, 0); assert.equal(f.state().response[0].status, 'APPROVED');
  assert.equal(f.state().gmailSendReceipt[0].hubMessageId, null);
  await send(f); assert.equal(f.sends(), 1);
});
test('same-key payload change conflicts without preparing or sending again', async () => {
  const f = fixture(); await send(f); const count = f.prepares();
  for (const patch of [{ body: 'Changed' }, { to: 'other@example.test' }, { subject: 'Changed' }, { threadId: 'other-thread' }]) await assert.rejects(sendGmailWithReceipt(f.db, user, { ...f.input, ...patch }, { prepare: f.prepare }), { code: 'GMAIL_SEND_CONFLICT' });
  assert.equal(f.prepares(), count); assert.equal(f.sends(), 1);
});
test('concurrent identical requests invoke provider once and reserve intent once', async () => {
  const f = fixture();
  const results = await Promise.all([send(f), send(f)]);
  assert.equal(f.sends(), 1); assert.equal(f.state().gmailSendReceipt.length, 1);
  assert.ok(results.every(result => [200, 202].includes(result.statusCode)));
  assert.equal((await send(f)).body.status, 'COMPLETED'); assert.equal(f.state().message.length, 1);
});
test('same-key request delayed in prepare replays completed SENT response instead of claiming again', async () => {
  const f = fixture();
  let firstPrepared, releaseSecond;
  const secondWaiting = new Promise(resolve => { firstPrepared = resolve; });
  const secondReleased = new Promise(resolve => { releaseSecond = resolve; });
  const second = sendGmailWithReceipt(f.db, user, f.input, { prepare: async () => {
    firstPrepared(); await secondReleased; return f.prepare();
  } });
  await secondWaiting;
  // A missing receipt during transport preparation does not prove the
  // original request stopped. The UI must retain this key on that response.
  await assert.rejects(readGmailSendReceipt(f.db, user, f.input.idempotencyKey), { code: 'GMAIL_SEND_NOT_FOUND' });
  const completed = await send(f); assert.equal(f.state().response[0].status, 'SENT');
  releaseSecond();
  assert.deepEqual(await second, completed);
  assert.equal(f.sends(), 1); assert.equal(f.state().message.length, 1);
  assert.equal(f.state().auditEvent.filter(row => row.action === 'gmail_send.claimed').length, 1);
});
test('same-key completion between outer receipt lookup and approval read is a bounded replay', async () => {
  const f = fixture(); const original = f.db.response.findFirst;
  let intercept = true, completed;
  f.db.response.findFirst = async args => {
    if (intercept) { intercept = false; completed = await send(f); }
    return original(args);
  };
  const replay = await send(f);
  assert.deepEqual(replay, completed); assert.equal(f.sends(), 1); assert.equal(f.state().message.length, 1);
  assert.equal(f.state().auditEvent.filter(row => row.action === 'gmail_send.claimed').length, 1);
});
test('different intent keys cannot concurrently send the same approved response', async () => {
  const f = fixture();
  const results = await Promise.allSettled([send(f), sendGmailWithReceipt(f.db, user, { ...f.input, idempotencyKey: randomUUID() }, { prepare: f.prepare })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'GMAIL_SEND_CONFLICT');
  assert.equal(f.sends(), 1); assert.equal(f.state().gmailSendReceipt.length, 1);
});
test('timeout and malformed provider success are UNKNOWN and never redispatched', async () => {
  for (const provider of [async () => { throw Error('private oauth access_token'); }, async () => ({ private: 'malformed' })]) {
    const f = fixture(); f.flags.send = provider;
    const result = await send(f); assert.equal(result.statusCode, 202); assert.equal(result.body.status, 'UNKNOWN');
    await send(f); await reconcileGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: f.prepare });
    assert.equal(f.sends(), 1); assert.equal(f.state().message.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /private|oauth|access_token/);
  }
});
test('definite provider rejection is terminal for its key but permits a separately keyed approved send', async () => {
  const f = fixture(); f.flags.send = async () => { throw Object.assign(Error('private provider response'), { definiteRejection: true }); };
  await assert.rejects(send(f), { code: 'GMAIL_SEND_REJECTED', statusCode: 409 });
  await assert.rejects(send(f), { code: 'GMAIL_SEND_REJECTED' }); assert.equal(f.sends(), 1);
  const read = await readGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: f.prepare });
  assert.equal(read.statusCode, 200); assert.equal(read.body.status, 'REJECTED'); assert.equal(read.body.code, 'GMAIL_SEND_REJECTED');
  f.flags.send = async () => ({ id: 'retry-message', threadId: 'retry-thread' });
  // Provider assertion in fixture expects one receipt; replace the transport
  // for this distinct confirmed attempt, preserving both durable receipts.
  const next = await sendGmailWithReceipt(f.db, user, { ...f.input, idempotencyKey: randomUUID() }, { prepare: async () => ({ mailbox: f.flags.mailbox, send: f.flags.send }) });
  assert.equal(next.body.status, 'COMPLETED'); assert.equal(f.state().gmailSendReceipt.length, 2);
});
test('acceptance write failure leaves durable DISPATCHING fence and never sends on replay', async () => {
  const f = fixture(); f.flags.failAudit = 'gmail_send.accepted';
  const result = await send(f); assert.equal(result.statusCode, 202); assert.equal(result.body.status, 'DISPATCHING');
  f.flags.failAudit = null;
  await send(f); await reconcileGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: f.prepare });
  assert.equal(f.sends(), 1); assert.equal(f.state().message.length, 0);
});
test('accepted receipt repairs local records only; GET never reconciles', async () => {
  const f = fixture(); f.flags.failMessage = true;
  const pending = await send(f); assert.equal(pending.body.status, 'ACCEPTED_PENDING_RECORD'); assert.equal(f.state().response[0].status, 'APPROVED');
  f.flags.failMessage = false; const writes = f.writes.length;
  const read = await readGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: f.prepare });
  assert.equal(read.body.status, 'ACCEPTED_PENDING_RECORD'); assert.equal(f.writes.length, writes); assert.equal(f.state().message.length, 0);
  const repaired = await reconcileGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: f.prepare });
  assert.equal(repaired.body.status, 'COMPLETED'); assert.equal(f.sends(), 1); assert.equal(f.state().message.length, 1);
});
test('approved-response change after acceptance rolls back projection and keeps accepted receipt', async () => {
  const f = fixture(); f.flags.send = async () => { f.state().response[0].body = 'Changed during send'; return { id: 'message', threadId: 'thread' }; };
  const result = await send(f); assert.equal(result.body.status, 'ACCEPTED_PENDING_RECORD');
  assert.equal(f.state().message.length, 0); assert.equal(f.state().response[0].status, 'APPROVED');
  await reconcileGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: f.prepare }); assert.equal(f.sends(), 1);
  f.state().response[0].body = f.input.body;
  assert.equal((await reconcileGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: f.prepare })).body.status, 'COMPLETED');
});
test('audit failure rolls back claim or completed business projections', async () => {
  const claim = fixture(); claim.flags.failAudit = 'gmail_send.claimed';
  await assert.rejects(send(claim), { code: 'GMAIL_SEND_AUDIT_UNAVAILABLE' }); assert.equal(claim.sends(), 0); assert.equal(claim.state().gmailSendReceipt.length, 0);
  const completed = fixture(); completed.flags.failAudit = 'gmail_send.completed';
  assert.equal((await send(completed)).body.status, 'ACCEPTED_PENDING_RECORD');
  assert.equal(completed.state().message.length, 0); assert.equal(completed.state().response[0].status, 'APPROVED'); assert.equal(completed.state().thread[0].status, 'OPEN');
});
test('current staff, canonical client/project and assignment checked before prepare', async () => {
  for (const change of [{ role: 'BOT' }, { role: 'CLIENT' }, { isActive: false }, { organizationId: 'other' }]) {
    const f = fixture(); Object.assign(f.state().user[0], change);
    await assert.rejects(send(f), { code: 'ROLE_DENIED' }); assert.equal(f.prepares(), 0);
  }
  for (const change of [thread => { thread.client.deletedAt = new Date(); }, thread => { thread.assignedToId = 'someone'; }, thread => { thread.projectId = 'p'; thread.project = { id: 'p', clientId: 'another', organizationId: 'org', deletedAt: null }; }]) {
    const f = fixture(); f.state().user[0].role = 'TEAM'; change(f.state().thread[0]);
    await assert.rejects(send(f), { code: 'RECORD_NOT_FOUND' }); assert.equal(f.prepares(), 0);
  }
});
test('mailbox changes block new delivery replay; receipt read and repair require only current local authority', async () => {
  const f = fixture(); await send(f); f.flags.mailbox = 'different@example.test';
  await assert.rejects(send(f), { code: 'GMAIL_MAILBOX_CHANGED' });
  const unavailable = async () => { throw Error('Provider must not be called'); };
  assert.equal((await readGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: unavailable })).body.status, 'COMPLETED');
  assert.equal((await reconcileGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: unavailable })).body.status, 'COMPLETED');
  assert.equal(f.sends(), 1);
  f.flags.mailbox = 'sender@example.test'; f.state().user[0].isActive = false;
  await assert.rejects(readGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: f.prepare }), { code: 'ROLE_DENIED' });
});
test('accepted local repair succeeds when provider is unavailable and never prepares transport', async () => {
  const f = fixture(); f.flags.failMessage = true; await send(f); f.flags.failMessage = false;
  const before = f.prepares();
  const unavailable = async () => { throw Error('Provider must not be called'); };
  assert.equal((await readGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: unavailable })).body.status, 'ACCEPTED_PENDING_RECORD');
  assert.equal((await reconcileGmailSendReceipt(f.db, user, f.input.idempotencyKey, { prepare: unavailable })).body.status, 'COMPLETED');
  assert.equal(f.prepares(), before); assert.equal(f.sends(), 1);
});
test('strict input and approved text mismatches rejected before prepare or writes', async () => {
  for (const patch of [{ idempotencyKey: 'not-a-uuid' }, { subject: 'header\r\ninjection' }, { portalEnabled: true }, { body: 'Changed approved reply' }, { subject: 'Changed subject' }, { hubThreadId: null }, { responseId: 'missing' }]) {
    const f = fixture(); await assert.rejects(sendGmailWithReceipt(f.db, user, { ...f.input, ...patch }, { prepare: f.prepare }));
    assert.equal(f.prepares(), 0); assert.equal(f.writes.length, 0);
  }
});
test('critical caller errors use fixed actionable copy and never claim an earlier dispatch was not sent', async () => {
  const f = fixture(); f.state().response[0].status = 'REJECTED';
  await assert.rejects(send(f), error => error.code === 'GMAIL_RESPONSE_CHANGED' && /approval|approved/.test(error.message));
  assert.equal(f.prepares(), 0);
  const completed = fixture(); await send(completed); completed.flags.mailbox = 'other@example.test';
  await assert.rejects(send(completed), error => error.code === 'GMAIL_MAILBOX_CHANGED' && /stored send status/.test(error.message) && !/not sent/i.test(error.message));
  completed.flags.mailbox = null;
  await assert.rejects(send(completed), error => error.code === 'GMAIL_MAILBOX_UNAVAILABLE' && !/not sent/i.test(error.message));
});
test('scoped receipt delegates refuse deleting fences, upserts and identity updates before database access', async () => {
  let writes = 0;
  const raw = { gmailSendReceipt: Object.fromEntries(['delete', 'deleteMany', 'upsert', 'update', 'updateMany', 'updateManyAndReturn'].map(method => [method, async () => { writes++; throw Error('Should not reach database'); }])) };
  const scoped = createScopedPrisma(raw, user.organizationId);
  for (const method of ['delete', 'deleteMany', 'upsert', 'updateManyAndReturn']) await assert.rejects(scoped.gmailSendReceipt[method]({ where: { id: 'receipt' }, data: {} }), /Tenancy Error:.*not permitted/);
  for (const method of ['update', 'updateMany']) for (const data of [{ mailbox: 'changed@example.test' }, { snapshot: { body: 'Changed' } }, { idempotencyKey: randomUUID() }, { userId: 'other' }]) await assert.rejects(scoped.gmailSendReceipt[method]({ where: { id: 'receipt' }, data }), /Tenancy Error:/);
  assert.equal(writes, 0);
});
