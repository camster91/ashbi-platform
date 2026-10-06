// Client Portal Routes — passwordless magic-link auth + full portal experience

import { generateInvoicePdf } from '../utils/generate-invoice-pdf.js';
import { contractPdfFilename, generateContractPdf } from '../utils/generate-contract-pdf.js';
import env from '../config/env.js';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { CLIENT_SESSION_TOKEN_TYPE, isCurrentUserSession, revokeUserSessions, sessionCookieMaxAge, signUserSession } from '../auth/session.js';
import { MAGIC_LINK_TOKEN_TYPE, redeemMagicLink } from '../auth/magic-link.js';
import { accountThrottle } from '../auth/credential-throttle.js';
import { resolvePortalPrincipal } from '../auth/portal-principal.js';
import { revokeClientSocketsFrom } from '../auth/client-socket-revocation.js';
import { clearStaleSessionCookie } from '../auth/request-session.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { recordRejectedUpload, sha256Hex } from '../services/upload-integrity.service.js';
import { contentDisposition } from '../utils/send-file.js';
import { ATTACHMENT_UNDER_REVIEW, isAttachmentUnderReview, isForeignKeyViolation, isQuarantined } from '../services/media-review.service.js';
import { scanReviewMedia } from '../services/media-scan.service.js';
import clientPortalReviewRoutes from './client-portal-review.routes.js';
import { emitChatEvent, toClientChatPayload } from '../auth/project-room-access.js';
import {
  CHAT_PENDING_ENTITY,
  MAX_PENDING_CHAT_UPLOADS_PER_UPLOADER,
  claimPendingChatAttachments,
  findClientReadableChatAttachment,
  loadChatAttachments,
  normaliseAttachmentIds,
  sendChatAttachmentError,
  storeValidatedUpload,
  toClientAttachmentPayload,
  toStaffAttachmentPayload,
  unlinkStoredUpload,
  withAttachments,
} from '../services/chat-attachment.service.js';
import { sendStoredFile } from '../utils/send-file.js';
import { writeUploadThenPersist } from '../utils/stored-upload.js';
import { validateBody, validateQuery, chatMessageListQuerySchema, clientPortalMessageSchema, requestAccessSchema, fileUpload, clientPortalTokenRedeemSchema, clientPortalRevisionResponseSchema, clientPortalFeedbackSchema } from '../validators/schemas.js';
import { invoicePublicAccessFailure, INVOICE_OPEN_STATUSES } from '../utils/public-document-access.js';
import { invoiceBalance } from '../utils/invoice-balance.js';
import { outboundSignal } from '../utils/outbound-timeouts.js';
import { insensitiveEquals } from '../utils/insensitive-equals.js';
import { CLIENT_TASK_COLUMN_STATUSES } from '../shared/client-task-columns.js';
import { brandedSender, escapeHtml, publicBrand, resolveBranding, resolveBrandingForClient, resolveBrandingForDocument, sanitizeHeader } from '../services/branding.service.js';

// The project document fields the client portal returns (docs list, upload).
const PORTAL_DOCUMENT_SELECT = Object.freeze({
  id: true,
  originalName: true,
  mimeType: true,
  size: true,
  checksumSha256: true,
  createdAt: true,
  // The uploader's name only, never their account id.
  uploadedBy: { select: { name: true } },
});

// The client portal's task board (GET /projects/:id/tasks). The columns live
// in src/shared so the web app's public project link groups tasks the same
// way; see client-task-columns.js.
export { CLIENT_TASK_COLUMN_STATUSES };

const CLIENT_TASK_COLUMN_BY_STATUS = new Map(
  Object.entries(CLIENT_TASK_COLUMN_STATUSES).flatMap(([column, statuses]) => statuses.map((status) => [status, column])),
);

/** Group tasks into the portal columns; an unknown legacy status lands in TODO. */
export function groupClientTaskColumns(tasks) {
  const columns = Object.fromEntries(Object.keys(CLIENT_TASK_COLUMN_STATUSES).map((column) => [column, []]));
  for (const task of tasks) columns[CLIENT_TASK_COLUMN_BY_STATUS.get(task.status) ?? 'TODO'].push(task);
  return columns;
}

const CLIENT_TASK_SELECT = Object.freeze({
  id: true,
  title: true,
  status: true,
  priority: true,
  category: true,
  dueDate: true,
  completedAt: true,
  milestoneId: true,
  updatedAt: true,
  assignee: { select: { name: true } },
});

// Which PROJECT attachments the client portal shows: files staff explicitly
// shared (`clientVisible`, which client uploads get on creation) and files
// staff put in front of the client through a shared media review. Internal
// staff files, including screen recordings, are never listed or downloadable.
export const CLIENT_VISIBLE_ATTACHMENT_WHERE = Object.freeze({
  OR: [
    { clientVisible: true },
    { reviewSessions: { some: { sharedWithClient: true } } },
  ],
});

const CLIENT_VISIBLE_INVOICE_STATUSES = [...INVOICE_OPEN_STATUSES, 'PAID'];

