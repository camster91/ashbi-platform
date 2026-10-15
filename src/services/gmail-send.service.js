import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ToolError } from '../ai/tools/registry.js';
import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';
import { recordAuditEvent } from './audit-event.service.js';

const id = z.string().min(1).max(100);
// Header fields must remain a single line. The body is intentionally not
// trimmed: an approved reply must leave byte-for-byte as approved.
const singleLine = value => !/[\r\n\u0000-\u001f\u007f]/.test(value); // eslint-disable-line no-control-regex
const header = max => z.string().max(max).refine(singleLine);
const fields = {
  to: z.string().trim().email().max(255), subject: header(500).refine(value => value.trim().length > 0),
  body: z.string().min(1).max(50000), hubThreadId: id.nullable().optional(), responseId: id.nullable().optional(),
  threadId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/).nullable().optional(),
  in_reply_to: header(500).nullable().optional(), references: header(500).nullable().optional(),
};
export const gmailReceiptSendSchema = z.object({ ...fields, idempotencyKey: z.string().uuid() }).strict();
const snapshotSchema = z.object({ ...fields, senderName: z.string().max(200).nullable() }).strict();
const providerResultSchema = z.object({ id: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/), threadId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/) }).passthrough();
const keySchema = z.string().uuid();
const FAILURE_MESSAGES = Object.freeze({
  GMAIL_RESPONSE_CHANGED: 'The approved draft changed or is no longer approved. Reload the draft and review its approval before sending.',
  GMAIL_SEND_CONFLICT: 'This send key belongs to another email or send intent. Check the stored send status before starting another email.',
  GMAIL_MAILBOX_CHANGED: 'The connected mailbox changed. Check the stored send status; this intent cannot be reused with another mailbox.',
  GMAIL_SEND_REJECTED: 'Gmail rejected this send attempt. Check its stored outcome before starting a separate send.',
  ROLE_DENIED: 'Active staff access is required to access this send intent.',
  RECORD_NOT_FOUND: 'The conversation, approved draft or send receipt is unavailable for your current access.',
});
const fail = (code, statusCode = 409) => { throw new ToolError(code, FAILURE_MESSAGES[code] ?? 'Gmail send unavailable. Check the stored send status before trying another email.', { statusCode }); };
function parse(schema, input) { const parsed = schema.safeParse(input); if (!parsed.success) fail('GMAIL_SEND_INVALID_INPUT', 400); return parsed.data; }
function canonical(input) {
  return { to: input.to, subject: input.subject, body: input.body, hubThreadId: input.hubThreadId ?? null,
    responseId: input.responseId ?? null, threadId: input.threadId ?? null,
    in_reply_to: input.in_reply_to ?? null, references: input.references ?? null };
}
const fingerprint = (snapshot, mailbox) => createHash('sha256').update(JSON.stringify({ mailbox, ...canonical(snapshot) })).digest('hex');
const safeName = actor => typeof actor.name === 'string' ? actor.name.slice(0, 200) : null;

