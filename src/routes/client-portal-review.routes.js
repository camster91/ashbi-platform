// Media review in the signed-in client portal (docs/media-review.md "Client
// portal reviews"). Registered by src/routes/client-portal.routes.js under
// /api/client-portal/reviews, with that plugin's `clientAuth` guard (a
// `client_session` cookie or bearer token, re-resolved to an active client
// user, contact and client on every request).
//
// /api/client-portal is tenancy-exempt (src/middleware/tenancy.js), so
// request.prisma is the raw client and every query here is confined by hand
// to review sessions whose project belongs to the caller's client in the
// caller's organization and is not in the trash (sessionScope below). A
// session of any other client or organization answers 404, exactly like an
// unknown id.
//
// A session is reachable only once staff shared it with the client
// (`sharedWithClient`, default off); an unshared session answers 404 like an
// unknown id. What a client sees: the session's title, status, version and file
// description, every annotation (staff, share-link guest and client comments
// alike: review comments have no internal-only flag, see the docs), and the
// decision history, serialized with publicAnnotation/publicDecision (no staff
// user ids, guest emails, share-link ids or storage paths). Clients comment
// as themselves (their contact name) and may approve or request changes only
// when staff turned that on for the session (`clientCanDecide`).

import path from 'node:path';
import { sendStoredFile } from '../utils/send-file.js';
import {
  validateBody,
  validateParams,
  validateQuery,
  clientPortalReviewAnnotationSchema,
  clientPortalReviewDecisionSchema,
  clientPortalReviewListQuerySchema,
  clientPortalReviewParamsSchema,
} from '../validators/schemas.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { scanReviewMedia } from '../services/media-scan.service.js';
import {
  ANNOTATIONS_PER_LINK_MAX,
  PUBLIC_THREAD_PAGE,
  ReviewSessionClosedError,
  annotationLimitFailure,
  annotationPositionData,
  annotationPositionError,
  applyDecisionStatus,
  canWriteToSession,
  commentExcerpt,
  isQuarantined,
  loadAnnotationThreads,
  loadVersionChain,
  lockOpenSession,
  mediaKindFor,
  mediaSummary,
  notifyReviewStaff,
  publicAnnotation,
  publicDecision,
  sanitizeGuestName,
  sanitizePlainText,
} from '../services/media-review.service.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Per-IP limits, the same as the share-link routes
// (src/routes/review-portal.routes.js), on top of the global API limit.
const READ_LIMIT = { max: 60, timeWindow: '1 minute' };
const FILE_LIMIT = { max: 30, timeWindow: '1 minute' };
const ANNOTATE_LIMIT = { max: 20, timeWindow: '10 minutes' };
const DECIDE_LIMIT = { max: 10, timeWindow: '10 minutes' };

// Per-client-user limits, so one account cannot be driven from many
// addresses. They mirror the per-link limits of share links.
export const CLIENT_REVIEW_LIMITS = Object.freeze({
  view: { max: 120, timeWindow: '1 minute' },
  file: { max: 60, timeWindow: '1 minute' },
  annotate: { max: 30, timeWindow: '10 minutes' },
  decide: { max: 5, timeWindow: '10 minutes' },
});

const NOT_FOUND = Object.freeze({ error: 'Review not found' });

/**
 * The only review sessions a client portal user may reach: sessions staff
 * shared with the client (`sharedWithClient`, opt-in), on projects of their
 * own client, in their own organization, not in the trash.
 * @param {{ clientId: string, organizationId: string }} clientUser
 */
export function sessionScope(clientUser) {
  return {
    organizationId: clientUser.organizationId,
    sharedWithClient: true,
    project: { clientId: clientUser.clientId, organizationId: clientUser.organizationId, deletedAt: null },
  };
}

const SESSION_INCLUDE = {
  attachment: { select: { id: true, filename: true, originalName: true, mimeType: true, size: true, path: true } },
  project: { select: { id: true, name: true } },
  nextSession: { select: { id: true } },
};

function clientSession(session) {
  return {
    id: session.id,
    projectId: session.projectId,
    projectName: session.project?.name ?? null,
    title: session.title,
    status: session.status,
    version: session.version,
    previousSessionId: session.previousSessionId ?? null,
    nextSessionId: session.nextSession?.id ?? null,
    createdAt: session.createdAt,
    // A web page capture says so, without the (possibly internal) URL.
    capture: session.captureViewport ? { viewport: session.captureViewport } : null,
    media: session.attachment ? mediaSummary(session.attachment) : null,
  };
}

function privateHeaders(reply) {
  reply.header('Cache-Control', 'no-store');
}

/**
 * @param {any} fastify
 * @param {{ clientAuth: Function }} options the client portal's own guard
 */