const PORTAL_BASE = env.hubUrl;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// ── Mailgun helper (no-op if not configured) ────────────────────────────────
// Sent in the client's agency's name (its BrandSettings / organization name).
async function sendMagicLinkEmail(toEmail, toName, magicLink, branding) {
  const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
  const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.warn('[client-portal] Mailgun not configured; access request accepted without exposing its token');
    return false;
  }

  const safeName = String(toName).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const safeLink = String(magicLink).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  const companyName = sanitizeHeader(branding?.companyName);
  const body = new URLSearchParams();
  body.append('from', brandedSender(branding, MAILGUN_DOMAIN));
  body.append('to', `${toName} <${toEmail}>`);
  body.append('subject', companyName ? `Your ${companyName} Client Portal Link` : 'Your Client Portal Link');
  body.append('html', `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#2e2958;color:#f1f5f9;padding:40px;border-radius:12px;">
      <h2 style="color:#e6f354;margin-top:0;">${companyName ? `${escapeHtml(companyName)} — ` : ''}Client Portal</h2>
      <p>Hi ${safeName},</p>
      <p>Click the button below to access your portal. This link expires in <strong>1 hour</strong>.</p>
      <a href="${safeLink}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#e6f354;color:#2e2958;border-radius:8px;text-decoration:none;font-weight:600;">
        Access My Portal
      </a>
      <p style="font-size:12px;color:#94a3b8;">If you didn't request this, you can safely ignore it.<br>Link: ${safeLink}</p>
    </div>
  `);

  const auth = Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64');
  const res = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    signal: outboundSignal('api'),
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[client-portal] Mailgun error:', res.status, text);
    return false;
  }
  return true;
}

// Re-resolved on every portal request, verify-token and socket handshake
// (src/auth/portal-principal.js).
export { resolvePortalPrincipal };

/**
 * Claims for the emailed magic link. Only identifiers: verify-token re-resolves
 * the user, contact and client from the database (resolvePortalPrincipal), so
 * carrying the contact's name or email would only leak PII into the URL and
 * let long names push the token past the redemption length bound.
 */
export function magicLinkClaims(user, contact) {
  return {
    // Typed and single-use: never a session (session verifiers require a
    // session typ) and redeemable once (its jti is recorded on redemption).
    typ: MAGIC_LINK_TOKEN_TYPE,
    jti: randomUUID(),
    id: user.id,
    contactId: contact.id,
    clientId: contact.clientId,
    organizationId: contact.client.organizationId,
    role: 'CLIENT',
    sessionVersion: user.sessionVersion,
  };
}

/**
 * The user a portal request writes as (chat author, uploader): the CLIENT user
 * of the verified portal principal (clientAuth re-resolved it this request,
 * src/auth/portal-principal.js). Never looked up by the contact's email and
 * never created here: an email lookup is case-sensitive against addresses
 * stored as typed and can match another organization's user, and a created
 * row would have no organization.
 */
function portalAuthor(request) {
  return { id: request.clientUser.id };
}

