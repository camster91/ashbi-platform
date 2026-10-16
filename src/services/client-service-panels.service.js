import { z } from 'zod';
import { ToolError, recordNotFound } from '../ai/tools/registry.js';
import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';
import { authorizeClientAgentStaff } from './client-agent-profile.service.js';
import { recordAuditEvent } from './audit-event.service.js';

const opaque = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const plain = max => z.string().trim().min(1).max(max).refine(value => !/[<>]/.test(value) && [...value].every(char => char.charCodeAt(0) >= 32 || [9, 10, 13].includes(char.charCodeAt(0))));
export const servicePanelParamsSchema = z.object({ clientId: opaque }).strict();
export const serviceMappingParamsSchema = servicePanelParamsSchema.extend({ mappingId: opaque });
export const servicePanelQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export const serviceMappingCreateSchema = z.object({ provider: z.literal('OPENSEO'), providerProjectId: opaque, displayLabel: plain(100) }).strict();
export const serviceMappingUpdateSchema = z.object({ revision: z.number().int().min(1).max(2147483646), displayLabel: plain(100), enabled: z.boolean() }).strict();
export const serviceSnapshotSchema = z.object({
  mappingRevision: z.number().int().min(1).max(2147483646), providerProjectIdMatch: opaque,
  outcome: z.enum(['OK', 'EMPTY', 'UNAVAILABLE']), complete: z.boolean(),
  failureCode: z.enum(['PROVIDER_UNAVAILABLE', 'AUTH_REQUIRED', 'REPORT_UNAVAILABLE']).nullable().default(null),
  reports: z.array(z.object({ providerReportId: opaque, title: plain(200), summary: plain(4000),
    sourceReportedAt: z.string().datetime({ offset: true }).nullable().default(null) }).strict()).max(50),
}).strict().superRefine((value, ctx) => {
  const bad = message => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (new Set(value.reports.map(row => row.providerReportId)).size !== value.reports.length) bad('Duplicate report identifiers');
  if (value.outcome !== 'OK' && value.reports.length) bad('Only OK may contain reports');
  if (value.outcome === 'OK' && !value.reports.length) bad('Use EMPTY for an empty snapshot');
  if (value.outcome === 'EMPTY' && !value.complete) bad('Empty must be a complete snapshot');
  if (value.outcome === 'UNAVAILABLE' ? !value.failureCode : value.failureCode !== null) bad('Failure code must match outcome');
});
const fail = (code, message, statusCode = 400) => { throw new ToolError(code, message, { statusCode }); };
const conflict = () => fail('SERVICE_PANEL_CONFLICT', 'The saved report mapping changed. Reload before saving.', 409);
function parse(schema, value) { const result = schema.safeParse(value); if (!result.success) fail('INVALID_INPUT', 'Provide valid saved report fields.'); return result.data; }
const scope = (prisma, user) => { if (!user?.organizationId) fail('ROLE_DENIED', 'Active staff access required.', 403); return createScopedPrisma(prisma, user.organizationId); };
async function admin(tx, user, clientId) { const actor = await authorizeClientAgentStaff(tx, user, clientId); if (actor.role !== 'ADMIN') fail('ROLE_DENIED', 'Administrator access required.', 403); return actor; }
export async function requireClientServiceAdmin(prisma, identity, clientId) {
  if (typeof identity?.id !== 'string' || !identity.id || typeof identity.organizationId !== 'string' || !identity.organizationId) fail('ROLE_DENIED', 'Administrator access required.', 403);
  const actor = await prisma.user.findFirst({ where: { id: identity.id, organizationId: identity.organizationId, isActive: true }, select: { id: true, organizationId: true, role: true, isActive: true } });
  if (!actor || actor.id !== identity.id || actor.organizationId !== identity.organizationId || actor.role !== 'ADMIN' || !actor.isActive) fail('ROLE_DENIED', 'Administrator access required.', 403);
  await authorizeClientAgentStaff(prisma, actor, clientId);
  return actor;
}
async function audit(tx, actor, row, action, metadata = {}) {
  const saved = await recordAuditEvent(tx, { organizationId: actor.organizationId, actorUserId: actor.id, actorType: 'USER',
    entityId: row.id, action: `client_service_project.${action}`, metadata: { clientId: row.clientId, revision: row.revision, ...metadata } });
  if (!saved) fail('SERVICE_PANEL_AUDIT_UNAVAILABLE', 'Saved reports could not be updated with an audit record.', 503);
}
function projection(row, limit, now) {
  const hasMoreReports = row.reports.length > limit;
  // A Hub-storage-ordered bounded page cannot establish the newest source date
  // for the whole mapping. Keep completeness uncertainty explicit.
  const latest = hasMoreReports ? null : row.reports.reduce((result, report) => report.sourceReportedAt && (!result || report.sourceReportedAt > result) ? report.sourceReportedAt : result, null);
  return { id: row.id, provider: row.provider, providerProjectId: row.providerProjectId, displayLabel: row.displayLabel,
    enabled: row.enabled, revision: row.revision, status: !row.lastAttemptAt ? 'never-fetched' : row.lastOutcome === 'UNAVAILABLE' ? 'unavailable' : row.reports.length ? 'ready' : 'empty',
    lastAttemptAt: row.lastAttemptAt, lastSuccessAt: row.lastSuccessAt, lastOutcome: row.lastOutcome, failureCode: row.failureCode,
    stale: !row.lastSuccessAt || now - new Date(row.lastSuccessAt).getTime() > 86400000,
    sourceObservedAt: latest, sourceFreshness: latest ? (now - new Date(latest).getTime() > 86400000 ? 'stale' : 'recent') : 'unknown', hasMoreReports,
    reports: row.reports.slice(0, limit).map(report => ({ id: report.id, providerReportId: report.providerReportId,
      title: report.title, summary: report.summary, sourceReportedAt: report.sourceReportedAt, hubStoredAt: report.hubStoredAt, sourceUrl: null })) };
}
export async function readClientServicePanels(prisma, user, clientId, query = {}) {
  ({ clientId } = parse(servicePanelParamsSchema, { clientId })); const { limit } = parse(servicePanelQuerySchema, query);
  const db = scope(prisma, user); const actor = await authorizeClientAgentStaff(db, user, clientId);
  const projects = await db.clientServiceProject.findMany({ where: { organizationId: actor.organizationId, clientId, ...(actor.role === 'ADMIN' ? {} : { enabled: true }) },
    orderBy: { id: 'asc' }, take: 51, include: { reports: { where: { organizationId: actor.organizationId, clientId }, orderBy: [{ hubStoredAt: 'desc' }, { id: 'asc' }], take: limit + 1 } } });
  return { clientId, source: 'ADMIN_PUBLISHED_SNAPSHOT', staleAfterHours: 24, hasMoreProjects: projects.length > 50,
    projects: projects.slice(0, 50).map(row => projection(row, limit, Date.now())) };
}
async function mutate(prisma, user, clientId, fn) {
  ({ clientId } = parse(servicePanelParamsSchema, { clientId })); const db = scope(prisma, user);
  try { return await db.$transaction(async tx => { const actor = await admin(tx, user, clientId); return fn(tx, actor); }, { isolationLevel: 'Serializable' }); }
  catch (error) { if (['P2002', 'P2034'].includes(error?.code)) conflict(); if (error instanceof ToolError) throw error; fail('SERVICE_PANEL_UNAVAILABLE', 'Saved reports unavailable.', 503); }
}
export async function createClientServiceMapping(prisma, user, clientId, input) {
  const fields = parse(serviceMappingCreateSchema, input);
  return mutate(prisma, user, clientId, async (tx, actor) => {
    const count = await tx.clientServiceProject.count({ where: { organizationId: actor.organizationId, clientId } });
    if (count >= 50) fail('INVALID_INPUT', 'At most 50 saved report mappings are supported per client.');
    const row = await tx.clientServiceProject.create({ data: { organizationId: actor.organizationId, clientId, ...fields } });
    await audit(tx, actor, row, 'created', { enabled: true }); return { id: row.id, revision: row.revision };
  });
}
export async function updateClientServiceMapping(prisma, user, clientId, mappingId, input) {
  ({ mappingId } = parse(serviceMappingParamsSchema, { clientId, mappingId })); const { revision, ...fields } = parse(serviceMappingUpdateSchema, input);
  return mutate(prisma, user, clientId, async (tx, actor) => {
    const where = { id: mappingId, clientId, organizationId: actor.organizationId, revision };
    if ((await tx.clientServiceProject.updateMany({ where, data: { ...fields, revision: { increment: 1 } } })).count !== 1) conflict();
    const row = await tx.clientServiceProject.findFirst({ where: { id: mappingId, organizationId: actor.organizationId, clientId } });
    await audit(tx, actor, row, 'updated', { enabled: row.enabled }); return { id: row.id, revision: row.revision };
  });
}
export async function publishClientServiceSnapshot(prisma, user, clientId, mappingId, input) {
  ({ mappingId } = parse(serviceMappingParamsSchema, { clientId, mappingId })); const fields = parse(serviceSnapshotSchema, input);
  return mutate(prisma, user, clientId, (tx, actor) => publishClientServiceSnapshotInTransaction(tx, actor, clientId, mappingId, fields));
}

