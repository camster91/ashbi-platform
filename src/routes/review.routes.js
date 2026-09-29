// Media review staff API (#417 slice 1, docs/media-review.md).
//
// Every route is tenant-scoped: request.prisma is the organization-scoped
// client, and the tenant proxy verifies that a new session's project,
// attachment and previous version belong to the caller's organization, and
// that annotations, decisions and share links are reached only through a
// session of that organization.
//
// Web page review (POST /capture, POST /:id/recapture) renders a public URL
// in a headless browser behind the SSRF controls of
// src/services/web-capture.service.js. It is off unless
// WEB_REVIEW_CAPTURE_ENABLED=true; while off both routes answer
// 503 WEB_REVIEW_CAPTURE_DISABLED.

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import env from '../config/env.js';

import {
  validateBody,
  validateQuery,
  reviewSessionListQuerySchema,
  reviewSessionCreateSchema,
  reviewAnnotationCreateSchema,
  reviewAnnotationResolveSchema,
  reviewDecisionCreateSchema,
  reviewShareLinkCreateSchema,
  reviewCaptureCreateSchema,
  reviewRecaptureSchema,
  reviewClientAccessSchema,
} from '../validators/schemas.js';
import { captureWebPage as defaultCaptureWebPage, WebCaptureError } from '../services/web-capture.service.js';
import { requireRecentAuth } from '../auth/reauth.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { scanReviewMedia } from '../services/media-scan.service.js';
import {
  ANNOTATIONS_PER_SESSION_MAX,
  ReviewSessionClosedError,
  lockOpenSession,
  annotationLimitFailure,
  annotationPositionData,
  applyDecisionStatus,
  loadAnnotationThreads,
  annotationPositionError,
  canWriteToSession,
  generateShareToken,
  isQuarantined,
  mediaKindFor,
  mediaSummary,
  sanitizePlainText,
  shareLinkExpiry,
  shareLinkState,
  staffAnnotation,
  staffDecision,
  staffShareLink,
  loadVersionChain,
  findMentionableStaff,
  notifyReviewStaff,
  commentExcerpt,
} from '../services/media-review.service.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
// Capturing a page starts a browser: a tight per-IP budget on top of the
// capture service's own concurrency limit.
const CAPTURE_LIMIT = { max: 10, timeWindow: '10 minutes' };
const CAPTURE_SERVER_ERRORS = Object.freeze({
  WEB_CAPTURE_FAILED: 'The page could not be loaded. Check that it is public and try again.',
  WEB_CAPTURE_TIMEOUT: 'The page did not finish loading in time.',
  WEB_CAPTURE_UNAVAILABLE: 'Web page capture is not available on this server.',
});
export const WEB_CAPTURE_DISABLED = Object.freeze({
  error: 'Web page review is not enabled on this server',
  code: 'WEB_REVIEW_CAPTURE_DISABLED',
});

const STAFF_ROLES = new Set(['ADMIN', 'TEAM']);

/** Media review is a staff workspace: bots and other principals are refused. */
async function requireReviewStaff(request, reply) {
  if (!STAFF_ROLES.has(request.user?.role)) {
    return reply.status(403).send({ error: 'Staff access required' });
  }
  return undefined;
}

function staffSession(session) {
  return {
    id: session.id,
    projectId: session.projectId,
    attachmentId: session.attachmentId,
    title: session.title,
    status: session.status,
    version: session.version,
    sourceUrl: session.sourceUrl ?? null,
    captureViewport: session.captureViewport ?? null,
    clientCanDecide: Boolean(session.clientCanDecide),
    previousSessionId: session.previousSessionId ?? null,
    nextSessionId: session.nextSession?.id ?? null,
    createdById: session.createdById,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    media: session.attachment ? { ...mediaSummary(session.attachment), filename: session.attachment.filename } : null,
  };
}

const SESSION_INCLUDE = {
  attachment: { select: { id: true, filename: true, originalName: true, mimeType: true, size: true, path: true } },
  nextSession: { select: { id: true } },
};

