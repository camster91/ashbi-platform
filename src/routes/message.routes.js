// Multi-platform message paste intake routes

import aiClient from '../ai/client.js';
import {validateBody, messagePasteSchema} from '../validators/schemas.js';
import { aiErrorBody, isAiControlError, sendAiError } from '../ai/errors.js';

const PRIORITIES = new Set(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']);
const INTENTS = new Set([
  'bug_report', 'feature_request', 'question', 'approval_request', 'feedback',
  'status_update', 'urgent_issue', 'revision_request', 'general',
]);
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

/** A priority the app knows, or NORMAL. */
export function pastePriority(value) {
  const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return PRIORITIES.has(upper) ? upper : 'NORMAL';
}

/** An intent the app knows, or null. */
export function pasteIntent(value) {
  return typeof value === 'string' && INTENTS.has(value.trim()) ? value.trim() : null;
}

/**
 * The sender the AI reported, kept only when it looks like one: a plain email
 * address and a short one-line name. Anything else falls back to the source.
 */
export function pasteSender(sender, source) {
  const email = typeof sender?.email === 'string' ? sender.email.trim().toLowerCase() : '';
  // eslint-disable-next-line no-control-regex
  const name = typeof sender?.name === 'string' ? sender.name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
  return {
    senderEmail: email.length <= 254 && EMAIL.test(email) ? email : `${source}@paste.agencyhub`,
    senderName: name && name.length <= 120 && name.toLowerCase() !== 'null' ? name : `${source} paste`,
  };
}

export default async function messageRoutes(fastify) {
  // Paste content from any platform and extract structured data
  fastify.post('/paste', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(messagePasteSchema),
  }, async (request, reply) => {
    const { content, source = 'other', projectId } = request.body;

    if (!content || content.trim().length === 0) {
      return reply.status(400).send({ error: 'Content is required' });
    }

    // Tasks and the thread are created on this project, so it must be visible
    // to the caller (request.prisma is tenant-scoped) before any AI call.
    let project = null;
    if (projectId) {
      project = await request.prisma.project.findUnique({
        where: { id: projectId },
        select: { clientId: true }
      });
      if (!project) {
        return reply.status(404).send({ error: 'Project not found' });
      }
    }

    const system = `You are an AI assistant for Agency Hub, an agency client management system.
Your task is to parse pasted content from "${source}" and extract structured information.

Extract:
1. Any action items or tasks mentioned
2. Client information (name, company, contact info)
3. Revision requests or change requests
4. Key decisions or approvals
5. Questions that need answers
6. Deadlines or timeline mentions

Be thorough - extract even implied action items.`;

    const prompt = `Parse this content pasted from ${source}:

---
${content}
---

Respond with JSON:
{
  "summary": "2-3 sentence summary of the content",
  "sender": {
    "name": "sender name if identifiable or null",
    "email": "email if found or null",
    "company": "company if identifiable or null"
  },
  "actionItems": [
    {
      "task": "specific task description",
      "assignmentSuggestion": "dev|design|account_lead|anyone",
      "priority": "CRITICAL|HIGH|NORMAL|LOW",
      "dueDate": "extracted date or null"
    }
  ],
  "revisionRequests": [
    {
      "description": "what needs to change",
      "area": "design|copy|code|strategy|other",
      "urgency": "HIGH|NORMAL|LOW"
    }
  ],
  "questions": [
    {
      "question": "question that needs answering",
      "priority": "must_answer|should_answer|optional"
    }
  ],
  "keyDecisions": ["any decisions mentioned"],
  "deadlines": [
    {
      "item": "what has a deadline",
      "date": "the deadline date/time",
      "isHard": true
    }
  ],
  "suggestedIntent": "bug_report|feature_request|question|approval_request|feedback|status_update|urgent_issue|revision_request|general"
}`;

    // AI analysis is a bonus: the pasted message is saved whether or not it
    // succeeds, so a missing or failing AI provider never loses client words.
    let extracted = null;
    let analysis = { status: 'complete' };
    let aiError = null;
    try {
      extracted = await aiClient.chatJSON({ system, prompt, temperature: 0.2 });
      if (!extracted || typeof extracted !== 'object') throw new Error('AI returned no analysis');
    } catch (error) {
      extracted = null;
      if (isAiControlError(error)) {
        aiError = error;
        analysis = { status: 'failed', ...aiErrorBody(error) };
      } else {
        request.log.warn({ errorName: error?.name }, 'Paste intake AI analysis failed');
        analysis = {
          status: 'failed',
          code: 'AI_ANALYSIS_FAILED',
          error: 'AI could not analyze this message, so no tasks were created. The message itself was saved.',
        };
      }
    }

    // Without a project there is no client to file the message under, so
    // nothing is stored: answer with the analysis, or with why it failed.
    if (!project) {
      if (aiError) return sendAiError(reply, aiError);
      if (!extracted) {
        return reply.status(502).send({
          error: 'AI could not analyze this message, and nothing was saved because no project was chosen. Try again in a minute, or paste it from a project.',
          code: analysis.code,
        });
      }
      return reply.status(201).send({ extracted, analysis, createdTasks: [], createdThread: null, source, projectId });
    }

    const firstLine = content.trim().split('\n')[0].trim();
    const summary = typeof extracted?.summary === 'string' ? extracted.summary.trim() : '';
    const headline = summary || firstLine || 'Pasted message';
    const actionItems = Array.isArray(extracted?.actionItems) ? extracted.actionItems : [];
    const taskRows = actionItems
      .filter((item) => typeof item?.task === 'string' && item.task.trim())
      .map((item) => {
        const priority = pastePriority(item.priority);
        const dueDate = item.dueDate ? new Date(item.dueDate) : null;
        return {
          title: item.task.trim().slice(0, 500),
          priority,
          category: priority === 'CRITICAL' || priority === 'HIGH' ? 'IMMEDIATE' : 'THIS_WEEK',
          projectId,
          aiGenerated: true,
          dueDate: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null,
        };
      });

    // The thread, the message and its tasks are saved together: a failure
    // part-way leaves nothing behind, so a retry cannot duplicate them.
    const { createdThread, createdTasks } = await request.prisma.$transaction(async (tx) => {
      const thread = await tx.thread.create({
        data: {
          subject: `[${source.toUpperCase()}] ${headline.substring(0, 100)}`,
          status: 'OPEN',
          priority: taskRows[0]?.priority || 'NORMAL',
          intent: pasteIntent(extracted?.suggestedIntent),
          clientId: project.clientId,
          projectId,
          needsTriage: true,
          messages: {
            create: {
              direction: 'INBOUND',
              ...pasteSender(extracted?.sender, source),
              subject: `Pasted from ${source}`,
              bodyText: content,
              // A failed analysis is recorded on the message, so it does not
              // read as an analysis that found nothing.
              aiExtracted: JSON.stringify(extracted
                ? extracted
                : { source, analysisStatus: 'failed', analysisErrorCode: analysis.code }),
            }
          }
        }
      });
      const tasks = [];
      for (const data of taskRows) tasks.push(await tx.task.create({ data }));
      return { createdThread: thread, createdTasks: tasks };
    });

    return reply.status(201).send({
      extracted,
      analysis,
      createdTasks,
      createdThread,
      source,
      projectId
    });
  });
}
