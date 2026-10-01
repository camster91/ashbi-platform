// Mailgun HITL reply webhook — parses staff email replies back into Hub.
//
// A HITL email goes out with Reply-To reply+{notificationId}@<mailgun domain>;
// Mailgun's inbound route forwards the reply here as form fields. A reply is
// applied only when:
//   - the Mailgun signature is valid, its timestamp is inside the 15-minute
//     window and its token has not been used before (same checks as
//     POST /api/mailgun/events);
//   - no security-relevant field (recipient, from, sender, signature fields,
//     body, Mailgun's SPF/DKIM results) was posted twice;
//   - the From header names exactly one address, and that address is the Hub
//     user the notification was created for, or an active admin of that
//     user's organization (case-insensitive);
//   - Mailgun's own checks vouch for the From domain (aligned DKIM pass, or
//     SPF pass for an aligned envelope sender), because the From header
//     itself is not authenticated; and
//   - for an approval, it is still PENDING.
// Knowing a notification id is therefore not enough to approve anything.
//
// Status codes follow Mailgun's retry rules: 406 is never retried (stale,
// replayed, ambiguous, unauthorized, already-decided or unusable replies);
// 401 and 5xx are retried. All writes happen in one transaction, and the
// token is released only when that transaction did not commit, so a retry
// never duplicates a note or comment.

import env from '../config/env.js';
import { releaseWebhookToken } from '../services/mailgun-delivery.service.js';
import {
  addMailgunFormParser,
  authenticateMailgunWebhook,
  MAILGUN_WEBHOOK_BODY_LIMIT,
  mailgunSenderAuthentication,
  parseEmailAddress,
  readMailgunWebhookRequest,
} from '../services/mailgun-webhook-request.js';
import { stripQuotedReply, sendDiscordCamNotification } from '../utils/hitl-email.service.js';

const STAFF_ROLES = new Set(['ADMIN', 'TEAM']);
const USER_FIELDS = { id: true, email: true, role: true, isActive: true, organizationId: true };

class ReplyRejected extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReplyRejected';
  }
}

function notificationData(notification) {
  const raw = notification?.data;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
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
  const recipient = typeof body.recipient === 'string' ? body.recipient : '';
  const match = recipient.match(/reply\+([^@\s]+)@/);
  if (!match) {
    log.warn('[hitl-reply] Could not extract a notification id from the recipient');
    return { status: 406, payload: { error: 'Unrecognised reply address' } };
  }
  const notificationId = match[1];

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

  const senderAuth = mailgunSenderAuthentication(body, fromAddress);
  if (!senderAuth.ok) {
    log.warn({ notificationId, reason: senderAuth.reason }, '[hitl-reply] Reply sender not verified by SPF/DKIM');
    return { status: 406, payload: { error: 'Sender could not be verified' } };
  }

  const { type, refId } = notificationData(notification);
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
      if (approval) await applyApprovalReply(tx, approval, replyText, replier);
      if (task) await applyTaskReply(tx, task, replyText, replier);
      await tx.notification.update({
        where: { id: notificationId },
        data: { read: true, readAt: new Date() },
      });
    });
  } catch (err) {
    if (err instanceof ReplyRejected) {
      log.warn({ notificationId }, `[hitl-reply] ${err.message}`);
      return { status: 406, payload: { error: 'Approval is no longer pending' } };
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
    if (updated.count !== 1) throw new ReplyRejected('Approval is no longer pending');
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
