// Survey service (NPS)
// Migrated from ashbi-hub with Prisma and proper structure

import prisma from '../config/db.js';

/**
 * Submit a survey response (public endpoint)
 */
export async function submitSurvey(data) {
  const { clientId, projectId, npsScore, communicationScore, feedback, channel } = data;

  if (npsScore < 0 || npsScore > 10) {
    throw new Error('NPS score must be between 0 and 10');
  }

  const category = npsScore <= 6 ? 'DETRACTOR' : npsScore <= 8 ? 'PASSIVE' : 'PROMOTER';

  const response = await prisma.surveyResponse.create({
    data: {
      clientId,
      score: npsScore,
      category,
      comment: feedback,
      respondentName: data.respondentName,
      respondentEmail: data.respondentEmail
    }
  });

  // Update client satisfaction if applicable
  if (clientId) {
    await updateClientSatisfaction(clientId);
  }

  return response;
}

/**
 * Get survey responses with optional filters
 */
export async function getSurveyResponses(filters = {}) {
  const { limit = 50, offset = 0, clientId, minScore, maxScore } = filters;

  const where = {};
  if (clientId) where.clientId = clientId;
  if (minScore !== undefined || maxScore !== undefined) {
    where.score = {};
    if (minScore !== undefined) where.score.gte = minScore;
    if (maxScore !== undefined) where.score.lte = maxScore;
  }

  const [data, total] = await Promise.all([
    prisma.surveyResponse.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        client: { select: { id: true, name: true } }
      }
    }),
    prisma.surveyResponse.count({ where })
  ]);

  return {
    data,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    }
  };
}

/**
 * Get NPS metrics
 */
export async function getNpsMetrics(startDate, endDate) {
  const where = {};
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [totalResponses, promoters, passives, detractors, avgScore] = await Promise.all([
    prisma.surveyResponse.count({ where }),
    prisma.surveyResponse.count({ where: { ...where, category: 'PROMOTER' } }),
    prisma.surveyResponse.count({ where: { ...where, category: 'PASSIVE' } }),
    prisma.surveyResponse.count({ where: { ...where, category: 'DETRACTOR' } }),
    prisma.surveyResponse.aggregate({ where, _avg: { score: true } })
  ]);

  const npsScore = totalResponses > 0
    ? Math.round(((promoters - detractors) / totalResponses) * 100)
    : 0;

  return {
    totalResponses,
    npsScore,
    promoters,
    passives,
    detractors,
    promoterPercentage: totalResponses > 0 ? Math.round((promoters / totalResponses) * 100) : 0,
    detractorPercentage: totalResponses > 0 ? Math.round((detractors / totalResponses) * 100) : 0,
    averageNps: avgScore._avg.score || 0
  };
}

/**
 * Get at-risk clients (detractors)
 */
export async function getAtRiskClients(limit = 10, offset = 0, days = 30) {
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const atRiskClients = await prisma.surveyResponse.findMany({
    where: {
      score: { lte: 6 },
      createdAt: { gte: cutoffDate }
    },
    include: {
      client: { select: { id: true, name: true, health: true, healthScore: true } }
    },
    orderBy: { score: 'asc' },
    take: limit,
    skip: offset
  });

  return atRiskClients;
}

/**
 * Get survey history for a specific client
 */
export async function getClientSurveyHistory(clientId, limit = 10, offset = 0) {
  const [responses, total] = await Promise.all([
    prisma.surveyResponse.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    }),
    prisma.surveyResponse.count({ where: { clientId } })
  ]);

  const avgScore = await prisma.surveyResponse.aggregate({
    where: { clientId },
    _avg: { score: true }
  });

  return {
    responses,
    metrics: {
      total,
      averageScore: avgScore._avg.score || 0
    },
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    }
  };
}

/**
 * Update client satisfaction score based on surveys
 */
async function updateClientSatisfaction(clientId) {
  const surveys = await prisma.surveyResponse.findMany({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  if (surveys.length === 0) return;

  const avgScore = surveys.reduce((sum, s) => sum + s.score, 0) / surveys.length;
  const satisfactionSignals = JSON.stringify({
    npsAverage: avgScore,
    lastSurveyDate: surveys[0].createdAt,
    surveyCount: surveys.length
  });

  await prisma.client.update({
    where: { id: clientId },
    data: { satisfactionSignals }
  });
}