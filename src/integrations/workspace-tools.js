import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { BUILTIN_TOOLS, createToolRegistry, ToolError } from '../ai/tools/registry.js';
import { createToolExecutor, redactSecrets } from '../ai/tools/executor.js';

const pageSchema = z.object({
  limit: z.number().int().min(1).max(50).default(25),
  after: z.string().min(1).max(50).optional(),
}).strict();

function listTool(name, description, model, select, where) {
  return {
    name, description, class: 'read', roles: ['ADMIN', 'TEAM'], inputSchema: pageSchema,
    resolveScope: async ({ user }) => ({ ids: { organizationId: user.organizationId } }),
    timeoutMs: 5000,
    run: async ({ prisma, user, input }) => {
      const rows = await prisma[model].findMany({
        where: { ...where(user), ...(input.after ? { id: { gt: input.after } } : {}) },
        select, orderBy: { id: 'asc' }, take: input.limit + 1,
      });
      const items = rows.slice(0, input.limit);
      return { items, nextCursor: rows.length > input.limit ? items.at(-1).id : null };
    },
  };
}

export const workspaceRegistry = createToolRegistry([
  listTool('list_projects', 'Page through workspace projects. Pass nextCursor as after for the next page.',
    'project', { id: true, name: true, status: true, health: true }, user => ({ organizationId: user.organizationId })),
  listTool('list_clients', 'Page through workspace clients. Returns business identity, never credentials.',
    'client', { id: true, name: true, status: true, domain: true }, user => ({ organizationId: user.organizationId })),
  listTool('list_tasks', 'Page through workspace tasks, including unassigned work.',
    'task', { id: true, title: true, projectId: true, status: true, priority: true, dueDate: true },
    user => ({ project: { organizationId: user.organizationId } })),
  ...BUILTIN_TOOLS.filter(tool => ['list_my_tasks', 'get_project_summary', 'create_task', 'create_calendar_event'].includes(tool.name)),
]);

const scopeFor = tool => tool.class === 'read' ? 'workspace:read' : 'workspace:actions';
const controlSchema = z.object({ actionId: z.string().min(1).max(50) }).strict();

function receipt(action) {
  return redactSecrets(Object.fromEntries([
    'id', 'action', 'status', 'preview', 'result', 'expiresAt', 'confirmedAt',
    'executedAt', 'errorCode', 'outcome', 'correlationId',
  ].map(key => [key, action[key] ?? null])));
}

/** Deterministic operations: role, scope, tenant and approval checks still apply.
 * Model budgets and inference switches do not govern database operations. */
export function createWorkspaceTools(options = {}) {
  const registry = options.registry ?? workspaceRegistry;
  const executor = options.executor ?? createToolExecutor({ registry, governance: {
    assertAllowed: async () => {},
  } });
  function allowed(ctx, scope) {
    return ['ADMIN', 'TEAM'].includes(ctx.user?.role) && Boolean(ctx.user?.organizationId)
      && ctx.scopes?.includes(scope);
  }
  function list(ctx) {
    const tools = registry.list().filter(tool => tool.roles.includes(ctx.user?.role) && allowed(ctx, scopeFor(tool)))
      .map(tool => ({
        name: tool.name, description: tool.class === 'read' ? tool.description : `${tool.description} Prepares a preview only; requires confirm_action after human review.`,
        inputSchema: zodToJsonSchema(tool.class === 'read' ? tool.inputSchema : z.object({
          input: tool.inputSchema, idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
        }).strict(), { $refStrategy: 'none' }),
        annotations: { readOnlyHint: tool.class === 'read', destructiveHint: false, idempotentHint: true, openWorldHint: false },
      }));
    if (allowed(ctx, 'workspace:actions')) {
      for (const name of ['get_action', 'confirm_action', 'reject_action']) tools.push({
        name, description: name === 'confirm_action'
          ? 'Execute an action only after the human has reviewed its preview and explicitly authorized it. Never infer approval.'
          : name === 'get_action' ? 'Read your action preview, status and execution receipt. Use after a lost response before retrying.' : 'Reject a pending action without executing it.',
        inputSchema: zodToJsonSchema(controlSchema, { $refStrategy: 'none' }),
        annotations: { readOnlyHint: name === 'get_action', destructiveHint: false, idempotentHint: name !== 'reject_action', openWorldHint: false },
      });
    }
    return tools;
  }
  async function call(ctx, name, args = {}) {
    if (!list(ctx).some(tool => tool.name === name)) throw new ToolError('TOOL_UNAVAILABLE', 'Tool unavailable for this key', { statusCode: 403 });
    if (['get_action', 'confirm_action', 'reject_action'].includes(name)) {
      const parsed = controlSchema.safeParse(args);
      if (!parsed.success) throw new ToolError('INVALID_INPUT', 'Expected actionId');
      const action = await ctx.prisma.aiBridgeAction.findFirst({ where: {
        id: parsed.data.actionId, userId: ctx.user.id, organizationId: ctx.user.organizationId,
      } });
      if (!action || !registry.get(action.action) || action.source !== 'ai_bridge') {
        throw new ToolError('NOT_FOUND', 'Workspace action not found', { statusCode: 404 });
      }
      if (name === 'get_action') return { kind: 'receipt', action: receipt(action) };
      // ownerOnly prevents a key from approving another user's proposal.
      const result = name === 'confirm_action'
        ? await executor.approve(ctx, parsed.data.actionId, { method: 'api_key_confirm', ownerOnly: true })
        : await executor.reject(ctx, parsed.data.actionId, { reason: 'not_needed', ownerOnly: true, method: 'api_key_confirm' });
      return { kind: 'receipt', action: receipt(result.action), idempotent: result.idempotent };
    }
    const tool = registry.get(name);
    let input = args;
    let idempotencyKey;
    if (tool.class !== 'read') {
      const parsed = z.object({ input: z.unknown(), idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/) }).strict().safeParse(args);
      if (!parsed.success) throw new ToolError('INVALID_INPUT', 'Expected input and an idempotencyKey of 8-128 characters');
      ({ input, idempotencyKey } = parsed.data);
    }
    const result = await executor.invoke(ctx, { tool: name, input, idempotencyKey, source: 'ai_bridge' });
    return result.action ? { ...result, action: receipt(result.action) } : result;
  }
  return { list, call };
}
