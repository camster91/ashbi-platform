import { z } from 'zod';
import { ToolError } from '../ai/tools/registry.js';
import { createScopedPrisma, TenancyError } from '../utils/prisma-tenant-proxy.js';

const recordId = z.string().trim().min(1).max(100);
export const communicationParamsSchema = z.object({ clientId: recordId }).strict();
export const communicationDetailParamsSchema = z.object({ clientId: recordId, source: z.enum(['inbox', 'project']), messageId: recordId }).strict();
export const communicationsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), after: z.string().min(1).max(600).optional() }).strict();
const cursorSchema = z.object({ v: z.literal(1), t: z.string().datetime(), s: z.enum(['inbox', 'project']), i: recordId }).strict();
const coverage = { kind: 'stored-history', complete: false, exclusions: ['Project-only inbox threads are excluded by the current ownership policy.'] };
const projectSelect = { id: true, clientId: true, organizationId: true, deletedAt: true };
const threadSelect = { id: true, clientId: true, assignedToId: true, projectId: true, client: { select: { id: true, organizationId: true, deletedAt: true } }, project: { select: projectSelect } };
const inboxSelect = { id: true, subject: true, senderEmail: true, direction: true, receivedAt: true, bodyText: true, threadId: true, thread: { select: threadSelect } };
const projectCommunicationSelect = { id: true, subject: true, from: true, direction: true, receivedAt: true, bodySnippet: true, projectId: true, project: { select: projectSelect } };
const failure = (code, statusCode) => { throw new ToolError(code, 'Client communications unavailable', { statusCode }); };
function parse(schema, input) { const result = schema.safeParse(input); if (!result.success) failure('INVALID_INPUT', 400); return result.data; }
function cursorValue(after) {
  if (!after) return null;
  try { return parse(cursorSchema, JSON.parse(Buffer.from(after, 'base64url').toString('utf8'))); }
  catch { failure('INVALID_INPUT', 400); }
}
function seek(source, cursor) {
  if (!cursor) return {};
  const at = new Date(cursor.t);
  const OR = [{ receivedAt: { lt: at } }];
  if (source > cursor.s) OR.push({ receivedAt: at });
  else if (source === cursor.s) OR.push({ receivedAt: at, id: { lt: cursor.i } });
  return { OR };
}
async function scope(prisma, user, clientId) {
  if (!user?.id || !user.organizationId || !['ADMIN', 'TEAM'].includes(user.role)) failure('ROLE_DENIED', 403);
  const db = createScopedPrisma(prisma, user.organizationId);
  const actor = await db.user.findFirst({ where: { id: user.id, organizationId: user.organizationId, isActive: true }, select: { id: true, role: true, isActive: true, organizationId: true } });
  if (!actor || actor.id !== user.id || actor.organizationId !== user.organizationId || !actor.isActive || !['ADMIN', 'TEAM'].includes(actor.role)) failure('ROLE_DENIED', 403);
  const client = await db.client.findFirst({ where: { id: clientId, organizationId: actor.organizationId, deletedAt: null }, select: { id: true, organizationId: true, deletedAt: true } });
  if (!client || client.id !== clientId || client.organizationId !== actor.organizationId || client.deletedAt != null) failure('RECORD_NOT_FOUND', 404);
  const projectWhere = { clientId, organizationId: actor.organizationId, deletedAt: null };
  const threadWhere = { clientId, client: { id: clientId, organizationId: actor.organizationId, deletedAt: null }, ...(actor.role === 'ADMIN' ? {} : { assignedToId: actor.id }), OR: [{ projectId: null }, { project: projectWhere }] };
  return { db, actor, projectWhere, threadWhere, clientId };
}
function validProject(project, ctx) { return project && project.organizationId === ctx.actor.organizationId && project.clientId === ctx.clientId && project.deletedAt == null; }
function guardRow(source, row, ctx) {
  if (source === 'project') { if (!validProject(row.project, ctx) || row.project.id !== row.projectId) failure('COMMUNICATION_SCOPE_INVALID', 503); }
  else {
    const thread = row.thread;
    if (!thread || thread.id !== row.threadId
      || thread.clientId !== ctx.clientId || thread.client?.id !== ctx.clientId || thread.client.organizationId !== ctx.actor.organizationId || thread.client.deletedAt != null
      || (ctx.actor.role !== 'ADMIN' && thread.assignedToId !== ctx.actor.id)
      || (thread.projectId && (!validProject(thread.project, ctx) || thread.project.id !== thread.projectId))) failure('COMMUNICATION_SCOPE_INVALID', 503);
  }
}
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
function item(source, row) {
  return { id: row.id, source, subject: text(row.subject, 500), sender: text(source === 'inbox' ? row.senderEmail : row.from, 320), direction: ['INBOUND', 'OUTBOUND'].includes(row.direction) ? row.direction : 'UNKNOWN', receivedAt: new Date(row.receivedAt).toISOString(), ...(source === 'inbox' ? { threadId: row.threadId, ...(row.thread.projectId ? { projectId: row.thread.projectId } : {}) } : { projectId: row.projectId }), snippet: text(source === 'inbox' ? row.bodyText : row.bodySnippet, 500) };
}
function guardFailure(error) {
  return error instanceof ToolError || error instanceof TenancyError
    || ['TENANCY_VIOLATION', 'ROLE_DENIED', 'FORBIDDEN', 'UNAUTHORIZED'].includes(error?.code)
    || [401, 403].includes(error?.statusCode);
}

