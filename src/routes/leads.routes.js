// Lead management routes (admin)

import { clientDomainFromEmail, normalizeContactEmail } from '../utils/client-identity.js';
import { insensitiveEquals } from '../utils/insensitive-equals.js';

export default async function leadRoutes(fastify) {
  // Public inquiries arrive through /api/client-acquisition/intake. The old
  // anonymous /leads/intake route here was removed: it created leads with no
  // organization, so every submission failed.
  //
  // Every query goes through request.prisma, the tenant-scoped client: leads
  // (UnmatchedEmail), clients and contacts of other organizations are
  // invisible here, and created clients belong to the caller's organization.

  // GET /leads — admin only, list pending leads
  fastify.get('/leads', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const leads = await request.prisma.unmatchedEmail.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' }
    });

    return leads;
  });

  // PATCH /leads/:id/convert — convert lead to client
  //
  // The client's domain comes from the sender's address, except for consumer
  // mailbox providers (gmail.com and the like), which identify no company and
  // are never stored. When a client of this organization already has that
  // domain, the lead is linked to it (the sender is added as a contact unless
  // already one) instead of creating a duplicate client: the response then
  // carries `linkedExistingClient: true`.
  fastify.patch('/leads/:id/convert', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const lead = await request.prisma.unmatchedEmail.findUnique({
      where: { id: request.params.id }
    });

    if (!lead) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    if (lead.status !== 'PENDING') {
      return reply.status(400).send({ error: 'Lead has already been resolved' });
    }

    // Parse company from suggestedClients metadata
    let company = null;
    try {
      const meta = JSON.parse(lead.suggestedClients || '{}');
      company = typeof meta.company === 'string' && meta.company.trim() ? meta.company.trim() : null;
    } catch { /* ignore */ }

    const domain = clientDomainFromEmail(lead.senderEmail);
    const email = normalizeContactEmail(lead.senderEmail);
    const organizationId = request.user.organizationId;

    const result = await request.prisma.$transaction(async (tx) => {
      // Claim the lead first so two concurrent conversions cannot both run.
      const claimed = await tx.unmatchedEmail.updateMany({
        where: { id: lead.id, status: 'PENDING' },
        data: { status: 'RESOLVED', resolvedAt: new Date() }
      });
      if (claimed.count !== 1) return null;

      let client = domain
        ? await tx.client.findFirst({ where: { domain, deletedAt: null } })
        : null;
      const linkedExistingClient = Boolean(client);
      if (!client) {
        // A soft-deleted client still holds its domain (unique per
        // organization): the new client then gets none.
        const deletedHolder = domain
          ? await tx.client.findFirst({ where: { domain, deletedAt: { not: null } }, select: { id: true } })
          : null;
        client = await tx.client.create({
          data: {
            organizationId,
            name: company || lead.senderName || lead.senderEmail,
            domain: deletedHolder ? null : domain,
            status: 'ACTIVE'
          }
        });
      }

      const existingContact = linkedExistingClient
        ? await tx.contact.findFirst({ where: { clientId: client.id, email: insensitiveEquals(email) } })
        : null;
      const contact = existingContact ?? await tx.contact.create({
        data: {
          email,
          name: lead.senderName || lead.senderEmail,
          isPrimary: !linkedExistingClient,
          clientId: client.id
        }
      });

      return { client, contact, linkedExistingClient };
    });

    if (!result) {
      return reply.status(400).send({ error: 'Lead has already been resolved' });
    }
    return result;
  });
}
