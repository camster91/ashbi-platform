// Client Portal Routes (read-only access for logged-in clients)

import { prisma } from '../index.js';

export default async function clientPortalRoutes(fastify) {
  // Get client's own projects (for client portal)
  fastify.get('/client/projects', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    if (request.user.role !== 'CLIENT') {
      return request.reply.status(403).send({ error: 'Not authorized' });
    }

    const projects = await prisma.project.findMany({
      where: { clientId: request.user.clientId },
      select: {
        id: true,
        name: true,
        status: true,
        progress: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { name: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });

    return projects;
  });

  // Get single project (client view - read-only)
  fastify.get('/client/projects/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    if (request.user.role !== 'CLIENT') {
      return request.reply.status(403).send({ error: 'Not authorized' });
    }

    const { id } = request.params;

    const project = await prisma.project.findFirst({
      where: {
        id,
        clientId: request.user.clientId
      },
      include: {
        client: { select: { name: true, id: true } },
        threads: {
          take: 3,
          orderBy: { lastActivityAt: 'desc' },
          include: {
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' }
            }
          }
        }
      }
    });

    if (!project) {
      return request.reply.status(404).send({ error: 'Project not found' });
    }

    // Extract message data for frontend
    const messages = project.threads.flatMap(t => 
      t.messages.map(m => ({
        id: m.id,
        sender: 'Team',
        body: m.content || m.body,
        createdAt: m.createdAt
      }))
    ).slice(0, 3);

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      progress: project.progress,
      description: project.description,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      client: project.client,
      manager: project.manager || 'N/A',
      teamSize: project.team?.length || 1,
      threadId: project.threads[0]?.id,
      messages
    };
  });

  // Get thread (client view - read-only)
  fastify.get('/client/threads/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    if (request.user.role !== 'CLIENT') {
      return request.reply.status(403).send({ error: 'Not authorized' });
    }

    const { id } = request.params;

    const thread = await prisma.thread.findFirst({
      where: {
        id,
        project: {
          clientId: request.user.clientId
        }
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!thread) {
      return request.reply.status(404).send({ error: 'Thread not found' });
    }

    return thread;
  });
}
