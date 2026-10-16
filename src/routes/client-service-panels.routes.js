import { serviceRefreshSchema, refreshClientServiceReports, listClientServiceCredentials } from '../services/client-service-refresh.service.js';
import { requireStaff } from '../middleware/require-staff.js';
import { validateBody, validateParams, validateQuery } from '../validators/schemas.js';
import { ToolError } from '../ai/tools/registry.js';
import { z } from 'zod';
import { servicePanelParamsSchema, serviceMappingParamsSchema, servicePanelQuerySchema, serviceMappingCreateSchema,
  serviceMappingUpdateSchema, serviceSnapshotSchema, readClientServicePanels, createClientServiceMapping,
  updateClientServiceMapping, publishClientServiceSnapshot } from '../services/client-service-panels.service.js';

export default async function clientServicePanelRoutes(fastify) {
  const route = (method, path, params, body, query, run) => fastify.route({ method, url: path,
    onRequest: [fastify.authenticate, requireStaff], preHandler: [validateParams(params), validateQuery(query), ...(body ? [validateBody(body)] : [])],
    handler: async (request, reply) => { try { return await run(request); } catch (error) {
      const safe = error instanceof ToolError && ['INVALID_INPUT', 'ROLE_DENIED', 'RECORD_NOT_FOUND', 'SERVICE_PANEL_CONFLICT', 'SERVICE_PANEL_AUDIT_UNAVAILABLE', 'AUTH_REQUIRED'].includes(error.code);
      return reply.code(safe ? error.statusCode : 503).send({ error: safe ? error.message : 'Saved reports unavailable.', code: safe ? error.code : 'SERVICE_PANEL_UNAVAILABLE' });
    } } });
  const empty = z.object({}).strict();
  route('GET', '/:clientId/service-panel-credentials', servicePanelParamsSchema, null, empty, r => listClientServiceCredentials(r.prisma, r.user, r.params.clientId));
  route('POST', '/:clientId/service-panels/:mappingId/refresh', serviceMappingParamsSchema, serviceRefreshSchema, empty, r => refreshClientServiceReports(r.prisma, r.user, r.params.clientId, r.params.mappingId, r.body));
  route('GET', '/:clientId/service-panels', servicePanelParamsSchema, null, servicePanelQuerySchema, r => readClientServicePanels(r.prisma, r.user, r.params.clientId, r.query));
  route('POST', '/:clientId/service-panels', servicePanelParamsSchema, serviceMappingCreateSchema, empty, r => createClientServiceMapping(r.prisma, r.user, r.params.clientId, r.body));
  route('PATCH', '/:clientId/service-panels/:mappingId', serviceMappingParamsSchema, serviceMappingUpdateSchema, empty, r => updateClientServiceMapping(r.prisma, r.user, r.params.clientId, r.params.mappingId, r.body));
  route('POST', '/:clientId/service-panels/:mappingId/snapshots', serviceMappingParamsSchema, serviceSnapshotSchema, empty, r => publishClientServiceSnapshot(r.prisma, r.user, r.params.clientId, r.params.mappingId, r.body));
}
