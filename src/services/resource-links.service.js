import { createHash } from 'node:crypto';
import { resourceLinkCreateSchema, resourceLinkUpdateSchema, resourceLinkArchiveSchema, resourceLinkReorderSchema, resourceLinkTargetSchema, resourceLinkPageSchema } from '../validators/resource-links.schemas.js';
const fail = (message = 'Resource link unavailable', statusCode = 404) => { throw Object.assign(new Error(message), { statusCode, code: statusCode === 409 ? 'RESOURCE_LINK_CONFLICT' : 'RESOURCE_LINK_UNAVAILABLE' }); };
const parse = (schema, input) => {
    const r = schema.safeParse(input);
    if (!r.success)
        fail('Invalid resource link input', 400);
    return r.data;
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const liveProject = organizationId => ({ organizationId, deletedAt: null, client: { organizationId, deletedAt: null } });
export async function authorizeResourceLinkStaff(db, claims) {
    if (!claims?.id || !claims.organizationId)
        fail('Staff access required', 403);
    const actor = await db.user.findFirst({ where: { id: claims.id, organizationId: claims.organizationId, isActive: true }, select: { id: true, organizationId: true, role: true, isActive: true } });
    if (!actor?.isActive || !['ADMIN', 'TEAM'].includes(actor.role) || actor.id !== claims.id || actor.organizationId !== claims.organizationId)
        fail('Staff access required', 403);
    return actor;
}
async function target(db, actor, input) {
    const value = parse(resourceLinkTargetSchema, { entityType: input.entityType, entityId: input.entityId });
    let task = null;
    if (value.entityType === 'TASK') {
        task = await db.task.findFirst({ where: { id: value.entityId, deletedAt: null, project: liveProject(actor.organizationId) }, select: { id: true, projectId: true } });
        if (!task)
            fail();
    }
    const project = await db.project.findFirst({ where: { id: task?.projectId ?? value.entityId, ...liveProject(actor.organizationId) }, select: { id: true, organizationId: true, clientId: true } });
    if (!project)
        fail();
    return { ...value, projectId: project.id, taskId: task?.id ?? null, clientId: project.clientId };
}
const whereTarget = (actor, t) => ({ organizationId: actor.organizationId, projectId: t.projectId, taskId: t.taskId });
const editable = (actor, row) => actor.role === 'ADMIN' || actor.id === row.createdById;
export function resourceLinkDto(row, actor) { return { id: row.id, entityType: row.taskId ? 'TASK' : 'PROJECT', entityId: row.taskId ?? row.projectId, projectId: row.projectId, taskId: row.taskId, title: row.title, url: row.url, position: row.position, revision: row.revision, clientVisible: row.clientVisible, archivedAt: row.archivedAt, createdById: row.createdById, createIntentId: row.createIntentId, createdAt: row.createdAt, updatedAt: row.updatedAt, source: row.source ?? null, canEdit: editable(actor, row) }; }
async function rowFor(db, actor, id) {
    const row = await db.resourceLink.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!row)
        fail();
    const canonical = await target(db, actor, { entityType: row.taskId ? 'TASK' : 'PROJECT', entityId: row.taskId ?? row.projectId });
    if (canonical.projectId !== row.projectId || canonical.taskId !== row.taskId) fail();
    return row;
}
function page(input) { return parse(resourceLinkPageSchema, { limit: input.limit, after: input.after }); }
function cursorWhere(after) {
    if (!after)
        return {};
    try {
        const c = JSON.parse(Buffer.from(after, 'base64url').toString());
        if (!Number.isInteger(c.position) || typeof c.id !== 'string' || c.id.length > 100)
            throw Error();
        return { OR: [{ position: { gt: c.position } }, { position: c.position, id: { gt: c.id } }] };
    }
    catch {
        fail('Invalid cursor', 400);
    }
}
function paged(rows, limit, map) { const more = rows.length > limit; const items = rows.slice(0, limit); const last = items.at(-1); return { items: items.map(map), nextCursor: more ? Buffer.from(JSON.stringify({ position: last.position, id: last.id })).toString('base64url') : null }; }
export async function listResourceLinks(db, input) { const actor = await authorizeResourceLinkStaff(db, input.actor); const t = await target(db, actor, input); const p = page(input); const rows = await db.resourceLink.findMany({ where: { ...whereTarget(actor, t), ...(input.includeArchived ? {} : { archivedAt: null }), ...cursorWhere(p.after) }, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: p.limit + 1 }); return paged(rows, p.limit, r => resourceLinkDto(r, actor)); }
export async function getResourceLink(db, { actor: claims, id }) { const actor = await authorizeResourceLinkStaff(db, claims); return resourceLinkDto(await rowFor(db, actor, id), actor); }
async function prepare(db, args, kind) {
    const { actor: claims, id, ...payload } = args;
    if (['update', 'archive'].includes(kind) ? (typeof id !== 'string' || !id || id.length > 100) : id !== undefined) fail('Invalid resource link input', 400);
    const actor = await authorizeResourceLinkStaff(db, claims);
    const schema = { create: resourceLinkCreateSchema, update: resourceLinkUpdateSchema, archive: resourceLinkArchiveSchema, reorder: resourceLinkReorderSchema }[kind];
    const input = parse(schema, payload);
    const row = ['update', 'archive'].includes(kind) ? await rowFor(db, actor, id) : null;
    if (row && !editable(actor, row))
        fail('Only the creator or an administrator can edit this resource', 403);
    if (row && row.revision !== input.expectedRevision)
        fail('Resource changed; refresh before saving', 409);
    const t = await target(db, actor, row ? { entityType: row.taskId ? 'TASK' : 'PROJECT', entityId: row.taskId ?? row.projectId } : input);
    const active = await db.resourceLink.findMany({ where: { ...whereTarget(actor, t), archivedAt: null }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    let receipt = null;
    if (kind === 'create') {
        receipt = await db.resourceLink.findFirst({ where: { organizationId: actor.organizationId, createdById: actor.id, createIntentId: input.createIntentId } });
        if (receipt && receipt.inputHash !== hash(input))
            fail('Create intent reused with changed input', 409);
    }
    if (!receipt && ((kind === 'create') || (kind === 'archive' && !input.archived && row.archivedAt)) && active.length >= 500)
        fail('Resource target has 500 active links', 409);
    if (kind === 'reorder' && (active.length !== input.ordered.length || input.ordered.some(x => !active.some(r => r.id === x.id && r.revision === x.expectedRevision))))
        fail('Active resource membership changed; refresh before ordering', 409);
    const maxPosition = kind === 'create' ? (await db.resourceLink.aggregate({ where: whereTarget(actor, t), _max: { position: true } }))._max.position : null;
    const snapshot = { maxPosition, actor: { id: actor.id, organizationId: actor.organizationId, role: actor.role }, target: t, row: row ? { id: row.id, revision: row.revision, archivedAt: row.archivedAt, title: row.title, url: row.url, source: row.source, clientVisible: row.clientVisible } : null, membership: active.map(r => ({ id: r.id, revision: r.revision, position: r.position })), receipt: receipt ? { id: receipt.id, revision: receipt.revision } : null, input };
    return { kind, actor: claims, input: { ...input, ...(id ? { id } : {}) }, target: t, fingerprint: hash(snapshot), summary: { action: kind, target: t, title: input.title ?? row?.title, url: input.url ?? row?.url, before: row ? resourceLinkDto(row, actor) : null, count: input.ordered?.length, ordered: input.ordered?.map((entry, position) => ({ id: entry.id, expectedRevision: entry.expectedRevision, position, before: resourceLinkDto(active.find(r => r.id === entry.id), actor) })), position: kind === 'create' ? ((maxPosition ?? -1) + 1) : undefined, clientVisible: input.clientVisible ?? row?.clientVisible ?? false, source: input.source ?? null }, snapshot };
}
export const prepareCreateResourceLink = (db, args) => prepare(db, args, 'create');
export const prepareUpdateResourceLink = (db, args) => prepare(db, args, 'update');
export const prepareArchiveResourceLink = (db, args) => prepare(db, args, 'archive');
export const prepareReorderResourceLinks = (db, args) => prepare(db, args, 'reorder');
async function execute(db, prepared) {
    // Lock the canonical project, actor and live client before revalidation. All
    // resource mutations on any task of the project share this lock.
    await db.$queryRaw `SELECT id FROM projects WHERE id=${prepared.target.projectId} AND "organizationId"=${prepared.actor.organizationId} FOR UPDATE`;
    await db.$queryRaw `SELECT id FROM users WHERE id=${prepared.actor.id} AND "organizationId"=${prepared.actor.organizationId} FOR SHARE`;
    await db.$queryRaw `SELECT id FROM clients WHERE id=${prepared.target.clientId} AND "organizationId"=${prepared.actor.organizationId} FOR SHARE`;
    if (prepared.target.taskId)
        await db.$queryRaw `SELECT id FROM tasks WHERE id=${prepared.target.taskId} AND "projectId"=${prepared.target.projectId} FOR SHARE`;
    const fresh = await prepare(db, { actor: prepared.actor, ...prepared.input }, prepared.kind);
    if (fresh.fingerprint !== prepared.fingerprint)
        fail('Resource changed; prepare again', 409);
    const actor = await authorizeResourceLinkStaff(db, prepared.actor);
    const { id, ...input } = fresh.input;
    let rows = [];
    if (prepared.kind === 'create') {
        const receipt = await db.resourceLink.findFirst({ where: { organizationId: actor.organizationId, createdById: actor.id, createIntentId: input.createIntentId } });
        if (receipt)
            return resourceLinkDto(receipt, actor);
        const aggregate = await db.resourceLink.aggregate({ where: whereTarget(actor, fresh.target), _max: { position: true } });
        const row = await db.resourceLink.create({ data: { organizationId: actor.organizationId, projectId: fresh.target.projectId, taskId: fresh.target.taskId, createdById: actor.id, title: input.title, url: input.url, clientVisible: input.clientVisible, createIntentId: input.createIntentId, inputHash: hash(input), ...(input.source ? { source: input.source } : {}), position: (aggregate._max.position ?? -1) + 1 } });
        rows = [row];
    }
    else if (prepared.kind === 'reorder') {
        for (let position = 0; position < input.ordered.length; position++) {
            const entry = input.ordered[position];
            const changed = await db.resourceLink.updateMany({ where: { id: entry.id, organizationId: actor.organizationId, revision: entry.expectedRevision, archivedAt: null }, data: { position, revision: { increment: 1 } } });
            if (changed.count !== 1)
                fail('Resource ordering conflict', 409);
        }
        rows = await db.resourceLink.findMany({ where: { ...whereTarget(actor, fresh.target), archivedAt: null }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    }
    else {
        const data = prepared.kind === 'archive' ? { archivedAt: input.archived ? new Date() : null } : Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'expectedRevision'));
        const changed = await db.resourceLink.updateMany({ where: { id, organizationId: actor.organizationId, revision: input.expectedRevision }, data: { ...data, revision: { increment: 1 } } });
        if (changed.count !== 1)
            fail('Resource revision conflict', 409);
        rows = [await db.resourceLink.findFirst({ where: { id, organizationId: actor.organizationId } })];
    }
    await db.auditEvent.create({ data: { organizationId: actor.organizationId, actorType: 'USER', actorUserId: actor.id, action: `resource_link.${prepared.kind}`, entityType: 'resource_link', entityId: prepared.kind === 'reorder' ? fresh.target.entityId : rows[0].id, metadata: { projectId: fresh.target.projectId, taskId: fresh.target.taskId, count: rows.length } } });
    return prepared.kind === 'reorder' ? { items: rows.map(r => resourceLinkDto(r, actor)) } : resourceLinkDto(rows[0], actor);
}
export const createResourceLinkInTransaction = execute;
export const updateResourceLinkInTransaction = execute;
export const archiveResourceLinkInTransaction = execute;
export const reorderResourceLinksInTransaction = execute;
async function ownTransaction(db, args, kind) {
    try {
        return await db.$transaction(async (tx) => execute(tx, await prepare(tx, args, kind)), { isolationLevel: 'Serializable' });
    }
    catch (error) {
        if (['P2034', 'P2002'].includes(error.code))
            fail('Resource conflict; refresh before retrying', 409);
        throw error;
    }
}
export const createResourceLink = (db, args) => ownTransaction(db, args, 'create');
export const updateResourceLink = (db, args) => ownTransaction(db, args, 'update');
export const archiveResourceLink = (db, args) => ownTransaction(db, args, 'archive');
export const reorderResourceLinks = (db, args) => ownTransaction(db, args, 'reorder');
export async function listClientResourceLinks(db, input) {
    const { organizationId, clientId, projectId } = input;
    const project = await db.project.findFirst({ where: { id: projectId, clientId, ...liveProject(organizationId), client: { organizationId, deletedAt: null, status: 'ACTIVE', relationshipStatus: { notIn: ['ARCHIVED', 'CHURNED'] } } }, select: { id: true } });
    if (!project)
        fail();
    const p = page(input);
    const rows = await db.resourceLink.findMany({ where: { organizationId, projectId, archivedAt: null, clientVisible: true, AND: [{ OR: [{ taskId: null }, { task: { deletedAt: null, projectId } }] }, cursorWhere(p.after)] }, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: p.limit + 1 });
    return paged(rows, p.limit, r => ({ id: r.id, title: r.title, url: r.url, position: r.position, updatedAt: r.updatedAt }));
}
export const currentResourceLinkStaff = authorizeResourceLinkStaff;
export const resourceLinkPortalQuerySchema = resourceLinkPageSchema;
