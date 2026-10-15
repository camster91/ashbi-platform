import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ToolError, recordNotFound } from '../ai/tools/registry.js';
import { withStageTransaction } from './task-stages.service.js';
import { recordAuditEvent } from './audit-event.service.js';
import { recordDomainEvent } from './domain-event.service.js';
import { readClientAgentProfile, authorizeClientAgentStaff } from './client-agent-profile.service.js';

const id = z.string().trim().min(1).max(100);
const intentKey = z.string().uuid().transform(value => value.toLowerCase());
export const clientAgentRunStartSchema = z.object({ question: z.string().trim().min(1).max(2000),
  idempotencyKey: intentKey }).strict();
const runSelect = { id: true, organizationId: true, conversationId: true, requestedById: true,
  prompt: true, response: true, status: true, profileRevision: true, startedAt: true, finishedAt: true,
  errorCode: true, createdAt: true, updatedAt: true };
const activeStatuses = ['QUEUED', 'RUNNING'];
const refuse = (code, message, statusCode) => { throw new ToolError(code, message, { statusCode }); };
const conflict = () => refuse('RUN_CONFLICT', 'The account manager run changed. Reload before trying again.', 409);
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) refuse('INVALID_INPUT', 'Provide valid account manager run fields.', 400);
  return result.data;
}
function project(row) {
  return { ...Object.fromEntries(Object.keys(runSelect).filter(key => key !== 'organizationId').map(key => [key, row[key]])), scope: 'SHARED_STAFF' };
}
async function scope(db, user, clientId, conversationId, requireActive) {
  const actor = await authorizeClientAgentStaff(db, user, clientId);
  const conversation = await db.clientAgentConversation.findFirst({ where: { id: conversationId, clientId, organizationId: actor.organizationId },
    select: { id: true, organizationId: true, clientId: true, archivedAt: true } });
  if (!conversation || conversation.id !== conversationId || conversation.clientId !== clientId
    || conversation.organizationId !== actor.organizationId) throw recordNotFound('Conversation not found');
  if (requireActive && conversation.archivedAt != null) refuse('CONVERSATION_ARCHIVED', 'Archived conversations cannot start new runs.', 409);
  return actor;
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

/** Producer only: inference and Redis delivery belong to the separately authorized worker. */
export function createClientAgentRunService({ recordAudit = recordAuditEvent, recordEvent = recordDomainEvent,
  readProfile = readClientAgentProfile } = {}) {
  async function audit(db, actor, clientId, row, action) {
    const event = await recordAudit(db, { organizationId: actor.organizationId, actorUserId: actor.id, actorType: 'USER',
      entityId: row.id, action, metadata: { clientId, conversationId: row.conversationId, runId: row.id } });
    if (!event) refuse('RUN_AUDIT_UNAVAILABLE', 'The run could not be saved with its audit record.', 503);
  }
  return {
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
              const row = await db.clientAgentRun.create({ data: { organizationId: actor.organizationId, conversationId,
                requestedById: actor.id, idempotencyKey, inputHash, prompt: question, status: 'QUEUED', profileRevision: profile.revision }, select: runSelect });
              if (!row || row.organizationId !== actor.organizationId || row.conversationId !== conversationId
                || row.requestedById !== actor.id || row.status !== 'QUEUED') conflict();
              const recorded = await recordEvent(db, { organizationId: actor.organizationId, type: 'client_agent.run_requested',
                aggregateId: row.id, idempotencyKey: `client-agent-run:${row.id}:requested`,
                payload: { clientId, conversationId, runId: row.id, requestedById: actor.id } });
              if (!recorded?.event?.id) refuse('RUN_EVENT_UNAVAILABLE', 'The run could not be queued durably.', 503);
              await audit(db, actor, clientId, row, 'client_agent_run.requested');
              return project(row);
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
        return project(await findRun(db, actor, conversationId, runId));
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
        return project(row);
      }));
    },
    async cancel(prisma, user, clientId, conversationId, runId) {
      clientId = parse(id, clientId); conversationId = parse(id, conversationId); runId = parse(id, runId);
      return guard(() => withStageTransaction(prisma, async db => {
        const actor = await scope(db, user, clientId, conversationId, false);
        const current = await findRun(db, actor, conversationId, runId);
        if (actor.role !== 'ADMIN' && current.requestedById !== actor.id) refuse('ROLE_DENIED', 'Only an administrator or the requester can cancel this run.', 403);
        if (current.status === 'CANCELLED') return project(current);
        if (!activeStatuses.includes(current.status)) conflict();
        const changed = await db.clientAgentRun.updateMany({ where: { id: runId, organizationId: actor.organizationId,
          conversationId, status: current.status }, data: { status: 'CANCELLED', finishedAt: new Date(), claimToken: null } });
        if (changed.count !== 1) conflict();
        const row = await findRun(db, actor, conversationId, runId);
        if (row.status !== 'CANCELLED') conflict();
        await audit(db, actor, clientId, row, 'client_agent_run.cancelled');
        // Cancellation blocks future settlement; it cannot promise a dispatched
        // provider request was stopped or that no usage was incurred.
        return project(row);
      }));
    },
  };
}
const service = createClientAgentRunService();
export const startClientAgentRun = service.start;
export const readClientAgentRun = service.read;
export const getClientAgentRunByIntent = service.byIntent;
export const cancelClientAgentRun = service.cancel;
