import ENTITY_MAP from '../utils/entity-map.js';

/** Soft-delete one tenant-owned record and create its recovery ledger atomically. */
export async function softDelete({ scopedPrisma, entity, recordId, organizationId, beforeDelete }) {
  const modelName = ENTITY_MAP[entity];
  if (!modelName) throw new Error(`Unknown entity type: ${entity}`);
  if (!organizationId) throw new Error('Organization context is required');

  return scopedPrisma.$transaction(async (transaction) => {
    const model = transaction[modelName];
    const record = await model.findUnique({ where: { id: recordId } });
    if (!record) throw new Error(`${entity} not found`);
    if (record.organizationId && record.organizationId !== organizationId) {
      throw new Error('Trash organization mismatch');
    }

    if (beforeDelete) await beforeDelete(transaction, record);

    const deletedAt = new Date();
    const expiresAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    await model.delete({ where: { id: recordId } });
    const trashedItem = await transaction.trashedItem.create({
      data: {
        entity,
        recordId,
        organizationId,
        data: JSON.parse(JSON.stringify(record)),
        deletedAt,
        expiresAt,
      },
    });

    return { record, trashedItem };
  });
}
