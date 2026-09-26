// Outbox dispatcher: deliver recorded domain events to in-process subscribers
// (#412, docs/event-outbox.md).
//
// Delivery is AT LEAST ONCE. A subscriber can see the same event more than
// once (a failed sibling subscriber, a worker that crashed after delivering
// but before marking the row, an expired claim lease, an admin replay), so
// every subscriber must be idempotent, keyed on `event.id` (or on the event's
// idempotencyKey) — for example a unique constraint on the effect it writes.
//
// Ordering: within one aggregate, event N is only claimed once every earlier
// event of that aggregate is `published`. A `dead` or in-flight predecessor
// blocks its successors until it is published (after a replay). There is no
// ordering between different aggregates or organizations.
//
// Claims use `FOR UPDATE SKIP LOCKED` plus a lease (`lockedUntil`) and a
// per-claim token, so concurrent dispatchers never claim the same row, and a
// row whose dispatcher died is reclaimed once its lease expires. Outcomes are
// written with a conditional update on (id, status, claimToken), so a
// dispatcher that lost its lease cannot overwrite a newer claim.
import { randomUUID } from 'node:crypto';
import defaultLogger from '../utils/logger.js';
import { runTenantJob } from '../jobs/tenant-iteration.js';

export const DOMAIN_EVENT_STATUSES = Object.freeze(['pending', 'dispatching', 'published', 'dead']);

// Proposed defaults (docs/event-outbox.md). Delays: 10s, 20s, 40s ... capped
// at 1h, halved-and-jittered; the 10th failed attempt dead-letters the event
// after roughly 1.5-3 hours of retries.
export const DISPATCH_DEFAULTS = Object.freeze({
  batchSize: 25,
  maxRounds: 10,
  leaseMs: 2 * 60 * 1000,
  maxAttempts: 10,
  baseDelayMs: 10 * 1000,
  maxDelayMs: 60 * 60 * 1000,
});

export const MAX_REPLAYS_PER_EVENT = 5;
export const MAX_REPLAY_BATCH = 50;
const MAX_ERROR_LENGTH = 300;

// ─── Subscriber registry ─────────────────────────────────────────────────────

/** @type {Map<string, { name: string, types: Set<string> | null, handle: Function }>} */
const registry = new Map();

/**
 * Register an in-process subscriber. `types` lists the event types it wants,
 * or `'*'` for every type. The handler receives the stored event row and a
 * tenant-scoped Prisma client for the event's organization; it must be
 * idempotent (see the file header) and should finish well within the lease.
 *
 * @param {{ name: string, types: string[] | '*', handle: (event: any, ctx: { prisma: any, attempt: number }) => Promise<unknown> | unknown }} subscriber
 */
export function registerDomainEventSubscriber({ name, types, handle }) {
  if (!name || typeof handle !== 'function') throw new Error('A subscriber needs a name and a handle function');
  if (registry.has(name)) throw new Error(`Domain event subscriber ${name} is already registered`);
  registry.set(name, { name, types: types === '*' ? null : new Set(types), handle });
}

/** @param {string} name */
export function unregisterDomainEventSubscriber(name) {
  return registry.delete(name);
}

/**
 * Subscribers for a type, in registration order.
 * @param {string} type
 * @param {Iterable<{ name: string, types: Set<string> | null, handle: Function }>} [source]
 */
export function subscribersFor(type, source = registry.values()) {
  return [...source].filter((subscriber) => subscriber.types === null || subscriber.types.has(type));
}

// Built-in subscriber: a structured journal line per delivered event (ids and
// envelope fields only, never the payload). It gives operators a delivery
// trace and keeps the pipeline exercised until real consumers subscribe.
registerDomainEventSubscriber({
  name: 'journal',
  types: '*',
  handle: (event) => {
    defaultLogger.info({
      domainEventId: event.id,
      domainEventType: event.type,
      organizationId: event.organizationId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      sequence: event.sequence,
      correlationId: event.correlationId,
      causationId: event.causationId,
    }, 'Domain event delivered');
  },
});

// ─── Backoff ─────────────────────────────────────────────────────────────────

/**
 * Delay before retry number `attempts + 1`: exponential from baseDelayMs,
 * capped at maxDelayMs, with "equal jitter" so the delay stays within
 * [cap/2, cap] and replicas do not retry in lockstep.
 *
 * @param {number} attempts Attempts made so far (>= 1).
 * @param {{ baseDelayMs?: number, maxDelayMs?: number, random?: () => number }} [options]
 */
export function computeBackoffMs(attempts, {
  baseDelayMs = DISPATCH_DEFAULTS.baseDelayMs,
  maxDelayMs = DISPATCH_DEFAULTS.maxDelayMs,
  random = Math.random,
} = {}) {
  const exponent = Math.min(Math.max(0, attempts - 1), 30);
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
  const jitter = Math.min(Math.max(random(), 0), 1);
  return Math.round(ceiling / 2 + (ceiling / 2) * jitter);
}

