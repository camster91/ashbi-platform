import { z } from 'zod';
import { createHash } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { resolvePortalPrincipal } from '../auth/portal-principal.js';
import { ToolError } from '../ai/tools/registry.js';
import { recordAuditEvent } from './audit-event.service.js';

const id = z.string().trim().min(1).max(100);
export const handoffCreateSchema = z.object({ question: z.string().trim().min(1).max(2000), idempotencyKey: z.string().uuid().transform(value => value.toLowerCase()) }).strict();
export const handoffPageSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), after: id.optional() }).strict();
export const handoffStaffPageSchema = handoffPageSchema.extend({ projectId: id.optional(), clientId: id.optional(), status: z.enum(['PENDING', 'CLAIMED', 'RESOLVED']).optional(), owner: z.enum(['me', 'everyone']).default('everyone') });
export const handoffRevisionSchema = z.object({ revision: z.number().int().positive().max(2147483646) }).strict();
export const handoffRequeueSchema = handoffRevisionSchema.extend({ reason: z.enum(['OWNER_UNAVAILABLE', 'RECOVERY']) });
export const handoffParamsSchema = z.object({ requestId: id }).strict();
const fail = (code = 'HANDOFF_UNAVAILABLE', statusCode = 404) => { throw new ToolError(code, 'Human account manager request unavailable', { statusCode }); };
function parse(schema, input) { const value = schema.safeParse(input);if (!value.success) fail('INVALID_INPUT', 400);return value.data; }
const canonical = organizationId => ({ organizationId, deletedAt: null, client: { organizationId, deletedAt: null, status: 'ACTIVE', relationshipStatus: { notIn: ['ARCHIVED', 'CHURNED'] } } });
const publicView = row => ({ id: row.id, projectId: row.projectId, question: row.question, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt });
const staffView = row => ({ ...publicView(row), clientId: row.clientId, requestedById: row.requestedById, contactId: row.contactId, revision: row.revision, ownerId: row.ownerId, claimedAt: row.claimedAt, resolvedAt: row.resolvedAt });

