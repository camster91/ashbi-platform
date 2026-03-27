// Proposal AI Agent — generates full proposals from client intake + project type

import aiClient from '../ai/client.js';
import { prisma } from '../index.js';

export default async function proposalsAiRoutes(fastify) {

  // POST /proposals-ai/generate — generate full proposal from intake
  fastify.post('/generate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const {
      clientId,
      projectType,
      clientName,
      clientIndustry,
      scope,
      budget,
      timeline,
      notes,
    } = request.body || {};

    if (!projectType && !scope) {
      return reply.status(400).send({ error: 'projectType or scope is required' });
    }

    // Fetch client info if clientId provided
    let clientInfo = { name: clientName || 'Prospective Client', industry: clientIndustry || 'CPG/DTC' };
    if (clientId) {
      const client = await prisma.client.findUnique({ where: { id: clientId } });
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }
      clientInfo = { name: client.name, industry: 'CPG/DTC' };
    }

    const system = `You are a proposal writer for Ashbi Design, a Toronto-based CPG/DTC creative agency. You create professional, detailed proposals with clear deliverables and pricing. Proposals should feel confident and premium — not salesy. Ashbi specializes in branding, packaging design, and Shopify/WooCommerce web development.`;

    const prompt = `Generate a full proposal for Ashbi Design.

Client: ${clientInfo.name}
Industry: ${clientInfo.industry}
Project type: ${projectType || 'custom'}
Scope: ${scope || projectType || 'full branding + web'}
${budget ? `Budget range: ${budget}` : ''}
${timeline ? `Timeline: ${timeline}` : ''}
${notes ? `Additional context: ${notes}` : ''}

Ashbi Design pricing guidelines:
- Brand identity: $3,000-$8,000
- Packaging design: $2,000-$5,000 per SKU
- Shopify/WooCommerce site: $5,000-$15,000
- Full branding + web bundle: $8,000-$20,000

Return JSON:
{
  "title": "Proposal title",
  "summary": "1-2 paragraph executive summary",
  "lineItems": [
    {
      "description": "Deliverable name with detail",
      "quantity": 1,
      "unitPrice": 5000
    }
  ],
  "timeline": "Estimated timeline description",
  "notes": "Terms, payment schedule, what's included/excluded",
  "validDays": 30
}`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.5 });

      // If clientId is provided, create the proposal in DB
      if (clientId) {
        const computedLineItems = (result.lineItems || []).map(item => ({
          description: item.description,
          quantity: item.quantity ?? 1,
          unitPrice: item.unitPrice,
          total: (item.quantity ?? 1) * item.unitPrice
        }));

        const subtotal = computedLineItems.reduce((sum, item) => sum + item.total, 0);

        const proposal = await prisma.$transaction(async (tx) => {
          return tx.proposal.create({
            data: {
              title: result.title || `Proposal for ${clientInfo.name}`,
              clientId,
              createdById: request.user.id,
              notes: [result.summary, result.notes, `Timeline: ${result.timeline}`].filter(Boolean).join('\n\n'),
              validUntil: result.validDays ? new Date(Date.now() + result.validDays * 86400000) : null,
              subtotal,
              discount: 0,
              total: subtotal,
              lineItems: {
                create: computedLineItems
              }
            },
            include: {
              client: { select: { id: true, name: true } },
              lineItems: true,
              createdBy: { select: { id: true, name: true } }
            }
          });
        });

        return { proposal, generated: true };
      }

      // No clientId — just return the AI-generated content
      return { ...result, generated: true };
    } catch (err) {
      fastify.log.error('Proposals AI generate error:', err);
      return reply.status(500).send({ error: 'Failed to generate proposal', message: err.message });
    }
  });
}
