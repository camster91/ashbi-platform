import crypto from 'crypto';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import { getContractTemplate, renderTemplate } from '../services/contractTemplates.service.js';

async function sendContractEmail(to, clientName, contractTitle, signUrl) {
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) return;
  try {
    const mg = new Mailgun(FormData);
    const client = mg.client({ username: 'api', key: process.env.MAILGUN_API_KEY });
    await client.messages.create(process.env.MAILGUN_DOMAIN, {
      from: `Ashbi Design <noreply@${process.env.MAILGUN_DOMAIN}>`,
      to,
      subject: `Action Required: Please Sign Your Contract — ${contractTitle}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #1a1a1a;">Hi ${clientName},</h2>
          <p style="color: #444; line-height: 1.6;">
            Your contract with Ashbi Design is ready for your signature.
            Please review the terms and sign electronically at your convenience.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${signUrl}" style="background: #6366f1; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
              Review &amp; Sign Contract
            </a>
          </div>
          <p style="color: #888; font-size: 13px;">
            If you have any questions, please reply to this email or contact us directly.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
          <p style="color: #aaa; font-size: 12px;">Ashbi Design · Toronto, Canada · hub.ashbi.ca</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[Contract] Email send error:', err.message);
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

    return fastify.prisma.contract.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        proposal: { select: { id: true, title: true } }
      },
      orderBy: { createdAt: 'desc' }
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
  fastify.post('/', { onRequest: [fastify.authenticate] }, async (request) => {
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

    // Check if contract already exists for this proposal
    const existing = await fastify.prisma.contract.findUnique({ where: { proposalId: proposal.id } });
    if (existing) return reply.status(400).send({ error: 'Contract already exists for this proposal' });

    const deliverables = '<ul>' + proposal.lineItems.map(li => `<li>${li.description} (${li.quantity}x @ $${li.unitPrice})</li>`).join('') + '</ul>';

    const rendered = renderTemplate('PROJECT', {
      clientName: proposal.client.name,
      projectName: proposal.title,
      price: proposal.total.toFixed(2),
      timeline: 'To be determined',
      deliverables
    });

    return fastify.prisma.contract.create({
      data: {
        title: `Contract: ${proposal.title}`,
        templateType: 'PROJECT',
        content: rendered?.content || '',
        clientId: proposal.clientId,
        proposalId: proposal.id,
        createdById: request.user.id
      },
      include: {
        client: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });
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

    const updated = await fastify.prisma.contract.update({
      where: { id: request.params.id },
      data: { status: 'SENT' }
    });

    // Email the primary contact
    const primaryContact = contract.client?.contacts?.[0];
    if (primaryContact?.email && contract.signToken) {
      const baseUrl = process.env.APP_URL || 'https://hub.ashbi.ca';
      const signUrl = `${baseUrl}/portal/contract/${contract.signToken}`;
      await sendContractEmail(primaryContact.email, primaryContact.name || contract.client?.name, contract.title || 'Service Agreement', signUrl);
    }

    return { ...updated, emailSent: !!primaryContact?.email };
  });

  // GET /sign/:signToken — PUBLIC — client views contract to sign
  fastify.get('/sign/:signToken', async (request, reply) => {
    const contract = await fastify.prisma.contract.findUnique({
      where: { signToken: request.params.signToken },
      include: {
        client: { select: { name: true } },
        createdBy: { select: { name: true } }
      }
    });
    if (!contract) return reply.status(404).send({ error: 'Contract not found' });
    return contract;
  });

  // POST /sign/:signToken — PUBLIC — client signs contract
  // Body: { signerName, agreement: true }
  fastify.post('/sign/:signToken', async (request, reply) => {
    const { signerName, agreement } = request.body;
    if (!signerName || !agreement) return reply.status(400).send({ error: 'signerName and agreement:true required' });

    const contract = await fastify.prisma.contract.findUnique({ where: { signToken: request.params.signToken } });
    if (!contract) return reply.status(404).send({ error: 'Contract not found' });
    if (contract.status === 'SIGNED') return reply.status(400).send({ error: 'Contract already signed' });
    if (contract.status === 'VOID') return reply.status(400).send({ error: 'Contract is void' });

    const now = new Date();
    const sigHash = crypto.createHmac('sha256', request.params.signToken)
      .update(signerName + now.getTime().toString())
      .digest('hex');

    return fastify.prisma.contract.update({
      where: { signToken: request.params.signToken },
      data: {
        status: 'SIGNED',
        clientSigHash: sigHash,
        clientSigName: signerName,
        clientSigDate: now,
        signedAt: now
      }
    });
  });

  // GET /:id/pdf — generate simple text representation
  fastify.get('/:id/pdf', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const contract = await fastify.prisma.contract.findUnique({
      where: { id: request.params.id },
      include: { client: { select: { name: true } } }
    });
    if (!contract) return reply.status(404).send({ error: 'Contract not found' });

    // Strip HTML tags for plain text version
    const plainText = contract.content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

    reply.header('Content-Type', 'text/plain');
    reply.header('Content-Disposition', `attachment; filename="${contract.title.replace(/[^a-zA-Z0-9]/g, '_')}.txt"`);
    return plainText;
  });
}
