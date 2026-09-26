// Media review (#417 slice 1, docs/media-review.md): shared rules for review
// sessions, annotations, decisions and client share links, used by the staff
// API (src/routes/review.routes.js) and the public share-link API
// (src/routes/review-portal.routes.js).
import crypto from 'node:crypto';

/** Session lifecycle. `closed` is read-only (e.g. replaced by a new version). */
export const REVIEW_STATUSES = Object.freeze(['open', 'approved', 'changes_requested', 'closed']);
export const REVIEW_DECISIONS = Object.freeze(['approved', 'changes_requested']);

export const ANNOTATION_BODY_MAX = 5000;
export const DECISION_NOTE_MAX = 2000;
export const GUEST_NAME_MAX = 120;
export const SHARE_LINK_DEFAULT_DAYS = 14;
export const SHARE_LINK_MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// Reviewable uploads, by media kind. Every type here is also accepted by the
// upload policy (src/security/file-upload-policy.js); anything else (office
// documents, archives, text) cannot be put up for review.
const MEDIA_KINDS = Object.freeze({
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'application/pdf': 'pdf',
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/webm': 'audio',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/wave': 'audio',
});

/**
 * @param {string | null | undefined} mimeType
 * @returns {'image' | 'pdf' | 'video' | 'audio' | null}
 */
export function mediaKindFor(mimeType) {
  const base = String(mimeType || '').toLowerCase().split(';')[0].trim();
  return /** @type {any} */ (MEDIA_KINDS[base] ?? null);
}

/** Files moved aside by `npm run quarantine:uploads` are never served for review. */
export function isQuarantined(attachment) {
  return String(attachment?.path || '').startsWith('/uploads/quarantine/');
}

// ── Share-link tokens ────────────────────────────────────────────────────────
// 32 random bytes, base64url: 43 characters, 256 bits. Only the SHA-256 hex
// digest is stored. The raw token is returned once, at creation, and must
// never be logged (src/utils/log-redaction.js masks it in request URLs).
const SHARE_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** @param {string} token */
export function hashShareToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function generateShareToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashShareToken(token) };
}

/** @param {unknown} token */
export function isWellFormedShareToken(token) {
  return typeof token === 'string' && SHARE_TOKEN_FORMAT.test(token);
}

/**
 * Resolve a share link from a raw token. The lookup is by the token's SHA-256
 * digest through a unique index, so the database never compares secret
 * material; the digest is then re-checked with a constant-time comparison.
 * Malformed and unknown tokens both resolve to null.
 *
 * @param {any} prisma raw (unscoped) client: the public route has no tenant
 * @param {unknown} token
 * @param {object} [include] Prisma include for the link
 */
export async function findShareLinkByToken(prisma, token, include) {
  if (!isWellFormedShareToken(token)) return null;
  const tokenHash = hashShareToken(token);
  const link = await prisma.reviewShareLink.findUnique({ where: { tokenHash }, ...(include ? { include } : {}) });
  if (!link) return null;
  const stored = Buffer.from(String(link.tokenHash), 'utf8');
  const given = Buffer.from(tokenHash, 'utf8');
  if (stored.length !== given.length || !crypto.timingSafeEqual(stored, given)) return null;
  return link;
}

/**
 * Why a share link cannot be used, or null when it can. Mirrors
 * publicAccessFailure (src/utils/public-document-access.js).
 */
export function shareLinkFailure(link, now = new Date()) {
  if (!link) return { statusCode: 404, error: 'Review link not found' };
  if (link.revokedAt) return { statusCode: 410, error: 'This review link has been revoked' };
  if (!link.expiresAt || new Date(link.expiresAt) <= now) return { statusCode: 410, error: 'This review link has expired' };
  return null;
}

/** Expiry for a new link: default 14 days, whole days, at most 90. */
export function shareLinkExpiry(expiresInDays, now = new Date()) {
  const days = expiresInDays ?? SHARE_LINK_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > SHARE_LINK_MAX_DAYS) {
    return { error: `expiresInDays must be a whole number from 1 to ${SHARE_LINK_MAX_DAYS}` };
  }
  return { expiresAt: new Date(now.getTime() + days * DAY_MS), days };
}

export function shareLinkState(link, now = new Date()) {
  if (link.revokedAt) return 'revoked';
  return new Date(link.expiresAt) <= now ? 'expired' : 'active';
}

// ── Text sanitising ─────────────────────────────────────────────────────────
// Comments are plain text: the UI renders them as text nodes, never HTML.
// Control characters (other than newline and tab) and bidi overrides are
// removed so a comment cannot hide or reorder what reviewers see.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

