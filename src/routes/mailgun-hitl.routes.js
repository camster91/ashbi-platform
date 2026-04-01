// Mailgun HITL reply webhook — parses Cameron's email replies back into Hub

import crypto from 'crypto';
import { stripQuotedReply, sendDiscordCamNotification } from '../utils/hitl-email.service.js';

export default async function mailgunHitlRoutes(fastify) {
  /**
   * POST /api/mailgun/hitl-reply
   * Mailgun forwards replies to reply+{notificationId}@ashbi.ca here
   */
  fastify.post('/hitl-reply', async (request, reply) => {
    // Always respond 200 to Mailgun first
    reply.status(200).send({ status: 'ok' });

    try {
      const body = request.body;

      // Validate Mailgun signature
      const signingKey = process.env.MAILGUN_SIGNING_KEY;
      if (signingKey) {
        const timestamp = body.timestamp;
        const token = body.token;
        const signature = body.signature;
        const expected = crypto
          .createHmac('sha256', signingKey)
          .update(timestamp + token)
          .digest('hex');
        if (expected !== signature) {
          fastify.log.warn('[hitl-reply] Invalid Mailgun signature — ignoring');
          return;
        }
      }

      const recipient = body.recipient || '';
      const bodyPlain = body['body-plain'] || '';
      const sender = body.sender || body.from || '';

      // Extract notificationId from reply+{id}@ashbi.ca
      const match = recipient.match(/reply\+([^@]+)@/);
      if (!match) {
        fastify.log.warn('[hitl-reply] Could not extract notificationId from recipient:', recipient);
        return;
      }
      const notificationId = match[1];

      // Strip quoted text — Cameron's actual reply is at the top
      const replyText = stripQuotedReply(bodyPlain);
      if (!replyText) {
        fastify.log.warn('[hitl-reply] Empty reply text after stripping quotes');
        return;
      }

      // Look up the notification
      const notification = await fastify.prisma.notification.findUnique({
        where: { id: notificationId },
      });

      if (!notification) {
        fastify.log.warn('[hitl-reply] Notification not found:', notificationId);
        return;
      }

      let notifData = {};
      try { notifData = notification.data ? JSON.parse(notification.data) : {}; } catch { /* ignore */ }

      const { type, refId } = notifData;

      // Handle based on entity type
      if (type === 'APPROVAL' && refId) {
        await handleApprovalReply(fastify, refId, replyText, notificationId);
      } else if (type === 'TASK' && refId) {
        await handleTaskReply(fastify, refId, replyText, notificationId);
      } else if (type === 'CUSTOM') {
        // Just attach as a note to the notification itself
        fastify.log.info('[hitl-reply] Custom HITL reply received:', replyText.substring(0, 100));
      }

      // Mark notification as read
      await fastify.prisma.notification.update({
        where: { id: notificationId },
        data: { read: true, readAt: new Date() },
      });

      // Discord confirmation to #cam
      const entityLabel = type === 'APPROVAL' ? 'approval' : type === 'TASK' ? 'task' : 'item';
      await sendDiscordCamNotification(
        `✉️ **Reply logged** from ${sender} — ${entityLabel} #${refId?.substring(0, 8) || 'N/A'}\n> ${replyText.substring(0, 200)}${replyText.length > 200 ? '…' : ''}`
      );
    } catch (err) {
      fastify.log.error('[hitl-reply] Processing error:', err.message);
    }
  });
}

async function handleApprovalReply(fastify, approvalId, replyText, notificationId) {
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

  if (status) {
    try {
      await fastify.prisma.approval.update({
        where: { id: approvalId },
        data: {
          status,
          reviewNote: reviewNote || null,
          reviewedBy: 'cameron@ashbi.ca',
          reviewedAt: new Date(),
        },
      });
      fastify.log.info(`[hitl-reply] Approval ${approvalId} marked ${status}`);
    } catch (err) {
      fastify.log.error('[hitl-reply] Failed to update approval:', err.message);
    }
  } else {
    // Not an approval decision — attach as a note on the approval entity
    fastify.log.info('[hitl-reply] Approval reply is not APPROVED/REJECTED, logging as note');
  }

  // Create note regardless
  try {
    const cameron = await fastify.prisma.user.findFirst({ where: { email: 'cameron@ashbi.ca' } });
    if (cameron) {
      await fastify.prisma.note.create({
        data: {
          title: 'Email Reply from Cameron',
          content: replyText,
          authorId: cameron.id,
        },
      });
    }
  } catch { /* notes are best-effort */ }
}

async function handleTaskReply(fastify, taskId, replyText, notificationId) {
  try {
    const task = await fastify.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return;

    // Update task status from WAITING_US or BLOCKED → IN_PROGRESS
    const newStatus = ['WAITING_US', 'BLOCKED'].includes(task.status) ? 'IN_PROGRESS' : task.status;
    if (newStatus !== task.status) {
      await fastify.prisma.task.update({
        where: { id: taskId },
        data: { status: newStatus },
      });
    }

    // Add a comment to the task
    const cameron = await fastify.prisma.user.findFirst({ where: { email: 'cameron@ashbi.ca' } });
    if (cameron) {
      await fastify.prisma.taskComment.create({
        data: {
          content: replyText,
          taskId,
          authorId: cameron.id,
        },
      });
    }

    fastify.log.info(`[hitl-reply] Task ${taskId} reply attached, status → ${newStatus}`);
  } catch (err) {
    fastify.log.error('[hitl-reply] Failed to handle task reply:', err.message);
  }
}
