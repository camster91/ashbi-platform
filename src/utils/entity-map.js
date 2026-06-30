// Single source of truth for "trashable" entity types.
// Maps upper-case entity names (CLIENT, PROJECT, INVOICE, ...) to the
// prisma model name on the prisma client. Both the trash route handlers
// (which restore / permanently-delete) and the trash.service.js
// softDelete helper consume this. Frozen so accidental mutation throws.
//
// Adding a new trashable entity: append a row here + ensure the underlying
// model has `deletedAt DateTime?` for soft-delete to work.

const ENTITY_MAP = Object.freeze({
  CLIENT: 'client',
  PROJECT: 'project',
  INVOICE: 'invoice',
  PROPOSAL: 'proposal',
  CONTRACT: 'contract',
  EXPENSE: 'expense',
  TASK: 'task',
  ESTIMATE: 'estimate',
  NOTE: 'note',
  RETAINER_PLAN: 'retainerPlan',
});

export const TRASHABLE_ENTITIES = Object.freeze(
  Object.values(ENTITY_MAP).map((modelName) => modelName.toUpperCase())
);

export default ENTITY_MAP;
