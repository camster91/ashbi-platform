// Email processing pipeline service

import { prisma } from '../index.js';
import aiClient from '../ai/client.js';
import { buildParseEmailPrompt } from '../ai/prompts/parseEmail.js';
import { buildAnalyzeMessagePrompt } from '../ai/prompts/analyzeMessage.js';
import { buildReplanProjectPrompt } from '../ai/prompts/replanProject.js';
import { buildDraftResponsePrompt } from '../ai/prompts/draftResponse.js';
import { assignThread } from './assignment.service.js';
import env from '../config/env.js';

/**
 * Process incoming email through full AI pipeline
 * Step 1: Parse & Match
 * Step 2: Analyze Message
 * Step 3: Auto-Assign
 * Step 4: Replan Project (if matched)
 * Step 5: Draft Response
 */
export async function processEmailPipeline(emailData) {
  console.log('Processing email:', emailData.subject);

  // Step 1: Parse & Match Email
  const matchResult = await parseAndMatchEmail(emailData);

  let thread;
  let needsTriage = false;

  // Handle matching result
  if (matchResult.isSpamOrIrrelevant?.likely) {
    console.log('Email marked as spam/irrelevant:', matchResult.isSpamOrIrrelevant.reason);
    return { matched: false, spam: true, reason: matchResult.isSpamOrIrrelevant.reason };
  }

  if (matchResult.matchedClient?.confidence >= env.autoMatchThreshold) {
    // High confidence match - create thread automatically
    thread = await prisma.thread.create({
      data: {
        subject: emailData.subject,
        status: 'AWAITING_RESPONSE',
        priority: 'NORMAL',
        matchConfidence: matchResult.matchedClient.confidence,
        matchReason: matchResult.matchedClient.matchReason,
        clientId: matchResult.matchedClient.id,
        projectId: matchResult.matchedProject?.id || null,
        messages: {
          create: {
            direction: 'INBOUND',
            senderEmail: emailData.senderEmail,
            senderName: emailData.senderName,
            subject: emailData.subject,
            bodyText: emailData.bodyText,
            bodyHtml: emailData.bodyHtml,
            rawEmail: emailData.rawEmail,
            receivedAt: emailData.receivedAt || new Date(),
            processedAt: new Date()
          }
        }
      },
      include: {
        messages: true,
        client: true,
        project: true
      }
    });
  } else if (matchResult.matchedClient?.confidence >= env.suggestMatchThreshold) {
    // Medium confidence - create thread but flag for triage
    thread = await prisma.thread.create({
      data: {
        subject: emailData.subject,
        status: 'AWAITING_RESPONSE',
        priority: 'NORMAL',
        matchConfidence: matchResult.matchedClient.confidence,
        matchReason: matchResult.matchedClient.matchReason,
        needsTriage: true,
        clientId: matchResult.matchedClient.id,
        projectId: matchResult.matchedProject?.id || null,
        messages: {
          create: {
            direction: 'INBOUND',
            senderEmail: emailData.senderEmail,
            senderName: emailData.senderName,
            subject: emailData.subject,
            bodyText: emailData.bodyText,
            bodyHtml: emailData.bodyHtml,
            rawEmail: emailData.rawEmail,
            receivedAt: emailData.receivedAt || new Date(),
            processedAt: new Date()
          }
        }
      },
      include: {
        messages: true,
        client: true,
        project: true
      }
    });
    needsTriage = true;
  } else {
    // Low confidence - add to unmatched queue
    await prisma.unmatchedEmail.create({
      data: {
        senderEmail: emailData.senderEmail,
        senderName: emailData.senderName,
        subject: emailData.subject,
        bodyText: emailData.bodyText,
        bodyHtml: emailData.bodyHtml,
        rawEmail: emailData.rawEmail,
        suggestedClients: JSON.stringify(
          matchResult.matchedClient ? [matchResult.matchedClient] : []
        ),
        suggestedProjects: JSON.stringify(
          matchResult.matchedProject ? [matchResult.matchedProject] : []
        )
      }
    });

    return {
      matched: false,
      needsTriage: true,
      suggestions: {
        clients: matchResult.matchedClient ? [matchResult.matchedClient] : [],
        projects: matchResult.matchedProject ? [matchResult.matchedProject] : []
      }
    };
  }

  // Step 2: Analyze Message
  const analysis = await analyzeMessage(thread.messages[0], thread, thread.project);

  // Update thread with analysis
  await prisma.thread.update({
    where: { id: thread.id },
    data: {
      aiAnalysis: JSON.stringify(analysis),
      intent: analysis.intent,
      sentiment: analysis.sentiment,
      priority: analysis.urgency,
      urgencyReason: analysis.urgencyReason
    }
  });

  // Step 3: Auto-Assign
  const assignment = await assignThread(thread);
  if (assignment.userId) {
    await prisma.thread.update({
      where: { id: thread.id },
      data: { assignedToId: assignment.userId }
    });

    // Create notification for assigned user
    await prisma.notification.create({
      data: {
        type: 'THREAD_ASSIGNED',
        title: 'New thread assigned',
        message: `You have been assigned: ${thread.subject}`,
        data: JSON.stringify({ threadId: thread.id }),
        userId: assignment.userId
      }
    });
  }

  // Step 4: Replan Project (if matched to a project)
  if (thread.projectId) {
    await replanProject(thread.projectId, thread.messages[0]);
  }

  // Step 5: Draft Response (optional, can be triggered manually)
  let draftResult = null;
  if (analysis.urgency === 'CRITICAL' || analysis.urgency === 'HIGH') {
    draftResult = await draftResponse(thread, analysis);
  }

  return {
    matched: true,
    threadId: thread.id,
    clientId: thread.clientId,
    projectId: thread.projectId,
    analysis,
    assignment,
    needsTriage,
    draftGenerated: !!draftResult
  };
}

