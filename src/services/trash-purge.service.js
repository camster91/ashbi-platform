import { noteRestoreData } from './note-access.service.js';
import ENTITY_MAP from '../utils/entity-map.js';

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export const RESOURCE_LINK_RETENTION_CODE = 'RESOURCE_LINK_RETENTION';
const RETENTION_MESSAGE = 'This item contains retained resource links and cannot be permanently deleted. Restore it to manage its resources.';
export const isResourceLinkRetention = error => error?.statusCode === 409 && error?.code === RESOURCE_LINK_RETENTION_CODE;
const retentionError = () => Object.assign(httpError(RETENTION_MESSAGE, 409), { code: RESOURCE_LINK_RETENTION_CODE });
const resourceConstraints = new Set(['resource_links_projectId_organizationId_fkey', 'resource_links_taskId_projectId_fkey']);
function isResourceForeignKey(error) {
  return error?.code === 'P2003' && [error.meta?.field_name, error.meta?.constraint, error.meta?.driverAdapterError?.cause?.constraint?.index].some(value => typeof value === 'string' && resourceConstraints.has(value.replace(/ \(index\)$/, '')));
}

async function guardRetainedResources(tx, ledger) {
  const { organizationId, recordId, entity } = ledger;
  if (!['TASK', 'PROJECT', 'CLIENT'].includes(entity)) return;
  // Use the same project-first locking order as resource creation. Raw queries
  // intentionally see soft-deleted parents; retained provenance is archive-only.
  let where;
  if (entity === 'TASK') {
    const project = await tx.project.findFirst({ where: { organizationId, tasks: { some: { id: recordId } } }, select: { id: true } });
    if (!project) return;
    await tx.$queryRaw`SELECT id FROM projects WHERE id=${project.id} AND "organizationId"=${organizationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM tasks WHERE id=${recordId} AND "projectId"=${project.id} FOR UPDATE`;
    where = { organizationId, taskId: recordId };
  } else if (entity === 'PROJECT') {
    await tx.$queryRaw`SELECT id FROM projects WHERE id=${recordId} AND "organizationId"=${organizationId} FOR UPDATE`;
    where = { organizationId, projectId: recordId };
  } else {
    await tx.$queryRaw`SELECT id FROM projects WHERE "clientId"=${recordId} AND "organizationId"=${organizationId} ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM clients WHERE id=${recordId} AND "organizationId"=${organizationId} FOR UPDATE`;
    where = { organizationId, project: { clientId: recordId, organizationId } };
  }
  if (await tx.resourceLink.findFirst({ where, select: { id: true } })) throw retentionError();
}

/**
 * Permanently delete one soft-deleted record after proving that its trash
 * ledger belongs to the caller's tenant. The raw client is deliberately
 * confined to one serializable transaction so policy interception cannot
 * turn the final delete back into another soft delete.
 */
export async function permanentlyDeleteTrashedItem({ scopedPrisma, rawPrisma, trashId }) {
  const authorizedLedger = await scopedPrisma.trashedItem.findFirst({
    where: { id: trashId, restoredAt: null },
  });

  if (!authorizedLedger) throw httpError('Trashed item not found', 404);

  return rawPrisma.$transaction(async (transaction) => {
    const ledger = await transaction.trashedItem.findFirst({
      where: {
        id: authorizedLedger.id,
        organizationId: authorizedLedger.organizationId,
        restoredAt: null,
      },
    });

    if (!ledger) throw httpError('Trashed item is no longer available', 409);

    const modelName = ENTITY_MAP[ledger.entity];
    const model = modelName ? transaction[modelName] : null;
    if (!model) throw new Error(`Unknown trash entity: ${ledger.entity}`);

    const originalWhere = ledger.entity === 'MILESTONE'
      ? { id: ledger.recordId, deletedAt: { not: null }, project: { client: { organizationId: ledger.organizationId } } }
      : ledger.entity === 'TASK'
        ? { id: ledger.recordId, deletedAt: { not: null }, project: { organizationId: ledger.organizationId } }
        : ['PROJECT', 'CLIENT'].includes(ledger.entity)
          ? { id: ledger.recordId, deletedAt: { not: null }, organizationId: ledger.organizationId }
          : { id: ledger.recordId, deletedAt: { not: null } };
    const original = await model.findFirst({
      where: originalWhere,
      select: { id: true },
    });

    if (original) {
      await guardRetainedResources(transaction, ledger);
      try {
        await model.delete({ where: { id: ledger.recordId } });
      } catch (error) {
        // Only recognized resource FKs map to retention. Other integrity or
        // database failures retain their original error and retry semantics.
        if (['TASK', 'PROJECT', 'CLIENT'].includes(ledger.entity) && isResourceForeignKey(error)) throw retentionError();
        throw error;
      }
    }
    await transaction.trashedItem.delete({ where: { id: ledger.id } });

    return {
      deleted: Boolean(original),
      recordId: ledger.recordId,
      entity: ledger.entity,
    };
  }, { isolationLevel: 'Serializable' });
}

/** Restore one policy-hidden record after tenant ownership is proven. */
export async function restoreTrashedItem({ scopedPrisma, rawPrisma, trashId, actor }) {
  const authorizedLedger = await scopedPrisma.trashedItem.findFirst({
    where: { id: trashId, restoredAt: null },
  });
  if (!authorizedLedger) throw httpError('Trashed item not found', 404);

  return rawPrisma.$transaction(async (transaction) => {
    const ledger = await transaction.trashedItem.findFirst({
      where: {
        id: authorizedLedger.id,
        organizationId: authorizedLedger.organizationId,
        restoredAt: null,
      },
    });
    if (!ledger) throw httpError('Trashed item is no longer available', 409);

    const modelName = ENTITY_MAP[ledger.entity];
    const model = modelName ? transaction[modelName] : null;
    if (!model) throw new Error(`Unknown trash entity: ${ledger.entity}`);

    const originalWhere = ledger.entity === 'MILESTONE'
      ? { id: ledger.recordId, deletedAt: { not: null }, project: { client: { organizationId: ledger.organizationId } } }
      : ledger.entity === 'TASK'
        ? { id: ledger.recordId, deletedAt: { not: null }, project: { organizationId: ledger.organizationId } }
        : ['PROJECT', 'CLIENT'].includes(ledger.entity)
          ? { id: ledger.recordId, deletedAt: { not: null }, organizationId: ledger.organizationId }
          : { id: ledger.recordId, deletedAt: { not: null } };
    const original = await model.findFirst({
      where: originalWhere,
      select: ledger.entity === 'MILESTONE' ? { id: true, projectId: true } : { id: true },
    });
    if (!original) throw httpError('Original record no longer exists', 404);

    const restoreData = { deletedAt: null };
    if (ledger.entity === 'NOTE') {
      Object.assign(restoreData, await noteRestoreData(transaction, ledger.recordId, actor));
    }
    await model.update({ where: { id: ledger.recordId }, data: restoreData });
    if (ledger.entity === 'MILESTONE' && Array.isArray(ledger.data?.taskIds) && ledger.data.taskIds.length > 0) {
      await transaction.task.updateMany({
        where: {
          id: { in: ledger.data.taskIds },
          projectId: original.projectId,
          milestoneId: null,
          project: { client: { organizationId: ledger.organizationId } },
        },
        data: { milestoneId: ledger.recordId },
      });
    }
    await transaction.trashedItem.update({
      where: { id: ledger.id },
      data: { restoredAt: new Date() },
    });
    return { restoredId: ledger.recordId, entity: ledger.entity };
  }, { isolationLevel: 'Serializable' });
}
