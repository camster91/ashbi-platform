import crypto from 'crypto';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { sendContractSignEmail } from '../services/email.service.js';
import { deliveryFieldsFromSend, withDeliveryState } from '../services/mailgun-delivery.service.js';
import { getContractTemplate, renderTemplate } from '../services/contractTemplates.service.js';
import {validateBody, createContractSchema, updateContractDraftSchema, contractDraftUpdateSchema} from '../validators/schemas.js';
import { clampTake } from '../utils/query-limits.js';
import { contractPdfFilename, generateContractPdf } from '../utils/generate-contract-pdf.js';
import { createPublicAccessWindow, publicAccessFailure } from '../utils/public-document-access.js';

// Returns the provider result ({ ok, id?, error? }), or null when no send was
// attempted (test mode). The helper used to return `true` whenever it did not
// throw, even when Mailgun rejected the message.
async function sendContractEmail(to, clientName, contractTitle, signUrl, contractId) {
  // NODE_ENV/ASHBI_RUN_EMAIL_TESTS read directly because they are dev-only
  // test toggles not exposed in env.js. See proposal.routes.js for the same
  // pattern.
  if (process.env.NODE_ENV === 'test' && process.env.ASHBI_RUN_EMAIL_TESTS !== '1') return null;
  if (!env.mailgunApiKey || !env.mailgunDomain) return { ok: false, error: 'Mailgun not configured' };
  try {
    return await sendContractSignEmail({ to, clientName, contractTitle, signLink: signUrl, contractId });
  } catch (err) {
    logger.error({ errorName: err?.name, errorCode: err?.code }, '[Contract] Email send error');
    return { ok: false, error: 'Contract email send error' };
  }
}

async function recordContractDelivery(prisma, contractId, delivery) {
  if (!delivery) return null;
  const data = deliveryFieldsFromSend(delivery);
  await prisma.contract.update({ where: { id: contractId }, data });
  return data;
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
    return withDeliveryState(contract);
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
    let deliveryFields = null;
    if (primaryContact?.email) {
      const baseUrl = env.appUrl;
      const signUrl = `${baseUrl}/portal/contract/${access.token}`;
      const delivery = await sendContractEmail(primaryContact.email, primaryContact.name || contract.client?.name, contract.title || 'Service Agreement', signUrl, contract.id);
      emailSent = Boolean(delivery?.ok);
      deliveryFields = await recordContractDelivery(fastify.prisma, contract.id, delivery);
    }

    return withDeliveryState({ ...updated, ...deliveryFields, emailSent });
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
      deliveryMessageId,
      deliveryError,
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
    const delivery = await sendContractEmail(contact.email, contact.name || contract.client.name, contract.title, signUrl, contract.id);
    await recordContractDelivery(request.prisma, contract.id, delivery);
    if (!delivery?.ok) return reply.status(503).send({ error: 'Contract email delivery is unavailable', retryable: true });
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

    const pdfBuffer = await generateContractPdf(contract);

    const safeFilename = contractPdfFilename(contract);
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
