// Relation metadata for tenant-scoped write validation
// (src/utils/prisma-tenant-proxy.js).
//
// Derived at runtime from the generated Prisma client's data model
// (Prisma.dmmf). Prisma 7's runtime model omits `relationFromFields`, so a
// relation's foreign-key scalar is resolved by the schema's convention: the
// relation field `foo` is owned through the scalar `fooId`. Explicitly declared
// id/organization composite edges also retain the companion organization key.
// The unit test
// src/tests/unit/tenant-proxy-bypasses.test.js parses prisma/schema.prisma and fails
// if any `@relation(fields: [...])` in the schema disagrees with this map, so a
// relation that breaks the convention cannot slip through unchecked.

import prismaPkg from '@prisma/client';

/**
 * @typedef {{ target: string, fk: string | null, fkFields: string[] }} RelationInfo
 * @typedef {{ name: string, delegate: string, relations: Record<string, RelationInfo>, foreignKeys: Record<string, string> }} ModelRelations
 */

/** @type {Map<string, ModelRelations> | null} */
let cache = null;

// Prisma 7 omits relationFromFields. These deliberately supported composite
// edges bind a globally unique parent id to the same organization column the
// request proxy stamps and filters. Arbitrary composite keys remain unsupported.
export const COMPOSITE_TENANT_RELATIONS = Object.freeze({
  gmailsendreceipt: { user: ['userId', 'organizationId'] },
  clientserviceproject: { client: ['clientId', 'organizationId'] },
  clientservicereport: { client: ['clientId', 'organizationId'], mapping: ['mappingId', 'organizationId', 'clientId'] },
  clientagentprofile: { createdBy: ['createdById', 'organizationId'], updatedBy: ['updatedById', 'organizationId'] },
  clientagentconversation: { createdBy: ['createdById', 'organizationId'] },
  clientagentrun: { conversation: ['conversationId', 'organizationId'], requestedBy: ['requestedById', 'organizationId'] },
  workspacechatchannel: { createdBy: ['createdById', 'organizationId'] },
  workspacechatmember: { channel: ['channelId', 'organizationId'], user: ['userId', 'organizationId'] },
  workspacechatmessage: { channel: ['channelId', 'organizationId'], author: ['authorId', 'organizationId'] },
  workspacechatattention: { channel: ['channelId', 'organizationId'], message: ['messageId', 'organizationId'], recipient: ['recipientId', 'organizationId'] },
  workspacecollection: { author: ['authorId', 'organizationId'] },
  workspacerecord: { collection: ['collectionId', 'organizationId'], author: ['authorId', 'organizationId'] },
  workspacerecordform: { collection: ['collectionId', 'organizationId'], author: ['authorId', 'organizationId'] },
});

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
      const fkFields = COMPOSITE_TENANT_RELATIONS[model.name.toLowerCase()]?.[field.name] ?? (fk ? [fk] : []);
      if (fkFields.some(key => !scalars.has(key)) || (fkFields.length > 1 && (fkFields[0] !== fk || fkFields[1] !== 'organizationId' || !['User', 'Client', 'WorkspaceCollection', 'WorkspaceChatChannel', 'WorkspaceChatMessage', 'ClientAgentConversation', 'ClientServiceProject'].includes(field.type) || (fkFields.length > 2 && !(model.name === 'ClientServiceReport' && field.name === 'mapping' && fkFields.length === 3 && fkFields[2] === 'clientId'))))) throw new Error('Tenancy Error: unsupported composite relation');
      relations[field.name] = { target: String(field.type).toLowerCase(), fk, fkFields };
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
