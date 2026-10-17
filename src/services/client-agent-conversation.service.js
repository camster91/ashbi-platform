import { authorizeSourceConversation, conversationAudience, sharedConversationWhere } from './client-agent-source-authority.service.js';
import { z } from 'zod';
import { ToolError, recordNotFound } from '../ai/tools/registry.js';
import { withStageTransaction } from './task-stages.service.js';
import { recordAuditEvent } from './audit-event.service.js';
import { authorizeClientAgentStaff as authorize } from './client-agent-profile.service.js';

const id = z.string().trim().min(1).max(100);
export const clientAgentConversationCreateSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();
export const clientAgentConversationArchiveSchema = z.object({ revision: z.number().int().min(0).max(2147483646) }).strict();
export const clientAgentConversationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25), after: id.optional(),
  includeArchived: z.union([z.boolean(), z.literal('true'), z.literal('false')]).default(false).transform(value => value === true || value === 'true'),
}).strict();
const conversationSelect = { id: true, organizationId: true, clientId: true, title: true, createdById: true,
  sourceChannelId: true, sourceBindingId: true, revision: true, archivedAt: true, createdAt: true, updatedAt: true };
const runSelect = { id: true, organizationId: true, conversationId: true, requestedById: true,
  prompt: true, response: true, status: true, profileRevision: true, startedAt: true, finishedAt: true,
  errorCode: true, contextObservedAt: true, contextSnapshot: true, memorySnapshot: true, createdAt: true, updatedAt: true,
  attentionReview: { select: { reviewedAt: true } } };
const refuse = (code, message, statusCode) => { throw new ToolError(code, message, { statusCode }); };
const conflict = () => refuse('CONVERSATION_CONFLICT', 'The conversation changed. Reload before saving.', 409);
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) refuse('INVALID_INPUT', 'Provide valid conversation fields.', 400);
  return result.data;
}
function project(row, fields) {
  return { ...Object.fromEntries(Object.keys(fields).filter(key => !['organizationId', 'attentionReview'].includes(key)).map(key => [key, row[key]])),
    ...(fields.attentionReview ? { attentionReviewedAt: row.attentionReview?.reviewedAt ?? null } : {}) };
}
async function conversation(db, actor, clientId, conversationId, includeArchived) {
  const row = await db.clientAgentConversation.findFirst({ where: { id: conversationId, clientId,
    organizationId: actor.organizationId, ...(includeArchived ? {} : { archivedAt: null }) }, select: conversationSelect });
  if (!row || row.id !== conversationId || row.organizationId !== actor.organizationId || row.clientId !== clientId
    || (!includeArchived && row.archivedAt != null)) throw recordNotFound('Conversation not found');
  await authorizeSourceConversation(db, actor, row);
  return row;
}
async function guard(work) {
  try { return await work(); } catch (error) {
    if (error instanceof ToolError) throw error;
    if (error?.code === 'P2034' || error?.statusCode === 409) conflict();
    refuse('CONVERSATION_UNAVAILABLE', 'Client conversations unavailable.', 503);
  }
}

