// Search routes

import { prisma } from '../index.js';
import aiClient from '../ai/client.js';

export default async function searchRoutes(fastify) {
  // Global search
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { q, type, clientId, projectId, limit: limitParam = '20' } = request.query;
    const limit = parseInt(limitParam);

    if (!q || q.length < 2) {
      return { results: [], query: q };
    }

    const results = {
      threads: [],
      clients: [],
      projects: [],
      messages: []
    };

    // Search based on type filter or all
    const searchAll = !type;

    if (searchAll || type === 'threads') {
      const threadWhere = {
        OR: [
          { subject: { contains: q } }
        ]
      };
      if (clientId) threadWhere.clientId = clientId;
      if (projectId) threadWhere.projectId = projectId;

      results.threads = await prisma.thread.findMany({
        where: threadWhere,
        include: {
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } }
        },
        orderBy: { lastActivityAt: 'desc' },
        take: limit
      });
    }

    if (searchAll || type === 'clients') {
      results.clients = await prisma.client.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { domain: { contains: q } }
          ]
        },
        take: limit
      });
    }

    if (searchAll || type === 'projects') {
      const projectWhere = {
        OR: [
          { name: { contains: q } },
          { description: { contains: q } }
        ]
      };
      if (clientId) projectWhere.clientId = clientId;

      results.projects = await prisma.project.findMany({
        where: projectWhere,
        include: {
          client: { select: { id: true, name: true } }
        },
        take: limit
      });
    }

    if (searchAll || type === 'messages') {
      const messageWhere = {
        OR: [
          { bodyText: { contains: q } },
          { subject: { contains: q } }
        ]
      };

      results.messages = await prisma.message.findMany({
        where: messageWhere,
        include: {
          thread: {
            select: {
              id: true,
              subject: true,
              client: { select: { id: true, name: true } }
            }
          }
        },
        orderBy: { receivedAt: 'desc' },
        take: limit
      });
    }

    // Calculate total count
    const totalResults = results.threads.length +
                         results.clients.length +
                         results.projects.length +
                         results.messages.length;

    return {
      query: q,
      totalResults,
      results
    };
  });

  // Find similar threads (for knowledge recall)
  fastify.get('/similar/:threadId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { threadId } = request.params;
    const { limit: limitParam = '5' } = request.query;
    const limit = parseInt(limitParam);

    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      include: {
        messages: { orderBy: { receivedAt: 'desc' }, take: 1 }
      }
    });

    if (!thread) {
      return reply.status(404).send({ error: 'Thread not found' });
    }

    // Simple keyword-based similarity (could be enhanced with AI embeddings)
    const keywords = extractKeywords(thread.subject + ' ' + (thread.messages[0]?.bodyText || ''));

    if (keywords.length === 0) {
      return { similar: [], threadId };
    }

    // Search for threads with similar keywords
    const similarThreads = await prisma.thread.findMany({
      where: {
        id: { not: threadId },
        OR: keywords.slice(0, 5).map(keyword => ({
          OR: [
            { subject: { contains: keyword } },
            { messages: { some: { bodyText: { contains: keyword } } } }
          ]
        }))
      },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      },
      orderBy: { lastActivityAt: 'desc' },
      take: limit
    });

    return {
      threadId,
      keywords: keywords.slice(0, 5),
      similar: similarThreads
    };
  });

  // Natural language query (AI-powered)
  fastify.post('/ask', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { question, clientId, projectId } = request.body;

    if (!question || question.trim().length < 3) {
      return reply.status(400).send({ error: 'Question must be at least 3 characters' });
    }

    // Gather context from relevant entities
    let context = '';
    const sources = [];

    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { client: true, threads: { take: 10, orderBy: { lastActivityAt: 'desc' }, include: { messages: { take: 1, orderBy: { receivedAt: 'desc' } } } } }
      });
      if (project) {
        context += `Project "${project.name}" (${project.status}, Health: ${project.health})\n`;
        context += `Summary: ${project.aiSummary || 'No summary'}\n`;
        project.threads.forEach(t => {
          context += `Thread: ${t.subject} (${t.status}) - ${t.messages[0]?.bodyText?.substring(0, 300) || ''}\n`;
          sources.push({ type: 'thread', id: t.id, title: t.subject });
        });
      }
    }

    if (clientId) {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        include: { projects: true, threads: { take: 10, orderBy: { lastActivityAt: 'desc' } } }
      });
      if (client) {
        context += `Client "${client.name}" (${client.status})\n`;
        context += `Projects: ${client.projects.map(p => `${p.name} (${p.status})`).join(', ')}\n`;
        client.threads.forEach(t => {
          sources.push({ type: 'thread', id: t.id, title: t.subject });
        });
      }
    }

    // If no specific context, search broadly
    if (!context) {
      const keywords = question.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
      if (keywords.length > 0) {
        const threads = await prisma.thread.findMany({
          where: { OR: keywords.map(k => ({ subject: { contains: k } })) },
          take: 10,
          orderBy: { lastActivityAt: 'desc' },
          include: { messages: { take: 1, orderBy: { receivedAt: 'desc' } }, client: { select: { name: true } }, project: { select: { name: true } } }
        });
        threads.forEach(t => {
          context += `Thread: ${t.subject} (Client: ${t.client?.name || 'Unknown'}, Project: ${t.project?.name || 'None'}) - ${t.messages[0]?.bodyText?.substring(0, 300) || ''}\n`;
          sources.push({ type: 'thread', id: t.id, title: t.subject });
        });
      }
    }

    const system = `You are an AI assistant for Agency Hub. Answer questions about clients, projects, and communications based on the provided context. If the context doesn't contain enough information, say so clearly.`;
    const prompt = `Context:\n${context || 'No relevant data found.'}\n\nQuestion: ${question}\n\nProvide a concise, helpful answer.`;

    try {
      const answer = await aiClient.chat({ system, prompt, temperature: 0.3 });
      return { question, answer, sources };
    } catch (error) {
      return { question, answer: 'Unable to process question at this time.', sources: [] };
    }
  });
}

// Simple keyword extraction
function extractKeywords(text) {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'this', 'that',
    'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what',
    'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
    'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not',
    'only', 'same', 'so', 'than', 'too', 'very', 'just', 'hi', 'hello',
    'thanks', 'thank', 'please', 'regards', 'best', 'team'
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word))
    .slice(0, 20);
}
