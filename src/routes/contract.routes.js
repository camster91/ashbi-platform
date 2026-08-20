import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { sendContractSignEmail } from '../services/email.service.js';
import { getContractTemplate, renderTemplate } from '../services/contractTemplates.service.js';
import {validateBody, createContractSchema, updateContractDraftSchema, contractDraftUpdateSchema} from '../validators/schemas.js';
import { clampTake } from '../utils/query-limits.js';
import { createPublicAccessWindow, publicAccessFailure } from '../utils/public-document-access.js';

async function sendContractEmail(to, clientName, contractTitle, signUrl) {
  // NODE_ENV/ASHBI_RUN_EMAIL_TESTS read directly because they are dev-only
  // test toggles not exposed in env.js. See proposal.routes.js for the same
  // pattern.
  if (process.env.NODE_ENV === 'test' && process.env.ASHBI_RUN_EMAIL_TESTS !== '1') return false;
  if (!env.mailgunApiKey || !env.mailgunDomain) return false;
  try {
    await sendContractSignEmail({ to, clientName, contractTitle, signLink: signUrl });
    return true;
  } catch (err) {
    logger.error({ err, to, contractTitle }, '[Contract] Email send error');
    return false;
  }
}

export default async function contractRoutes(fastify) {

  // GET / — list all contracts (auth required)
  // Include client name, createdBy name, proposal title if linked
  // Support ?clientId and ?status query filters
  // Order by createdAt desc
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const { clientId, status } = request.query;
    const where = {};
    if (clientId) where.clientId = clientId;
    if (status) where.status = status;

    return request.prisma.contract.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        proposal: { select: { id: true, title: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: clampTake(request.query.limit),
    });
  });

  // GET /:id — get one contract with all relations
  fastify.get('/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const contract = await fastify.prisma.contract.findUnique({
      where: { id: request.params.id },
      include: {
        client: true,
        createdBy: { select: { id: true, name: true, email: true } },
        proposal: { include: { lineItems: true } }
      }
    });
    if (!contract) return reply.status(404).send({ error: 'Contract not found' });
    return contract;
  });

  // POST / — create contract
  // Body: { clientId, title, templateType, content?, proposalId? }
  // If no content provided and templateType given, use template with client name
  fastify.post('/', { onRequest: [fastify.authenticate], preHandler: [validateBody(createContractSchema)] }, async (request) => {
    const { clientId, title, templateType, content, proposalId } = request.body;

    let contractContent = content;
    if (!contractContent && templateType) {
      const client = await fastify.prisma.client.findUnique({ where: { id: clientId } });
      const rendered = renderTemplate(templateType, { clientName: client?.name || '' });
      contractContent = rendered?.content || '';
    }

    return fastify.prisma.contract.create({
      data: {
        title,
        templateType: templateType || 'RETAINER',
        content: contractContent || '',
        clientId,
        proposalId: proposalId || null,
        createdById: request.user.id
      },
      include: {
        client: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });
  });

  // POST /from-proposal/:proposalId — auto-generate contract from approved proposal
  fastify.post('/from-proposal/:proposalId', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const proposal = await fastify.prisma.proposal.findUnique({
      where: { id: request.params.proposalId },
      include: { client: true, lineItems: true }
    });

    if (!proposal) return reply.status(404).send({ error: 'Proposal not found' });
    if (proposal.status !== 'APPROVED') return reply.status(400).send({ error: 'Proposal must be approved first' });

    const contractInclude = {
      client: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } }
    };
    const existing = await fastify.prisma.contract.findUnique({
      where: { proposalId: proposal.id },
      include: contractInclude
    });
    if (existing) return existing;

    const deliverables = '<ul>' + proposal.lineItems.map(li => `<li>${li.description} (${li.quantity}x @ $${li.unitPrice})</li>`).join('') + '</ul>';

    const rendered = renderTemplate('PROJECT', {
      clientName: proposal.client.name,
      projectName: proposal.title,
      price: proposal.total.toFixed(2),
      timeline: 'To be determined',
      deliverables
    });

    try {
      return await fastify.prisma.contract.create({
        data: {
          title: `Contract: ${proposal.title}`,
          templateType: 'PROJECT',
          content: rendered?.content || '',
          clientId: proposal.clientId,
          proposalId: proposal.id,
          createdById: request.user.id
        },
        include: contractInclude
      });
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      return fastify.prisma.contract.findUnique({
        where: { proposalId: proposal.id },
        include: contractInclude
      });
    }
  });

  // POST /:id/send — mark contract as SENT and email client
  fastify.post('/:id/send', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const contract = await fastify.prisma.contract.findUnique({
      where: { id: request.params.id },
      include: {
        client: {
          select: {
            name: true,
            contacts: { where: { isPrimary: true }, take: 1 }
          }
        }
      }
    });
    if (!contract) return reply.status(404).send({ error: 'Contract not found' });
    if (contract.status !== 'DRAFT') return reply.status(400).send({ error: 'Only draft contracts can be sent' });

    const access = createPublicAccessWindow();
    const updated = await fastify.prisma.contract.update({
      where: { id: request.params.id },
      data: {
        status: 'SENT',
        signToken: access.token,
        publicAccessExpiresAt: access.expiresAt,
        publicAccessRevokedAt: access.revokedAt,
      }
    });

    // Email the primary contact
    const primaryContact = contract.client?.contacts?.[0];
    let emailSent = false;
    if (primaryContact?.email) {
      const baseUrl = env.appUrl;
      const signUrl = `${baseUrl}/portal/contract/${access.token}`;
      emailSent = await sendContractEmail(primaryContact.email, primaryContact.name || contract.client?.name, contract.title || 'Service Agreement', signUrl);
    }

    return { ...updated, emailSent };
  });

  // GET /sign/:signToken — PUBLIC — client views contract to sign
  fastify.get('/sign/:signToken', { config: { public: true } }, async (request, reply) => {
    const contract = await fastify.prisma.contract.findUnique({
      where: { signToken: request.params.signToken },
      include: {
        client: { select: { name: true } },
        createdBy: { select: { name: true } }
      }
    });
    const accessFailure = publicAccessFailure(contract);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    const {
      signToken: storedToken,
      createdById,
      clientId,
      proposalId,
      draftData,
      deletedAt,
      signerIp,
      signerUserAgent,
      publicAccessRevokedAt,
      ...publicContract
    } = contract;
    return publicContract;
  });

  // POST /sign/:signToken — PUBLIC — client signs contract
  // Body: { signerName, agreement: true }
  fastify.post('/sign/:signToken', { config: { public: true } }, async (request, reply) => {
    const { signerName, agreement, signatureType = 'type', signatureImage } = request.body || {};
    if (!signerName || !agreement) return reply.status(400).send({ error: 'signerName and agreement:true required' });
    if (!['type', 'draw'].includes(signatureType)) return reply.status(400).send({ error: 'signatureType must be type or draw' });
    if (signatureType === 'draw' && !signatureImage) return reply.status(400).send({ error: 'signatureImage is required for drawn signatures' });

    const contract = await fastify.prisma.contract.findUnique({ where: { signToken: request.params.signToken } });
    const accessFailure = publicAccessFailure(contract);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    if (contract.status !== 'SENT') return reply.status(409).send({ error: 'Contract is not awaiting signature' });

    const now = new Date();
    const signatureSecret = env.contractSignatureSecret;
    if (!signatureSecret) return reply.status(503).send({ error: 'Contract signing is unavailable' });
    const signedContentHash = crypto.createHash('sha256').update(contract.content).digest('hex');
    const signatureDataHash = crypto.createHash('sha256')
      .update(signatureType === 'draw' ? signatureImage : signerName)
      .digest('hex');
    const sigHash = crypto.createHmac('sha256', signatureSecret)
      .update(`${contract.id}:${signedContentHash}:${signerName}:${signatureType}:${signatureDataHash}:${now.toISOString()}`)
      .digest('hex');

    const updated = await fastify.prisma.contract.updateMany({
      where: { id: contract.id, status: 'SENT', publicAccessRevokedAt: null },
      data: {
        status: 'SIGNED',
        clientSigHash: sigHash,
        clientSigName: signerName,
        clientSigDate: now,
        signedAt: now,
        signedContentHash,
        signatureType,
        signatureDataHash,
        signerIp: request.ip,
        signerUserAgent: String(request.headers['user-agent'] || '').slice(0, 500),
        publicAccessRevokedAt: now,
      }
    });
    if (updated.count !== 1) return reply.status(409).send({ error: 'Contract is no longer awaiting signature' });
    return {
      status: 'SIGNED',
      signedAt: now,
      clientSigName: signerName,
      signedContentHash,
      signatureType,
    };
  });

  fastify.post('/:id/public-link/revoke', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const contract = await request.prisma.contract.findUnique({ where: { id: request.params.id } });
    if (!contract) return reply.status(404).send({ error: 'Contract not found' });
    await request.prisma.contract.update({
      where: { id: contract.id },
      data: { publicAccessRevokedAt: new Date() },
    });
    return { revoked: true };
  });

  fastify.post('/:id/resend', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const contract = await request.prisma.contract.findUnique({
      where: { id: request.params.id },
      include: { client: { include: { contacts: { where: { isPrimary: true }, take: 1 } } } },
    });
    if (!contract) return reply.status(404).send({ error: 'Contract not found' });
    if (contract.status !== 'SENT') return reply.status(409).send({ error: 'Only sent contracts can be resent' });
    const accessFailure = publicAccessFailure(contract);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    const contact = contract.client?.contacts?.[0];
    if (!contact?.email) return reply.status(409).send({ error: 'Primary client email is missing' });
    const signUrl = `${env.appUrl}/portal/contract/${contract.signToken}`;
    const emailSent = await sendContractEmail(contact.email, contact.name || contract.client.name, contract.title, signUrl);
    if (!emailSent) return reply.status(503).send({ error: 'Contract email delivery is unavailable', retryable: true });
    return { emailSent: true };
  });

  fastify.post('/:id/public-link/rotate', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const contract = await request.prisma.contract.findUnique({ where: { id: request.params.id } });
    if (!contract) return reply.status(404).send({ error: 'Contract not found' });
    if (contract.status !== 'SENT') return reply.status(409).send({ error: 'Contract is not awaiting signature' });
    const access = createPublicAccessWindow();
    return request.prisma.contract.update({
      where: { id: contract.id },
      data: { signToken: access.token, publicAccessExpiresAt: access.expiresAt, publicAccessRevokedAt: null },
      select: { signToken: true, publicAccessExpiresAt: true },
    });
  });

  fastify.post('/:id/void', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const contract = await request.prisma.contract.findUnique({ where: { id: request.params.id } });
    if (!contract) return reply.status(404).send({ error: 'Contract not found' });
    if (contract.status === 'SIGNED') return reply.status(409).send({ error: 'A signed contract cannot be voided' });
    if (contract.status === 'VOID') return contract;
    return request.prisma.contract.update({
      where: { id: contract.id },
      data: { status: 'VOID', publicAccessRevokedAt: new Date() },
    });
  });

  // GET /:id/pdf — generate branded PDF
  fastify.get('/:id/pdf', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const contract = await fastify.prisma.contract.findUnique({
      where: { id: request.params.id },
      include: { client: { select: { name: true } }, createdBy: { select: { name: true } } }
    });
    if (!contract) return reply.status(404).send({ error: 'Contract not found' });

    const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 60, right: 60 }, bufferPages: true });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));

    // Strip HTML for text rendering
    const stripHtml = (html) => {
      if (!html) return '';
      return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<li>/gi, '  \u2022 ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    };

    const primaryColor = '#2e2958';
    const accentColor = '#e6f354';
    const textColor = '#1a1a1a';
    const mutedColor = '#666666';

    // ---- Header bar ----
    doc.rect(0, 0, doc.page.width, 50).fill(primaryColor);
    doc.fillColor(accentColor).fontSize(18).font('Helvetica-Bold')
      .text('ASHBI HUB', 60, 15, { align: 'left' });
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica')
      .text('hub.ashbi.ca', doc.page.width - 160, 20, { align: 'right', width: 100 });

    // ---- Contract title ----
    doc.moveDown(2);
    doc.fillColor(primaryColor).fontSize(22).font('Helvetica-Bold')
      .text(contract.title || 'Service Agreement', { align: 'center' });
    doc.moveDown(0.5);

    // ---- Meta line ----
    doc.fillColor(mutedColor).fontSize(10).font('Helvetica');
    const metaLine = `Client: ${contract.client?.name || 'N/A'}    |    Date: ${new Date(contract.createdAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}    |    Type: ${contract.templateType || 'N/A'}`;
    doc.text(metaLine, { align: 'center' });
    doc.moveDown(0.3);

    // Accent line separator
    const lineY = doc.y;
    doc.moveTo(60, lineY).lineTo(doc.page.width - 60, lineY).strokeColor(accentColor).lineWidth(2).stroke();
    doc.moveDown(1);

    // ---- Contract content ----
    const plainContent = stripHtml(contract.content);
    doc.fillColor(textColor).fontSize(11).font('Helvetica')
      .text(plainContent, { align: 'left', lineGap: 4 });

    // ---- Signature block ----
    if (contract.status === 'SIGNED' && contract.clientSigName) {
      doc.moveDown(2);
      const sigY = doc.y;
      doc.moveTo(60, sigY).lineTo(300, sigY).strokeColor('#cccccc').lineWidth(0.5).stroke();
      doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold')
        .text(contract.clientSigName, 60, sigY + 5);
      doc.fillColor(mutedColor).fontSize(9).font('Helvetica')
        .text(`Signed on ${new Date(contract.signedAt || contract.clientSigDate).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}`, 60, sigY + 20);

      // Signature hash
      if (contract.clientSigHash) {
        doc.fontSize(7).fillColor('#aaaaaa')
          .text(`Signature ID: ${contract.clientSigHash}`, 60, sigY + 35);
      }
    }

    // ---- Footer with page numbers ----
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.save();
      const bottomY = doc.page.height - 40;
      doc.moveTo(60, bottomY - 5).lineTo(doc.page.width - 60, bottomY - 5).strokeColor('#eeeeee').lineWidth(0.5).stroke();
      doc.fillColor('#aaaaaa').fontSize(8).font('Helvetica')
        .text(`Ashbi Hub  |  hub.ashbi.ca  |  Page ${i + 1} of ${range.count}`, 60, bottomY, { align: 'center', width: doc.page.width - 120 });
      doc.restore();
    }

    doc.end();

    const pdfBuffer = await new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const safeFilename = (contract.title || 'contract').replace(/[^a-zA-Z0-9_-]/g, '_');
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${safeFilename}.pdf"`);
    reply.header('Content-Length', pdfBuffer.length);
    return reply.send(pdfBuffer);
  });

  // ─── PATCH /:id/draft — autosave draft data ───────
  fastify.patch('/:id/draft', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(contractDraftUpdateSchema),
  }, async (request, reply) => {
    const { id } = request.params;
    const { draftData } = request.body;

    await request.prisma.contract.update({
      where: { id },
      data: { draftData }
    });

    return { success: true };
  });

  // ─── GET /:id/draft — get autosave draft ───────
  fastify.get('/:id/draft', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const entity = await request.prisma.contract.findUnique({
      where: { id },
      select: { draftData: true }
    });
    if (!entity) return reply.status(404).send({ error: 'Not found' });
    return { draftData: entity.draftData };
  });
}
