// Deal Pipeline routes
//
// Every handler passes the organization-scoped `request.prisma` to the
// service, so stages and deals are only ever read or written inside the
// caller's organization.

import {
  getPipelineStages,
  createStage,
  updateStage,
  deleteStage,
  createDeal,
  updateDeal,
  deleteDeal,
  getPipelineAnalytics,
  PipelineError,
} from '../services/dealPipeline.service.js';
import {
  validateBody,
  pipelineStageCreateSchema,
  pipelineStageUpdateSchema,
  pipelineDealCreateSchema,
  pipelineDealUpdateSchema,
} from '../validators/schemas.js';

function sendPipelineError(reply, err) {
  if (err instanceof PipelineError) {
    return reply.status(err.statusCode).send({ error: err.message });
  }
  throw err;
}

export default async function pipelineRoutes(fastify) {
  // Get pipeline stages with deals (seeds default stages on first read)
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      return await getPipelineStages(request.prisma, request.organizationId ?? request.user?.organizationId);
    } catch (err) {
      return sendPipelineError(reply, err);
    }
  });

  // Get pipeline analytics
  fastify.get('/analytics', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return getPipelineAnalytics(request.prisma);
  });

  // Create a new stage
  fastify.post('/stages', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(pipelineStageCreateSchema),
  }, async (request, reply) => {
    const stage = await createStage(request.prisma, request.body);
    return reply.status(201).send(stage);
  });

  // Update a stage
  fastify.put('/stages/:id', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(pipelineStageUpdateSchema),
  }, async (request) => {
    const { id } = request.params;
    return updateStage(request.prisma, id, request.body);
  });

  // Delete a stage
  fastify.delete('/stages/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { moveToStageId } = request.query;
    try {
      return await deleteStage(request.prisma, id, moveToStageId || undefined);
    } catch (err) {
      return sendPipelineError(reply, err);
    }
  });

  // Create a new deal
  fastify.post('/deals', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(pipelineDealCreateSchema),
  }, async (request, reply) => {
    try {
      const deal = await createDeal(request.prisma, request.body);
      return reply.status(201).send(deal);
    } catch (err) {
      return sendPipelineError(reply, err);
    }
  });

  // Update a deal (move between stages, update value, etc.)
  fastify.put('/deals/:id', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(pipelineDealUpdateSchema),
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      return await updateDeal(request.prisma, id, request.body);
    } catch (err) {
      return sendPipelineError(reply, err);
    }
  });

  // Delete a deal
  fastify.delete('/deals/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;
    return deleteDeal(request.prisma, id);
  });
}
