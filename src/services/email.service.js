// Email Service — client emails via Mailgun, branded with the sending
// organization's company name and website (src/services/branding.service.js).
// Reads HTML templates from src/emails/, replaces {{variable}} placeholders, and sends via Mailgun API.
// Falls back to console.log when MAILGUN_API_KEY is not configured.

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import { mailgunTrackingFields } from './mailgun-delivery.service.js';
import { formatMoney } from '../utils/money.js';
import { renderEmailTheme } from '../emails/theme.js';
import { brandedSender, sanitizeHeader, systemSender } from './branding.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, '..', 'emails');

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'ashbi.ca';
const MAILGUN_API_URL = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;

// Mail with no organization behind it is sent in the product's name.
const FROM_DEFAULT = systemSender(MAILGUN_DOMAIN, 'hub');

/**
 * The From header for an organization's client email: its company name at
 * the configured address (the product name when it has none).
 * @param {{ companyName?: string } | null | undefined} branding
 */
export function senderFor(branding) {
  return branding?.companyName ? brandedSender(branding, MAILGUN_DOMAIN, 'hub') : FROM_DEFAULT;
}

/** An http(s) website URL for a brand's website setting, or ''. */
function websiteUrl(website) {
  const value = String(website || '').trim();
  if (!value) return '';
  const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname ? parsed.href : '';
  } catch {
    return '';
  }
}

/**
 * The brand placeholders every client email template uses: {{companyName}},
 * {{companyWebsite}} and {{companyWebsiteLabel}} (empty when unknown; the
 * templates hide those parts with {{#name}}...{{/name}} sections).
 * @param {{ companyName?: string, website?: string | null } | null | undefined} branding
 */
export function brandEmailVariables(branding) {
  const companyWebsite = websiteUrl(branding?.website);
  return {
    companyName: String(branding?.companyName || '').trim(),
    companyWebsite,
    companyWebsiteLabel: companyWebsite ? companyWebsite.replace(/^https?:\/\//i, '').replace(/\/$/, '') : '',
  };
}

/** " from <company>" for a subject line, or '' without a company name. */
function fromCompany(branding) {
  const name = String(branding?.companyName || '').trim();
  return name ? ` from ${name}` : '';
}

/**
 * Replace {{variable}} placeholders in an HTML string with actual values.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * {{#name}}...{{/name}} keeps its content only when `name` has a non-empty
 * value (no nesting), so optional brand parts disappear cleanly.
 */
export function renderSections(html, variables = {}) {
  return html.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, key, inner) => {
    const value = variables[key];
    return value !== undefined && value !== null && String(value).trim() !== '' ? inner : '';
  });
}

export function replaceVariables(html, variables = {}) {
  return renderSections(html, variables).replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? escapeHtml(variables[key]) : match;
  });
}

/**
 * Load an HTML email template, fill its {{theme.*}} colours from the shared
 * email theme (src/emails/theme.js) and replace {{variable}} placeholders.
 * @param {string} templateName - Filename in src/emails/ (e.g. 'welcome.html')
 * @param {object} variables - Key-value pairs to substitute
 * @returns {Promise<string>} Rendered HTML
 */
export async function loadTemplate(templateName, variables = {}) {
  const filePath = path.join(TEMPLATE_DIR, templateName);
  const html = await readFile(filePath, 'utf-8');
  // Theme colours first, so user-supplied values can never inject a theme token.
  return replaceVariables(renderEmailTheme(html), variables);
}

/**
 * Send an email via Mailgun.
 * @param {object} opts
 * @param {string} opts.to       - Recipient email
 * @param {string} opts.subject  - Email subject line
 * @param {string} opts.html     - Rendered HTML body
 * @param {string} [opts.from]   - Sender (defaults to the product-named hub@ address)
 * @param {string} [opts.replyTo]- Reply-To header
 * @param {string} [opts.text]   - Plain-text fallback
 * @param {{documentType: string, documentId: string}} [opts.tracking] - Adds Mailgun `v:`
 *   custom variables so delivery events can be correlated back to the document
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
export async function sendMailgunEmail({ to, subject, html, from, replyTo, text, tracking }) {
  if (!MAILGUN_API_KEY) {
    console.warn('[email] MAILGUN_API_KEY not set — skipping email send');
    console.log('[email] To:', to, '| Subject:', subject);
    return { ok: false, error: 'MAILGUN_API_KEY not set' };
  }

  const formData = new URLSearchParams();
  formData.append('from', sanitizeHeader(from || FROM_DEFAULT));
  formData.append('to', to);
  if (replyTo) formData.append('h:Reply-To', sanitizeHeader(replyTo));
  formData.append('subject', sanitizeHeader(subject));
  formData.append('html', html);
  if (text) formData.append('text', text);
  for (const [key, value] of Object.entries(mailgunTrackingFields(tracking))) formData.append(key, value);

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
 * @param {string} [opts.from]    - Sender (defaults to the organization's name, see senderFor)
 * @param {object} [opts.branding] - The organization's branding (resolveBranding)
 * @param {string} [opts.replyTo]  - Reply-To header
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
export async function sendEmail({ to, subject, template, variables = {}, from, replyTo, tracking, branding }) {
  const html = await loadTemplate(template, { ...brandEmailVariables(branding), ...variables });
  return sendMailgunEmail({ to, subject, html, from: from || senderFor(branding), replyTo, tracking });
}

/**
 * Convenience helpers for each template type.
 * These wrap sendEmail with the correct template filename.
 */

