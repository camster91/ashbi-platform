// Public client access to one media review session through a share link
// (#417 slice 1, docs/media-review.md). Mounted at /api/portal/review, which
// is tenancy-exempt (src/middleware/tenancy.js): request.prisma is the raw
// client, so every query below is confined to the session the link names.
//
// Controls: the token is 256 random bits and only its SHA-256 is stored
// (constant-time re-check after the unique-index lookup); expired and revoked
// links answer 410; malformed and unknown tokens answer the same 404; each
// route has its own per-IP rate limit; responses are no-store and
// no-referrer; the token is masked in request logs
// (src/utils/log-redaction.js). A link reaches its own session, that
// session's annotations and decisions, and that session's file, nothing else.

import path from 'node:path';
import { sendStoredFile } from '../utils/send-file.js';
import {
  validateBody,
  reviewGuestAnnotationSchema,
  reviewGuestDecisionSchema,
} from '../validators/schemas.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { scanReviewMedia } from '../services/media-scan.service.js';
import {
  PUBLIC_THREAD_PAGE,
  ReviewSessionClosedError,
  annotationLimitFailure,
  annotationPositionData,
  applyDecisionStatus,
  loadAnnotationThreads,
  annotationPositionError,
  canWriteToSession,
  findShareLinkByToken,
  hashShareToken,
  isQuarantined,
  mediaKindFor,
  mediaSummary,
  publicAnnotation,
  publicDecision,
  sanitizeGuestName,
  sanitizePlainText,
  shareLinkFailure,
} from '../services/media-review.service.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const LAST_USED_RESOLUTION_MS = 60 * 1000;

// Per-IP limits on top of the global API limit (src/index.js).
const READ_LIMIT = { max: 60, timeWindow: '1 minute' };
const FILE_LIMIT = { max: 30, timeWindow: '1 minute' };
const ANNOTATE_LIMIT = { max: 20, timeWindow: '10 minutes' };
const DECIDE_LIMIT = { max: 10, timeWindow: '10 minutes' };

// Per-link limits, keyed on the token's SHA-256 (never the raw token), so
// one leaked link cannot be hammered from many addresses. They apply on top
// of the per-IP limits above.
export const SHARE_TOKEN_LIMITS = Object.freeze({
  view: { max: 120, timeWindow: '1 minute' },
  file: { max: 60, timeWindow: '1 minute' },
  annotate: { max: 30, timeWindow: '10 minutes' },
  decide: { max: 5, timeWindow: '10 minutes' },
});

/**
 * preHandler enforcing a per-share-link limit with @fastify/rate-limit's
 * `createRateLimit` (registered app-wide in src/index.js). Fails closed at
 * startup if the limiter is missing.
 */
function shareTokenLimiter(fastify, name) {
  if (typeof fastify.createRateLimit !== 'function') {
    throw new Error('review share-link routes require @fastify/rate-limit to be registered first');
  }
  const check = fastify.createRateLimit({
    ...SHARE_TOKEN_LIMITS[name],
    keyGenerator: (req) => `rv:${name}:${hashShareToken(String(req.params?.token ?? ''))}`,
  });
  return async function shareTokenRateLimit(request, reply) {
    const limit = await check(request);
    if (!limit.isAllowed && limit.isExceeded) {
      privateHeaders(reply);
      reply.header('Retry-After', String(limit.ttlInSeconds));
      return reply.status(429).send({ error: 'Too many requests for this review link. Try again later.', code: 'SHARE_LINK_RATE_LIMITED' });
    }
    return undefined;
  };
}

const DECISION_ALREADY_RECORDED = Object.freeze({
  error: 'A decision has already been recorded through this review link',
  code: 'SHARE_LINK_DECISION_RECORDED',
});

const LINK_INCLUDE = {
  session: {
    include: {
      attachment: { select: { id: true, organizationId: true, filename: true, originalName: true, mimeType: true, size: true, path: true } },
      project: { select: { deletedAt: true } },
    },
  },
};

function privateHeaders(reply) {
  reply.header('Cache-Control', 'no-store');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Robots-Tag', 'noindex, nofollow');
}

/**
 * Resolve the share link in the URL to its usable session, or send the
 * failure and return null.
 */
