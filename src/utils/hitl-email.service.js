// HITL Email Service — sends Mailgun emails for Human-in-the-Loop notifications

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import Handlebars from 'handlebars';
import env from '../config/env.js';
import { hitlReplyAddress } from '../services/hitl-reply-address.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, 'email-templates');

// Register currency helper: {{currency value}} → $1,200 CAD
Handlebars.registerHelper('currency', (value) => {
  const n = parseFloat(value) || 0;
  return new Handlebars.SafeString(
    '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' CAD'
  );
});

// Register lowercase helper
Handlebars.registerHelper('lower', (str) => (str || '').toLowerCase());

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'ashbi.ca';
const MAILGUN_API_URL = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;

const DISCORD_CAM_WEBHOOK = process.env.DISCORD_CAM_WEBHOOK_URL;

/**
 * The configured HITL approver address (HITL_APPROVER_EMAIL), or null. Read at
 * call time so configuration changes and tests apply without a reload.
 */
export function hitlApproverEmail() {
  return env.hitlApproverEmail || null;
}

/**
 * The Hub user who receives HITL notifications: the active ADMIN or TEAM user
 * whose email is HITL_APPROVER_EMAIL (case-insensitive). Returns null, with a
 * warning, when the address is unset or matches no such user; callers then
 * skip the HITL notification and email instead of picking someone else.
 */
export async function resolveHitlApprover(prisma, log = console) {
  const email = hitlApproverEmail();
  if (!email) {
    log.warn('[hitl-email] HITL_APPROVER_EMAIL not set — skipping HITL notification');
    return null;
  }
  const user = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
      isActive: true,
      role: { in: ['ADMIN', 'TEAM'] },
    },
    select: { id: true, email: true, organizationId: true },
  });
  if (!user) {
    log.warn('[hitl-email] HITL_APPROVER_EMAIL does not match an active ADMIN/TEAM user — skipping HITL notification');
    return null;
  }
  return user;
}

/** A notification's JSON data (stored as a JSON string or an object). */
export function parseNotificationData(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** "<id@host>" for any Mailgun message id, or null. */
export function normalizeHitlMessageId(messageId) {
  if (typeof messageId !== 'string') return null;
  const bare = messageId.trim().replace(/^<|>$/g, '').trim();
  return bare && !/[\s<>]/.test(bare) ? `<${bare}>` : null;
}

/**
 * Store the outbound Message-Id on the HITL notification's data, so a reply
 * is accepted only when its In-Reply-To / References names that email.
 */
export async function recordHitlMessageId(prisma, notificationId, messageId) {
  const id = normalizeHitlMessageId(messageId);
  if (!id) return false;
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification) return false;
  const data = { ...parseNotificationData(notification.data), hitlMessageId: id };
  await prisma.notification.update({ where: { id: notificationId }, data: { data: JSON.stringify(data) } });
  return true;
}

/**
 * Send a HITL email to the configured approver, or skip when none is set.
 * The Reply-To is the notification's signed reply address; with `prisma`,
 * the sent Message-Id is recorded on the notification (without it, replies
 * to this email are refused).
 * @param {{ notificationId: string, prisma?: any, subject: string, html: string, text?: string }} message
 */
export async function sendToHitlApprover({ notificationId, prisma, ...message }, { send = sendMailgunEmail } = {}) {
  const to = hitlApproverEmail();
  if (!to) {
    console.warn('[hitl-email] HITL_APPROVER_EMAIL not set — skipping HITL email');
    return { ok: false, error: 'HITL_APPROVER_EMAIL not set' };
  }
  const replyTo = hitlReplyAddress(notificationId, env.mailgunDomain || MAILGUN_DOMAIN);
  const result = await send({ ...message, to, replyTo });
  if (result?.ok && prisma) {
    try {
      result.recorded = await recordHitlMessageId(prisma, notificationId, result.id);
    } catch (err) {
      console.error('[hitl-email] Could not record the HITL Message-Id:', err.message);
      result.recorded = false;
    }
  }
  return result;
}

/**
 * Load and compile an HTML email template using Handlebars
 */
async function loadTemplate(templateName, vars = {}) {
  const filePath = path.join(TEMPLATE_DIR, templateName);
  const source = await readFile(filePath, 'utf-8');
  const template = Handlebars.compile(source);
  return template(vars);
}

