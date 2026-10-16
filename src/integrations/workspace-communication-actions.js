import { communicationTaskInputSchema, communicationTaskScope, communicationTaskPreview, executeCommunicationTask } from '../services/client-communication-task.service.js';

export const WORKSPACE_COMMUNICATION_ACTIONS = [{
  name: 'create_task_from_client_message',
  description: 'Prepare a source-linked task from a stored client inbox message. Requires current staff access, an active canonical client project, and explicit human confirmation of the immutable preview. Project email history remains read-only.',
  class: 'execute', roles: ['ADMIN', 'TEAM'], requiresConfirmation: true, idempotency: 'required', timeoutMs: 10_000,
  inputSchema: communicationTaskInputSchema, resolveScope: communicationTaskScope,
  preview: async ({ input, scope }) => communicationTaskPreview(input, scope),
  rollback: 'A failed transaction creates no task. Task and execution receipt commit atomically. Remove a committed task through the normal task workflow if necessary.',
  execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: executeCommunicationTask },
}];
