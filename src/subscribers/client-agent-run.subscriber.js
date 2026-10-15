import { registerDomainEventSubscriber } from '../services/domain-event-dispatcher.service.js';
import { requestStorage } from '../utils/request-context.js';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const refused = () => Object.assign(new Error('Client agent event scope is invalid.'), { code: 'CLIENT_AGENT_EVENT_SCOPE_INVALID' });

/** Durable outbox delivery schedules IDs only; inference belongs to the worker. */
export function registerClientAgentRunSubscriber({ enqueue }) {
  if (typeof enqueue !== 'function') throw new Error('Client agent subscriber requires an enqueue function.');
  registerDomainEventSubscriber({
    name: 'client-agent-run-enqueue', types: ['client_agent.run_requested'],
    async handle(event, ctx) {
      const store = requestStorage.getStore();
      const payload = event?.payload;
      const fields = ['clientId', 'conversationId', 'runId', 'requestedById'];
      if (event?.type !== 'client_agent.run_requested' || !validId(event.organizationId)
        || !payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).length !== fields.length || !fields.every(key => validId(payload[key]))
        || event.aggregateId !== payload.runId || !ctx?.prisma || store?.prisma !== ctx.prisma
        || store?.organizationId !== event.organizationId) throw refused();
      const run = await ctx.prisma.clientAgentRun.findFirst({
        where: { id: payload.runId, organizationId: event.organizationId },
        select: { id: true, organizationId: true, conversationId: true, requestedById: true, status: true },
      });
      if (!run) return { skipped: 'RUN_NOT_FOUND' };
      if (run.id !== payload.runId || run.organizationId !== event.organizationId
        || run.conversationId !== payload.conversationId || run.requestedById !== payload.requestedById) throw refused();
      const conversation = await ctx.prisma.clientAgentConversation.findFirst({
        where: { id: payload.conversationId, organizationId: event.organizationId, clientId: payload.clientId },
        select: { id: true, organizationId: true, clientId: true },
      });
      if (!conversation || conversation.id !== payload.conversationId
        || conversation.organizationId !== event.organizationId || conversation.clientId !== payload.clientId) throw refused();
      if (run.status !== 'QUEUED') return { skipped: 'RUN_ALREADY_CLAIMED' };
      await enqueue('run-client-agent', { organizationId: event.organizationId, runId: payload.runId },
        { jobId: `client-agent-${payload.runId}`, attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
      return { enqueued: true };
    },
  });
}
