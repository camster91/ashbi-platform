import { z } from 'zod';
import { workspacePageCreateSchema, workspacePageUpdateSchema } from '../validators/schemas.js';
import { createWorkspacePageInTransaction, updateWorkspacePageInTransaction, listWorkspacePages, readWorkspacePage, validateWorkspacePageParent } from '../services/workspace-pages.service.js';
import { targetUnavailable } from '../ai/tools/registry.js';

const pageId = z.string().min(1).max(80);
async function currentActor(prisma, user) {
  const actor = await prisma.user.findFirst({ where: { id: user.id, organizationId: user.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true, organizationId: true, role: true } });
  if (!actor) throw targetUnavailable();
  return actor;
}
export const WORKSPACE_WIKI_ACTIONS = [
  {
    name: 'create_workspace_page', description: 'Create shared Ashbi team knowledge without a client or project. Preview includes exact Markdown and parent; requires human confirmation.',
    class: 'execute', roles: ['ADMIN', 'TEAM'], requiresConfirmation: true, idempotency: 'required', timeoutMs: 10_000,
    inputSchema: workspacePageCreateSchema,
    resolveScope: async ({ prisma, user, input }) => {
      await listWorkspacePages(prisma, { limit: 1 }, user);
      const parent = input.parentId ? await readWorkspacePage(prisma, input.parentId, user) : null;
      return { ids: { organizationId: user.organizationId }, records: { parent } };
    },
    preview: async ({ input, scope }) => ({ kind: 'create_workspace_page', sharedWith: 'Active organization staff', title: input.title, content: input.content, parent: scope.records.parent ? { id: scope.records.parent.id, title: scope.records.parent.title } : null }),
    rollback: 'Failure rolls back page, audit and receipt. After creation, use a fresh confirmed update to archive the retained page.',
    execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: async ({ prisma, user, input }) => createWorkspacePageInTransaction(prisma, input, await currentActor(prisma, user)) },
  },
  {
    name: 'update_workspace_page', description: 'Edit, move, archive or restore one shared workspace knowledge page with its observed revision. Preview shows current and proposed content; requires human confirmation.',
    class: 'execute', roles: ['ADMIN', 'TEAM'], requiresConfirmation: true, idempotency: 'required', timeoutMs: 10_000,
    inputSchema: workspacePageUpdateSchema.innerType().extend({ pageId }).strict().refine(input => ['title', 'content', 'parentId', 'archived'].some(key => input[key] !== undefined)),
    resolveScope: async ({ prisma, user, input }) => {
      const current = await readWorkspacePage(prisma, input.pageId, user, true);
      if (current.revision !== input.revision) throw targetUnavailable('Knowledge page revision changed');
      if (current.archivedAt && input.archived !== false) throw targetUnavailable('Restore this page before editing it');
      const parentId = input.parentId === undefined ? current.parentId : input.parentId;
      await validateWorkspacePageParent(prisma, parentId, user.organizationId, current.id);
      const parent = parentId ? await readWorkspacePage(prisma, parentId, user) : null;
      return { ids: { pageId: current.id, organizationId: user.organizationId }, records: { current, parent } };
    },
    preview: async ({ input, scope }) => ({ kind: 'update_workspace_page', pageId: input.pageId, revision: input.revision, before: { title: scope.records.current.title, content: scope.records.current.content, parentId: scope.records.current.parentId, archived: Boolean(scope.records.current.archivedAt) }, after: { title: input.title ?? scope.records.current.title, content: input.content ?? scope.records.current.content, parentId: input.parentId === undefined ? scope.records.current.parentId : input.parentId, archived: input.archived ?? Boolean(scope.records.current.archivedAt) }, parentName: scope.records.parent?.title ?? null, promotesActiveChildren: input.archived === true }),
    rollback: 'Failure rolls back page, audit and receipt. Reversing a committed change needs a fresh preview and revision; historical overwritten content is not automatically recoverable.',
    execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: async ({ prisma, user, input }) => { const { pageId: id, ...data } = input; return updateWorkspacePageInTransaction(prisma, id, data, await currentActor(prisma, user)); } },
  },
];
