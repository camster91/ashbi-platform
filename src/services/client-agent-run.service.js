import { authorizeSourceConversation, conversationAudience } from './client-agent-source-authority.service.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ToolError, recordNotFound } from '../ai/tools/registry.js';
import { withStageTransaction } from './task-stages.service.js';
import { recordAuditEvent } from './audit-event.service.js';
import { recordDomainEvent } from './domain-event.service.js';
import { readClientAgentProfile, authorizeClientAgentStaff } from './client-agent-profile.service.js';
import prismaPkg from '@prisma/client';

const id = z.string().trim().min(1).max(100);
const intentKey = z.string().uuid().transform(value => value.toLowerCase());
export const clientAgentRunStartSchema = z.object({ question: z.string().trim().min(1).max(2000),
  idempotencyKey: intentKey }).strict();
const runSelect = { id: true, organizationId: true, conversationId: true, requestedById: true,
  prompt: true, response: true, status: true, profileRevision: true, startedAt: true, finishedAt: true,
  errorCode: true, contextObservedAt: true, contextSnapshot: true, memorySnapshot: true, createdAt: true, updatedAt: true,
  attentionReview: { select: { reviewedAt: true } } };
const activeStatuses = ['QUEUED', 'RUNNING'];
const refuse = (code, message, statusCode) => { throw new ToolError(code, message, { statusCode }); };
const conflict = () => refuse('RUN_CONFLICT', 'The account manager run changed. Reload before trying again.', 409);
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) refuse('INVALID_INPUT', 'Provide valid account manager run fields.', 400);
  return result.data;
}
function project(row, scope = 'SHARED_STAFF') {
  return { ...Object.fromEntries(Object.keys(runSelect).filter(key => !['organizationId', 'attentionReview'].includes(key)).map(key => [key, row[key]])),
    attentionReviewedAt: row.attentionReview?.reviewedAt ?? null, scope };
}

