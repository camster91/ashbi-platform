import { collectionCreateSchema, collectionUpdateSchema, recordCreateSchema, recordUpdateSchema, recordFormCreateSchema, recordFormUpdateSchema, recordFormSubmitSchema } from '../validators/workspace-records.schemas.js';
import { validateRecordDefinitions, calculateRecordFields } from '../shared/record-calculations.js';
import { recordValuePatch, validateRecordDefinitionUpdate, validateRecordForm, recordFormSubmission } from '../shared/record-inputs.js';
import { withStageTransaction } from './task-stages.service.js';
import { recordAuditEvent } from './audit-event.service.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const parse = (schema, input) => { const result = schema.safeParse(input); if (!result.success) fail(400, 'Provide valid bounded record fields and the observed revisions.'); return result.data; };
const txWrite = (prisma, work) => withStageTransaction(prisma, work, 'Records or collection fields changed while saving. Reload and review your draft.');
const models = { CLIENT: 'client', PROJECT: 'project', TASK: 'task', PERSON: 'user' };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export async function currentRecordStaff(prisma, actor) {
  if (typeof actor?.id !== 'string' || !actor.id || typeof actor.organizationId !== 'string' || !actor.organizationId) fail(403, 'Team access required');
  // Confirmed MCP execution supplies only id/org: role is resolved fresh here.
  const current = await prisma.user.findFirst({ where: { id: actor.id, organizationId: actor.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true, organizationId: true, role: true } });
  if (!current) fail(403, 'Team access required');
  return current;
}
function pageOptions(options = {}) {
  const { after, limit = 25, search = '', includeArchived = false, portfolio } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || typeof search !== 'string' || search.length > 200 || typeof includeArchived !== 'boolean' || (after !== undefined && (typeof after !== 'string' || !after || after.length > 80)) || (portfolio !== undefined && !['ASHBI_DESIGN', 'FREELANCE', 'UNCLASSIFIED'].includes(portfolio))) fail(400, 'Invalid record page options.');
  return { after, limit, search, includeArchived, portfolio };
}
async function collectionFor(prisma, id, actor, includeArchived = false) {
  const collection = await prisma.workspaceCollection.findFirst({ where: { id, organizationId: actor.organizationId, ...(includeArchived ? {} : { archivedAt: null }) } });
  if (!collection) fail(404, 'Collection not found');
  return collection;
}
async function catalogFor(prisma, fields, actor, override) {
  const catalog = Object.create(null);
  const ids = [...new Set(fields.filter(field => field?.type === 'RELATION' && typeof field.collectionId === 'string' && field.collectionId.length > 0 && field.collectionId.length <= 80).map(field => field.collectionId))];
  if (ids.length) {
    const rows = await prisma.workspaceCollection.findMany({ where: { id: { in: ids }, organizationId: actor.organizationId }, select: { id: true, fields: true, archivedAt: true }, take: 40 });
    for (const row of rows) catalog[row.id] = row.fields;
  }
  if (override) catalog[override.id] = override.fields;
  return catalog;
}
async function audit(prisma, actor, entity, action, metadata = {}) {
  const event = await recordAuditEvent(prisma, { organizationId: actor.organizationId, actorUserId: actor.id, actorType: 'USER', entityId: entity.id, action, metadata: { revision: entity.revision, ...metadata } });
  if (!event) fail(503, 'Record could not be saved with its audit evidence. Your draft is retained.');
}
function canonicalWhere(field, organizationId) {
  return field.target === 'TASK' ? { deletedAt: null, project: { organizationId, deletedAt: null } }
    : { organizationId, ...(field.target === 'PERSON' ? { isActive: true, role: { in: ['ADMIN', 'TEAM'] } } : { deletedAt: null }) };
}
async function relationRows(prisma, field, ids, actor, { search, after, limit, valueKeys = [] } = {}) {
  if (field.target) {
    const label = field.target === 'TASK' ? 'title' : 'name';
    return prisma[models[field.target]].findMany({ where: { ...canonicalWhere(field, actor.organizationId), ...(ids ? { id: { in: ids } } : after ? { id: { gt: after } } : {}), ...(search ? { [label]: { contains: search, mode: 'insensitive' } } : {}) },
      select: { id: true, [label]: true }, orderBy: { id: 'asc' }, take: limit ?? 100 });
  }
  const parent = await prisma.workspaceCollection.findFirst({ where: { id: field.collectionId, organizationId: actor.organizationId, archivedAt: null }, select: { id: true } });
  if (!parent) return [];
  const rows = await prisma.workspaceRecord.findMany({ where: { collectionId: field.collectionId, organizationId: actor.organizationId, archivedAt: null, ...(ids ? { id: { in: ids } } : after ? { id: { gt: after } } : {}), ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}) }, select: { id: true, title: true, ...(valueKeys.length ? { values: true } : {}) }, orderBy: { id: 'asc' }, take: limit ?? 100 });
  return rows.map(row => ({ id: row.id, title: row.title, values: Object.fromEntries(valueKeys.filter(key => own(row.values ?? {}, key)).map(key => [key, row.values[key]])) }));
}
async function validateRelations(prisma, fields, values, changedKeys, actor) {
  for (const field of fields.filter(field => field.type === 'RELATION' && !field.archived && changedKeys.includes(field.key))) {
    const ids = values[field.key] ?? [];
    if (!ids.length) continue;
    const rows = await relationRows(prisma, field, ids, actor);
    if (rows.length !== ids.length || ids.some(id => !rows.some(row => row.id === id))) fail(404, 'Related records are unavailable in this workspace.');
  }
}
async function decorateRecords(prisma, collection, records, actor) {
  const catalog = await catalogFor(prisma, collection.fields, actor, collection);
  // Batch bounded rosters per field across the page. Only retain the stored
  // scalar targets needed for rollups, never every related record's content.
  const cache = new Map();
  let selectedCount = 0;
  for (const field of collection.fields.filter(field => field.type === 'RELATION' && !field.archived)) {
    const ids = [...new Set(records.flatMap(record => Array.isArray(record.values?.[field.key]) ? record.values[field.key] : []))];
    if (ids.some(id => typeof id !== 'string' || !id || id.length > 80)) fail(400, 'Record relation data is invalid.');
    selectedCount += records.reduce((count, record) => count + (Array.isArray(record.values?.[field.key]) ? record.values[field.key].length : 0), 0);
    if (selectedCount > 5000) fail(400, 'This page has too many relations. Use a smaller record page.');
    const valueKeys = [...new Set(collection.fields.filter(item => item.type === 'ROLLUP' && !item.archived && item.relationKey === field.key && item.targetKey).map(item => item.targetKey))];
    const rows = new Map();
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = await relationRows(prisma, field, ids.slice(offset, offset + 100), actor, { valueKeys });
      for (const row of batch) rows.set(row.id, row);
    }
    cache.set(field.key, rows);
  }
  const output = [];
  for (const record of records) {
    const resolved = {}, relations = {};
    for (const field of collection.fields.filter(field => field.type === 'RELATION' && !field.archived)) {
      const ids = record.values?.[field.key] ?? [];
      if (!Array.isArray(ids) || ids.length > 100) continue;
      const roster = cache.get(field.key);
      const rows = ids.map(id => roster.get(id)).filter(Boolean);
      relations[field.key] = ids.map(id => { const row = roster.get(id); return row ? { id, name: row.name ?? row.title, available: true } : { id, name: 'Unavailable record', available: false }; });
      resolved[field.key] = { complete: rows.length === ids.length, items: rows.map(row => ({ id: row.id, values: row.values ?? {} })) };
    }
    output.push({ ...record, definitionRevision: collection.schemaRevision, computed: calculateRecordFields(collection.fields, record.values, resolved, catalog), relations });
  }
  return output;
}

