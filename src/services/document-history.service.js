import { z } from 'zod';
import { authorizeNote } from './note-access.service.js';
import { authorizeWorkspacePage, currentWikiStaff } from './workspace-page-authorization.js';
import { documentAudienceRights } from '../shared/document-audiences.js';
import { withStageTransaction } from './task-stages.service.js';
import { recordAuditEvent } from './audit-event.service.js';
import { noteUpdateV2Schema } from '../validators/schemas.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const versionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
// Use the validator mounted by note.routes, rather than the unused legacy
// noteUpdateSchema export, so every supported document kind can be restored.
const noteContentSchema = z.object({ title: noteUpdateV2Schema.shape.title.unwrap(), content: noteUpdateV2Schema.shape.content.unwrap(), type: noteUpdateV2Schema.shape.type.unwrap(), tags: z.string(), isPinned: z.boolean(), isTemplate: z.boolean() }).strict();
const pageContentSchema = z.object({ title: z.string().trim().min(1).max(200), content: z.string().max(50_000) }).strict();
function config(kind) {
  if (kind === 'note') return { model: 'note', history: 'noteRevision', foreignKey: 'noteId', authorize: authorizeNote, action: 'note.revision_restored' };
  if (kind === 'page') return { model: 'workspacePage', history: 'workspacePageRevision', foreignKey: 'pageId', authorize: authorizeWorkspacePage, action: 'workspace_page.revision_restored' };
  fail(400, 'Invalid document kind');
}
async function access(prisma, actor, kind, id, edit = false) {
  const spec = config(kind);
  if (typeof id !== 'string' || !id.length || id.length > 80) fail(400, 'Invalid document identifier');
  const user = await currentWikiStaff(prisma, actor);
  const authorized = await spec.authorize(prisma, id, user, { edit });
  return { spec, user: authorized.user, document: authorized.note ?? authorized.page };
}
function whereFor(spec, user, id) { return { organizationId: user.organizationId, [spec.foreignKey]: id }; }
function visible(row, user) { return row && row.organizationId === user.organizationId && documentAudienceRights(row.audienceNodes, user).canRead; }
function metadata(row, document) { return { revision: row.revision, title: row.title, recordedAt: row.recordedAt, editedById: row.editedById, isCurrent: row.revision === document.revision }; }
function contents(row, kind) {
  return { title: row.title, content: row.content, ...(kind === 'note' ? { type: row.type, tags: row.tags, isPinned: row.isPinned, isTemplate: row.isTemplate } : {}) };
}
async function snapshot(prisma, context, id, version) {
  if (!versionSchema.safeParse(version).success) fail(400, 'Invalid document revision');
  const row = await prisma[context.spec.history].findFirst({ where: { ...whereFor(context.spec, context.user, id), revision: version } });
  if (!visible(row, context.user)) fail(404, 'Document revision not found');
  return row;
}
export async function listDocumentHistory(prisma, user, kind, id) {
  const context = await access(prisma, user, kind, id);
  const rows = await prisma[context.spec.history].findMany({ where: whereFor(context.spec, context.user, id), orderBy: { revision: 'desc' }, take: 100, select: { organizationId: true, revision: true, title: true, recordedAt: true, editedById: true, audienceNodes: true } });
  return { items: rows.filter(row => visible(row, context.user)).map(row => metadata(row, context.document)), limit: 100, currentRevision: context.document.revision };
}
export async function readDocumentRevision(prisma, user, kind, id, version) {
  const context = await access(prisma, user, kind, id);
  const row = await snapshot(prisma, context, id, version);
  return { ...metadata(row, context.document), ...contents(row, kind), currentRevision: context.document.revision };
}
export async function restoreDocumentRevision(prisma, actor, kind, id, version, input) {
  const parsed = z.object({ revision: versionSchema }).strict().safeParse(input);
  if (!parsed.success) fail(400, 'Provide the current document revision');
  return withStageTransaction(prisma, async tx => {
    const context = await access(tx, actor, kind, id, true);
    const { user, document, spec } = context;
    if (user.role !== 'ADMIN') fail(403, 'Administrator access required to restore history');
    if (document.archivedAt || document.deletedAt) fail(409, 'Restore the document before restoring history');
    if (document.revision !== parsed.data.revision) fail(409, 'Document changed. Reload before restoring history.');
    const row = await snapshot(tx, context, id, version);
    const changes = contents(row, kind);
    if (!(kind === 'note' ? noteContentSchema : pageContentSchema).safeParse(changes).success) fail(409, 'This revision cannot be restored with the current document rules');
    if (kind === 'note') {
      let tags;
      try { tags = JSON.parse(changes.tags); } catch { fail(409, 'This revision contains invalid tags'); }
      if (!z.array(z.string().max(50)).max(20).safeParse(tags).success) fail(409, 'This revision contains invalid tags');
    }
    // Transaction-local setting attributes the trigger's new immutable snapshot.
    await tx.$executeRaw`SELECT set_config('ashbi.actor_user_id', ${user.id}, true)`;
    const changed = await tx[spec.model].updateMany({ where: { id, revision: parsed.data.revision, ...(kind === 'note' ? { project: { organizationId: user.organizationId }, deletedAt: null } : { organizationId: user.organizationId, archivedAt: null }) }, data: changes });
    if (changed.count !== 1) fail(409, 'Document changed. Reload before restoring history.');
    const updated = await tx[spec.model].findFirst({ where: { id, ...(kind === 'note' ? { project: { organizationId: user.organizationId } } : { organizationId: user.organizationId }) } });
    if (!updated || updated.revision <= document.revision) fail(503, 'Document history could not be recorded');
    const recorded = await tx[spec.history].findFirst({ where: { ...whereFor(spec, user, id), revision: updated.revision }, select: { revision: true } });
    if (!recorded) fail(503, 'Document history could not be recorded');
    const audit = await recordAuditEvent(tx, { organizationId: user.organizationId, actorUserId: user.id, actorType: 'USER', action: spec.action, entityId: id, metadata: { sourceRevision: version, previousRevision: document.revision, revision: updated.revision } });
    if (!audit) fail(503, 'Document history could not be restored with its audit record');
    return { documentId: id, revision: updated.revision, sourceRevision: version };
  }, 'Document changed. Reload before restoring history.');
}