/** Stored records only. No provider, credential, model or mutation path. */
export async function listClientCommunications(prisma, user, clientId, input = {}) {
  parse(communicationParamsSchema, { clientId });
  const { limit, after } = parse(communicationsQuerySchema, input);
  const cursor = cursorValue(after);
  const ctx = await scope(prisma, user, clientId);
  const results = await Promise.allSettled([
    ctx.db.message.findMany({ where: { thread: ctx.threadWhere, ...seek('inbox', cursor) }, select: inboxSelect, orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], take: limit + 1 }),
    ctx.db.projectCommunication.findMany({ where: { project: ctx.projectWhere, ...seek('project', cursor) }, select: projectCommunicationSelect, orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], take: limit + 1 }),
  ]);
  const rows = [], warnings = [];
  for (const [index, result] of results.entries()) {
    const source = index === 0 ? 'inbox' : 'project';
    if (result.status === 'rejected') {
      if (guardFailure(result.reason)) throw result.reason;
      warnings.push(source === 'inbox' ? 'Stored inbox history is temporarily unavailable. Reload to retry.' : 'Stored project email history is temporarily unavailable. Reload to retry.');
    } else for (const row of result.value) { guardRow(source, row, ctx); rows.push(item(source, row)); }
  }
  if (results.every(result => result.status === 'rejected')) failure('COMMUNICATIONS_UNAVAILABLE', 503);
  rows.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || (a.source < b.source ? -1 : a.source > b.source ? 1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const items = rows.slice(0, limit), last = items.at(-1);
  // On partial failure, advancing a merged cursor could skip unseen records
  // from the unavailable source. Require a fresh retry instead.
  const nextCursor = !warnings.length && rows.length > limit ? Buffer.from(JSON.stringify({ v: 1, t: last.receivedAt, s: last.source, i: last.id })).toString('base64url') : null;
  return { items, nextCursor, coverage: { ...coverage }, warnings };
}

export async function readClientCommunication(prisma, user, clientId, source, messageId) {
  parse(communicationDetailParamsSchema, { clientId, source, messageId });
  const ctx = await scope(prisma, user, clientId);
  const row = source === 'inbox'
    ? await ctx.db.message.findFirst({ where: { id: messageId, thread: ctx.threadWhere }, select: inboxSelect })
    : await ctx.db.projectCommunication.findFirst({ where: { id: messageId, project: ctx.projectWhere }, select: { ...projectCommunicationSelect, fullBody: true } });
  if (!row) failure('RECORD_NOT_FOUND', 404);
  guardRow(source, row, ctx);
  const body = source === 'inbox' ? row.bodyText : row.fullBody;
  return { ...item(source, row), bodyText: text(body, 50000), bodyTruncated: typeof body === 'string' && body.length > 50000 };
}
