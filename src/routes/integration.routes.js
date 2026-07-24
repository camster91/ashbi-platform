import { redactIntegration, redactIntegrations } from '../utils/redact-integration.js';

export default async function integrationRoutes(fastify) {
  // List connected integrations
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const integrations = await request.prisma.integration.findMany({
      orderBy: { type: 'asc' }
    });
    return { integrations: redactIntegrations(integrations) };
  });

  // Get integration status
  fastify.get('/:type', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { type } = request.params;
    const integration = await request.prisma.integration.findFirst({
      where: { type: type.toUpperCase() }
    });
    if (!integration) {
      return reply.status(404).send({ error: 'Integration not found' });
    }
    return redactIntegration(integration);
  });

  // Connect integration (OAuth redirect URL generation)
  fastify.post('/:type/connect', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { type } = request.params;
    const typeUpper = type.toUpperCase();

    if (!['QUICKBOOKS', 'XERO'].includes(typeUpper)) {
      return reply.status(400).send({ error: 'Unsupported integration type' });
    }

    // In production, this would generate OAuth redirect URLs
    // For now, we create a placeholder record
    const integration = await request.prisma.integration.upsert({
      where: { id: `${typeUpper}_placeholder` },
      update: { status: 'CONNECTED', lastSyncAt: new Date(), organizationId: request.organizationId },
      create: {
        id: `${typeUpper}_placeholder`,
        type: typeUpper,
        status: 'CONNECTED',
        lastSyncAt: new Date(),
        organizationId: request.organizationId,
      }
    });

    return { integration: redactIntegration(integration), message: `${typeUpper} connected (demo mode)` };
  });

  // Disconnect integration
  fastify.post('/:type/disconnect', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { type } = request.params;
    const typeUpper = type.toUpperCase();

    const integration = await request.prisma.integration.findFirst({
      where: { type: typeUpper }
    });

    if (!integration) {
      return reply.status(404).send({ error: 'Integration not found' });
    }

    await request.prisma.integration.update({
      where: { id: integration.id },
      data: { status: 'DISCONNECTED', accessToken: null, refreshToken: null, orgId: null }
    });

    return { success: true, message: `${typeUpper} disconnected` };
  });

  // Sync integration
  fastify.post('/:type/sync', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { type } = request.params;
    const typeUpper = type.toUpperCase();

    const integration = await request.prisma.integration.findFirst({
      where: { type: typeUpper }
    });

    if (!integration || integration.status !== 'CONNECTED') {
      return reply.status(400).send({ error: `${typeUpper} is not connected` });
    }

    // Update last sync time
    await request.prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncAt: new Date() }
    });

    return { success: true, message: `${typeUpper} sync initiated (demo mode)` };
  });
}