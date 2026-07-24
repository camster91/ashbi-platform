// Trash service — soft delete helper

import prisma from '../config/db.js';
import ENTITY_MAP from '../utils/entity-map.js';

/**
 * Soft-delete a record by setting deletedAt and creating a TrashedItem entry.
 * @param {string} entity - upper-case entity name (e.g. 'CLIENT')
 * @param {string} recordId - the record ID
 */
export async function softDelete(entity, recordId, organizationId = null) {
  const modelName = ENTITY_MAP[entity];
  const prismaModel = prisma[modelName];
  if (!prismaModel) throw new Error(`Unknown entity type: ${entity}`);

  const record = await prismaModel.findUnique({ where: { id: recordId } });
  if (!record) throw new Error(`${entity} not found`);

  const deletedAt = new Date();
  const expiresAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [, trashedItem] = await prisma.$transaction([
    prismaModel.update({
      where: { id: recordId },
      data: { deletedAt },
    }),
    prisma.trashedItem.create({
      data: {
        entity,
        recordId,
        organizationId: organizationId || record.organizationId || null,
        data: record,
        deletedAt,
        expiresAt,
      },
    }),
  ]);

  return { record, trashedItem };
}
