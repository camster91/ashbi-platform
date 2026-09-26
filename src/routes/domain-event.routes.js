// Domain event outbox — admin inspection and dead-letter replay (#412,
// docs/event-outbox.md).
//
// Reads and the replay run through the request-scoped Prisma client, which
// pins them to the caller's organization and only lets the replay touch
// dispatch bookkeeping columns (the envelope is immutable in the database).
// There is no route that creates, edits or deletes an event: events are
// written only by recordDomainEvent inside business transactions.
import { z } from 'zod';
import { validateBody, validateQuery } from '../validators/schemas.js';
import { clampTake } from '../utils/query-limits.js';
import { requireRecentAuth } from '../auth/reauth.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { DOMAIN_EVENT_AGGREGATE_TYPES, DOMAIN_EVENT_TYPES } from '../services/domain-event-catalog.js';
import {
  DOMAIN_EVENT_STATUSES,
  MAX_REPLAY_BATCH,
  MAX_REPLAYS_PER_EVENT,
  replayDeadDomainEvents,
} from '../services/domain-event-dispatcher.service.js';

export const DOMAIN_EVENT_DEFAULT_LIMIT = 50;
export const DOMAIN_EVENT_MAX_LIMIT = 100;

const shortId = z.string().trim().min(1).max(191);
const asEnum = (values) => z.enum(/** @type {[string, ...string[]]} */ ([...values]));

export const domainEventQuerySchema = z.object({
  status: asEnum(DOMAIN_EVENT_STATUSES).optional(),
  type: asEnum(DOMAIN_EVENT_TYPES).optional(),
  aggregateType: asEnum(DOMAIN_EVENT_AGGREGATE_TYPES).optional(),
  aggregateId: shortId.optional(),
  correlationId: shortId.optional(),
  cursor: z.string().trim().max(400).optional(),
  limit: z.string().trim().max(6).optional(),
}).strict();

export const domainEventReplaySchema = z.object({
  eventIds: z.array(shortId).min(1).max(MAX_REPLAY_BATCH),
}).strict();

/** Opaque keyset cursor over (occurredAt DESC, id DESC). */
export function encodeDomainEventCursor(event) {
  return Buffer.from(`${new Date(event.occurredAt).toISOString()}|${event.id}`, 'utf8').toString('base64url');
}

export function decodeDomainEventCursor(cursor) {
  try {
    const [occurredAt, id, extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const date = new Date(occurredAt);
    if (extra !== undefined || !id || Number.isNaN(date.getTime())) return null;
    return { occurredAt: date, id };
  } catch {
    return null;
  }
}

const EVENT_SELECT = Object.freeze({
  id: true,
  type: true,
  schemaVersion: true,
  aggregateType: true,
  aggregateId: true,
  sequence: true,
  payload: true,
  correlationId: true,
  causationId: true,
  occurredAt: true,
  status: true,
  attempts: true,
  nextAttemptAt: true,
  lastAttemptAt: true,
  publishedAt: true,
  lastError: true,
  replayCount: true,
});

export default async function domainEventRoutes(fastify) {
  fastify.get('/', {
    onRequest: [fastify.adminOnly],
    preHandler: [validateQuery(domainEventQuerySchema)],
  }, async (request, reply) => {
    const query = request.query;
    const cursor = query.cursor ? decodeDomainEventCursor(query.cursor) : null;
    if (query.cursor && !cursor) return reply.status(400).send({ error: 'Invalid cursor' });

    /** @type {any[]} */
    const and = [];
    for (const field of ['status', 'type', 'aggregateType', 'aggregateId', 'correlationId']) {
      if (query[field]) and.push({ [field]: query[field] });
    }
    if (cursor) {
      and.push({
        OR: [
          { occurredAt: { lt: cursor.occurredAt } },
          { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
        ],
      });
    }
    const limit = clampTake(query.limit, { defaultTake: DOMAIN_EVENT_DEFAULT_LIMIT, maxTake: DOMAIN_EVENT_MAX_LIMIT });
    const rows = await request.prisma.domainEvent.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: EVENT_SELECT,
    });
    const events = rows.slice(0, limit);
    return {
      events,
      nextCursor: rows.length > limit ? encodeDomainEventCursor(events[events.length - 1]) : null,
      limit,
    };
  });

  // Requeue dead-lettered events. Admin only, with step-up re-authentication;
  // each requeued event writes a domain_event.replayed audit event.
  fastify.post('/replay', {
    onRequest: [fastify.adminOnly],
    preHandler: [requireRecentAuth, validateBody(domainEventReplaySchema)],
  }, async (request) => {
    const { requeued, skipped } = await replayDeadDomainEvents(request.prisma, request.body.eventIds);
    for (const event of requeued) {
      await recordRequestAuditEvent(request.prisma, request, {
        action: 'domain_event.replayed',
        entityId: event.id,
        metadata: {
          type: event.type,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          sequence: event.sequence,
          fromStatus: 'dead',
          toStatus: 'pending',
          replayCount: event.replayCount,
          previousAttempts: event.previousAttempts,
        },
      });
    }
    return {
      requeued: requeued.map((event) => event.id),
      skipped,
      maxReplaysPerEvent: MAX_REPLAYS_PER_EVENT,
    };
  });
}
