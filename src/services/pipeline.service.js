// Email processing pipeline service

import prisma from '../config/db.js';
import aiClient from '../ai/client.js';
import { buildParseEmailPrompt } from '../ai/prompts/parseEmail.js';
import { buildAnalyzeMessagePrompt } from '../ai/prompts/analyzeMessage.js';
import { buildReplanProjectPrompt } from '../ai/prompts/replanProject.js';
import { buildDraftResponsePrompt } from '../ai/prompts/draftResponse.js';
import { assignThread } from './assignment.service.js';
import env from '../config/env.js';
import { normalizeInboundDeliveryKey } from './inbound-delivery-key.js';

// Idempotency (INTEGRATIONS.md, "Inbound email webhook"): a delivery with an
// `inboundDeliveryKey` stores it on the record created first (a thread or an
// unmatched email, both behind a unique index). Running the same delivery
// again finds that record and resumes it: an unmatched email returns the same
// result; a thread skips the steps its `inboundPipelineStage` says already
// committed. Each step's writes commit in one transaction with a
// compare-and-set of the stage marker (previous stage -> this stage), so a
// retry, or a concurrent run of the same delivery, never repeats a
// notification, AI task or draft response.
const PIPELINE_STAGES = ['CREATED', 'ANALYZED', 'ASSIGNED', 'REPLANNED', 'COMPLETED'];
const threadInclude = () => ({
  messages: { orderBy: { receivedAt: 'asc' } },
  client: true,
  project: true,
});

function stageReached(thread, stage) {
  return PIPELINE_STAGES.indexOf(thread.inboundPipelineStage || 'CREATED') >= PIPELINE_STAGES.indexOf(stage);
}

/**
 * Move a thread from the stage before `stage` to `stage` (plus `data`).
 * Returns false when another run already moved it.
 */
async function advanceStage(client, threadId, stage, data = {}) {
  const previous = PIPELINE_STAGES[PIPELINE_STAGES.indexOf(stage) - 1];
  const stageWhere = previous === 'CREATED'
    ? { OR: [{ inboundPipelineStage: 'CREATED' }, { inboundPipelineStage: null }] }
    : { inboundPipelineStage: previous };
  const { count } = await client.thread.updateMany({
    where: { id: threadId, ...stageWhere },
    data: { ...data, inboundPipelineStage: stage },
  });
  return count === 1;
}

// Thrown inside a step's transaction when another run of the same delivery
// already committed the step: rolls back this run's duplicate writes.
class StageAlreadyCommittedError extends Error {
  constructor(stage) {
    super(`Inbound email pipeline stage ${stage} was already committed`);
    this.name = 'StageAlreadyCommittedError';
    this.code = 'PIPELINE_STAGE_ALREADY_COMMITTED';
  }
}

function commitStage(threadId, stage) {
  return async (tx) => {
    if (!(await advanceStage(tx, threadId, stage))) throw new StageAlreadyCommittedError(stage);
  };
}

const isUniqueViolation = (error) => error?.code === 'P2002';

function parseJson(value, fallback) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function findThreadByDeliveryKey(inboundDeliveryKey) {
  return prisma.thread.findFirst({ where: { inboundDeliveryKey }, include: threadInclude() });
}

function findUnmatchedByDeliveryKey(inboundDeliveryKey) {
  return prisma.unmatchedEmail.findFirst({ where: { inboundDeliveryKey } });
}

function unmatchedResult(unmatched) {
  return {
    matched: false,
    needsTriage: true,
    suggestions: {
      clients: parseJson(unmatched.suggestedClients, []),
      projects: parseJson(unmatched.suggestedProjects, []),
    },
  };
}

/**
 * Create the record, or, when a concurrent run of the same delivery won the
 * race to the unique key, load the one it created.
 */