async function actorScope(prisma, user) {
  if (!user?.id || !user.organizationId || !['ADMIN', 'TEAM'].includes(user.role)) fail('ROLE_DENIED', 403);
  const db = createScopedPrisma(prisma, user.organizationId);
  const actor = await db.user.findFirst({ where: { id: user.id, organizationId: user.organizationId, isActive: true }, select: { id: true, organizationId: true, role: true, isActive: true, name: true } });
  if (!actor || actor.id !== user.id || actor.organizationId !== user.organizationId || !actor.isActive || !['ADMIN', 'TEAM'].includes(actor.role)) fail('ROLE_DENIED', 403);
  return { db, actor };
}
async function authorizeSnapshot(db, actor, snapshot, requireApproved = false) {
  if (snapshot.responseId && !snapshot.hubThreadId) fail('GMAIL_SEND_INVALID_INPUT', 400);
  if (snapshot.hubThreadId) {
    const thread = await db.thread.findFirst({ where: { id: snapshot.hubThreadId,
      client: { organizationId: actor.organizationId, deletedAt: null },
      ...(actor.role === 'ADMIN' ? {} : { assignedToId: actor.id }),
      OR: [{ projectId: null }, { project: { organizationId: actor.organizationId, deletedAt: null, client: { organizationId: actor.organizationId, deletedAt: null } } }],
    }, select: { id: true, assignedToId: true, clientId: true, projectId: true,
      client: { select: { id: true, organizationId: true, deletedAt: true } },
      project: { select: { id: true, clientId: true, organizationId: true, deletedAt: true } } } });
    if (!thread || thread.id !== snapshot.hubThreadId || !thread.clientId || thread.client?.id !== thread.clientId
      || thread.client.organizationId !== actor.organizationId || thread.client.deletedAt != null
      || (actor.role !== 'ADMIN' && thread.assignedToId !== actor.id)
      || (thread.projectId && (thread.project?.id !== thread.projectId || thread.project.organizationId !== actor.organizationId || thread.project.deletedAt != null || thread.project.clientId !== thread.clientId))) fail('RECORD_NOT_FOUND', 404);
  }
  if (snapshot.responseId) {
    const response = await db.response.findFirst({ where: { id: snapshot.responseId, threadId: snapshot.hubThreadId }, select: { id: true, threadId: true, status: true, subject: true, body: true } });
    if (!response || response.id !== snapshot.responseId || response.threadId !== snapshot.hubThreadId) fail('RECORD_NOT_FOUND', 404);
    if (requireApproved && (response.status !== 'APPROVED' || response.subject !== snapshot.subject || response.body !== snapshot.body)) fail('GMAIL_RESPONSE_CHANGED');
  }
}
async function prepared(prepare, actor, snapshot, receipt) {
  const transport = await prepare({ user: actor, snapshot });
  const email = z.string().trim().email().max(255).safeParse(transport?.mailbox);
  if (!email.success) fail('GMAIL_MAILBOX_UNAVAILABLE', 503);
  const mailbox = email.data.toLowerCase();
  if (receipt && receipt.mailbox !== mailbox) fail('GMAIL_MAILBOX_CHANGED');
  return { ...transport, mailbox };
}
function scopeWhere(actor, idempotencyKey) { return { organizationId: actor.organizationId, userId: actor.id, idempotencyKey }; }
function verifyReceipt(receipt, actor) {
  if (!receipt || receipt.organizationId !== actor.organizationId || receipt.userId !== actor.id) fail('RECORD_NOT_FOUND', 404);
  const snapshot = parse(snapshotSchema, receipt.snapshot);
  if (fingerprint(snapshot, receipt.mailbox) !== receipt.payloadHash) fail('GMAIL_RECEIPT_INVALID', 503);
  return snapshot;
}
async function audit(db, actor, action, receipt) {
  const snapshot = receipt.snapshot;
  const event = await recordAuditEvent(db, { organizationId: actor.organizationId, actorUserId: actor.id,
    actorType: 'USER', action, entityId: receipt.id, metadata: { status: receipt.status,
      ...(snapshot.hubThreadId ? { hubThreadId: snapshot.hubThreadId } : {}),
      ...(snapshot.responseId ? { responseId: snapshot.responseId } : {}) } });
  if (!event) fail('GMAIL_SEND_AUDIT_UNAVAILABLE', 503);
}
function outcome(receipt, { read = false } = {}) {
  if (receipt.status === 'REJECTED' && !read) fail('GMAIL_SEND_REJECTED');
  const completed = receipt.status === 'COMPLETED';
  return { statusCode: completed || read ? 200 : 202, body: {
    success: completed, receiptId: receipt.id, status: receipt.status,
    ...(receipt.providerMessageId ? { messageId: receipt.providerMessageId } : {}),
    ...(receipt.providerThreadId ? { threadId: receipt.providerThreadId } : {}),
    ...(!completed ? { code: receipt.status === 'ACCEPTED_PENDING_RECORD' ? 'GMAIL_RECORD_PENDING' : receipt.status === 'REJECTED' ? 'GMAIL_SEND_REJECTED' : 'GMAIL_SEND_UNKNOWN' } : {}),
  } };
}
async function receiptTransition(db, actor, receipt, from, data, action) {
  return db.$transaction(async tx => {
    const changed = await tx.gmailSendReceipt.updateMany({ where: { id: receipt.id, ...scopeWhere(actor, receipt.idempotencyKey), status: from }, data });
    if (changed.count !== 1) fail('GMAIL_RECEIPT_CONFLICT');
    const updated = await tx.gmailSendReceipt.findFirst({ where: { id: receipt.id, ...scopeWhere(actor, receipt.idempotencyKey) } });
    if (!updated) fail('GMAIL_RECEIPT_CONFLICT');
    await audit(tx, actor, action, updated);
    return updated;
  });
}

