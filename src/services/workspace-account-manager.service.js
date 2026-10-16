import { createHash } from 'node:crypto';
import { z } from 'zod';
import { recordNotFound, ToolError } from '../ai/tools/registry.js';
import { authorizeWorkspaceChatMember } from './workspace-chat.service.js';
import { queueClientAgentRunInTransaction, cancelClientAgentRun } from './client-agent-run.service.js';
import { recordAuditEvent } from './audit-event.service.js';

const id = z.string().trim().min(1).max(100);
export const accountManagerInstallSchema = z.object({ profileId: id }).strict();
export const accountManagerUpdateSchema = z.object({ revision: z.number().int().positive().max(2147483646), enabled: z.boolean() }).strict();
export const accountManagerRequestSchema = z.object({ bindingId: id, sourceMessageId: id, idempotencyKey: z.string().uuid() }).strict();
export const accountManagerPageSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), after: id.optional() }).strict();
const conflict = () => { throw new ToolError('WORKSPACE_AGENT_CONFLICT', 'Workspace account manager request changed', { statusCode: 409 }); };
const parse = (schema, input) => { const value = schema.safeParse(input); if (!value.success) throw new ToolError('INVALID_INPUT', 'Invalid workspace account manager request', { statusCode: 400 }); return value.data; };
const deny = () => { throw recordNotFound('Workspace account manager unavailable'); };

