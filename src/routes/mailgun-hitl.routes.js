// Mailgun HITL reply webhook — parses staff email replies back into Hub.
//
// A HITL email goes out with Reply-To reply+<notificationId>.<token>@<mailgun
// domain> (token: HMAC of the id, see services/hitl-reply-address.js), and
// its Mailgun Message-Id is recorded on the notification. Mailgun's inbound
// route forwards the reply here as form fields. A reply is applied only when:
//   - the Mailgun signature is valid, its timestamp is inside the 15-minute
//     window and its token has not been used before (same checks as
//     POST /api/mailgun/events);
//   - no security-relevant field (recipient, from, sender, signature fields,
//     body, Mailgun's SPF/DKIM results) was posted twice;
//   - the reply address carries a valid token for the notification;
//   - message-headers is present, In-Reply-To or References names the
//     recorded Message-Id, and the single Date header (and the time of
//     receipt) falls within 30 days of the notification (an old signed
//     email cannot be replayed into it);
//   - the reply carries exactly one Message-Id, and that reply has not been
//     applied to this notification before (a claim made in the same
//     transaction as the writes, so a re-injected copy is refused);
//   - the From header names exactly one address, and that address is the Hub
//     user the notification was created for, or an active admin of that
//     user's organization (case-insensitive);
//   - as defence in depth, Mailgun's own verdicts (read only from the
//     X-Mailgun-* block it prepends) show a DKIM pass aligned with the From
//     domain, or an SPF pass for an envelope sender aligned with it; and
//   - for an approval, it is still PENDING.
// Knowing a notification id is therefore not enough to approve anything.
//
// Status codes follow Mailgun's retry rules: 406 is never retried (stale,
// replayed, ambiguous, unauthorized, already-decided or unusable replies);
// 401 and 5xx are retried. All writes happen in one transaction, and the
// token is released only when that transaction did not commit, so a retry
// never duplicates a note or comment.

import crypto from 'node:crypto';
import env from '../config/env.js';
import { releaseWebhookToken } from '../services/mailgun-delivery.service.js';
import {
  addMailgunFormParser,
  authenticateMailgunWebhook,
  HITL_REPLY_WINDOW_MS,
  MAILGUN_WEBHOOK_BODY_LIMIT,
  mailgunSenderAuthentication,
  parseEmailAddress,
  parseMessageHeaders,
  readMailgunWebhookRequest,
  replyDateInWindow,
  replyReferencesMessage,
  singleMessageId,
} from '../services/mailgun-webhook-request.js';
import { verifyHitlReplyRecipient } from '../services/hitl-reply-address.js';
import { parseNotificationData, stripQuotedReply, sendDiscordCamNotification } from '../utils/hitl-email.service.js';

const STAFF_ROLES = new Set(['ADMIN', 'TEAM']);
const USER_FIELDS = { id: true, email: true, role: true, isActive: true, organizationId: true };

const REJECTION_MESSAGES = Object.freeze({
  not_pending: 'Approval is no longer pending',
  duplicate: 'This reply was already applied',
});

class ReplyRejected extends Error {
  /** @param {keyof typeof REJECTION_MESSAGES} code */
  constructor(code) {
    super(REJECTION_MESSAGES[code]);
    this.name = 'ReplyRejected';
    this.code = code;
  }
}

/**
 * Claim `hitl-reply:<notificationId>:<sha256(reply Message-Id)>` in the
 * Mailgun webhook claim table (unique `token`). The row is dated at the end
 * of the notification's reply window: claimWebhookToken prunes rows older
 * than now - 30 minutes, so the claim outlives every reply that could still
 * be accepted for the notification.
 */
async function claimHitlReply(tx, notificationId, replyMessageId, windowEnd) {
  const digest = crypto.createHash('sha256').update(replyMessageId).digest('hex');
  try {
    await tx.mailgunWebhookReceipt.create({
      data: { token: `hitl-reply:${notificationId}:${digest}`, receivedAt: windowEnd },
    });
  } catch (err) {
    if (err?.code === 'P2002') throw new ReplyRejected('duplicate');
    throw err;
  }
}

/**
 * The staff user allowed to answer this notification whose address matches
 * the reply's From address, or null. Allowed: the notification's own
 * recipient, or an active admin in the recipient's organization.
 */
export async function resolveAuthorizedReplier(prisma, notification, fromAddress) {
  if (!fromAddress || !notification?.userId) return null;
  const recipient = await prisma.user.findUnique({ where: { id: notification.userId }, select: USER_FIELDS });
  if (!recipient?.organizationId) return null;
  const candidates = await prisma.user.findMany({
    where: {
      organizationId: recipient.organizationId,
      isActive: true,
      OR: [{ id: recipient.id }, { role: 'ADMIN' }],
    },
    select: USER_FIELDS,
  });
  return candidates.find(user => (
    user.isActive
    && user.organizationId === recipient.organizationId
    && STAFF_ROLES.has(user.role)
    && (user.id === recipient.id || user.role === 'ADMIN')
    && typeof user.email === 'string'
    && user.email.toLowerCase() === fromAddress
  )) || null;
}

