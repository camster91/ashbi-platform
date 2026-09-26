// Governed AI tool execution engine (#413 slice 2, docs/ai-tool-registry.md).
//
// Every tool call, whether it comes from the ChatGPT/Codex bridge or from an
// assistant model, goes through `invoke`:
//
//   1. the tool must be in the registry, and the input small enough;
//   2. the input must pass the tool's Zod schema;
//   3. the caller's role must be one the tool allows;
//   4. AI must be allowed (deployment and organization kill switches);
//   5. the scope resolver must prove every referenced record belongs to the
//      caller's organization;
//   6. read/draft tools then run and return their (secret-free) output;
//      prepare/execute tools only create a pending action.
//
// A refusal at any step throws a ToolError (or the AI control error) and
// records `ai.tool_denied` with a reason code.
//
// A pending action runs only through `approve`, by an authorised human (a
// different user when the tool requires it). Execution is idempotent by
// (tool, idempotency key, input hash): a replay returns the stored receipt,
// the same key with other input is refused. Approved actions are never
// retried: a timeout or an ambiguous failure ends with outcome `unknown`.
//
// The ai_bridge_actions row is the receipt: requester, approver, tenant,
// tool, input scope, approval evidence, result, error, correlation id and
// timestamps. A database trigger makes it immutable once terminal.

import crypto from 'node:crypto';
import defaultLogger from '../../utils/logger.js';
import { actorTypeForRole, recordAuditEvent } from '../../services/audit-event.service.js';
import { LOG_REDACT_PATHS } from '../../utils/log-redaction.js';
import { aiGovernance } from '../governance.js';
import { isAiControlError } from '../errors.js';
import { APPROVAL_CLASSES, APPROVAL_TTL_MS, ToolError, toolRegistry } from './registry.js';

/** Largest serialized tool input accepted. Proposal (docs/ai-tool-registry.md). */
export const MAX_TOOL_INPUT_BYTES = 16 * 1024;
export const IDEMPOTENCY_KEY_FORMAT = /^[A-Za-z0-9._:-]{8,128}$/;
export const PENDING_STATUS = 'PENDING_CONFIRMATION';
export const TERMINAL_STATUSES = Object.freeze(['EXECUTED', 'FAILED', 'REJECTED', 'EXPIRED']);
export const REJECTION_REASONS = Object.freeze(['not_needed', 'incorrect', 'unsafe', 'other']);

/** Reason codes of `ai.tool_denied`. */
export const TOOL_DENIAL_REASONS = Object.freeze([
  'TOOL_UNKNOWN', 'INPUT_TOO_LARGE', 'INVALID_INPUT', 'ROLE_DENIED', 'AI_DISABLED',
  'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_CONFLICT', 'RECORD_NOT_FOUND', 'TARGET_UNAVAILABLE',
  'APPROVER_NOT_ALLOWED', 'TOO_MANY_TOOL_CALLS', 'MALFORMED_TOOL_CALL',
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Hash of the tool name and its normalized input (the AI bridge's format). */
export function toolInputHash(tool, input) {
  return crypto.createHash('sha256').update(stableJson({ action: tool, input })).digest('hex');
}

// Field names and value shapes that must never leave a tool: credential
// ciphertext, bot tokens, provider keys, Ashbi API keys, password hashes, and
// the credential fields the log redaction list names (src/utils/log-redaction.js).
const LOG_REDACTED_FIELDS = new Set(LOG_REDACT_PATHS
  .map((path) => path.replace(/^\*\./, ''))
  .filter((path) => /^[A-Za-z]+$/.test(path))
  .map((path) => path.toLowerCase()));
const SECRET_FIELD = /(password|passwd|secret|token|api[-_]?key|private[-_]?key|encrypted|credential|authorization|cookie|hash)/i;
// Generic credential shapes, so a secret pasted into free text (a project
// summary, a task description) is masked wherever it appears.
const SECRET_VALUE = new RegExp([
  'sk-[A-Za-z0-9_-]{8,}', // OpenAI-compatible provider keys
  '(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}', // Stripe
  'xox[abprs]-[A-Za-z0-9-]{8,}', // Slack tokens
  'hooks\\.slack\\.com/services/[A-Za-z0-9/_-]+', // Slack webhook URLs
  'ashbi_[A-Za-z0-9_-]{16,}', // Ashbi API keys
  'gh[pousr]_[A-Za-z0-9]{20,}', // GitHub tokens
  'AKIA[0-9A-Z]{16}', // AWS access key ids
  'AIza[0-9A-Za-z_-]{30,}', // Google API keys
  'eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}', // JWTs
  '-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)', // PEM keys
  'v\\d+:[A-Za-z0-9_-]+:[A-Za-z0-9+/=_:-]{16,}', // Ashbi ciphertext envelopes
  '\\$2[aby]\\$\\d{2}\\$[./A-Za-z0-9]{20,}', // bcrypt hashes
  '(?<=://)[^/\\s:@]+:[^/\\s@]+(?=@)', // credentials in URLs
  '(?<=\\bBearer\\s)[A-Za-z0-9._~+/=-]{8,}', // bearer tokens
  '(?<=\\b(?:password|passwd|pwd|secret|api[_-]?key|token)\\s*[:=]\\s*)[^\\s,;]+', // key=value secrets
].join('|'), 'gi');

/**
 * Remove secret-looking fields and values from a tool output or receipt
 * result. Dates are kept; functions and symbols are dropped.
 * @param {unknown} value
 * @returns {any}
 */
export function redactSecrets(value, depth = 0) {
  if (depth > 12) return null;
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[redacted]');
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_FIELD.test(key) || LOG_REDACTED_FIELDS.has(key.toLowerCase())) continue;
      out[key] = redactSecrets(item, depth + 1);
    }
    return out;
  }
  return null;
}

