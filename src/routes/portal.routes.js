// Client Portal routes (public - no auth required)

import { prisma } from '../index.js';
import { safeParse } from '../utils/safeParse.js';

export default async function portalRoutes(fastify) {
  // Public project portal view
  fastify.get('/:token', async (request, reply) => {
    const { token } = request.params;

    const project = await prisma.project.findUnique({
      where: { viewToken: token },
      include: {
        client: { select: { name: true } },
        revisionRounds: {
          orderBy: { roundNumber: 'desc' },
          take: 10
        },
        notes: {
          where: { isPinned: true },
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            title: true,
            content: true,
            updatedAt: true
          }
        },
        milestones: {
          orderBy: { dueDate: 'asc' },
          select: {
            id: true,
            name: true,
            status: true,
            dueDate: true,
            completedAt: true
          }
        },
        tasks: {
          where: { status: { not: 'COMPLETED' } },
          orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
          take: 20,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            category: true,
            dueDate: true
          }
        }
      }
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Return sanitized project data (no internal details)
    return {
      name: project.name,
      description: project.description,
      status: project.status,
      health: project.health,
      clientName: project.client?.name,
      aiSummary: project.aiSummary,
      milestones: project.milestones,
      revisionRounds: project.revisionRounds,
      pinnedNotes: project.notes,
      activeTasks: project.tasks.map(t => ({
        title: t.title,
        status: t.status,
        priority: t.priority,
        category: t.category,
        dueDate: t.dueDate
      })),
      updatedAt: project.updatedAt
    };
  });
}
