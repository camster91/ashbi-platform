// Upwork Contract Tracker routes

import { prisma } from '../index.js';

export default async function upworkContractRoutes(fastify) {
  // List all contracts
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { status } = request.query;
    const where = {};
    if (status) where.status = status;

    const contracts = await prisma.upworkContract.findMany({
      where,
      orderBy: [
        { status: 'asc' },
        { updatedAt: 'desc' }
      ]
    });

    // Calculate days since last message
    return contracts.map(c => ({
      ...c,
      lastMessageDays: c.lastMessageAt
        ? Math.floor((Date.now() - new Date(c.lastMessageAt).getTime()) / (1000 * 60 * 60 * 24))
        : null
    }));
  });

  // Get single contract
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const contract = await prisma.upworkContract.findUnique({ where: { id } });
    if (!contract) return reply.status(404).send({ error: 'Contract not found' });
    return contract;
  });

  // Add contract
  fastify.post('/', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const {
      clientName, projectName, platform, contractType,
      totalBudget, hourlyRate, status, currentMilestone,
      milestoneAmount, milestoneStatus, milestoneDueDate,
      lastMessageAt, notes, upworkUrl
    } = request.body;

    if (!clientName || !projectName) {
      return reply.status(400).send({ error: 'clientName and projectName are required' });
    }

    const contract = await prisma.upworkContract.create({
      data: {
        clientName,
        projectName,
        platform: platform || 'UPWORK',
        contractType: contractType || 'FIXED',
        totalBudget: totalBudget || 0,
        hourlyRate,
        status: status || 'ACTIVE',
        currentMilestone,
        milestoneAmount,
        milestoneStatus,
        milestoneDueDate: milestoneDueDate ? new Date(milestoneDueDate) : null,
        lastMessageAt: lastMessageAt ? new Date(lastMessageAt) : null,
        notes,
        upworkUrl
      }
    });

    return reply.status(201).send(contract);
  });

  // Update contract
  fastify.put('/:id', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;
    const data = {};

    const fields = [
      'clientName', 'projectName', 'platform', 'contractType',
      'totalBudget', 'hourlyRate', 'status', 'currentMilestone',
      'milestoneAmount', 'milestoneStatus', 'notes', 'upworkUrl'
    ];

    for (const field of fields) {
      if (request.body[field] !== undefined) {
        data[field] = request.body[field];
      }
    }

    // Handle date fields
    if (request.body.milestoneDueDate !== undefined) {
      data.milestoneDueDate = request.body.milestoneDueDate ? new Date(request.body.milestoneDueDate) : null;
    }
    if (request.body.lastMessageAt !== undefined) {
      data.lastMessageAt = request.body.lastMessageAt ? new Date(request.body.lastMessageAt) : null;
    }

    const contract = await prisma.upworkContract.update({
      where: { id },
      data
    });

    return contract;
  });

  // Delete contract
  fastify.delete('/:id', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;
    await prisma.upworkContract.delete({ where: { id } });
    return { success: true };
  });
}
