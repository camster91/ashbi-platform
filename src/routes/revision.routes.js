// Revision round tracking routes

import prisma from '../config/db.js';

export default async function revisionRoutes(fastify) {
  // List revision rounds for a project
  fastify.get('/projects/:projectId/revisions', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { projectId } = request.params;

    const revisions = await prisma.revisionRound.findMany({
      where: { projectId },
      orderBy: { roundNumber: 'desc' }
    });

    return revisions;
  });

  // Create a new revision round
  fastify.post('/projects/:projectId/revisions', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { projectId } = request.params;
    const { notes } = request.body || {};

    // Get the next round number
    const lastRound = await prisma.revisionRound.findFirst({
      where: { projectId },
      orderBy: { roundNumber: 'desc' }
    });
    const roundNumber = (lastRound?.roundNumber || 0) + 1;

    const revision = await prisma.revisionRound.create({
      data: {
        projectId,
        roundNumber,
        notes: notes || null,
        status: 'OPEN'
      }
    });

    return reply.status(201).send(revision);
  });

  // Update a revision round
  fastify.put('/revisions/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { status, notes } = request.body;

    const data = {};
    if (status) data.status = status;
    if (notes !== undefined) data.notes = notes;

    const revision = await prisma.revisionRound.update({
      where: { id },
      data
    });

    return revision;
  });

  // Approve a revision round (admin only)
  fastify.post('/revisions/:id/approve', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;

    const revision = await prisma.revisionRound.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date()
      }
    });

    return revision;
  });
}
