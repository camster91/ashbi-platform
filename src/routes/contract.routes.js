import crypto from 'crypto';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import PDFDocument from 'pdfkit';
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
}
