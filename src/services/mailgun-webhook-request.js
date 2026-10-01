// Request handling shared by the Mailgun inbound-route webhooks
// (POST /api/mailgun and POST /api/mailgun-hitl/hitl-reply).
//
// Mailgun forwards a routed message as application/x-www-form-urlencoded, or
// as multipart/form-data when it has attachments. The app only registers a
// JSON parser globally, and @fastify/multipart without attachFieldsToBody, so
// without this a urlencoded POST was refused with 415 and a multipart POST
// reached the handler with an undefined body. The form parser is added only
// inside the encapsulated scope of these two webhook routes: accepting form
// bodies on cookie-authenticated routes would open them to cross-site form
// posts.

import {
  claimWebhookToken,
  verifyMailgunSignature,
} from './mailgun-delivery.service.js';

// Mailgun accepts messages up to 25 MB; text and HTML parts travel as fields.
export const MAILGUN_WEBHOOK_BODY_LIMIT = 30 * 1024 * 1024;
const MAX_FIELD_SIZE = 25 * 1024 * 1024;
const MAX_FIELDS = 500;
const MAX_FILES = 100;

/** Assign a form field, keeping the first value and never touching the prototype. */
function setField(fields, name, value) {
  if (!name || name === '__proto__' || Object.prototype.hasOwnProperty.call(fields, name)) return;
  fields[name] = value;
}

/** Parse an application/x-www-form-urlencoded body into a plain field map. */
export function parseUrlEncodedFields(text) {
  const fields = {};
  for (const [name, value] of new URLSearchParams(text || '')) setField(fields, name, value);
  return fields;
}

/**
 * Add the urlencoded body parser to an encapsulated Fastify scope. Only the
 * routes registered in that scope accept form posts.
 * @param {import('fastify').FastifyInstance} scope
 */
export function addMailgunFormParser(scope) {
  scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    try {
      done(null, parseUrlEncodedFields(String(body)));
    } catch (err) {
      err.statusCode = 400;
      done(err);
    }
  });
}

/**
 * The webhook's form fields, whichever encoding Mailgun used. Multipart file
 * parts (attachments) are drained and ignored: the pipeline stores the text
 * and HTML bodies only. Returns null when the request carries no field map.
 * @param {any} request
 */
export async function readMailgunWebhookFields(request) {
  if (typeof request.isMultipart === 'function' && request.isMultipart()) {
    const fields = {};
    const parts = request.parts({ limits: { fieldSize: MAX_FIELD_SIZE, fields: MAX_FIELDS, files: MAX_FILES } });
    for await (const part of parts) {
      if (part.type === 'file') {
        // Consume the stream so the parser moves on to the next part.
        for await (const _chunk of part.file) { /* discard attachment bytes */ }
        continue;
      }
      setField(fields, part.fieldname, typeof part.value === 'string' ? part.value : String(part.value ?? ''));
    }
    return fields;
  }
  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) return null;
  return body;
}

/**
 * Verify an inbound-route webhook the same way as POST /api/mailgun/events:
 * HMAC signature, the 15-minute timestamp window, and a single-use token
 * claim. Mailgun does not retry a 406, and retries any other non-2xx.
 *
 * @returns {Promise<{ ok: true, token: string } | { ok: false, status: number, error: string, reason: string }>}
 */
export async function authenticateMailgunWebhook({ fields, signingKey, prisma }) {
  const verification = verifyMailgunSignature(
    { timestamp: fields.timestamp, token: fields.token, signature: fields.signature },
    signingKey,
  );
  if (!verification.ok) {
    if (verification.reason === 'stale') {
      return { ok: false, status: 406, reason: 'stale', error: 'Mailgun webhook timestamp is outside the accepted window' };
    }
    return { ok: false, status: 401, reason: verification.reason, error: 'Invalid Mailgun webhook signature' };
  }
  if (!(await claimWebhookToken(prisma, fields.token))) {
    return { ok: false, status: 406, reason: 'replayed', error: 'Mailgun webhook token was already used' };
  }
  return { ok: true, token: fields.token };
}

/**
 * The bare, lower-cased address in a From header or envelope sender
 * ("Jane <Jane@Example.com>" -> "jane@example.com"), or null.
 * @param {unknown} value
 */
export function parseEmailAddress(value) {
  if (typeof value !== 'string') return null;
  const angle = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(value);
  const candidate = (angle ? angle[1] : value).trim();
  if (!/^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/.test(candidate)) return null;
  return candidate.toLowerCase();
}
