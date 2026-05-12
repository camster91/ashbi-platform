/**
 * Gmail Draft Agent for ashbi-platform
 * Connects to Maton API to create Gmail drafts with attachments and search inbox
 *
 * Email headers are sanitized to prevent RFC 2822 violations
 * and header injection attacks (Issue #26/#30).
 */

const MATON_API_KEY = process.env.MATON_API_KEY;
const BASE_URL = 'https://api.maton.ai/google-mail/gmail/v1/users/me';

/**
 * Sanitize an email header value to prevent header injection and RFC violations.
 * Removes control characters, newlines, and trims whitespace.
 * Encodes non-ASCII characters using RFC 2047 encoded-word syntax.
 *
 * @param {string} value - The raw header value
 * @returns {string} Sanitized header value safe for RFC 2822
 */
function sanitizeEmailHeader(value) {
  if (typeof value !== 'string') return '';

  // Remove any control characters except tabs
  let sanitized = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Remove any newlines (prevents header injection)
  sanitized = sanitized.replace(/\r?\n|\r/g, ' ');

  // Collapse multiple spaces
  sanitized = sanitized.replace(/[ \t]+/g, ' ').trim();

  // If there are non-ASCII characters, encode the whole value as RFC 2047
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E]/.test(sanitized)) {
    const buf = Buffer.from(sanitized, 'utf-8');
    sanitized = '=?UTF-8?B?' + buf.toString('base64') + '?=';
  }

  return sanitized;
}

/**
 * Sanitize a string for use in RFC 2822 email headers.
 * Strips non-ASCII and control characters, collapses whitespace.
 * @param {string} value - Raw header value
 * @returns {string} Sanitized header value (printable ASCII only)
 */
function sanitizeHeader(value) {
  if (typeof value !== 'string') return String(value);
  return value
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')  // strip null bytes and control chars
    .replace(/[\x80-\uffff]/g, '')          // strip non-ASCII
    .replace(/\r?\n/g, ' ')                 // replace newlines with space
    .replace(/\s+/g, ' ')                   // collapse multiple whitespace
    .trim();
}

/**
 * Encode string to base64url format (URL-safe base64)
 * @param {string} str - String to encode
 * @returns {string} Base64 URL-safe encoded string
 */
function toBase64Url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Build RFC 2822 email message with optional attachment
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} body - Email body (plain text)
 * @param {object} options - Additional options
 * @param {Buffer} options.attachment - PDF buffer to attach
 * @param {string} options.attachmentName - Filename for attachment
 * @returns {string} RFC 2822 formatted message
 */
