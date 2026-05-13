// Cold Email Service — Sequence engine + Mailgun integration
// Handles: sending sequence emails, tracking events, processing scheduled sends
// Wires email.service.js (Mailgun) into the cold email pipeline.

import { sendMailgunEmail } from './email.service.js';

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'ashbi.ca';
const FROM_COLD_EMAIL = `Cameron Ashley <cameron@${MAILGUN_DOMAIN}>`;

/**
 * Personalize email content by replacing {{variable}} placeholders.
 * Supports: {{name}}, {{company}}, {{firstName}}, {{industry}}, {{painPoint}}
 */
function personalizeEmail(body, subject, prospect) {
  const firstName = (prospect.name || '').split(' ')[0];
  const vars = {
    name: prospect.name || '',
    firstName,
    company: prospect.company || 'your company',
    industry: prospect.industry || 'your industry',
    painPoint: prospect.painPoint || '',
  };

  let personalizedSubject = subject;
  let personalizedBody = body;
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
    personalizedSubject = personalizedSubject.replace(re, value);
    personalizedBody = personalizedBody.replace(re, value);
  }

  return { subject: personalizedSubject, body: personalizedBody };
}

/**
 * Send a specific email step to a prospect via Mailgun.
 * @param {object} prospect - ColdEmailProspect record
 * @param {object} sequence - ColdEmailSequence record (with parsed emails)
 * @param {number} stepIndex - Which email in the sequence to send (0-indexed)
 * @param {object} prisma - Prisma client instance
 * @returns {Promise<{ok: boolean, mailgunId?: string, error?: string}>}
 */
export async function sendSequenceEmailToProspect(prospect, sequence, stepIndex, prisma) {
  const emails = typeof sequence.emails === 'string'
    ? JSON.parse(sequence.emails)
    : sequence.emails;

  if (!emails || stepIndex >= emails.length) {
    return { ok: false, error: `Step ${stepIndex} out of range (sequence has ${emails?.length || 0} emails)` };
  }

  const email = emails[stepIndex];
  const { subject, body } = personalizeEmail(email.body, email.subject, prospect);

  // Build HTML email body
  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <div style="margin-bottom: 24px;">
    <p style="font-size: 14px; color: #888; margin: 0 0 4px 0;">Ashbi Design</p>
  </div>
  <div style="font-size: 16px; line-height: 1.6; white-space: pre-wrap;">${body}</div>
  <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #999;">
    <p style="margin: 0;">Cameron Ashley</p>
    <p style="margin: 4px 0 0 0;">Founder, Ashbi Design</p>
    <p style="margin: 4px 0 0 0;">ashbi.ca</p>
    <p style="margin: 16px 0 0 0; color: #bbb;">If you'd prefer not to receive these emails, you can <a href="%mailing_list_unsubscribe_url%" style="color: #bbb;">unsubscribe</a>.</p>
  </div>
</body>
</html>`;

  // Add tracking via Mailgun's o:tracking parameters
  // These enable open/click tracking in Mailgun
  const result = await sendMailgunEmail({
    to: prospect.email,
    subject,
    html: htmlBody,
    from: FROM_COLD_EMAIL,
    replyTo: `cameron@${MAILGUN_DOMAIN}`,
    text: body,
  });

  // Record the event
  if (result.ok) {
    try {
      await prisma.coldEmailEvent.create({
        data: {
          prospectId: prospect.id,
          sequenceId: sequence.id,
          type: 'SENT',
          emailStep: stepIndex,
          mailgunId: result.id || null,
        },
      });

      // Update prospect tracking
      await prisma.coldEmailProspect.update({
        where: { id: prospect.id },
        data: {
          lastEmailStep: stepIndex,
          lastEmailedAt: new Date(),
          emailCount: { increment: 1 },
          status: prospect.status === 'NEW' ? 'CONTACTED' : prospect.status,
        },
      });

      // Update sequence stats
      await prisma.coldEmailSequence.update({
        where: { id: sequence.id },
        data: {
          totalSent: { increment: 1 },
        },
      });
    } catch (err) {
      console.error('[cold-email] Failed to record send event:', err.message);
    }
  }

  return result;
}

/**
 * Process all due sends across active sequences.
 * Call this from a cron job or queue worker.
 * @param {object} prisma - Prisma client instance
 * @returns {Promise<{processed: number, sent: number, errors: number}>}
 */
export async function processScheduledSends(prisma) {
  const now = new Date();
  const stats = { processed: 0, sent: 0, errors: 0 };

  // Find all prospects due for sending
  const dueProspects = await prisma.coldEmailProspect.findMany({
    where: {
      nextEmailAt: { lte: now },
      status: { notIn: ['UNSUBSCRIBED', 'CONVERTED'] },
      sequence: {
        status: 'ACTIVE',
      },
    },
    include: {
      sequence: true,
    },
    orderBy: { nextEmailAt: 'asc' },
    take: 50, // Batch size — prevent overwhelming Mailgun
  });

  for (const prospect of dueProspects) {
    stats.processed++;
    const sequence = prospect.sequence;
    if (!sequence) continue;

    const emails = typeof sequence.emails === 'string'
      ? JSON.parse(sequence.emails)
      : sequence.emails;

    const nextStep = (prospect.lastEmailStep ?? -1) + 1;

    // If we've sent all emails, mark as completed
    if (nextStep >= emails.length) {
      try {
        // Check if auto-follow-up should trigger (no reply within 5 days of last email)
        const lastSent = prospect.lastEmailedAt;
        const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
        const hasReply = prospect.status === 'REPLIED';

        if (!hasReply && lastSent && lastSent < fiveDaysAgo) {
          // Auto-follow-up: send a final reminder
          const followUpResult = await sendMailgunEmail({
            to: prospect.email,
            subject: `Quick follow-up, ${prospect.name.split(' ')[0]}`,
            html: `<div style="font-family: sans-serif; max-width: 600px; padding: 20px;">
<p>Hi ${prospect.name.split(' ')[0]},</p>
<p>Just wanted to circle back one last time — I know inboxes get busy.</p>
<p>If Ashbi Design can help with your ${prospect.painPoint || 'branding and design needs'}, I'd love to chat. No pressure either way.</p>
<p>Best,<br>Cameron</p>
</div>`,
            from: FROM_COLD_EMAIL,
            text: `Hi ${prospect.name.split(' ')[0]},\n\nJust wanted to circle back one last time — I know inboxes get busy.\n\nIf Ashbi Design can help with your ${prospect.painPoint || 'branding and design needs'}, I'd love to chat. No pressure either way.\n\nBest,\nCameron`,
          });
          if (followUpResult.ok) {
            stats.sent++;
            await prisma.coldEmailEvent.create({
              data: {
                prospectId: prospect.id,
                sequenceId: sequence.id,
                type: 'SENT',
                emailStep: -1, // -1 = follow-up (not part of sequence)
                mailgunId: followUpResult.id || null,
              },
            });
          }
        }

        // If all prospects are done, complete the sequence
        const remainingProspects = await prisma.coldEmailProspect.count({
          where: {
            sequenceId: sequence.id,
            status: { notIn: ['UNSUBSCRIBED', 'CONVERTED'] },
            nextEmailAt: { not: null },
          },
        });

        if (remainingProspects === 0) {
          await prisma.coldEmailSequence.update({
            where: { id: sequence.id },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          });
        }
      } catch (err) {
        stats.errors++;
        console.error('[cold-email] Auto-follow-up error:', err.message);
      }
      continue;
    }

    // Send the next email in the sequence
    try {
      const email = emails[nextStep];
      const result = await sendSequenceEmailToProspect(prospect, sequence, nextStep, prisma);

      if (result.ok) {
        stats.sent++;
        // Schedule next send
        const delayMs = (email.delayDays || 3) * 24 * 60 * 60 * 1000;
        const nextEmailAt = new Date(now.getTime() + delayMs);

        await prisma.coldEmailProspect.update({
          where: { id: prospect.id },
          data: { nextEmailAt },
        });
      } else {
        stats.errors++;
      }
    } catch (err) {
      stats.errors++;
      console.error('[cold-email] Send error for prospect', prospect.id, ':', err.message);
    }
  }

  return stats;
}

