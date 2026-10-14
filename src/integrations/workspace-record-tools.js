import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ToolError } from '../ai/tools/registry.js';
import * as service from '../services/workspace-records.service.js';
import * as schemas from '../validators/workspace-records.schemas.js';

const id = z.string().min(1).max(80);
export function canonicalRecordPreview(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalRecordPreview);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalRecordPreview(value[key])]));
  return value;
}
const page = z.object({ limit: z.number().int().min(1).max(50).default(25), after: id.optional(), search: z.string().max(200).default(''), includeArchived: z.boolean().default(false) }).strict();
export async function recordToolCall(work) {
  try { return await work(); } catch (error) {
    if (error instanceof ToolError) throw error;
    const code = { 400: 'INVALID_INPUT', 403: 'ROLE_DENIED', 404: 'RECORD_NOT_FOUND', 409: 'TARGET_UNAVAILABLE', 503: 'STORAGE_UNAVAILABLE' }[error.statusCode];
    if (code) throw new ToolError(code, error.message, { statusCode: error.statusCode });
    throw error;
  }
}
function read(name, description, inputSchema, work) {
  return { name, description, class: 'read', roles: ['ADMIN', 'TEAM'], inputSchema, timeoutMs: 15_000,
    resolveScope: ({ prisma, user, input }) => recordToolCall(async () => ({ ids: { organizationId: user.organizationId }, records: { output: await work(prisma, input, user) } })),
    run: ({ scope }) => scope.records.output };
}
const operations = [
  { name: 'create_workspace_collection', schema: z.object({ data: schemas.collectionCreateSchema }).strict(),
    prepare: (p, i, u) => service.prepareWorkspaceCollectionCreate(p, i.data, u), execute: (p, i, u) => service.createWorkspaceCollectionInTransaction(p, i.data, u) },
  { name: 'update_workspace_collection', schema: z.object({ collectionId: id, data: schemas.collectionUpdateSchema }).strict(),
    prepare: (p, i, u) => service.prepareWorkspaceCollectionUpdate(p, i.collectionId, i.data, u), execute: (p, i, u) => service.updateWorkspaceCollectionInTransaction(p, i.collectionId, i.data, u) },
  { name: 'create_workspace_record', schema: z.object({ collectionId: id, data: schemas.recordCreateSchema }).strict(),
    prepare: (p, i, u) => service.prepareWorkspaceRecordCreate(p, i.collectionId, i.data, u), execute: (p, i, u) => service.createWorkspaceRecordInTransaction(p, i.collectionId, i.data, u) },
  { name: 'update_workspace_record', schema: z.object({ collectionId: id, recordId: id, data: schemas.recordUpdateSchema }).strict(),
    prepare: (p, i, u) => service.prepareWorkspaceRecordUpdate(p, i.collectionId, i.recordId, i.data, u), execute: (p, i, u) => service.updateWorkspaceRecordInTransaction(p, i.collectionId, i.recordId, i.data, u) },
  { name: 'create_workspace_record_form', schema: z.object({ collectionId: id, data: schemas.recordFormCreateSchema }).strict(),
    prepare: (p, i, u) => service.prepareWorkspaceRecordFormCreate(p, i.collectionId, i.data, u), execute: (p, i, u) => service.createWorkspaceRecordFormInTransaction(p, i.collectionId, i.data, u) },
  { name: 'update_workspace_record_form', schema: z.object({ collectionId: id, formId: id, data: schemas.recordFormUpdateSchema }).strict(),
    prepare: (p, i, u) => service.prepareWorkspaceRecordFormUpdate(p, i.collectionId, i.formId, i.data, u), execute: (p, i, u) => service.updateWorkspaceRecordFormInTransaction(p, i.collectionId, i.formId, i.data, u) },
  { name: 'submit_workspace_record_form', schema: z.object({ collectionId: id, formId: id, data: schemas.recordFormSubmitSchema }).strict(),
    prepare: (p, i, u) => service.prepareWorkspaceRecordFormSubmit(p, i.collectionId, i.formId, i.data, u), execute: (p, i, u) => service.submitWorkspaceRecordFormInTransaction(p, i.collectionId, i.formId, i.data, u) },
];
export async function previewWorkspaceRecordAction(prisma, operation, input, actor) {
  const prepared = await operation.prepare(prisma, input, actor);
  const preview = { kind: operation.name, sharedWith: 'Active organization staff', input,
    collection: prepared.collection ?? (operation.name === 'update_workspace_collection' ? prepared.current : null),
    before: prepared.current ?? null, form: prepared.form ?? null };
  if (prepared.values && prepared.collection) preview['proposedRecord'] = await service.previewWorkspaceRecordValues(prisma, prepared.collection, prepared.values, prepared.actor);
  const definitions = prepared.changes?.fields ?? prepared.collection?.fields ?? prepared.data?.fields ?? prepared.current?.fields ?? [];
  preview['relatedCollections'] = await service.recordDefinitionTargets(prisma, definitions, prepared.actor);
  const configuration = prepared.configuration ?? prepared.current?.configuration;
  if (configuration && prepared.collection) {
    const defaults = Object.fromEntries(configuration.fields.filter(field => Object.prototype.hasOwnProperty.call(field, 'defaultValue')).map(field => [field.key, field.defaultValue]));
    preview['formDefaults'] = await service.previewWorkspaceRecordValues(prisma, prepared.collection, defaults, prepared.actor);
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(canonicalRecordPreview({ version: 1, organizationId: prepared.actor.organizationId, actorId: prepared.actor.id, preview }))).digest('hex');
  return { ...preview, fingerprint };
}
export const WORKSPACE_RECORD_TOOLS = [
  read('list_workspace_collections', 'Page through shared standalone collections by name/portfolio; includes schema definitions and revisions.', page.extend({ portfolio: z.enum(['ASHBI_DESIGN', 'FREELANCE', 'UNCLASSIFIED']).optional() }), (p, i, u) => service.listWorkspaceCollections(p, i, u)),
  read('get_workspace_collection', 'Read one collection and its exact field schema/revisions.', z.object({ collectionId: id, includeArchived: z.boolean().default(false) }).strict(), (p, i, u) => service.readWorkspaceCollection(p, i.collectionId, u, i.includeArchived)),
  read('list_workspace_records', 'Page canonical records with typed values, complete calculations/errors and scoped relation names.', page.extend({ collectionId: id }), (p, { collectionId, ...i }, u) => service.listWorkspaceRecords(p, collectionId, i, u)),
  read('get_workspace_record', 'Read one canonical record with its original revision and complete calculations.', z.object({ collectionId: id, recordId: id, includeArchived: z.boolean().default(false) }).strict(), (p, i, u) => service.readWorkspaceRecord(p, i.collectionId, i.recordId, u, i.includeArchived)),
  read('list_workspace_record_forms', 'Page reusable forms; needsReview means schema review is required before submission.', page.extend({ collectionId: id }), (p, { collectionId, ...i }, u) => service.listWorkspaceRecordForms(p, collectionId, i, u)),
  read('get_workspace_record_form', 'Read one form configuration, defaults, revision and needsReview state.', z.object({ collectionId: id, formId: id, includeArchived: z.boolean().default(false) }).strict(), (p, i, u) => service.readWorkspaceRecordForm(p, i.collectionId, i.formId, u, i.includeArchived)),
  read('list_workspace_record_relation_options', 'Page available canonical/collection relation names inside this workspace.', page.omit({ includeArchived: true }).extend({ collectionId: id, fieldKey: id }), (p, { collectionId, fieldKey, ...i }, u) => service.recordRelationOptions(p, collectionId, fieldKey, i, u)),
  ...operations.flatMap(operation => [
    read(`preview_${operation.name}`, 'Validate and read the exact proposed record/collection/form change without writing. Use its fingerprint in a separately confirmed action.', operation.schema, (p, i, u) => previewWorkspaceRecordAction(p, operation, i, u)),
    { name: operation.name, description: 'Apply exactly the reviewed collection/record/form change. Rechecks stored staff role, schema/record revisions, relation scope and fingerprint; requires explicit human confirmation.', class: 'execute', roles: ['ADMIN', 'TEAM'], requiresConfirmation: true, idempotency: 'required', timeoutMs: 15_000,
      inputSchema: operation.schema.extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }),
      resolveScope: ({ prisma, user, input: { fingerprint, ...input } }) => recordToolCall(async () => {
        const preview = await previewWorkspaceRecordAction(prisma, operation, input, user);
        if (fingerprint !== preview.fingerprint) throw Object.assign(new Error('The record preview changed. Review it again.'), { statusCode: 409 });
        return { ids: { organizationId: user.organizationId, ...(input.collectionId ? { collectionId: input.collectionId } : {}), ...(input.recordId ? { recordId: input.recordId } : {}), ...(input.formId ? { formId: input.formId } : {}) }, records: { preview } };
      }),
      preview: ({ scope }) => scope.records.preview,
      rollback: 'Failure rolls back the domain write, required audit and execution receipt. Reverse committed changes through a new reviewed action with current revisions; archived data is retained.',
      execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: ({ prisma, user, input: { fingerprint, ...input } }) => recordToolCall(async () => {
        const preview = await previewWorkspaceRecordAction(prisma, operation, input, user);
        if (fingerprint !== preview.fingerprint) throw Object.assign(new Error('The record preview changed. Review it again.'), { statusCode: 409 });
        return operation.execute(prisma, input, user);
      }) },
    },
  ]),
];
