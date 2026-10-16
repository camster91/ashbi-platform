import { MCP_OAUTH_ACTION_SCOPES } from '../auth/mcp-oauth-scopes.js';
import { assertMcpActionAuthority } from '../auth/mcp-action-authority.js';
import { WORKSPACE_SERVICE_PUBLICATION_TOOLS } from './workspace-service-publication-tools.js';
import { servicePublicationInputSchema, authorizeServicePublicationReceipt } from '../services/client-service-publication.service.js';
import { isWorkspaceBoundAction } from './workspace-bound-actions.js';
import { WORKSPACE_CLIENT_AGENT_ACTIONS } from './workspace-client-agent-actions.js';
import { clientTaskInputSchema, clientTaskScope, authorizeClientTaskReceipt } from '../services/client-agent-action.service.js';
import { WORKSPACE_SERVICE_PANEL_TOOLS } from './workspace-service-panel-tools.js';
import { WORKSPACE_NOTE_TOOLS } from './workspace-note-tools.js';
import { visibleNoteIds } from '../services/note-access.service.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { BUILTIN_TOOLS, createToolRegistry, ToolError } from '../ai/tools/registry.js';
import { createToolExecutor, redactSecrets } from '../ai/tools/executor.js';
import { portfolioWhere } from '../shared/portfolio.js';
import { portfolioFilterSchema } from '../validators/schemas.js';
import { taskViewFiltersSchema } from '../validators/schemas.js';
import { taskViewWhere } from '../shared/task-view-filters.js';
import { financialPortfolioWhere, invoicePortfolioWhere } from '../shared/financial-portfolio.js';
import { validateTaskFieldFilters } from '../services/task-field-filters.service.js';
import { readTeamWorkload } from '../services/team-workload.service.js';
import { WORKSPACE_TASK_ACTIONS } from './workspace-task-actions.js';
import { WORKSPACE_BILLING_TOOLS } from './workspace-billing-tools.js';
import { WORKSPACE_RECORD_TOOLS, recordToolCall } from './workspace-record-tools.js';
import { RESOURCE_LINK_TOOLS, resourceLinkToolCall } from './resource-link-tools.js';
import { currentResourceLinkStaff } from '../services/resource-links.service.js';
import { currentRecordStaff } from '../services/workspace-records.service.js';
import { currentInvoiceAdmin } from '../services/unbilled-invoice.service.js';
import { taskRelationLabels } from '../services/task-relation-labels.service.js';
import { taskStageKeySchema } from '../validators/schemas.js';
import { projectBoardFilterSchema } from '../validators/schemas.js';
import { listProjectBoards } from '../services/project-boards.service.js';
import { activeTaskBoard, taskBoardWhere } from '../services/task-board-scope.js';
import { listWorkspacePages, readWorkspacePage } from '../services/workspace-pages.service.js';
import { WORKSPACE_WIKI_ACTIONS } from './workspace-wiki-actions.js';
import { readWorkspacePageAccess } from '../services/workspace-page-access.service.js';
import { wikiToolCall } from './workspace-wiki-tool-errors.js';
import { WORKSPACE_ACCOUNT_MANAGER_TOOLS } from './workspace-account-manager-tools.js';
import { WORKSPACE_CHAT_TOOLS } from './workspace-chat-tools.js';
import { WORKSPACE_CLIENT_COMMUNICATIONS_TOOLS } from './workspace-client-communications-tools.js';
import { WORKSPACE_COMMUNICATION_ACTIONS } from './workspace-communication-actions.js';
import { communicationTaskInputSchema, communicationTaskScope } from '../services/client-communication-task.service.js';

const pageSchema = z.object({
  limit: z.number().int().min(1).max(50).default(25),
  after: z.string().min(1).max(50).optional(),
}).strict();

function listTool(name, description, model, select, where, inputSchema = pageSchema, preflight = async () => {}, decorate = async rows => rows) {
  return {
    name, description, class: 'read', roles: ['ADMIN', 'TEAM'], inputSchema,
    resolveScope: async ({ user }) => ({ ids: { organizationId: user.organizationId } }),
    timeoutMs: 5000,
    run: async ({ prisma, user, input }) => {
      await preflight({ prisma, user, input });
      const criteria = await where(user, input, prisma);
      const rows = await prisma[model].findMany({
        where: input.after ? { AND: [criteria, { id: { gt: input.after } }] } : criteria,
        select, orderBy: { id: 'asc' }, take: input.limit + 1,
      });
      const items = await decorate(rows.slice(0, input.limit), { prisma, user, input });
      return { items, nextCursor: rows.length > input.limit ? items.at(-1).id : null };
    },
  };
}

