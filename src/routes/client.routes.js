// Client routes

import { prisma } from '../index.js';
import { safeParse } from '../utils/safeParse.js';

export default async function clientRoutes(fastify) {
  // List all clients
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { status, search } = request.query;

    const where = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { domain: { contains: search } }
      ];
    }

    const clients = await prisma.client.findMany({
      where,
      include: {
        _count: {
          select: {
            projects: true,
            threads: true,
            contacts: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    return clients;
  });

  // Create client
  fastify.post('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { name, domain, status = 'ACTIVE' } = request.body;

    // Check for duplicate domain
    if (domain) {
      const existing = await prisma.client.findUnique({
        where: { domain }
      });
      if (existing) {
        return reply.status(400).send({ error: 'Client with this domain already exists' });
      }
    }

    const client = await prisma.client.create({
      data: { name, domain, status }
    });

    return reply.status(201).send(client);
  });

  // Get single client with full details
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        contacts: true,
        projects: {
          include: {
            _count: {
              select: { threads: true, tasks: true }
            }
          },
          orderBy: { updatedAt: 'desc' }
        },
        threads: {
          orderBy: { lastActivityAt: 'desc' },
          take: 10,
          include: {
            project: { select: { id: true, name: true } },
            assignedTo: { select: { id: true, name: true } }
          }
        },
        invoices: {
          orderBy: { createdAt: 'desc' },
          include: {
            createdBy: { select: { id: true, name: true } }
          }
        }
      }
    });

    if (!client) {
      return reply.status(404).send({ error: 'Client not found' });
    }

    // Calculate invoice totals
    const invoices = client.invoices || [];
    const now = new Date();
    const totalRevenue = invoices
      .filter(i => i.status === 'PAID')
      .reduce((sum, i) => sum + i.total, 0);
    const outstandingBalance = invoices
      .filter(i => i.status === 'SENT' || (i.status === 'SENT' && i.dueDate && new Date(i.dueDate) < now))
      .reduce((sum, i) => sum + i.total, 0);

    // Flag overdue
    const processedInvoices = invoices.map(inv => ({
      ...inv,
      isOverdue: inv.status === 'SENT' && inv.dueDate && new Date(inv.dueDate) < now
    }));

    // Parse JSON fields
    return {
      ...client,
      invoices: processedInvoices,
      totalRevenue,
      outstandingBalance,
      communicationPrefs: safeParse(client.communicationPrefs, {}),
      satisfactionSignals: safeParse(client.satisfactionSignals, {}),
      knowledgeBase: safeParse(client.knowledgeBase, {})
    };
  });

  // Update client
  fastify.put('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, domain, status, communicationPrefs, knowledgeBase } = request.body;

    const data = {};
    if (name) data.name = name;
    if (domain !== undefined) data.domain = domain;
    if (status) data.status = status;
    if (communicationPrefs) data.communicationPrefs = JSON.stringify(communicationPrefs);
    if (knowledgeBase) data.knowledgeBase = JSON.stringify(knowledgeBase);

    const client = await prisma.client.update({
      where: { id },
      data
    });

    return client;
  });

  // Get client contacts
  fastify.get('/:id/contacts', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;

    const contacts = await prisma.contact.findMany({
      where: { clientId: id },
      orderBy: [
        { isPrimary: 'desc' },
        { name: 'asc' }
      ]
    });

    return contacts;
  });

  // Add contact to client
  fastify.post('/:id/contacts', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { email, name, role, isPrimary = false } = request.body;

    // If setting as primary, unset other primaries
    if (isPrimary) {
      await prisma.contact.updateMany({
        where: { clientId: id, isPrimary: true },
        data: { isPrimary: false }
      });
    }

    const contact = await prisma.contact.create({
      data: {
        email,
        name,
        role,
        isPrimary,
        clientId: id
      }
    });

    return reply.status(201).send(contact);
  });

  // Get client insights (AI-generated)
  fastify.get('/:id/insights', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;

    // Get recent threads for analysis
    const recentThreads = await prisma.thread.findMany({
      where: { clientId: id },
      orderBy: { lastActivityAt: 'desc' },
      take: 20,
      include: {
        messages: {
          orderBy: { receivedAt: 'asc' },
          take: 1,
          where: { direction: 'INBOUND' }
        },
        responses: {
          orderBy: { createdAt: 'asc' },
          take: 1
        }
      }
    });

    // Calculate basic insights
    const sentimentCounts = recentThreads.reduce((acc, t) => {
      if (t.sentiment) {
        acc[t.sentiment] = (acc[t.sentiment] || 0) + 1;
      }
      return acc;
    }, {});

    const priorityCounts = recentThreads.reduce((acc, t) => {
      acc[t.priority] = (acc[t.priority] || 0) + 1;
      return acc;
    }, {});

    // Calculate average response time (hours between first inbound message and first response)
    const responseTimes = recentThreads
      .filter(t => t.messages.length > 0 && t.responses.length > 0)
      .map(t => {
        const inboundTime = new Date(t.messages[0].receivedAt).getTime();
        const responseTime = new Date(t.responses[0].createdAt).getTime();
        return (responseTime - inboundTime) / (1000 * 60 * 60); // hours
      })
      .filter(h => h >= 0);

    const avgResponseTime = responseTimes.length > 0
      ? Math.round((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) * 10) / 10
      : null;

    // Calculate satisfaction trend from sentiment over time
    // Compare sentiment of older half vs newer half of threads
    const threadsWithSentiment = recentThreads.filter(t => t.sentiment);
    let satisfactionTrend = 'stable';
    if (threadsWithSentiment.length >= 4) {
      const sentimentScore = (s) => {
        if (s === 'positive') return 1;
        if (s === 'negative') return -1;
        return 0;
      };
      const mid = Math.floor(threadsWithSentiment.length / 2);
      // Threads are ordered newest-first, so newer = first half, older = second half
      const newerAvg = threadsWithSentiment.slice(0, mid).reduce((a, t) => a + sentimentScore(t.sentiment), 0) / mid;
      const olderAvg = threadsWithSentiment.slice(mid).reduce((a, t) => a + sentimentScore(t.sentiment), 0) / (threadsWithSentiment.length - mid);
      const diff = newerAvg - olderAvg;
      if (diff > 0.3) satisfactionTrend = 'improving';
      else if (diff < -0.3) satisfactionTrend = 'declining';
    }

    return {
      recentThreadCount: recentThreads.length,
      sentimentBreakdown: sentimentCounts,
      priorityBreakdown: priorityCounts,
      avgResponseTime,
      satisfactionTrend
    };
  });
}
