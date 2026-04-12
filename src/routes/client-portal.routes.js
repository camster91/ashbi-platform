// Client Portal Routes — passwordless magic-link auth + invoice viewer

import { prisma } from '../index.js';
import { generateInvoicePdf } from '../utils/generate-invoice-pdf.js';
import env from '../config/env.js';

const PORTAL_BASE = env.hubUrl;

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
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:40px;border-radius:12px;">
      <h2 style="color:#3b82f6;margin-top:0;">Ashbi Design — Client Portal</h2>
      <p>Hi ${toName},</p>
      <p>Click the button below to access your invoices. This link expires in <strong>1 hour</strong>.</p>
      <a href="${magicLink}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
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

  // POST /api/client-portal/request-access
  fastify.post('/client-portal/request-access', async (request, reply) => {
    const { email } = request.body || {};
    if (!email) {
      return reply.status(400).send({ error: 'Email required' });
    }

    // Find contact by email
    const contact = await prisma.contact.findFirst({
      where: { email: email.toLowerCase().trim() },
      include: { client: true }
    });

    if (!contact) {
      // Don't reveal whether email exists — still return sent: true
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
        createdAt: true,
        updatedAt: true,
        _count: { select: { tasks: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });

    // Compute task completion % for each project
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

  // GET /api/client-portal/retainer
  fastify.get('/client-portal/retainer', { preHandler: clientAuth }, async (request, reply) => {
    const { clientId } = request.clientUser;

    const retainer = await prisma.retainerPlan.findUnique({
      where: { clientId }
    });

    if (!retainer) return null;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
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
      retainerStatus: retainer.retainerStatus,
      cycleStartDate: startOfMonth.toISOString()
    };
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
}
