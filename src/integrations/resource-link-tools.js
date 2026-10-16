import { z } from 'zod';
import { ToolError } from '../ai/tools/registry.js';
import * as service from '../services/resource-links.service.js';
import * as schemas from '../validators/resource-links.schemas.js';

export async function resourceLinkToolCall(work) {
  try { return await work(); } catch (error) {
    if (error instanceof ToolError) throw error;
    const code = { 400: 'INVALID_INPUT', 403: 'ROLE_DENIED', 404: 'RECORD_NOT_FOUND', 409: 'TARGET_UNAVAILABLE', 503: 'STORAGE_UNAVAILABLE' }[error.statusCode];
    if (code) throw new ToolError(code, error.message, { statusCode: error.statusCode });
    throw error;
  }
}
const id = z.string().min(1).max(100);
function read(name, description, inputSchema, work) {
  return { name, description, class: 'read', roles: ['ADMIN', 'TEAM'], inputSchema, timeoutMs: 15_000,
    resolveScope: ({ prisma, user, input }) => resourceLinkToolCall(async () => ({ ids: { organizationId: user.organizationId }, records: { output: await work(prisma, input, user) } })),
    run: ({ scope }) => scope.records.output };
}
const operations = [
  { name: 'create_resource_link', schema: schemas.resourceLinkCreateSchema,
    prepare: service.prepareCreateResourceLink, execute: service.createResourceLinkInTransaction },
  { name: 'update_resource_link', schema: schemas.resourceLinkUpdateBaseSchema.extend({ id }),
    prepare: service.prepareUpdateResourceLink, execute: service.updateResourceLinkInTransaction },
  ...[true, false].map(archived => ({ name: archived ? 'archive_resource_link' : 'restore_resource_link',
    schema: schemas.resourceLinkArchiveSchema.omit({ archived: true }).extend({ id }),
    prepare: (p, input) => service.prepareArchiveResourceLink(p, { ...input, archived }),
    execute: service.archiveResourceLinkInTransaction })),
  { name: 'reorder_resource_links', schema: schemas.resourceLinkReorderBaseSchema,
    prepare: service.prepareReorderResourceLinks, execute: service.reorderResourceLinksInTransaction },
];
export async function previewResourceLinkAction(prisma, operation, input, actor) {
  const prepared = await operation.prepare(prisma, { ...input, actor });
  return { kind: operation.name, sharedWith: 'Active organization staff; client visibility requires an explicit change',
    ...prepared.summary, fingerprint: prepared.fingerprint };
}
async function reviewed(prisma, operation, input, actor, fingerprint) {
  const prepared = await operation.prepare(prisma, { ...input, actor });
  if (!fingerprint || fingerprint !== prepared.fingerprint) throw new ToolError('TARGET_UNAVAILABLE', 'The resource link preview changed. Review it again.', { statusCode: 409 });
  return prepared;
}
export const RESOURCE_LINK_TOOLS = [
  read('list_resource_links', 'Page through named HTTP(S) references on one canonical project or task. Preserves exact URLs and immutable source provenance; does not fetch external content.', schemas.resourceLinkListSchema.extend({ includeArchived: z.boolean().default(false) }),
    (p, input, actor) => service.listResourceLinks(p, { ...input, actor })),
  read('get_resource_link', 'Read a named reference with its current revision and original source edge. Does not fetch or preview the external URL.', z.object({ id }).strict(),
    (p, input, actor) => service.getResourceLink(p, { ...input, actor })),
  ...operations.flatMap(operation => [
    read(`preview_${operation.name}`, 'Validate the exact proposed reference change without writing or following its URL. Review its fingerprint before preparing the separately confirmed action.', operation.schema,
      (p, input, actor) => previewResourceLinkAction(p, operation, input, actor)),
    { name: operation.name, description: 'Prepare the reviewed reference change. Current staff authority, parent availability, ownership, source provenance, revisions and complete order are rechecked during confirmed execution.',
      class: 'execute', roles: ['ADMIN', 'TEAM'], requiresConfirmation: true, idempotency: 'required', timeoutMs: 15_000,
      inputSchema: operation.schema.extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }),
      resolveScope: ({ prisma, user, input: { fingerprint, ...input } }) => resourceLinkToolCall(async () => {
        const prepared = await reviewed(prisma, operation, input, user, fingerprint);
        return { ids: { organizationId: user.organizationId, ...(input.id ? { resourceLinkId: input.id } : {}), ...(input.entityId ? { entityId: input.entityId } : {}) },
          records: { preview: { kind: operation.name, ...prepared.summary, fingerprint } } };
      }),
      preview: ({ scope }) => scope.records.preview,
      rollback: 'Failure rolls back the reference change, required audit and execution receipt. Archive and restore retain source provenance; reverse a committed change through a fresh reviewed action.',
      execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: ({ prisma, user, input: { fingerprint, ...input } }) => resourceLinkToolCall(async () => {
        const prepared = await reviewed(prisma, operation, input, user, fingerprint);
        return operation.execute(prisma, prepared);
      }) },
    },
  ]),
];
