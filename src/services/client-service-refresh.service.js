import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { ToolError } from '../ai/tools/registry.js';
import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';
import { requireClientServiceAdmin, serviceMappingParamsSchema } from './client-service-panels.service.js';
import { recordAuditEvent } from './audit-event.service.js';
import { revealCredentialSecret } from './credential-vault.service.js';
import { isOpenSeoCredential, readOpenSeoReports } from './openseo-report-reader.js';

export const serviceRefreshSchema = z.object({ mappingRevision: z.number().int().min(1).max(2147483646) }).strict();
const fail = (code, message, statusCode) => { throw new ToolError(code, message, { statusCode }); };
const conflict = () => fail('SERVICE_PANEL_CONFLICT', 'The saved report configuration changed. Reload before refreshing.', 409);
const fingerprint = row => createHash('sha256').update(JSON.stringify([row.id, row.organizationId, row.clientId, row.projectId, row.url, row.username, row.password, row.updatedAt])).digest('hex');
const eligible = (row, actor, clientId) => row && row.organizationId === actor.organizationId && row.clientId === clientId && isOpenSeoCredential(row);

export async function listClientServiceCredentials(prisma, user, clientId) {
  const actor = await requireClientServiceAdmin(prisma, user, clientId);
  const choices = [];
  const deadline = performance.now() + 5000;
  let after, truncated = false;
  // Keep only one 100-row metadata page and at most 101 eligible choices.
  // Exhaust ordered candidates or find a 101st eligible row before reporting
  // truncation. A slow traversal fails closed rather than silently omitting
  // late valid choices. URL substring filters would exclude valid normalized
  // forms, such as encoded hostnames/default ports, so parsing stays decisive.
  while (true) {
    if (performance.now() >= deadline) fail('SERVICE_PANEL_UNAVAILABLE', 'Credential choices could not be completely checked. Try again.', 503);
    const rows = await prisma.credential.findMany({ where: { organizationId: actor.organizationId, clientId, projectId: null,
      username: { not: '' }, url: { not: null }, ...(after ? { id: { gt: after } } : {}) },
    select: { id: true, organizationId: true, clientId: true, projectId: true, label: true, username: true, url: true }, orderBy: { id: 'asc' }, take: 100 });
    if (performance.now() >= deadline) fail('SERVICE_PANEL_UNAVAILABLE', 'Credential choices could not be completely checked. Try again.', 503);
    for (const row of rows) {
      if (eligible(row, actor, clientId)) choices.push({ id: row.id, label: row.label, usernamePresent: true });
      if (choices.length === 101) break;
    }
    if (choices.length === 101) { truncated = true; break; }
    if (rows.length < 100) break;
    after = rows.at(-1).id;
  }
  // Traversal must not return metadata after the caller's authority changed.
  await requireClientServiceAdmin(prisma, user, clientId);
  return { credentials: choices.slice(0, 100), truncated };
}