export async function listWorkspaceCollections(prisma, options, actor) {
  actor = await currentRecordStaff(prisma, actor);
  const { after, limit, search, includeArchived, portfolio } = pageOptions(options);
  const rows = await prisma.workspaceCollection.findMany({ where: { organizationId: actor.organizationId, ...(includeArchived ? {} : { archivedAt: null }), ...(after ? { id: { gt: after } } : {}), ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}), ...(portfolio ? { portfolio: portfolio === 'UNCLASSIFIED' ? null : portfolio } : {}) }, orderBy: { id: 'asc' }, take: limit + 1 });
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
}
export async function readWorkspaceCollection(prisma, id, actor, includeArchived = false) {
  actor = await currentRecordStaff(prisma, actor);
  return collectionFor(prisma, id, actor, includeArchived);
}
export async function createWorkspaceCollection(prisma, input, actor) { return txWrite(prisma, tx => createWorkspaceCollectionInTransaction(tx, input, actor)); }
export async function createWorkspaceCollectionInTransaction(tx, input, actor) {
  actor = await currentRecordStaff(tx, actor);
  const data = parse(collectionCreateSchema, input);
  const catalog = await catalogFor(tx, data.fields, actor);
  validateRecordDefinitions(data.fields, catalog);
  for (const field of data.fields.filter(field => field.type === 'RELATION' && field.collectionId)) await collectionFor(tx, field.collectionId, actor);
  const collection = await tx.workspaceCollection.create({ data: { ...data, organizationId: actor.organizationId, authorId: actor.id } });
  await audit(tx, actor, collection, 'workspace_collection.created', { schemaRevision: collection.schemaRevision });
  return collection;
}
export async function updateWorkspaceCollection(prisma, id, input, actor) { return txWrite(prisma, tx => updateWorkspaceCollectionInTransaction(tx, id, input, actor)); }
export async function updateWorkspaceCollectionInTransaction(tx, id, input, actor) {
  actor = await currentRecordStaff(tx, actor);
  const { revision, archived, ...changes } = parse(collectionUpdateSchema, input);
  const current = await collectionFor(tx, id, actor, true);
  if (revision !== current.revision) fail(409, 'Collection changed. Reload before saving.');
  if (current.archivedAt && Object.keys(changes).length && archived !== false) fail(409, 'Restore the collection before editing it.');
  if (changes.fields) {
    const override = { id, fields: changes.fields };
    const catalog = await catalogFor(tx, changes.fields, actor, override);
    validateRecordDefinitionUpdate(current.fields, changes.fields, catalog);
    for (const field of changes.fields.filter(field => field.type === 'RELATION' && field.collectionId && !field.archived)) {
      if (!current.fields.some(old => old.key === field.key && !old.archived) && field.collectionId !== id) await collectionFor(tx, field.collectionId, actor);
    }
    // Validate incoming rollups against this proposed schema, across all pages.
    let cursor;
    do {
      const rows = await tx.workspaceCollection.findMany({ where: { organizationId: actor.organizationId, fields: { array_contains: [{ type: 'RELATION', collectionId: id }] }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 100 });
      for (const dependent of rows.filter(row => row.id !== id)) {
        const dependentCatalog = await catalogFor(tx, dependent.fields, actor, override);
        validateRecordDefinitions(dependent.fields, dependentCatalog);
      }
      cursor = rows.length === 100 ? rows.at(-1).id : null;
    } while (cursor);
    // Reject schema changes that make current active records unusable. Add a
    // field as optional, fill it, then make it required once data is ready.
    cursor = undefined;
    do {
      const rows = await tx.workspaceRecord.findMany({ where: { collectionId: id, organizationId: actor.organizationId, archivedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 100, select: { id: true, values: true } });
      for (const record of rows) recordValuePatch(changes.fields, record.values, {}, catalog);
      cursor = rows.length === 100 ? rows.at(-1).id : null;
    } while (cursor);
  }
  const changed = await tx.workspaceCollection.updateMany({ where: { id, organizationId: actor.organizationId, revision }, data: { ...changes, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}), revision: { increment: 1 }, ...(changes.fields ? { schemaRevision: { increment: 1 } } : {}) } });
  if (changed.count !== 1) fail(409, 'Collection changed. Reload before saving.');
  const saved = await collectionFor(tx, id, actor, true);
  await audit(tx, actor, saved, 'workspace_collection.updated', { schemaRevision: saved.schemaRevision, archived: Boolean(saved.archivedAt) });
  return saved;
}

