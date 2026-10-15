import { z } from 'zod';
import { listDocumentHistory, readDocumentRevision, restoreDocumentRevision } from '../services/document-history.service.js';
import { requireStaff } from '../middleware/require-staff.js';

const id = z.string().min(1).max(80);
const params = z.object({ documentId: id }).strict();
const versionParams = params.extend({ version: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
const emptyQuery = z.object({}).strict();
const restoreBody = z.object({ revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
const messages = { 400: 'Invalid document history request', 403: 'Document history access denied', 404: 'Document revision not found', 409: 'Document changed or revision unavailable. Reload before restoring history.', 503: 'Document history is temporarily unavailable' };
export default async function documentHistoryRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate, requireStaff] };
  function handler(kind, operation) {
    return async (request, reply) => {
      const parsed = (operation === 'list' ? params : versionParams).safeParse(request.params);
      if (!parsed.success || !emptyQuery.safeParse(request.query).success || (operation === 'restore' && !restoreBody.safeParse(request.body).success)) return reply.code(400).send({ error: messages[400] });
      const { documentId, version } = parsed.data;
      try {
        if (operation === 'list') return await listDocumentHistory(request.prisma, request.user, kind, documentId);
        if (operation === 'read') return await readDocumentRevision(request.prisma, request.user, kind, documentId, version);
        return await restoreDocumentRevision(request.prisma, request.user, kind, documentId, version, request.body);
      } catch (error) {
        const status = [400, 403, 404, 409].includes(error.statusCode) ? error.statusCode : 503;
        if (status === 503) request.log.error({ code: error.code }, 'Document history request failed');
        return reply.code(status).send({ error: messages[status] });
      }
    };
  }
  fastify.get('/notes/:documentId', auth, handler('note', 'list'));
  fastify.get('/notes/:documentId/:version', auth, handler('note', 'read'));
  fastify.post('/notes/:documentId/:version/restore', auth, handler('note', 'restore'));
  fastify.get('/pages/:documentId', auth, handler('page', 'list'));
  fastify.get('/pages/:documentId/:version', auth, handler('page', 'read'));
  fastify.post('/pages/:documentId/:version/restore', auth, handler('page', 'restore'));
}
