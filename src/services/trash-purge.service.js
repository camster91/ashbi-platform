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

    const original = await model.findFirst({
      where: { id: ledger.recordId, deletedAt: { not: null } },
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
