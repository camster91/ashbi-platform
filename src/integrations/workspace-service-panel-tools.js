import { servicePanelParamsSchema, servicePanelQuerySchema, readClientServicePanels } from '../services/client-service-panels.service.js';
export const WORKSPACE_SERVICE_PANEL_TOOLS = [{
  name: 'get_client_service_panels', description: 'Read saved, administrator-published OpenSEO report snapshots. No upstream connection or freshness verification. Distinguish Hub storage time from unknown or supplied source time; refresh only reads Hub storage.',
  class: 'read', roles: ['ADMIN', 'TEAM'], timeoutMs: 10000,
  inputSchema: servicePanelParamsSchema.merge(servicePanelQuerySchema),
  resolveScope: async ({ user }) => ({ ids: { organizationId: user.organizationId } }),
  run: ({ prisma, user, input: { clientId, ...query } }) => readClientServicePanels(prisma, user, clientId, query),
}];