/** Own attention only; authorize and filter before the sentinel LIMIT, never scan private prompts. */
export async function listClientAgentRunAttentionForQueue(prisma, user, { clientId, projectId, limit = 101 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 101) refuse('INVALID_INPUT', 'Invalid attention limit.', 400);
  for (const value of [clientId, projectId]) if (value !== undefined) parse(id, value);
  if (!user?.id || !user.organizationId || !['ADMIN', 'TEAM'].includes(user.role)) refuse('ROLE_DENIED', 'Active staff access required.', 403);
  const actor = await prisma.user.findFirst({ where: { id: user.id, organizationId: user.organizationId, isActive: true },
    select: { id: true, organizationId: true, role: true, name: true, isActive: true } });
  if (!actor || actor.id !== user.id || actor.organizationId !== user.organizationId || !actor.isActive || !['ADMIN', 'TEAM'].includes(actor.role)) {
    refuse('ROLE_DENIED', 'Active staff access required.', 403);
  }
  const args = JSON.stringify({ organizationId: actor.organizationId, actorId: actor.id, clientId, projectId });
  const items = await prisma.$queryRaw(prismaPkg.Prisma.sql`
    WITH args AS (SELECT ${args}::jsonb AS x)
    SELECT r.id, r."conversationId", r."requestedById", r.status, r."createdAt", r."finishedAt",
      c.id AS "clientId", c.name AS "clientName", p.id AS "projectId", p.name AS "projectName"
    FROM client_agent_runs r
    JOIN client_agent_conversations cv ON cv.id=r."conversationId" AND cv."organizationId"=r."organizationId"
    JOIN clients c ON c.id=cv."clientId" AND c."organizationId"=r."organizationId" AND c."deletedAt" IS NULL
    JOIN users u ON u.id=r."requestedById" AND u."organizationId"=r."organizationId" AND u."isActive" AND u.role IN ('ADMIN','TEAM')
    LEFT JOIN client_agent_run_reviews review ON review."runId"=r.id AND review."organizationId"=r."organizationId"
    LEFT JOIN workspace_chat_channels ch ON ch.id=cv."sourceChannelId" AND ch."organizationId"=r."organizationId"
    LEFT JOIN workspace_account_manager_bindings b ON b.id=cv."sourceBindingId" AND b."organizationId"=r."organizationId"
    LEFT JOIN workspace_chat_members cm ON cm."channelId"=ch.id AND cm."organizationId"=r."organizationId" AND cm."userId"=u.id AND cm."leftAt" IS NULL
    LEFT JOIN projects p ON p.id=ch."projectId" AND p."organizationId"=r."organizationId" AND p."clientId"=c.id AND p."deletedAt" IS NULL
    CROSS JOIN args
    WHERE r."organizationId"=args.x->>'organizationId' AND r."requestedById"=args.x->>'actorId'
      AND r.status IN ('FAILED','UNKNOWN') AND review."runId" IS NULL AND cv."archivedAt" IS NULL
      AND ((cv."sourceChannelId" IS NULL AND cv."sourceBindingId" IS NULL)
        OR (ch.id IS NOT NULL AND b.id IS NOT NULL AND cm."userId" IS NOT NULL AND ch."archivedAt" IS NULL
          AND ch.kind IN ('CLIENT','PROJECT') AND ch."clientId"=c.id AND b."clientId"=c.id AND b."channelId"=ch.id
          AND b."projectId" IS NOT DISTINCT FROM ch."projectId" AND (ch."projectId" IS NULL OR p.id IS NOT NULL)))
      AND (args.x->>'clientId' IS NULL OR c.id=args.x->>'clientId')
      AND (args.x->>'projectId' IS NULL OR p.id=args.x->>'projectId')
    ORDER BY r.id ASC LIMIT ${limit}`);
  return { items, actor };
}
async function scope(db, user, clientId, conversationId, requireActive, lockSource = false) {
  const actor = await authorizeClientAgentStaff(db, user, clientId);
  const conversation = await db.clientAgentConversation.findFirst({ where: { id: conversationId, clientId, organizationId: actor.organizationId },
    select: { id: true, organizationId: true, clientId: true, archivedAt: true, sourceChannelId: true, sourceBindingId: true } });
  if (!conversation || conversation.id !== conversationId || conversation.clientId !== clientId
    || conversation.organizationId !== actor.organizationId) throw recordNotFound('Conversation not found');
  await authorizeSourceConversation(db, actor, conversation, { lock: lockSource });
  if (requireActive && conversation.sourceChannelId) throw recordNotFound('Use the source-bound workspace request');
  if (requireActive && conversation.archivedAt != null) refuse('CONVERSATION_ARCHIVED', 'Archived conversations cannot start new runs.', 409);
  return { ...actor, conversationScope: conversationAudience(conversation) };
}
async function findRun(db, actor, conversationId, runId) {
  const row = await db.clientAgentRun.findFirst({ where: { id: runId, organizationId: actor.organizationId, conversationId }, select: runSelect });
  if (!row || row.id !== runId || row.organizationId !== actor.organizationId || row.conversationId !== conversationId) throw recordNotFound('Run not found');
  return row;
}
async function guard(work) {
  try { return await work(); } catch (error) {
    if (error instanceof ToolError) throw error;
    if (error?.code === 'P2002' || error?.code === 'P2034' || error?.statusCode === 409) conflict();
    refuse('RUN_UNAVAILABLE', 'Account manager runs unavailable.', 503);
  }
}