/** Caller must supply the executor transaction; authorization and audit remain inside it. */
export async function publishClientServiceSnapshotInTransaction(tx, identity, clientId, mappingId, input) {
  ({ mappingId } = parse(serviceMappingParamsSchema, { clientId, mappingId }));
  const fields = parse(serviceSnapshotSchema, input);
  const actor = await requireClientServiceAdmin(tx, identity, clientId);
  const where = { id: mappingId, organizationId: actor.organizationId, clientId };
  const mapping = await tx.clientServiceProject.findFirst({ where });
  if (!mapping) throw recordNotFound('Saved report mapping not found');
  if (!mapping.enabled || mapping.provider !== 'OPENSEO' || mapping.providerProjectId !== fields.providerProjectIdMatch || mapping.revision !== fields.mappingRevision) conflict();
  const now = new Date();
  if (fields.reports.some(row => row.sourceReportedAt && new Date(row.sourceReportedAt) > now)) fail('INVALID_INPUT', 'Source report times cannot be in the future.');
  const success = fields.outcome !== 'UNAVAILABLE';
  if ((await tx.clientServiceProject.updateMany({ where: { ...where, revision: fields.mappingRevision, enabled: true, providerProjectId: fields.providerProjectIdMatch },
    data: { revision: { increment: 1 }, lastAttemptAt: now, lastOutcome: fields.outcome, failureCode: fields.failureCode,
      ...(success ? { lastSuccessAt: now } : {}) } })).count !== 1) conflict();
  if (success) {
    if (fields.complete) await tx.clientServiceReport.deleteMany({ where: { organizationId: actor.organizationId, clientId, mappingId,
      ...(fields.reports.length ? { providerReportId: { notIn: fields.reports.map(row => row.providerReportId) } } : {}) } });
    for (const report of fields.reports) {
      const reportWhere = { organizationId: actor.organizationId, clientId, mappingId, providerReportId: report.providerReportId };
      const data = { title: report.title, summary: report.summary, sourceReportedAt: report.sourceReportedAt ? new Date(report.sourceReportedAt) : null, hubStoredAt: now };
      const existing = await tx.clientServiceReport.findFirst({ where: reportWhere, select: { id: true } });
      if (existing) await tx.clientServiceReport.updateMany({ where: { ...reportWhere, id: existing.id }, data });
      else await tx.clientServiceReport.create({ data: { ...reportWhere, ...data } });
    }
  }
  const row = { ...mapping, revision: mapping.revision + 1 };
  await audit(tx, actor, row, 'published', { outcome: fields.outcome, reportCount: fields.reports.length, complete: fields.complete });
  return { id: mappingId, revision: row.revision, outcome: fields.outcome, storedReportCount: await tx.clientServiceReport.count({ where: { organizationId: actor.organizationId, clientId, mappingId } }) };
}
