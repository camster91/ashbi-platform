// AI routes (direct AI interactions)

import prisma from '../config/db.js';
import aiClient from '../ai/client.js';
import { buildDraftResponsePrompt } from '../ai/prompts/draftResponse.js';
import { buildAnalyzeMessagePrompt } from '../ai/prompts/analyzeMessage.js';

export default async function aiRoutes(fastify) {
  // Generate response drafts for a thread
  fastify.post('/draft-response', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { threadId } = request.body;

    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      include: {
        client: true,
        project: true,
        messages: { orderBy: { receivedAt: 'desc' }, take: 5 }
      }
    });

    if (!thread || !thread.messages[0]) {
      return reply.status(404).send({ error: 'Thread or messages not found' });
    }

    // Get analysis if available
    const analysis = thread.aiAnalysis
      ? JSON.parse(thread.aiAnalysis)
      : {
          intent: 'general',
          urgency: thread.priority,
          sentiment: 'neutral',
          summary: thread.messages[0].bodyText.substring(0, 200),
          questionsToAnswer: [],
          responseApproach: { keyPointsToAddress: [] }
        };

    const { system, prompt, temperature } = buildDraftResponsePrompt({
      message: thread.messages[0],
      thread,
      project: thread.project,
      analysis,
      client: thread.client
    });

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature });

      // Save the drafts as a response record
      const response = await prisma.response.create({
        data: {
          subject: result.options[0].subject,
          body: result.options[0].body,
          tone: result.options[0].tone,
          aiGenerated: true,
          aiOptions: JSON.stringify(result),
          status: 'DRAFT',
          threadId,
          draftedById: request.user.id
        }
      });

      return {
        responseId: response.id,
        recommendedOption: result.recommendedOption,
        recommendationReason: result.recommendationReason,
        options: result.options,
        warnings: result.warnings,
        needsPersonalTouch: result.needsPersonalTouch,
        personalTouchReason: result.personalTouchReason
      };
    } catch (error) {
      fastify.log.error('AI draft error:', error);
      return reply.status(500).send({
        error: 'Failed to generate response',
        message: error.message
      });
    }
  });

  // Refine an existing response with AI
  fastify.post('/refine-response', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { responseId, instruction } = request.body;

    const response = await prisma.response.findUnique({
      where: { id: responseId },
      include: {
        thread: {
          include: {
            messages: { orderBy: { receivedAt: 'desc' }, take: 1 }
          }
        }
      }
    });

    if (!response) {
      return reply.status(404).send({ error: 'Response not found' });
    }

    const system = `You are an AI assistant helping refine email responses.
Your task is to modify the given response according to the instruction while maintaining professionalism and addressing the original message.`;

    const prompt = `Original client message:
${response.thread.messages[0]?.bodyText || 'No message content'}

Current response draft:
Subject: ${response.subject}
Body: ${response.body}

Instruction: ${instruction}

Respond with JSON:
{
  "subject": "updated subject line",
  "body": "updated email body",
  "changes": ["list of changes made"]
}`;

    try {
      const result = await aiClient.chatJSON({
        system,
        prompt,
        temperature: 0.5
      });

      // Update the response
      await prisma.response.update({
        where: { id: responseId },
        data: {
          subject: result.subject,
          body: result.body
        }
      });

      return {
        subject: result.subject,
        body: result.body,
        changes: result.changes
      };
    } catch (error) {
      fastify.log.error('AI refine error:', error);
      return reply.status(500).send({
        error: 'Failed to refine response',
        message: error.message
      });
    }
  });

  // Ask AI a question about a thread/project
  fastify.post('/ask', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { question, threadId, projectId, clientId } = request.body;

    let context = '';

    // Gather relevant context
    if (threadId) {
      const thread = await prisma.thread.findUnique({
        where: { id: threadId },
        include: {
          messages: { orderBy: { receivedAt: 'asc' } },
          client: true,
          project: true
        }
      });
      if (thread) {
        context += `Thread: ${thread.subject}\n`;
        context += `Client: ${thread.client?.name || 'Unknown'}\n`;
        context += `Project: ${thread.project?.name || 'None'}\n\n`;
        context += 'Messages:\n';
        thread.messages.forEach(m => {
          context += `[${m.direction}] ${m.senderEmail}: ${m.bodyText}\n\n`;
        });
      }
    }

    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { client: true }
      });
      if (project) {
        context += `Project: ${project.name}\n`;
        context += `Client: ${project.client?.name || 'Unknown'}\n`;
        context += `Status: ${project.status}\n`;
        context += `Summary: ${project.aiSummary || 'No summary'}\n`;
      }
    }

    if (clientId) {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        include: {
          projects: true,
          threads: {
            orderBy: { lastActivityAt: 'desc' },
            take: 5
          }
        }
      });
      if (client) {
        context += `Client: ${client.name}\n`;
        context += `Projects: ${client.projects.map(p => p.name).join(', ')}\n`;
        context += `Recent threads: ${client.threads.map(t => t.subject).join(', ')}\n`;
      }
    }

    const system = `You are an AI assistant for Agency Hub, helping answer questions about clients, projects, and communications.
Base your answers only on the provided context. If the context doesn't contain enough information, say so.`;

    const prompt = `Context:
${context || 'No specific context provided.'}

Question: ${question}

Provide a helpful, concise answer.`;

    try {
      const answer = await aiClient.chat({
        system,
        prompt,
        temperature: 0.4
      });

      return { question, answer, context: context ? 'Context provided' : 'No context' };
    } catch (error) {
      fastify.log.error('AI ask error:', error);
      return reply.status(500).send({
        error: 'Failed to get answer',
        message: error.message
      });
    }
  });

  // Draft a polished client-facing status update email
  fastify.post('/draft-update', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { projectId, rawNotes, includeRevisionStatus = false } = request.body;

    if (!projectId || !rawNotes) {
      return reply.status(400).send({ error: 'projectId and rawNotes are required' });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        tasks: {
          where: { status: { not: 'COMPLETED' } },
          take: 10,
          orderBy: { priority: 'asc' }
        },
        revisionRounds: {
          orderBy: { roundNumber: 'desc' },
          take: 3
        }
      }
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    let revisionContext = '';
    if (includeRevisionStatus && project.revisionRounds?.length > 0) {
      revisionContext = `\nRevision Rounds:\n${project.revisionRounds.map(r =>
        `- Round ${r.roundNumber}: ${r.status}${r.notes ? ` - ${r.notes}` : ''}`
      ).join('\n')}`;
    }

    const system = `You are a professional agency account manager drafting client status update emails.
Write polished, clear, and reassuring updates. Be specific about progress and next steps.
Match a professional yet friendly tone. Use the agency name "Ashbi Design" when appropriate.
Cameron (CEO/SEO) approves all outgoing communications before they are sent.`;

    const prompt = `Draft a client status update email for this project:

Project: ${project.name}
Client: ${project.client?.name || 'Unknown'}
Status: ${project.status}
Health: ${project.health}

Raw notes from team:
${rawNotes}

Open tasks:
${project.tasks.map(t => `- ${t.title} (${t.status}, ${t.priority})`).join('\n') || 'No open tasks'}
${revisionContext}

Respond with JSON:
{
  "subject": "email subject line",
  "body": "full polished email body",
  "tone": "professional|friendly|reassuring"
}`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.5 });
      return result;
    } catch (error) {
      fastify.log.error('AI draft-update error:', error);
      return reply.status(500).send({ error: 'Failed to draft update', message: error.message });
    }
  });

  // ==================== AI CHAT ====================
  fastify.post('/chat', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { message, context } = request.body;

    if (!message) {
      return reply.status(400).send({ error: 'message is required' });
    }

    // Pull relevant project/task context automatically
    let systemContext = '';

    // Get active projects summary
    const projects = await prisma.project.findMany({
      where: { status: 'ACTIVE' },
      include: {
        client: true,
        tasks: {
          where: { status: { not: 'COMPLETED' } },
          take: 5,
          orderBy: { priority: 'asc' }
        }
      },
      take: 10
    });

    if (projects.length > 0) {
      systemContext += 'Active Projects:\n';
      for (const p of projects) {
        systemContext += `- ${p.name} (${p.client?.name || 'No client'}) - Health: ${p.health}, ${p.tasks.length} open tasks\n`;
        if (p.aiSummary) systemContext += `  Summary: ${p.aiSummary}\n`;
      }
      systemContext += '\n';
    }

    // Get recent threads needing attention
    const urgentThreads = await prisma.thread.findMany({
      where: { status: { in: ['OPEN', 'AWAITING_RESPONSE'] } },
      include: { client: true, project: true },
      orderBy: { lastActivityAt: 'desc' },
      take: 5
    });

    if (urgentThreads.length > 0) {
      systemContext += 'Recent Open Threads:\n';
      for (const t of urgentThreads) {
        systemContext += `- "${t.subject}" (${t.priority}) - ${t.client?.name || 'Unknown'} - ${t.status}\n`;
      }
      systemContext += '\n';
    }

    // Get overdue tasks
    const overdueTasks = await prisma.task.findMany({
      where: {
        status: { not: 'COMPLETED' },
        dueDate: { lt: new Date() }
      },
      include: { project: true, assignee: true },
      take: 10
    });

    if (overdueTasks.length > 0) {
      systemContext += 'Overdue Tasks:\n';
      for (const t of overdueTasks) {
        systemContext += `- ${t.title} (${t.project?.name || 'No project'}) - assigned to ${t.assignee?.name || 'unassigned'}\n`;
      }
      systemContext += '\n';
    }

    // Get client retainer status
    const retainers = await prisma.retainerPlan.findMany({
      include: { client: true }
    });

    if (retainers.length > 0) {
      systemContext += 'Retainer Status:\n';
      for (const r of retainers) {
        const pct = r.hoursPerMonth > 0 ? Math.round((r.hoursUsed / r.hoursPerMonth) * 100) : 0;
        systemContext += `- ${r.client?.name}: ${r.hoursUsed}/${r.hoursPerMonth}h used (${pct}%)\n`;
      }
      systemContext += '\n';
    }

    const system = `You are the AI assistant for Ashbi Design's Agency Hub. Ashbi Design is a Toronto-based CPG/DTC creative agency, family-run with 10+ years experience. Cameron is the CEO/SEO lead, Bianca is the Creative Director.

You help Cameron and Bianca manage their agency: answering questions about projects, clients, tasks, and operations. Be concise, actionable, and friendly.

Current Agency Context:
${systemContext}
${context ? `Additional context from user: ${context}` : ''}`;

    try {
      const answer = await aiClient.chat({
        system,
        prompt: message,
        temperature: 0.7
      });

      return { message: answer };
    } catch (error) {
      fastify.log.error('AI chat error:', error);
      return reply.status(500).send({ error: 'Failed to get response', message: error.message });
    }
  });

  // ==================== PROPOSAL GENERATOR ====================
  fastify.post('/generate-proposal', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { clientName, projectType, budgetRange, notes } = request.body;

    if (!clientName || !projectType) {
      return reply.status(400).send({ error: 'clientName and projectType are required' });
    }

    const system = `You are a proposal writer for Ashbi Design, a Toronto-based CPG/DTC creative agency. Family-run with 10+ years of experience in branding, web design, packaging, and SEO for consumer brands.

Write compelling, professional proposals that reflect Ashbi's expertise in the CPG/DTC space. Tone should be confident yet warm, emphasizing partnership and results. Include specific deliverables, timelines, and value propositions.`;

    const prompt = `Generate a full client proposal for the following:

Client: ${clientName}
Project Type: ${projectType}
Budget Range: ${budgetRange || 'Not specified'}
Additional Notes: ${notes || 'None'}

Write a complete proposal that includes:
1. Introduction / About Ashbi Design
2. Understanding of the client's needs
3. Proposed approach and methodology
4. Deliverables with descriptions
5. Timeline
6. Investment / pricing (use the budget range as a guide)
7. Why Ashbi Design (differentiators)
8. Next steps

Format the proposal as clean, professional text ready to be sent to a client. Do not use markdown headers - use clean formatting with clear sections.`;

    try {
      const proposal = await aiClient.chat({
        system,
        prompt,
        temperature: 0.6
      });

      return { proposal, clientName, projectType };
    } catch (error) {
      fastify.log.error('AI generate-proposal error:', error);
      return reply.status(500).send({ error: 'Failed to generate proposal', message: error.message });
    }
  });

  // ==================== CLIENT HEALTH ====================
  fastify.post('/client-health', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const clients = await prisma.client.findMany({
      where: { status: 'ACTIVE' },
      include: {
        threads: {
          where: { status: { not: 'RESOLVED' } },
          orderBy: { lastActivityAt: 'desc' }
        },
        projects: {
          where: { status: 'ACTIVE' },
          include: {
            tasks: {
              where: { status: { not: 'COMPLETED' } }
            }
          }
        },
        retainerPlan: true
      }
    });

    const now = new Date();
    const healthScores = clients.map(client => {
      let score = 100;

      // Days since last communication
      const lastThread = client.threads[0];
      if (lastThread) {
        const daysSince = (now - new Date(lastThread.lastActivityAt)) / (1000 * 60 * 60 * 24);
        if (daysSince > 14) score -= 25;
        else if (daysSince > 7) score -= 15;
        else if (daysSince > 3) score -= 5;
      } else {
        score -= 20; // No threads at all
      }

      // Open task count
      const openTasks = client.projects.reduce((sum, p) => sum + p.tasks.length, 0);
      if (openTasks > 10) score -= 15;
      else if (openTasks > 5) score -= 10;

      // Retainer hours remaining %
      if (client.retainerPlan) {
        const pctUsed = client.retainerPlan.hoursPerMonth > 0
          ? (client.retainerPlan.hoursUsed / client.retainerPlan.hoursPerMonth) * 100
          : 0;
        if (pctUsed > 90) score -= 20;
        else if (pctUsed > 75) score -= 10;
      }

      // Overdue tasks
      const overdueTasks = client.projects.reduce((sum, p) =>
        sum + p.tasks.filter(t => t.dueDate && new Date(t.dueDate) < now).length, 0);
      if (overdueTasks > 3) score -= 20;
      else if (overdueTasks > 0) score -= (overdueTasks * 5);

      score = Math.max(0, Math.min(100, score));

      return {
        id: client.id,
        name: client.name,
        score,
        openTasks,
        overdueTasks,
        daysSinceContact: lastThread
          ? Math.floor((now - new Date(lastThread.lastActivityAt)) / (1000 * 60 * 60 * 24))
          : null,
        retainerPct: client.retainerPlan
          ? Math.round((client.retainerPlan.hoursUsed / client.retainerPlan.hoursPerMonth) * 100)
          : null,
        projectCount: client.projects.length
      };
    });

    // Sort by score ascending (worst health first)
    healthScores.sort((a, b) => a.score - b.score);

    return { clients: healthScores };
  });

  // ==================== INBOX TRIAGE ====================
  fastify.post('/triage-inbox', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const threads = await prisma.thread.findMany({
      where: { status: 'OPEN' },
      include: {
        client: true,
        project: true,
        messages: { orderBy: { receivedAt: 'desc' }, take: 1 }
      }
    });

    if (threads.length === 0) {
      return { triaged: 0, summary: { urgent: 0, followUp: 0, waiting: 0, lowPriority: 0 }, threads: [] };
    }

    const threadSummaries = threads.map(t => ({
      id: t.id,
      subject: t.subject,
      client: t.client?.name || 'Unknown',
      project: t.project?.name || 'None',
      currentPriority: t.priority,
      lastMessage: t.messages[0]?.bodyText?.substring(0, 200) || 'No message',
      daysSinceActivity: Math.floor((new Date() - new Date(t.lastActivityAt)) / (1000 * 60 * 60 * 24)),
      sentiment: t.sentiment
    }));

    const system = `You are an AI assistant triaging an agency inbox. Categorize each thread by priority based on the content, client, and timing.`;

    const prompt = `Triage these ${threads.length} open threads. For each, assign a category:
- CRITICAL: Urgent issues, angry clients, deadlines today, blockers
- HIGH: Important follow-ups needed, client questions pending, approaching deadlines
- NORMAL: Regular work items, non-urgent requests
- LOW: FYI messages, low-priority updates, can wait

Threads:
${threadSummaries.map((t, i) => `${i + 1}. [${t.id}] "${t.subject}" - Client: ${t.client} - Last activity: ${t.daysSinceActivity} days ago - Current: ${t.currentPriority}
   Message preview: ${t.lastMessage}`).join('\n\n')}

Respond with JSON:
{
  "results": [
    { "id": "thread_id", "priority": "CRITICAL|HIGH|NORMAL|LOW", "reason": "brief reason" }
  ]
}`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.2 });

      // Update thread priorities in DB
      const summary = { urgent: 0, followUp: 0, waiting: 0, lowPriority: 0 };
      const updatedThreads = [];

      for (const item of (result.results || [])) {
        const priority = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].includes(item.priority) ? item.priority : 'NORMAL';

        await prisma.thread.update({
          where: { id: item.id },
          data: { priority }
        });

        if (priority === 'CRITICAL') summary.urgent++;
        else if (priority === 'HIGH') summary.followUp++;
        else if (priority === 'NORMAL') summary.waiting++;
        else summary.lowPriority++;

        updatedThreads.push({ id: item.id, priority, reason: item.reason });
      }

      return {
        triaged: updatedThreads.length,
        summary,
        threads: updatedThreads
      };
    } catch (error) {
      fastify.log.error('AI triage error:', error);
      return reply.status(500).send({ error: 'Failed to triage inbox', message: error.message });
    }
  });

  // Generate project summary
  fastify.post('/summarize-project', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { projectId } = request.body;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        threads: {
          orderBy: { lastActivityAt: 'desc' },
          take: 10,
          include: {
            messages: { orderBy: { receivedAt: 'desc' }, take: 1 }
          }
        },
        tasks: {
          where: { status: { not: 'COMPLETED' } }
        }
      }
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const system = `You are an AI assistant generating project status summaries for an agency.
Be concise but informative. Focus on current state, blockers, and next steps.`;

    const prompt = `Generate a status summary for this project:

Project: ${project.name}
Client: ${project.client?.name || 'Unknown'}
Status: ${project.status}

Recent threads:
${project.threads.map(t => `- ${t.subject} (${t.status}, ${t.priority})`).join('\n')}

Open tasks:
${project.tasks.map(t => `- ${t.title} (${t.status})`).join('\n')}

Provide a 2-3 sentence summary of the project's current state.`;

    try {
      const summary = await aiClient.chat({
        system,
        prompt,
        temperature: 0.3
      });

      // Update the project summary
      await prisma.project.update({
        where: { id: projectId },
        data: { aiSummary: summary }
      });

      return { projectId, summary };
    } catch (error) {
      fastify.log.error('AI summarize error:', error);
      return reply.status(500).send({
        error: 'Failed to generate summary',
        message: error.message
      });
    }
  });

  // ==================== NATURAL LANGUAGE QUERY ====================
  fastify.post('/query', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { query } = request.body;

    if (!query || !query.trim()) {
      return reply.status(400).send({ error: 'query is required' });
    }

    // Determine what entities to search based on query keywords
    const q = query.toLowerCase();
    const results = [];

    try {
      // Search projects
      if (q.includes('project') || q.includes('overdue') || q.includes('active') || q.includes('at risk') || q.includes('health')) {
        const projects = await prisma.project.findMany({
          where: {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { status: q.includes('active') ? 'ACTIVE' : q.includes('completed') ? 'COMPLETED' : undefined },
              { health: q.includes('at risk') ? 'AT_RISK' : undefined }
            ].filter(Boolean)
          },
          include: { client: { select: { name: true } } },
          take: 10
        });
        for (const p of projects) {
          results.push({
            type: 'project',
            name: p.name,
            description: `${p.status} — ${p.health || 'Unknown'} health`,
            actionUrl: `/projects/${p.id}`,
            metadata: { client: p.client?.name, status: p.status, health: p.health }
          });
        }
      }

      // Search tasks
      if (q.includes('task') || q.includes('overdue') || q.includes('due') || q.includes('assigned') || q.includes('priority')) {
        const taskWhere = {};
        if (q.includes('overdue')) {
          taskWhere.status = { not: 'COMPLETED' };
          taskWhere.dueDate = { lt: new Date() };
        }

        const tasks = await prisma.task.findMany({
          where: Object.keys(taskWhere).length > 0 ? taskWhere : {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
            ]
          },
          include: { project: { select: { name: true } }, assignee: { select: { name: true } } },
          take: 10,
          orderBy: { priority: 'asc' }
        });
        for (const t of tasks) {
          results.push({
            type: 'task',
            name: t.title,
            description: `${t.status} — ${t.priority} priority`,
            actionUrl: `/projects/${t.projectId}`,
            metadata: { project: t.project?.name, assignee: t.assignee?.name, dueDate: t.dueDate }
          });
        }
      }

      // Search clients
      if (q.includes('client') || q.includes('customer')) {
        const clients = await prisma.client.findMany({
          where: {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { domain: { contains: query, mode: 'insensitive' } }
            ]
          },
          take: 10
        });
        for (const c of clients) {
          results.push({
            type: 'client',
            name: c.name,
            description: `${c.status} — ${c.domain || 'No domain'}`,
            actionUrl: `/clients/${c.id}`,
            metadata: { status: c.status, domain: c.domain }
          });
        }
      }

      // Generic search if no specific category matched
      if (results.length === 0) {
        const [projects, tasks, clients] = await Promise.all([
          prisma.project.findMany({
            where: { name: { contains: query, mode: 'insensitive' } },
            include: { client: { select: { name: true } } },
            take: 5
          }),
          prisma.task.findMany({
            where: { title: { contains: query, mode: 'insensitive' } },
            include: { project: { select: { name: true } } },
            take: 5
          }),
          prisma.client.findMany({
            where: { name: { contains: query, mode: 'insensitive' } },
            take: 5
          })
        ]);

        for (const p of projects) {
          results.push({ type: 'project', name: p.name, description: `${p.status} — ${p.client?.name}`, actionUrl: `/projects/${p.id}`, metadata: { status: p.status } });
        }
        for (const t of tasks) {
          results.push({ type: 'task', name: t.title, description: `${t.status}`, actionUrl: `/projects/${t.projectId}`, metadata: { project: t.project?.name } });
        }
        for (const c of clients) {
          results.push({ type: 'client', name: c.name, description: c.status, actionUrl: `/clients/${c.id}` });
        }
      }

      return { results };
    } catch (error) {
      fastify.log.error('AI query error:', error);
      return reply.status(500).send({ error: 'Query failed', message: error.message });
    }
  });
}