/** "example.com-desktop-2026-09-29.png": the stored name of a page capture. */
function captureFileName(url, viewport) {
  const host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '').slice(0, 100) || 'page';
  return `${host}-${viewport}-${new Date().toISOString().slice(0, 10)}.png`;
}

/**
 * @param {any} fastify
 * @param {{ webCaptureEnabled?: boolean, captureWebPage?: Function, uploadDir?: string }} [options]
 *   test seams: the feature flag, the capture service and the upload directory
 */
export default async function reviewRoutes(fastify, options = {}) {
  const webCaptureEnabled = () => options.webCaptureEnabled ?? env.webReviewCaptureEnabled;
  const captureWebPage = options.captureWebPage ?? defaultCaptureWebPage;
  const uploadDir = options.uploadDir ?? UPLOAD_DIR;

  async function loadSession(request, reply) {
    const session = await request.prisma.reviewSession.findFirst({
      where: { id: request.params.id, project: { deletedAt: null } },
      include: SESSION_INCLUDE,
    });
    if (!session) {
      reply.status(404).send({ error: 'Review session not found' });
      return null;
    }
    return session;
  }

  // List a project's review sessions, newest first.
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireReviewStaff, validateQuery(reviewSessionListQuerySchema)],
  }, async (request, reply) => {
    const { projectId } = request.query;
    const project = await request.prisma.project.findFirst({ where: { id: projectId }, select: { id: true } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    const sessions = await request.prisma.reviewSession.findMany({
      where: { projectId },
      include: {
        ...SESSION_INCLUDE,
        annotations: { where: { parentId: null, resolvedAt: null }, select: { id: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return {
      sessions: sessions.map((session) => ({
        ...staffSession(session),
        openAnnotationCount: session.annotations.length,
      })),
    };
  });

  // Put a project attachment up for review. With previousSessionId, the new
  // session is the next version of that session, which is closed.
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireReviewStaff, validateBody(reviewSessionCreateSchema)],
  }, async (request, reply) => {
    const { projectId, attachmentId, title, previousSessionId } = request.body;
    const project = await request.prisma.project.findFirst({ where: { id: projectId }, select: { id: true } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const attachment = await request.prisma.attachment.findFirst({
      where: { id: attachmentId, entityType: 'PROJECT', entityId: projectId },
    });
    if (!attachment || isQuarantined(attachment)) return reply.status(404).send({ error: 'Attachment not found in this project' });
    const kind = mediaKindFor(attachment.mimeType);
    if (!kind) return reply.status(422).send({ error: 'Only images, PDFs, video and audio can be reviewed' });

    const scan = await scanReviewMedia(attachment);
    if (scan.verdict === 'blocked') return reply.status(422).send({ error: 'This file did not pass the media scan', code: 'MEDIA_BLOCKED' });
    if (scan.verdict === 'pending') return reply.status(409).send({ error: 'This file is still being scanned; try again shortly', code: 'MEDIA_SCAN_PENDING' });

    let previous = null;
    if (previousSessionId) {
      previous = await loadPrevious(request, reply, previousSessionId, projectId);
      if (!previous) return reply;
    }

    const session = await createVersionedSession(request, reply, { projectId, attachmentId, title, previous });
    if (!session) return reply;

    await recordRequestAuditEvent(request.prisma, request, {
      action: 'review.session_created',
      entityId: session.id,
      metadata: { projectId, attachmentId, version: session.version, previousSessionId: previous?.id ?? null, mediaKind: kind },
    });
    return reply.status(201).send({ session: staffSession(session) });
  });

  /** The session a new version replaces, or send 404/409 and return null. */
  async function loadPrevious(request, reply, previousSessionId, projectId) {
    const previous = await request.prisma.reviewSession.findFirst({
      where: { id: previousSessionId, projectId },
      include: { nextSession: { select: { id: true } } },
    });
    if (!previous) {
      reply.status(404).send({ error: 'Previous review session not found in this project' });
      return null;
    }
    if (previous.nextSession) {
      reply.status(409).send({ error: 'That review session already has a newer version' });
      return null;
    }
    return previous;
  }

  /**
   * Create a session, as the next version of `previous` (which is closed in
   * the same transaction) when given. Sends 409 and returns null when a
   * concurrent request created that version first.
   */
  async function createVersionedSession(request, reply, { projectId, attachmentId, title, previous, sourceUrl = null, captureViewport = null }) {
    try {
      return await request.prisma.$transaction(async (tx) => {
        const created = await tx.reviewSession.create({
          data: {
            projectId,
            attachmentId,
            title: sanitizePlainText(title).slice(0, 200) || 'Review',
            version: previous ? previous.version + 1 : 1,
            previousSessionId: previous?.id ?? null,
            sourceUrl,
            captureViewport,
            createdById: request.user.id,
          },
          include: SESSION_INCLUDE,
        });
        if (previous && previous.status !== 'closed') {
          await tx.reviewSession.update({ where: { id: previous.id }, data: { status: 'closed' } });
        }
        return created;
      });
    } catch (err) {
      // Unique previousSessionId: a concurrent request created the version first.
      if (err?.code === 'P2002') {
        reply.status(409).send({ error: 'That review session already has a newer version' });
        return null;
      }
      throw err;
    }
  }

  // Whether optional review features are available (the UI hides what is not).
  fastify.get('/capabilities', { onRequest: [fastify.authenticate], preHandler: [requireReviewStaff] }, async () => ({
    webCapture: { enabled: Boolean(webCaptureEnabled()), viewports: ['desktop', 'mobile'] },
  }));

  /**
   * Capture `url`, store the PNG as a project attachment (the same storage
   * and file policy as uploads) and return the attachment, or send the
   * capture error and return null.
   */
  async function captureToAttachment(request, reply, { projectId, url, viewport }) {
    let capture;
    try {
      capture = await captureWebPage({ url, viewport });
    } catch (err) {
      if (err instanceof WebCaptureError) {
        // 4xx: the service's own fixed, caller-safe messages (e.g. why a URL
        // was refused). 5xx: a fixed message per code, never err.message.
        if (err.statusCode < 500) reply.status(err.statusCode).send({ error: err.message, code: err.code });
        else reply.status(err.statusCode).send({ error: CAPTURE_SERVER_ERRORS[err.code] ?? CAPTURE_SERVER_ERRORS.WEB_CAPTURE_FAILED, code: err.code });
        return null;
      }
      throw err;
    }
    const filename = `${randomUUID()}.png`;
    const filepath = path.join(uploadDir, filename);
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(filepath, capture.png);
    try {
      const attachment = await request.prisma.attachment.create({
        data: {
          filename,
          originalName: captureFileName(capture.url, capture.viewport),
          mimeType: 'image/png',
          size: capture.png.length,
          path: `/uploads/${filename}`,
          entityType: 'PROJECT',
          entityId: projectId,
          uploadedById: request.user.id,
          organizationId: request.user.organizationId,
        },
      });
      return { attachment, capture };
    } catch (err) {
      await fs.unlink(filepath).catch(() => {});
      throw err;
    }
  }

  // Web page review: capture a public URL and put the screenshot up for
  // review.
  fastify.post('/capture', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: CAPTURE_LIMIT },
    preHandler: [requireReviewStaff, validateBody(reviewCaptureCreateSchema)],
  }, async (request, reply) => {
    if (!webCaptureEnabled()) return reply.status(503).send(WEB_CAPTURE_DISABLED);
    const { projectId, url, viewport, title } = request.body;
    const project = await request.prisma.project.findFirst({ where: { id: projectId }, select: { id: true } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    const captured = await captureToAttachment(request, reply, { projectId, url, viewport });
    if (!captured) return reply;
    const { attachment, capture } = captured;
    const session = await createVersionedSession(request, reply, {
      projectId, attachmentId: attachment.id, title, previous: null, sourceUrl: capture.url, captureViewport: capture.viewport,
    });
    if (!session) return reply;
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'review.session_created',
      entityId: session.id,
      metadata: {
        projectId, attachmentId: attachment.id, version: 1, previousSessionId: null, mediaKind: 'image',
        sourceHost: new URL(capture.url).host, captureViewport: capture.viewport, captureTruncated: capture.truncated,
      },
    });
    return reply.status(201).send({ session: staffSession(session), capture: { truncated: capture.truncated, finalUrl: capture.finalUrl } });
  });

  // Capture a web page review's URL again, as the next version.
  fastify.post('/:id/recapture', {
    onRequest: [fastify.authenticate],
    config: { rateLimit: CAPTURE_LIMIT },
    preHandler: [requireReviewStaff, validateBody(reviewRecaptureSchema)],
  }, async (request, reply) => {
    if (!webCaptureEnabled()) return reply.status(503).send(WEB_CAPTURE_DISABLED);
    const current = await loadSession(request, reply);
    if (!current) return reply;
    if (!current.sourceUrl) return reply.status(422).send({ error: 'Only web page reviews can be recaptured', code: 'NOT_A_WEB_CAPTURE' });
    const previous = await loadPrevious(request, reply, current.id, current.projectId);
    if (!previous) return reply;
    const viewport = request.body.viewport ?? current.captureViewport ?? 'desktop';
    const captured = await captureToAttachment(request, reply, { projectId: current.projectId, url: current.sourceUrl, viewport });
    if (!captured) return reply;
    const { attachment, capture } = captured;
    const session = await createVersionedSession(request, reply, {
      projectId: current.projectId, attachmentId: attachment.id, title: current.title, previous, sourceUrl: capture.url, captureViewport: capture.viewport,
    });
    if (!session) return reply;
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'review.session_created',
      entityId: session.id,
      metadata: {
        projectId: current.projectId, attachmentId: attachment.id, version: session.version, previousSessionId: previous.id, mediaKind: 'image',
        sourceHost: new URL(capture.url).host, captureViewport: capture.viewport, captureTruncated: capture.truncated,
      },
    });
    return reply.status(201).send({ session: staffSession(session), capture: { truncated: capture.truncated, finalUrl: capture.finalUrl } });
  });

  // One session with its annotations, decisions and share links.
  fastify.get('/:id', { onRequest: [fastify.authenticate], preHandler: [requireReviewStaff] }, async (request, reply) => {
    const session = await loadSession(request, reply);
    if (!session) return reply;
    const [threads, decisions, shareLinks, versions] = await Promise.all([
      loadAnnotationThreads(request.prisma, session.id, ANNOTATIONS_PER_SESSION_MAX),
      request.prisma.reviewDecision.findMany({ where: { sessionId: session.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 }),
      request.prisma.reviewShareLink.findMany({ where: { sessionId: session.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
      loadVersionChain(request.prisma, session, { projectId: session.projectId }),
    ]);
    const now = new Date();
    return {
      session: staffSession(session),
      versions,
      annotations: threads.annotations.map(staffAnnotation),
      annotationTotal: threads.total,
      annotationsTruncated: threads.truncated,
      decisions: decisions.map(staffDecision),
      shareLinks: shareLinks.map((link) => staffShareLink(link, now)),
    };
  });

  // Add an annotation, or a reply to one (parentId).
  fastify.post('/:id/annotations', {
    onRequest: [fastify.authenticate],
    preHandler: [requireReviewStaff, validateBody(reviewAnnotationCreateSchema)],
  }, async (request, reply) => {
    const session = await loadSession(request, reply);
    if (!session) return reply;
    if (!canWriteToSession(session)) return reply.status(409).send({ error: 'This review session is closed' });
    const input = request.body;
    const positionError = annotationPositionError(mediaKindFor(session.attachment?.mimeType), input);
    if (positionError) return reply.status(400).send({ error: positionError });
    if (input.parentId) {
      const parent = await request.prisma.reviewAnnotation.findFirst({ where: { id: input.parentId, sessionId: session.id, parentId: null } });
      if (!parent) return reply.status(404).send({ error: 'Annotation to reply to not found' });
    }
    const body = sanitizePlainText(input.body);
    if (!body) return reply.status(400).send({ error: 'body: Comment cannot be empty' });
    const mentioned = await findMentionableStaff(request.prisma, request.user.organizationId, input.mentionUserIds);
    if (!mentioned) return reply.status(400).send({ error: 'Mentions must be active team members of your organization', code: 'INVALID_MENTION' });
    const limit = await annotationLimitFailure(request.prisma, { sessionId: session.id });
    if (limit) return reply.status(409).send(limit);
    let annotation;
    try {
      annotation = await request.prisma.$transaction(async (tx) => {
        await lockOpenSession(tx, session.id);
        return tx.reviewAnnotation.create({
          data: {
            sessionId: session.id,
            parentId: input.parentId ?? null,
            authorType: 'staff',
            authorUserId: request.user.id,
            authorName: String(request.user.name || request.user.email || 'Staff').slice(0, 120),
            body,
            ...annotationPositionData(input),
          },
        });
      });
    } catch (err) {
      if (err instanceof ReviewSessionClosedError) return reply.status(409).send({ error: 'This review session is closed', code: err.code });
      throw err;
    }
    await notifyReviewStaff(fastify, mentioned.map((user) => user.id), {
      type: 'MENTION',
      title: 'You were mentioned in a review',
      message: `${annotation.authorName} mentioned you on "${session.title}": ${commentExcerpt(body)}`,
      data: { reviewSessionId: session.id, projectId: session.projectId, annotationId: annotation.id },
    }, { actorUserId: request.user.id, log: request.log });
    return reply.status(201).send({ annotation: staffAnnotation(annotation) });
  });

  // Resolve or reopen a top-level annotation.
  fastify.post('/:id/annotations/:annotationId/resolve', {
    onRequest: [fastify.authenticate],
    preHandler: [requireReviewStaff, validateBody(reviewAnnotationResolveSchema)],
  }, async (request, reply) => {
    const session = await loadSession(request, reply);
    if (!session) return reply;
    if (!canWriteToSession(session)) return reply.status(409).send({ error: 'This review session is closed' });
    const existing = await request.prisma.reviewAnnotation.findFirst({
      where: { id: request.params.annotationId, sessionId: session.id, parentId: null },
    });
    if (!existing) return reply.status(404).send({ error: 'Annotation not found' });
    const annotation = await request.prisma.reviewAnnotation.update({
      where: { id: existing.id },
      data: request.body.resolved
        ? { resolvedAt: existing.resolvedAt ?? new Date(), resolvedById: existing.resolvedById ?? request.user.id }
        : { resolvedAt: null, resolvedById: null },
    });
    return { annotation: staffAnnotation(annotation) };
  });

  // Record an approval decision (append-only); it sets the session status.
  fastify.post('/:id/decisions', {
    onRequest: [fastify.authenticate],
    preHandler: [requireReviewStaff, validateBody(reviewDecisionCreateSchema)],
  }, async (request, reply) => {
    const session = await loadSession(request, reply);
    if (!session) return reply;
    if (!canWriteToSession(session)) return reply.status(409).send({ error: 'This review session is closed' });
    const { decision, note } = request.body;
    const cleanNote = note ? sanitizePlainText(note).slice(0, 2000) : '';
    let created;
    try {
      created = await request.prisma.$transaction(async (tx) => {
        const row = await tx.reviewDecision.create({
          data: {
            sessionId: session.id,
            decision,
            actorType: 'staff',
            actorUserId: request.user.id,
            actorName: String(request.user.name || request.user.email || 'Staff').slice(0, 120),
            note: cleanNote || null,
          },
        });
        await applyDecisionStatus(tx, session.id, decision);
        return row;
      });
    } catch (err) {
      // Closed (e.g. replaced by a new version) after it was read: the
      // decision is rolled back rather than reopening the session.
      if (err instanceof ReviewSessionClosedError) return reply.status(409).send({ error: err.message, code: err.code });
      throw err;
    }
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'review.decision_recorded',
      entityId: session.id,
      metadata: { decisionId: created.id, decision, fromStatus: session.status, toStatus: decision, via: 'staff' },
    });
    return reply.status(201).send({ decision: staffDecision(created), status: decision });
  });

  // Whether the project's client portal users may approve or request
  // changes. Every review of a client's project is visible to that client's
  // portal users; decisions are opt-in, like share-link decisions.
  fastify.post('/:id/client-access', {
    onRequest: [fastify.authenticate],
    preHandler: [requireReviewStaff, validateBody(reviewClientAccessSchema)],
  }, async (request, reply) => {
    const session = await loadSession(request, reply);
    if (!session) return reply;
    if (!canWriteToSession(session)) return reply.status(409).send({ error: 'This review session is closed' });
    const { clientCanDecide } = request.body;
    if (Boolean(session.clientCanDecide) !== clientCanDecide) {
      await request.prisma.reviewSession.update({ where: { id: session.id }, data: { clientCanDecide } });
      await recordRequestAuditEvent(request.prisma, request, {
        action: 'review.client_access_changed',
        entityId: session.id,
        metadata: { clientCanDecide },
      });
    }
    return { clientCanDecide };
  });

  fastify.get('/:id/share-links', { onRequest: [fastify.authenticate], preHandler: [requireReviewStaff] }, async (request, reply) => {
    const session = await loadSession(request, reply);
    if (!session) return reply;
    const links = await request.prisma.reviewShareLink.findMany({
      where: { sessionId: session.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    const now = new Date();
    return { shareLinks: links.map((link) => staffShareLink(link, now)) };
  });

  // Create a client share link. It exposes this session outside the tenant,
  // so it needs recent re-authentication (docs/privileged-actions.md). The
  // raw token is returned once; only its SHA-256 is stored.
  fastify.post('/:id/share-links', {
    onRequest: [fastify.authenticate],
    preHandler: [requireReviewStaff, requireRecentAuth, validateBody(reviewShareLinkCreateSchema)],
  }, async (request, reply) => {
    const session = await loadSession(request, reply);
    if (!session) return reply;
    if (!canWriteToSession(session)) return reply.status(409).send({ error: 'This review session is closed' });
    const expiry = shareLinkExpiry(request.body.expiresInDays);
    if (expiry.error) return reply.status(400).send({ error: expiry.error });
    const { token, tokenHash } = generateShareToken();
    const label = request.body.label ? sanitizePlainText(request.body.label).replace(/\s+/g, ' ').slice(0, 120) : '';
    const link = await request.prisma.reviewShareLink.create({
      data: {
        sessionId: session.id,
        tokenHash,
        label: label || null,
        expiresAt: expiry.expiresAt,
        allowDecision: Boolean(request.body.allowDecision),
        createdById: request.user.id,
      },
    });
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'review.share_link_created',
      entityId: link.id,
      metadata: { sessionId: session.id, expiresAt: link.expiresAt, expiresInDays: expiry.days, allowDecision: link.allowDecision },
    });
    reply.header('Cache-Control', 'no-store');
    return reply.status(201).send({
      shareLink: staffShareLink(link),
      token,
      path: `/portal/review/${token}`,
    });
  });

  // Revoke a share link. Revocation only removes access, so it needs no
  // step-up; it is idempotent.
  fastify.post('/:id/share-links/:linkId/revoke', { onRequest: [fastify.authenticate], preHandler: [requireReviewStaff] }, async (request, reply) => {
    const session = await loadSession(request, reply);
    if (!session) return reply;
    const link = await request.prisma.reviewShareLink.findFirst({
      where: { id: request.params.linkId, sessionId: session.id },
    });
    if (!link) return reply.status(404).send({ error: 'Share link not found' });
    if (link.revokedAt) return { shareLink: staffShareLink(link) };
    const now = new Date();
    const revoked = await request.prisma.reviewShareLink.update({
      where: { id: link.id },
      data: { revokedAt: now, revokedById: request.user.id },
    });
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'review.share_link_revoked',
      entityId: link.id,
      metadata: { sessionId: session.id, wasExpired: shareLinkState(link, now) === 'expired' },
    });
    return { shareLink: staffShareLink(revoked, now) };
  });
}
