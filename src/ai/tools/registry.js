// Governed AI tool registry (#413 slice 2, docs/ai-tool-registry.md).
//
// A closed, code-defined catalogue of the tools an AI caller may use: the
// ChatGPT/Codex bridge's workflow actions and the tools an assistant model may
// propose. Nothing here runs a tool; src/ai/tools/executor.js does, after
// validating the input, the caller's role and the record scope, and (for
// prepare/execute tools) only after a human approved the pending action.
//
// Adding a tool is a reviewed code change: define it with `defineTool` and add
// it to BUILTIN_TOOLS. A tool flagged `external` (it reaches a third party) or
// `irreversible` (it cannot be undone from Ashbi: sending email, publishing,
// billing, deletion, credential access, third-party account changes) is
// rejected at registration unless its name is on EXTERNAL_TOOL_ALLOWLIST.

import { z } from 'zod';
import { computeMonthToDateUsage } from '../governance.js';

export const TOOL_CLASSES = Object.freeze(['read', 'draft', 'prepare', 'execute']);
/** Classes that never run without a pending action and a human approval. */
export const APPROVAL_CLASSES = Object.freeze(['prepare', 'execute']);
export const TOOL_ROLES = Object.freeze(['ADMIN', 'TEAM']);

/**
 * Tools that may be `external` or `irreversible`. Proposal for owner approval
 * (docs/ai-tool-registry.md): only the Slack post, which was already
 * confirm-gated by the AI bridge before this registry existed.
 */
export const EXTERNAL_TOOL_ALLOWLIST = Object.freeze(['send_slack_message']);

/** Longest time an approved action may wait for its approval. Proposal. */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;
/** Upper bound for any tool's timeout. */
export const MAX_TOOL_TIMEOUT_MS = 60_000;

const TOOL_NAME = /^[a-z][a-z0-9_]{2,63}$/;

/**
 * A refused or failed tool operation. `code` is stable and safe to show;
 * `message` never carries tenant data, secrets or provider text.
 */
export class ToolError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ statusCode?: number, action?: any }} [options]
   */
  constructor(code, message, { statusCode = 400, action } = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.statusCode = statusCode;
    if (action !== undefined) this.action = action;
  }
}

export class ToolRegistrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolRegistrationError';
  }
}

/** The record a tool needs does not exist in the caller's organization. */
export function recordNotFound(message = 'Record not found') {
  return new ToolError('RECORD_NOT_FOUND', message, { statusCode: 404 });
}

/** The record exists but the action's target cannot be used right now. */
export function targetUnavailable(message = 'Action target is unavailable') {
  return new ToolError('TARGET_UNAVAILABLE', message, { statusCode: 409 });
}

function fail(name, message) {
  throw new ToolRegistrationError(`Tool ${name || '(unnamed)'}: ${message}`);
}

/**
 * Validate and freeze one tool definition.
 *
 * @param {{
 *   name: string, description: string, class: 'read' | 'draft' | 'prepare' | 'execute',
 *   roles: string[], inputSchema: import('zod').ZodTypeAny,
 *   resolveScope: (ctx: { prisma: any, user: any, input: any }) => Promise<{ ids: Record<string, any>, records?: any }>,
 *   requiresConfirmation?: boolean,
 *   idempotency?: 'required' | 'none',
 *   timeoutMs?: number,
 *   retry?: { maxAttempts: number },
 *   external?: boolean, irreversible?: boolean,
 *   rollback?: string,
 *   approval?: { approverRoles?: string[], requesterMayApprove?: boolean },
 *   run?: Function, preview?: Function,
 *   execution?: { mode: 'transaction', execute: Function } | { mode: 'external', claimTarget: Function, attemptedResult: Function, deliver: Function },
 * }} spec
 * @param {{ allowlist?: readonly string[] }} [options]
 */