// The caller must supply its authorized Serializable business transaction.
export async function queueClientAgentRunInTransaction(db, actor, clientId, conversationId,
  { question, idempotencyKey, inputHash, profileRevision }, { recordAudit = recordAuditEvent, recordEvent = recordDomainEvent } = {}) {
  const row = await db.clientAgentRun.create({ data: { organizationId: actor.organizationId, conversationId,
    requestedById: actor.id, idempotencyKey, inputHash, prompt: question, status: 'QUEUED', profileRevision: profileRevision }, select: runSelect });
  if (!row || row.organizationId !== actor.organizationId || row.conversationId !== conversationId
    || row.requestedById !== actor.id || row.status !== 'QUEUED') conflict();
  const recorded = await recordEvent(db, { organizationId: actor.organizationId, type: 'client_agent.run_requested',
    aggregateId: row.id, idempotencyKey: `client-agent-run:${row.id}:requested`,
    payload: { clientId, conversationId, runId: row.id, requestedById: actor.id } });
  if (!recorded?.event?.id) refuse('RUN_EVENT_UNAVAILABLE', 'The run could not be queued durably.', 503);
  const audited = await recordAudit(db, { organizationId: actor.organizationId, actorUserId: actor.id, actorType: 'USER',
    entityId: row.id, action: 'client_agent_run.requested', metadata: { clientId, conversationId, runId: row.id } });
  if (!audited) refuse('RUN_AUDIT_UNAVAILABLE', 'Run audit unavailable.', 503);
  return row;
}