export async function listWorkspaceRecords(prisma, collectionId, options, actor) {
  actor = await currentRecordStaff(prisma, actor);
  const { after, limit, search, includeArchived } = pageOptions(options);
  const collection = await collectionFor(prisma, collectionId, actor, includeArchived);
  const rows = await prisma.workspaceRecord.findMany({ where: { collectionId, organizationId: actor.organizationId, ...(includeArchived ? {} : { archivedAt: null }), ...(after ? { id: { gt: after } } : {}), ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1 });
  return { items: await decorateRecords(prisma, collection, rows.slice(0, limit), actor), nextCursor: rows.length > limit ? rows[limit - 1].id : null, definitionRevision: collection.schemaRevision };
}
export async function readWorkspaceRecord(prisma, collectionId, recordId, actor, includeArchived = false) {
  actor = await currentRecordStaff(prisma, actor);
  const collection = await collectionFor(prisma, collectionId, actor, includeArchived);
  const record = await prisma.workspaceRecord.findFirst({ where: { id: recordId, collectionId, organizationId: actor.organizationId, ...(includeArchived ? {} : { archivedAt: null }) } });
  if (!record) fail(404, 'Record not found');
  return (await decorateRecords(prisma, collection, [record], actor))[0];
}
export async function createWorkspaceRecord(prisma, collectionId, input, actor) { return txWrite(prisma, tx => createWorkspaceRecordInTransaction(tx, collectionId, input, actor)); }
export async function createWorkspaceRecordInTransaction(tx, collectionId, input, actor) {
  actor = await currentRecordStaff(tx, actor);
  const data = parse(recordCreateSchema, input);
  const collection = await collectionFor(tx, collectionId, actor);
  if (data.definitionRevision !== collection.schemaRevision) fail(409, 'Collection fields changed. Reload before submitting.');
  const catalog = await catalogFor(tx, collection.fields, actor, collection);
  const values = recordValuePatch(collection.fields, {}, data.values, catalog);
  await validateRelations(tx, collection.fields, values, Object.keys(values), actor);
  const record = await tx.workspaceRecord.create({ data: { collectionId, organizationId: actor.organizationId, authorId: actor.id, title: data.title, values } });
  await audit(tx, actor, record, 'workspace_record.created', { collectionId });
  return (await decorateRecords(tx, collection, [record], actor))[0];
}
export async function updateWorkspaceRecord(prisma, collectionId, recordId, input, actor) { return txWrite(prisma, tx => updateWorkspaceRecordInTransaction(tx, collectionId, recordId, input, actor)); }
export async function updateWorkspaceRecordInTransaction(tx, collectionId, recordId, input, actor) {
  actor = await currentRecordStaff(tx, actor);
  const { revision, definitionRevision, archived, values: patch, ...changes } = parse(recordUpdateSchema, input);
  const collection = await collectionFor(tx, collectionId, actor, archived === true && patch === undefined && !changes.title);
  if (definitionRevision !== collection.schemaRevision) fail(409, 'Collection fields changed. Reload before saving.');
  const current = await tx.workspaceRecord.findFirst({ where: { id: recordId, collectionId, organizationId: actor.organizationId } });
  if (!current) fail(404, 'Record not found');
  if (current.revision !== revision) fail(409, 'Record changed. Your draft is retained; reload before saving.');
  if (current.archivedAt && (patch || changes.title) && archived !== false) fail(409, 'Restore the record before editing it.');
  const catalog = await catalogFor(tx, collection.fields, actor, collection);
  const values = archived === true && patch === undefined ? current.values : recordValuePatch(collection.fields, current.values, patch ?? {}, catalog);
  await validateRelations(tx, collection.fields, values, archived === false ? collection.fields.filter(field => field.type === 'RELATION' && !field.archived).map(field => field.key) : Object.keys(patch ?? {}), actor);
  const changed = await tx.workspaceRecord.updateMany({ where: { id: recordId, collectionId, organizationId: actor.organizationId, revision }, data: { ...changes, ...(patch ? { values } : {}), ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}), revision: { increment: 1 } } });
  if (changed.count !== 1) fail(409, 'Record changed. Reload before saving.');
  const saved = await tx.workspaceRecord.findFirst({ where: { id: recordId, collectionId, organizationId: actor.organizationId } });
  await audit(tx, actor, saved, 'workspace_record.updated', { collectionId, archived: Boolean(saved.archivedAt) });
  return (await decorateRecords(tx, collection, [saved], actor))[0];
}