/** @param {string} text */
export function sanitizePlainText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(UNSAFE_TEXT, '').trim();
}

/** Single-line display name for a guest reviewer. */
export function sanitizeGuestName(name) {
  return sanitizePlainText(name).replace(/\s+/g, ' ').slice(0, GUEST_NAME_MAX).trim();
}

// ── Annotation positions ────────────────────────────────────────────────────
/**
 * Check an annotation's anchor against the reviewed media: a timecode for
 * video/audio, a normalized region for images, a page number for PDFs.
 * Replies carry no anchor. Returns an error message or null.
 *
 * @param {'image' | 'pdf' | 'video' | 'audio' | null} kind
 * @param {{ timecodeMs?: number | null, region?: object | null, pageNumber?: number | null, parentId?: string | null }} input
 */
export function annotationPositionError(kind, input) {
  const hasTimecode = input.timecodeMs !== undefined && input.timecodeMs !== null;
  const hasRegion = input.region !== undefined && input.region !== null;
  const hasPage = input.pageNumber !== undefined && input.pageNumber !== null;
  if (input.parentId && (hasTimecode || hasRegion || hasPage)) return 'Replies cannot have a timecode, region or page';
  if (hasTimecode && kind !== 'video' && kind !== 'audio') return 'A timecode applies only to video or audio';
  if (hasRegion && kind !== 'image') return 'A region applies only to images';
  if (hasPage && kind !== 'pdf') return 'A page number applies only to PDFs';
  if (hasRegion) {
    const { x, y, w, h } = /** @type {any} */ (input.region);
    if (x + w > 1 || y + h > 1) return 'The region must lie within the image';
  }
  return null;
}

/** Flatten an annotation input's anchor into its columns. */
export function annotationPositionData(input) {
  const region = input.region ?? null;
  return {
    timecodeMs: input.timecodeMs ?? null,
    pageNumber: input.pageNumber ?? null,
    regionX: region ? region.x : null,
    regionY: region ? region.y : null,
    regionW: region ? region.w : null,
    regionH: region ? region.h : null,
  };
}

// ── Serialisation ───────────────────────────────────────────────────────────
function regionOf(annotation) {
  return annotation.regionX === null || annotation.regionX === undefined
    ? null
    : { x: annotation.regionX, y: annotation.regionY, w: annotation.regionW, h: annotation.regionH };
}

/**
 * An annotation as shown to a client through a share link: no staff user
 * ids, no guest email addresses, no share-link ids.
 */
export function publicAnnotation(annotation) {
  return {
    id: annotation.id,
    parentId: annotation.parentId ?? null,
    authorType: annotation.authorType,
    authorName: annotation.authorName,
    body: annotation.body,
    timecodeMs: annotation.timecodeMs ?? null,
    region: regionOf(annotation),
    pageNumber: annotation.pageNumber ?? null,
    resolved: Boolean(annotation.resolvedAt),
    resolvedAt: annotation.resolvedAt ?? null,
    createdAt: annotation.createdAt,
  };
}

/** An annotation as shown to staff in the organization. */
export function staffAnnotation(annotation) {
  return {
    ...publicAnnotation(annotation),
    authorUserId: annotation.authorUserId ?? null,
    authorEmail: annotation.authorEmail ?? null,
    viaShareLinkId: annotation.shareLinkId ?? null,
    resolvedById: annotation.resolvedById ?? null,
  };
}

export function publicDecision(decision) {
  return {
    id: decision.id,
    decision: decision.decision,
    actorType: decision.actorType,
    actorName: decision.actorName,
    note: decision.note ?? null,
    createdAt: decision.createdAt,
  };
}

export function staffDecision(decision) {
  return {
    ...publicDecision(decision),
    actorUserId: decision.actorUserId ?? null,
    actorEmail: decision.actorEmail ?? null,
    viaShareLinkId: decision.shareLinkId ?? null,
  };
}

export function staffShareLink(link, now = new Date()) {
  return {
    id: link.id,
    label: link.label ?? null,
    allowDecision: link.allowDecision,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt ?? null,
    lastUsedAt: link.lastUsedAt ?? null,
    createdAt: link.createdAt,
    createdById: link.createdById,
    state: shareLinkState(link, now),
  };
}

/** The reviewed file's public description (never its storage path). */
export function mediaSummary(attachment) {
  return {
    fileName: attachment.originalName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    kind: mediaKindFor(attachment.mimeType),
  };
}

export function canWriteToSession(session) {
  return session.status !== 'closed';
}
