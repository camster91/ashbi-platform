/**
 * Gmail Draft Agent for ashbi-platform
 * Connects to Maton API to create Gmail drafts with attachments and search inbox
 *
 * Messages are built like the Gmail reply route's (`buildMimeMessage`): every
 * header value is one line (CR/LF and control characters removed), non-ASCII
 * subjects are RFC 2047 encoded, the text is base64, and there is exactly one
 * From, the connected mailbox when known (Gmail fills it in otherwise).
 */

import { outboundSignal } from '../utils/outbound-timeouts.js';
import { buildMimeMessage, encodeSubject, headerValue } from '../routes/gmail.routes.js';

const MATON_API_KEY = process.env.MATON_API_KEY;
const BASE_URL = 'https://api.maton.ai/google-mail/gmail/v1/users/me';

/**
 * Encode string to base64url format (URL-safe base64)
 */
function toBase64Url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Base64 in 76-character lines, as MIME bodies are written. */
function base64Lines(value) {
  return Buffer.from(value).toString('base64').replace(/.{76}/g, '$&\r\n');
}

/** A filename safe inside a quoted header parameter. */
function attachmentFilename(name) {
  return headerValue(name).replace(/["\\]/g, '') || 'proposal.pdf';
}

/**
 * Build RFC 2822 email message with optional attachment
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} body - Email body (plain text)
 * @param {object} options - Additional options
 * @param {Buffer} [options.attachment] - PDF buffer to attach
 * @param {string} [options.attachmentName] - Filename for attachment
 * @param {string | null} [options.from] - The connected mailbox, the only From
 * @returns {string} RFC 2822 formatted message
 */
function buildRfc2822EmailWithAttachment(to, subject, body, options = {}) {
  const { attachment, attachmentName = 'proposal.pdf', from = null } = options;
  if (!attachment) return buildMimeMessage({ from, to, subject, body });

  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const filename = attachmentFilename(attachmentName);
  const lines = [];
  const sender = headerValue(from);
  if (sender) lines.push(`From: ${sender}`);
  lines.push(
    `To: ${headerValue(to)}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(String(body ?? '')),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    base64Lines(attachment),
    `--${boundary}--`,
  );
  return lines.join('\r\n');
}

/** The connected mailbox's address, or null when Gmail does not say. */
async function mailboxAddress() {
  try {
    const response = await fetch(`${BASE_URL}/profile`, {
      signal: outboundSignal('api'),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${MATON_API_KEY}` },
    });
    if (!response.ok) return null;
    const profile = await response.json();
    return typeof profile?.emailAddress === 'string' && profile.emailAddress.includes('@') ? profile.emailAddress : null;
  } catch {
    return null;
  }
}

/**
 * Create a Gmail draft
 */
async function createDraft(toEmail, subject, body) {
  if (!MATON_API_KEY) {
    throw new Error('MATON_API_KEY environment variable is not set');
  }

  const from = await mailboxAddress();
  const rawEncoded = toBase64Url(buildMimeMessage({ from, to: toEmail, subject, body }));

  const response = await fetch(`${BASE_URL}/drafts`, {
    signal: outboundSignal('api'),
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MATON_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: {
        raw: rawEncoded
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create draft: ${response.status} ${error}`);
  }

  return await response.json();
}

/**
 * Create a Gmail draft with PDF attachment
 * @param {string} toEmail - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body content
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {string} attachmentName - Filename for the attachment
 * @returns {Promise<object>} API response with draft info
 */
async function createDraftWithAttachment(toEmail, subject, body, pdfBuffer, attachmentName = 'proposal.pdf') {
  if (!MATON_API_KEY) {
    throw new Error('MATON_API_KEY environment variable is not set');
  }

  // One builder for every attachment draft, so headers are always one line
  // and the text part is always base64 as its header declares.
  const from = await mailboxAddress();
  const multipartBody = buildRfc2822EmailWithAttachment(toEmail, subject, body, { attachment: pdfBuffer, attachmentName, from });

  const rawEncoded = toBase64Url(multipartBody);

  const response = await fetch(`${BASE_URL}/drafts`, {
    signal: outboundSignal('upload'),
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MATON_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: {
        raw: rawEncoded
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create draft with attachment: ${response.status} ${error}`);
  }

  return await response.json();
}

/**
 * Send a Gmail draft (or create and send directly)
 * @param {string} toEmail - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body content
 * @param {Buffer} pdfBuffer - Optional PDF attachment
 * @param {string} attachmentName - Filename for attachment
 * @returns {Promise<object>} API response
 */
async function sendEmail(toEmail, subject, body, pdfBuffer = null, attachmentName = 'proposal.pdf') {
  if (!MATON_API_KEY) {
    throw new Error('MATON_API_KEY environment variable is not set');
  }

  const from = await mailboxAddress();
  const message = buildRfc2822EmailWithAttachment(toEmail, subject, body, {
    attachment: pdfBuffer,
    attachmentName,
    from,
  });

  const rawEncoded = toBase64Url(message);

  // Try to send directly; if API doesn't support, create draft instead
  try {
    const sendResponse = await fetch(`${BASE_URL}/messages/send`, {
      signal: outboundSignal('upload'),
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MATON_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          raw: rawEncoded
        }
      })
    });

    if (sendResponse.ok) {
      return await sendResponse.json();
    }
    // If send fails, fall back to draft creation
  } catch (err) {
    console.warn('[Gmail] Direct send not available, creating draft instead');
  }

  // Create draft as fallback
  return createDraftWithAttachment(toEmail, subject, body, pdfBuffer, attachmentName);
}

/**
 * Search inbox for messages matching query
 */
async function searchInbox(query) {
  if (!MATON_API_KEY) {
    throw new Error('MATON_API_KEY environment variable is not set');
  }

  const encodedQuery = encodeURIComponent(query);
  const response = await fetch(`${BASE_URL}/messages?q=${encodedQuery}`, {
    signal: outboundSignal('api'),
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${MATON_API_KEY}`
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to search inbox: ${response.status} ${error}`);
  }

  return await response.json();
}

export {
  buildRfc2822EmailWithAttachment,
  createDraft,
  createDraftWithAttachment,
  sendEmail,
  searchInbox
};