/**
 * Activate a sequence: schedule all prospects for immediate send.
 * @param {string} sequenceId
 * @param {object} prisma
 */
export async function activateSequence(sequenceId, prisma) {
  const sequence = await prisma.coldEmailSequence.findUnique({
    where: { id: sequenceId },
    include: { _count: { select: { prospects: true } } },
  });

  if (!sequence) throw new Error('Sequence not found');
  if (sequence._count.prospects === 0) throw new Error('No prospects in sequence');

  const now = new Date();

  // Set first email to send immediately for all prospects
  await prisma.coldEmailProspect.updateMany({
    where: { sequenceId, status: { notIn: ['UNSUBSCRIBED'] } },
    data: {
      lastEmailStep: -1, // -1 means nothing sent yet
      nextEmailAt: now,
    },
  });

  // Update sequence
  await prisma.coldEmailSequence.update({
    where: { id: sequenceId },
    data: {
      status: 'ACTIVE',
      startedAt: now,
      totalProspects: sequence._count.prospects,
      totalSent: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalReplied: 0,
      totalBounced: 0,
    },
  });

  return sequence;
}

/**
 * Process a Mailgun tracking webhook event.
 * Handles: opened, clicked, bounced, complained, unsubscribed
 * @param {object} eventData - Mailgun event payload
 * @param {object} prisma
 */
