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
//
// Both parsers build the same field map: a null-prototype object, first value
// wins, names that exist on Object.prototype are dropped, and repeated names
// are remembered so security-relevant duplicates can be refused.

import {
  claimWebhookToken,
  verifyMailgunSignature,
} from './mailgun-delivery.service.js';

// Mailgun accepts messages up to 25 MB. This caps the total size of all form
// fields (urlencoded body limit, and the running multipart field total) so an
// unsigned request cannot make the server buffer more before the signature is
// checked.
export const MAILGUN_WEBHOOK_BODY_LIMIT = 30 * 1024 * 1024;
const MAX_FIELD_SIZE = 25 * 1024 * 1024;
const MAX_FIELDS = 100;
const MAX_FILES = 20;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const DUPLICATES = Symbol('mailgunDuplicateFields');
const PROTOTYPE_NAMES = Symbol('mailgunPrototypeFieldNames');

// Fields whose value decides authentication, routing or what is applied. Any
// of these appearing more than once makes the request ambiguous.
export const SECURITY_FIELDS = Object.freeze([
  'recipient', 'from', 'sender', 'timestamp', 'token', 'signature',
  'body-plain', 'stripped-text', 'message-headers',
  'X-Mailgun-Spf', 'X-Mailgun-Dkim-Check-Result',
]);

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function createFieldMap() {
  const fields = Object.create(null);
  Object.defineProperty(fields, DUPLICATES, { value: new Set(), enumerable: false });
  Object.defineProperty(fields, PROTOTYPE_NAMES, { value: new Set(), enumerable: false });
  return fields;
}

/**
 * Assign a form field: first value wins. A name that exists on
 * Object.prototype is never stored and marks the whole post as refused, the
 * same outcome @fastify/multipart gives such a name (PrototypeViolationError).
 */
function setField(fields, name, value) {
  if (!name) return;
  if (name in Object.prototype) {
    fields[PROTOTYPE_NAMES].add(name);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(fields, name)) {
    fields[DUPLICATES].add(name);
    return;
  }
  fields[name] = value;
}

/** True when the map came from one of the Mailgun form parsers. */
export function isMailgunFieldMap(fields) {
  return Boolean(fields && typeof fields === 'object' && fields[DUPLICATES] instanceof Set);
}

/** The first security-relevant field name that was posted more than once, or null. */
export function duplicateSecurityField(fields) {
  const duplicates = fields?.[DUPLICATES];
  if (!(duplicates instanceof Set)) return null;
  return SECURITY_FIELDS.find(name => duplicates.has(name)) || null;
}

/** Parse an application/x-www-form-urlencoded body into a field map. */
export function parseUrlEncodedFields(text) {
  const fields = createFieldMap();
  for (const [name, value] of new URLSearchParams(text || '')) setField(fields, name, value);
  return fields;
}

/**
 * Add the urlencoded body parser to an encapsulated Fastify scope. Only the
 * routes registered in that scope accept form posts. The route's bodyLimit
 * (MAILGUN_WEBHOOK_BODY_LIMIT) bounds the body; Fastify answers 413 above it.
 * @param {import('fastify').FastifyInstance} scope
 */
export function addMailgunFormParser(scope) {
  scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, parseUrlEncodedFields(String(body)));
  });
}

/**
 * The webhook's form fields, whichever encoding Mailgun used. Multipart file
 * parts (attachments) are drained and ignored: the pipeline stores the text
 * and HTML bodies only. Returns null when the request was not a form post.
 * Throws an error with statusCode 413 when the fields exceed the size cap.
 * @param {any} request
 */