async function resolveShareLink(request, reply) {
  privateHeaders(reply);
  const link = await findShareLinkByToken(request.prisma, request.params.token, LINK_INCLUDE);
  const failure = shareLinkFailure(link);
  if (failure) {
    reply.status(failure.statusCode).send({ error: failure.error });
    return null;
  }
  const session = link.session;
  if (!session || session.project?.deletedAt || !session.attachment) {
    reply.status(404).send({ error: 'Review link not found' });
    return null;
  }
  const now = new Date();
  // Coarse "last used" for the staff list; one write per link per minute.
  await request.prisma.reviewShareLink.updateMany({
    where: {
      id: link.id,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_RESOLUTION_MS) } }],
    },
    data: { lastUsedAt: now },
  });
  return { link, session };
}

function guestIdentity(body) {
  const name = sanitizeGuestName(body.name);
  const email = body.email ? sanitizePlainText(body.email).toLowerCase() : null;
  return { name, email };
}

export default async function reviewPortalRoutes(fastify) {
  const limitView = shareTokenLimiter(fastify, 'view');
  const limitFile = shareTokenLimiter(fastify, 'file');
  const limitAnnotate = shareTokenLimiter(fastify, 'annotate');
  const limitDecide = shareTokenLimiter(fastify, 'decide');

  // The session, its file description and its annotations and decisions.
  fastify.get('/:token', { config: { public: true, rateLimit: READ_LIMIT }, preHandler: [limitView] }, async (request, reply) => {
    const resolved = await resolveShareLink(request, reply);
    if (!resolved) return reply;
    const { link, session } = resolved;
    const [threads, decisions, linkDecisions] = await Promise.all([
      loadAnnotationThreads(request.prisma, session.id, PUBLIC_THREAD_PAGE),
      request.prisma.reviewDecision.findMany({
        where: { sessionId: session.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
      request.prisma.reviewDecision.count({ where: { shareLinkId: link.id } }),
    ]);
    const canComment = canWriteToSession(session);
    return {
      session: {
        title: session.title,
        status: session.status,
        version: session.version,
        media: mediaSummary(session.attachment),
      },
      link: {
        expiresAt: link.expiresAt,
        allowDecision: link.allowDecision,
        canComment,
        // One decision per link; staff can still decide afterwards.
        decisionRecorded: linkDecisions > 0,
        canDecide: link.allowDecision && canComment && linkDecisions === 0,
      },
      annotations: threads.annotations.map(publicAnnotation),
      annotationTotal: threads.total,
      annotationsTruncated: threads.truncated,
      decisions: decisions.map(publicDecision),
    };
  });

  // The reviewed file, and only that file.
  fastify.get('/:token/file', { config: { public: true, rateLimit: FILE_LIMIT }, preHandler: [limitFile], compress: false }, async (request, reply) => {
    const resolved = await resolveShareLink(request, reply);
    if (!resolved) return reply;
    const { attachment } = resolved.session;
    const kind = mediaKindFor(attachment.mimeType);
    if (!kind || isQuarantined(attachment)) return reply.status(404).send({ error: 'File not available' });
    const scan = await scanReviewMedia(attachment);
    if (scan.verdict === 'blocked') return reply.status(403).send({ error: 'This file did not pass the media scan', code: 'MEDIA_BLOCKED' });
    if (scan.verdict === 'pending') return reply.status(409).send({ error: 'This file is still being scanned', code: 'MEDIA_SCAN_PENDING' });

    // Only this session's file; the stored path is reduced to its basename
    // inside the upload directory. Video and audio honour single byte
    // ranges so players can seek.
    const filepath = path.join(UPLOAD_DIR, path.basename(String(attachment.path)));
    try {
      const sent = await sendStoredFile(request, reply, {
        filepath,
        mimeType: attachment.mimeType,
        fileName: attachment.originalName,
        disposition: kind === 'pdf' ? 'attachment' : 'inline',
        allowRanges: kind === 'video' || kind === 'audio',
        headers: { 'Cross-Origin-Resource-Policy': 'same-origin' },
      });
      if (sent === null) return reply.status(404).send({ error: 'File not available' });
      return sent;
    } catch (err) {
      request.log.error({ err: { code: err?.code }, attachmentId: attachment.id }, 'review portal: file read failed');
      return reply.status(500).send({ error: 'Failed to load file' });
    }
  });

  // Add a comment (or a reply) as a named guest.
  fastify.post('/:token/annotations', {
    config: { public: true, rateLimit: ANNOTATE_LIMIT },
    preHandler: [limitAnnotate, validateBody(reviewGuestAnnotationSchema)],
  }, async (request, reply) => {
    const resolved = await resolveShareLink(request, reply);
    if (!resolved) return reply;
    const { link, session } = resolved;
    if (!canWriteToSession(session)) return reply.status(409).send({ error: 'This review is closed' });
    const input = request.body;
    const positionError = annotationPositionError(mediaKindFor(session.attachment.mimeType), input);
    if (positionError) return reply.status(400).send({ error: positionError });
    const { name, email } = guestIdentity(input);
    const body = sanitizePlainText(input.body);
    if (!name) return reply.status(400).send({ error: 'name: Enter your name' });
    if (!body) return reply.status(400).send({ error: 'body: Comment cannot be empty' });
    if (input.parentId) {
      const parent = await request.prisma.reviewAnnotation.findFirst({
        where: { id: input.parentId, sessionId: session.id, parentId: null },
        select: { id: true },
      });
      if (!parent) return reply.status(404).send({ error: 'Comment to reply to not found' });
    }
    const limit = await annotationLimitFailure(request.prisma, { sessionId: session.id, shareLinkId: link.id });
    if (limit) return reply.status(409).send(limit);
    const annotation = await request.prisma.reviewAnnotation.create({
      data: {
        sessionId: session.id,
        parentId: input.parentId ?? null,
        authorType: 'guest',
        authorName: name,
        authorEmail: email,
        shareLinkId: link.id,
        body,
        ...annotationPositionData(input),
      },
    });
    return reply.status(201).send({ annotation: publicAnnotation(annotation) });
  });

  // Approve or request changes, when the link allows decisions.
  fastify.post('/:token/decisions', {
    config: { public: true, rateLimit: DECIDE_LIMIT },
    preHandler: [limitDecide, validateBody(reviewGuestDecisionSchema)],
  }, async (request, reply) => {
    const resolved = await resolveShareLink(request, reply);
    if (!resolved) return reply;
    const { link, session } = resolved;
    if (!link.allowDecision) return reply.status(403).send({ error: 'This review link cannot record decisions' });
    if (!canWriteToSession(session)) return reply.status(409).send({ error: 'This review is closed' });
    const { name, email } = guestIdentity(request.body);
    if (!name) return reply.status(400).send({ error: 'name: Enter your name' });
    const { decision } = request.body;
    const note = request.body.note ? sanitizePlainText(request.body.note).slice(0, 2000) : '';
    if (await request.prisma.reviewDecision.count({ where: { shareLinkId: link.id } }) > 0) {
      return reply.status(409).send(DECISION_ALREADY_RECORDED);
    }
    let created;
    try {
      created = await request.prisma.$transaction(async (tx) => {
        const row = await tx.reviewDecision.create({
          data: {
            sessionId: session.id,
            decision,
            actorType: 'guest',
            actorName: name,
            actorEmail: email,
            shareLinkId: link.id,
            note: note || null,
          },
        });
        await applyDecisionStatus(tx, session.id, decision);
        return row;
      });
    } catch (err) {
      if (err instanceof ReviewSessionClosedError) return reply.status(409).send({ error: 'This review is closed', code: err.code });
      // Unique shareLinkId: a concurrent request recorded this link's decision.
      if (err?.code === 'P2002') return reply.status(409).send(DECISION_ALREADY_RECORDED);
      throw err;
    }
    // The guest's name and email stay on the decision row; the audit event
    // carries only ids and the transition.
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'review.decision_recorded',
      actorType: 'CLIENT',
      actorUserId: null,
      organizationId: session.organizationId,
      entityId: session.id,
      metadata: { decisionId: created.id, decision, fromStatus: session.status, toStatus: decision, via: 'share_link', shareLinkId: link.id },
    });
    return reply.status(201).send({ decision: publicDecision(created), status: decision });
  });
}