// Only database projection is retried here. This function has no transport
// dependency and cannot submit another provider request.
async function finalize(db, user, receipt) {
  return db.$transaction(async tx => {
    const { actor } = await actorScope(tx, user);
    const snapshot = verifyReceipt(receipt, actor);
    await authorizeSnapshot(tx, actor, snapshot);
    const lock = await tx.gmailSendReceipt.updateMany({ where: { id: receipt.id, ...scopeWhere(actor, receipt.idempotencyKey), status: 'ACCEPTED_PENDING_RECORD' }, data: { updatedAt: new Date() } });
    if (lock.count !== 1) {
      const current = await tx.gmailSendReceipt.findFirst({ where: { id: receipt.id, ...scopeWhere(actor, receipt.idempotencyKey) } });
      if (current?.status === 'COMPLETED') return current;
      fail('GMAIL_RECEIPT_CONFLICT');
    }
    if (snapshot.responseId) {
      const changed = await tx.response.updateMany({ where: { id: snapshot.responseId, threadId: snapshot.hubThreadId,
        status: 'APPROVED', subject: snapshot.subject, body: snapshot.body }, data: { status: 'SENT', sentAt: new Date() } });
      if (changed.count !== 1) fail('GMAIL_RESPONSE_CHANGED');
    }
    let hubMessageId = null;
    if (snapshot.hubThreadId) {
      const message = await tx.message.create({ data: { direction: 'OUTBOUND', senderEmail: receipt.mailbox,
        senderName: snapshot.senderName, subject: snapshot.subject, bodyText: snapshot.body,
        receivedAt: new Date(receipt.updatedAt), threadId: snapshot.hubThreadId,
        aiExtracted: JSON.stringify({ gmailMessageId: receipt.providerMessageId, gmailThreadId: receipt.providerThreadId,
          source: 'gmail-send', sendReceiptId: receipt.id, sentAt: new Date(receipt.updatedAt).toISOString() }) }, select: { id: true } });
      hubMessageId = message.id;
      const changed = await tx.thread.updateMany({ where: { id: snapshot.hubThreadId }, data: { status: 'AWAITING_RESPONSE',
        lastActivityAt: new Date(), lastEscalationLevel: 0, lastEscalatedAt: null } });
      if (changed.count !== 1) fail('RECORD_NOT_FOUND', 404);
    }
    const changed = await tx.gmailSendReceipt.updateMany({ where: { id: receipt.id, ...scopeWhere(actor, receipt.idempotencyKey), status: 'ACCEPTED_PENDING_RECORD' }, data: { status: 'COMPLETED', hubMessageId, finishedAt: new Date(), errorCode: null } });
    if (changed.count !== 1) fail('GMAIL_RECEIPT_CONFLICT');
    const completed = await tx.gmailSendReceipt.findFirst({ where: { id: receipt.id, ...scopeWhere(actor, receipt.idempotencyKey) } });
    if (!completed) fail('GMAIL_RECEIPT_CONFLICT');
    await audit(tx, actor, 'gmail_send.completed', completed);
    return completed;
  });
}
async function repair(db, user, receipt) {
  if (receipt.status !== 'ACCEPTED_PENDING_RECORD') return outcome(receipt);
  try { return outcome(await finalize(db, user, receipt)); }
  catch { return outcome(receipt); }
}

