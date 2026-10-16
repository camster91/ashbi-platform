import { clientTaskInputSchema, clientTaskScope, clientTaskPreview, executeClientTask } from '../services/client-agent-action.service.js';

export const WORKSPACE_CLIENT_AGENT_ACTIONS = [{
  name: 'create_client_task',
  description: 'Prepare an exact unassigned task proposal in an active canonical client project. The client Task proposals plugin must be explicitly enabled. Creates nothing until a human confirms the immutable preview; no model, messaging, billing or arbitrary tools are invoked.',
  class: 'execute', roles: ['ADMIN', 'TEAM'], requiresConfirmation: true, idempotency: 'required', timeoutMs: 10_000,
  inputSchema: clientTaskInputSchema, resolveScope: clientTaskScope,
  preview: async ({ input, scope }) => clientTaskPreview(input, scope),
  rollback: 'Task and execution receipt commit together or neither does. A committed task can be removed through its normal workflow.',
  execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: executeClientTask },
}];