export async function readMailgunWebhookFields(request) {
  if (typeof request.isMultipart === 'function' && request.isMultipart()) {
    const declaredLength = Number(request.headers?.['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAILGUN_WEBHOOK_BODY_LIMIT) {
      throw httpError(413, 'Webhook body too large');
    }
    const fields = createFieldMap();
    let fieldBytes = 0;
    const parts = request.parts({
      limits: { fieldSize: MAX_FIELD_SIZE, fields: MAX_FIELDS, files: MAX_FILES, fileSize: MAX_FILE_SIZE },
    });
    for await (const part of parts) {
      if (part.type === 'file') {
        // Consume the stream so the parser moves on to the next part.
        for await (const _chunk of part.file) { /* discard attachment bytes */ }
        continue;
      }
      const value = typeof part.value === 'string' ? part.value : String(part.value ?? '');
      fieldBytes += Buffer.byteLength(value) + Buffer.byteLength(part.fieldname || '');
      if (fieldBytes > MAILGUN_WEBHOOK_BODY_LIMIT) throw httpError(413, 'Webhook body too large');
      setField(fields, part.fieldname, value);
    }
    return fields;
  }
  return isMailgunFieldMap(request.body) ? request.body : null;
}

/**
 * Verify an inbound-route webhook the same way as POST /api/mailgun/events:
 * HMAC signature, the 15-minute timestamp window and a single-use token
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

// Both parsers refuse a prototype-named field with the same answer.
const PROTOTYPE_FIELD_REJECTION = Object.freeze({ ok: false, status: 406, error: 'Webhook field name is not allowed' });

/**
 * Read a form body for a Mailgun webhook route and refuse ambiguous posts:
 * repeated security-relevant fields and prototype-named fields (406).
 * @returns {Promise<{ ok: true, fields: Record<string, any> } | { ok: false, status: number, error: string }>}
 */
export async function readMailgunWebhookRequest(request) {
  let fields;
  try {
    fields = await readMailgunWebhookFields(request);
  } catch (err) {
    // Too large: the cap above, or a multipart field/file/count limit.
    if (err?.statusCode === 413) return { ok: false, status: 413, error: 'Webhook body too large' };
    if (err?.code === 'FST_PROTO_VIOLATION') return PROTOTYPE_FIELD_REJECTION;
    request.log.warn({ err }, 'Unreadable Mailgun webhook body');
    return { ok: false, status: 400, error: 'Unreadable webhook body' };
  }
  if (!fields) return { ok: false, status: 406, error: 'Webhook body must be Mailgun form fields' };
  if (fields[PROTOTYPE_NAMES].size > 0) return PROTOTYPE_FIELD_REJECTION;
  const duplicate = duplicateSecurityField(fields);
  if (duplicate) {
    request.log.warn({ field: duplicate }, 'Mailgun webhook repeated a security-relevant field');
    return { ok: false, status: 406, error: 'Webhook repeated a security-relevant field' };
  }
  return { ok: true, fields };
}

/**
 * The bare, lower-cased address of a single-address From header or envelope
 * sender ("Jane <Jane@Example.com>" -> "jane@example.com"). Returns null for
 * anything that names more than one address (a comma outside quotes, or more
 * than one <...>), so an attacker cannot smuggle a second mailbox in.
 * @param {unknown} value
 */
export function parseEmailAddress(value) {
  if (typeof value !== 'string' || value.length > 998) return null;
  // Remove quoted display-name text before looking for list separators.
  const unquoted = value.replace(/"(?:[^"\\]|\\.)*"/g, '');
  // An unbalanced quote, or a comma outside quotes, means more than one mailbox.
  if (unquoted.includes('"') || unquoted.includes(',')) return null;
  const angles = unquoted.match(/<[^<>]*>/g) || [];
  if (angles.length > 1 || /[<>]/.test(unquoted.replace(/<[^<>]*>/, ''))) return null;
  let candidate;
  if (angles.length === 1) {
    if (!/<[^<>]*>\s*$/.test(unquoted)) return null;
    candidate = angles[0].slice(1, -1).trim();
  } else {
    candidate = unquoted.trim();
  }
  if (!/^[^\s@<>",;:()[\]\\]+@[^\s@<>",;:()[\]\\]+\.[^\s@<>",;:()[\]\\]+$/.test(candidate)) return null;
  return candidate.toLowerCase();
}

/** The domain of a parsed address, or null. */
export function addressDomain(address) {
  if (typeof address !== 'string') return null;
  const at = address.lastIndexOf('@');
  return at > 0 ? address.slice(at + 1).toLowerCase() : null;
}

/** Relaxed DMARC-style alignment: same domain, or one a subdomain of the other. */
export function domainsAligned(a, b) {
  if (!a || !b) return false;
  const x = a.toLowerCase().replace(/\.$/, '');
  const y = b.toLowerCase().replace(/\.$/, '');
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/**
 * Every value of a message header, matched case-insensitively. Mailgun posts
 * the full header list as `message-headers` (JSON [[name, value], ...]); when
 * that is absent, top-level fields stand in. Returns null when the headers
 * JSON is present but unreadable.
 */
export function headerValues(fields, name) {
  const wanted = name.toLowerCase();
  const raw = fields['message-headers'];
  if (typeof raw === 'string' && raw) {
    let list;
    try { list = JSON.parse(raw); } catch { return null; }
    if (!Array.isArray(list)) return null;
    return list
      .filter(entry => Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].toLowerCase() === wanted)
      .map(entry => String(entry[1] ?? ''));
  }
  return Object.keys(fields)
    .filter(key => key.toLowerCase() === wanted)
    .map(key => String(fields[key] ?? ''));
}

function singleHeader(fields, name) {
  const values = headerValues(fields, name);
  return values && values.length === 1 ? values[0].trim() : null;
}

/**
 * Whether Mailgun's own checks vouch for the From domain: DKIM passed and
 * every DKIM signature is aligned with the From domain, or SPF passed for an
 * envelope sender aligned with the From domain. Mailgun's result headers are
 * trusted only when each appears exactly once, so a copy added by the sender
 * makes the message fail.
 * @returns {{ ok: boolean, reason?: string, method?: string }}
 */
export function mailgunSenderAuthentication(fields, fromAddress) {
  const fromDomain = addressDomain(fromAddress);
  if (!fromDomain) return { ok: false, reason: 'no_from_domain' };

  // A second From header makes the parsed `from` field ambiguous.
  const fromHeaders = headerValues(fields, 'From');
  if (fromHeaders === null) return { ok: false, reason: 'unreadable_headers' };
  if (fromHeaders.length > 1) return { ok: false, reason: 'multiple_from_headers' };
  if (fromHeaders.length === 1 && parseEmailAddress(fromHeaders[0]) !== fromAddress) {
    return { ok: false, reason: 'from_mismatch' };
  }

  const dkimResult = singleHeader(fields, 'X-Mailgun-Dkim-Check-Result');
  if (dkimResult && dkimResult.toLowerCase() === 'pass') {
    const signatures = headerValues(fields, 'DKIM-Signature') || [];
    const domains = signatures.map(sig => /(?:^|;)\s*d\s*=\s*([^;\s]+)/i.exec(sig)?.[1]).filter(Boolean);
    if (domains.length > 0 && domains.length === signatures.length && domains.every(d => domainsAligned(d, fromDomain))) {
      return { ok: true, method: 'dkim' };
    }
  }

  const spfResult = singleHeader(fields, 'X-Mailgun-Spf');
  if (spfResult && spfResult.toLowerCase() === 'pass') {
    const envelopeDomain = addressDomain(parseEmailAddress(fields.sender));
    if (envelopeDomain && domainsAligned(envelopeDomain, fromDomain)) return { ok: true, method: 'spf' };
  }

  return { ok: false, reason: 'unauthenticated_sender' };
}
