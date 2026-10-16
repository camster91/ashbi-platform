import { z } from 'zod';
import { ToolError, recordNotFound } from '../ai/tools/registry.js';
import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';
import { recordAuditEvent } from './audit-event.service.js';

export const clientAgentProfileParamsSchema = z.object({ clientId: z.string().trim().min(1).max(100) }).strict();
export const clientAgentProfileUpdateSchema = z.object({
  revision: z.number().int().min(0).max(2147483646),
  name: z.string().trim().min(1).max(100),
  instructions: z.string().trim().max(2000),
  enabled: z.boolean(),
  pluginIds: z.array(z.enum(['client-work', 'client-task-actions'])).max(2).refine(ids => new Set(ids).size === ids.length),
}).strict();

const fail = (code, message, statusCode) => { throw new ToolError(code, message, { statusCode }); };
const conflict = () => fail('PROFILE_CONFLICT', 'The account manager profile changed. Reload before saving.', 409);
const select = { id: true, organizationId: true, clientId: true, name: true, instructions: true,
  enabled: true, portalEnabled: true, revision: true, pluginIds: true, updatedAt: true };
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) fail('INVALID_INPUT', 'Provide valid account manager profile fields.', 400);
  return result.data;
}
function project(row) {
  return { id: row.id, clientId: row.clientId, name: row.name, instructions: row.instructions,
    enabled: row.enabled, portalEnabled: false, revision: row.revision,
    pluginIds: Array.isArray(row.pluginIds) ? row.pluginIds.filter(id => ['client-work', 'client-task-actions'].includes(id)) : [],
    ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}) };
}
export async function authorizeClientAgentStaff(prisma, user, clientId) {
  if (typeof user?.id !== 'string' || !user.id || typeof user.organizationId !== 'string'
    || !user.organizationId || !['ADMIN', 'TEAM'].includes(user.role)) fail('ROLE_DENIED', 'Active staff access required.', 403);
  const actor = await prisma.user.findFirst({ where: { id: user.id, organizationId: user.organizationId, isActive: true },
    select: { id: true, organizationId: true, role: true, isActive: true } });
  if (!actor || actor.id !== user.id || actor.organizationId !== user.organizationId || !actor.isActive
    || !['ADMIN', 'TEAM'].includes(actor.role)) fail('ROLE_DENIED', 'Active staff access required.', 403);
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId: actor.organizationId, deletedAt: null },
    select: { id: true, organizationId: true, deletedAt: true } });
  if (!client || client.id !== clientId || client.organizationId !== actor.organizationId || client.deletedAt) throw recordNotFound('Client not found');
  return actor;
}
function scopedFor(prisma, user) {
  // Authorize before queries, including malformed or missing actor scopes.
  if (typeof user?.organizationId !== 'string' || !user.organizationId) fail('ROLE_DENIED', 'Active staff access required.', 403);
  return createScopedPrisma(prisma, user.organizationId);
}

/** GET never materializes a row; defaults remain explicit at revision zero. */
export async function readClientAgentProfile(prisma, user, clientId) {
  ({ clientId } = parse(clientAgentProfileParamsSchema, { clientId }));
  const scoped = scopedFor(prisma, user);
  try {
    const actor = await authorizeClientAgentStaff(scoped, user, clientId);
    const row = await scoped.clientAgentProfile.findFirst({ where: { organizationId: actor.organizationId, clientId }, select });
    if (!row) return { id: null, clientId, name: 'Account manager', instructions: '', enabled: true,
      portalEnabled: false, revision: 0, pluginIds: ['client-work'] };
    if (row.organizationId !== actor.organizationId || row.clientId !== clientId) throw recordNotFound('Client not found');
    return project(row);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    fail('PROFILE_UNAVAILABLE', 'Account manager profile unavailable.', 503);
  }
}

/** Revision comparison and audit evidence commit together or neither does. */
export async function saveClientAgentProfile(prisma, user, clientId, input) {
  ({ clientId } = parse(clientAgentProfileParamsSchema, { clientId }));
  const { revision, ...fields } = parse(clientAgentProfileUpdateSchema, input);
  const scoped = scopedFor(prisma, user);
  try {
    return await scoped.$transaction(async tx => {
      const actor = await authorizeClientAgentStaff(tx, user, clientId);
      const where = { organizationId: actor.organizationId, clientId };
      let row;
      if (revision === 0) {
        row = await tx.clientAgentProfile.create({ data: { ...where, ...fields, portalEnabled: false,
          revision: 1, createdById: actor.id, updatedById: actor.id }, select });
      } else {
        const current = await tx.clientAgentProfile.findFirst({ where, select: { id: true, organizationId: true, clientId: true, revision: true } });
        if (!current || current.organizationId !== actor.organizationId || current.clientId !== clientId || current.revision !== revision) conflict();
        const changed = await tx.clientAgentProfile.updateMany({ where: { ...where, id: current.id, revision },
          data: { ...fields, portalEnabled: false, updatedById: actor.id, revision: { increment: 1 } } });
        if (changed.count !== 1) conflict();
        row = await tx.clientAgentProfile.findFirst({ where: { ...where, id: current.id }, select });
      }
      if (!row || row.organizationId !== actor.organizationId || row.clientId !== clientId || row.revision !== revision + 1) conflict();
      const event = await recordAuditEvent(tx, { organizationId: actor.organizationId, actorUserId: actor.id,
        actorType: 'USER', entityId: row.id, action: revision === 0 ? 'client_agent_profile.created' : 'client_agent_profile.updated',
        metadata: { revision: row.revision, clientId, enabled: fields.enabled, pluginIds: fields.pluginIds } });
      if (!event) fail('PROFILE_AUDIT_UNAVAILABLE', 'The profile could not be saved with its audit record.', 503);
      return project(row);
    });
  } catch (error) {
    if (error?.code === 'P2002' || error?.code === 'P2034') conflict();
    if (error instanceof ToolError) throw error;
    fail('PROFILE_UNAVAILABLE', 'Account manager profile unavailable.', 503);
  }
}