async function lockAuthority(tx, user, clientId, credentialId) {
  // All locks are held only in short DB phases, never during provider latency.
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${user.id} AND "organizationId"=${user.organizationId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "clients" WHERE "id"=${clientId} AND "organizationId"=${user.organizationId} FOR SHARE`;
  if (credentialId) await tx.$queryRaw`SELECT "id" FROM "credentials" WHERE "id"=${credentialId} AND "organizationId"=${user.organizationId} FOR SHARE`;
  const actor = await requireClientServiceAdmin(tx, user, clientId);
  const client = await tx.client.findFirst({ where: { id: clientId, organizationId: actor.organizationId, deletedAt: null }, select: { status: true, relationshipStatus: true } });
  if (!client || !['ACTIVE', 'PROSPECT'].includes(client.status) || ['ARCHIVED', 'CHURNED'].includes(client.relationshipStatus)) fail('ROLE_DENIED', 'An active canonical client is required.', 403);
  return actor;
}

/** Production defaults always use the fixed-origin SDK transport; injection is for offline protocol fixtures. */
export async function refreshClientServiceReports(prisma, user, clientId, mappingId, input, { reader = readOpenSeoReports } = {}) {
  const params = serviceMappingParamsSchema.safeParse({ clientId, mappingId });
  const fields = serviceRefreshSchema.safeParse(input);
  if (!params.success || !fields.success) fail('INVALID_INPUT', 'Provide a current saved report mapping revision.', 400);
  if (!user?.id || !user.organizationId || user.role !== 'ADMIN') fail('ROLE_DENIED', 'Administrator access required.', 403);
  const db = createScopedPrisma(prisma, user.organizationId);
  const where = { id: mappingId, organizationId: user.organizationId, clientId };
  try {
    const prepared = await db.$transaction(async tx => {
      const actor = await lockAuthority(tx, user, clientId);
      const mapping = await tx.clientServiceProject.findFirst({ where });
      if (!mapping?.enabled || mapping.provider !== 'OPENSEO' || mapping.revision !== fields.data.mappingRevision) conflict();
      if (!mapping.credentialId) fail('AUTH_REQUIRED', 'Bind an OpenSEO public proxy credential before refreshing.', 409);
      await tx.$queryRaw`SELECT "id" FROM "credentials" WHERE "id"=${mapping.credentialId} AND "organizationId"=${actor.organizationId} FOR SHARE`;
      const credential = await tx.credential.findFirst({ where: { id: mapping.credentialId, organizationId: actor.organizationId, clientId, projectId: null } });
      if (!eligible(credential, actor, clientId)) fail('AUTH_REQUIRED', 'A client-owned OpenSEO public proxy credential is required.', 409);
      const password = await revealCredentialSecret({ prisma: tx, credential, context: { organizationId: actor.organizationId, actorUserId: actor.id, purpose: 'read OpenSEO saved reports', route: '/api/clients/:clientId/service-panels/:mappingId/refresh' } });
      return { mapping, credentialFingerprint: fingerprint(credential), username: credential.username, password };
    }, { isolationLevel: 'Serializable' });
    let result;
    try { result = await reader({ projectId: prepared.mapping.providerProjectId, username: prepared.username, password: prepared.password }); }
    catch { result = { reports: [], partial: true, providerTotalCount: null, outcome: 'UNAVAILABLE' }; }
    finally { prepared.password = null; prepared.username = null; }
    return await db.$transaction(async tx => {
      const actor = await lockAuthority(tx, user, clientId, prepared.mapping.credentialId);
      const mapping = await tx.clientServiceProject.findFirst({ where });
      const credential = await tx.credential.findFirst({ where: { id: prepared.mapping.credentialId, organizationId: actor.organizationId, clientId, projectId: null } });
      if (!mapping?.enabled || mapping.provider !== 'OPENSEO' || mapping.providerProjectId !== prepared.mapping.providerProjectId || mapping.revision !== prepared.mapping.revision || mapping.credentialId !== prepared.mapping.credentialId || !eligible(credential, actor, clientId) || fingerprint(credential) !== prepared.credentialFingerprint) conflict();
      const now = new Date();
      const changed = await tx.clientServiceProject.updateMany({ where: { ...where, enabled: true, revision: prepared.mapping.revision, credentialId: prepared.mapping.credentialId, providerProjectId: prepared.mapping.providerProjectId },
        data: { revision: { increment: 1 }, lastAttemptAt: now, lastRefreshedAt: now, refreshOutcome: result.outcome, refreshPartial: true, providerTotalCount: result.providerTotalCount,
          lastOutcome: result.outcome === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'OK', failureCode: result.outcome === 'UNAVAILABLE' ? 'PROVIDER_UNAVAILABLE' : null,
          ...(result.outcome === 'UNAVAILABLE' ? {} : { lastSuccessAt: now }) } });
      if (changed.count !== 1) conflict();
      for (const report of result.reports) {
        const reportWhere = { organizationId: actor.organizationId, clientId, mappingId, providerReportId: report.providerReportId };
        const data = { title: report.title, summary: report.summary, sourceReportedAt: null, providerEditedAt: report.providerEditedAt, provenance: 'OPENSEO_SAVED_REPORT_PULL', hubStoredAt: now };
        const previous = await tx.clientServiceReport.findFirst({ where: reportWhere, select: { id: true } });
        if (previous) await tx.clientServiceReport.updateMany({ where: { ...reportWhere, id: previous.id }, data });
        else await tx.clientServiceReport.create({ data: { ...reportWhere, ...data } });
      }
      const event = await recordAuditEvent(tx, { organizationId: actor.organizationId, actorUserId: actor.id, actorType: 'USER', entityId: mappingId, action: 'client_service_project.refreshed',
        metadata: { clientId, revision: mapping.revision + 1, outcome: result.outcome, reportCount: result.reports.length, partial: true } });
      if (!event) fail('SERVICE_PANEL_AUDIT_UNAVAILABLE', 'Saved reports could not be refreshed with an audit record.', 503);
      return { id: mappingId, revision: mapping.revision + 1, outcome: result.outcome, partial: true, storedReportCount: await tx.clientServiceReport.count({ where: { organizationId: actor.organizationId, clientId, mappingId } }) };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (['P2002', 'P2034'].includes(error?.code)) conflict();
    if (error instanceof ToolError) throw error;
    fail('SERVICE_PANEL_UNAVAILABLE', 'Saved reports could not be refreshed.', 503);
  }
}