// ── Routes ───────────────────────────────────────────────────────────────────
export default async function clientPortalRoutes(fastify) {

  // ── CLIENT JWT middleware ────────────────────────────────────────────────────
  async function clientAuth(request, reply) {
    // A token that fails here came from the cookie when there is no
    // Authorization header; a stale cookie is cleared with the 401 so the
    // browser is not locked out (and logout always clears it).
    const reject = (error) => {
      // During a support view the cookie is the admin's own, valid session.
      if (!request.impersonation) clearStaleSessionCookie(request, reply);
      return reply.status(401).send({ error });
    };
    try {
      // Accept token from Authorization header or cookie only — never from URL query string
      // (query string tokens get leaked in browser history, proxy logs, and Referer headers)
      const rawToken =
        (request.headers.authorization?.startsWith('Bearer ')
          ? request.headers.authorization.slice(7)
          : null) ||
        request.cookies?.token;

      if (!rawToken) {
        return reply.status(401).send({ error: 'Missing token' });
      }

      // An admin viewing as this client user (#416): the global hook already
      // verified the admin's session and the read-only view; the subject's
      // claims carry the client_session type.
      let payload = request.impersonation?.user;
      if (!payload) {
        try {
          payload = fastify.jwt.verify(rawToken);
        } catch {
          return reject('Invalid or expired token');
        }
      }

      // Only a client-portal session: a staff session, a magic link or any
      // other token signed with this key is refused.
      if (!(await isCurrentUserSession(request.prisma, payload, { types: [CLIENT_SESSION_TOKEN_TYPE] }))) {
        return reject('Session expired or revoked');
      }
      const principal = await resolvePortalPrincipal(request.prisma, payload);
      if (!principal) return reject('Session expired or revoked');

      request.clientUser = {
        ...payload,
        contactId: principal.contact.id,
        clientId: principal.client.id,
        organizationId: principal.client.organizationId,
      };
    } catch (err) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  // Per-email budget for magic-link requests, on top of the per-IP route
  // limit, so one inbox cannot be flooded from many addresses.
  const requestAccessAccountThrottle = accountThrottle(fastify, {
    name: 'portal-link',
    countAll: true,
    perAccountAndIp: { max: 5, timeWindow: '15 minutes' },
    perAccount: { max: 20, timeWindow: '15 minutes' },
  });

  // POST /api/client-portal/request-access
  // Sends a magic link email — link points to /verify-token which sets a secure cookie
  fastify.post('/request-access', {
    config: { public: true, rateLimit: { max: 10, timeWindow: '15 minutes' } },
    preHandler: [validateBody(requestAccessSchema), requestAccessAccountThrottle.guard],
    onSend: requestAccessAccountThrottle.onSend,
  }, async (request, reply) => {
    const { email } = request.body;

    const normalizedEmail = email.toLowerCase().trim();
    // Contacts added before emails were normalized on write are stored as
    // typed (mixed case), so the match is case-insensitive.
    const contact = await request.prisma.contact.findFirst({
      where: {
        email: insensitiveEquals(normalizedEmail),
        client: {
          deletedAt: null,
          status: 'ACTIVE',
          relationshipStatus: { notIn: ['ARCHIVED', 'CHURNED'] },
        },
      },
      include: { client: { select: { id: true, name: true, organizationId: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (!contact) {
      // Don't leak whether email exists
      return { sent: true };
    }

    // Legacy accounts may be stored in mixed case too: any case variant is
    // this person's account, and an ambiguous match sends nothing.
    const users = await request.prisma.user.findMany({
      where: { email: insensitiveEquals(normalizedEmail) },
      take: 2,
    });
    if (users.length > 1) {
      return { sent: true };
    }
    let user = users[0] ?? null;
    if (user && (user.role !== 'CLIENT' || user.clientId !== contact.clientId || user.organizationId !== contact.client.organizationId || !user.isActive)) {
      return { sent: true };
    }
    if (!user) {
      user = await request.prisma.user.create({
        data: {
          email: normalizedEmail,
          name: contact.name,
          password: await bcrypt.hash(randomUUID(), 12),
          role: 'CLIENT',
          clientId: contact.clientId,
          organizationId: contact.client.organizationId,
        },
      });
    }

    const token = fastify.jwt.sign(magicLinkClaims(user, contact), { expiresIn: '1h' });
    // Magic link now goes to the verify endpoint which POSTs the token
    const magicLink = `${PORTAL_BASE}/client-portal/verify?token=${token}`;
    const branding = await resolveBranding(request.prisma, contact.client.organizationId);
    await sendMagicLinkEmail(contact.email, contact.name, magicLink, branding);

    return { sent: true };
  });

  // POST /api/client-portal/verify-token
  // Exchanges a magic-link token for an httpOnly secure cookie
  // This avoids JWT tokens appearing in browser history / Referer headers
  fastify.post('/verify-token', {
    config: { public: true, rateLimit: { max: 20, timeWindow: '15 minutes' } },
    preHandler: validateBody(clientPortalTokenRedeemSchema),
  }, async (request, reply) => {
    const { token } = request.body || {};

    if (!token) {
      return reply.status(400).send({ error: 'Token required' });
    }

    let payload;
    try {
      payload = fastify.jwt.verify(token);
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }
    if (payload?.typ !== MAGIC_LINK_TOKEN_TYPE || typeof payload.jti !== 'string') {
      return reply.status(401).send({ error: 'Invalid, expired, or revoked token' });
    }

    const principal = await resolvePortalPrincipal(request.prisma, payload);
    if (!principal) return reply.status(401).send({ error: 'Invalid, expired, or revoked token' });
    if (!(await redeemMagicLink(request.prisma, payload))) {
      return reply.status(401).send({ error: 'This sign-in link has already been used. Request a new one.', code: 'MAGIC_LINK_USED' });
    }

    const sessionToken = signUserSession(fastify.jwt, principal.user, { contactId: principal.contact.id });

    return reply
      .setCookie('token', sessionToken, {
        path: '/',
        httpOnly: true,
        secure: env.isDeployed,
        sameSite: env.isDeployed ? 'strict' : 'lax',
        maxAge: sessionCookieMaxAge()
      })
      .send({
        user: {
          contactId: principal.contact.id,
          clientId: principal.client.id,
          role: 'CLIENT'
        }
      });
    // Database failures propagate to the sanitised error handler (a 500, not
    // a misleading "invalid link").
  });

  fastify.post('/logout', { preHandler: clientAuth }, async (request, reply) => {
    await revokeUserSessions(request.prisma, request.clientUser.id);
    // Signing out ends this user's open portal sockets too.
    revokeClientSocketsFrom(fastify, { userId: request.clientUser.id }, request.log);
    return reply
      .clearCookie('token', {
        path: '/',
        httpOnly: true,
        secure: env.isDeployed,
        sameSite: env.isDeployed ? 'strict' : 'lax',
      })
      .send({ success: true });
  });

  // GET /api/client-portal/me
  fastify.get('/me', { preHandler: clientAuth }, async (request, reply) => {
    const { contactId, clientId } = request.clientUser;

    const [contact, client] = await Promise.all([
      request.prisma.contact.findUnique({ where: { id: contactId }, select: { name: true, email: true } }),
      request.prisma.client.findUnique({ where: { id: clientId }, select: { name: true, contactPerson: true } })
    ]);

    if (!contact || !client) {
      return reply.status(404).send({ error: 'Not found' });
    }

    // The agency's name and public logo for the portal header.
    const brand = publicBrand(await resolveBrandingForClient(request.prisma, clientId));
    return { client, contact, brand };
  });

  // ── Projects ─────────────────────────────────────────────────────────────────

  // GET /api/client-portal/projects
  fastify.get('/projects', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;

    const projects = await request.prisma.project.findMany({
      where: { clientId, deletedAt: null, status: { notIn: ['CANCELLED'] } },
      select: {
        id: true,
        name: true,
        status: true,
        // Never the internal health rating or AI summary (staff-only).
        description: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { tasks: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });

    const projectIds = projects.map((p) => p.id);
    const taskStats = projectIds.length
      ? await request.prisma.task.groupBy({
          by: ['projectId', 'status'],
          where: { projectId: { in: projectIds } },
          _count: { _all: true },
        })
      : [];

    const completedByProject = new Map();
    for (const row of taskStats) {
      if (row.status === 'COMPLETED') {
        completedByProject.set(row.projectId, row._count._all);
      }
    }

    const withProgress = projects.map((p) => {
      const totalCount = p._count.tasks;
      const completedCount = completedByProject.get(p.id) ?? 0;
      return {
        ...p,
        completedTasks: completedCount,
        totalTasks: totalCount,
        progressPct: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
      };
    });

    return withProgress;
  });

  // GET /api/client-portal/projects/:id
  fastify.get('/projects/:id', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    const project = await request.prisma.project.findFirst({
      where: { id, clientId, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        // Never the internal health rating or AI summary (staff-only).
        description: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { name: true } },
        milestones: {
          select: { id: true, name: true, description: true, dueDate: true, status: true, completedAt: true },
          orderBy: { dueDate: 'asc' },
        },
        revisionRounds: {
          select: { id: true, roundNumber: true, status: true, notes: true, requestedAt: true, approvedAt: true, updatedAt: true },
          orderBy: { roundNumber: 'desc' },
        },
        _count: { select: { tasks: true } }
      }
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const completedCount = await request.prisma.task.count({
      where: { projectId: id, status: 'COMPLETED' }
    });

    return {
      ...project,
      completedTasks: completedCount,
      totalTasks: project._count.tasks,
      progressPct: project._count.tasks > 0 ? Math.round((completedCount / project._count.tasks) * 100) : 0
    };
  });

  fastify.post('/projects/:id/revisions/:revisionId/respond', {
    preHandler: [clientAuth, validateBody(clientPortalRevisionResponseSchema)],
  }, async (request, reply) => {
    const { clientId, contactId, id: userId } = request.clientUser;
    const { id: projectId, revisionId } = request.params;
    const { action, feedback } = request.body;
    const revision = await request.prisma.revisionRound.findFirst({
      where: { id: revisionId, projectId, project: { clientId, deletedAt: null } },
      select: { id: true, roundNumber: true, status: true },
    });
    if (!revision) return reply.status(404).send({ error: 'Revision round not found' });
    if (revision.status === 'APPROVED') return reply.status(409).send({ error: 'Revision round is already approved' });

    const now = new Date();
    const updated = await request.prisma.$transaction(async transaction => {
      const response = await transaction.revisionRound.updateMany({
        where: { id: revision.id, status: { not: 'APPROVED' } },
        data: action === 'APPROVE'
          ? { status: 'APPROVED', approvedAt: now }
          : { status: 'OPEN', approvedAt: null },
      });
      if (response.count !== 1) return null;
      const activity = await transaction.activity.create({
        data: {
          type: action === 'APPROVE' ? 'CLIENT_REVISION_APPROVED' : 'CLIENT_REVISION_CHANGES_REQUESTED',
          action: action === 'APPROVE' ? 'approved' : 'requested_changes',
          entityType: 'REVISION_ROUND',
          entityId: revision.id,
          entityName: `Revision round ${revision.roundNumber}`,
          metadata: JSON.stringify({ contactId, feedback: feedback || null }),
          projectId,
          userId,
        },
        select: { id: true },
      });
      return { round: await transaction.revisionRound.findUnique({ where: { id: revision.id } }), activityId: activity.id };
    });
    if (!updated) return reply.status(409).send({ error: 'Revision round is no longer awaiting a response' });
    // Append-only evidence of the client's decision (the Activity row above
    // is the project feed entry and goes with the project).
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'client_portal.revision_responded',
      actorType: 'CLIENT',
      actorUserId: userId ?? null,
      organizationId: request.clientUser.organizationId,
      entityId: revision.id,
      metadata: { projectId, clientId, contactId, response: action, roundNumber: revision.roundNumber, activityId: updated.activityId },
    });
    return updated.round;
  });

  fastify.post('/projects/:id/feedback', {
    preHandler: [clientAuth, validateBody(clientPortalFeedbackSchema)],
  }, async (request, reply) => {
    const { clientId, contactId, id: userId } = request.clientUser;
    const { id: projectId } = request.params;
    const project = await request.prisma.project.findFirst({
      where: { id: projectId, clientId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    const activity = await request.prisma.activity.create({
      data: {
        type: 'CLIENT_FEEDBACK',
        action: 'commented',
        entityType: 'PROJECT',
        entityId: project.id,
        entityName: project.name,
        metadata: JSON.stringify({ contactId, message: request.body.message }),
        projectId: project.id,
        userId,
      },
      select: { id: true, createdAt: true },
    });
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'client_portal.feedback_submitted',
      actorType: 'CLIENT',
      actorUserId: userId ?? null,
      organizationId: request.clientUser.organizationId,
      entityId: project.id,
      metadata: { clientId, contactId, activityId: activity.id, messageLength: request.body.message.length },
    });
    return reply.status(201).send(activity);
  });

  // GET /api/client-portal/projects/:id/tasks — Kanban tasks
  fastify.get('/projects/:id/tasks', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    // Verify project belongs to client
    const project = await request.prisma.project.findFirst({ where: { id, clientId, deletedAt: null } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Client-safe fields only: no internal description, ordering or the
    // assignee's account id.
    const tasks = await request.prisma.task.findMany({
      where: { projectId: id, parentId: null },
      select: CLIENT_TASK_SELECT,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
    });

    // Group by status for kanban columns: every task status has a column.
    const columns = groupClientTaskColumns(tasks);

    return { tasks, columns };
  });

  // ── Messages / Chat ──────────────────────────────────────────────────────────

  // GET /api/client-portal/projects/:id/messages
  // Only the client-visible conversation (visibility CLIENT): internal team
  // chat and Slack imports are never returned. Newest page, oldest-first.
  fastify.get('/projects/:id/messages', { preHandler: [clientAuth, validateQuery(chatMessageListQuerySchema)] }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;
    const { limit, before, after, beforeId, afterId } = request.query;

    const project = await request.prisma.project.findFirst({ where: { id, clientId, deletedAt: null } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // The cursor is (createdAt, id): with an id, messages sharing the boundary
    // timestamp are split by id instead of being skipped.
    const where = { projectId: id, visibility: 'CLIENT', removedAt: null };
    const forward = !before && Boolean(after);
    if (before) {
      const at = new Date(before);
      if (beforeId) where.OR = [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: beforeId } }];
      else where.createdAt = { lt: at };
    } else if (after) {
      const at = new Date(after);
      if (afterId) where.OR = [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: afterId } }];
      else where.createdAt = { gt: at };
    }

    const messages = await request.prisma.chatMessage.findMany({
      where,
      include: {
        author: { select: { id: true, name: true } }
      },
      // `after` pages forward from the cursor (the nearest newer messages);
      // otherwise the page is the newest before the cursor, or overall.
      orderBy: forward ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit
    });

    // Only CLIENT messages are loaded above, so only their files are; each is
    // reduced to the client shape by toClientChatPayload (docs/chat-media.md).
    const byMessage = await loadChatAttachments(request.prisma, messages.map((message) => message.id));
    return withAttachments(forward ? messages : messages.reverse(), byMessage).map(toClientChatPayload);
  });

  // POST /api/client-portal/projects/:id/chat-uploads — a file for a portal
  // chat message that is still being written. Stored as a pending chat upload
  // owned by the contact's user; the message send claims it.
  fastify.post('/projects/:id/chat-uploads', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    const project = await request.prisma.project.findFirst({ where: { id, clientId, deletedAt: null }, select: { id: true, organizationId: true } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const authorUser = portalAuthor(request);
    const pending = await request.prisma.attachment.count({
      where: { entityType: CHAT_PENDING_ENTITY, entityId: id, uploadedById: authorUser.id },
    });
    if (pending >= MAX_PENDING_CHAT_UPLOADS_PER_UPLOADER) {
      return reply.status(409).send({ error: 'Too many unsent attachments. Send or remove some first.', code: 'TOO_MANY_PENDING_UPLOADS' });
    }

    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });
    const { stored, error, rejected } = await storeValidatedUpload(data);
    if (error) {
      await recordRejectedUpload(request.prisma, request, {
        ...rejected, surface: 'client_portal_chat', projectId: project.id,
        organizationId: project.organizationId, actorType: 'CLIENT', actorUserId: authorUser.id,
      });
      return reply.status(400).send({ error });
    }

    const attachment = await request.prisma.attachment.create({
      data: {
        ...stored,
        entityType: CHAT_PENDING_ENTITY,
        entityId: id,
        uploadedById: authorUser.id,
        organizationId: project.organizationId,
      },
    });
    // The client shape, without the download URL: a pending file is readable
    // only once it is sent on a client-visible message.
    const { url: _url, ...clientShape } = toClientAttachmentPayload(attachment) ?? { id: attachment.id };
    return reply.status(201).send(clientShape);
  });

  // DELETE /api/client-portal/projects/:id/chat-uploads/:attachmentId — remove
  // one of the contact's own unsent uploads.
  fastify.delete('/projects/:id/chat-uploads/:attachmentId', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id, attachmentId } = request.params;
    const project = await request.prisma.project.findFirst({ where: { id, clientId, deletedAt: null }, select: { id: true } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    const authorUser = portalAuthor(request);
    const existing = await request.prisma.attachment.findFirst({
      where: { id: attachmentId, entityType: CHAT_PENDING_ENTITY, entityId: id, uploadedById: authorUser.id },
      select: { id: true, path: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Pending upload not found' });
    const deleted = await request.prisma.attachment.deleteMany({ where: { id: existing.id, entityType: CHAT_PENDING_ENTITY } });
    if (deleted.count === 1) await unlinkStoredUpload(existing.path);
    return { success: true };
  });

  // GET /api/client-portal/chat-attachments/:attachmentId — a file attached to
  // a CLIENT-visible message of one of this client's projects. Anything else
  // (INTERNAL message, another client's project, deleted message, unsent or
  // quarantined file) is a 404 (docs/chat-media.md).
  fastify.get('/chat-attachments/:attachmentId', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId, organizationId } = request.clientUser;
    const attachment = await findClientReadableChatAttachment(request.prisma, {
      attachmentId: request.params.attachmentId,
      clientId,
      organizationId,
    });
    if (!attachment) return reply.status(404).send({ error: 'File not found' });
    const mime = String(attachment.mimeType || '');
    const media = mime.startsWith('video/') || mime.startsWith('audio/');
    const inline = media || mime.startsWith('image/');
    const sent = await sendStoredFile(request, reply, {
      filepath: path.join(UPLOAD_DIR, path.basename(attachment.filename)),
      mimeType: attachment.mimeType,
      fileName: attachment.originalName,
      disposition: inline ? 'inline' : 'attachment',
      allowRanges: media,
      headers: { 'Cache-Control': 'private, no-store' },
    });
    if (sent === null) return reply.status(404).send({ error: 'File not found' });
    return sent;
  });

  // POST /api/client-portal/projects/:id/messages
  fastify.post('/projects/:id/messages', { preHandler: [clientAuth, validateBody(clientPortalMessageSchema)] }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;
    const { content = '', type } = request.body;
    let attachmentIds;
    try {
      attachmentIds = normaliseAttachmentIds(request.body.attachmentIds);
    } catch (err) {
      return sendChatAttachmentError(reply, err);
    }

    const project = await request.prisma.project.findFirst({ where: { id, clientId, deletedAt: null } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Find or create a user for the contact to use as author
    const authorUser = portalAuthor(request);

    // A portal message is always CLIENT-visible; it and the claim of its
    // pending uploads commit together (docs/chat-media.md).
    let created;
    try {
      created = await request.prisma.$transaction(async (tx) => {
        const row = await tx.chatMessage.create({
          data: {
            content,
            type,
            visibility: 'CLIENT',
            projectId: id,
            authorId: authorUser.id
          },
          include: {
            author: { select: { id: true, name: true, email: true } }
          }
        });
        await claimPendingChatAttachments(tx, { attachmentIds, projectId: id, uploadedById: authorUser.id, messageId: row.id });
        return row;
      });
    } catch (err) {
      return sendChatAttachmentError(reply, err);
    }
    const [message] = withAttachments([created], await loadChatAttachments(request.prisma, [created.id]));

    // Staff see it in the internal room; the client room gets the portal shape.
    const clientMessage = toClientChatPayload(message);
    const staffMessage = { ...message, metadata: null, attachments: message.attachments.map(toStaffAttachmentPayload) };
    emitChatEvent(fastify.io, message, 'chat:message', staffMessage, clientMessage);

    return reply.status(201).send(clientMessage);
  });

  // ── Documents / File Uploads ─────────────────────────────────────────────────

  // GET /api/client-portal/projects/:id/documents
  fastify.get('/projects/:id/documents', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    const project = await request.prisma.project.findFirst({ where: { id, clientId, deletedAt: null } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Only what the portal shows: never the storage path or file name, the
    // organization or the uploader's account id.
    const documents = await request.prisma.attachment.findMany({
      where: {
        entityType: 'PROJECT',
        entityId: id,
        ...CLIENT_VISIBLE_ATTACHMENT_WHERE,
        // Files moved aside by `npm run quarantine:uploads` are never listed.
        NOT: { path: { startsWith: '/uploads/quarantine/' } },
      },
      select: PORTAL_DOCUMENT_SELECT,
      orderBy: { createdAt: 'desc' }
    });

    return documents;
  });

  fastify.get('/documents/:docId/download', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    // A file the portal does not list answers 404 like an unknown id.
    const doc = await request.prisma.attachment.findFirst({
      where: { id: request.params.docId, entityType: 'PROJECT', ...CLIENT_VISIBLE_ATTACHMENT_WHERE },
    });
    if (!doc || isQuarantined(doc)) {
      return reply.status(404).send({ error: 'Document not found' });
    }
    const project = await request.prisma.project.findFirst({ where: { id: doc.entityId, clientId, deletedAt: null } });
    if (!project) return reply.status(404).send({ error: 'Document not found' });
    // The same media-scan gate as the review file routes (docs/media-review.md
    // "Scanning seam"): a file shared through a client review must not be
    // downloadable here when the review route would withhold it.
    const scan = await scanReviewMedia(doc);
    if (scan.verdict === 'blocked') return reply.status(403).send({ error: 'This file did not pass the media scan', code: 'MEDIA_BLOCKED' });
    if (scan.verdict === 'pending') return reply.status(409).send({ error: 'This file is still being scanned', code: 'MEDIA_SCAN_PENDING' });
    try {
      const file = await fs.readFile(path.join(process.cwd(), doc.path));
      return reply
        .header('Content-Type', doc.mimeType || 'application/octet-stream')
        .header('Content-Disposition', contentDisposition('attachment', doc.originalName))
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .send(file);
    } catch (err) {
      // ENOENT is the only case where "Document not found" is honest
      // (upload was deleted, the path is stale, etc.). Anything else —
      // permission denied, disk full, I/O error, DB outage — must be
      // logged and surfaced as a 5xx so the operator can investigate.
      // Previously a single catch-all turned every error into a 404,
      // which masked real outages behind a misleading "not found".
      if (err && err.code === 'ENOENT') {
        return reply.status(404).send({ error: 'Document not found' });
      }
      request.log.error({ err, docId: request.params.docId }, 'client-portal: document download failed');
      return reply.status(500).send({ error: 'Failed to download document' });
    }
  });

  // POST /api/client-portal/projects/:id/upload — Upload document
  fastify.post('/projects/:id/upload', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    const project = await request.prisma.project.findFirst({ where: { id, clientId, deletedAt: null } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const buffer = await data.toBuffer();
    const validation = fileUpload.validate(data.filename, data.mimetype, buffer);
    if (!validation.valid) {
      await recordRejectedUpload(request.prisma, request, {
        surface: 'client_portal_documents', validation, filename: data.filename, mimeType: data.mimetype, size: buffer.length,
        projectId: project.id, organizationId: project.organizationId, actorType: 'CLIENT', actorUserId: request.clientUser.id ?? null,
      });
      return reply.status(400).send({ error: validation.error });
    }

    // Ensure upload directory
    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    const authorUser = portalAuthor(request);

    // Use validated extension (always from allowlist)
    const filename = `${randomUUID()}${validation.ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // Write the file, then save the attachment record; a failed record write
    // removes the file just written (no orphan file).
    const attachment = await writeUploadThenPersist(filepath, buffer, () => request.prisma.attachment.create({
      data: {
        filename,
        originalName: data.filename,
        mimeType: validation.mimetype,
        size: buffer.length,
        path: `/uploads/${filename}`,
        checksumSha256: sha256Hex(buffer),
        entityType: 'PROJECT',
        entityId: id,
        uploadedById: authorUser.id,
        organizationId: project.organizationId,
        // The client's own upload: listed back to them in the portal.
        clientVisible: true,
      },
      select: PORTAL_DOCUMENT_SELECT,
    }));

    return reply.status(201).send(attachment);
  });

  // DELETE /api/client-portal/documents/:docId — Delete uploaded doc
  fastify.delete('/documents/:docId', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { docId } = request.params;

    const doc = await request.prisma.attachment.findUnique({ where: { id: docId } });
    // Another client's (or organization's) file answers 404 exactly like an
    // unknown id, so a document id's existence is not revealed (as on the
    // download route).
    if (!doc || doc.entityType !== 'PROJECT') {
      return reply.status(404).send({ error: 'Document not found' });
    }
    const project = await request.prisma.project.findFirst({
      where: { id: doc.entityId, clientId, deletedAt: null }
    });
    if (!project) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    // Clients may remove only files they uploaded themselves: agency
    // deliverables and other contacts' files on the project stay put.
    if (doc.uploadedById !== request.clientUser.id) {
      return reply.status(403).send({ error: 'You can only delete files you uploaded', code: 'NOT_UPLOADER' });
    }

    // A file under media review is approval evidence (docs/media-review.md):
    // a client cannot approve through a share link and then delete the file.
    if (await isAttachmentUnderReview(request.prisma, docId)) {
      return reply.status(409).send(ATTACHMENT_UNDER_REVIEW);
    }

    // Remove the row first: if a review started in the meantime, the
    // RESTRICT foreign key refuses and the file stays on disk.
    try {
      await request.prisma.attachment.delete({ where: { id: docId } });
    } catch (err) {
      if (isForeignKeyViolation(err)) return reply.status(409).send(ATTACHMENT_UNDER_REVIEW);
      throw err;
    }

    // The stored file is deliberately NOT unlinked: a client delete removes
    // the file from the portal only. The bytes stay on disk (named in the
    // audit event) so staff can recover a mistaken or malicious deletion; the
    // orphaned-upload audit (npm run audit:uploads) is where they are purged.
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'client_portal.document_deleted',
      actorType: 'CLIENT',
      actorUserId: request.clientUser.id ?? null,
      organizationId: request.clientUser.organizationId,
      entityId: docId,
      metadata: { projectId: doc.entityId, clientId, mimeType: doc.mimeType, size: doc.size, storedFilename: doc.filename, fileRetained: true },
    });

    return { success: true };
  });

  // ── Invoices ─────────────────────────────────────────────────────────────────

  fastify.get('/contracts', { preHandler: clientAuth }, async (request) => {
    const { clientId } = request.clientUser;
    const contracts = await request.prisma.contract.findMany({
      where: { clientId, deletedAt: null, status: { in: ['SENT', 'SIGNED'] } },
      select: {
        id: true,
        title: true,
        status: true,
        templateType: true,
        signToken: true,
        publicAccessExpiresAt: true,
        publicAccessRevokedAt: true,
        signedAt: true,
        clientSigName: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    const now = Date.now();
    return contracts.map(contract => {
      const canReview = contract.status === 'SENT'
        && !contract.publicAccessRevokedAt
        && (!contract.publicAccessExpiresAt || new Date(contract.publicAccessExpiresAt).getTime() > now);
      return {
        ...contract,
        signToken: canReview ? contract.signToken : null,
        canReview,
        canDownload: contract.status === 'SIGNED',
      };
    });
  });

  // GET /api/client-portal/contracts/:id/pdf
  // Signed contracts only, and only the authenticated client's own. Anything
  // else (another client's contract, unsigned, voided, deleted) is a 404 so the
  // route does not reveal whether a contract id exists.
  fastify.get('/contracts/:id/pdf', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const contract = await request.prisma.contract.findFirst({
      where: { id: request.params.id, clientId, deletedAt: null, status: 'SIGNED' },
      include: { client: { select: { name: true } } },
    });
    if (!contract || contract.clientId !== clientId) {
      return reply.status(404).send({ error: 'Contract not found' });
    }

    try {
      const pdfBuffer = await generateContractPdf(contract, await resolveBrandingForClient(request.prisma, contract.clientId));
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${contractPdfFilename(contract)}.pdf"`)
        .header('Cache-Control', 'private, no-store')
        .header('Content-Length', pdfBuffer.length)
        .send(pdfBuffer);
    } catch (err) {
      fastify.log.error({ err }, 'Client portal contract PDF generation failed');
      return reply.status(500).send({ error: 'Failed to generate contract PDF' });
    }
  });

  // GET /api/client-portal/invoices
  fastify.get('/invoices', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;

    // Only invoices the client was actually sent: drafts are internal and
    // void invoices are not owed. Pay/view go through the public invoice page
    // (/portal/invoice/:token), which creates or refreshes a Stripe Checkout
    // session on demand; stored Checkout URLs expire and are never exposed.
    const invoices = await request.prisma.invoice.findMany({
      where: { clientId, status: { in: CLIENT_VISIBLE_INVOICE_STATUSES } },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        total: true,
        currency: true,
        issueDate: true,
        dueDate: true,
        paidAt: true,
        updatedAt: true,
        title: true,
        notes: true,
        viewToken: true,
        publicAccessExpiresAt: true,
        publicAccessRevokedAt: true,
        // Partial payments: the client owes the balance, not the total.
        payments: { select: { amount: true } },
      },
      orderBy: { issueDate: 'desc' }
    });

    return invoices.map(({ viewToken, publicAccessExpiresAt, publicAccessRevokedAt, payments, ...invoice }) => {
      const paid = Array.isArray(payments) ? payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) : 0;
      const linkUsable = Boolean(viewToken)
        && !invoicePublicAccessFailure({ ...invoice, viewToken, publicAccessExpiresAt, publicAccessRevokedAt });
      const viewUrl = linkUsable ? `/portal/invoice/${viewToken}` : null;
      return {
        ...invoice,
        ...invoiceBalance(invoice.total, paid),
        viewUrl,
        payUrl: linkUsable && INVOICE_OPEN_STATUSES.includes(invoice.status) ? viewUrl : null,
      };
    });
  });

  // GET /api/client-portal/invoices/:id/pdf
  fastify.get('/invoices/:id/pdf', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    const invoice = await request.prisma.invoice.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        client: true,
        lineItems: true,
        payments: true
      }
    });

    if (!invoice) {
      return reply.status(404).send({ error: 'Invoice not found' });
    }

    const branding = await resolveBrandingForDocument(request.prisma, invoice);
    const pdfBuffer = await generateInvoicePdf(invoice, { branding });

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`)
      .send(pdfBuffer);
  });

  // ── Retainer ─────────────────────────────────────────────────────────────────

  // GET /api/client-portal/retainer
  fastify.get('/retainer', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;

    const retainer = await request.prisma.retainerPlan.findUnique({
      where: { clientId }
    });

    if (!retainer) return null;

    const hoursUsed = retainer.hoursUsed || 0;
    const hoursPerMonth = retainer.hoursPerMonth || 0;
    const hoursRemaining = hoursPerMonth - hoursUsed;
    const percentUsed = hoursPerMonth > 0 ? Math.round((hoursUsed / hoursPerMonth) * 100) : 0;

    return {
      tier: retainer.tier,
      hoursPerMonth,
      hoursUsed,
      hoursRemaining,
      percentUsed,
      monthlyAmountUsd: retainer.monthlyAmountUsd,
      monthlyAmountCad: retainer.monthlyAmountCad,
      retainerStatus: retainer.retainerStatus
    };
  });

  // ── Unread message count ────────────────────────────────────────────────────

  // GET /api/client-portal/unread-count
  fastify.get('/unread-count', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;

    // Get all project IDs for this client
    const projects = await request.prisma.project.findMany({
      where: { clientId, deletedAt: null, status: { notIn: ['CANCELLED'] } },
      select: { id: true }
    });

    const projectIds = projects.map(p => p.id);

    // Count messages from last 7 days as "recent"
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const recentMessages = await request.prisma.chatMessage.count({
      where: {
        projectId: { in: projectIds },
        createdAt: { gte: weekAgo },
        type: 'TEXT',
        visibility: 'CLIENT',
        removedAt: null
      }
    });

    const upcomingDeadlines = await request.prisma.task.count({
      where: {
        projectId: { in: projectIds },
        dueDate: {
          gte: new Date(),
          lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // next 14 days
        },
        status: { notIn: ['COMPLETED'] }
      }
    });

    return { recentMessages, upcomingDeadlines };
  });

  // Media review for the client's own projects (docs/media-review.md
  // "Client portal reviews"), behind this plugin's clientAuth guard.
  await fastify.register(clientPortalReviewRoutes, { prefix: '/reviews', clientAuth });
}
