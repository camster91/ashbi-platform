// Deal Pipeline routes
// Migrated from ashbi-hub with auth decorators

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

export default async function pipelineRoutes(fastify) {
  const handlePipelineError = (error, reply) => {
    if (error instanceof PipelineError) {
      return reply.status(error.statusCode).send({
        error: { message: error.message, type: error.code },
      });
    }
    throw error;
  };

  // Get pipeline stages with deals
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return getPipelineStages(request.prisma);
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
    try {
      const stage = await createStage(request.prisma, request.body);
      return reply.status(201).send(stage);
    } catch (error) {
      return handlePipelineError(error, reply);
    }
  });

  // Update a stage
  fastify.put('/stages/:id', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(pipelineStageUpdateSchema),
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      return await updateStage(request.prisma, id, request.body);
    } catch (error) {
      return handlePipelineError(error, reply);
    }
  });

  // Delete a stage
  fastify.delete('/stages/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { moveToStageId } = request.query;
    try {
      return await deleteStage(request.prisma, id, moveToStageId);
    } catch (error) {
      return handlePipelineError(error, reply);
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
    } catch (error) {
      return handlePipelineError(error, reply);
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
    } catch (error) {
      return handlePipelineError(error, reply);
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
