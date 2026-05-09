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
}

/**
 * Build RFC 2822 email message
 */
function buildRfc2822Email(to, subject, body) {
  const sanitizedSubject = sanitizeEmailHeader(subject);
  const sanitizedTo = sanitizeEmailHeader(to);

  const lines = [
    `To: ${sanitizedTo}`,
    `Subject: ${sanitizedSubject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body
  ];
  return lines.join('\r\n');
}

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

/**
 * Create a Gmail draft
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
};
export { createDraft, searchInbox };
ade404a (feat(proposals): convert proposal-builder to ESM + Fastify plugin)