async function createOnce(create, findExisting, inboundDeliveryKey) {
  try {
    return await create();
  } catch (error) {
    if (!inboundDeliveryKey || !isUniqueViolation(error)) throw error;
    const existing = await findExisting(inboundDeliveryKey);
    // Not visible in this tenant: never resume another organization's record.
    if (!existing) throw error;
    return existing;
  }
}

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
  const inboundDeliveryKey = normalizeInboundDeliveryKey(emailData.inboundDeliveryKey);

  // A retried delivery resumes the record its earlier attempt created. This
  // runs before the AI match, which could decide differently the second time.
  if (inboundDeliveryKey) {
    const existingThread = await findThreadByDeliveryKey(inboundDeliveryKey);
    if (existingThread) return continueThreadPipeline(existingThread);
    const existingUnmatched = await findUnmatchedByDeliveryKey(inboundDeliveryKey);
    if (existingUnmatched) return unmatchedResult(existingUnmatched);
  }

  // Step 1: Parse & Match Email
  const matchResult = await parseAndMatchEmail(emailData);

  // Handle matching result
  if (matchResult.isSpamOrIrrelevant?.likely) {
    console.log('Email marked as spam/irrelevant:', matchResult.isSpamOrIrrelevant.reason);
    return { matched: false, spam: true, reason: matchResult.isSpamOrIrrelevant.reason };
  }

  const confidence = matchResult.matchedClient?.confidence;
  if (confidence >= env.suggestMatchThreshold) {
    // High confidence: create the thread automatically. Medium confidence:
    // create it too, but flag it for triage.
    const needsTriage = !(confidence >= env.autoMatchThreshold);
    const thread = await createOnce(() => prisma.thread.create({
      data: {
        subject: emailData.subject,
        status: 'AWAITING_RESPONSE',
        priority: 'NORMAL',
        matchConfidence: matchResult.matchedClient.confidence,
        matchReason: matchResult.matchedClient.matchReason,
        ...(needsTriage ? { needsTriage: true } : {}),
        clientId: matchResult.matchedClient.id,
        projectId: matchResult.matchedProject?.id || null,
        inboundDeliveryKey,
        inboundPipelineStage: 'CREATED',
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
      include: threadInclude()
    }), findThreadByDeliveryKey, inboundDeliveryKey);
    return continueThreadPipeline(thread);
  }

  // Low confidence - add to unmatched queue
  const unmatched = await createOnce(() => prisma.unmatchedEmail.create({
    data: {
      senderEmail: emailData.senderEmail,
      senderName: emailData.senderName,
      subject: emailData.subject,
      bodyText: emailData.bodyText,
      bodyHtml: emailData.bodyHtml,
      rawEmail: emailData.rawEmail,
      inboundDeliveryKey,
      suggestedClients: JSON.stringify(
        matchResult.matchedClient ? [matchResult.matchedClient] : []
      ),
      suggestedProjects: JSON.stringify(
        matchResult.matchedProject ? [matchResult.matchedProject] : []
      )
    }
  }), findUnmatchedByDeliveryKey, inboundDeliveryKey);
  return unmatchedResult(unmatched);
}

/**
 * Steps 2-5 for a thread, skipping the steps an earlier attempt of the same
 * delivery already committed.
 */
async function continueThreadPipeline(thread) {
  const message = thread.messages[0];
  if (!message) throw new Error(`Thread ${thread.id} has no inbound message to process`);

  // Step 2: Analyze Message
  let analysis = stageReached(thread, 'ANALYZED') ? parseJson(thread.aiAnalysis, null) : null;
  if (!stageReached(thread, 'ANALYZED')) {
    analysis = await analyzeMessage(message, thread, thread.project);

    // Update thread with analysis
    const analyzed = await advanceStage(prisma, thread.id, 'ANALYZED', {
      aiAnalysis: JSON.stringify(analysis),
      intent: analysis.intent,
      sentiment: analysis.sentiment,
      priority: analysis.urgency,
      urgencyReason: analysis.urgencyReason
    });
    // A concurrent run of this delivery stored its analysis first: use it.
    if (!analyzed) analysis = (await storedAnalysis(thread.id)) ?? analysis;
  } else if (!analysis) {
    analysis = await analyzeMessage(message, thread, thread.project);
  }

  // Step 3: Auto-Assign. The assignment, its notification and the stage
  // marker commit together, so a retry never notifies twice.
  let assignment = null;
  if (!stageReached(thread, 'ASSIGNED')) {
    const proposed = await assignThread(thread);
    const committed = await prisma.$transaction(async (tx) => {
      const advanced = await advanceStage(tx, thread.id, 'ASSIGNED',
        proposed.userId ? { assignedToId: proposed.userId } : {});
      if (!advanced) return false;
      if (proposed.userId) {
        // Create notification for assigned user
        await tx.notification.create({
          data: {
            type: 'THREAD_ASSIGNED',
            title: 'New thread assigned',
            message: `You have been assigned: ${thread.subject}`,
            data: JSON.stringify({ threadId: thread.id }),
            userId: proposed.userId
          }
        });
      }
      return true;
    });
    if (committed) assignment = proposed;
  }
  if (!assignment) {
    const current = await prisma.thread.findUnique({ where: { id: thread.id }, select: { assignedToId: true } });
    assignment = {
      userId: current?.assignedToId || null,
      reason: 'Assigned by an earlier run of this delivery',
      rule: 'RESUMED'
    };
  }

  // Step 4: Replan Project (if matched to a project). The plan and its tasks
  // commit with the stage marker. The second advance is a no-op after a
  // committed replan; it marks a skipped replan, or one that failed and was
  // logged (as before), so a retry does not repeat it.
  if (!stageReached(thread, 'REPLANNED')) {
    if (thread.projectId) {
      await replanProject(thread.projectId, message, { onCommit: commitStage(thread.id, 'REPLANNED') });
    }
    await advanceStage(prisma, thread.id, 'REPLANNED');
  }

  // Step 5: Draft Response (optional, can be triggered manually). A saved
  // draft commits with the marker; otherwise the pipeline is marked
  // complete here.
  if (!stageReached(thread, 'COMPLETED')) {
    if (analysis.urgency === 'CRITICAL' || analysis.urgency === 'HIGH') {
      // The draft is attributed to the assignee from step 3 (the thread
      // record loaded or created above predates the assignment).
      await draftResponse({ ...thread, assignedToId: assignment.userId }, analysis, {
        onCommit: commitStage(thread.id, 'COMPLETED')
      });
    }
    await advanceStage(prisma, thread.id, 'COMPLETED');
  }
  const draftGenerated = (await prisma.response.count({ where: { threadId: thread.id, aiGenerated: true } })) > 0;

  return {
    matched: true,
    threadId: thread.id,
    clientId: thread.clientId,
    projectId: thread.projectId,
    analysis,
    assignment,
    needsTriage: !!thread.needsTriage,
    draftGenerated
  };
}