class ToolTimeoutError extends Error {
  constructor() {
    super('Tool timed out');
    this.name = 'ToolTimeoutError';
  }
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new ToolTimeoutError()), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function isTargetUnavailable(error) {
  return error?.code === 'TARGET_UNAVAILABLE' || error?.message === 'ACTION_TARGET_UNAVAILABLE';
}

function serializedSize(value) {
  try {
    const text = JSON.stringify(value ?? null);
    return typeof text === 'string' ? Buffer.byteLength(text) : 0;
  } catch {
    return Number.POSITIVE_INFINITY; // cyclic or unserializable
  }
}

/**
 * @param {{
 *   registry?: ReturnType<typeof import('./registry.js').createToolRegistry>,
 *   governance?: { assertAllowed: (organizationId: string) => Promise<void> },
 *   audit?: (prisma: any, event: any) => Promise<any>,
 *   logger?: any,
 *   now?: () => Date,
 *   approvalTtlMs?: number,
 *   deps?: { decryptSecret?: (value: string) => string, postSlackMessage?: (input: any) => Promise<any> },
 * }} [options]
 */
export function createToolExecutor(options = {}) {
  const registry = options.registry ?? toolRegistry;
  const governance = options.governance ?? aiGovernance;
  const logger = options.logger ?? defaultLogger;
  const audit = options.audit ?? ((prisma, event) => recordAuditEvent(prisma, event, { logger }));
  const now = options.now ?? (() => new Date());
  const approvalTtlMs = options.approvalTtlMs ?? APPROVAL_TTL_MS;
  const deps = options.deps ?? {};

  /**
   * @param {{ prisma: any, user: any, requestId?: string | null, ip?: string | null }} ctx
   * @param {string} action
   * @param {{ entityId?: string | null, metadata?: Record<string, unknown> }} event
   */
  function emit(ctx, action, { entityId = null, metadata = {} } = {}) {
    return audit(ctx.prisma, {
      organizationId: ctx.user?.organizationId ?? null,
      actorUserId: ctx.user?.id ?? null,
      actorType: actorTypeForRole(ctx.user?.role),
      action,
      entityId,
      requestId: ctx.requestId ?? null,
      ip: ctx.ip ?? null,
      metadata,
    });
  }

  async function deny(ctx, error, { tool = null, source = null, entityId = null } = {}) {
    const reason = error instanceof ToolError ? error.code : (isAiControlError(error) ? error.code : 'DENIED');
    await emit(ctx, 'ai.tool_denied', {
      entityId,
      metadata: { tool: typeof tool === 'string' ? tool.slice(0, 64) : null, reason, source, correlationId: ctx.requestId ?? null },
    });
    return error;
  }

  async function assertAiAllowed(ctx) {
    try {
      await governance.assertAllowed(ctx.user.organizationId);
    } catch (error) {
      // Fail closed: an unreadable kill switch is treated as "off".
      if (isAiControlError(error)) throw error;
      logger.error({ errorName: error?.name }, 'AI kill switch check failed');
      throw new ToolError('AI_DISABLED', 'AI features are unavailable right now.', { statusCode: 503 });
    }
  }

  /**
   * Validate, authorise and scope one tool call. Read/draft tools run;
   * prepare/execute tools become a pending action awaiting approval.
   *
   * @param {{ prisma: any, user: { id: string, organizationId: string, role: string }, requestId?: string | null, ip?: string | null }} ctx
   * @param {{ tool: unknown, input: unknown, idempotencyKey?: unknown, source?: 'ai_bridge' | 'assistant' }} call
   * @returns {Promise<{ kind: 'result', tool: string, toolClass: string, output: any } | { kind: 'pending', action: any, idempotent: boolean }>}
   */
  async function invoke(ctx, { tool: name, input, idempotencyKey, source = 'assistant' }) {
    const tool = registry.get(name);
    const denyWith = async (error) => { throw await deny(ctx, error, { tool: tool?.name ?? (typeof name === 'string' ? name : null), source }); };
    if (!tool) return denyWith(new ToolError('TOOL_UNKNOWN', 'Unknown tool', { statusCode: 400 }));
    if (serializedSize(input) > MAX_TOOL_INPUT_BYTES) {
      return denyWith(new ToolError('INPUT_TOO_LARGE', 'Tool input is too large', { statusCode: 400 }));
    }
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) return denyWith(new ToolError('INVALID_INPUT', `Invalid ${tool.name} input`, { statusCode: 400 }));
    const normalized = parsed.data;
    if (!tool.roles.includes(ctx.user?.role)) {
      return denyWith(new ToolError('ROLE_DENIED', 'Your role cannot use this tool', { statusCode: 403 }));
    }
    try {
      await assertAiAllowed(ctx);
    } catch (error) {
      return denyWith(error);
    }

    const needsApproval = APPROVAL_CLASSES.includes(tool.class);
    let hash = null;
    if (needsApproval) {
      if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_FORMAT.test(idempotencyKey)) {
        return denyWith(new ToolError('IDEMPOTENCY_KEY_REQUIRED', 'A valid idempotency key is required', { statusCode: 400 }));
      }
      hash = toolInputHash(tool.name, normalized);
      const existing = await ctx.prisma.aiBridgeAction.findFirst({ where: { userId: ctx.user.id, idempotencyKey } });
      if (existing) {
        if (existing.action !== tool.name || existing.inputHash !== hash) {
          return denyWith(new ToolError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another action', { statusCode: 409 }));
        }
        return { kind: 'pending', action: existing, idempotent: true };
      }
    }

    let scope;
    try {
      scope = await tool.resolveScope({ prisma: ctx.prisma, user: ctx.user, input: normalized });
    } catch (error) {
      if (error instanceof ToolError) return denyWith(error);
      throw error;
    }

    if (!needsApproval) {
      let output;
      try {
        output = await withTimeout(Promise.resolve(tool.run({ prisma: ctx.prisma, user: ctx.user, input: normalized, scope })), tool.timeoutMs);
      } catch (error) {
        if (error instanceof ToolError) return denyWith(error);
        logger.warn({ tool: tool.name, errorName: error?.name }, 'AI read tool failed');
        throw new ToolError(error instanceof ToolTimeoutError ? 'TOOL_TIMEOUT' : 'TOOL_FAILED', 'The tool could not complete', { statusCode: 502 });
      }
      return { kind: 'result', tool: tool.name, toolClass: tool.class, output: redactSecrets(output) };
    }

    let preview;
    try {
      preview = await tool.preview({ prisma: ctx.prisma, user: ctx.user, input: normalized, scope });
    } catch (error) {
      if (error instanceof ToolError) return denyWith(error);
      throw error;
    }

    let record;
    try {
      record = await ctx.prisma.aiBridgeAction.create({
        data: {
          organizationId: ctx.user.organizationId,
          userId: ctx.user.id,
          action: tool.name,
          idempotencyKey,
          input: normalized,
          inputHash: hash,
          preview,
          status: PENDING_STATUS,
          expiresAt: new Date(now().getTime() + approvalTtlMs),
          source,
          toolClass: tool.class,
          correlationId: ctx.requestId ?? null,
          inputScope: scope?.ids ?? {},
        },
      });
    } catch (error) {
      // Two concurrent calls with one key: the loser answers like a replay.
      if (error?.code !== 'P2002') throw error;
      const winner = await ctx.prisma.aiBridgeAction.findFirst({ where: { userId: ctx.user.id, idempotencyKey } });
      if (!winner || winner.action !== tool.name || winner.inputHash !== hash) {
        return denyWith(new ToolError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another action', { statusCode: 409 }));
      }
      return { kind: 'pending', action: winner, idempotent: true };
    }
    await emit(ctx, 'ai.tool_prepared', {
      entityId: record.id,
      metadata: { tool: tool.name, toolClass: tool.class, source, inputHash: hash, correlationId: ctx.requestId ?? null },
    });
    return { kind: 'pending', action: record, idempotent: false };
  }

  /** Staff other than ADMIN only ever see and act on their own actions. */
  function ownerWhere(ctx, { ownerOnly = false } = {}) {
    return ownerOnly || ctx.user?.role !== 'ADMIN' ? { userId: ctx.user.id } : {};
  }

  async function load(ctx, actionId, scope) {
    const record = await ctx.prisma.aiBridgeAction.findFirst({ where: { id: actionId, ...scope } });
    if (!record) throw new ToolError('NOT_FOUND', 'Action not found', { statusCode: 404 });
    return record;
  }

  function approverAllowed(ctx, tool, record) {
    if (!['ADMIN', 'TEAM'].includes(ctx.user?.role)) return false;
    if (!tool.approval.approverRoles.includes(ctx.user.role)) return false;
    const isRequester = record.userId === ctx.user.id;
    if (isRequester) return tool.approval.requesterMayApprove;
    return ctx.user.role === 'ADMIN';
  }

  function eventMetadata(record, extra = {}) {
    return {
      tool: record.action, toolClass: record.toolClass ?? 'execute', source: record.source ?? 'ai_bridge',
      requesterUserId: record.userId, correlationId: record.correlationId ?? null, ...extra,
    };
  }

  function unavailable(message) {
    return new ToolError('ACTION_UNAVAILABLE', message, { statusCode: 409 });
  }

  /**
   * One status transition, conditional on the status the caller expects.
   * A concurrent writer that got there first makes Prisma's update find no
   * row (P2025), which is answered as 409 ACTION_UNAVAILABLE, never as a
   * false receipt.
   */
  async function transition(ctx, id, expectedStatus, data) {
    try {
      return await ctx.prisma.aiBridgeAction.update({ where: { id, status: expectedStatus }, data });
    } catch (error) {
      if (error?.code === 'P2025') throw unavailable('Action is already being processed');
      throw error;
    }
  }

  /**
   * Approve a pending action and execute it once.
   *
   * @param {{ prisma: any, user: any, requestId?: string | null, ip?: string | null }} ctx
   * @param {string} actionId
   * @param {{ method?: 'api_key_confirm' | 'session_step_up', reauthenticated?: boolean, ownerOnly?: boolean }} [approval]
   * @returns {Promise<{ action: any, idempotent: boolean }>}
   */
  async function approve(ctx, actionId, { method = 'session_step_up', reauthenticated = false, ownerOnly = false } = {}) {
    const scope = ownerWhere(ctx, { ownerOnly });
    const initial = await load(ctx, actionId, scope);
    if (initial.status === 'EXECUTED') return { action: initial, idempotent: true };
    if (initial.status !== PENDING_STATUS) throw unavailable(`Action is ${String(initial.status).toLowerCase()}`);
    const tool = registry.get(initial.action);
    if (!tool || !APPROVAL_CLASSES.includes(tool.class)) throw unavailable('This action is no longer available');
    const denyApproval = async (error) => {
      throw await deny(ctx, error, { tool: tool.name, source: initial.source ?? null, entityId: initial.id });
    };
    // An assistant's proposal is approved only by a person in a step-up
    // session, never through an API key.
    if (initial.source === 'assistant' && method !== 'session_step_up') {
      return denyApproval(new ToolError('APPROVER_NOT_ALLOWED', 'Approve this action in Ashbi', { statusCode: 403 }));
    }
    if (!approverAllowed(ctx, tool, initial)) {
      return denyApproval(new ToolError('APPROVER_NOT_ALLOWED', 'Another authorised user must approve this action', { statusCode: 403 }));
    }
    try {
      await assertAiAllowed(ctx);
    } catch (error) {
      return denyApproval(error);
    }
    if (new Date(initial.expiresAt) <= now()) {
      const expired = await transition(ctx, initial.id, PENDING_STATUS, { status: 'EXPIRED' });
      await emit(ctx, 'ai.tool_expired', { entityId: initial.id, metadata: eventMetadata(initial) });
      throw new ToolError('ACTION_EXPIRED', 'Action confirmation expired', { statusCode: 409, action: expired });
    }

    const approvedAt = now();
    const approval = {
      confirmedAt: approvedAt,
      approverId: ctx.user.id,
      approvalEvidence: {
        method,
        approverRole: ctx.user.role,
        requesterApproved: ctx.user.id === initial.userId,
        reauthenticated: Boolean(reauthenticated),
        approvedAt: approvedAt.toISOString(),
        requestId: ctx.requestId ?? null,
      },
    };
    // Compare-and-set: only a pending, unexpired row can be claimed, once.
    const claimWhere = { id: initial.id, ...scope, status: PENDING_STATUS, expiresAt: { gt: approvedAt } };
    const requester = { id: initial.userId, organizationId: ctx.user.organizationId };
    const parseStored = () => {
      const parsed = tool.inputSchema.safeParse(initial.input);
      if (!parsed.success) throw new ToolError('TARGET_UNAVAILABLE', 'Action target is unavailable', { statusCode: 409 });
      return parsed.data;
    };
    const claim = async (tx) => {
      const claimed = await tx.aiBridgeAction.updateMany({ where: claimWhere, data: { status: 'EXECUTING', ...approval } });
      if (claimed.count !== 1) throw unavailable('Action is already being processed');
    };
    let approvedEmitted = false;
    const approvedEvent = async () => {
      if (approvedEmitted) return;
      approvedEmitted = true;
      await emit(ctx, 'ai.tool_approved', {
        entityId: initial.id,
        metadata: eventMetadata(initial, { method, reauthenticated: Boolean(reauthenticated), requesterApproved: ctx.user.id === initial.userId }),
      });
    };
    const succeeded = (result) => ({ status: 'EXECUTED', executedAt: now(), result: redactSecrets(result), outcome: 'succeeded' });

    // True only once the EXECUTING claim is committed: until then a failure
    // leaves the row pending, and the failure write must carry the approval.
    let claimCommitted = false;
    let attempted = null;
    let completed;
    try {
      if (tool.execution.mode === 'transaction') {
        completed = await ctx.prisma.$transaction(async (tx) => {
          await claim(tx);
          const input = parseStored();
          const result = await withTimeout(
            Promise.resolve(tool.execution.execute({ prisma: tx, input, user: requester, approver: ctx.user })),
            tool.timeoutMs,
          );
          return transition({ prisma: tx }, initial.id, 'EXECUTING', succeeded(result));
        });
        claimCommitted = true;
        await approvedEvent();
      } else {
        const target = await ctx.prisma.$transaction(async (tx) => {
          await claim(tx);
          return tool.execution.claimTarget({ prisma: tx, input: parseStored() });
        });
        claimCommitted = true;
        await approvedEvent();
        attempted = tool.execution.attemptedResult(target);
        const result = await withTimeout(Promise.resolve(tool.execution.deliver({ target, deps })), tool.timeoutMs);
        completed = await transition(ctx, initial.id, 'EXECUTING', succeeded(result));
      }
    } catch (error) {
      if (error instanceof ToolError && error.code === 'ACTION_UNAVAILABLE') {
        if (!error.action) error.action = await ctx.prisma.aiBridgeAction.findFirst({ where: { id: initial.id, ...scope } });
        throw error;
      }
      const targetGone = isTargetUnavailable(error);
      const timedOut = error instanceof ToolTimeoutError;
      const errorCode = targetGone ? 'ACTION_TARGET_UNAVAILABLE' : (timedOut ? 'ACTION_TIMEOUT' : 'ACTION_EXECUTION_FAILED');
      // Once an external delivery was attempted nobody knows whether it
      // happened: the outcome is unknown and the action is never retried.
      const outcome = attempted && !targetGone ? 'unknown' : 'failed';
      // The approval was decided even though the action did not run: the
      // receipt names the approver either way.
      await approvedEvent();
      const failed = await transition(ctx, initial.id, claimCommitted ? 'EXECUTING' : PENDING_STATUS, {
        status: 'FAILED', errorCode, outcome, ...approval,
        ...(attempted ? { result: attempted } : {}),
      });
      // Never log the error object or message: a provider error can echo a
      // token back. The code and error name are enough to find the receipt.
      logger.warn({ tool: tool.name, actionId: initial.id, errorCode, outcome, errorName: error?.name }, 'AI tool execution failed');
      await emit(ctx, 'ai.tool_failed', { entityId: initial.id, metadata: eventMetadata(initial, { errorCode, outcome }) });
      throw new ToolError('EXECUTION_FAILED', targetGone ? 'Action target is unavailable' : 'Action execution failed', {
        statusCode: targetGone ? 409 : 502, action: failed,
      });
    }
    await emit(ctx, 'ai.tool_executed', { entityId: initial.id, metadata: eventMetadata(initial, { outcome: 'succeeded', approverUserId: ctx.user.id }) });
    return { action: completed, idempotent: false };
  }

  /**
   * Reject a pending action. The requester may always withdraw their own;
   * an ADMIN may reject any in the organization.
   * @param {{ prisma: any, user: any, requestId?: string | null, ip?: string | null }} ctx
   * @param {string} actionId
   * @param {{ reason?: string, reauthenticated?: boolean }} [rejection]
   */
  async function reject(ctx, actionId, { reason = 'other', reauthenticated = false } = {}) {
    const scope = ownerWhere(ctx);
    const initial = await load(ctx, actionId, scope);
    if (initial.status !== PENDING_STATUS) {
      throw new ToolError('ACTION_UNAVAILABLE', `Action is ${String(initial.status).toLowerCase()}`, { statusCode: 409 });
    }
    const rejectedAt = now();
    const safeReason = REJECTION_REASONS.includes(reason) ? reason : 'other';
    const claim = await ctx.prisma.aiBridgeAction.updateMany({
      where: { id: initial.id, ...scope, status: PENDING_STATUS },
      data: {
        status: 'REJECTED', rejectedAt, approverId: ctx.user.id,
        approvalEvidence: {
          method: 'session_step_up', decision: 'rejected', reason: safeReason, approverRole: ctx.user.role,
          requesterApproved: ctx.user.id === initial.userId, reauthenticated: Boolean(reauthenticated),
          rejectedAt: rejectedAt.toISOString(), requestId: ctx.requestId ?? null,
        },
      },
    });
    if (claim.count !== 1) throw new ToolError('ACTION_UNAVAILABLE', 'Action is already being processed', { statusCode: 409 });
    await emit(ctx, 'ai.tool_rejected', { entityId: initial.id, metadata: eventMetadata(initial, { reason: safeReason }) });
    return { action: await load(ctx, actionId, scope) };
  }

  /** Record a refusal that happened before a tool could be looked up (session runner). */
  function recordDenial(ctx, { tool = null, reason, source = 'assistant' }) {
    return deny(ctx, new ToolError(reason, 'Tool call refused'), { tool, source });
  }

  return { invoke, approve, reject, recordDenial, registry };
}
