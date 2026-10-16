import { servicePanelParamsSchema, servicePanelQuerySchema, readClientServicePanels } from '../services/client-service-panels.service.js';
export const WORKSPACE_SERVICE_PANEL_TOOLS = [{
  name: 'get_client_service_panels', description: 'Read saved OpenSEO reports from staff publication or an explicit admin pull. This read never contacts OpenSEO. Distinguish row provenance, provider edit time, Hub storage time and unknown metric observation time.',
  class: 'read', roles: ['ADMIN', 'TEAM'], timeoutMs: 10000,
  inputSchema: servicePanelParamsSchema.merge(servicePanelQuerySchema),
  resolveScope: async ({ user }) => ({ ids: { organizationId: user.organizationId } }),
  run: ({ prisma, user, input: { clientId, ...query } }) => readClientServicePanels(prisma, user, clientId, query),
}];
