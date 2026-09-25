// Audit event log — read-only, admin-only (issue #412).
//
// There is intentionally no POST/PUT/PATCH/DELETE here: events are written
// only by server-side code through recordAuditEvent, and the database rejects
// every UPDATE, DELETE and TRUNCATE on audit_events. Reads go through the
// request-scoped Prisma client, which pins them to the caller's organization.
import { z } from 'zod';
import { validateQuery } from '../validators/schemas.js';
import { clampTake } from '../utils/query-limits.js';
import { AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES } from '../services/audit-event.service.js';

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 100;

const isoDate = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO date');
const shortId = z.string().trim().min(1).max(191);

export const auditEventQuerySchema = z.object({
  entityType: z.enum(/** @type {[string, ...string[]]} */ (AUDIT_ENTITY_TYPES)).optional(),
  entityId: shortId.optional(),
  action: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(AUDIT_ACTIONS))).optional(),
  actorUserId: shortId.optional(),
  actorType: z.enum(/** @type {[string, ...string[]]} */ ([...AUDIT_ACTOR_TYPES])).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: z.string().trim().max(400).optional(),
  limit: z.string().trim().max(6).optional(),
}).strict();

/** Opaque, stable keyset cursor over (createdAt DESC, id DESC). */
export function encodeAuditCursor(event) {
  return Buffer.from(`${new Date(event.createdAt).toISOString()}|${event.id}`, 'utf8').toString('base64url');
}

export function decodeAuditCursor(cursor) {
  try {
    const [createdAt, id, extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const date = new Date(createdAt);
    if (extra !== undefined || !id || Number.isNaN(date.getTime())) return null;
    return { createdAt: date, id };
  } catch {
    return null;
  }
}

/**
 * Translate validated query params into a Prisma where clause. Tenant scoping
 * is added by the request-scoped client, never trusted from the query.
 */
export function buildAuditWhere(query, cursor) {
  /** @type {any[]} */
  const and = [];
  for (const field of ['entityType', 'entityId', 'action', 'actorUserId', 'actorType']) {
    if (query[field]) and.push({ [field]: query[field] });
  }
  if (query.from || query.to) {
    and.push({
      createdAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    });
  }
  if (cursor) {
    and.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export default async function auditEventRoutes(fastify) {
  // Filter vocabulary for the admin UI, so the page never drifts from the
  // server's closed catalog.
  fastify.get('/catalog', { onRequest: [fastify.adminOnly] }, async () => ({
    actions: Object.keys(AUDIT_ACTIONS),
    entityTypes: AUDIT_ENTITY_TYPES,
    actorTypes: AUDIT_ACTOR_TYPES,
  }));

  fastify.get('/', {
    onRequest: [fastify.adminOnly],
    preHandler: [validateQuery(auditEventQuerySchema)],
  }, async (request, reply) => {
    const query = request.query;
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      return reply.status(400).send({ error: 'from must be on or before to' });
    }
    const cursor = query.cursor ? decodeAuditCursor(query.cursor) : null;
    if (query.cursor && !cursor) return reply.status(400).send({ error: 'Invalid cursor' });

    const limit = clampTake(query.limit, { defaultTake: AUDIT_DEFAULT_LIMIT, maxTake: AUDIT_MAX_LIMIT });
    const rows = await request.prisma.auditEvent.findMany({
      where: buildAuditWhere(query, cursor),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        actorUserId: true,
        actorType: true,
        action: true,
        entityType: true,
        entityId: true,
        requestId: true,
        ip: true,
        metadata: true,
        createdAt: true,
      },
    });
    const events = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? encodeAuditCursor(events[events.length - 1]) : null;

    // Resolve actor display names within the same tenant; a deleted or
    // foreign id simply stays unresolved.
    const actorIds = [...new Set(events.map((event) => event.actorUserId).filter(Boolean))];
    const actors = actorIds.length
      ? await request.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [];
    const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));

    return {
      events: events.map((event) => ({
        ...event,
        actorName: event.actorUserId ? (actorNames.get(event.actorUserId) ?? null) : null,
      })),
      nextCursor,
      limit,
    };
  });
}