export default async function clientPortalReviewRoutes(fastify, options) {
  const { clientAuth } = options ?? {};
  if (typeof clientAuth !== 'function') throw new Error('client portal review routes need the client portal clientAuth guard');

  // Fails closed per request (503) if @fastify/rate-limit is not registered
  // (it is, app-wide, in src/index.js), so the rest of the client portal
  // still starts in a harness without it.
  const perUser = (name) => {
    if (typeof fastify.createRateLimit !== 'function') {
      return async function clientReviewRateLimit(_request, reply) {
        return reply.status(503).send({ error: 'Review is temporarily unavailable', code: 'RATE_LIMITER_UNAVAILABLE' });
      };
    }
    const check = fastify.createRateLimit({
      ...CLIENT_REVIEW_LIMITS[name],
      keyGenerator: (request) => `crv:${name}:${request.clientUser?.id ?? 'anonymous'}`,
    });
    return async function clientReviewRateLimit(request, reply) {
      const limit = await check(request);
      if (!limit.isAllowed && limit.isExceeded) {
        privateHeaders(reply);
        reply.header('Retry-After', String(limit.ttlInSeconds));
        return reply.status(429).send({ error: 'Too many review requests. Try again later.', code: 'CLIENT_REVIEW_RATE_LIMITED' });
      }
      return undefined;
    };
  };
  const limitView = perUser('view');
  const limitFile = perUser('file');
  const limitAnnotate = perUser('annotate');
  const limitDecide = perUser('decide');

  async function loadSession(request, reply) {
    privateHeaders(reply);
    const session = await request.prisma.reviewSession.findFirst({
      where: { id: request.params.id, ...sessionScope(request.clientUser) },
      include: SESSION_INCLUDE,
    });
    if (!session || !session.attachment) {
      reply.status(404).send(NOT_FOUND);
      return null;
    }
    return session;
  }

  /** The signed-in contact's display name and email, from the database. */
  async function authorIdentity(request) {
    const contact = await request.prisma.contact.findFirst({
      where: { id: request.clientUser.contactId, clientId: request.clientUser.clientId },
      select: { name: true, email: true },
    });
    const name = sanitizeGuestName(contact?.name || '') || 'Client';
    const email = contact?.email ? sanitizePlainText(contact.email).toLowerCase().slice(0, 254) : null;
    return { name, email };
  }

  // The client's review sessions, newest first, optionally for one project.
  fastify.get('/', {
    config: { rateLimit: READ_LIMIT },
    preHandler: [clientAuth, limitView, validateQuery(clientPortalReviewListQuerySchema)],
  }, async (request, reply) => {
    privateHeaders(reply);
    const where = { ...sessionScope(request.clientUser) };
    if (request.query.projectId) where.projectId = request.query.projectId;
    const sessions = await request.prisma.reviewSession.findMany({
      where,
      include: {
        ...SESSION_INCLUDE,
        annotations: { where: { parentId: null, resolvedAt: null }, select: { id: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return {
      sessions: sessions.map((session) => ({ ...clientSession(session), openAnnotationCount: session.annotations.length })),
    };
  });

  // One session with its annotations, decisions and versions.
  fastify.get('/:id', {
    config: { rateLimit: READ_LIMIT },
    preHandler: [clientAuth, limitView, validateParams(clientPortalReviewParamsSchema)],
  }, async (request, reply) => {
    const session = await loadSession(request, reply);
    if (!session) return reply;
    const [threads, decisions, versions] = await Promise.all([
      loadAnnotationThreads(request.prisma, session.id, PUBLIC_THREAD_PAGE),
      request.prisma.reviewDecision.findMany({
        where: { sessionId: session.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
      loadVersionChain(request.prisma, session, { ...sessionScope(request.clientUser), projectId: session.projectId }),
    ]);
    const canComment = canWriteToSession(session);
    return {
      session: clientSession(session),
      versions,
      permissions: { canComment, canDecide: canComment && Boolean(session.clientCanDecide) },
      annotations: threads.annotations.map(publicAnnotation),
      annotationTotal: threads.total,
      annotationsTruncated: threads.truncated,
      decisions: decisions.map(publicDecision),
    };
  });

  // The session's file, and only that file.
  fastify.get('/:id/file', {
    config: { rateLimit: FILE_LIMIT },
    preHandler: [clientAuth, limitFile, validateParams(clientPortalReviewParamsSchema)],
    compress: false,
  }, async (request, reply) => {
    const session = await loadSession(request, reply);
    if (!session) return reply;
    const { attachment } = session;
    const kind = mediaKindFor(attachment.mimeType);
    if (!kind || isQuarantined(attachment)) return reply.status(404).send({ error: 'File not available' });
    const scan = await scanReviewMedia(attachment);
    if (scan.verdict === 'blocked') return reply.status(403).send({ error: 'This file did not pass the media scan', code: 'MEDIA_BLOCKED' });
    if (scan.verdict === 'pending') return reply.status(409).send({ error: 'This file is still being scanned', code: 'MEDIA_SCAN_PENDING' });
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
      request.log.error({ err: { code: err?.code }, attachmentId: attachment.id }, 'client portal review: file read failed');
      return reply.status(500).send({ error: 'Failed to load file' });
    }
  });

  // Comment (or reply) as the signed-in client contact.
  fastify.post('/:id/annotations', {
    config: { rateLimit: ANNOTATE_LIMIT },
    preHandler: [clientAuth, limitAnnotate, validateParams(clientPortalReviewParamsSchema), validateBody(clientPortalReviewAnnotationSchema)],
  }, async (request, reply) => {
    const session = await loadSession(request, reply);
    if (!session) return reply;
    if (!canWriteToSession(session)) return reply.status(409).send({ error: 'This review is closed' });
    const input = request.body;
    const positionError = annotationPositionError(mediaKindFor(session.attachment.mimeType), input);
    if (positionError) return reply.status(400).send({ error: positionError });
    const body = sanitizePlainText(input.body);
    if (!body) return reply.status(400).send({ error: 'body: Comment cannot be empty' });
    if (input.parentId) {
      const parent = await request.prisma.reviewAnnotation.findFirst({
        where: { id: input.parentId, sessionId: session.id, parentId: null },
        select: { id: true },
      });
      if (!parent) return reply.status(404).send({ error: 'Comment to reply to not found' });
    }
    const limit = await annotationLimitFailure(request.prisma, { sessionId: session.id });
    if (limit) return reply.status(409).send(limit);
    if (await request.prisma.reviewAnnotation.count({ where: { sessionId: session.id, authorUserId: request.clientUser.id } }) >= ANNOTATIONS_PER_LINK_MAX) {
      return reply.status(409).send({ error: `You have reached the limit of ${ANNOTATIONS_PER_LINK_MAX} comments on this review`, code: 'ANNOTATION_LIMIT_REACHED' });
    }
    const { name, email } = await authorIdentity(request);
    let annotation;
    try {
      annotation = await request.prisma.$transaction(async (tx) => {
        await lockOpenSession(tx, session.id);
        return tx.reviewAnnotation.create({
          data: {
            sessionId: session.id,
            parentId: input.parentId ?? null,
            authorType: 'client',
            authorUserId: request.clientUser.id,
            authorName: name,
            authorEmail: email,
            body,
            ...annotationPositionData(input),
          },
        });
      });
    } catch (err) {
      if (err instanceof ReviewSessionClosedError) return reply.status(409).send({ error: 'This review is closed', code: err.code });
      throw err;
    }
    await notifyReviewStaff(fastify, [session.createdById], {
      type: 'REVIEW_COMMENT',
      title: 'New client comment on a review',
      message: `${name} commented on "${session.title}": ${commentExcerpt(body)}`,
      data: { reviewSessionId: session.id, projectId: session.projectId, annotationId: annotation.id },
    }, { log: request.log });
    return reply.status(201).send({ annotation: publicAnnotation(annotation) });
  });

  // Approve or request changes, when staff allowed client decisions.
  fastify.post('/:id/decisions', {
    config: { rateLimit: DECIDE_LIMIT },
    preHandler: [clientAuth, limitDecide, validateParams(clientPortalReviewParamsSchema), validateBody(clientPortalReviewDecisionSchema)],
  }, async (request, reply) => {
    const session = await loadSession(request, reply);
    if (!session) return reply;
    if (!session.clientCanDecide) return reply.status(403).send({ error: 'Decisions on this review are made by the team', code: 'CLIENT_DECISION_NOT_ALLOWED' });
    if (!canWriteToSession(session)) return reply.status(409).send({ error: 'This review is closed' });
    const { decision } = request.body;
    const note = request.body.note ? sanitizePlainText(request.body.note).slice(0, 2000) : '';
    const { name, email } = await authorIdentity(request);
    let created;
    try {
      created = await request.prisma.$transaction(async (tx) => {
        const row = await tx.reviewDecision.create({
          data: {
            sessionId: session.id,
            decision,
            actorType: 'client',
            actorUserId: request.clientUser.id,
            actorName: name,
            actorEmail: email,
            note: note || null,
          },
        });
        await applyDecisionStatus(tx, session.id, decision);
        return row;
      });
    } catch (err) {
      if (err instanceof ReviewSessionClosedError) return reply.status(409).send({ error: 'This review is closed', code: err.code });
      throw err;
    }
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'review.decision_recorded',
      actorType: 'CLIENT',
      actorUserId: request.clientUser.id,
      organizationId: session.organizationId,
      entityId: session.id,
      metadata: { decisionId: created.id, decision, fromStatus: session.status, toStatus: decision, via: 'client_portal' },
    });
    await notifyReviewStaff(fastify, [session.createdById], {
      type: 'REVIEW_DECISION',
      title: decision === 'approved' ? 'A client approved a review' : 'A client requested changes',
      message: `${name} ${decision === 'approved' ? 'approved' : 'requested changes on'} "${session.title}"`,
      data: { reviewSessionId: session.id, projectId: session.projectId, decisionId: created.id },
    }, { log: request.log });
    return reply.status(201).send({ decision: publicDecision(created), status: decision });
  });
}
