// Client Portal Routes — passwordless magic-link auth + full portal experience

import { prisma } from '../index.js';
import { generateInvoicePdf } from '../utils/generate-invoice-pdf.js';
import env from '../config/env.js';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

const PORTAL_BASE = env.hubUrl;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// ── Mailgun helper (no-op if not configured) ────────────────────────────────
async function sendMagicLinkEmail(toEmail, toName, magicLink) {
  const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
  const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.log('[client-portal] Mailgun not configured — magic link:', magicLink);
    return;
  }

  const body = new URLSearchParams();
  body.append('from', `Ashbi Design <noreply@${MAILGUN_DOMAIN}>`);
  body.append('to', `${toName} <${toEmail}>`);
  body.append('subject', 'Your Ashbi Design Client Portal Link');
  body.append('html', `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#2e2958;color:#f1f5f9;padding:40px;border-radius:12px;">
      <h2 style="color:#e6f354;margin-top:0;">Ashbi Design — Client Portal</h2>
      <p>Hi ${toName},</p>
      <p>Click the button below to access your portal. This link expires in <strong>1 hour</strong>.</p>
      <a href="${magicLink}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#e6f354;color:#2e2958;border-radius:8px;text-decoration:none;font-weight:600;">
        Access My Portal
      </a>
      <p style="font-size:12px;color:#94a3b8;">If you didn't request this, you can safely ignore it.<br>Link: ${magicLink}</p>
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
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────
export default async function clientPortalRoutes(fastify) {

  // ── CLIENT JWT middleware ────────────────────────────────────────────────────
  async function clientAuth(request, reply) {
    try {
      const rawToken =
        request.query?.token ||
        (request.headers.authorization?.startsWith('Bearer ')
          ? request.headers.authorization.slice(7)
          : null);

      if (!rawToken) {
        return reply.status(401).send({ error: 'Missing token' });
      }

      const payload = fastify.jwt.verify(rawToken);

      if (payload.role !== 'CLIENT') {
        return reply.status(403).send({ error: 'Not authorized' });
      }

      request.clientUser = payload; // { contactId, clientId, role }
    } catch (err) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  // POST /api/client-portal/request-access
  fastify.post('/client-portal/request-access', async (request, reply) => {
    const { email } = request.body || {};
    if (!email) {
      return reply.status(400).send({ error: 'Email required' });
    }

    const contact = await prisma.contact.findFirst({
      where: { email: email.toLowerCase().trim() },
      include: { client: true }
    });

    if (!contact) {
      return { sent: true };
    }

    const token = fastify.jwt.sign({ contactId: contact.id, clientId: contact.clientId, role: 'CLIENT' }, { expiresIn: '1h' });
    const magicLink = `${PORTAL_BASE}/client-portal?token=${token}`;
    await sendMagicLinkEmail(contact.email, contact.name, magicLink);

    return { sent: true };
  });

  // GET /api/client-portal/me
  fastify.get('/client-portal/me', { preHandler: clientAuth }, async (request, reply) => {
    const { contactId, clientId } = request.clientUser;

    const [contact, client] = await Promise.all([
      prisma.contact.findUnique({ where: { id: contactId }, select: { name: true, email: true } }),
      prisma.client.findUnique({ where: { id: clientId }, select: { name: true, contactPerson: true } })
    ]);

    if (!contact || !client) {
      return reply.status(404).send({ error: 'Not found' });
    }

    return { client, contact };
  });

  // ── Projects ─────────────────────────────────────────────────────────────────

  // GET /api/client-portal/projects
  fastify.get('/client-portal/projects', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;

    const projects = await prisma.project.findMany({
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

    const withProgress = await Promise.all(projects.map(async (p) => {
      const completedCount = await prisma.task.count({
        where: { projectId: p.id, status: 'COMPLETED' }
      });
      const totalCount = p._count.tasks;
      return {
        ...p,
        completedTasks: completedCount,
        totalTasks: totalCount,
        progressPct: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
      };
    }));

    return withProgress;
  });

  // GET /api/client-portal/projects/:id
  fastify.get('/client-portal/projects/:id', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    const project = await prisma.project.findFirst({
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
        _count: { select: { tasks: true } }
      }
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const completedCount = await prisma.task.count({
      where: { projectId: id, status: 'COMPLETED' }
    });

    return {
      ...project,
      completedTasks: completedCount,
      totalTasks: project._count.tasks,
      progressPct: project._count.tasks > 0 ? Math.round((completedCount / project._count.tasks) * 100) : 0
    };
  });

  // GET /api/client-portal/projects/:id/tasks — Kanban tasks
  fastify.get('/client-portal/projects/:id/tasks', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    // Verify project belongs to client
    const project = await prisma.project.findFirst({ where: { id, clientId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const tasks = await prisma.task.findMany({
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
  fastify.get('/client-portal/projects/:id/messages', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;
    const { limit = '50', before, after } = request.query;

    const project = await prisma.project.findFirst({ where: { id, clientId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const where = { projectId: id };
    if (before) where.createdAt = { lt: new Date(before) };
    else if (after) where.createdAt = { gt: new Date(after) };

    const messages = await prisma.chatMessage.findMany({
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
  fastify.post('/client-portal/projects/:id/messages', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId, contactId } = request.clientUser;
    const { id } = request.params;
    const { content, type = 'TEXT' } = request.body;

    if (!content?.trim()) {
      return reply.status(400).send({ error: 'Message content is required' });
    }

    const project = await prisma.project.findFirst({ where: { id, clientId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Find or create a user for the contact to use as author
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    let authorUser = await prisma.user.findFirst({
      where: { email: contact.email }
    });

    // If no user exists for this contact, create a minimal one
    if (!authorUser) {
      authorUser = await prisma.user.create({
        data: {
          email: contact.email,
          name: contact.name,
          password: randomUUID(), // random password — they auth via magic link
          role: 'CLIENT',
          clientId
        }
      });
    }

    const message = await prisma.chatMessage.create({
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
  fastify.get('/client-portal/projects/:id/documents', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    const project = await prisma.project.findFirst({ where: { id, clientId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const documents = await prisma.attachment.findMany({
      where: { entityType: 'PROJECT', entityId: id },
      include: {
        uploadedBy: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return documents;
  });

  // POST /api/client-portal/projects/:id/upload — Upload document
  fastify.post('/client-portal/projects/:id/upload', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId, contactId } = request.clientUser;
    const { id } = request.params;

    const project = await prisma.project.findFirst({ where: { id, clientId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    // Ensure upload directory
    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    const ext = path.extname(data.filename).toLowerCase();
    const filename = `${randomUUID()}${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // Write file
    const buffer = await data.toBuffer();
    await fs.writeFile(filepath, buffer);

    // Find or create user for the contact
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    let authorUser = await prisma.user.findFirst({ where: { email: contact.email } });
    if (!authorUser) {
      authorUser = await prisma.user.create({
        data: {
          email: contact.email,
          name: contact.name,
          password: randomUUID(),
          role: 'CLIENT',
          clientId
        }
      });
    }

    // Save attachment record
    const attachment = await prisma.attachment.create({
      data: {
        filename,
        originalName: data.filename,
        mimeType: data.mimetype,
        size: buffer.length,
        path: `/uploads/${filename}`,
        entityType: 'PROJECT',
        entityId: id,
        uploadedById: authorUser.id
      },
      include: {
        uploadedBy: { select: { id: true, name: true } }
      }
    });

    return reply.status(201).send(attachment);
  });

  // DELETE /api/client-portal/documents/:docId — Delete uploaded doc
  fastify.delete('/client-portal/documents/:docId', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { docId } = request.params;

    const doc = await prisma.attachment.findUnique({ where: { id: docId } });
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    // Verify the document belongs to a project owned by this client
    if (doc.entityType === 'PROJECT') {
      const project = await prisma.project.findFirst({
        where: { id: doc.entityId, clientId }
      });
      if (!project) {
        return reply.status(403).send({ error: 'Not authorized' });
      }
    } else {
      return reply.status(403).send({ error: 'Not authorized' });
    }

    // Delete file from disk
    try {
      const filePath = path.join(process.cwd(), doc.path);
      await fs.unlink(filePath);
    } catch {
      // File may already be deleted, continue
    }

    await prisma.attachment.delete({ where: { id: docId } });

    return { success: true };
  });

  // ── Invoices ─────────────────────────────────────────────────────────────────

  // GET /api/client-portal/invoices
  fastify.get('/client-portal/invoices', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;

    const invoices = await prisma.invoice.findMany({
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
  fastify.get('/client-portal/invoices/:id/pdf', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;
    const { id } = request.params;

    const invoice = await prisma.invoice.findFirst({
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
  fastify.get('/client-portal/retainer', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;

    const retainer = await prisma.retainerPlan.findUnique({
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
  fastify.get('/client-portal/unread-count', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;

    // Get all project IDs for this client
    const projects = await prisma.project.findMany({
      where: { clientId, status: { notIn: ['CANCELLED'] } },
      select: { id: true }
    });

    const projectIds = projects.map(p => p.id);

    // Count messages from last 7 days as "recent"
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const recentMessages = await prisma.chatMessage.count({
      where: {
        projectId: { in: projectIds },
        createdAt: { gte: weekAgo },
        type: 'TEXT'
      }
    });

    const upcomingDeadlines = await prisma.task.count({
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