// The channel-first row lock is shared with human membership mutations, without
// holding it over a provider call or pretending the worker is a human member.
export async function lockPilotChannel(db, organizationId, channelId) {
  const rows = await db.$queryRaw`SELECT id FROM workspace_chat_channels WHERE id = ${channelId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  if (rows.length !== 1) deny();
}
async function transaction(prisma, work) {
  return prisma.$transaction(work, { isolationLevel: 'Serializable' });
}
async function bindingScope(db, actor, channel, bindingId, active) {
  const binding = await db.workspaceAccountManagerBinding.findFirst({ where: { id: bindingId, channelId: channel.id, organizationId: actor.organizationId } });
  if (!binding || !['CLIENT', 'PROJECT'].includes(channel.kind) || !channel.clientId || binding.clientId !== channel.clientId
    || binding.projectId !== channel.projectId || binding.organizationId !== actor.organizationId || (active && !binding.enabled)) deny();
  const profile = await db.clientAgentProfile.findFirst({ where: { id: binding.profileId, organizationId: actor.organizationId, clientId: channel.clientId } });
  if (!profile || profile.id !== binding.profileId || profile.clientId !== channel.clientId || profile.organizationId !== actor.organizationId
    || (active && (!profile.enabled || !Array.isArray(profile.pluginIds) || !profile.pluginIds.includes('client-work')))) deny();
  return { binding, profile };
}
async function audit(db, actor, action, entityId, metadata) {
  const result = await recordAuditEvent(db, { organizationId: actor.organizationId, actorUserId: actor.id, actorType: 'USER', action, entityId, metadata });
  if (!result) throw new ToolError('AUDIT_UNAVAILABLE', 'Workspace account manager audit unavailable', { statusCode: 503 });
}
const bindingView = row => ({ id: row.id, channelId: row.channelId, clientId: row.clientId, projectId: row.projectId,
  profileId: row.profileId, enabled: row.enabled, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt });

async function invocationView(db, row) {
  const run = await db.clientAgentRun.findFirst({ where: { id: row.runId, organizationId: row.organizationId, conversationId: row.conversationId } });
  if (!run || run.requestedById !== row.requestedById) deny();
  return { id: row.id, kind: 'ACCOUNT_MANAGER_DRAFT', scope: 'WORKSPACE_CHANNEL', bindingId: row.bindingId,
    sourceMessageId: row.sourceMessageId, requestedById: row.requestedById, conversationId: row.conversationId, runId: row.runId,
    status: run.status, deliveryState: row.deliveryState, deliveryCode: row.deliveryCode,
    response: row.deliveryState === 'DELIVERED' && run.status === 'SUCCEEDED' ? run.response : null,
    createdAt: row.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt, deliveredAt: row.deliveredAt, suppressedAt: row.suppressedAt,
    errorCode: run.errorCode, profileRevision: row.profileRevision, bindingRevision: row.bindingRevision };
}
async function channelScope(db, user, channelId) {
  await lockPilotChannel(db, user.organizationId, channelId);
  return authorizeWorkspaceChatMember(db, user, channelId);
}
async function ownInvocation(db, actor, channel, invocationId) {
  const row = await db.workspaceAccountManagerInvocation.findFirst({ where: { id: invocationId, organizationId: actor.organizationId,
    binding: { channelId: channel.id, clientId: channel.clientId } } });
  if (!row) deny();
  await bindingScope(db, actor, channel, row.bindingId, false);
  return row;
}

export async function readWorkspaceAccountManager(prisma, user, channelId) {
  const { db, actor, channel } = await authorizeWorkspaceChatMember(prisma, user, channelId);
  const row = await db.workspaceAccountManagerBinding.findFirst({ where: { organizationId: actor.organizationId, channelId } });
  if (!row) return { binding: null };
  await bindingScope(db, actor, channel, row.id, false);
  return { binding: bindingView(row) };
}
export async function installWorkspaceAccountManager(prisma, user, channelId, input) {
  const fields = parse(accountManagerInstallSchema, input);
  return transaction(prisma, async db => {
    const { actor, channel } = await channelScope(db, user, channelId);
    if (actor.role !== 'ADMIN') deny();
    if (!['CLIENT', 'PROJECT'].includes(channel.kind) || !channel.clientId) deny();
    const profile = await db.clientAgentProfile.findFirst({ where: { id: fields.profileId, clientId: channel.clientId, organizationId: actor.organizationId } });
    if (!profile || profile.id !== fields.profileId || profile.clientId !== channel.clientId || profile.organizationId !== actor.organizationId) deny();
    const existing = await db.workspaceAccountManagerBinding.findFirst({ where: { organizationId: actor.organizationId, channelId } });
    if (existing) { if (existing.profileId !== profile.id) conflict();await bindingScope(db, actor, channel, existing.id, false);return { binding: bindingView(existing) }; }
    const row = await db.workspaceAccountManagerBinding.create({ data: { organizationId: actor.organizationId, channelId,
      clientId: channel.clientId, projectId: channel.projectId, profileId: profile.id, createdById: actor.id, updatedById: actor.id, enabled: false, revision: 1 } });
    await audit(db, actor, 'workspace_agent.installed', row.id, { channelId, clientId: channel.clientId, profileId: profile.id });
    return { binding: bindingView(row) };
  });
}
export async function updateWorkspaceAccountManager(prisma, user, channelId, bindingId, input) {
  const fields = parse(accountManagerUpdateSchema, input);
  return transaction(prisma, async db => {
    const { actor, channel } = await channelScope(db, user, channelId);
    if (actor.role !== 'ADMIN') deny();
    const { binding, profile } = await bindingScope(db, actor, channel, bindingId, false);
    if (fields.enabled && (!profile.enabled || !Array.isArray(profile.pluginIds) || !profile.pluginIds.includes('client-work'))) deny();
    if (binding.revision !== fields.revision) conflict();
    const changed = await db.workspaceAccountManagerBinding.updateMany({ where: { id: bindingId, organizationId: actor.organizationId, revision: fields.revision },
      data: { enabled: fields.enabled, revision: { increment: 1 }, updatedById: actor.id } });
    if (changed.count !== 1) conflict();
    await audit(db, actor, 'workspace_agent.updated', bindingId, { channelId, enabled: fields.enabled });
    const current = await bindingScope(db, actor, channel, bindingId, false);
    return { binding: bindingView(current.binding) };
  });
}
export async function requestWorkspaceAccountManager(prisma, user, channelId, input) {
  const fields = parse(accountManagerRequestSchema, input);
  return transaction(prisma, async db => {
    const { actor, channel } = await channelScope(db, user, channelId);
    const { binding, profile } = await bindingScope(db, actor, channel, fields.bindingId, true);
    const source = await db.workspaceChatMessage.findFirst({ where: { id: fields.sourceMessageId, channelId, organizationId: actor.organizationId,
      author: { isActive: true, role: { in: ['ADMIN', 'TEAM'] }, organizationId: actor.organizationId } } });
    if (!source || source.channelId !== channelId || source.organizationId !== actor.organizationId) deny();
    const question = parse(z.string().trim().min(1).max(2000), source.content);
    const inputHash = createHash('sha256').update(JSON.stringify({ channelId, bindingId: binding.id, sourceMessageId: source.id, requestedById: actor.id, question })).digest('hex');
    const existing = await db.workspaceAccountManagerInvocation.findFirst({ where: { organizationId: actor.organizationId,
      OR: [{ sourceMessageId: source.id, bindingId: binding.id }, { requestedById: actor.id, idempotencyKey: fields.idempotencyKey }] } });
    if (existing) {
      if (existing.inputHash !== inputHash || existing.requestedById !== actor.id || existing.bindingId !== binding.id || existing.sourceMessageId !== source.id) conflict();
      return { invocation: await invocationView(db, existing), idempotent: true };
    }
    const conversation = await db.clientAgentConversation.create({ data: { organizationId: actor.organizationId, clientId: channel.clientId,
      title: 'Workspace account manager request', createdById: actor.id, sourceChannelId: channelId, sourceBindingId: binding.id } });
    const run = await queueClientAgentRunInTransaction(db, actor, channel.clientId, conversation.id,
      { question, idempotencyKey: fields.idempotencyKey, inputHash, profileRevision: profile.revision });
    const row = await db.workspaceAccountManagerInvocation.create({ data: { organizationId: actor.organizationId, bindingId: binding.id,
      sourceMessageId: source.id, requestedById: actor.id, conversationId: conversation.id, runId: run.id,
      idempotencyKey: fields.idempotencyKey, inputHash, bindingRevision: binding.revision, profileRevision: profile.revision } });
    await audit(db, actor, 'workspace_agent.requested', row.id, { channelId, sourceMessageId: source.id, runId: run.id });
    return { invocation: await invocationView(db, row), idempotent: false };
  });
}
export async function listWorkspaceAccountManagerInvocations(prisma, user, channelId, input = {}) {
  const { limit, after } = parse(accountManagerPageSchema, input);
  const { db, actor, channel } = await authorizeWorkspaceChatMember(prisma, user, channelId);
  if (after) await ownInvocation(db, actor, channel, after);
  const rows = await db.workspaceAccountManagerInvocation.findMany({ where: { organizationId: actor.organizationId, binding: { channelId, clientId: channel.clientId },
    ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1 });
  const page = rows.slice(0, limit), items = [];
  for (const row of page) { await bindingScope(db, actor, channel, row.bindingId, false);items.push(await invocationView(db, row)); }
  return { scope: 'WORKSPACE_CHANNEL', items, nextCursor: rows.length > limit ? page.at(-1).id : null };
}
export async function readWorkspaceAccountManagerInvocation(prisma, user, channelId, invocationId) {
  const { db, actor, channel } = await authorizeWorkspaceChatMember(prisma, user, channelId);
  return { invocation: await invocationView(db, await ownInvocation(db, actor, channel, invocationId)) };
}
export async function getWorkspaceAccountManagerByIntent(prisma, user, channelId, key) {
  key = parse(z.string().uuid(), key);
  const { db, actor, channel } = await authorizeWorkspaceChatMember(prisma, user, channelId);
  const row = await db.workspaceAccountManagerInvocation.findFirst({ where: { organizationId: actor.organizationId,
    requestedById: actor.id, idempotencyKey: key, binding: { channelId, clientId: channel.clientId } } });
  if (!row) deny();
  return { invocation: await invocationView(db, await ownInvocation(db, actor, channel, row.id)) };
}
export async function cancelWorkspaceAccountManagerInvocation(prisma, user, channelId, invocationId) {
  const { db, actor, channel } = await authorizeWorkspaceChatMember(prisma, user, channelId);
  const row = await ownInvocation(db, actor, channel, invocationId);
  // Existing cancellation repeats fresh source authorization under its own
  // Serializable channel-first transaction and suppresses the pending card.
  await cancelClientAgentRun(prisma, actor, channel.clientId, row.conversationId, row.runId);
  return readWorkspaceAccountManagerInvocation(prisma, user, channelId, invocationId);
}

/** Worker-only authority: current channel membership, frozen installation/profile
 * and exact immutable human source. Call under the channel lock before dispatch
 * and again before publishing a successful run/typed card. */
export async function authorizeWorkspaceAgentRun(db, run, conversation) {
  const currentConversation = await db.clientAgentConversation.findFirst({ where: { id: conversation.id, organizationId: run.organizationId,
    sourceChannelId: conversation.sourceChannelId, sourceBindingId: conversation.sourceBindingId, archivedAt: null } });
  if (!currentConversation || currentConversation.archivedAt != null || currentConversation.clientId !== conversation.clientId) deny();
  const actor = await db.user.findFirst({ where: { id: run.requestedById, organizationId: run.organizationId, isActive: true } });
  if (!actor) deny();
  const { channel } = await authorizeWorkspaceChatMember(db, actor, conversation.sourceChannelId);
  const row = await db.workspaceAccountManagerInvocation.findFirst({ where: { runId: run.id, organizationId: run.organizationId, conversationId: conversation.id } });
  if (!row || row.requestedById !== actor.id || row.bindingId !== conversation.sourceBindingId || row.deliveryState !== 'PENDING'
    || conversation.organizationId !== run.organizationId || conversation.clientId !== channel.clientId
    || row.profileRevision !== run.profileRevision || row.inputHash !== run.inputHash || row.idempotencyKey !== run.idempotencyKey) deny();
  const { binding, profile } = await bindingScope(db, actor, channel, row.bindingId, true);
  const source = await db.workspaceChatMessage.findFirst({ where: { id: row.sourceMessageId, channelId: channel.id, organizationId: actor.organizationId,
    author: { isActive: true, role: { in: ['ADMIN', 'TEAM'] }, organizationId: actor.organizationId } } });
  if (!source || source.content.trim() !== run.prompt || profile.revision !== row.profileRevision || binding.revision !== row.bindingRevision) deny();
  return { actor, channel, binding, profile, invocation: row };
}


export async function settleWorkspaceAgentRun(prisma, run, conversation, { claimToken, deadlineAt, status, fields = {}, at }) {
  return transaction(prisma, async db => {
    await lockPilotChannel(db, run.organizationId, conversation.sourceChannelId);
    let deliveryState = 'SUPPRESSED', deliveryCode = fields.errorCode ?? status;
    if (+at >= +new Date(deadlineAt)) { status = 'UNKNOWN'; fields = { errorCode: 'RUN_DEADLINE_EXCEEDED' }; deliveryCode = fields.errorCode; }
    if (status === 'SUCCEEDED') {
      try { await authorizeWorkspaceAgentRun(db, run, conversation); deliveryState = 'DELIVERED'; deliveryCode = null; }
      catch (error) { if (!(error instanceof ToolError)) throw error; status = 'FAILED'; fields = { errorCode: 'SOURCE_DELIVERY_SUPPRESSED' }; deliveryCode = fields.errorCode; }
    }
    const changed = await db.clientAgentRun.updateMany({ where: { id: run.id, organizationId: run.organizationId, status: 'RUNNING', claimToken },
      data: { status, ...fields, finishedAt: at } });
    if (changed.count === 1) {
      const delivered = await db.workspaceAccountManagerInvocation.updateMany({ where: { runId: run.id, organizationId: run.organizationId, conversationId: conversation.id, deliveryState: 'PENDING' },
        data: { deliveryState, deliveryCode, ...(deliveryState === 'DELIVERED' ? { deliveredAt: at } : { suppressedAt: at }) } });
      if (delivered.count !== 1) conflict();
      const recorded = await recordAuditEvent(db, { organizationId: run.organizationId, actorType: 'SYSTEM',
        action: deliveryState === 'DELIVERED' ? 'workspace_agent.delivered' : 'workspace_agent.suppressed', entityId: run.id,
        metadata: { channelId: conversation.sourceChannelId, runId: run.id, status } });
      if (!recorded) throw new ToolError('AUDIT_UNAVAILABLE', 'Workspace delivery audit unavailable', { statusCode: 503 });
    }
    const current = await db.clientAgentRun.findFirst({ where: { id: run.id, organizationId: run.organizationId } });
    return { runId: run.id, status: current?.status ?? 'NOT_FOUND' };
  });
}

export async function claimWorkspaceAgentRun(prisma, run, conversation, { claimToken, startedAt, deadlineAt }) {
  return transaction(prisma, async db => {
    await lockPilotChannel(db, run.organizationId, conversation.sourceChannelId);
    try { await authorizeWorkspaceAgentRun(db, run, conversation); }
    catch (error) {
      if (!(error instanceof ToolError)) throw error;
      const changed = await db.clientAgentRun.updateMany({ where: { id: run.id, organizationId: run.organizationId, status: 'QUEUED' },
        data: { status: 'FAILED', errorCode: 'SOURCE_AUTHORITY_REVOKED', finishedAt: startedAt } });
      if (changed.count === 1) {
        const suppressed = await db.workspaceAccountManagerInvocation.updateMany({ where: { runId: run.id, organizationId: run.organizationId, deliveryState: 'PENDING' },
        data: { deliveryState: 'SUPPRESSED', deliveryCode: 'SOURCE_AUTHORITY_REVOKED', suppressedAt: startedAt } });
        if (suppressed.count !== 1) conflict();
        const recorded = await recordAuditEvent(db, { organizationId: run.organizationId, actorType: 'SYSTEM', action: 'workspace_agent.suppressed', entityId: run.id, metadata: { channelId: conversation.sourceChannelId, runId: run.id, status: 'FAILED' } });
        if (!recorded) throw new ToolError('AUDIT_UNAVAILABLE', 'Workspace delivery audit unavailable', { statusCode: 503 });
      }
      return { count: 0 };
    }
    return db.clientAgentRun.updateMany({ where: { id: run.id, organizationId: run.organizationId, status: 'QUEUED' },
      data: { status: 'RUNNING', claimToken, startedAt, deadlineAt, errorCode: null } });
  });
}


/** Bounded recovery never dispatches inference or retries a claimed run. */
export async function expireWorkspaceAgentRuns(prisma, organizationId, at, queueCutoff) {
  const rows = await prisma.clientAgentRun.findMany({ where: { organizationId,
    conversation: { sourceChannelId: { not: null } }, OR: [
      { status: 'RUNNING', deadlineAt: { lte: at } }, { status: 'QUEUED', createdAt: { lte: queueCutoff } },
    ] }, orderBy: { id: 'asc' }, take: 100 });
  let expired = 0, queueExpired = 0;
  for (const run of rows) await transaction(prisma, async db => {
    const conversation = await db.clientAgentConversation.findFirst({ where: { id: run.conversationId, organizationId } });
    if (!conversation?.sourceChannelId) return;
    await lockPilotChannel(db, organizationId, conversation.sourceChannelId);
    const running = run.status === 'RUNNING';
    const status = running ? 'UNKNOWN' : 'FAILED';
    const code = running ? 'RUN_DEADLINE_EXCEEDED' : 'RUN_QUEUE_EXPIRED';
    const changed = await db.clientAgentRun.updateMany({ where: { id: run.id, organizationId, status: run.status,
      ...(running ? { claimToken: run.claimToken, deadlineAt: { lte: at } } : { createdAt: { lte: queueCutoff } }) },
    data: { status, errorCode: code, finishedAt: at } });
    if (changed.count !== 1) return;
    const suppressed = await db.workspaceAccountManagerInvocation.updateMany({ where: { runId: run.id, organizationId, deliveryState: 'PENDING' },
      data: { deliveryState: 'SUPPRESSED', deliveryCode: code, suppressedAt: at } });
    if (suppressed.count !== 1) conflict();
    const recorded = await recordAuditEvent(db, { organizationId, actorType: 'SYSTEM', action: 'workspace_agent.suppressed', entityId: run.id,
      metadata: { channelId: conversation.sourceChannelId, runId: run.id, status } });
    if (!recorded) throw new ToolError('AUDIT_UNAVAILABLE', 'Workspace delivery audit unavailable', { statusCode: 503 });
    if (running) expired++;else queueExpired++;
  });
  return { expired, queueExpired };
}
