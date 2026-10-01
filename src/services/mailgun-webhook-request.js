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
// Mailgun posts every MIME header as its own field, and Microsoft 365 mail
// carries many; the byte cap above still bounds memory.
const MAX_FIELDS = 1000;
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
 * Make an encapsulated Fastify scope accept Mailgun form posts only: add the
 * urlencoded parser and drop the inherited JSON and text parsers, so any
 * other content type gets 415 before its body is read (the large webhook
 * bodyLimit never applies to JSON). Multipart stays with @fastify/multipart.
 * The route's bodyLimit (MAILGUN_WEBHOOK_BODY_LIMIT) bounds a urlencoded body;
 * Fastify answers 413 above it.
 * @param {import('fastify').FastifyInstance} scope
 */
export function addMailgunFormParser(scope) {
  scope.removeContentTypeParser(['application/json', 'text/plain']);
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
      // A truncated field or name would be parsed as a different value.
      if (part.valueTruncated || part.fieldnameTruncated) throw httpError(413, 'Webhook field too large');
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

/**
 * Whether `candidate` (a DKIM d= or envelope domain) is aligned with the From
 * domain: equal to it, or a subdomain of it. A parent domain of From never
 * aligns, so a public suffix or a sibling's parent cannot vouch for it.
 */
export function domainAlignedWithFrom(candidate, fromDomain) {
  if (!candidate || !fromDomain) return false;
  const c = candidate.toLowerCase().replace(/\.$/, '');
  const f = fromDomain.toLowerCase().replace(/\.$/, '');
  return c === f || c.endsWith(`.${f}`);
}

/**
 * Mailgun's `message-headers` field (JSON [[name, value], ...]) as an ordered
 * list of { name (trimmed, lower-cased), value }, or null when it is missing
 * or unreadable.
 */
export function parseMessageHeaders(fields) {
  const raw = fields?.['message-headers'];
  if (typeof raw !== 'string' || !raw) return null;
  let list;
  try { list = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const headers = [];
  for (const entry of list) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') return null;
    headers.push({ name: entry[0].trim().toLowerCase(), value: String(entry[1] ?? '') });
  }
  return headers;
}

/** Every value of one header (case-insensitive name) in a parsed header list. */
export function headerValues(headers, name) {
  const wanted = name.trim().toLowerCase();
  return headers.filter(header => header.name === wanted).map(header => header.value);
}

const VERDICT_HEADERS = ['x-mailgun-spf', 'x-mailgun-dkim-check-result'];

/**
 * Mailgun's SPF / DKIM verdicts, trusted only from the leading block of
 * X-Mailgun-* headers that Mailgun prepends (everything before the first
 * other header, e.g. Received). A verdict-named header anywhere after that
 * block was supplied by the sender, so the message is refused; a verdict that
 * is absent from, or repeated in, the block counts as no verdict.
 */
function mailgunVerdicts(headers) {
  let blockEnd = headers.findIndex(header => !header.name.startsWith('x-mailgun-'));
  if (blockEnd === -1) blockEnd = headers.length;
  const lead = headers.slice(0, blockEnd);
  if (headers.slice(blockEnd).some(header => VERDICT_HEADERS.includes(header.name))) {
    return { ok: false, reason: 'verdict_outside_mailgun_block' };
  }
  const single = (name) => {
    const values = headerValues(lead, name);
    return values.length === 1 ? values[0].trim().toLowerCase() : null;
  };
  return { ok: true, spf: single('X-Mailgun-Spf'), dkim: single('X-Mailgun-Dkim-Check-Result') };
}

/** The d= domain of a DKIM-Signature, or null when there is not exactly one d= tag. */
function dkimSigningDomain(signature) {
  const tags = [...signature.matchAll(/(?:^|;)\s*d\s*=\s*([^;\s]*)/gi)];
  return tags.length === 1 && tags[0][1] ? tags[0][1] : null;
}

/**
 * Whether Mailgun's own checks vouch for the From domain: a DKIM pass with
 * every DKIM-Signature aligned with the From domain, or an SPF pass for an
 * envelope sender aligned with it. Fails closed without message-headers.
 * @param {Array<{ name: string, value: string }> | null} headers parseMessageHeaders()
 * @param {unknown} envelopeSender Mailgun's `sender` field
 * @param {string | null} fromAddress
 * @returns {{ ok: boolean, reason?: string, method?: string }}
 */
export function mailgunSenderAuthentication(headers, envelopeSender, fromAddress) {
  if (!headers) return { ok: false, reason: 'missing_message_headers' };
  const fromDomain = addressDomain(fromAddress);
  if (!fromDomain) return { ok: false, reason: 'no_from_domain' };

  // Exactly one From header, naming the same mailbox as the `from` field.
  const fromHeaders = headerValues(headers, 'From');
  if (fromHeaders.length !== 1) return { ok: false, reason: 'from_header_count' };
  if (parseEmailAddress(fromHeaders[0]) !== fromAddress) return { ok: false, reason: 'from_mismatch' };

  const verdicts = mailgunVerdicts(headers);
  if (!verdicts.ok) return { ok: false, reason: verdicts.reason };

  if (verdicts.dkim === 'pass') {
    const signatures = headerValues(headers, 'DKIM-Signature');
    const domains = signatures.map(dkimSigningDomain);
    if (signatures.length > 0 && domains.every(d => domainAlignedWithFrom(d, fromDomain))) {
      return { ok: true, method: 'dkim' };
    }
  }

  if (verdicts.spf === 'pass') {
    const envelopeDomain = addressDomain(parseEmailAddress(envelopeSender));
    if (domainAlignedWithFrom(envelopeDomain, fromDomain)) return { ok: true, method: 'spf' };
  }

  return { ok: false, reason: 'unauthenticated_sender' };
}

/** The <message-id> tokens in an In-Reply-To or References value. */
function messageIdTokens(value) {
  return value.match(/<[^<>\s]+>/g) || [];
}

/**
 * Whether the reply's In-Reply-To or References names `messageId` (the
 * "<id@host>" Mailgun returned when the HITL email was sent).
 */
export function replyReferencesMessage(headers, messageId) {
  if (!headers || typeof messageId !== 'string' || !messageId) return false;
  return [...headerValues(headers, 'In-Reply-To'), ...headerValues(headers, 'References')]
    .some(value => messageIdTokens(value).includes(messageId));
}

// Tolerated clock difference between the replier's mail server and ours.
export const HITL_REPLY_DATE_SKEW_MS = 5 * 60 * 1000;

/**
 * Whether the reply's single Date header is not older than the notification
 * (with a small clock-skew allowance). A missing, repeated or unparseable
 * Date fails.
 */
export function replyDateIsAfter(headers, notBefore) {
  if (!headers || !(notBefore instanceof Date)) return false;
  const dates = headerValues(headers, 'Date');
  if (dates.length !== 1) return false;
  const sentAt = Date.parse(dates[0]);
  return Number.isFinite(sentAt) && sentAt >= notBefore.getTime() - HITL_REPLY_DATE_SKEW_MS;
}