export async function processMailgunTrackingEvent(eventData, prisma) {
  const event = eventData.event; // 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed'
  const mailgunMessageId = eventData.message?.headers?.['message-id'] || null;

  // Try to find the matching ColdEmailEvent by mailgunId
  let coldEmailEvent = null;
  if (eventData.message?.headers?.['message-id']) {
    coldEmailEvent = await prisma.coldEmailEvent.findFirst({
      where: { mailgunId: mailgunMessageId },
    });
  }

  if (!coldEmailEvent) {
    // Try to find by recipient email + recent sent event
    const recipientEmail = eventData.recipient || '';
    if (recipientEmail) {
      const prospect = await prisma.coldEmailProspect.findFirst({
        where: { email: recipientEmail },
        orderBy: { lastEmailedAt: 'desc' },
      });
      if (prospect) {
        coldEmailEvent = await prisma.coldEmailEvent.findFirst({
          where: { prospectId: prospect.id, type: 'SENT' },
          orderBy: { createdAt: 'desc' },
        });
      }
    }
  }

  if (!coldEmailEvent) {
    console.warn('[cold-email] No matching event found for Mailgun tracking:', event, mailgunMessageId);
    return { tracked: false, reason: 'no matching event' };
  }

  // Map Mailgun event to our types
  const eventTypeMap = {
    opened: 'OPENED',
    clicked: 'CLICKED',
    bounced: 'BOUNCED',
    complained: 'UNSUBSCRIBED',
    unsubscribed: 'UNSUBSCRIBED',
  };

  const type = eventTypeMap[event];
  if (!type) {
    console.warn('[cold-email] Unhandled Mailgun event type:', event);
    return { tracked: false, reason: 'unhandled event type' };
  }

  // Create tracking event
  await prisma.coldEmailEvent.create({
    data: {
      prospectId: coldEmailEvent.prospectId,
      sequenceId: coldEmailEvent.sequenceId,
      type,
      emailStep: coldEmailEvent.emailStep,
      mailgunId: mailgunMessageId,
      mailgunEvent: event,
      metadata: JSON.stringify(eventData),
    },
  });

  // Update prospect
  const prospectUpdate = {};
  if (type === 'OPENED') prospectUpdate.openedAt = new Date();
  if (type === 'CLICKED') prospectUpdate.clickedAt = new Date();
  if (type === 'BOUNCED') {
    prospectUpdate.bouncedAt = new Date();
    prospectUpdate.nextEmailAt = null; // Stop sending to bounced
  }
  if (type === 'UNSUBSCRIBED') {
    prospectUpdate.status = 'UNSUBSCRIBED';
    prospectUpdate.nextEmailAt = null;
  }

  if (Object.keys(prospectUpdate).length > 0) {
    await prisma.coldEmailProspect.update({
      where: { id: coldEmailEvent.prospectId },
      data: prospectUpdate,
    });
  }

  // Update sequence stats
  const statField = {
    OPENED: 'totalOpened',
    CLICKED: 'totalClicked',
    BOUNCED: 'totalBounced',
    UNSUBSCRIBED: 'totalBounced', // Count unsubscribes in bounced for now
  }[type];

  if (statField && coldEmailEvent.sequenceId) {
    await prisma.coldEmailSequence.update({
      where: { id: coldEmailEvent.sequenceId },
      data: { [statField]: { increment: 1 } },
    });
  }

  return { tracked: true, type, prospectId: coldEmailEvent.prospectId };
}

/**
 * Get campaign stats for a sequence.
 * @param {string} sequenceId
 * @param {object} prisma
 */
export async function getSequenceStats(sequenceId, prisma) {
  const sequence = await prisma.coldEmailSequence.findUnique({
    where: { id: sequenceId },
    include: {
      _count: { select: { prospects: true, events: true } },
    },
  });

  if (!sequence) throw new Error('Sequence not found');

  // Get per-prospect status breakdown
  const statusCounts = await prisma.coldEmailProspect.groupBy({
    by: ['status'],
    where: { sequenceId },
    _count: true,
  });

  const statusBreakdown = {};
  for (const s of statusCounts) {
    statusBreakdown[s.status] = s._count;
  }

  return {
    sequence: {
      id: sequence.id,
      name: sequence.name,
      status: sequence.status,
      serviceType: sequence.serviceType,
      targetIndustry: sequence.targetIndustry,
    },
    stats: {
      totalProspects: sequence.totalProspects || sequence._count.prospects,
      totalSent: sequence.totalSent,
      totalOpened: sequence.totalOpened,
      totalClicked: sequence.totalClicked,
      totalReplied: sequence.totalReplied,
      totalBounced: sequence.totalBounced,
    },
    rates: {
      openRate: sequence.totalSent > 0
        ? Math.round((sequence.totalOpened / sequence.totalSent) * 100)
        : 0,
      clickRate: sequence.totalSent > 0
        ? Math.round((sequence.totalClicked / sequence.totalSent) * 100)
        : 0,
      bounceRate: sequence.totalSent > 0
        ? Math.round((sequence.totalBounced / sequence.totalSent) * 100)
        : 0,
    },
    statusBreakdown,
    recentEvents: await prisma.coldEmailEvent.findMany({
      where: { sequenceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        prospect: { select: { name: true, email: true } },
      },
    }),
  };
}
