// Client Portal Routes — passwordless magic-link auth + full portal experience

import { generateInvoicePdf } from '../utils/generate-invoice-pdf.js';
import { contractPdfFilename, generateContractPdf } from '../utils/generate-contract-pdf.js';
import env from '../config/env.js';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { isCurrentUserSession, revokeUserSessions, sessionCookieMaxAge, signUserSession } from '../auth/session.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { ATTACHMENT_UNDER_REVIEW, isAttachmentUnderReview, isForeignKeyViolation } from '../services/media-review.service.js';
import { validateBody, validateParams, clientPortalMessageSchema, requestAccessSchema, fileUpload, clientPortalTokenRedeemSchema, clientPortalRevisionResponseSchema, clientPortalFeedbackSchema } from '../validators/schemas.js';

const PORTAL_BASE = env.hubUrl;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// ── Mailgun helper (no-op if not configured) ────────────────────────────────
async function sendMagicLinkEmail(toEmail, toName, magicLink) {
  const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
  const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.warn('[client-portal] Mailgun not configured; access request accepted without exposing its token');
    return false;
  }

  const safeName = String(toName).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const safeLink = String(magicLink).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  const body = new URLSearchParams();
  body.append('from', `Ashbi Design <noreply@${MAILGUN_DOMAIN}>`);
  body.append('to', `${toName} <${toEmail}>`);
  body.append('subject', 'Your Ashbi Design Client Portal Link');
  body.append('html', `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#2e2958;color:#f1f5f9;padding:40px;border-radius:12px;">
      <h2 style="color:#e6f354;margin-top:0;">Ashbi Design — Client Portal</h2>
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

export async function resolvePortalPrincipal(prisma, payload) {
  if (!payload?.id || !payload?.contactId || !payload?.clientId || payload.role !== 'CLIENT') return null;

  const [user, contact, client] = await Promise.all([
    prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, email: true, name: true, role: true, clientId: true, organizationId: true, isActive: true, sessionVersion: true },
    }),
    prisma.contact.findFirst({
      where: { id: payload.contactId, clientId: payload.clientId },
      select: { id: true, email: true, name: true, clientId: true },
    }),
    prisma.client.findFirst({
      where: {
        id: payload.clientId,
        deletedAt: null,
        status: 'ACTIVE',
        relationshipStatus: { notIn: ['ARCHIVED', 'CHURNED'] },
      },
      select: { id: true, organizationId: true, name: true },
    }),
  ]);

  if (!user?.isActive || user.role !== 'CLIENT' || user.clientId !== payload.clientId) return null;
  if (!contact || !client || user.organizationId !== client.organizationId) return null;
  if (user.email.toLowerCase() !== contact.email.toLowerCase()) return null;
  if (payload.organizationId && payload.organizationId !== client.organizationId) return null;
  if (!Number.isInteger(payload.sessionVersion) || payload.sessionVersion !== user.sessionVersion) return null;

  return { user, contact, client };
}

/**
 * Claims for the emailed magic link. Only identifiers: verify-token re-resolves
 * the user, contact and client from the database (resolvePortalPrincipal), so
 * carrying the contact's name or email would only leak PII into the URL and
 * let long names push the token past the redemption length bound.
 */
export function magicLinkClaims(user, contact) {
  return {
    id: user.id,
    contactId: contact.id,
    clientId: contact.clientId,
    organizationId: contact.client.organizationId,
    role: 'CLIENT',
    sessionVersion: user.sessionVersion,
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────
export default async function clientPortalRoutes(fastify) {

  // ── CLIENT JWT middleware ────────────────────────────────────────────────────
  async function clientAuth(request, reply) {
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

      const payload = fastify.jwt.verify(rawToken);

      if (!(await isCurrentUserSession(request.prisma, payload))) return reply.status(401).send({ error: 'Session expired or revoked' });
      const principal = await resolvePortalPrincipal(request.prisma, payload);
      if (!principal) return reply.status(401).send({ error: 'Session expired or revoked' });

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

  // POST /api/client-portal/request-access
  // Sends a magic link email — link points to /verify-token which sets a secure cookie
  fastify.post('/request-access', {
    preHandler: [validateBody(requestAccessSchema)],
  }, async (request, reply) => {
    const { email } = request.body;

    const normalizedEmail = email.toLowerCase().trim();
    const contact = await request.prisma.contact.findFirst({
      where: {
        email: normalizedEmail,
        client: {
          deletedAt: null,
          status: 'ACTIVE',
          relationshipStatus: { notIn: ['ARCHIVED', 'CHURNED'] },
        },
      },
      include: { client: { select: { id: true, name: true, organizationId: true } } },
    });

    if (!contact) {
      // Don't leak whether email exists
      return { sent: true };
    }

    let user = await request.prisma.user.findUnique({ where: { email: normalizedEmail } });
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
    await sendMagicLinkEmail(contact.email, contact.name, magicLink);

    return { sent: true };
  });

  // POST /api/client-portal/verify-token
  // Exchanges a magic-link token for an httpOnly secure cookie
  // This avoids JWT tokens appearing in browser history / Referer headers
  fastify.post('/verify-token', {
    preHandler: validateBody(clientPortalTokenRedeemSchema),
  }, async (request, reply) => {
    const { token } = request.body || {};

    if (!token) {
      return reply.status(400).send({ error: 'Token required' });
    }

    try {
      const payload = fastify.jwt.verify(token);

      const principal = await resolvePortalPrincipal(request.prisma, payload);
      if (!principal) return reply.status(401).send({ error: 'Invalid, expired, or revoked token' });

      const sessionToken = signUserSession(fastify.jwt, principal.user, { contactId: principal.contact.id });

      reply
        .setCookie('token', sessionToken, {
          path: '/',
          httpOnly: true,
          secure: env.isProduction,
          sameSite: env.isProduction ? 'strict' : 'lax',
          maxAge: sessionCookieMaxAge()
        })
        .send({
          user: {
            contactId: principal.contact.id,
            clientId: principal.client.id,
            role: 'CLIENT'
          }
        });
    } catch (err) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }
  });

  fastify.post('/logout', { preHandler: clientAuth }, async (request, reply) => {
    await revokeUserSessions(request.prisma, request.clientUser.id);
    return reply
      .clearCookie('token', {
        path: '/',
        httpOnly: true,
        secure: env.isProduction,
        sameSite: env.isProduction ? 'strict' : 'lax',
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

    return { client, contact };
  });

  // ── Projects ─────────────────────────────────────────────────────────────────

  // GET /api/client-portal/projects
  fastify.get('/projects', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;

    const projects = await request.prisma.project.findMany({
      where: { clientId, status: { notIn: ['CANCELLED'] } },
      select: {
        id: true,
        name: true,
        status: true,
        health: true,
        aiSummary: true,
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
      where: { id, clientId },
      select: {
        id: true,
        name: true,
        status: true,
        health: true,
        aiSummary: true,
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
      where: { id: revisionId, projectId, project: { clientId } },
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
      await transaction.activity.create({
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
      });
      return transaction.revisionRound.findUnique({ where: { id: revision.id } });
    });
    if (!updated) return reply.status(409).send({ error: 'Revision round is no longer awaiting a response' });
    return updated;
  });

  fastify.post('/projects/:id/feedback', {
    preHandler: [clientAuth, validateBody(clientPortalFeedbackSchema)],
  }, async (request, reply) => {
    const { clientId, contactId, id: userId } = request.clientUser;
    const { id: projectId } = request.params;
    const project = await request.prisma.project.findFirst({
      where: { id: projectId, clientId },
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
    return reply.status(201).send(activity);
  });

  // GET /api/client-portal/projects/:id/tasks — Kanban tasks
  fastify.get('/projects/:id/tasks', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    // Verify project belongs to client
    const project = await request.prisma.project.findFirst({ where: { id, clientId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const tasks = await request.prisma.task.findMany({
      where: { projectId: id, parentId: null },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        category: true,
        dueDate: true,
        completedAt: true,
        position: true,
        assigneeId: true,
        assignee: { select: { id: true, name: true } },
        milestoneId: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
    });

    // Group by status for kanban columns
    const columns = {
      TODO: tasks.filter(t => ['PENDING', 'UPCOMING', 'IMMEDIATE'].includes(t.status)),
      IN_PROGRESS: tasks.filter(t => t.status === 'IN_PROGRESS'),
      DONE: tasks.filter(t => t.status === 'COMPLETED'),
      BLOCKED: tasks.filter(t => t.status === 'BLOCKED')
    };

    return { tasks, columns };
  });

  // ── Messages / Chat ──────────────────────────────────────────────────────────

  // GET /api/client-portal/projects/:id/messages
  fastify.get('/projects/:id/messages', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;
    const { limit = '50', before, after } = request.query;

    const project = await request.prisma.project.findFirst({ where: { id, clientId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const where = { projectId: id };
    if (before) where.createdAt = { lt: new Date(before) };
    else if (after) where.createdAt = { gt: new Date(after) };

    const messages = await request.prisma.chatMessage.findMany({
      where,
      include: {
        author: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'asc' },
      take: parseInt(limit)
    });

    return messages.map(m => ({
      ...m,
      metadata: m.metadata ? JSON.parse(m.metadata) : null
    }));
  });

  // POST /api/client-portal/projects/:id/messages
  fastify.post('/projects/:id/messages', { preHandler: [clientAuth, validateBody(clientPortalMessageSchema)] }, async (request, reply) => {
    const { clientId, contactId } = request.clientUser;
    const { id } = request.params;
    const { content, type } = request.body;

    const project = await request.prisma.project.findFirst({ where: { id, clientId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Find or create a user for the contact to use as author
    const contact = await request.prisma.contact.findUnique({ where: { id: contactId } });
    let authorUser = await request.prisma.user.findFirst({
      where: { email: contact.email }
    });

    // If no user exists for this contact, create a minimal one
    if (!authorUser) {
      authorUser = await request.prisma.user.create({
        data: {
          email: contact.email,
          name: contact.name,
          password: await bcrypt.hash(randomUUID(), 12), // magic-link account; keep stored credential non-reusable
          role: 'CLIENT',
          clientId
        }
      });
    }

    const message = await request.prisma.chatMessage.create({
      data: {
        content,
        type,
        projectId: id,
        authorId: authorUser.id
      },
      include: {
        author: { select: { id: true, name: true, email: true } }
      }
    });

    // Broadcast to project room via Socket.IO
    fastify.io.to(`project:${id}`).emit('chat:message', {
      ...message,
      metadata: message.metadata ? JSON.parse(message.metadata) : null
    });

    return reply.status(201).send({
      ...message,
      metadata: message.metadata ? JSON.parse(message.metadata) : null
    });
  });

  // ── Documents / File Uploads ─────────────────────────────────────────────────

  // GET /api/client-portal/projects/:id/documents
  fastify.get('/projects/:id/documents', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    const project = await request.prisma.project.findFirst({ where: { id, clientId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const documents = await request.prisma.attachment.findMany({
      where: { entityType: 'PROJECT', entityId: id },
      include: {
        uploadedBy: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return documents;
  });

  fastify.get('/documents/:docId/download', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const doc = await request.prisma.attachment.findUnique({ where: { id: request.params.docId } });
    if (!doc || doc.entityType !== 'PROJECT' || doc.path.startsWith('/uploads/quarantine/')) {
      return reply.status(404).send({ error: 'Document not found' });
    }
    const project = await request.prisma.project.findFirst({ where: { id: doc.entityId, clientId } });
    if (!project) return reply.status(404).send({ error: 'Document not found' });
    try {
      const file = await fs.readFile(path.join(process.cwd(), doc.path));
      const downloadName = path.basename(doc.originalName).replace(/["\\\r\n]/g, '_');
      return reply
        .header('Content-Type', doc.mimeType || 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${downloadName}"`)
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
    const { clientId, contactId } = request.clientUser;
    const { id } = request.params;

    const project = await request.prisma.project.findFirst({ where: { id, clientId } });
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
      return reply.status(400).send({ error: validation.error });
    }

    // Ensure upload directory
    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    // Use validated extension (always from allowlist)
    const filename = `${randomUUID()}${validation.ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // Write file
    await fs.writeFile(filepath, buffer);

    // Find or create user for the contact
    const contact = await request.prisma.contact.findUnique({ where: { id: contactId } });
    let authorUser = await request.prisma.user.findFirst({ where: { email: contact.email } });
    if (!authorUser) {
      authorUser = await request.prisma.user.create({
        data: {
          email: contact.email,
          name: contact.name,
          // This account is not password-authenticated, but the invariant for
          // every stored login credential remains a bcrypt hash.
          password: await bcrypt.hash(randomUUID(), 12),
          role: 'CLIENT',
          clientId
        }
      });
    }

    // Save attachment record
    const attachment = await request.prisma.attachment.create({
      data: {
        filename,
        originalName: data.filename,
        mimeType: validation.mimetype,
        size: buffer.length,
        path: `/uploads/${filename}`,
        entityType: 'PROJECT',
        entityId: id,
        uploadedById: authorUser.id,
        organizationId: project.organizationId,
      },
      include: {
        uploadedBy: { select: { id: true, name: true } }
      }
    });

    return reply.status(201).send(attachment);
  });

  // DELETE /api/client-portal/documents/:docId — Delete uploaded doc
  fastify.delete('/documents/:docId', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { docId } = request.params;

    const doc = await request.prisma.attachment.findUnique({ where: { id: docId } });
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    // Verify the document belongs to a project owned by this client
    if (doc.entityType === 'PROJECT') {
      const project = await request.prisma.project.findFirst({
        where: { id: doc.entityId, clientId }
      });
      if (!project) {
        return reply.status(403).send({ error: 'Not authorized' });
      }
    } else {
      return reply.status(403).send({ error: 'Not authorized' });
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

    // Delete file from disk
    try {
      const filePath = path.join(process.cwd(), doc.path);
      await fs.unlink(filePath);
    } catch {
      // File may already be deleted, continue
    }

    await recordRequestAuditEvent(request.prisma, request, {
      action: 'client_portal.document_deleted',
      actorType: 'CLIENT',
      actorUserId: request.clientUser.id ?? null,
      organizationId: request.clientUser.organizationId,
      entityId: docId,
      metadata: { projectId: doc.entityId, clientId, mimeType: doc.mimeType, size: doc.size },
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
      const pdfBuffer = await generateContractPdf(contract);
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

    const invoices = await request.prisma.invoice.findMany({
      where: { clientId },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        total: true,
        currency: true,
        issueDate: true,
        dueDate: true,
        paidAt: true,
        stripePaymentLink: true,
        title: true,
        notes: true
      },
      orderBy: { issueDate: 'desc' }
    });

    return invoices;
  });

  // GET /api/client-portal/invoices/:id/pdf
  fastify.get('/invoices/:id/pdf', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    const invoice = await request.prisma.invoice.findFirst({
      where: { id, clientId },
      include: {
        client: true,
        lineItems: true,
        payments: true
      }
    });

    if (!invoice) {
      return reply.status(404).send({ error: 'Invoice not found' });
    }

    const pdfBuffer = await generateInvoicePdf(invoice);

    reply
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
      where: { clientId, status: { notIn: ['CANCELLED'] } },
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
        type: 'TEXT'
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
}