/** Error name/code and a truncated message; never a stack or payload. */
export function describeDispatchError(err) {
  const name = typeof err?.name === 'string' ? err.name : 'Error';
  const code = typeof err?.code === 'string' ? ` [${err.code}]` : '';
  const message = typeof err?.message === 'string' ? err.message : String(err);
  return `${name}${code}: ${message}`.slice(0, MAX_ERROR_LENGTH);
}

// ─── Claiming ────────────────────────────────────────────────────────────────

/**
 * Atomically claim up to `limit` due events whose aggregate predecessors are
 * all published, oldest first. Pending events whose nextAttemptAt has passed
 * and dispatching events whose lease expired are both eligible.
 *
 * @param {any} prisma Unscoped client (background job).
 * @param {{ now?: Date, limit?: number, leaseMs?: number, claimToken?: string }} [options]
 * @returns {Promise<any[]>}
 */
export async function claimDomainEvents(prisma, {
  now = new Date(),
  limit = DISPATCH_DEFAULTS.batchSize,
  leaseMs = DISPATCH_DEFAULTS.leaseMs,
  claimToken = randomUUID(),
} = {}) {
  const nowIso = now.toISOString();
  const leaseIso = new Date(now.getTime() + leaseMs).toISOString();
  // Timestamps are passed as ISO strings and converted to UTC wall-clock
  // time explicitly, matching how Prisma stores TIMESTAMP(3) columns whatever
  // the session time zone.
  return prisma.$queryRaw`
    WITH candidates AS (
      SELECT e."id"
        FROM "domain_events" e
       WHERE (
               (e."status" = 'pending' AND e."nextAttemptAt" <= (${nowIso}::timestamptz AT TIME ZONE 'UTC'))
            OR (e."status" = 'dispatching' AND e."lockedUntil" < (${nowIso}::timestamptz AT TIME ZONE 'UTC'))
             )
         AND NOT EXISTS (
               SELECT 1
                 FROM "domain_events" p
                WHERE p."organizationId" = e."organizationId"
                  AND p."aggregateType" = e."aggregateType"
                  AND p."aggregateId" = e."aggregateId"
                  AND p."sequence" < e."sequence"
                  AND p."status" <> 'published'
             )
       ORDER BY e."occurredAt", e."sequence", e."id"
       LIMIT ${limit}::int
       FOR UPDATE OF e SKIP LOCKED
    )
    UPDATE "domain_events" d
       SET "status" = 'dispatching',
           "attempts" = d."attempts" + 1,
           "lastAttemptAt" = (${nowIso}::timestamptz AT TIME ZONE 'UTC'),
           "lockedUntil" = (${leaseIso}::timestamptz AT TIME ZONE 'UTC'),
           "claimToken" = ${claimToken}
      FROM candidates c
     WHERE d."id" = c."id"
 RETURNING d.*`;
}

async function settle(prisma, event, data) {
  const result = await prisma.domainEvent.updateMany({
    where: { id: event.id, status: 'dispatching', claimToken: event.claimToken },
    data,
  });
  return result.count === 1;
}

/**
 * Run every subscriber of the event's type, in order, inside a tenant scope
 * for the event's organization. The first failure stops the run and fails
 * the attempt; the whole event is retried later.
 */
async function defaultRunInTenant(prisma, organizationId, callback) {
  return runTenantJob(prisma, organizationId, callback);
}

/**
 * One dispatcher run: claim and deliver batches until nothing is due or
 * maxRounds is reached.
 *
 * @param {any} prisma Unscoped client (background job).
 * @param {{
 *   now?: () => Date, batchSize?: number, maxRounds?: number, leaseMs?: number,
 *   maxAttempts?: number, baseDelayMs?: number, maxDelayMs?: number,
 *   random?: () => number, subscribers?: Iterable<any>, claim?: typeof claimDomainEvents,
 *   runInTenant?: (prisma: any, organizationId: string, callback: (tenantPrisma: any) => Promise<unknown>) => Promise<unknown>,
 *   logger?: { info: Function, warn: Function, error: Function },
 * }} [options]
 */
