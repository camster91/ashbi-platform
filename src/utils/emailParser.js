// Email parser utility

import { simpleParser } from 'mailparser';

/**
 * Parse incoming email data from webhook
 * Supports multiple formats: raw email, JSON payload, form data
 */
export async function parseEmail(data) {
  // If it's a raw email string
  if (typeof data === 'string' && data.includes('From:')) {
    return parseRawEmail(data);
  }

  // If it's already parsed JSON from webhook
  if (data.from || data.sender || data.senderEmail) {
    return parseWebhookPayload(data);
  }

  // If it's raw MIME content
  if (data.raw || data.rawEmail || data.mime) {
    const rawContent = data.raw || data.rawEmail || data.mime;
    return parseRawEmail(rawContent);
  }

  throw new Error('Unknown email format');
}

/**
 * Parse raw email content (MIME format)
 */
async function parseRawEmail(rawContent) {
  try {
    const parsed = await simpleParser(rawContent);

    return {
      senderEmail: parsed.from?.value?.[0]?.address || 'unknown@unknown.com',
      senderName: parsed.from?.value?.[0]?.name || null,
      subject: parsed.subject || '(No Subject)',
      bodyText: parsed.text || '',
      bodyHtml: parsed.html || null,
      rawEmail: rawContent,
      headers: extractHeaders(parsed.headers),
      receivedAt: parsed.date || new Date(),
      attachments: parsed.attachments?.map(a => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.size
      })) || []
    };
  } catch (error) {
    console.error('Failed to parse raw email:', error);
    throw new Error('Invalid email format');
  }
}

/**
 * Parse webhook payload (pre-parsed email data)
 */
function parseWebhookPayload(data) {
  // Handle various webhook formats

  // Standard format
  if (data.senderEmail || data.from_email) {
    return {
      senderEmail: data.senderEmail || data.from_email || data.from,
      senderName: data.senderName || data.from_name || null,
      subject: data.subject || '(No Subject)',
      bodyText: data.bodyText || data.text || data.body || '',
      bodyHtml: data.bodyHtml || data.html || null,
      rawEmail: data.raw || null,
      headers: data.headers || null,
      receivedAt: data.receivedAt ? new Date(data.receivedAt) : new Date()
    };
  }

  // SendGrid format
  if (data.envelope) {
    const envelope = typeof data.envelope === 'string'
      ? JSON.parse(data.envelope)
      : data.envelope;

    return {
      senderEmail: envelope.from || data.from,
      senderName: null,
      subject: data.subject || '(No Subject)',
      bodyText: data.text || data.plain || '',
      bodyHtml: data.html || null,
      rawEmail: data.email || null,
      headers: data.headers || null,
      receivedAt: new Date()
    };
  }

  // Mailgun format
  if (data.sender || data['From']) {
    return {
      senderEmail: data.sender || extractEmail(data['From']),
      senderName: extractName(data['From']),
      subject: data.subject || data['Subject'] || '(No Subject)',
      bodyText: data['body-plain'] || data.text || '',
      bodyHtml: data['body-html'] || data.html || null,
      rawEmail: data['body-mime'] || null,
      headers: null,
      receivedAt: data.timestamp
        ? new Date(parseInt(data.timestamp) * 1000)
        : new Date()
    };
  }

  // Generic fallback
  return {
    senderEmail: data.from || data.sender || 'unknown@unknown.com',
    senderName: data.name || null,
    subject: data.subject || '(No Subject)',
    bodyText: data.body || data.text || data.content || '',
    bodyHtml: data.html || null,
    rawEmail: null,
    headers: null,
    receivedAt: new Date()
  };
}

/**
 * Extract key headers from parsed email
 */
function extractHeaders(headers) {
  if (!headers) return null;

  const keyHeaders = {};
  const keysToExtract = [
    'message-id',
    'in-reply-to',
    'references',
    'date',
    'from',
    'to',
    'cc',
    'reply-to'
  ];

  for (const key of keysToExtract) {
    const value = headers.get(key);
    if (value) {
      keyHeaders[key] = typeof value === 'object' ? value.text : value;
    }
  }

  return Object.keys(keyHeaders).length > 0 ? JSON.stringify(keyHeaders) : null;
}

/**
 * Extract email address from "Name <email>" format
 */
function extractEmail(fromString) {
  if (!fromString) return 'unknown@unknown.com';

  const match = fromString.match(/<([^>]+)>/);
  if (match) return match[1];

  // If no angle brackets, assume it's just the email
  if (fromString.includes('@')) return fromString.trim();

  return 'unknown@unknown.com';
}

/**
 * Extract name from "Name <email>" format
 */
function extractName(fromString) {
  if (!fromString) return null;

  const match = fromString.match(/^([^<]+)</);
  if (match) return match[1].trim().replace(/^"|"$/g, '');

  return null;
}

/**
 * Clean and normalize email body text
 */
export function cleanEmailBody(text) {
  if (!text) return '';

  return text
    // Remove excessive whitespace
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    // Remove common email signatures markers and content after
    .replace(/^--\s*$/m, '\n---SIGNATURE---\n')
    .split('---SIGNATURE---')[0]
    // Remove forwarding headers
    .replace(/^-+\s*Forwarded message\s*-+[\s\S]*?^From:/m, '')
    // Remove reply quotes (lines starting with >)
    .replace(/^>.*$/gm, '')
    // Trim
    .trim();
}

/**
 * Extract thread ID from email headers (for threading)
 */
export function extractThreadId(headers) {
  if (!headers) return null;

  const parsed = typeof headers === 'string' ? JSON.parse(headers) : headers;

  // Use In-Reply-To or References header for threading
  return parsed['in-reply-to'] || parsed['references']?.split(/\s+/)[0] || null;
}
