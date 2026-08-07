import { redactIntegration, redactIntegrations } from '../utils/redact-integration.js';

const DEFERRED_ACCOUNTING_TYPES = new Set(['QUICKBOOKS', 'XERO']);

function isDeferredAccountingType(type) {
  return DEFERRED_ACCOUNTING_TYPES.has(String(type || '').toUpperCase());
}

function accountingUnavailable(reply) {
  return reply.status(501).send({
    error: 'Accounting integration unavailable',
    code: 'ACCOUNTING_INTEGRATION_UNAVAILABLE',
    message: 'QuickBooks and Xero are not yet supported. No authorization or synchronization was performed.',
  });
}

export default async function integrationRoutes(fastify) {
  // List connected integrations
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const integrations = await request.prisma.integration.findMany({
      where: { type: { notIn: [...DEFERRED_ACCOUNTING_TYPES] } },
      orderBy: { type: 'asc' }
    });
    return { integrations: redactIntegrations(integrations) };
  });

  // Get integration status
  fastify.get('/:type', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { type } = request.params;
    if (isDeferredAccountingType(type)) {
      return accountingUnavailable(reply);
    }
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

    if (isDeferredAccountingType(typeUpper)) {
      return accountingUnavailable(reply);
    }

    if (!DEFERRED_ACCOUNTING_TYPES.has(typeUpper)) {
      return reply.status(400).send({ error: 'Unsupported integration type' });
    }
  });

  // Disconnect integration
  fastify.post('/:type/disconnect', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { type } = request.params;
    const typeUpper = type.toUpperCase();

    if (isDeferredAccountingType(typeUpper)) {
      return accountingUnavailable(reply);
    }

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

    if (isDeferredAccountingType(typeUpper)) {
      return accountingUnavailable(reply);
    }

    const integration = await request.prisma.integration.findFirst({
      where: { type: typeUpper }
    });

    if (!integration || integration.status !== 'CONNECTED') {
      return reply.status(400).send({ error: `${typeUpper} is not connected` });
    }

    return reply.status(501).send({ error: 'Integration synchronization is not implemented' });
  });
}
