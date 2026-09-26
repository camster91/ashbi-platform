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

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  validateBody,
  reviewGuestAnnotationSchema,
  reviewGuestDecisionSchema,
} from '../validators/schemas.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { scanReviewMedia } from '../services/media-scan.service.js';
import {
  annotationPositionData,
  annotationPositionError,
  canWriteToSession,
  findShareLinkByToken,
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
  // The session, its file description and its annotations and decisions.
  fastify.get('/:token', { config: { public: true, rateLimit: READ_LIMIT } }, async (request, reply) => {
    const resolved = await resolveShareLink(request, reply);
    if (!resolved) return reply;
    const { link, session } = resolved;
    const [annotations, decisions] = await Promise.all([
      request.prisma.reviewAnnotation.findMany({
        where: { sessionId: session.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1000,
      }),
      request.prisma.reviewDecision.findMany({
        where: { sessionId: session.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
    ]);
    return {
      session: {
        title: session.title,
        status: session.status,
        version: session.version,
        media: mediaSummary(session.attachment),
      },
      link: { expiresAt: link.expiresAt, allowDecision: link.allowDecision, canComment: canWriteToSession(session) },
      annotations: annotations.map(publicAnnotation),
      decisions: decisions.map(publicDecision),
    };
  });

  // The reviewed file, and only that file.
  fastify.get('/:token/file', { config: { public: true, rateLimit: FILE_LIMIT } }, async (request, reply) => {
    const resolved = await resolveShareLink(request, reply);
    if (!resolved) return reply;
    const { attachment } = resolved.session;
    const kind = mediaKindFor(attachment.mimeType);
    if (!kind || isQuarantined(attachment)) return reply.status(404).send({ error: 'File not available' });
    const scan = await scanReviewMedia(attachment);
    if (scan.verdict === 'blocked') return reply.status(403).send({ error: 'This file did not pass the media scan', code: 'MEDIA_BLOCKED' });
    if (scan.verdict === 'pending') return reply.status(409).send({ error: 'This file is still being scanned', code: 'MEDIA_SCAN_PENDING' });

    const filepath = path.join(UPLOAD_DIR, path.basename(String(attachment.path)));
    let stat;
    try {
      stat = await fsp.stat(filepath);
    } catch (err) {
      if (err?.code === 'ENOENT') return reply.status(404).send({ error: 'File not available' });
      request.log.error({ err: { code: err?.code }, attachmentId: attachment.id }, 'review portal: file stat failed');
      return reply.status(500).send({ error: 'Failed to load file' });
    }
    const safeName = path.basename(attachment.originalName).replace(/["\\\r\n]/g, '_');
    const disposition = kind === 'pdf' ? 'attachment' : 'inline';
    return reply
      .header('Content-Type', attachment.mimeType)
      .header('Content-Length', stat.size)
      .header('Content-Disposition', `${disposition}; filename="${safeName}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .send(fs.createReadStream(filepath));
  });

  // Add a comment (or a reply) as a named guest.
  fastify.post('/:token/annotations', {
    config: { public: true, rateLimit: ANNOTATE_LIMIT },
    preHandler: [validateBody(reviewGuestAnnotationSchema)],
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
    preHandler: [validateBody(reviewGuestDecisionSchema)],
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
    const created = await request.prisma.$transaction(async (tx) => {
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
      await tx.reviewSession.update({ where: { id: session.id }, data: { status: decision } });
      return row;
    });
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