function parseDecision(replyText) {
  const textUpper = replyText.toUpperCase().trim();
  if (textUpper.startsWith('APPROVED')) {
    return { status: 'APPROVED', reviewNote: replyText.replace(/^APPROVED[\s\-–—:.]*/i, '').trim() || null };
  }
  if (textUpper.startsWith('REJECTED') || textUpper.startsWith('REJECT')) {
    return { status: 'REJECTED', reviewNote: replyText.replace(/^REJECTED?[\s\-–—:.]*/i, '').trim() || null };
  }
  return { status: null, reviewNote: null };
}

/**
 * Apply one authenticated reply. Returns the HTTP status and payload; throws
 * on a processing failure the caller should let Mailgun retry. `onCommit`
 * runs once the writes are committed.
 */
async function applyHitlReply({ prisma, log, body, onCommit }) {
  // reply+<notificationId>.<token>@ — the token is an HMAC of the id, so a
  // reply address cannot be made up for a notification.
  const notificationId = verifyHitlReplyRecipient(body.recipient);
  if (!notificationId) {
    log.warn('[hitl-reply] Reply address has a missing or invalid token');
    return { status: 406, payload: { error: 'Unrecognised reply address' } };
  }

  const headers = parseMessageHeaders(body);
  if (!headers) {
    log.warn({ notificationId }, '[hitl-reply] Missing or unreadable message-headers');
    return { status: 406, payload: { error: 'Message headers are required' } };
  }

  // Strip quoted text — the actual reply is at the top
  const bodyPlain = typeof body['body-plain'] === 'string' ? body['body-plain'] : '';
  const replyText = stripQuotedReply(bodyPlain);
  if (!replyText) {
    log.warn('[hitl-reply] Empty reply text after stripping quotes');
    return { status: 406, payload: { error: 'Empty reply' } };
  }

  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.type !== 'HITL_REQUIRED') {
    log.warn({ notificationId }, '[hitl-reply] HITL notification not found');
    return { status: 406, payload: { error: 'Unknown notification' } };
  }

  // Only the From header counts: it is what the person sees and what DMARC
  // aligns. A From naming several mailboxes parses to null and is refused.
  const fromAddress = parseEmailAddress(body.from);
  const replier = await resolveAuthorizedReplier(prisma, notification, fromAddress);
  if (!replier) {
    log.warn({ notificationId }, '[hitl-reply] Reply from an address not authorized for this notification');
    return { status: 406, payload: { error: 'Sender is not authorized to answer this notification' } };
  }

  const data = parseNotificationData(notification.data);
  // The reply must answer the email Hub sent (its recorded Message-Id), and
  // must not be dated before the notification existed, so an older signed
  // email from the approver cannot be replayed into this notification.
  if (!replyReferencesMessage(headers, data.hitlMessageId)) {
    log.warn({ notificationId }, '[hitl-reply] Reply does not reference the HITL email');
    return { status: 406, payload: { error: 'Reply does not answer this notification email' } };
  }
  const createdAt = notification.createdAt instanceof Date ? notification.createdAt : new Date(notification.createdAt);
  const windowEnd = createdAt.getTime() + HITL_REPLY_WINDOW_MS;
  if (!replyDateInWindow(headers, createdAt) || !(Date.now() <= windowEnd)) {
    log.warn({ notificationId }, '[hitl-reply] Reply Date is missing or outside the notification reply window');
    return { status: 406, payload: { error: 'Reply is outside this notification reply window' } };
  }
  // The reply's own Message-Id makes it single-use per notification.
  const replyMessageId = singleMessageId(headers);
  if (!replyMessageId) {
    log.warn({ notificationId }, '[hitl-reply] Reply needs exactly one Message-Id header');
    return { status: 406, payload: { error: 'Reply must carry exactly one Message-Id' } };
  }

  // Defence in depth: Mailgun's SPF/DKIM verdicts must vouch for the From domain.
  const senderAuth = mailgunSenderAuthentication(headers, body.sender, fromAddress);
  if (!senderAuth.ok) {
    log.warn({ notificationId, reason: senderAuth.reason }, '[hitl-reply] Reply sender not verified by SPF/DKIM');
    return { status: 406, payload: { error: 'Sender could not be verified' } };
  }

  const { type, refId } = data;
  let approval = null;
  let task = null;
  if (type === 'APPROVAL' && refId) {
    approval = await prisma.approval.findUnique({ where: { id: refId } });
    if (approval && approval.status !== 'PENDING') {
      log.warn({ approvalId: refId, status: approval.status }, '[hitl-reply] Approval already decided');
      return { status: 406, payload: { error: 'Approval is no longer pending' } };
    }
  } else if (type === 'TASK' && refId) {
    task = await prisma.task.findUnique({ where: { id: refId } });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Claim this reply for this notification first: re-injecting the same
      // signed reply through Mailgun (new delivery token) is refused, and the
      // claim rolls back with the writes if anything below fails.
      await claimHitlReply(tx, notificationId, replyMessageId, new Date(windowEnd));
      if (approval) await applyApprovalReply(tx, approval, replyText, replier);
      if (task) await applyTaskReply(tx, task, replyText, replier);
      await tx.notification.update({
        where: { id: notificationId },
        data: { read: true, readAt: new Date() },
      });
    });
  } catch (err) {
    if (err instanceof ReplyRejected) {
      log.warn({ notificationId, reason: err.code }, '[hitl-reply] Reply rejected');
      return { status: 406, payload: { error: REJECTION_MESSAGES[err.code] } };
    }
    throw err;
  }
  onCommit();
  log.info({ notificationId, type, method: senderAuth.method }, '[hitl-reply] Reply applied');

  // Discord confirmation to #cam (never fails the committed reply)
  try {
    const entityLabel = type === 'APPROVAL' ? 'approval' : type === 'TASK' ? 'task' : 'item';
    await sendDiscordCamNotification(
      `✉️ **Reply logged** from ${replier.email} — ${entityLabel} #${typeof refId === 'string' ? refId.substring(0, 8) : 'N/A'}\n> ${replyText.substring(0, 200)}${replyText.length > 200 ? '…' : ''}`
    );
  } catch (err) {
    log.warn({ err }, '[hitl-reply] Discord confirmation failed');
  }
  return { status: 200, payload: { status: 'ok' } };
}

