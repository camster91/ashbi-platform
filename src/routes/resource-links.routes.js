import { listResourceLinks, getResourceLink, createResourceLink, updateResourceLink, archiveResourceLink, reorderResourceLinks } from '../services/resource-links.service.js';
import { resourceLinkListSchema, resourceLinkCreateSchema, resourceLinkUpdateSchema, resourceLinkArchiveSchema, resourceLinkReorderSchema } from '../validators/resource-links.schemas.js';
import { validateBody, validateQuery } from '../validators/schemas.js';
export default async function resourceLinkRoutes(app) {
    const auth = { onRequest: [app.authenticate] };
    const args = request => ({ actor: request.user, ...request.body });
    app.get('/', { ...auth, preHandler: validateQuery(resourceLinkListSchema) }, request => listResourceLinks(request.prisma, { actor: request.user, ...request.query }));
    app.get('/:id', auth, request => getResourceLink(request.prisma, { actor: request.user, id: request.params.id }));
    app.post('/', { ...auth, preHandler: validateBody(resourceLinkCreateSchema) }, async (request, reply) => reply.code(201).send(await createResourceLink(request.prisma, args(request))));
    app.patch('/:id', { ...auth, preHandler: validateBody(resourceLinkUpdateSchema) }, request => updateResourceLink(request.prisma, { ...args(request), id: request.params.id }));
    app.post('/:id/archive', { ...auth, preHandler: validateBody(resourceLinkArchiveSchema) }, request => archiveResourceLink(request.prisma, { ...args(request), id: request.params.id }));
    app.post('/reorder', { ...auth, preHandler: validateBody(resourceLinkReorderSchema) }, request => reorderResourceLinks(request.prisma, args(request)));
}
