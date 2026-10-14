import { validateBody, validateQuery, validateParams, workspacePageCreateSchema, workspacePageUpdateSchema, workspacePageListSchema, workspacePageReadQuerySchema, workspacePageParamsSchema, workspacePageAccessSchema, workspacePageAccessOptionsSchema } from '../validators/schemas.js';
import { listWorkspacePages, readWorkspacePage, createWorkspacePage, updateWorkspacePage } from '../services/workspace-pages.service.js';
import { readWorkspacePageAccess, saveWorkspacePageAccess, workspacePageAccessOptions } from '../services/workspace-page-access.service.js';

export default async function workspaceWikiRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] };
  fastify.get('/pages/:id/access/options', { ...auth, preHandler: [validateParams(workspacePageParamsSchema), validateQuery(workspacePageAccessOptionsSchema)] }, request => workspacePageAccessOptions(request.prisma, request.params.id, request.query, request.user));
  fastify.get('/pages/:id/access', { ...auth, preHandler: validateParams(workspacePageParamsSchema) }, request => readWorkspacePageAccess(request.prisma, request.params.id, request.user));
  fastify.put('/pages/:id/access', { ...auth, preHandler: [validateParams(workspacePageParamsSchema), validateBody(workspacePageAccessSchema)] }, request => saveWorkspacePageAccess(request.prisma, request.params.id, request.body, request.user));
  fastify.get('/pages', { ...auth, preHandler: validateQuery(workspacePageListSchema) }, async request => {
    return listWorkspacePages(request.prisma, { ...request.query, includeArchived: request.query.includeArchived === 'true' }, request.user);
  });
  fastify.get('/pages/:id', { ...auth, preHandler: [validateParams(workspacePageParamsSchema), validateQuery(workspacePageReadQuerySchema)] }, async request => {
    return readWorkspacePage(request.prisma, request.params.id, request.user, request.query.includeArchived === 'true');
  });
  fastify.post('/pages', { ...auth, preHandler: validateBody(workspacePageCreateSchema) }, async (request, reply) => reply.status(201).send(await createWorkspacePage(request.prisma, request.body, request.user)));
  fastify.put('/pages/:id', { ...auth, preHandler: [validateParams(workspacePageParamsSchema), validateBody(workspacePageUpdateSchema)] }, request => updateWorkspacePage(request.prisma, request.params.id, request.body, request.user));
}