export function defineTool(spec, { allowlist = EXTERNAL_TOOL_ALLOWLIST } = {}) {
  const name = spec?.name;
  if (typeof name !== 'string' || !TOOL_NAME.test(name)) fail(name, 'name must be lower snake case');
  if (typeof spec.description !== 'string' || !spec.description.trim()) fail(name, 'description is required');
  if (!TOOL_CLASSES.includes(spec.class)) fail(name, `class must be one of ${TOOL_CLASSES.join(', ')}`);
  if (!Array.isArray(spec.roles) || !spec.roles.length || !spec.roles.every((role) => TOOL_ROLES.includes(role))) {
    fail(name, `roles must be a non-empty subset of ${TOOL_ROLES.join(', ')}`);
  }
  if (typeof spec.inputSchema?.safeParse !== 'function') fail(name, 'inputSchema must be a Zod schema');
  if (typeof spec.resolveScope !== 'function') fail(name, 'resolveScope is required');

  const external = Boolean(spec.external);
  const irreversible = Boolean(spec.irreversible);
  // Default deny: anything that leaves Ashbi or cannot be undone needs an
  // explicit, reviewed allowlist entry.
  if ((external || irreversible) && !allowlist.includes(name)) {
    fail(name, 'external or irreversible tools must be on EXTERNAL_TOOL_ALLOWLIST');
  }

  const timeoutMs = spec.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TOOL_TIMEOUT_MS) {
    fail(name, `timeoutMs must be 1..${MAX_TOOL_TIMEOUT_MS}`);
  }
  const retry = { maxAttempts: spec.retry?.maxAttempts ?? 1 };
  if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1 || retry.maxAttempts > 3) fail(name, 'retry.maxAttempts must be 1..3');

  const needsApproval = APPROVAL_CLASSES.includes(spec.class);
  let requiresConfirmation = Boolean(spec.requiresConfirmation);
  let idempotency = spec.idempotency ?? 'none';
  if (needsApproval) {
    if (spec.requiresConfirmation === false) fail(name, `${spec.class} tools always require confirmation`);
    requiresConfirmation = true;
    idempotency = spec.idempotency ?? 'required';
    if (idempotency !== 'required') fail(name, `${spec.class} tools require an idempotency key`);
    // A side effect may already have happened when an attempt fails, so
    // approved actions are never retried automatically.
    if (retry.maxAttempts !== 1) fail(name, `${spec.class} tools are never retried`);
    if (typeof spec.rollback !== 'string' || !spec.rollback.trim()) fail(name, 'a rollback or failure note is required');
    if (typeof spec.preview !== 'function') fail(name, 'preview is required');
    const execution = spec.execution;
    if (execution?.mode === 'transaction') {
      if (typeof execution.execute !== 'function') fail(name, 'execution.execute is required');
    } else if (execution?.mode === 'external') {
      if (!external) fail(name, 'external execution requires external: true');
      for (const hook of ['claimTarget', 'attemptedResult', 'deliver']) {
        if (typeof execution[hook] !== 'function') fail(name, `execution.${hook} is required`);
      }
    } else {
      fail(name, 'execution.mode must be transaction or external');
    }
  } else {
    if (typeof spec.run !== 'function') fail(name, 'run is required');
    if (!['none', 'required'].includes(idempotency)) fail(name, 'idempotency must be none or required');
  }

  const approverRoles = spec.approval?.approverRoles ?? ['ADMIN', 'TEAM'];
  if (!approverRoles.every((role) => TOOL_ROLES.includes(role))) fail(name, 'approval.approverRoles must be staff roles');

  return Object.freeze({
    name,
    description: spec.description.trim(),
    class: spec.class,
    roles: Object.freeze([...spec.roles]),
    inputSchema: spec.inputSchema,
    resolveScope: spec.resolveScope,
    requiresConfirmation,
    idempotency,
    timeoutMs,
    retry: Object.freeze(retry),
    external,
    irreversible,
    rollback: spec.rollback?.trim() ?? null,
    approval: Object.freeze({
      approverRoles: Object.freeze([...approverRoles]),
      // When false, a different user than the requester must approve.
      requesterMayApprove: spec.approval?.requesterMayApprove ?? true,
    }),
    run: spec.run ?? null,
    preview: spec.preview ?? null,
    execution: spec.execution ? Object.freeze({ ...spec.execution }) : null,
  });
}

/**
 * @param {Array<Parameters<typeof defineTool>[0]>} specs
 * @param {{ allowlist?: readonly string[] }} [options]
 */
export function createToolRegistry(specs, options = {}) {
  const tools = new Map();
  for (const spec of specs) {
    const tool = defineTool(spec, options);
    if (tools.has(tool.name)) throw new ToolRegistrationError(`Tool ${tool.name}: registered twice`);
    tools.set(tool.name, tool);
  }
  return Object.freeze({
    /** @param {unknown} name */
    get: (name) => (typeof name === 'string' ? tools.get(name) ?? null : null),
    list: () => [...tools.values()],
    names: () => [...tools.keys()],
  });
}

