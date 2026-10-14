import { createWorkspaceTools } from '../integrations/workspace-tools.js';
import { ToolError } from '../ai/tools/registry.js';
import { currentInvoiceAdmin } from '../services/unbilled-invoice.service.js';

const operations = new Set(['list_unbilled_candidates', 'preview_unbilled_invoice', 'preview_unbilled_release',
  'create_unbilled_invoice_draft', 'release_unbilled_invoice_sources', 'get_action', 'confirm_action', 'reject_action']);
const actions = new Set(['create_unbilled_invoice_draft', 'release_unbilled_invoice_sources']);

/** Session adapter for billing only. API keys retain their independently granted scopes. */
export default async function invoiceBillingRoutes(fastify, options = {}) {
  const service = options.billingTools ?? createWorkspaceTools({ approvalMethod: 'session_confirm' });
  fastify.post('/unbilled/tools/:name', { onRequest: [fastify.adminOnly], schema: { body: { type: 'object' } } }, async (request, reply) => {
    try {
      await currentInvoiceAdmin(request.prisma, request.user);
      const name = request.params.name;
      if (!operations.has(name)) return reply.code(404).send({ error: 'Billing operation not found' });
      if (['get_action', 'confirm_action', 'reject_action'].includes(name)) {
        const actionId = request.body?.actionId;
        if (typeof actionId !== 'string' || actionId.length > 50) return reply.code(400).send({ error: 'Expected actionId' });
        const action = await request.prisma.aiBridgeAction.findFirst({ where: {
          id: actionId, userId: request.user.id, organizationId: request.user.organizationId,
        }, select: { action: true, source: true } });
        if (!action || action.source !== 'ai_bridge' || !actions.has(action.action)) return reply.code(404).send({ error: 'Billing action not found' });
      }
      const data = await service.call({ prisma: request.prisma, user: request.user,
        scopes: ['workspace:read', 'workspace:actions'], requestId: request.id, ip: request.ip, log: request.log }, name, request.body);
      return { data, meta: { requestId: request.id } };
    } catch (error) {
      if (!(error instanceof ToolError)) {
        if (error.statusCode === 403) return reply.code(403).send({ error: 'An active administrator is required.' });
        throw error;
      }
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
  });
}
