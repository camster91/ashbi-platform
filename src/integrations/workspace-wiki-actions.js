import { z } from 'zod';
import { workspacePageCreateSchema, workspacePageUpdateSchema, workspacePageAccessSchema } from '../validators/schemas.js';
import { createWorkspacePageInTransaction, updateWorkspacePageInTransaction, listWorkspacePages, readWorkspacePage, validateWorkspacePageChange } from '../services/workspace-pages.service.js';
import { authorizeWorkspacePage } from '../services/workspace-page-authorization.js';
import { validateWorkspacePageAccess, saveWorkspacePageAccessInTransaction } from '../services/workspace-page-access.service.js';
import { targetUnavailable } from '../ai/tools/registry.js';
import { wikiToolCall } from './workspace-wiki-tool-errors.js';

const pageId = z.string().min(1).max(80);
async function currentActor(prisma, user) {
  const actor = await prisma.user.findFirst({ where: { id: user.id, organizationId: user.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true, organizationId: true, role: true } });
  if (!actor) throw targetUnavailable();
  return actor;
}
export const WORKSPACE_WIKI_ACTIONS = [
  {
    name: 'set_workspace_page_access', description: 'Set shared-team or restricted page access. Owner and organization administrators retain access; ancestor restrictions still apply. Requires observed access revision and human review; can change descendant visibility.',
    class: 'execute', roles: ['ADMIN', 'TEAM'], requiresConfirmation: true, idempotency: 'required', timeoutMs: 10_000,
    inputSchema: workspacePageAccessSchema.safeExtend({ pageId }).strict().refine(input => input.mode === 'RESTRICTED' || input.members.length === 0),
    resolveScope: ({ prisma, user, input }) => wikiToolCall(async () => { const { pageId: id, ...data } = input; const scope = await validateWorkspacePageAccess(prisma, id, data, user); return { ids: { pageId: id, organizationId: user.organizationId }, records: scope }; }),
    preview: async ({ input, scope }) => ({ kind: 'set_workspace_page_access', pageId: input.pageId, revision: input.revision, before: scope.records.current, after: { mode: input.mode, members: scope.records.proposed }, ownerAndAdminsRetainAccess: true, parentRestrictionsApply: scope.records.current.parentRestrictionsApply, descendantVisibilityCanChange: true }),
    rollback: 'Failure restores grants, page settings, audit and receipt. Reverse a committed change through a fresh preview with the latest access revision.',
    execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: async ({ prisma, user, input }) => { const { pageId: id, ...data } = input; return saveWorkspacePageAccessInTransaction(prisma, id, data, await currentActor(prisma, user)); } },
  },
  {
    name: 'create_workspace_page', description: 'Create shared Ashbi team knowledge without a client or project. Preview includes exact Markdown and parent; requires human confirmation.',
    class: 'execute', roles: ['ADMIN', 'TEAM'], requiresConfirmation: true, idempotency: 'required', timeoutMs: 10_000,
    inputSchema: workspacePageCreateSchema,
    resolveScope: ({ prisma, user, input }) => wikiToolCall(async () => {
      await listWorkspacePages(prisma, { limit: 1 }, user);
      const parent = input.parentId ? await readWorkspacePage(prisma, input.parentId, user) : null;
      if (input.parentId) await authorizeWorkspacePage(prisma, input.parentId, user, { edit: true, includeArchived: false });
      return { ids: { organizationId: user.organizationId }, records: { parent } };
    }),
    preview: async ({ input, scope }) => ({ kind: 'create_workspace_page', sharedWith: input.accessMode === 'RESTRICTED' ? 'Page owner and organization administrators' : 'Active organization staff', parentRestrictionsApply: Boolean(input.parentId), title: input.title, content: input.content, parent: scope.records.parent ? { id: scope.records.parent.id, title: scope.records.parent.title } : null }),
    rollback: 'Failure rolls back page, audit and receipt. After creation, use a fresh confirmed update to archive the retained page.',
    execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: async ({ prisma, user, input }) => createWorkspacePageInTransaction(prisma, input, await currentActor(prisma, user)) },
  },
  {
    name: 'update_workspace_page', description: 'Edit, move, archive or restore one shared workspace knowledge page with its observed revision. Preview shows current and proposed content; requires human confirmation.',
    class: 'execute', roles: ['ADMIN', 'TEAM'], requiresConfirmation: true, idempotency: 'required', timeoutMs: 10_000,
    inputSchema: workspacePageUpdateSchema.safeExtend({ pageId }).strict().refine(input => ['title', 'content', 'parentId', 'archived'].some(key => input[key] !== undefined)),
    resolveScope: ({ prisma, user, input }) => wikiToolCall(async () => {
      const { pageId: id, ...data } = input;
      await validateWorkspacePageChange(prisma, id, data, user);
      const current = await readWorkspacePage(prisma, input.pageId, user, true);
      if (current.revision !== input.revision) throw targetUnavailable('Knowledge page revision changed');
      if (current.archivedAt && input.archived !== false) throw targetUnavailable('Restore this page before editing it');
      const parentId = input.parentId === undefined ? current.parentId : input.parentId;
      const parent = parentId ? await readWorkspacePage(prisma, parentId, user) : null;
      return { ids: { pageId: current.id, organizationId: user.organizationId }, records: { current, parent } };
    }),
    preview: async ({ input, scope }) => ({ kind: 'update_workspace_page', pageId: input.pageId, revision: input.revision, before: { title: scope.records.current.title, content: scope.records.current.content, parentId: scope.records.current.parentId, archived: Boolean(scope.records.current.archivedAt) }, after: { title: input.title ?? scope.records.current.title, content: input.content ?? scope.records.current.content, parentId: input.parentId === undefined ? scope.records.current.parentId : input.parentId, archived: input.archived ?? Boolean(scope.records.current.archivedAt) }, parentName: scope.records.parent?.title ?? null, promotesActiveChildren: input.archived === true }),
    rollback: 'Failure rolls back page, audit and receipt. Reversing a committed change needs a fresh preview and revision; historical overwritten content is not automatically recoverable.',
    execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: async ({ prisma, user, input }) => { const { pageId: id, ...data } = input; return updateWorkspacePageInTransaction(prisma, id, data, await currentActor(prisma, user)); } },
  },
];