function buildRfc2822EmailWithAttachment(to, subject, body, options = {}) {
  const { attachment, attachmentName = 'proposal.pdf' } = options;
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const sanitizedSubject = sanitizeEmailHeader(subject);
  const sanitizedTo = sanitizeEmailHeader(to);

  let message = '';

  if (attachment) {
    // Multipart message with attachment
    const base64Attachment = attachment.toString('base64');
    message = [
      `To: ${sanitizedTo}`,
      `Subject: ${sanitizedSubject}`,
      'Content-Type: multipart/mixed; boundary="' + boundary + '"',
      'Content-Transfer-Encoding: 7bit',
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      body,
      '',
      `--${boundary}`,
      `Content-Type: application/pdf; name="${attachmentName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachmentName}"`,
      '',
      base64Attachment,
      `--${boundary}--`
    ].join('\r\n');
  } else {
    // Simple text message
    message = [
      `To: ${sanitizedTo}`,
      `Subject: ${sanitizedSubject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      body
    ].join('\r\n');
  }

  return message;
}

/**
 * Minimal quoted-printable encoder for UTF-8 text.
 * Ensures lines > 76 chars are soft-wrapped and non-ASCII chars are encoded.
 * @param {string} text - Plain text to encode
 * @returns {string} Quoted-printable encoded text
 */
function quotedPrintableEncode(text) {
  // First decode any HTML entities that might be in the text
  const decoded = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Encode non-ASCII and special chars
  let result = '';
  for (let i = 0; i < decoded.length; i++) {
    const code = decoded.charCodeAt(i);
    if (code === 0x0a) {
      result += '\r\n';
    } else if (code === 0x0d) {
      result += '\r';
    } else if (code >= 0x21 && code <= 0x7e && code !== 0x3d) {
      result += decoded[i];
    } else if (code <= 0x1f || code === 0x7f) {
      result += '=' + code.toString(16).toUpperCase().padStart(2, '0');
    } else if (code >= 0x80) {
      const bytes = [];
      if (code < 0x800) {
        bytes.push(0xC0 | (code >> 6));
        bytes.push(0x80 | (code & 0x3F));
      } else if (code < 0x10000) {
        bytes.push(0xE0 | (code >> 12));
        bytes.push(0x80 | ((code >> 6) & 0x3F));
        bytes.push(0x80 | (code & 0x3F));
      } else {
        bytes.push(0xF0 | (code >> 18));
        bytes.push(0x80 | ((code >> 12) & 0x3F));
        bytes.push(0x80 | ((code >> 6) & 0x3F));
        bytes.push(0x80 | (code & 0x3F));
      }
      for (const b of bytes) {
        result += '=' + b.toString(16).toUpperCase().padStart(2, '0');
      }
    } else {
      result += '=' + code.toString(16).toUpperCase().padStart(2, '0');
    }
  }

  // Soft-wrap lines longer than 76 chars
  const maxLineLen = 76;
  const wrapped = [];
  for (const line of result.split('\r\n')) {
    let pos = 0;
    while (pos < line.length) {
      const chunk = line.slice(pos, pos + maxLineLen);
      if (pos + maxLineLen < line.length) {
        wrapped.push(chunk + '=');
      } else {
        wrapped.push(chunk);
      }
      pos += maxLineLen;
    }
  }
  return wrapped.join('\r\n');
}

/**
 * Create a Gmail draft
 */
async function createDraft(toEmail, subject, body) {
  if (!MATON_API_KEY) {
    throw new Error('MATON_API_KEY environment variable is not set');
  }

  const sanitizedSubject = sanitizeEmailHeader(subject);
  const sanitizedTo = sanitizeEmailHeader(toEmail);

  // Build RFC 2822 message
  const lines = [
    `To: ${sanitizedTo}`,
    `Subject: ${sanitizedSubject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    quotedPrintableEncode(body)
  ];
  const rfc2822Message = lines.join('\r\n');
  const rawEncoded = toBase64Url(rfc2822Message);

  const response = await fetch(`${BASE_URL}/drafts`, {
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

  const sanitizedSubject = sanitizeEmailHeader(subject);
  const sanitizedTo = sanitizeEmailHeader(toEmail);
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // Build multipart message
  const base64Attachment = pdfBuffer.toString('base64');
  const encodedBody = quotedPrintableEncode(body);

  const multipartBody = [
    `To: ${sanitizedTo}`,
    `Subject: ${sanitizedSubject}`,
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    body,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${attachmentName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachmentName}"`,
    '',
    base64Attachment,
    `--${boundary}--`
  ].join('\r\n');

  const rawEncoded = toBase64Url(multipartBody);

  const response = await fetch(`${BASE_URL}/drafts`, {
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

  const sanitizedSubject = sanitizeEmailHeader(subject);
  const sanitizedTo = sanitizeEmailHeader(toEmail);

  let message;
  if (pdfBuffer) {
    message = buildRfc2822EmailWithAttachment(toEmail, sanitizedSubject, body, {
      attachment: pdfBuffer,
      attachmentName
    });
  } else {
    const lines = [
      `To: ${sanitizedTo}`,
      `Subject: ${sanitizedSubject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      quotedPrintableEncode(body)
    ];
    message = lines.join('\r\n');
  }

  const rawEncoded = toBase64Url(message);

  // Try to send directly; if API doesn't support, create draft instead
  try {
    const sendResponse = await fetch(`${BASE_URL}/messages/send`, {
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
  createDraft,
  createDraftWithAttachment,
  sendEmail,
  searchInbox,
  sanitizeEmailHeader
};