export async function dispatchDomainEvents(prisma, options = {}) {
  const {
    now = () => new Date(),
    batchSize = DISPATCH_DEFAULTS.batchSize,
    maxRounds = DISPATCH_DEFAULTS.maxRounds,
    leaseMs = DISPATCH_DEFAULTS.leaseMs,
    maxAttempts = DISPATCH_DEFAULTS.maxAttempts,
    baseDelayMs = DISPATCH_DEFAULTS.baseDelayMs,
    maxDelayMs = DISPATCH_DEFAULTS.maxDelayMs,
    random = Math.random,
    subscribers,
    runInTenant = defaultRunInTenant,
    claim = claimDomainEvents,
    logger = defaultLogger,
  } = options;
  const summary = { claimed: 0, published: 0, retried: 0, dead: 0, leaseLost: 0 };

  for (let round = 0; round < maxRounds; round += 1) {
    const claimed = await claim(prisma, { now: now(), limit: batchSize, leaseMs });
    if (claimed.length === 0) break;
    summary.claimed += claimed.length;

    for (const event of claimed) {
      const targets = subscribersFor(event.type, subscribers ?? registry.values());
      let failure = null;
      try {
        await runInTenant(prisma, event.organizationId, async (tenantPrisma) => {
          for (const subscriber of targets) {
            try {
              await subscriber.handle(event, { prisma: tenantPrisma, attempt: event.attempts });
            } catch (err) {
              err.subscriber = subscriber.name;
              throw err;
            }
          }
        });
      } catch (err) {
        failure = err;
      }

      const settledAt = now();
      if (!failure) {
        const ok = await settle(prisma, event, {
          status: 'published', publishedAt: settledAt, lockedUntil: null, claimToken: null, lastError: null,
        });
        if (ok) summary.published += 1;
        else {
          summary.leaseLost += 1;
          logger.warn({ domainEventId: event.id }, 'Domain event lease lost before publish; it may be delivered again');
        }
        continue;
      }

      const lastError = describeDispatchError(failure);
      const logFields = {
        domainEventId: event.id,
        domainEventType: event.type,
        organizationId: event.organizationId,
        attempts: event.attempts,
        subscriber: failure?.subscriber ?? null,
        errorName: failure?.name,
        errorCode: failure?.code,
      };
      if (event.attempts >= maxAttempts) {
        const ok = await settle(prisma, event, { status: 'dead', lockedUntil: null, claimToken: null, lastError });
        if (ok) {
          summary.dead += 1;
          logger.error(logFields, 'Domain event dead-lettered');
        } else summary.leaseLost += 1;
      } else {
        const delay = computeBackoffMs(event.attempts, { baseDelayMs, maxDelayMs, random });
        const ok = await settle(prisma, event, {
          status: 'pending',
          nextAttemptAt: new Date(settledAt.getTime() + delay),
          lockedUntil: null,
          claimToken: null,
          lastError,
        });
        if (ok) {
          summary.retried += 1;
          logger.warn({ ...logFields, retryInMs: delay }, 'Domain event delivery failed; will retry');
        } else summary.leaseLost += 1;
      }
    }
    // No early exit on a short batch: publishing event N of an aggregate makes
    // N+1 claimable, so keep claiming until nothing is due (or maxRounds).
  }

  return summary;
}

// ─── Replay ──────────────────────────────────────────────────────────────────

/**
 * Requeue dead-lettered events so the dispatcher delivers them again.
 * Safeguards: only `dead` events are eligible (published events are never
 * re-sent by this path), each event may be replayed at most
 * MAX_REPLAYS_PER_EVENT times, a call takes at most MAX_REPLAY_BATCH ids,
 * and each transition is a conditional update so concurrent replays requeue
 * an event once.
 *
 * @param {any} tenantPrisma Request-scoped (tenant) client — never raw.
 * @param {string[]} eventIds
 * @param {{ now?: Date, maxReplays?: number }} [options]
 * @returns {Promise<{ requeued: any[], skipped: Array<{ id: string, reason: string }> }>}
 */
export async function replayDeadDomainEvents(tenantPrisma, eventIds, { now = new Date(), maxReplays = MAX_REPLAYS_PER_EVENT } = {}) {
  const ids = [...new Set(eventIds)];
  if (ids.length === 0 || ids.length > MAX_REPLAY_BATCH) {
    throw new Error(`Replay takes between 1 and ${MAX_REPLAY_BATCH} event ids`);
  }
  const found = await tenantPrisma.domainEvent.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, type: true, aggregateType: true, aggregateId: true, sequence: true,
      status: true, attempts: true, replayCount: true,
    },
  });
  const byId = new Map(found.map((event) => [event.id, event]));
  const requeued = [];
  const skipped = [];
  for (const id of ids) {
    const event = byId.get(id);
    if (!event) { skipped.push({ id, reason: 'not_found' }); continue; }
    if (event.status !== 'dead') { skipped.push({ id, reason: 'not_dead' }); continue; }
    if (event.replayCount >= maxReplays) { skipped.push({ id, reason: 'replay_limit' }); continue; }
    const { attempts: previousAttempts, replayCount } = event;
    const result = await tenantPrisma.domainEvent.updateMany({
      where: { id, status: 'dead', replayCount },
      data: { status: 'pending', attempts: 0, nextAttemptAt: now, replayCount: { increment: 1 } },
    });
    if (result.count === 1) {
      requeued.push({
        ...event, status: 'pending', attempts: 0, previousAttempts, replayCount: replayCount + 1,
      });
    } else {
      skipped.push({ id, reason: 'changed' });
    }
  }
  return { requeued, skipped };
}
