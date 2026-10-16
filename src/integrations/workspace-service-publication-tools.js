import { servicePublicationInputSchema, previewServicePublication, executeServicePublication } from '../services/client-service-publication.service.js';
export const WORKSPACE_SERVICE_PUBLICATION_TOOLS = [{
  name: 'publish_client_service_report_snapshot',
  description: 'Prepare an administrator-supplied saved report snapshot for an existing canonical client mapping. Explicit confirmation is required. Complete/EMPTY snapshots permanently remove omitted saved reports; UNAVAILABLE preserves last-good reports. No provider request, verified origin or message delivery.',
  class: 'execute', roles: ['ADMIN'], requiresConfirmation: true, idempotency: 'required', irreversible: true,
  approval: { approverRoles: ['ADMIN'] }, timeoutMs: 15000,
  inputSchema: servicePublicationInputSchema,
  resolveScope: async ({ prisma, user, input }) => ({ ids: { organizationId: user.organizationId, clientId: input.clientId, mappingId: input.mappingId }, records: { preview: await previewServicePublication(prisma, user, input) } }),
  preview: async ({ scope }) => scope.records.preview,
  rollback: 'Publication, audit and execution receipt commit together or neither does. Complete snapshot deletion is irreversible; old saved report content is not retained by this operation.',
  execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: executeServicePublication },
}];