export async function recordRelationOptions(prisma, collectionId, fieldKey, options, actor) {
  actor = await currentRecordStaff(prisma, actor);
  const collection = await collectionFor(prisma, collectionId, actor);
  const field = collection.fields.find(field => field.key === fieldKey && field.type === 'RELATION' && !field.archived);
  if (!field) fail(404, 'Relation field not found');
  const opts = pageOptions(options);
  const rows = await relationRows(prisma, field, undefined, actor, { ...opts, limit: opts.limit + 1 });
  return { items: rows.slice(0, opts.limit).map(row => ({ id: row.id, name: row.name ?? row.title })), nextCursor: rows.length > opts.limit ? rows[opts.limit - 1].id : null };
}
export async function listWorkspaceRecordForms(prisma, collectionId, options, actor) {
  actor = await currentRecordStaff(prisma, actor);
  const opts = pageOptions(options);
  const collection = await collectionFor(prisma, collectionId, actor, opts.includeArchived);
  const rows = await prisma.workspaceRecordForm.findMany({ where: { collectionId, organizationId: actor.organizationId, ...(opts.includeArchived ? {} : { archivedAt: null }), ...(opts.after ? { id: { gt: opts.after } } : {}), ...(opts.search ? { configuration: { path: ['name'], string_contains: opts.search } } : {}) }, orderBy: { id: 'asc' }, take: opts.limit + 1 });
  return { items: rows.slice(0, opts.limit).map(row => ({ ...row, needsReview: row.configuration.definitionRevision !== collection.schemaRevision })), nextCursor: rows.length > opts.limit ? rows[opts.limit - 1].id : null };
}
export async function readWorkspaceRecordForm(prisma, collectionId, formId, actor, includeArchived = false) {
  actor = await currentRecordStaff(prisma, actor);
  const collection = await collectionFor(prisma, collectionId, actor, includeArchived);
  const form = await prisma.workspaceRecordForm.findFirst({ where: { id: formId, collectionId, organizationId: actor.organizationId, ...(includeArchived ? {} : { archivedAt: null }) } });
  if (!form) fail(404, 'Record form not found');
  return { ...form, needsReview: form.configuration.definitionRevision !== collection.schemaRevision };
}
export async function createWorkspaceRecordForm(prisma, collectionId, input, actor) { return txWrite(prisma, tx => createWorkspaceRecordFormInTransaction(tx, collectionId, input, actor)); }
export async function createWorkspaceRecordFormInTransaction(tx, collectionId, input, actor) {
  actor = await currentRecordStaff(tx, actor);
  const { configuration } = parse(recordFormCreateSchema, input);
  const collection = await collectionFor(tx, collectionId, actor);
  validateRecordForm(configuration, collection.fields, collection.schemaRevision, await catalogFor(tx, collection.fields, actor, collection));
  const defaults = Object.fromEntries(configuration.fields.filter(item => own(item, 'defaultValue')).map(item => [item.key, item.defaultValue]));
  await validateRelations(tx, collection.fields, defaults, Object.keys(defaults), actor);
  const form = await tx.workspaceRecordForm.create({ data: { collectionId, organizationId: actor.organizationId, authorId: actor.id, configuration } });
  await audit(tx, actor, form, 'workspace_record_form.created', { collectionId });
  return { ...form, needsReview: false };
}
export async function updateWorkspaceRecordForm(prisma, collectionId, formId, input, actor) { return txWrite(prisma, tx => updateWorkspaceRecordFormInTransaction(tx, collectionId, formId, input, actor)); }
export async function updateWorkspaceRecordFormInTransaction(tx, collectionId, formId, input, actor) {
  actor = await currentRecordStaff(tx, actor);
  const { revision, configuration, archived } = parse(recordFormUpdateSchema, input);
  const collection = await collectionFor(tx, collectionId, actor, archived === true && !configuration);
  const current = await tx.workspaceRecordForm.findFirst({ where: { id: formId, collectionId, organizationId: actor.organizationId } });
  if (!current) fail(404, 'Record form not found');
  if (current.revision !== revision) fail(409, 'Form changed. Reload before saving.');
  if (current.archivedAt && configuration && archived !== false) fail(409, 'Restore the form before editing it.');
  if (configuration) {
    validateRecordForm(configuration, collection.fields, collection.schemaRevision, await catalogFor(tx, collection.fields, actor, collection));
    const defaults = Object.fromEntries(configuration.fields.filter(item => own(item, 'defaultValue')).map(item => [item.key, item.defaultValue]));
    await validateRelations(tx, collection.fields, defaults, Object.keys(defaults), actor);
  }
  const changed = await tx.workspaceRecordForm.updateMany({ where: { id: formId, collectionId, organizationId: actor.organizationId, revision }, data: { ...(configuration ? { configuration } : {}), ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}), revision: { increment: 1 } } });
  if (changed.count !== 1) fail(409, 'Form changed. Reload before saving.');
  const saved = await tx.workspaceRecordForm.findFirst({ where: { id: formId, collectionId, organizationId: actor.organizationId } });
  await audit(tx, actor, saved, 'workspace_record_form.updated', { collectionId, archived: Boolean(saved.archivedAt) });
  return { ...saved, needsReview: saved.configuration.definitionRevision !== collection.schemaRevision };
}
export async function submitWorkspaceRecordForm(prisma, collectionId, formId, input, actor) { return txWrite(prisma, tx => submitWorkspaceRecordFormInTransaction(tx, collectionId, formId, input, actor)); }
export async function submitWorkspaceRecordFormInTransaction(tx, collectionId, formId, input, actor) {
  actor = await currentRecordStaff(tx, actor);
  const data = parse(recordFormSubmitSchema, input);
  const collection = await collectionFor(tx, collectionId, actor);
  const form = await tx.workspaceRecordForm.findFirst({ where: { id: formId, collectionId, organizationId: actor.organizationId, archivedAt: null } });
  if (!form) fail(404, 'Record form not found');
  if (form.revision !== data.revision || data.definitionRevision !== collection.schemaRevision || form.configuration.definitionRevision !== collection.schemaRevision) fail(409, 'Form or collection fields changed. Review the form before submitting.');
  const values = recordFormSubmission(form.configuration, collection.fields, collection.schemaRevision, data.values, await catalogFor(tx, collection.fields, actor, collection));
  const record = await createWorkspaceRecordInTransaction(tx, collectionId, { title: data.title, definitionRevision: data.definitionRevision, values }, actor);
  await audit(tx, actor, record, 'workspace_record_form.submitted', { collectionId, formId, formRevision: form.revision });
  return record;
}