export async function sendGmailWithReceipt(prisma, user, input, { prepare }) {
  const parsed = parse(gmailReceiptSendSchema, input);
  const key = parsed.idempotencyKey.toLowerCase();
  let { db, actor } = await actorScope(prisma, user);
  let receipt = await db.gmailSendReceipt.findFirst({ where: scopeWhere(actor, key) });
  const snapshot = { ...canonical(parsed), senderName: safeName(actor) };
  if (receipt) {
    const stored = verifyReceipt(receipt, actor);
    if (fingerprint(snapshot, receipt.mailbox) !== receipt.payloadHash) fail('GMAIL_SEND_CONFLICT');
    await authorizeSnapshot(db, actor, stored);
  } else {
    try { await authorizeSnapshot(db, actor, snapshot, true); }
    catch (error) {
      if (error?.code !== 'GMAIL_RESPONSE_CHANGED') throw error;
      // A same-key winner can complete between the outer lookup and this
      // approval read. One bounded fresh lookup distinguishes that replay
      // from a genuinely unapproved or changed draft before any transport.
      const fresh = await actorScope(prisma, user);
      const existing = await fresh.db.gmailSendReceipt.findFirst({ where: scopeWhere(fresh.actor, key) });
      if (!existing) throw error;
      const stored = verifyReceipt(existing, fresh.actor);
      if (fingerprint(snapshot, existing.mailbox) !== existing.payloadHash) throw error;
      await authorizeSnapshot(fresh.db, fresh.actor, stored);
      ({ db, actor } = fresh);
      receipt = existing;
    }
  }
  const transport = await prepared(prepare, actor, snapshot, receipt);
  if (receipt) return repair(db, user, receipt);
  if (typeof transport.send !== 'function') fail('GMAIL_MAILBOX_UNAVAILABLE', 503);
  try {
    const claim = await db.$transaction(async tx => {
      const fresh = await actorScope(tx, user);
      // An earlier request may have finished while this one prepared its
      // transport. Recheck ownership before requiring APPROVED: its exact
      // response is now SENT and this remains a valid idempotent replay.
      const existing = await tx.gmailSendReceipt.findFirst({ where: scopeWhere(fresh.actor, key) });
      if (existing) {
        const stored = verifyReceipt(existing, fresh.actor);
        if (existing.mailbox !== transport.mailbox || fingerprint(snapshot, transport.mailbox) !== existing.payloadHash) fail('GMAIL_SEND_CONFLICT');
        await authorizeSnapshot(tx, fresh.actor, stored);
        return { receipt: existing, claimed: false };
      }
      await authorizeSnapshot(tx, fresh.actor, snapshot, true);
      const created = await tx.gmailSendReceipt.create({ data: { ...scopeWhere(actor, key), mailbox: transport.mailbox,
        payloadHash: fingerprint(snapshot, transport.mailbox), snapshot, status: 'DISPATCHING' } });
      await audit(tx, actor, 'gmail_send.claimed', created);
      return { receipt: created, claimed: true };
    });
    receipt = claim.receipt;
    if (!claim.claimed) return repair(db, user, receipt);
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    // Another request committed the intent. Even if its outcome is still
    // unknown, it alone owns the provider call; never reacquire this claim.
    receipt = await db.gmailSendReceipt.findFirst({ where: scopeWhere(actor, key) });
    if (!receipt) fail('GMAIL_SEND_CONFLICT');
    verifyReceipt(receipt, actor);
    if (receipt.mailbox !== transport.mailbox || fingerprint(snapshot, transport.mailbox) !== receipt.payloadHash) fail('GMAIL_SEND_CONFLICT');
    return repair(db, user, receipt);
  }
  let sent;
  try { sent = parse(providerResultSchema, await transport.send(receipt.snapshot)); }
  catch (error) {
    const rejected = error?.definiteRejection === true;
    try { receipt = await receiptTransition(db, actor, receipt, 'DISPATCHING', { status: rejected ? 'REJECTED' : 'UNKNOWN',
      errorCode: rejected ? 'GMAIL_SEND_REJECTED' : 'GMAIL_SEND_UNKNOWN', finishedAt: new Date() }, rejected ? 'gmail_send.rejected' : 'gmail_send.unknown'); }
    catch { /* The committed DISPATCHING claim remains a permanent no-resend fence. */ }
    if (rejected && receipt.status === 'REJECTED') fail('GMAIL_SEND_REJECTED');
    return outcome(receipt);
  }
  try {
    receipt = await receiptTransition(db, actor, receipt, 'DISPATCHING', { status: 'ACCEPTED_PENDING_RECORD',
      providerMessageId: sent.id, providerThreadId: sent.threadId, errorCode: null }, 'gmail_send.accepted');
  } catch { return outcome(receipt); }
  return repair(db, user, receipt);
}

async function loadAuthorizedReceipt(prisma, user, key) {
  key = parse(keySchema, key).toLowerCase();
  const { db, actor } = await actorScope(prisma, user);
  const receipt = await db.gmailSendReceipt.findFirst({ where: scopeWhere(actor, key) });
  // Only absence under the authenticated actor's key proves no claim exists.
  // A later thread/assignment denial must never clear a possibly sent intent.
  if (!receipt) fail('GMAIL_SEND_NOT_FOUND', 404);
  const snapshot = verifyReceipt(receipt, actor);
  await authorizeSnapshot(db, actor, snapshot);
  return { db, receipt };
}
/** GET is strictly read-only, including accepted receipts awaiting projection. */
export async function readGmailSendReceipt(prisma, user, key) {
  const { receipt } = await loadAuthorizedReceipt(prisma, user, key);
  return outcome(receipt, { read: true });
}
/** Explicit repair uses only stored accepted IDs; it never invokes send. */
export async function reconcileGmailSendReceipt(prisma, user, key) {
  const { db, receipt } = await loadAuthorizedReceipt(prisma, user, key);
  return repair(db, user, receipt);
}
