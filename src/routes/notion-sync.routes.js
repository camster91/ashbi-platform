// Notion Sync Routes
// Endpoints for syncing Notion project data into ashbi-platform

import { syncAllProjects, syncSingleProject, KNOWN_PROJECTS } from '../services/notionSync.service.js';

export default async function notionSyncRoutes(fastify) {
  // POST /api/notion-sync/sync-all — sync all known Notion projects
  fastify.post('/sync-all', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    try {
      const result = await syncAllProjects();
      return reply.send(result);
    } catch (err) {
      request.log.error({ err }, 'Notion sync-all failed');
      return reply.status(500).send({ error: 'Sync failed', message: err.message });
    }
  });

  // POST /api/notion-sync/sync-one — sync a single project by page ID
  fastify.post('/sync-one', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { pageId } = request.body || {};

    if (!pageId) {
      return reply.status(400).send({ error: 'pageId is required' });
    }

    try {
      const result = await syncSingleProject(pageId);
      return reply.send(result);
    } catch (err) {
      request.log.error({ err, pageId }, 'Notion sync-one failed');
      return reply.status(500).send({ error: 'Sync failed', message: err.message });
    }
  });

  // GET /api/notion-sync/projects — list known Notion projects available for sync
  fastify.get('/projects', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    return reply.send({
      projects: KNOWN_PROJECTS.map(p => ({
        pageId: p.pageId,
        name: p.name,
        hasTasksPage: !!p.tasksPageId,
      })),
    });
  });

  // GET /api/notion-sync/status — check if MATON_API_KEY is configured
  fastify.get('/status', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const hasKey = !!process.env.MATON_API_KEY;
    return reply.send({
      configured: hasKey,
      message: hasKey
        ? 'Notion sync is configured and ready'
        : 'MATON_API_KEY is not set — Notion sync is unavailable',
    });
  });
}