async function applyApprovalReply(tx, approval, replyText, replier) {
  const { status, reviewNote } = parseDecision(replyText);
  if (status) {
    // Conditional on PENDING so a concurrent decision is never overwritten.
    const updated = await tx.approval.updateMany({
      where: { id: approval.id, status: 'PENDING' },
      data: {
        status,
        reviewNote,
        reviewedBy: replier.email,
        reviewedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw new ReplyRejected('not_pending');
  }
  // Keep the reply as a project note (notes belong to a project).
  if (approval.projectId) {
    await tx.note.create({
      data: {
        title: 'Email reply on approval',
        content: replyText,
        projectId: approval.projectId,
        authorId: replier.id,
      },
    });
  }
}

async function applyTaskReply(tx, task, replyText, replier) {
  // Update task status from WAITING_US or BLOCKED → IN_PROGRESS
  if (['WAITING_US', 'BLOCKED'].includes(task.status)) {
    await tx.task.update({
      where: { id: task.id },
      data: { status: 'IN_PROGRESS' },
    });
  }
  await tx.taskComment.create({
    data: {
      content: replyText,
      taskId: task.id,
      authorId: replier.id,
    },
  });
}

export default async function mailgunHitlRoutes(fastify) {
  // This plugin holds only the webhook, so the form parser stays scoped to it.
  addMailgunFormParser(fastify);

  /**
   * POST /api/mailgun-hitl/hitl-reply
   * Mailgun forwards replies to reply+{notificationId}@<domain> here
   */
  fastify.post('/hitl-reply', { config: { public: true }, bodyLimit: MAILGUN_WEBHOOK_BODY_LIMIT }, async (request, reply) => {
    const signingKey = env.mailgunSigningKey;
    if (!signingKey) {
      request.log.error('[hitl-reply] MAILGUN_SIGNING_KEY not configured — rejecting webhook');
      return reply.status(503).send({ error: 'Mailgun signing key not configured' });
    }

    const read = await readMailgunWebhookRequest(request);
    if (!read.ok) return reply.status(read.status).send({ error: read.error });
    const body = read.fields;

    const prisma = request.prisma || fastify.prisma;
    const auth = await authenticateMailgunWebhook({ fields: body, signingKey, prisma });
    if (!auth.ok) {
      request.log.warn({ reason: auth.reason }, '[hitl-reply] Rejected Mailgun webhook');
      return reply.status(auth.status).send({ error: auth.error });
    }

    let committed = false;
    try {
      const outcome = await applyHitlReply({ prisma, log: request.log, body, onCommit: () => { committed = true; } });
      return reply.status(outcome.status).send(outcome.payload);
    } catch (err) {
      // Release the token only when nothing was written, so Mailgun's retry
      // is accepted without duplicating a committed reply.
      if (!committed) await releaseWebhookToken(prisma, auth.token);
      request.log.error({ err }, '[hitl-reply] Processing error');
      return reply.status(committed ? 200 : 500).send(committed ? { status: 'ok' } : { error: 'Failed to process reply' });
    }
  });
}