async function transaction(prisma, work) {
  try { return await prisma.$transaction(work, { isolationLevel: 'Serializable' }); }
  catch (error) { if (['P2034', 'P2002'].includes(error?.code)) fail('HANDOFF_CONFLICT', 409);throw error; }
}
async function audit(db, actor, action, row, actorType = 'USER', extra = {}) {
  const event = await recordAuditEvent(db, { organizationId: row.organizationId, actorType, actorUserId: actor.id,
    action, entityId: row.id, metadata: { projectId: row.projectId, clientId: row.clientId, status: row.status, revision: row.revision, ...extra } });
  if (!event) fail('AUDIT_UNAVAILABLE', 503);
}
async function portalScope(db, claims, projectId) {
  projectId = parse(id, projectId);
  const principal = await resolvePortalPrincipal(db, claims);
  if (!principal) fail('PORTAL_SESSION_REVOKED', 401);
  const project = await db.project.findFirst({ where: { id: projectId, clientId: principal.client.id, ...canonical(principal.client.organizationId) }, select: { id: true, clientId: true, organizationId: true } });
  if (!project || project.id !== projectId || project.clientId !== principal.client.id || project.organizationId !== principal.client.organizationId) fail();
  return { principal, project, where: { organizationId: principal.client.organizationId, clientId: principal.client.id, projectId, requestedById: principal.user.id, contactId: principal.contact.id } };
}
export async function authorizeHandoffStaff(db, user) {
  if (!user?.id || !user.organizationId || !['ADMIN', 'TEAM'].includes(user.role)) fail('ROLE_DENIED', 403);
  const actor = await db.user.findFirst({ where: { id: user.id, organizationId: user.organizationId, isActive: true }, select: { id: true, role: true, organizationId: true, isActive: true } });
  if (!actor || actor.id !== user.id || actor.organizationId !== user.organizationId || !actor.isActive || !['ADMIN', 'TEAM'].includes(actor.role)) fail('ROLE_DENIED', 403);
  return actor;
}
// Scope the immutable request/client/project tuple BEFORE pagination. A project
// can be reassigned by existing workflows; that must not migrate old requests
// to its new client or consume page slots/counts. Query text is fixed; the one
// JSON value contains validated identifiers and a server-bounded limit only.
export async function canonicalHandoffIds(db, actor, { limit, after, requestId, projectId, clientId, statuses, ownerId } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 101) fail('INVALID_INPUT', 400);
  const args = JSON.stringify({ organizationId: actor.organizationId, limit, after, requestId, projectId, clientId, statuses, ownerId });
  const rows = await db.$queryRaw(prismaPkg.Prisma.sql`
    WITH args AS (SELECT ${args}::jsonb AS x)
    SELECT h.id FROM portal_handoff_requests h
    JOIN projects p ON p.id=h."projectId" AND p."organizationId"=h."organizationId" AND p."clientId"=h."clientId"
    JOIN clients c ON c.id=h."clientId" AND c."organizationId"=h."organizationId"
    CROSS JOIN args
    WHERE h."organizationId"=args.x->>'organizationId' AND p."deletedAt" IS NULL AND c."deletedAt" IS NULL
      AND c.status='ACTIVE' AND c."relationshipStatus" NOT IN ('ARCHIVED','CHURNED')
      AND (args.x->>'requestId' IS NULL OR h.id=args.x->>'requestId')
      AND (args.x->>'after' IS NULL OR h.id>args.x->>'after')
      AND (args.x->>'projectId' IS NULL OR h."projectId"=args.x->>'projectId')
      AND (args.x->>'clientId' IS NULL OR h."clientId"=args.x->>'clientId')
      AND (args.x->>'ownerId' IS NULL OR h."ownerId"=args.x->>'ownerId')
      AND (args.x->'statuses' IS NULL OR (args.x->'statuses') ? h.status)
    ORDER BY h.id ASC LIMIT ${limit}`);
  return rows.map(row => row.id);
}
export async function createPortalHandoff(prisma, claims, projectId, input) {
  const fields = parse(handoffCreateSchema, input);
  return transaction(prisma, async db => {
    const { principal, project, where } = await portalScope(db, claims, projectId);
    const inputHash = createHash('sha256').update(fields.question, 'utf8').digest('hex');
    // Intent ownership is principal-wide, so it cannot be silently reused for
    // another project. Neither query nor replay includes another contact.
    const { projectId: _projectId, ...audience } = where;
    const existing = await db.portalHandoffRequest.findFirst({ where: { ...audience, idempotencyKey: fields.idempotencyKey } });
    if (existing) {
      if (existing.projectId !== project.id || existing.inputHash !== inputHash || existing.question !== fields.question) fail('HANDOFF_CONFLICT', 409);
      return { request: publicView(existing), idempotent: true };
    }
    const row = await db.portalHandoffRequest.create({ data: { ...where, question: fields.question, inputHash, idempotencyKey: fields.idempotencyKey,
      creationSessionVersion: principal.user.sessionVersion, changedById: principal.user.id, status: 'PENDING', revision: 1 } });
    await audit(db, principal.user, 'portal_handoff.requested', row, 'CLIENT');
    return { request: publicView(row), idempotent: false };
  });
}
export async function listPortalHandoffs(prisma, claims, projectId, input = {}) {
  const { limit, after } = parse(handoffPageSchema, input);
  const { where } = await portalScope(prisma, claims, projectId);
  if (after && !await prisma.portalHandoffRequest.findFirst({ where: { ...where, id: after }, select: { id: true } })) fail();
  const rows = await prisma.portalHandoffRequest.findMany({ where: { ...where, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1 });
  return { items: rows.slice(0, limit).map(publicView), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
}
export async function readPortalHandoff(prisma, claims, projectId, { requestId, idempotencyKey }) {
  const { where } = await portalScope(prisma, claims, projectId);
  const selector = requestId ? { id: parse(id, requestId) } : { idempotencyKey: parse(z.string().uuid(), idempotencyKey).toLowerCase() };
  const row = await prisma.portalHandoffRequest.findFirst({ where: { ...where, ...selector } });
  if (!row) fail();return { request: publicView(row) };
}
export async function listStaffHandoffs(prisma, user, input = {}) {
  const { limit, after, projectId, clientId, status, owner } = parse(handoffStaffPageSchema, input);
  const actor = await authorizeHandoffStaff(prisma, user);
  const filters = { projectId, clientId, statuses: status ? [status] : undefined, ownerId: owner === 'me' ? actor.id : undefined };
  if (after && !(await canonicalHandoffIds(prisma, actor, { ...filters, requestId: after, limit: 1 })).length) fail();
  const ids = await canonicalHandoffIds(prisma, actor, { ...filters, after, limit: limit + 1 });
  const rows = ids.length ? await prisma.portalHandoffRequest.findMany({ where: { organizationId: actor.organizationId, id: { in: ids } }, orderBy: { id: 'asc' }, take: limit + 1 }) : [];
  return { items: rows.slice(0, limit).map(staffView), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
}
async function staffRecord(db, user, requestId) {
  const actor = await authorizeHandoffStaff(db, user);
  requestId = parse(id, requestId);
  if (!(await canonicalHandoffIds(db, actor, { requestId, limit: 1 })).length) fail();
  const row = await db.portalHandoffRequest.findFirst({ where: { id: requestId, organizationId: actor.organizationId } });
  if (!row || row.organizationId !== actor.organizationId) fail();
  return { actor, row };
}
export async function readStaffHandoff(prisma, user, requestId) { return { request: staffView((await staffRecord(prisma, user, requestId)).row) }; }
export async function transitionHandoff(prisma, user, requestId, operation, input) {
  const fields = parse(operation === 'requeue' ? handoffRequeueSchema : handoffRevisionSchema, input);
  if (!['claim', 'resolve', 'requeue'].includes(operation)) fail('INVALID_INPUT', 400);
  return transaction(prisma, async db => {
    const { actor, row } = await staffRecord(db, user, requestId);
    if (row.revision !== fields.revision || row.status === 'RESOLVED') fail('HANDOFF_CONFLICT', 409);
    const at = new Date();let data;
    if (operation === 'claim') {
      if (row.status !== 'PENDING') fail('HANDOFF_CONFLICT', 409);
      data = { status: 'CLAIMED', ownerId: actor.id, claimedAt: at, resolvedAt: null, requeueReason: null };
    } else if (operation === 'resolve') {
      if (row.status !== 'CLAIMED' || (row.ownerId !== actor.id && actor.role !== 'ADMIN')) fail('HANDOFF_CONFLICT', 409);
      data = { status: 'RESOLVED', resolvedAt: at, requeueReason: null };
    } else {
      if (actor.role !== 'ADMIN') fail('ROLE_DENIED', 403);
      if (row.status !== 'CLAIMED') fail('HANDOFF_CONFLICT', 409);
      if (fields.reason === 'OWNER_UNAVAILABLE' && await db.user.findFirst({ where: { id: row.ownerId, organizationId: actor.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true } })) fail('HANDOFF_CONFLICT', 409);
      data = { status: 'PENDING', ownerId: null, claimedAt: null, resolvedAt: null, requeueReason: fields.reason };
    }
    const changed = await db.portalHandoffRequest.updateMany({ where: { id: row.id, organizationId: actor.organizationId, revision: fields.revision, status: row.status }, data: { ...data, changedById: actor.id, revision: { increment: 1 } } });
    if (changed.count !== 1) fail('HANDOFF_CONFLICT', 409);
    const updated = await db.portalHandoffRequest.findFirst({ where: { id: row.id, organizationId: actor.organizationId } });
    await audit(db, actor, `portal_handoff.${operation === 'claim' ? 'claimed' : operation === 'resolve' ? 'resolved' : 'requeued'}`, updated, 'USER', operation === 'requeue' ? { reason: fields.reason } : {});
    return { request: staffView(updated) };
  });
}
