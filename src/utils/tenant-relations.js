// Relation metadata for tenant-scoped write validation
// (src/utils/prisma-tenant-proxy.js).
//
// Derived at runtime from the generated Prisma client's data model
// (Prisma.dmmf). Prisma 7's runtime model omits `relationFromFields`, so a
// relation's foreign-key scalar is resolved by the schema's convention: the
// relation field `foo` is owned through the scalar `fooId`. The unit test
// src/tests/unit/tenant-proxy-bypasses.test.js parses prisma/schema.prisma and fails
// if any `@relation(fields: [...])` in the schema disagrees with this map, so a
// relation that breaks the convention cannot slip through unchecked.

import prismaPkg from '@prisma/client';

/**
 * @typedef {{ target: string, fk: string | null }} RelationInfo
 * @typedef {{ name: string, delegate: string, relations: Record<string, RelationInfo>, foreignKeys: Record<string, string> }} ModelRelations
 */

/** @type {Map<string, ModelRelations> | null} */
let cache = null;

function delegateName(modelName) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

/**
 * Model key (lower-case model name) -> its relations and foreign keys.
 * @returns {Map<string, ModelRelations>}
 */
export function tenantRelationMap() {
  if (cache) return cache;
  const models = /** @type {any} */ (prismaPkg)?.Prisma?.dmmf?.datamodel?.models;
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('Tenancy Error: Prisma data model is unavailable; scoped writes cannot be validated');
  }
  /** @type {Map<string, ModelRelations>} */
  const map = new Map();
  for (const model of models) {
    const scalars = new Set(model.fields.filter((field) => field.kind === 'scalar').map((field) => field.name));
    /** @type {Record<string, RelationInfo>} */
    const relations = {};
    /** @type {Record<string, string>} */
    const foreignKeys = {};
    for (const field of model.fields) {
      if (field.kind !== 'object') continue;
      const fk = scalars.has(`${field.name}Id`) ? `${field.name}Id` : null;
      relations[field.name] = { target: String(field.type).toLowerCase(), fk };
      if (fk) foreignKeys[fk] = field.name;
    }
    map.set(model.name.toLowerCase(), { name: model.name, delegate: delegateName(model.name), relations, foreignKeys });
  }
  cache = map;
  return map;
}

/** @param {string} modelKey */
export function relationsFor(modelKey) {
  return tenantRelationMap().get(modelKey) ?? null;
}