export const workspaceRegistry = createToolRegistry([
  ...WORKSPACE_SERVICE_PUBLICATION_TOOLS,
  ...WORKSPACE_SERVICE_PANEL_TOOLS,
  ...WORKSPACE_ACCOUNT_MANAGER_TOOLS,
  ...WORKSPACE_CHAT_TOOLS,
  ...WORKSPACE_CLIENT_COMMUNICATIONS_TOOLS,
  ...WORKSPACE_COMMUNICATION_ACTIONS,
  ...WORKSPACE_CLIENT_AGENT_ACTIONS,
  {
    name: 'get_workspace_page_access', description: 'Read current page audience, staff grants and observed access revision. Only the page owner or organization administrator may inspect this roster; parent restrictions still apply.', class: 'read', roles: ['ADMIN', 'TEAM'], timeoutMs: 5000,
    inputSchema: z.object({ pageId: z.string().min(1).max(80) }).strict(), resolveScope: async ({ user }) => ({ ids: { organizationId: user.organizationId } }),
    run: ({ prisma, user, input }) => wikiToolCall(() => readWorkspacePageAccess(prisma, input.pageId, user)),
  },
  {
    name: 'list_workspace_pages', description: 'Read shared team knowledge metadata, independent of clients and projects. Search title/content and page with nextCursor; archived pages are optional.', class: 'read', roles: ['ADMIN', 'TEAM'], timeoutMs: 5000,
    inputSchema: pageSchema.extend({ search: z.string().max(200).default(''), includeArchived: z.boolean().default(false), parentId: z.string().min(1).max(80).optional() }),
    resolveScope: async ({ user }) => ({ ids: { organizationId: user.organizationId } }),
    run: ({ prisma, user, input }) => wikiToolCall(() => listWorkspacePages(prisma, input, user)),
  },
  {
    name: 'get_workspace_page', description: 'Read one shared team knowledge page and its observed revision. Archived content requires includeArchived=true; no client portal access is granted.', class: 'read', roles: ['ADMIN', 'TEAM'], timeoutMs: 5000,
    inputSchema: z.object({ pageId: z.string().min(1).max(80), includeArchived: z.boolean().default(false) }).strict(),
    resolveScope: async ({ user }) => ({ ids: { organizationId: user.organizationId } }),
    run: ({ prisma, user, input }) => wikiToolCall(() => readWorkspacePage(prisma, input.pageId, user, input.includeArchived)),
  },
  ...WORKSPACE_WIKI_ACTIONS,
  ...WORKSPACE_NOTE_TOOLS,
  {
    name: 'list_project_boards', description: 'Page through a canonical project’s default and additional boards. Archived boards are omitted unless requested; fields and billing remain shared with the project.', class: 'read', roles: ['ADMIN', 'TEAM'],
    inputSchema: pageSchema.extend({ projectId: z.string().min(1).max(50), includeArchived: z.boolean().default(false) }),
    resolveScope: async ({ user }) => ({ ids: { organizationId: user.organizationId } }), timeoutMs: 5000,
    run: ({ prisma, user, input }) => listProjectBoards(prisma, input.projectId, input, user),
  },
  ...WORKSPACE_TASK_ACTIONS,
  ...WORKSPACE_BILLING_TOOLS,
  ...WORKSPACE_RECORD_TOOLS,
  ...RESOURCE_LINK_TOOLS,
  {
    name: 'get_team_workload', description: 'Read active staff owned-task and contributor counts, and logged hours over the last seven days compared with weekly capacity. Counts can overlap; this does not forecast future availability.',
    class: 'read', roles: ['ADMIN', 'TEAM'], inputSchema: z.object({}).strict(),
    resolveScope: async ({ user }) => ({ ids: { organizationId: user.organizationId } }), timeoutMs: 5000,
    run: async ({ prisma, user }) => readTeamWorkload(prisma, user),
  },
  listTool('list_invoices', 'Page through internal invoice identities and monetary values, preserving each currency. Optionally filter by portfolio.',
    'invoice', { id: true, invoiceNumber: true, status: true, total: true, currency: true, clientId: true, projectId: true, issueDate: true, dueDate: true },
    async (user, input, prisma) => ({ organizationId: user.organizationId, ...await invoicePortfolioWhere(prisma, input.portfolio, user.organizationId) }),
    pageSchema.extend({ portfolio: portfolioFilterSchema })),
  listTool('list_expenses', 'Page through expenses with their original currency and project/client identities. Optionally filter by portfolio; receipt URLs are omitted.',
    'expense', { id: true, description: true, amount: true, currency: true, category: true, date: true, clientId: true, projectId: true, billable: true, invoiced: true },
    (user, input) => ({ organizationId: user.organizationId, ...financialPortfolioWhere(input.portfolio) }),
    pageSchema.extend({ portfolio: portfolioFilterSchema })),
  listTool('list_notes', 'Page through internal project documents and notes. Optionally filter by portfolio.',
    'note', { id: true, title: true, content: true, type: true, projectId: true, revision: true, updatedAt: true },
    async (user, input, prisma) => ({ id: { in: await visibleNoteIds(prisma, user, { project: { organizationId: user.organizationId, ...portfolioWhere(input.portfolio) } }) } }),
    pageSchema.extend({ portfolio: portfolioFilterSchema })),
  listTool('list_time_entries', 'Page through canonical time entries. Team members see their own entries; admins see the workspace. Optionally filter by portfolio.',
    'timeEntry', { id: true, projectId: true, taskId: true, userId: true, date: true, duration: true, billable: true, invoiced: true, reviewStatus: true },
    (user, input) => ({ project: { organizationId: user.organizationId, ...portfolioWhere(input.portfolio) }, ...(user.role === 'ADMIN' ? {} : { userId: user.id }) }),
    pageSchema.extend({ portfolio: portfolioFilterSchema })),
  listTool('list_board_templates', 'Page through shared workflow templates. Definitions only; archived templates are omitted unless includeArchived is true.',
    'projectTemplate', { id: true, name: true, description: true, kind: true, boardConfig: true },
    (user, input) => ({ organizationId: user.organizationId, kind: { in: input.includeArchived ? ['BOARD', 'BOARD_ARCHIVED'] : ['BOARD'] } }),
    pageSchema.extend({ includeArchived: z.boolean().default(false) })),
  listTool('list_projects', 'Page through workspace projects. Optionally filter by portfolio (ASHBI_DESIGN, FREELANCE, UNCLASSIFIED); omit for all work. Pass nextCursor as after for the next page.',
    'project', { id: true, name: true, status: true, health: true, portfolio: true, taskStages: true, boardRevision: true, taskViews: true, taskViewsRevision: true, taskFields: true, taskFieldsRevision: true },
    (user, input) => ({ organizationId: user.organizationId, ...portfolioWhere(input.portfolio) }),
    pageSchema.extend({ portfolio: portfolioFilterSchema })),
  listTool('list_clients', 'Page through workspace clients. Returns business identity, never credentials.',
    'client', { id: true, name: true, status: true, domain: true }, user => ({ organizationId: user.organizationId })),
  listTool('list_tasks', 'Page through workspace tasks, including unassigned work. Filter by projectId, status, priority, stageKey or search to reproduce a saved project view. With projectId, relationField resolves authorized names for one active relation field.',
    'task', { id: true, title: true, projectId: true, boardId: true, boardMembershipRevision: true, status: true, stageKey: true, priority: true, dueDate: true, fieldValues: true, fieldValuesRevision: true, assigneeId: true, collaboratorsRevision: true, collaborators: { select: { userId: true, user: { select: { name: true, isActive: true } } } },
      recurrenceRule: true, recurrenceNextDate: true, recurrenceRevision: true, recurrenceSourceId: true, recurrenceScheduledDate: true, recurrenceCompletionSourceId: true, recurrenceFirstCompletedAt: true, recurrenceCompletionProcessedAt: true },
    (user, input) => ({ project: { organizationId: user.organizationId, ...portfolioWhere(input.portfolio) }, ...(input.boardId ? taskBoardWhere(input.boardId) : {}), ...taskViewWhere(input) }),
    pageSchema.extend({ portfolio: portfolioFilterSchema, projectId: z.string().min(1).max(50).optional(), boardId: projectBoardFilterSchema, relationField: taskStageKeySchema.optional(), ...taskViewFiltersSchema.shape }).refine(input => (!input.relationField && !input.boardId) || Boolean(input.projectId), { message: 'Choose a project for board or related-record reads' }),
    async ({ prisma, user, input }) => { await validateTaskFieldFilters(prisma, input.projectId, input.fieldFilters, user.organizationId); if (input.boardId) await activeTaskBoard(prisma, input.projectId, input.boardId, user.organizationId); },
    (rows, { prisma, user, input }) => taskRelationLabels(prisma, input.projectId, input.relationField, rows, user)),
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
  function actionAllowed(ctx, tool) {
    return ctx.oauth ? ctx.user?.role === 'ADMIN' && Boolean(MCP_OAUTH_ACTION_SCOPES[tool.name]) && ctx.scopes?.includes(MCP_OAUTH_ACTION_SCOPES[tool.name]) : allowed(ctx, 'workspace:actions');
  }
  function list(ctx) {
    const tools = registry.list().filter(tool => tool.roles.includes(ctx.user?.role) && (tool.class === 'read' ? allowed(ctx, scopeFor(tool)) : actionAllowed(ctx, tool)))
      .map(tool => ({
        name: tool.name, description: tool.class === 'read' ? tool.description : `${tool.description} Prepares a preview only; requires an explicit confirm_action API call after reviewing the preview. This does not prove a fresh human click.`,
        inputSchema: zodToJsonSchema(tool.class === 'read' ? tool.inputSchema : z.object({
          input: tool.inputSchema, idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
        }).strict(), { $refStrategy: 'none' }),
        annotations: { readOnlyHint: tool.class === 'read', destructiveHint: tool.irreversible, idempotentHint: true, openWorldHint: false },
      }));
    if (ctx.oauth ? Object.keys(MCP_OAUTH_ACTION_SCOPES).some(name => registry.get(name) && actionAllowed(ctx, registry.get(name))) : allowed(ctx, 'workspace:actions')) {
      for (const name of ['get_action', 'confirm_action', 'reject_action']) tools.push({
        name, description: name === 'confirm_action'
          ? 'Execute a reviewed preview by explicit authenticated API confirmation. This does not prove a fresh human click. Never infer approval.'
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
      await assertMcpActionAuthority(ctx.prisma, ctx, action.action, action);
      if (!registry.get(action.action).roles.includes(ctx.user.role)) throw new ToolError('ROLE_DENIED', 'Your role cannot access this action', { statusCode: 403 });
      if (WORKSPACE_BILLING_TOOLS.some(tool => tool.name === action.action)) await billingAdmin(ctx);
      if (RESOURCE_LINK_TOOLS.some(tool => tool.name === action.action)) await resourceLinkToolCall(() => currentResourceLinkStaff(ctx.prisma, ctx.user));
      if (WORKSPACE_RECORD_TOOLS.some(tool => tool.name === action.action)) await recordToolCall(() => currentRecordStaff(ctx.prisma, ctx.user));
      if (WORKSPACE_COMMUNICATION_ACTIONS.some(tool => tool.name === action.action)) await communicationTaskScope({ prisma: ctx.prisma, user: ctx.user, input: action.input });
      if (WORKSPACE_CLIENT_AGENT_ACTIONS.some(tool => tool.name === action.action)) await authorizeClientTaskReceipt(ctx.prisma, ctx.user, action);
      if (WORKSPACE_SERVICE_PUBLICATION_TOOLS.some(tool => tool.name === action.action)) await authorizeServicePublicationReceipt(ctx.prisma, ctx.user, action);
      if (name === 'get_action') return { kind: 'receipt', action: receipt(action) };
      // ownerOnly prevents a key from approving another user's proposal.
      const result = name === 'confirm_action'
        ? await executor.approve(ctx, parsed.data.actionId, { method: ctx.oauth ? 'oauth_confirm' : (options.approvalMethod ?? 'api_key_confirm'), ownerOnly: true })
        : await executor.reject(ctx, parsed.data.actionId, { reason: 'not_needed', ownerOnly: true, method: ctx.oauth ? 'oauth_confirm' : (options.approvalMethod ?? 'api_key_confirm') });
      if (result.action) await assertMcpActionAuthority(ctx.prisma, ctx, result.action.action, result.action);
      if (RESOURCE_LINK_TOOLS.some(tool => tool.name === result.action?.action)) await resourceLinkToolCall(() => currentResourceLinkStaff(ctx.prisma, ctx.user));
      if (result.action?.action === 'create_client_task') await authorizeClientTaskReceipt(ctx.prisma, ctx.user, result.action);
      if (result.action?.action === 'publish_client_service_report_snapshot') await authorizeServicePublicationReceipt(ctx.prisma, ctx.user, result.action);
      return { kind: 'receipt', action: receipt(result.action), idempotent: result.idempotent };
    }
    const tool = registry.get(name);
    if (WORKSPACE_BILLING_TOOLS.some(tool => tool.name === name)) await billingAdmin(ctx);
    if (RESOURCE_LINK_TOOLS.some(tool => tool.name === name)) await resourceLinkToolCall(() => currentResourceLinkStaff(ctx.prisma, ctx.user));
    if (WORKSPACE_RECORD_TOOLS.some(tool => tool.name === name)) await recordToolCall(() => currentRecordStaff(ctx.prisma, ctx.user));
    let input = args;
    let idempotencyKey;
    if (tool.class !== 'read') {
      const parsed = z.object({ input: z.unknown(), idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/) }).strict().safeParse(args);
      if (!parsed.success) throw new ToolError('INVALID_INPUT', 'Expected input and an idempotencyKey of 8-128 characters');
      ({ input, idempotencyKey } = parsed.data);
    }
    if (WORKSPACE_COMMUNICATION_ACTIONS.some(tool => tool.name === name)) {
      const parsed = communicationTaskInputSchema.safeParse(input);
      if (!parsed.success) throw new ToolError('INVALID_INPUT', 'Invalid communication task input');
      await communicationTaskScope({ prisma: ctx.prisma, user: ctx.user, input: parsed.data });
    }
    if (WORKSPACE_CLIENT_AGENT_ACTIONS.some(tool => tool.name === name)) {
      const parsed = clientTaskInputSchema.safeParse(input);
      if (!parsed.success) throw new ToolError('INVALID_INPUT', 'Invalid client task input');
      await clientTaskScope({ prisma: ctx.prisma, user: ctx.user, input: parsed.data });
    }
    if (name === 'publish_client_service_report_snapshot') {
      const parsed = servicePublicationInputSchema.safeParse(input);
      if (!parsed.success) throw new ToolError('INVALID_INPUT', 'Invalid saved report snapshot');
      await authorizeServicePublicationReceipt(ctx.prisma, ctx.user, { input: parsed.data });
    }
    const result = await executor.invoke(ctx, { tool: name, input, idempotencyKey, source: 'ai_bridge' });
    if (result.action) await assertMcpActionAuthority(ctx.prisma, ctx, result.action.action, result.action);
    if (RESOURCE_LINK_TOOLS.some(tool => tool.name === result.action?.action)) await resourceLinkToolCall(() => currentResourceLinkStaff(ctx.prisma, ctx.user));
    if (result.action?.action === 'create_client_task') await authorizeClientTaskReceipt(ctx.prisma, ctx.user, result.action);
    if (result.action?.action === 'publish_client_service_report_snapshot') await authorizeServicePublicationReceipt(ctx.prisma, ctx.user, result.action);
    return result.action ? { ...result, action: receipt(result.action) } : result;
  }
  async function listCurrent(ctx) {
    const visible = list(ctx);
    if (!visible.some(tool => RESOURCE_LINK_TOOLS.some(resource => resource.name === tool.name))) return visible;
    try { await resourceLinkToolCall(() => currentResourceLinkStaff(ctx.prisma, ctx.user)); }
    catch (error) {
      if (error.code !== 'ROLE_DENIED') throw error;
      return visible.filter(tool => !RESOURCE_LINK_TOOLS.some(resource => resource.name === tool.name));
    }
    const resourceAction = ctx.oauth && visible.find(tool => RESOURCE_LINK_TOOLS.some(resource => resource.name === tool.name && resource.class !== 'read'));
    if (resourceAction) {
      try { await assertMcpActionAuthority(ctx.prisma, ctx, resourceAction.name); }
      catch (error) {
        if (error.code !== 'NOT_FOUND') throw error;
        return visible.filter(tool => !RESOURCE_LINK_TOOLS.some(resource => resource.name === tool.name && resource.class !== 'read'));
      }
    }
    return visible;
  }
  return { list, listCurrent, call: async (...args) => {
    try { return await call(...args); } catch (error) {
      if (isWorkspaceBoundAction(error.action?.action) || RESOURCE_LINK_TOOLS.some(tool => tool.name === error.action?.action)) delete error.action;
      throw error;
    }
  } };
}

async function billingAdmin(ctx) {
  try { await currentInvoiceAdmin(ctx.prisma, ctx.user); }
  catch (error) {
    if (error.statusCode === 403) throw new ToolError('ROLE_DENIED', 'An active administrator is required.', { statusCode: 403 });
    throw error;
  }
}