/** Public description of a tool (no functions or schemas). */
export function describeTool(tool) {
  return {
    name: tool.name,
    description: tool.description,
    class: tool.class,
    roles: [...tool.roles],
    requiresConfirmation: tool.requiresConfirmation,
    idempotency: tool.idempotency,
    timeoutMs: tool.timeoutMs,
    maxAttempts: tool.retry.maxAttempts,
    external: tool.external,
    irreversible: tool.irreversible,
    requesterMayApprove: tool.approval.requesterMayApprove,
    rollback: tool.rollback,
  };
}

// ---------------------------------------------------------------------------
// Scope helpers. Every query names the caller's organization explicitly, in
// addition to the tenant proxy that request-scoped Prisma clients apply, so a
// resolver still refuses another organization's record if it is ever handed
// an unscoped client.

const recordId = z.string().min(1).max(50);

/**
 * Prove a project belongs to the caller's organization. Staff (ADMIN, TEAM)
 * may use every project of their organization, the same rule as project
 * rooms (src/auth/project-room-access.js).
 */
async function requireProject(prisma, user, projectId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
    select: { id: true, name: true },
  });
  if (!project) throw recordNotFound('Project not found');
  return project;
}

async function requireSlackThreadRoot(prisma, projectId, threadMessageId) {
  const root = await prisma.chatMessage.findFirst({
    where: { id: threadMessageId, projectId, externalSource: 'SLACK', parentId: null },
    select: { id: true, externalThreadId: true },
  });
  if (!root?.externalThreadId) throw targetUnavailable('Slack thread is unavailable for this project');
  return root;
}

function findOutboundMapping(prisma, projectId, select) {
  return prisma.slackChannelMapping.findFirst({
    where: { projectId, outboundEnabled: true, installation: { status: 'ACTIVE' } },
    select,
  });
}

// ---------------------------------------------------------------------------
// Previews. An approver must see every field the action persists that a
// person will later see: the full title, description, location and message
// text are in the preview, never only in the stored input.
//
// Input schemas. The execute tools' transforms produce exactly the object the
// AI bridge hashed before this registry existed, so an idempotency key reused
// across the upgrade still matches its stored input hash.

const createTaskInput = z.object({
  projectId: recordId,
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10_000).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']).optional(),
  dueDate: z.string().max(64).refine((value) => !Number.isNaN(Date.parse(value)), 'dueDate must be a date').optional(),
}).strict().transform((value) => ({
  projectId: value.projectId,
  title: value.title,
  description: value.description,
  priority: value.priority ?? 'NORMAL',
  dueDate: value.dueDate,
}));

const createCalendarEventInput = z.object({
  projectId: recordId,
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10_000).optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  type: z.enum(['MEETING', 'DEADLINE', 'REMINDER', 'MILESTONE']).optional(),
  location: z.string().max(500).optional(),
}).strict().refine((value) => new Date(value.endTime) > new Date(value.startTime), 'endTime must be after startTime')
  .transform((value) => ({
    projectId: value.projectId,
    title: value.title,
    description: value.description,
    startTime: new Date(value.startTime).toISOString(),
    endTime: new Date(value.endTime).toISOString(),
    type: value.type ?? 'MEETING',
    location: value.location?.trim() || undefined,
  }));

const sendSlackMessageInput = z.object({
  projectId: recordId,
  text: z.string().trim().min(1).max(4_000),
  threadMessageId: z.string().max(50).refine((value) => value.trim().length > 0, 'threadMessageId is required').optional(),
}).strict().transform((value) => ({
  projectId: value.projectId,
  text: value.text,
  ...(value.threadMessageId ? { threadMessageId: value.threadMessageId } : {}),
}));

// ---------------------------------------------------------------------------
// Built-in tools.

const noRecords = async ({ user }) => ({ ids: { organizationId: user.organizationId } });

const projectScope = async ({ prisma, user, input }) => {
  const project = await requireProject(prisma, user, input.projectId);
  return { ids: { projectId: project.id }, records: { project } };
};

