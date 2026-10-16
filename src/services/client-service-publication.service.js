import { isDeepStrictEqual } from 'node:util';
import { ToolError, recordNotFound, targetUnavailable } from '../ai/tools/registry.js';
import { serviceMappingParamsSchema, serviceSnapshotSchema, requireClientServiceAdmin, publishClientServiceSnapshotInTransaction } from './client-service-panels.service.js';

export const servicePublicationInputSchema = serviceMappingParamsSchema.extend({ snapshot: serviceSnapshotSchema }).strict();
const same = (mapping, input, organizationId) => mapping && mapping.id === input.mappingId && mapping.clientId === input.clientId
  && mapping.organizationId === organizationId && mapping.provider === 'OPENSEO' && mapping.providerProjectId === input.snapshot.providerProjectIdMatch;
/** Authority for receipts is independent of the revision advanced by publication. */
export async function authorizeServicePublicationReceipt(prisma, identity, action) {
  const parsed = servicePublicationInputSchema.safeParse(action.input);
  if (!parsed.success) throw targetUnavailable();
  const input = parsed.data;
  const actor = await requireClientServiceAdmin(prisma, identity, input.clientId);
  const mapping = await prisma.clientServiceProject.findFirst({ where: { id: input.mappingId, organizationId: actor.organizationId, clientId: input.clientId } });
  if (!same(mapping, input, actor.organizationId)) throw recordNotFound();
  return { actor, mapping, input };
}
export async function previewServicePublication(prisma, identity, input) {
  const { actor, mapping } = await authorizeServicePublicationReceipt(prisma, identity, { input });
  if (!mapping.enabled || mapping.revision !== input.snapshot.mappingRevision) throw targetUnavailable('Saved report mapping changed; review a new preview');
  if (input.snapshot.reports.some(row => row.sourceReportedAt && new Date(row.sourceReportedAt) > new Date())) throw new ToolError('INVALID_INPUT', 'Source report times cannot be in the future');
  const client = await prisma.client.findFirst({ where: { id: input.clientId, organizationId: actor.organizationId, deletedAt: null }, select: { id: true, name: true } });
  if (!client) throw recordNotFound();
  const ids = input.snapshot.reports.map(row => row.providerReportId);
  const where = { organizationId: actor.organizationId, clientId: input.clientId, mappingId: mapping.id };
  const existingCount = await prisma.clientServiceReport.count({ where });
  const replacedCount = input.snapshot.outcome === 'OK' ? await prisma.clientServiceReport.count({ where: { ...where, providerReportId: { in: ids } } }) : 0;
  const deletedCount = input.snapshot.outcome === 'UNAVAILABLE' || !input.snapshot.complete ? 0
    : await prisma.clientServiceReport.count({ where: { ...where, ...(ids.length ? { providerReportId: { notIn: ids } } : {}) } });
  return { kind: 'publish_client_service_report_snapshot', source: 'ADMIN_PUBLISHED_SNAPSHOT',
    destination: { clientId: client.id, clientName: client.name, mappingId: mapping.id, displayLabel: mapping.displayLabel,
      provider: mapping.provider, providerProjectId: mapping.providerProjectId },
    snapshot: input.snapshot, effects: { suppliedCount: ids.length, replacedCount, deletedCount,
      retainedCount: existingCount - replacedCount - deletedCount, preservesLastGood: input.snapshot.outcome === 'UNAVAILABLE' },
    warning: 'Administrator-supplied saved metadata; no provider connection or authenticity verification. Complete snapshots permanently remove omitted saved reports.' };
}
export async function executeServicePublication({ prisma, user, approver, input, preview }) {
  await requireClientServiceAdmin(prisma, approver, input.clientId);
  if (approver.organizationId !== user.organizationId) throw recordNotFound();
  const current = await previewServicePublication(prisma, user, input);
  if (!isDeepStrictEqual(current, preview)) throw targetUnavailable('Saved report preview changed; review again');
  const result = await publishClientServiceSnapshotInTransaction(prisma, user, input.clientId, input.mappingId, input.snapshot);
  return { publication: result };
}
