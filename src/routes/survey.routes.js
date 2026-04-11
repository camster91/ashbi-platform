// Survey / NPS routes
// Migrated from ashbi-hub with Prisma and proper auth

import {
  submitSurvey,
  getSurveyResponses,
  getNpsMetrics,
  getAtRiskClients,
  getClientSurveyHistory
} from '../services/survey.service.js';

export default async function surveyRoutes(fastify) {
  // Submit a survey response (PUBLIC — no auth required)
  fastify.post('/submit', async (request, reply) => {
    try {
      const response = await submitSurvey(request.body);
      return reply.status(201).send({
        success: true,
        message: 'Thank you for your feedback!',
        surveyId: response.id
      });
    } catch (error) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Get survey responses (admin only)
  fastify.get('/responses', {
    onRequest: [fastify.authenticate, fastify.adminOnly]
  }, async (request) => {
    const { limit, offset, clientId, minScore, maxScore } = request.query;
    return getSurveyResponses({
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      clientId,
      minScore: minScore ? parseInt(minScore) : undefined,
      maxScore: maxScore ? parseInt(maxScore) : undefined
    });
  });

  // Get NPS metrics
  fastify.get('/metrics', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { startDate, endDate } = request.query;
    return getNpsMetrics(startDate, endDate);
  });

  // Get at-risk clients (admin only)
  fastify.get('/at-risk-clients', {
    onRequest: [fastify.authenticate, fastify.adminOnly]
  }, async (request) => {
    const { limit, offset, days } = request.query;
    return getAtRiskClients(
      parseInt(limit) || 10,
      parseInt(offset) || 0,
      parseInt(days) || 30
    );
  });

  // Get survey history for a specific client
  fastify.get('/clients/:clientId', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { limit, offset } = request.query;
    return getClientSurveyHistory(
      request.params.clientId,
      parseInt(limit) || 10,
      parseInt(offset) || 0
    );
  });
}