export async function sendWelcomeEmail({ to, clientName, portalLink, senderName, from, replyTo, branding }) {
  const company = String(branding?.companyName || '').trim();
  return sendEmail({
    branding,
    to,
    subject: company ? `Welcome to ${company}, ${clientName}` : `Welcome, ${clientName}`,
    template: 'welcome.html',
    variables: { clientName, portalLink, senderName },
    from,
    replyTo,
  });
}

export async function sendInvoiceCreatedEmail({ to, clientName, invoiceNumber, amount, dueDate, payLink, from, replyTo, branding }) {
  return sendEmail({
    branding,
    to,
    subject: `Invoice ${invoiceNumber}${fromCompany(branding)}`,
    template: 'invoice-created.html',
    variables: { clientName, invoiceNumber, amount, dueDate, payLink },
    from,
    replyTo,
  });
}

function formatInvoiceDueDate(dueDate) {
  // Invoice due dates are calendar dates stored in UTC (see createInvoiceSchema).
  return dueDate
    ? new Date(dueDate).toLocaleDateString('en-CA', { dateStyle: 'long', timeZone: 'UTC' })
    : 'upon receipt';
}

/**
 * The "Pay" link always opens the public invoice page (/portal/invoice/:token),
 * which creates or refreshes a Stripe Checkout session on demand. A stored
 * Checkout URL expires within 24 hours, so it is never emailed (a
 * `paymentLink` argument is ignored).
 */
export function buildInvoiceDeliveryEmail({ to, clientName, invoiceNumber, total, currency, dueDate, viewUrl, invoiceId, branding }) {
  return {
    branding,
    to,
    subject: `Invoice ${invoiceNumber}${fromCompany(branding)}`,
    template: 'invoice-created.html',
    variables: {
      clientName: clientName || 'there',
      invoiceNumber,
      amount: formatMoney(total, currency),
      dueDate: formatInvoiceDueDate(dueDate),
      payLink: viewUrl,
    },
    ...(invoiceId ? { tracking: { documentType: 'invoice', documentId: invoiceId } } : {}),
  };
}

export async function sendInvoiceDeliveryEmail(options) {
  try {
    return await sendEmail(buildInvoiceDeliveryEmail(options));
  } catch (error) {
    console.error('[email] Invoice delivery preparation failed:', error.message);
    return { ok: false, error: error.message };
  }
}

/** Overdue reminder; the pay link is the public invoice page. */
export function buildInvoiceOverdueEmail({ to, clientName, invoiceNumber, total, currency, daysOverdue, viewUrl, invoiceId, branding }) {
  return {
    branding,
    to,
    subject: `Overdue: Invoice ${invoiceNumber}${fromCompany(branding)}`,
    template: 'invoice-overdue.html',
    variables: {
      clientName: clientName || 'there',
      invoiceNumber,
      amount: formatMoney(total, currency),
      daysOverdue: String(daysOverdue),
      payLink: viewUrl,
    },
    ...(invoiceId ? { tracking: { documentType: 'invoice', documentId: invoiceId } } : {}),
  };
}

export async function sendInvoiceOverdueEmail(options) {
  try {
    return await sendEmail(buildInvoiceOverdueEmail(options));
  } catch (error) {
    console.error('[email] Invoice overdue reminder preparation failed:', error.message);
    return { ok: false, error: error.message };
  }
}

export async function sendInvoicePaidEmail({ to, clientName, invoiceNumber, amount, paidDate, from, replyTo, branding }) {
  return sendEmail({
    branding,
    to,
    subject: `Payment Confirmed — Invoice ${invoiceNumber}`,
    template: 'invoice-paid.html',
    variables: { clientName, invoiceNumber, amount, paidDate },
    from,
    replyTo,
  });
}

export async function sendProposalSentEmail({ to, clientName, proposalTitle, amount, viewLink, expiresDate, from, replyTo, branding }) {
  return sendEmail({
    branding,
    to,
    subject: `Proposal: ${proposalTitle}`,
    template: 'proposal-sent.html',
    variables: { clientName, proposalTitle, amount, viewLink, expiresDate },
    from,
    replyTo,
  });
}

export async function sendContractSignEmail({ to, clientName, contractTitle, signLink, expiresDate, from, replyTo, contractId, branding }) {
  return sendEmail({
    branding,
    ...(contractId ? { tracking: { documentType: 'contract', documentId: contractId } } : {}),
    to,
    subject: `Contract Ready to Sign: ${contractTitle}`,
    template: 'contract-sign.html',
    variables: { clientName, contractTitle, signLink, expiresDate },
    from,
    replyTo,
  });
}

export async function sendProjectUpdateEmail({ to, clientName, projectName, oldStatus, newStatus, portalLink, from, replyTo, branding }) {
  return sendEmail({
    branding,
    to,
    subject: `Project Update: ${projectName} — ${newStatus}`,
    template: 'project-update.html',
    variables: { clientName, projectName, oldStatus, newStatus, portalLink },
    from,
    replyTo,
  });
}

export async function sendMessageNewEmail({ to, clientName, senderName, messagePreview, portalLink, from, replyTo, branding }) {
  // Compute sender initial for the avatar bubble
  const senderInitial = (senderName || '?').charAt(0).toUpperCase();
  return sendEmail({
    branding,
    to,
    subject: `New message from ${senderName}`,
    template: 'message-new.html',
    variables: { clientName, senderName, senderInitial, messagePreview, portalLink },
    from,
    replyTo,
  });
}

export default sendEmail;