async function storedAnalysis(threadId) {
  const current = await prisma.thread.findUnique({ where: { id: threadId }, select: { aiAnalysis: true } });
  return parseJson(current?.aiAnalysis, null);
}

/**
 * Step 1: Parse email and match to client/project
 */
// Cache the (active clients + contacts) lookup that powers inbound-email
// matching. Previously this ran on every inbound email: 2 full findMany()s
// per message. Cache for 60s — clients/contacts change infrequently, but a
// stale-by-60s match is fine for routing.
const CLIENTS_CACHE_TTL_MS = 60_000;
let _clientsCache = null; // { expiresAt, clients, contacts }

async function getClientsAndContacts() {
  if (_clientsCache && _clientsCache.expiresAt > Date.now()) {
    return { clients: _clientsCache.clients, contacts: _clientsCache.contacts };
  }
  const [clients, contacts] = await Promise.all([
    prisma.client.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, domain: true }
    }),
    prisma.contact.findMany({
      select: { email: true, name: true, clientId: true }
    }),
  ]);
  _clientsCache = {
    expiresAt: Date.now() + CLIENTS_CACHE_TTL_MS,
    clients,
    contacts,
  };
  return { clients, contacts };
}

async function parseAndMatchEmail(emailData) {
  // Performance: clients + contacts are cached for 60s (see getClientsAndContacts).
  // The previous implementation hit prisma twice on every inbound email — at
  // Mailgun webhook scale (hundreds of messages/min) this dominated latency.
  const { clients, contacts } = await getClientsAndContacts();

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
async function replanProject(projectId, newMessage, { onCommit } = {}) {
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

    // The plan, its tasks and the caller's marker (onCommit) commit together,
    // so a retried email never creates the tasks twice.
    await prisma.$transaction(async (tx) => {
      // Update project with new plan
      await tx.project.update({
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
          await tx.task.create({
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

      if (onCommit) await onCommit(tx);
    });

    return result;
  } catch (error) {
    // Another run of the same email already replanned: nothing to report.
    if (error instanceof StageAlreadyCommittedError) return null;
    console.error('Replan project AI error:', error);
    return null;
  }
}

/**
 * Step 5: Draft response options
 */
async function draftResponse(thread, analysis, { onCommit } = {}) {
  const { system, prompt, temperature } = buildDraftResponsePrompt({
    message: thread.messages[0],
    thread,
    project: thread.project,
    analysis,
    client: thread.client
  });

  try {
    const result = await aiClient.chatJSON({ system, prompt, temperature });

    // Save draft response, together with the caller's marker (onCommit), so
    // a retried email never drafts twice.
    if (result.options?.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.response.create({
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
        if (onCommit) await onCommit(tx);
      });
    }

    return result;
  } catch (error) {
    // Another run of the same email already saved its draft.
    if (error instanceof StageAlreadyCommittedError) return null;
    console.error('Draft response AI error:', error);
    return null;
  }
}

export { parseAndMatchEmail, replanProject, draftResponse };
