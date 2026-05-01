// Multi-platform message paste intake routes

import prisma from '../config/db.js';
import aiClient from '../ai/client.js';

export default async function messageRoutes(fastify) {
  // Paste content from any platform and extract structured data
  fastify.post('/messages/paste', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { content, source = 'other', projectId } = request.body;

    if (!content || content.trim().length === 0) {
      return reply.status(400).send({ error: 'Content is required' });
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
      "assignmentSuggestion": "dev|design|cameron|anyone",
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

    try {
      const extracted = await aiClient.chatJSON({ system, prompt, temperature: 0.2 });

      // If a projectId was specified, create tasks from action items
      const createdTasks = [];
      if (projectId && extracted.actionItems?.length > 0) {
        for (const item of extracted.actionItems) {
          const task = await prisma.task.create({
            data: {
              title: item.task,
              priority: item.priority || 'NORMAL',
              category: item.priority === 'CRITICAL' || item.priority === 'HIGH' ? 'IMMEDIATE' : 'THIS_WEEK',
              projectId,
              aiGenerated: true,
              dueDate: item.dueDate ? new Date(item.dueDate) : null
            }
          });
          createdTasks.push(task);
        }
      }

      // Create a thread if there's enough context
      let createdThread = null;
      if (projectId && extracted.summary) {
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { clientId: true }
        });

        if (project) {
          createdThread = await prisma.thread.create({
            data: {
              subject: `[${source.toUpperCase()}] ${extracted.summary.substring(0, 100)}`,
              status: 'OPEN',
              priority: extracted.actionItems?.[0]?.priority || 'NORMAL',
              intent: extracted.suggestedIntent || 'general',
              clientId: project.clientId,
              projectId,
              needsTriage: true,
              messages: {
                create: {
                  direction: 'INBOUND',
                  senderEmail: extracted.sender?.email || `${source}@paste.agencyhub`,
                  senderName: extracted.sender?.name || `${source} paste`,
                  subject: `Pasted from ${source}`,
                  bodyText: content,
                  aiExtracted: JSON.stringify(extracted)
                }
              }
            }
          });
        }
      }

      return reply.status(201).send({
        extracted,
        createdTasks,
        createdThread,
        source,
        projectId
      });
    } catch (error) {
      console.error('Paste intake AI error:', error);
      return reply.status(500).send({ error: 'Failed to process pasted content' });
    }
  });
}
