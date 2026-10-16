import { z } from 'zod';
import { ToolError, recordNotFound } from '../ai/tools/registry.js';
import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';
import { buildClientAssistantContext } from './client-assistant-context.service.js';
import { buildWorkQueue, countByView } from './work-queue.service.js';

export const clientBriefSchema = z.object({
  clientId: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(50).default(8),
}).strict();

// Curated, code-owned plugins only. These declarations grant no permissions;
// each entry point must still authorize the actor and every referenced record.
export const ACCOUNT_MANAGER_PLUGINS = Object.freeze([
  Object.freeze({
    id: 'client-work', version: '1', name: 'Client work', mode: 'read-only',
    requiredScope: 'workspace:read', roles: Object.freeze(['ADMIN', 'TEAM']), effects: 'none',
    tools: Object.freeze(['get_client_account_manager_brief']),
    capabilities: Object.freeze(['project-context', 'work-queue', 'source-links']),
  }),
  Object.freeze({
    id: 'client-task-actions', version: '1', name: 'Task proposals', mode: 'approval-required',
    requiredScope: 'workspace:actions', roles: Object.freeze(['ADMIN', 'TEAM']), effects: 'internal-task-create',
    tools: Object.freeze(['create_client_task']), capabilities: Object.freeze(['task-preview', 'human-confirmation']),
  }),
]);

/** Shared deterministic projection for the app and workspace MCP. No inference
 * or write capability is loaded by opening a brief. */
export async function readClientAccountManagerBrief(prisma, user, input) {
  if (!user?.id || !user.organizationId || !['ADMIN', 'TEAM'].includes(user.role)) {
    throw new ToolError('ROLE_DENIED', 'Staff access required', { statusCode: 403 });
  }
  const parsed = clientBriefSchema.safeParse(input);
  if (!parsed.success) throw new ToolError('INVALID_INPUT', 'Expected a clientId and limit from 1 to 50');
  const { clientId, limit } = parsed.data;
  const scoped = createScopedPrisma(prisma, user.organizationId);
  // Recheck stored authority rather than trusting a queued/cached actor role.
  const actor = await scoped.user.findFirst({
    where: { id: user.id, organizationId: user.organizationId, isActive: true },
    select: { id: true, organizationId: true, isActive: true, role: true },
  });
  if (!actor || actor.id !== user.id || actor.organizationId !== user.organizationId
    || !actor.isActive || !['ADMIN', 'TEAM'].includes(actor.role)) {
    throw new ToolError('ROLE_DENIED', 'Active staff access required', { statusCode: 403 });
  }
  const context = await buildClientAssistantContext(scoped, { organizationId: actor.organizationId, clientId });
  if (!context) throw recordNotFound('Client not found');
  const queue = await buildWorkQueue(scoped, {
    user: actor, filters: { clientId, owner: actor.role === 'ADMIN' ? 'everyone' : 'me' },
  });
  // Keep a corrupt/mismapped source row out of both the brief and its counts.
  const visible = queue.rows.filter(row => row.client?.id === clientId);
  const scopeMismatch = visible.length !== queue.rows.length;
  return {
    ...queue, rows: visible.slice(0, limit), counts: countByView(visible), total: visible.length,
    partial: queue.partial || scopeMismatch, scopeMismatch,
    hasMore: visible.length > limit, limit, context, mode: 'STAFF_READ_ONLY',
    owner: actor.role === 'ADMIN' ? 'everyone' : 'me',
    plugins: ACCOUNT_MANAGER_PLUGINS,
  };
}
