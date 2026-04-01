// HITL Email Service — sends Mailgun emails for Human-in-the-Loop notifications

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import Handlebars from 'handlebars';

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

const DISCORD_CAM_WEBHOOK = 'https://discord.com/api/webhooks/1484535953912496270/ytaPqJI6KyuYwEjnIAry4TczQpYitj4kXlBcaoNeiMpAeyLzibO4wHoxR8XjF49OkGuR';

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
export async function sendTaskHITLEmail({ notificationId, task, project, context, urgency = 'NORMAL', replyInstructions, assigneeAgent }) {
  const replyTo = `reply+${notificationId}@${MAILGUN_DOMAIN}`;
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

  return sendMailgunEmail({
    to: 'cameron@ashbi.ca',
    replyTo,
    subject,
    html,
  });
}

/**
 * Send a HITL approval notification email
 */
export async function sendApprovalHITLEmail({ notificationId, approval }) {
  const replyTo = `reply+${notificationId}@${MAILGUN_DOMAIN}`;
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

  return sendMailgunEmail({
    to: 'cameron@ashbi.ca',
    replyTo,
    subject,
    html,
  });
}

/**
 * Send a HITL blocked task notification email
 */
export async function sendBlockedHITLEmail({ notificationId, task, project, blockedReason }) {
  const replyTo = `reply+${notificationId}@${MAILGUN_DOMAIN}`;

  const html = await loadTemplate('hitl-blocked.html', {
    title: task.title,
    projectName: project?.name || 'Internal Ops',
    blockedReason: blockedReason || task.blockedBy || 'No reason specified',
    taskId: task.id,
  });

  const subject = `🚫 Blocked: ${task.title} — Ashbi Hub`;

  return sendMailgunEmail({
    to: 'cameron@ashbi.ca',
    replyTo,
    subject,
    html,
  });
}

/**
 * Send Discord notification to #cam channel
 */
export async function sendDiscordCamNotification(message) {
  try {
    const res = await fetch(DISCORD_CAM_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error('[discord] POST failed:', res.status);
    }
  } catch (err) {
    console.error('[discord] Error:', err.message);
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
