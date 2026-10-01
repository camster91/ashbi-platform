// Mailgun HITL reply webhook — parses staff email replies back into Hub.
//
// A HITL email goes out with Reply-To reply+{notificationId}@<mailgun domain>;
// Mailgun's inbound route forwards the reply here as form fields. A reply is
// applied only when:
//   - the Mailgun signature is valid, its timestamp is inside the 15-minute
//     window and its token has not been used before (same checks as
//     POST /api/mailgun/events), and
//   - the From address is the Hub user the notification was created for, or
//     an active admin of that user's organization (case-insensitive).
// Knowing a notification id is therefore not enough to approve anything.
//
// Status codes follow Mailgun's retry rules: 406 is never retried (stale,
// replayed, unauthorized or unusable replies); 401 and 5xx are retried, and a
// processing failure releases the token so the retry is accepted.

import env from '../config/env.js';
import { releaseWebhookToken } from '../services/mailgun-delivery.service.js';
import {
  addMailgunFormParser,
  authenticateMailgunWebhook,
  MAILGUN_WEBHOOK_BODY_LIMIT,
  parseEmailAddress,
  readMailgunWebhookFields,
} from '../services/mailgun-webhook-request.js';
import { stripQuotedReply, sendDiscordCamNotification } from '../utils/hitl-email.service.js';

const STAFF_ROLES = new Set(['ADMIN', 'TEAM']);
const USER_FIELDS = { id: true, email: true, role: true, isActive: true, organizationId: true };

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

/**
 * Apply one authenticated reply. Returns the HTTP status and payload; throws
 * on a processing failure the caller should let Mailgun retry.
 */
async function applyHitlReply({ prisma, log, body }) {
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

  // The From header is what the person sees and what DMARC aligns; fall back
  // to the envelope sender only when no From header was forwarded.
  const fromAddress = parseEmailAddress(body.from) || (body.from ? null : parseEmailAddress(body.sender));
  const replier = await resolveAuthorizedReplier(prisma, notification, fromAddress);
  if (!replier) {
    log.warn({ notificationId }, '[hitl-reply] Reply from an address not authorized for this notification');
    return { status: 406, payload: { error: 'Sender is not authorized to answer this notification' } };
  }

  const { type, refId } = notificationData(notification);
  if (type === 'APPROVAL' && refId) {
    await handleApprovalReply({ prisma, log, approvalId: refId, replyText, replier });
  } else if (type === 'TASK' && refId) {
    await handleTaskReply({ prisma, log, taskId: refId, replyText, replier });
  } else if (type === 'CUSTOM') {
    log.info({ notificationId }, '[hitl-reply] Custom HITL reply received');
  }

  await prisma.notification.update({
    where: { id: notificationId },
    data: { read: true, readAt: new Date() },
  });

  // Discord confirmation to #cam
  const entityLabel = type === 'APPROVAL' ? 'approval' : type === 'TASK' ? 'task' : 'item';
  await sendDiscordCamNotification(
    `✉️ **Reply logged** from ${replier.email} — ${entityLabel} #${typeof refId === 'string' ? refId.substring(0, 8) : 'N/A'}\n> ${replyText.substring(0, 200)}${replyText.length > 200 ? '…' : ''}`
  );
  return { status: 200, payload: { status: 'ok' } };
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

    let body;
    try {
      body = await readMailgunWebhookFields(request);
    } catch (err) {
      request.log.warn({ err }, '[hitl-reply] Unreadable webhook body');
      return reply.status(400).send({ error: 'Unreadable webhook body' });
    }
    if (!body) return reply.status(406).send({ error: 'Webhook body must be Mailgun form fields' });

    const prisma = request.prisma || fastify.prisma;
    const auth = await authenticateMailgunWebhook({ fields: body, signingKey, prisma });
    if (!auth.ok) {
      request.log.warn({ reason: auth.reason }, '[hitl-reply] Rejected Mailgun webhook');
      return reply.status(auth.status).send({ error: auth.error });
    }

    try {
      const outcome = await applyHitlReply({ prisma, log: request.log, body });
      return reply.status(outcome.status).send(outcome.payload);
    } catch (err) {
      await releaseWebhookToken(prisma, auth.token);
      request.log.error({ err }, '[hitl-reply] Processing error');
      return reply.status(500).send({ error: 'Failed to process reply' });
    }
  });
}

async function handleApprovalReply({ prisma, log, approvalId, replyText, replier }) {
  const textUpper = replyText.toUpperCase().trim();
  let status = null;
  let reviewNote = replyText;

  if (textUpper.startsWith('APPROVED')) {
    status = 'APPROVED';
    reviewNote = replyText.replace(/^APPROVED[\s\-–—:.]*/i, '').trim() || null;
  } else if (textUpper.startsWith('REJECTED') || textUpper.startsWith('REJECT')) {
    status = 'REJECTED';
    reviewNote = replyText.replace(/^REJECTED?[\s\-–—:.]*/i, '').trim() || null;
  }

  const approval = await prisma.approval.findUnique({ where: { id: approvalId } });
  if (!approval) {
    log.warn({ approvalId }, '[hitl-reply] Approval not found');
    return;
  }

  if (status) {
    await prisma.approval.update({
      where: { id: approvalId },
      data: {
        status,
        reviewNote: reviewNote || null,
        reviewedBy: replier.email,
        reviewedAt: new Date(),
      },
    });
    log.info({ approvalId, status }, '[hitl-reply] Approval decided by email reply');
  } else {
    log.info({ approvalId }, '[hitl-reply] Approval reply is not APPROVED/REJECTED, logging as note');
  }

  // Keep the reply as a project note (notes belong to a project).
  if (approval.projectId) {
    try {
      await prisma.note.create({
        data: {
          title: 'Email reply on approval',
          content: replyText,
          projectId: approval.projectId,
          authorId: replier.id,
        },
      });
    } catch (err) {
      log.warn({ err }, '[hitl-reply] Could not store the reply as a note');
    }
  }
}

async function handleTaskReply({ prisma, log, taskId, replyText, replier }) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;

  // Update task status from WAITING_US or BLOCKED → IN_PROGRESS
  const newStatus = ['WAITING_US', 'BLOCKED'].includes(task.status) ? 'IN_PROGRESS' : task.status;
  if (newStatus !== task.status) {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: newStatus },
    });
  }

  try {
    await prisma.taskComment.create({
      data: {
        content: replyText,
        taskId,
        authorId: replier.id,
      },
    });
  } catch (err) {
    log.warn({ err }, '[hitl-reply] Could not store the reply as a task comment');
  }

  log.info({ taskId, status: newStatus }, '[hitl-reply] Task reply attached');
}
