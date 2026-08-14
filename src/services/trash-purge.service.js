import ENTITY_MAP from '../utils/entity-map.js';

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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
      : { id: ledger.recordId, deletedAt: { not: null } };
    const original = await model.findFirst({
      where: originalWhere,
      select: { id: true },
    });

    if (original) await model.delete({ where: { id: ledger.recordId } });
    await transaction.trashedItem.delete({ where: { id: ledger.id } });

    return {
      deleted: Boolean(original),
      recordId: ledger.recordId,
      entity: ledger.entity,
    };
  }, { isolationLevel: 'Serializable' });
}

/** Restore one policy-hidden record after tenant ownership is proven. */
export async function restoreTrashedItem({ scopedPrisma, rawPrisma, trashId }) {
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
      : { id: ledger.recordId, deletedAt: { not: null } };
    const original = await model.findFirst({
      where: originalWhere,
      select: ledger.entity === 'MILESTONE' ? { id: true, projectId: true } : { id: true },
    });
    if (!original) throw httpError('Original record no longer exists', 404);

    const restoreData = { deletedAt: null };
    if (ledger.entity === 'NOTE') {
      const formerParentId = ledger.data?.parentId;
      const formerProjectId = ledger.data?.projectId;
      const activeParent = formerParentId && formerProjectId
        ? await transaction.note.findFirst({
            where: { id: formerParentId, projectId: formerProjectId, deletedAt: null },
            select: { id: true },
          })
        : null;
      restoreData.parentId = activeParent?.id || null;
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