export const BUILTIN_TOOLS = Object.freeze([
  {
    name: 'list_projects',
    description: 'List the organization\'s projects (id, name, status, health), most recently updated first.',
    class: 'read',
    roles: ['ADMIN', 'TEAM'],
    inputSchema: z.object({
      status: z.string().trim().min(1).max(40).optional(),
      limit: z.number().int().min(1).max(50).default(25),
    }).strict(),
    resolveScope: noRecords,
    timeoutMs: 5_000,
    run: ({ prisma, user, input }) => prisma.project.findMany({
      where: { organizationId: user.organizationId, ...(input.status ? { status: input.status } : {}) },
      select: { id: true, name: true, status: true, health: true },
      orderBy: { updatedAt: 'desc' },
      take: input.limit,
    }),
  },
  {
    name: 'list_my_tasks',
    description: 'List open tasks assigned to the signed-in user.',
    class: 'read',
    roles: ['ADMIN', 'TEAM'],
    inputSchema: z.object({
      includeCompleted: z.boolean().default(false),
      limit: z.number().int().min(1).max(50).default(25),
    }).strict(),
    resolveScope: async ({ user }) => ({ ids: { organizationId: user.organizationId, assigneeId: user.id } }),
    timeoutMs: 5_000,
    run: ({ prisma, user, input }) => prisma.task.findMany({
      where: {
        assigneeId: user.id,
        project: { organizationId: user.organizationId },
        ...(input.includeCompleted ? {} : { status: { not: 'COMPLETED' } }),
      },
      select: { id: true, title: true, status: true, priority: true, dueDate: true, projectId: true },
      orderBy: { updatedAt: 'desc' },
      take: input.limit,
    }),
  },
  {
    name: 'get_project_summary',
    description: 'Summarize one project: status, health, dates and open task count.',
    class: 'read',
    roles: ['ADMIN', 'TEAM'],
    inputSchema: z.object({ projectId: recordId }).strict(),
    resolveScope: projectScope,
    timeoutMs: 5_000,
    run: async ({ prisma, user, input }) => {
      const [project, openTasks] = await Promise.all([
        prisma.project.findFirst({
          where: { id: input.projectId, organizationId: user.organizationId },
          select: { id: true, name: true, status: true, health: true, healthScore: true, aiSummary: true, startDate: true, endDate: true },
        }),
        prisma.task.count({
          where: { projectId: input.projectId, project: { organizationId: user.organizationId }, status: { not: 'COMPLETED' } },
        }),
      ]);
      if (!project) throw recordNotFound('Project not found');
      return { ...project, openTasks };
    },
  },
  {
    name: 'get_ai_usage_summary',
    description: 'Month-to-date AI usage of the organization\'s own provider connection (admins only).',
    class: 'read',
    roles: ['ADMIN'],
    inputSchema: z.object({}).strict(),
    resolveScope: noRecords,
    timeoutMs: 5_000,
    run: async ({ prisma, user }) => {
      const usage = await computeMonthToDateUsage(prisma, user.organizationId);
      return {
        since: usage.since,
        calls: usage.calls,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        spentCents: Math.round(usage.spentCents * 100) / 100,
      };
    },
  },
  {
    name: 'create_task',
    description: 'Create a task in a project.',
    class: 'execute',
    roles: ['ADMIN', 'TEAM'],
    inputSchema: createTaskInput,
    resolveScope: projectScope,
    requiresConfirmation: true,
    idempotency: 'required',
    timeoutMs: 10_000,
    rollback: 'Delete the created task (result.taskId). A failure is a rolled-back transaction: nothing was created.',
    preview: async ({ input, scope }) => ({
      kind: 'create_task',
      project: { id: scope.records.project.id, name: scope.records.project.name },
      title: input.title,
      priority: input.priority,
      dueDate: input.dueDate ?? null,
      ...(input.description ? { description: input.description } : {}),
    }),
    execution: {
      mode: 'transaction',
      execute: async ({ prisma, input, user }) => {
        const project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: user.organizationId }, select: { id: true } });
        if (!project) throw targetUnavailable();
        const task = await prisma.task.create({
          data: { title: input.title, description: input.description, priority: input.priority, dueDate: input.dueDate ? new Date(input.dueDate) : null, projectId: project.id },
        });
        return { taskId: task.id, projectId: project.id };
      },
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Create an Ashbi calendar event in a project (never synced to an external calendar).',
    class: 'execute',
    roles: ['ADMIN', 'TEAM'],
    inputSchema: createCalendarEventInput,
    resolveScope: projectScope,
    requiresConfirmation: true,
    idempotency: 'required',
    timeoutMs: 10_000,
    rollback: 'Delete the created event (result.eventId). A failure is a rolled-back transaction: nothing was created.',
    preview: async ({ input, scope }) => ({
      kind: 'create_calendar_event',
      project: { id: scope.records.project.id, name: scope.records.project.name },
      title: input.title,
      startTime: input.startTime,
      endTime: input.endTime,
      type: input.type,
      ...(input.description ? { description: input.description } : {}),
      ...(input.location ? { location: input.location } : {}),
    }),
    execution: {
      mode: 'transaction',
      execute: async ({ prisma, input, user }) => {
        const project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: user.organizationId }, select: { id: true } });
        if (!project) throw targetUnavailable();
        const event = await prisma.calendarEvent.create({
          data: {
            title: input.title, description: input.description, startTime: new Date(input.startTime), endTime: new Date(input.endTime),
            type: input.type, location: input.location, projectId: project.id, createdById: user.id, googleSyncStatus: 'NOT_CONNECTED',
          },
        });
        return { eventId: event.id, projectId: project.id };
      },
    },
  },
  {
    name: 'send_slack_message',
    description: 'Post a message (or a thread reply) to the Slack channel mapped to a project.',
    class: 'execute',
    roles: ['ADMIN', 'TEAM'],
    inputSchema: sendSlackMessageInput,
    resolveScope: async ({ prisma, user, input }) => {
      const project = await requireProject(prisma, user, input.projectId);
      const root = input.threadMessageId ? await requireSlackThreadRoot(prisma, project.id, input.threadMessageId) : null;
      return {
        ids: { projectId: project.id, ...(root ? { threadMessageId: root.id } : {}) },
        records: { project, root },
      };
    },
    requiresConfirmation: true,
    idempotency: 'required',
    timeoutMs: 15_000,
    external: true,
    // A posted message cannot be recalled from Ashbi.
    irreversible: true,
    rollback: 'Slack messages cannot be recalled from Ashbi; delete the message in Slack. When delivery fails the receipt keeps the target with deliveryState UNKNOWN for manual reconciliation and is never retried (docs/slack-outbound-recovery-policy.md).',
    preview: async ({ prisma, input, scope }) => {
      const { project, root } = scope.records;
      const mapping = await findOutboundMapping(prisma, project.id, { id: true, channelId: true, channelName: true });
      if (!mapping) throw targetUnavailable('No active outbound Slack channel is mapped to this project');
      return {
        kind: 'send_slack_message',
        project: { id: project.id, name: project.name },
        mapping: { id: mapping.id, channelId: mapping.channelId, name: mapping.channelName ?? mapping.channelId },
        text: input.text,
        ...(root ? { replyTo: { messageId: root.id } } : {}),
      };
    },
    execution: {
      mode: 'external',
      // Runs inside the claim transaction: re-checks the target as it is now.
      claimTarget: async ({ prisma, input }) => {
        const found = await findOutboundMapping(prisma, input.projectId, { id: true, channelId: true, installation: { select: { botTokenEncrypted: true } } });
        if (!found?.installation?.botTokenEncrypted) throw targetUnavailable();
        let threadTs = null;
        if (input.threadMessageId) threadTs = (await requireSlackThreadRoot(prisma, input.projectId, input.threadMessageId)).externalThreadId;
        return { ...found, text: input.text, threadTs, threadMessageId: input.threadMessageId ?? null };
      },
      attemptedResult: (target) => ({
        deliveryState: 'UNKNOWN', mappingId: target.id, channelId: target.channelId,
        ...(target.threadMessageId ? { threadMessageId: target.threadMessageId } : {}),
      }),
      deliver: async ({ target, deps }) => {
        const slackInput = { botToken: deps.decryptSecret(target.installation.botTokenEncrypted), channelId: target.channelId, text: target.text };
        if (target.threadTs) slackInput.threadTs = target.threadTs;
        const posted = await deps.postSlackMessage(slackInput);
        return { mappingId: target.id, ...posted, ...(target.threadMessageId ? { threadMessageId: target.threadMessageId } : {}) };
      },
    },
  },
]);

/** The process-wide registry. */
export const toolRegistry = createToolRegistry(BUILTIN_TOOLS);

/** Tool names the AI bridge exposes as workflow actions (its public contract). */
export const AI_BRIDGE_ACTION_TOOLS = Object.freeze(['create_task', 'create_calendar_event', 'send_slack_message']);
