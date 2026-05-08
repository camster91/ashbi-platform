/**
 * Gmail Draft Agent for ashbi-platform
 * Connects to Maton API to create Gmail drafts and search inbox
 */

const MATON_API_KEY = process.env.MATON_API_KEY;
const BASE_URL = 'https://api.maton.ai/google-mail/gmail/v1/users/me';

/**
 * Build RFC 2822 email message
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} body - Email body
 * @returns {string} RFC 2822 formatted message
 */
function buildRfc2822Email(to, subject, body) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body
  ];
  return lines.join('\r\n');
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

  const rfc2822Message = buildRfc2822Email(toEmail, subject, body);
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
  searchInbox
};