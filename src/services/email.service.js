// Email Service — Ashbi-branded client emails via Mailgun
// Reads HTML templates from src/emails/, replaces {{variable}} placeholders, and sends via Mailgun API.
// Falls back to console.log when MAILGUN_API_KEY is not configured.

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, '..', 'emails');

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'ashbi.ca';
const MAILGUN_API_URL = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;

const FROM_DEFAULT = `Ashbi <hub@${MAILGUN_DOMAIN}>`;

/**
 * Replace {{variable}} placeholders in an HTML string with actual values.
 */
function replaceVariables(html, variables = {}) {
  return html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : match;
  });
}

/**
 * Load an HTML email template and replace {{variable}} placeholders.
 * @param {string} templateName - Filename in src/emails/ (e.g. 'welcome.html')
 * @param {object} variables - Key-value pairs to substitute
 * @returns {Promise<string>} Rendered HTML
 */
export async function loadTemplate(templateName, variables = {}) {
  const filePath = path.join(TEMPLATE_DIR, templateName);
  const html = await readFile(filePath, 'utf-8');
  return replaceVariables(html, variables);
}

/**
 * Send an email via Mailgun.
 * @param {object} opts
 * @param {string} opts.to       - Recipient email
 * @param {string} opts.subject  - Email subject line
 * @param {string} opts.html     - Rendered HTML body
 * @param {string} [opts.from]   - Sender (defaults to Ashbi <hub@ashbi.ca>)
 * @param {string} [opts.replyTo]- Reply-To header
 * @param {string} [opts.text]   - Plain-text fallback
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
export async function sendMailgunEmail({ to, subject, html, from, replyTo, text }) {
  if (!MAILGUN_API_KEY) {
    console.warn('[email] MAILGUN_API_KEY not set — skipping email send');
    console.log('[email] To:', to, '| Subject:', subject);
    return { ok: false, error: 'MAILGUN_API_KEY not set' };
  }

  const formData = new URLSearchParams();
  formData.append('from', from || FROM_DEFAULT);
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
      console.error('[email] Mailgun error:', res.status, data);
      return { ok: false, error: data.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[email] Send error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * High-level email sender: loads template, replaces variables, and sends.
 *
 * @param {object} opts
 * @param {string} opts.to         - Recipient email address
 * @param {string} opts.subject    - Email subject line
 * @param {string} opts.template   - Template filename (e.g. 'welcome.html')
 * @param {object} opts.variables  - Key-value pairs for {{variable}} replacement
 * @param {string} [opts.from]    - Sender email (defaults to Ashbi <hub@ashbi.ca>)
 * @param {string} [opts.replyTo]  - Reply-To header
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
export async function sendEmail({ to, subject, template, variables = {}, from, replyTo }) {
  const html = await loadTemplate(template, variables);
  return sendMailgunEmail({ to, subject, html, from, replyTo });
}

/**
 * Convenience helpers for each template type.
 * These wrap sendEmail with the correct template filename.
 */

export async function sendWelcomeEmail({ to, clientName, portalLink, senderName, from, replyTo }) {
  return sendEmail({
    to,
    subject: `Welcome to Ashbi, ${clientName}`,
    template: 'welcome.html',
    variables: { clientName, portalLink, senderName },
    from,
    replyTo,
  });
}

export async function sendInvoiceCreatedEmail({ to, clientName, invoiceNumber, amount, dueDate, payLink, from, replyTo }) {
  return sendEmail({
    to,
    subject: `Invoice ${invoiceNumber} from Ashbi`,
    template: 'invoice-created.html',
    variables: { clientName, invoiceNumber, amount, dueDate, payLink },
    from,
    replyTo,
  });
}

export async function sendInvoiceOverdueEmail({ to, clientName, invoiceNumber, amount, daysOverdue, payLink, from, replyTo }) {
  return sendEmail({
    to,
    subject: `Overdue: Invoice ${invoiceNumber}`,
    template: 'invoice-overdue.html',
    variables: { clientName, invoiceNumber, amount, daysOverdue, payLink },
    from,
    replyTo,
  });
}

export async function sendInvoicePaidEmail({ to, clientName, invoiceNumber, amount, paidDate, from, replyTo }) {
  return sendEmail({
    to,
    subject: `Payment Confirmed — Invoice ${invoiceNumber}`,
    template: 'invoice-paid.html',
    variables: { clientName, invoiceNumber, amount, paidDate },
    from,
    replyTo,
  });
}

export async function sendProposalSentEmail({ to, clientName, proposalTitle, amount, viewLink, expiresDate, from, replyTo }) {
  return sendEmail({
    to,
    subject: `Proposal: ${proposalTitle}`,
    template: 'proposal-sent.html',
    variables: { clientName, proposalTitle, amount, viewLink, expiresDate },
    from,
    replyTo,
  });
}

export async function sendContractSignEmail({ to, clientName, contractTitle, signLink, expiresDate, from, replyTo }) {
  return sendEmail({
    to,
    subject: `Contract Ready to Sign: ${contractTitle}`,
    template: 'contract-sign.html',
    variables: { clientName, contractTitle, signLink, expiresDate },
    from,
    replyTo,
  });
}

export async function sendProjectUpdateEmail({ to, clientName, projectName, oldStatus, newStatus, portalLink, from, replyTo }) {
  return sendEmail({
    to,
    subject: `Project Update: ${projectName} — ${newStatus}`,
    template: 'project-update.html',
    variables: { clientName, projectName, oldStatus, newStatus, portalLink },
    from,
    replyTo,
  });
}

export async function sendMessageNewEmail({ to, clientName, senderName, messagePreview, portalLink, from, replyTo }) {
  // Compute sender initial for the avatar bubble
  const senderInitial = (senderName || '?').charAt(0).toUpperCase();
  return sendEmail({
    to,
    subject: `New message from ${senderName}`,
    template: 'message-new.html',
    variables: { clientName, senderName, senderInitial, messagePreview, portalLink },
    from,
    replyTo,
  });
}

export default sendEmail;