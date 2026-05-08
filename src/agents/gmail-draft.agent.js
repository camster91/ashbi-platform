/**
 * Gmail Draft Agent for ashbi-platform
 * Connects to Maton API to create Gmail drafts and search inbox
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
 * Sanitize email body to ensure valid RFC 2822 formatting.
 * Converts bare \n to \r\n, strips null bytes.
 * @param {string} body - Raw email body
 * @returns {string} Sanitized body
 */
function sanitizeBody(body) {
  if (typeof body !== 'string') return String(body);
  return body
    .replace(/\r?\n/g, '\r\n')  // normalize to CRLF
    .replace(/\x00/g, '');      // strip null bytes
4f0a1ca (fix(referral-engine): ESM conversion + Fastify routes + email header sanitization)
}

/**
 * Build RFC 2822 email message
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} body - Email body
 * @returns {string} RFC 2822 formatted message
 */
function buildRfc2822Email(to, subject, body) {
  const sanitizedSubject = sanitizeEmailHeader(subject);
  const sanitizedTo = sanitizeEmailHeader(to);

  const lines = [
    `To: ${sanitizedTo}`,
    `Subject: ${sanitizedSubject}`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${sanitizeHeader(subject)}`,
4f0a1ca (fix(referral-engine): ESM conversion + Fastify routes + email header sanitization)
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    quotedPrintableEncode(body)
  ];
  return lines.join('\r\n');
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
      // Printable ASCII except '=' (which is the QP escape char)
      result += decoded[i];
    } else if (code <= 0x1f || code === 0x7f) {
      // Control chars -> hex encode
      result += '=' + code.toString(16).toUpperCase().padStart(2, '0');
    } else if (code >= 0x80) {
      // Non-ASCII -> UTF-8 bytes as QP
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
      // Printable ASCII (space, tab, etc.) or '='
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
 * Create a Gmail draft
 * @param {string} toEmail - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body content
 * @returns {Promise<object>} API response with draft info
 */
async function createDraft(toEmail, subject, body) {
  if (!MATON_API_KEY) {
    throw new Error('MATON_API_KEY environment variable is not set');
  }

  // Sanitize inputs before building the RFC 2822 message
  const sanitizedSubject = sanitizeEmailHeader(subject);
  const rfc2822Message = buildRfc2822Email(toEmail, sanitizedSubject, body);
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
 * Search inbox for messages matching query
 * @param {string} query - Gmail search query
 * @returns {Promise<object>} API response with matching messages
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
  searchInbox,
  sanitizeEmailHeader
  searchInbox
4f0a1ca (fix(referral-engine): ESM conversion + Fastify routes + email header sanitization)
};