/** All active organization staff share these conversations. Routes supply tenant-scoped Prisma. */
export function createClientAgentConversationService({ recordAudit = recordAuditEvent } = {}) {
  async function audit(db, actor, clientId, row, action) {
    const event = await recordAudit(db, { organizationId: actor.organizationId, actorUserId: actor.id,
      actorType: 'USER', entityId: row.id, action, metadata: { clientId, revision: row.revision } });
    if (!event) refuse('CONVERSATION_AUDIT_UNAVAILABLE', 'The conversation could not be saved with its audit record.', 503);
  }
  return {
    async create(prisma, user, clientId, input) {
      clientId = parse(id, clientId);
      const fields = parse(clientAgentConversationCreateSchema, input);
      return guard(() => withStageTransaction(prisma, async db => {
        const actor = await authorize(db, user, clientId);
        const row = await db.clientAgentConversation.create({ data: { ...fields, organizationId: actor.organizationId,
          clientId, createdById: actor.id, revision: 0 }, select: conversationSelect });
        if (!row || row.organizationId !== actor.organizationId || row.clientId !== clientId || row.createdById !== actor.id) throw recordNotFound('Conversation not found');
        await audit(db, actor, clientId, row, 'client_agent_conversation.created');
        return { ...project(row, conversationSelect), scope: 'SHARED_STAFF' };
      }));
    },
    async list(prisma, user, clientId, input = {}) {
      clientId = parse(id, clientId);
      const { limit, after, includeArchived } = parse(clientAgentConversationQuerySchema, input);
      return guard(() => withStageTransaction(prisma, async db => {
        const actor = await authorize(db, user, clientId);
        const rows = await db.clientAgentConversation.findMany({ where: { organizationId: actor.organizationId, clientId, ...sharedConversationWhere(),
          ...(includeArchived ? {} : { archivedAt: null }), ...(after ? { id: { gt: after } } : {}) },
        select: conversationSelect, orderBy: { id: 'asc' }, take: limit + 1 });
        const scanned = rows.slice(0, limit);
        return { scope: 'SHARED_STAFF', items: scanned.filter(row => row.organizationId === actor.organizationId
          && !row.sourceChannelId && !row.sourceBindingId && row.clientId === clientId && (includeArchived || row.archivedAt == null)).map(row => project(row, conversationSelect)),
        nextCursor: rows.length > limit ? scanned.at(-1).id : null };
      }));
    },
    async read(prisma, user, clientId, conversationId, input = {}) {
      clientId = parse(id, clientId); conversationId = parse(id, conversationId);
      const { limit, after, includeArchived } = parse(clientAgentConversationQuerySchema, input);
      return guard(() => withStageTransaction(prisma, async db => {
        const actor = await authorize(db, user, clientId);
        const row = await conversation(db, actor, clientId, conversationId, includeArchived);
        const rows = await db.clientAgentRun.findMany({ where: { organizationId: actor.organizationId, conversationId,
          ...(after ? { id: { gt: after } } : {}) }, select: runSelect, orderBy: { id: 'asc' }, take: limit + 1 });
        // The active turn may be beyond the requested transcript page. Fetch
        // it independently so polling never stops at an older history cursor.
        const activeRows = await db.clientAgentRun.findMany({ where: { organizationId: actor.organizationId, conversationId,
          status: { in: ['QUEUED', 'RUNNING'] } }, select: runSelect, orderBy: { id: 'asc' }, take: 1 });
        const active = activeRows.find(run => run.organizationId === actor.organizationId && run.conversationId === conversationId
          && ['QUEUED', 'RUNNING'].includes(run.status));
        const scanned = rows.slice(0, limit);
        return { scope: conversationAudience(row), conversation: { ...project(row, conversationSelect), scope: conversationAudience(row) },
          activeRun: active ? project(active, runSelect) : null,
          runs: scanned.filter(run => run.organizationId === actor.organizationId && run.conversationId === conversationId)
            .map(run => project(run, runSelect)), nextCursor: rows.length > limit ? scanned.at(-1).id : null };
      }));
    },
    async archive(prisma, user, clientId, conversationId, input) {
      clientId = parse(id, clientId); conversationId = parse(id, conversationId);
      const { revision } = parse(clientAgentConversationArchiveSchema, input);
      return guard(() => withStageTransaction(prisma, async db => {
        const actor = await authorize(db, user, clientId);
        const row = await conversation(db, actor, clientId, conversationId, true);
        await authorizeSourceConversation(db, actor, row, { lock: true });
        if (actor.role !== 'ADMIN' && row.createdById !== actor.id) refuse('ROLE_DENIED', 'Only an administrator or the creator can archive this conversation.', 403);
        if (row.archivedAt != null || row.revision !== revision) conflict();
        const changed = await db.clientAgentConversation.updateMany({ where: { id: conversationId, clientId,
          organizationId: actor.organizationId, revision, archivedAt: null }, data: { archivedAt: new Date(), revision: { increment: 1 } } });
        if (changed.count !== 1) conflict();
        const saved = await conversation(db, actor, clientId, conversationId, true);
        if (saved.revision !== revision + 1 || saved.archivedAt == null || saved.createdById !== row.createdById) conflict();
        await audit(db, actor, clientId, saved, 'client_agent_conversation.archived');
        return { ...project(saved, conversationSelect), scope: conversationAudience(saved) };
      }));
    },
  };
}
const service = createClientAgentConversationService();
export const createClientAgentConversation = service.create;
export const listClientAgentConversations = service.list;
export const readClientAgentConversation = service.read;
export const archiveClientAgentConversation = service.archive;