/**
 * Step 1: Parse email and match to client/project
 */
async function parseAndMatchEmail(emailData) {
  // Get all clients and contacts for matching
  const [clients, contacts] = await Promise.all([
    prisma.client.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, domain: true }
    }),
    prisma.contact.findMany({
      select: { email: true, name: true, clientId: true }
    })
  ]);

  const { system, prompt, temperature } = buildParseEmailPrompt({
    email: emailData,
    clients,
    contacts
  });

  try {
    const result = await aiClient.chatJSON({ system, prompt, temperature });
    return result;
  } catch (error) {
    console.error('Parse email AI error:', error);
    return {
      matchedClient: null,
      matchedProject: null,
      extractedSender: {
        email: emailData.senderEmail,
        name: emailData.senderName
      },
      isSpamOrIrrelevant: { likely: false }
    };
  }
}

/**
 * Step 2: Analyze message content
 */
export async function analyzeMessage(message, thread, project) {
  const { system, prompt, temperature } = buildAnalyzeMessagePrompt({
    message,
    thread,
    project
  });

  try {
    const result = await aiClient.chatJSON({ system, prompt, temperature });
    return result;
  } catch (error) {
    console.error('Analyze message AI error:', error);
    return {
      intent: 'general',
      summary: message.bodyText.substring(0, 200),
      urgency: 'NORMAL',
      urgencyReason: 'Unable to analyze',
      sentiment: 'neutral',
      actionItems: [],
      questionsToAnswer: [],
      responseApproach: {
        suggestedTone: 'professional',
        keyPointsToAddress: []
      }
    };
  }
}

/**
 * Step 4: Replan project based on new message
 */
async function replanProject(projectId, newMessage) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      threads: {
        where: { status: { not: 'RESOLVED' } },
        orderBy: { lastActivityAt: 'desc' }
      }
    }
  });

  if (!project) return null;

  const { system, prompt, temperature } = buildReplanProjectPrompt({
    project,
    threads: project.threads,
    newMessage
  });

  try {
    const result = await aiClient.chatJSON({ system, prompt, temperature });

    // Update project with new plan
    await prisma.project.update({
      where: { id: projectId },
      data: {
        aiSummary: result.projectSummary,
        aiPlan: JSON.stringify(result.plan),
        health: result.overallHealth,
        healthScore: result.healthScore,
        risks: JSON.stringify(result.risks)
      }
    });

    // Create tasks from immediate items
    if (result.plan.immediate?.length > 0) {
      for (const item of result.plan.immediate) {
        await prisma.task.create({
          data: {
            title: item.task,
            description: item.reason,
            priority: 'HIGH',
            category: 'IMMEDIATE',
            estimatedTime: item.estimatedTime,
            blockedBy: item.blockedBy,
            aiGenerated: true,
            projectId
          }
        });
      }
    }

    return result;
  } catch (error) {
    console.error('Replan project AI error:', error);
    return null;
  }
}

/**
 * Step 5: Draft response options
 */
async function draftResponse(thread, analysis) {
  const { system, prompt, temperature } = buildDraftResponsePrompt({
    message: thread.messages[0],
    thread,
    project: thread.project,
    analysis,
    client: thread.client
  });

  try {
    const result = await aiClient.chatJSON({ system, prompt, temperature });

    // Save draft response
    if (result.options?.length > 0) {
      await prisma.response.create({
        data: {
          subject: result.options[0].subject,
          body: result.options[0].body,
          tone: result.options[0].tone,
          aiGenerated: true,
          aiOptions: JSON.stringify(result),
          status: 'DRAFT',
          threadId: thread.id,
          draftedById: thread.assignedToId // Will be null if unassigned
        }
      });
    }

    return result;
  } catch (error) {
    console.error('Draft response AI error:', error);
    return null;
  }
}

export { parseAndMatchEmail, replanProject, draftResponse };