/**
 * Send email via Mailgun
 */
export async function sendMailgunEmail({ to, from = 'hub@ashbi.ca', replyTo, subject, html, text }) {
  if (!MAILGUN_API_KEY) {
    console.warn('[hitl-email] MAILGUN_API_KEY not set — skipping email send');
    return { ok: false, error: 'MAILGUN_API_KEY not set' };
  }

  const formData = new URLSearchParams();
  formData.append('from', `Ashbi Hub <${from}>`);
  formData.append('to', to);
  if (replyTo) formData.append('h:Reply-To', replyTo);
  formData.append('subject', subject);
  formData.append('html', html);
  if (text) formData.append('text', text);

  try {
    const res = await fetch(MAILGUN_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[hitl-email] Mailgun error:', res.status, data);
      return { ok: false, error: data.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[hitl-email] Send error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Send a HITL task notification email
 */
export async function sendTaskHITLEmail({ notificationId, prisma, task, project, context, urgency = 'NORMAL', replyInstructions, assigneeAgent }) {
  const urgencyLabel = urgency === 'CRITICAL' ? '🔴 CRITICAL' : urgency === 'HIGH' ? '🟠 HIGH' : urgency;

  const html = await loadTemplate('hitl-task.html', {
    title: task.title,
    projectName: project?.name || 'Internal Ops',
    assigneeAgent: assigneeAgent || 'agent',
    context: context || 'Agent input required.',
    replyInstructions: replyInstructions || 'Reply to this email with your response.',
    taskId: task.id,
    urgency: urgencyLabel,
  });

  const subject = `🔔 ${urgency === 'CRITICAL' || urgency === 'HIGH' ? '[ACTION NEEDED] ' : ''}${task.title} — Ashbi Hub`;

  return sendToHitlApprover({
    notificationId,
    prisma,
    subject,
    html,
  });
}

/**
 * Send a HITL approval notification email
 */
export async function sendApprovalHITLEmail({ notificationId, prisma, approval }) {
  let content = '';
  try {
    content = typeof approval.content === 'string' ? approval.content : JSON.stringify(approval.content, null, 2);
  } catch { content = String(approval.content); }

  const html = await loadTemplate('hitl-approval.html', {
    title: approval.title,
    type: approval.type,
    clientName: approval.clientName || 'N/A',
    createdBy: approval.createdBy || 'agent',
    contentPreview: content.substring(0, 500),
    approvalId: approval.id,
  });

  const subject = `✅ Approval Needed: ${approval.title} — Ashbi Hub`;

  return sendToHitlApprover({
    notificationId,
    prisma,
    subject,
    html,
  });
}

/**
 * Send a HITL blocked task notification email
 */
export async function sendBlockedHITLEmail({ notificationId, prisma, task, project, blockedReason }) {

  const html = await loadTemplate('hitl-blocked.html', {
    title: task.title,
    projectName: project?.name || 'Internal Ops',
    blockedReason: blockedReason || task.blockedBy || 'No reason specified',
    taskId: task.id,
  });

  const subject = `🚫 Blocked: ${task.title} — Ashbi Hub`;

  return sendToHitlApprover({
    notificationId,
    prisma,
    subject,
    html,
  });
}

/**
 * Send Discord notification to #cam channel
 */
export async function sendDiscordCamNotification(message) {
  if (!DISCORD_CAM_WEBHOOK) {
    console.warn('[discord] DISCORD_CAM_WEBHOOK_URL not set; skipping notification');
    return { ok: false, error: 'DISCORD_CAM_WEBHOOK_URL not set' };
  }

  try {
    const res = await fetch(DISCORD_CAM_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error('[discord] POST failed:', res.status);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('[discord] Error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Strip quoted email reply text (lines starting with > or after --)
 */
export function stripQuotedReply(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const stripped = [];
  for (const line of lines) {
    // Stop at common reply delimiters
    if (/^--\s*$/.test(line.trim())) break;
    if (/^On .+ wrote:$/.test(line.trim())) break;
    if (line.startsWith('>')) continue;
    stripped.push(line);
  }
  return stripped.join('\n').trim();
}
