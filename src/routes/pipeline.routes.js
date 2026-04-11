// Deal Pipeline routes
// Migrated from ashbi-hub with auth decorators

import { prisma } from '../index.js';
import {
  getPipelineStages,
  createStage,
  updateStage,
  deleteStage,
  createDeal,
  updateDeal,
  deleteDeal,
  getPipelineAnalytics
} from '../services/dealPipeline.service.js';

export default async function pipelineRoutes(fastify) {
  // Get pipeline stages with deals
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async () => {
    return getPipelineStages();
  });

  // Get pipeline analytics
  fastify.get('/analytics', {
    onRequest: [fastify.authenticate]
  }, async () => {
    return getPipelineAnalytics();
  });

  // Create a new stage
  fastify.post('/stages', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const stage = await createStage(request.body);
    return reply.status(201).send(stage);
  });

  // Update a stage
  fastify.put('/stages/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;
    return updateStage(id, request.body);
  });

  // Delete a stage
  fastify.delete('/stages/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;
    const { moveToStageId } = request.query;
    return deleteStage(id, moveToStageId);
  });

  // Create a new deal
  fastify.post('/deals', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const deal = await createDeal(request.body);
    return reply.status(201).send(deal);
  });

  // Update a deal (move between stages, update value, etc.)
  fastify.put('/deals/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;
    return updateDeal(id, request.body);
  });

  // Delete a deal
  fastify.delete('/deals/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;
    return deleteDeal(id);
  });
}