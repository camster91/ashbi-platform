// Survey API Endpoints for Ashbi Design Hub
// Location: /api/surveys/*

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// POST /api/surveys/submit - Public survey submission
export async function submitSurvey(request, reply) {
  try {
    const { clientId, projectId, npsScore, communicationScore, feedback, channel = 'EMAIL' } = request.body;
    
    // Validate required fields
    if (!clientId || npsScore === undefined) {
      return reply.code(400).send({ error: 'clientId and npsScore are required' });
    }
    
    // Validate NPS score range
    if (npsScore < 0 || npsScore > 10) {
      return reply.code(400).send({ error: 'NPS score must be between 0 and 10' });
    }
    
    // Validate communication score if provided
    if (communicationScore && (communicationScore < 1 || communicationScore > 5)) {
      return reply.code(400).send({ error: 'Communication score must be between 1 and 5' });
    }
    
    // Verify client exists
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });
    
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }
    
    // Verify project exists if provided
    let project = null;
    if (projectId) {
      project = await prisma.project.findUnique({
        where: { id: projectId },
      });
      
      if (!project) {
        return reply.code(404).send({ error: 'Project not found' });
      }
    }
    
    // Calculate response time (assuming survey was sent 7 days ago for new system)
    // In production, this would come from webhook data
    const surveySentAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const responseTimeHours = (Date.now() - surveySentAt.getTime()) / (1000 * 60 * 60);
    
    // Create survey response
    const surveyResponse = await prisma.surveyResponse.create({
      data: {
        clientId,
        projectId,
        npsScore,
        communicationScore,
        feedback,
        channel,
        surveySentAt,
        responseTimeHours,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      },
    });
    
    // Update project survey status if project exists
    if (projectId) {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          surveySent: true,
          surveySentAt: new Date(),
          achievedNpsScore: npsScore,
        },
      });
    }
    
    // Update client satisfaction signals
    await updateClientSatisfaction(clientId, npsScore, feedback, projectId);
    
    // Trigger follow-up based on score
    await triggerFollowUp(surveyResponse);
    
    // Notify team based on score
    await notifyTeam(surveyResponse, client, project);
    
    return {
      success: true,
      message: 'Survey submitted successfully',
      surveyId: surveyResponse.id,
      followUp: getFollowUpMessage(npsScore),
    };
    
  } catch (error) {
    console.error('Survey submission error:', error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

// GET /api/surveys/responses - List survey responses (admin only)
export async function getSurveyResponses(request, reply) {
  try {
    const { limit = 50, offset = 0, clientId, projectId, minScore, maxScore } = request.query;
    
    const where = {};
    
    if (clientId) where.clientId = clientId;
    if (projectId) where.projectId = projectId;
    if (minScore !== undefined) where.npsScore = { gte: parseInt(minScore) };
    if (maxScore !== undefined) where.npsScore = { lte: parseInt(maxScore) };
    
    const responses = await prisma.surveyResponse.findMany({
      where,
      include: {
        client: {
          select: { id: true, name: true, domain: true },
        },
        project: {
          select: { id: true, name: true },
        },
      },
      orderBy: { submittedAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });
    
    const total = await prisma.surveyResponse.count({ where });
    
    return {
      success: true,
      data: responses,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: total > parseInt(offset) + parseInt(limit),
      },
    };
    
  } catch (error) {
    console.error('Get survey responses error:', error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

// GET /api/surveys/metrics - Get NPS metrics
export async function getNpsMetrics(request, reply) {
  try {
    const { startDate, endDate } = request.query;
    
    const where = {};
    
    if (startDate || endDate) {
      where.submittedAt = {};
      if (startDate) where.submittedAt.gte = new Date(startDate);
      if (endDate) where.submittedAt.lte = new Date(endDate);
    }
    
    const responses = await prisma.surveyResponse.findMany({
      where,
      select: { npsScore: true },
    });
    
    if (responses.length === 0) {
      return {
        success: true,
        data: {
          totalResponses: 0,
          npsScore: 0,
          promoters: 0,
          passives: 0,
          detractors: 0,
          responseRate: 0,
        },
      };
    }
    
    // Calculate NPS
    const promoters = responses.filter(r => r.npsScore >= 9).length;
    const passives = responses.filter(r => r.npsScore >= 7 && r.npsScore <= 8).length;
    const detractors = responses.filter(r => r.npsScore <= 6).length;
    const total = responses.length;
    
    const promoterPercentage = (promoters / total) * 100;
    const detractorPercentage = (detractors / total) * 100;
    const npsScore = Math.round(promoterPercentage - detractorPercentage);
    
    // Calculate average scores
    const avgNps = responses.reduce((sum, r) => sum + r.npsScore, 0) / total;
    
    // Get communication scores if available
    const commResponses = await prisma.surveyResponse.findMany({
      where: { ...where, communicationScore: { not: null } },
      select: { communicationScore: true },
    });
    
    const avgCommunication = commResponses.length > 0 
      ? commResponses.reduce((sum, r) => sum + r.communicationScore, 0) / commResponses.length
      : null;
    
    return {
      success: true,
      data: {
        totalResponses: total,
        npsScore,
        promoters,
        passives,
        detractors,
        promoterPercentage: Math.round(promoterPercentage * 10) / 10,
        detractorPercentage: Math.round(detractorPercentage * 10) / 10,
        averageNps: Math.round(avgNps * 10) / 10,
        averageCommunication: avgCommunication ? Math.round(avgCommunication * 10) / 10 : null,
        responseRate: await calculateResponseRate(startDate, endDate),
      },
    };
    
  } catch (error) {
    console.error('Get NPS metrics error:', error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

// POST /api/surveys/send - Send survey to client (admin only)
export async function sendSurveyToClient(request, reply) {
  try {
    const { clientId, projectId, channel = 'EMAIL' } = request.body;
    
    if (!clientId) {
      return reply.code(400).send({ error: 'clientId is required' });
    }
    
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { projects: projectId ? { where: { id: projectId } } : false },
    });
    
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }
    
    // Generate survey URL
    const surveyToken = generateSurveyToken(clientId, projectId);
    const surveyUrl = `https://hub.ashbi.ca/survey/${surveyToken}`;
    
    // Send survey based on channel
    let result;
    switch (channel) {
      case 'EMAIL':
        result = await sendEmailSurvey(client, projectId, surveyUrl);
        break;
      case 'SMS':
        result = await sendSmsSurvey(client, projectId, surveyUrl);
        break;
      default:
        return reply.code(400).send({ error: 'Unsupported channel' });
    }
    
    // Update project if applicable
    if (projectId) {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          surveySent: true,
          surveySentAt: new Date(),
        },
      });
    }
    
    return {
      success: true,
      message: `Survey sent via ${channel}`,
      surveyUrl,
      result,
    };
    
  } catch (error) {
    console.error('Send survey error:', error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

// GET /api/surveys/:id - Get specific survey response
export async function getSurveyResponse(request, reply) {
  try {
    const { id } = request.params;
    
    const surveyResponse = await prisma.surveyResponse.findUnique({
      where: { id },
      include: {
        client: {
          select: { id: true, name: true, domain: true, satisfactionSignals: true },
        },
        project: {
          select: { id: true, name: true, status: true },
        },
      },
    });
    
    if (!surveyResponse) {
      return reply.code(404).send({ error: 'Survey response not found' });
    }
    
    return {
      success: true,
      data: surveyResponse,
    };
    
  } catch (error) {
    console.error('Get survey response error:', error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

// GET /api/surveys/clients/:clientId - Get client's survey history
export async function getClientSurveyHistory(request, reply) {
  try {
    const { clientId } = request.params;
    const { limit = 20, offset = 0 } = request.query;
    
    // Verify client exists
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });
    
    if (!client) {
      return reply.code(404).send({ error: 'Client not found' });
    }
    
    const responses = await prisma.surveyResponse.findMany({
      where: { clientId },
      include: {
        project: {
          select: { id: true, name: true },
        },
      },
      orderBy: { submittedAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });
    
    const total = await prisma.surveyResponse.count({ where: { clientId } });
    
    // Calculate client NPS metrics
    const npsScores = responses.map(r => r.npsScore);
    const promoters = npsScores.filter(score => score >= 9).length;
    const detractors = npsScores.filter(score => score <= 6).length;
    const totalResponses = npsScores.length;
    
    const npsScore = totalResponses > 0 
      ? Math.round(((promoters / totalResponses) - (detractors / totalResponses)) * 100)
      : 0;
    
    // Get client satisfaction signals
    let satisfactionSignals = {};
    try {
      satisfactionSignals = JSON.parse(client.satisfactionSignals || '{}');
    } catch (e) {
      satisfactionSignals = {};
    }
    
    return {
      success: true,
      data: {
        client: {
          id: client.id,
          name: client.name,
          satisfactionSignals,
        },
        responses,
        metrics: {
          totalResponses,
          npsScore,
          promoters,
          detractors,
          averageNps: totalResponses > 0 ? (npsScores.reduce((a, b) => a + b, 0) / totalResponses).toFixed(1) : 0,
          responseRate: await calculateClientResponseRate(clientId),
        },
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: total > parseInt(offset) + parseInt(limit),
        },
      },
    };
    
  } catch (error) {
    console.error('Get client survey history error:', error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

// GET /api/surveys/dashboard/at-risk-clients - Get at-risk clients (detractors)
export async function getAtRiskClients(request, reply) {
  try {
    const { limit = 20, offset = 0, days = 30 } = request.query;
    
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    // Get clients with detractor scores in the last X days
    const detractorResponses = await prisma.surveyResponse.findMany({
      where: {
        npsScore: { lte: 6 },
        submittedAt: { gte: cutoffDate },
      },
      include: {
        client: {
          select: { id: true, name: true, domain: true, status: true },
        },
        project: {
          select: { id: true, name: true },
        },
      },
      orderBy: { submittedAt: 'desc' },
      distinct: ['clientId'], // Only get latest per client
    });
    
    // Get clients who haven't responded to recovery attempts
    const atRiskClients = await Promise.all(
      detractorResponses.map(async (response) => {
        // Check if recovery action was taken
        const recoveryActions = await prisma.surveyResponse.findMany({
          where: {
            clientId: response.clientId,
            recoveryActionTaken: true,
            submittedAt: { gte: response.submittedAt },
          },
        });
        
        return {
          client: response.client,
          latestResponse: {
            id: response.id,
            npsScore: response.npsScore,
            feedback: response.feedback,
            submittedAt: response.submittedAt,
            project: response.project,
          },
          recoveryActions: recoveryActions.length,
          daysSinceResponse: Math.floor((Date.now() - response.submittedAt.getTime()) / (1000 * 60 * 60 * 24)),
          status: recoveryActions.length > 0 ? 'RECOVERY_IN_PROGRESS' : 'NEEDS_ATTENTION',
        };
      })
    );
    
    // Sort by most urgent (needs attention, then by days since response)
    atRiskClients.sort((a, b) => {
      if (a.status === 'NEEDS_ATTENTION' && b.status !== 'NEEDS_ATTENTION') return -1;
      if (a.status !== 'NEEDS_ATTENTION' && b.status === 'NEEDS_ATTENTION') return 1;
      return b.daysSinceResponse - a.daysSinceResponse;
    });
    
    // Apply pagination
    const paginated = atRiskClients.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    return {
      success: true,
      data: paginated,
      pagination: {
        total: atRiskClients.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: atRiskClients.length > parseInt(offset) + parseInt(limit),
      },
    };
    
  } catch (error) {
    console.error('Get at-risk clients error:', error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

// Helper functions
async function updateClientSatisfaction(clientId, npsScore, feedback, projectId) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
  });
  
  if (!client) return;
  
  let satisfactionSignals = {};
  try {
    satisfactionSignals = JSON.parse(client.satisfactionSignals || '{}');
  } catch (e) {
    satisfactionSignals = {};
  }
  
  // Update satisfaction signals
  const signals = satisfactionSignals;
  signals.npsHistory = signals.npsHistory || [];
  signals.npsHistory.push({
    score: npsScore,
    date: new Date().toISOString(),
    projectId,
    feedback: feedback?.substring(0, 200), // Truncate long feedback
  });
  
  signals.currentNps = npsScore;
  signals.lastSurveyDate = new Date().toISOString();
  signals.category = getNpsCategory(npsScore);
  
  // Calculate trend (simplified)
  if (signals.npsHistory.length >= 2) {
    const lastTwo = signals.npsHistory.slice(-2);
    const trend = lastTwo[1].score - lastTwo[0].score;
    signals.trend = trend > 0 ? 'IMPROVING' : trend < 0 ? 'DECLINING' : 'STABLE';
  } else {
    signals.trend = 'STABLE';
  }
  
  // Calculate response rate
  const totalSurveys = await