/** Producer only: inference and Redis delivery belong to the separately authorized worker. */
export function createClientAgentRunService({ recordAudit = recordAuditEvent, recordEvent = recordDomainEvent,
  readProfile = readClientAgentProfile } = {}) {
  async function audit(db, actor, clientId, row, action) {
    const event = await recordAudit(db, { organizationId: actor.organizationId, actorUserId: actor.id, actorType: 'USER',
      entityId: row.id, action, metadata: { clientId, conversationId: row.conversationId, runId: row.id } });
    if (!event) refuse('RUN_AUDIT_UNAVAILABLE', 'The run could not be saved with its audit record.', 503);
  }
  return {
    async review(prisma, user, clientId, conversationId, runId) {
      clientId = parse(id, clientId); conversationId = parse(id, conversationId); runId = parse(id, runId);
      return guard(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await prisma.$transaction(async db => {
              const actor = await scope(db, user, clientId, conversationId, false, true);
              const current = await findRun(db, actor, conversationId, runId);
              // Admins cannot acknowledge a teammate's personal attention.
              if (current.requestedById !== actor.id) throw recordNotFound('Run not found');
              if (!['FAILED', 'UNKNOWN'].includes(current.status)) refuse('RUN_NOT_REVIEWABLE', 'Only failed or uncertain runs can be marked reviewed.', 409);
              if (current.attentionReview) return project(current, actor.conversationScope);
              // Terminal run rows are immutable. The separate source record
              // acknowledges attention without editing outcome, output or cost.
              const attentionReview = await db.clientAgentRunReview.create({ data: { runId, organizationId: actor.organizationId } });
              await audit(db, actor, clientId, current, 'client_agent_run.reviewed');
              return project({ ...current, attentionReview }, actor.conversationScope);
            }, { isolationLevel: 'Serializable' });
          } catch (error) {
            if (['P2002', 'P2034'].includes(error?.code) && attempt < 2) continue;
            throw error;
          }
        }
        conflict();
      });
    },
    async start(prisma, user, clientId, conversationId, input) {
      clientId = parse(id, clientId); conversationId = parse(id, conversationId);
      const { question, idempotencyKey } = parse(clientAgentRunStartSchema, input);
      const inputHash = createHash('sha256').update(JSON.stringify({ clientId, conversationId, question })).digest('hex');
      return guard(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            return await withStageTransaction(prisma, async db => {
              const actor = await scope(db, user, clientId, conversationId, true);
              const existing = await db.clientAgentRun.findFirst({ where: { organizationId: actor.organizationId,
                requestedById: actor.id, idempotencyKey }, select: { ...runSelect, inputHash: true, idempotencyKey: true } });
              if (existing) {
                if (existing.organizationId !== actor.organizationId || existing.requestedById !== actor.id
                  || existing.conversationId !== conversationId || existing.inputHash !== inputHash || existing.idempotencyKey !== idempotencyKey) {
                  refuse('RUN_IDEMPOTENCY_CONFLICT', 'This request key was already used for a different question.', 409);
                }
                return project(existing);
              }
              const profile = await readProfile(db, actor, clientId);
              if (!profile || profile.clientId !== clientId || !profile.enabled || !profile.pluginIds?.includes('client-work')) {
                refuse('AGENT_DISABLED', 'Enable the client work account manager before starting a run.', 409);
              }
              const pending = await db.clientAgentRun.findFirst({ where: { organizationId: actor.organizationId, conversationId,
                status: { in: activeStatuses } }, select: { id: true } });
              if (pending) refuse('RUN_IN_PROGRESS', 'Wait for the current account manager run to finish or cancel it.', 409);
              const row = await queueClientAgentRunInTransaction(db, actor, clientId, conversationId,
                { question, idempotencyKey, inputHash, profileRevision: profile.revision }, { recordAudit, recordEvent });
              return project(row, actor.conversationScope);
            });
          } catch (error) {
            // A concurrent same-key writer may have committed. Re-enter a fresh
            // transaction once to return that fact, never retry inference here.
            if (error?.code === 'P2002' && attempt === 0) continue;
            throw error;
          }
        }
        conflict();
      });
    },
    async read(prisma, user, clientId, conversationId, runId) {
      clientId = parse(id, clientId); conversationId = parse(id, conversationId); runId = parse(id, runId);
      return guard(() => withStageTransaction(prisma, async db => {
        const actor = await scope(db, user, clientId, conversationId, false);
        return project(await findRun(db, actor, conversationId, runId), actor.conversationScope);
      }));
    },
    async byIntent(prisma, user, clientId, conversationId, idempotencyKey) {
      clientId = parse(id, clientId); conversationId = parse(id, conversationId); idempotencyKey = parse(intentKey, idempotencyKey);
      return guard(() => withStageTransaction(prisma, async db => {
        const actor = await scope(db, user, clientId, conversationId, false);
        const row = await db.clientAgentRun.findFirst({ where: { organizationId: actor.organizationId,
          requestedById: actor.id, conversationId, idempotencyKey }, select: { ...runSelect, idempotencyKey: true } });
        if (!row || row.organizationId !== actor.organizationId || row.requestedById !== actor.id
          || row.conversationId !== conversationId || row.idempotencyKey !== idempotencyKey) throw recordNotFound('Run not found');
        // Absence is a snapshot, never proof that a delayed producer cannot commit.
        return project(row, actor.conversationScope);
      }));
    },
    async cancel(prisma, user, clientId, conversationId, runId) {
      clientId = parse(id, clientId); conversationId = parse(id, conversationId); runId = parse(id, runId);
      return guard(() => withStageTransaction(prisma, async db => {
        const actor = await scope(db, user, clientId, conversationId, false, true);
        const current = await findRun(db, actor, conversationId, runId);
        if (actor.role !== 'ADMIN' && current.requestedById !== actor.id) refuse('ROLE_DENIED', 'Only an administrator or the requester can cancel this run.', 403);
        if (current.status === 'CANCELLED') return project(current, actor.conversationScope);
        if (!activeStatuses.includes(current.status)) conflict();
        const changed = await db.clientAgentRun.updateMany({ where: { id: runId, organizationId: actor.organizationId,
          conversationId, status: current.status }, data: { status: 'CANCELLED', finishedAt: new Date(), claimToken: null } });
        if (changed.count !== 1) conflict();
        const row = await findRun(db, actor, conversationId, runId);
        if (row.status !== 'CANCELLED') conflict();
        if (actor.conversationScope === 'WORKSPACE_CHANNEL') await db.workspaceAccountManagerInvocation.updateMany({ where: { runId, organizationId: actor.organizationId, deliveryState: 'PENDING' }, data: { deliveryState: 'SUPPRESSED', deliveryCode: 'RUN_CANCELLED', suppressedAt: new Date() } });
        await audit(db, actor, clientId, row, 'client_agent_run.cancelled');
        // Cancellation blocks future settlement; it cannot promise a dispatched
        // provider request was stopped or that no usage was incurred.
        return project(row, actor.conversationScope);
      }));
    },
  };
}
const service = createClientAgentRunService();
export const startClientAgentRun = service.start;
export const readClientAgentRun = service.read;
export const getClientAgentRunByIntent = service.byIntent;
export const cancelClientAgentRun = service.cancel;
export const reviewClientAgentRun = service.review;
