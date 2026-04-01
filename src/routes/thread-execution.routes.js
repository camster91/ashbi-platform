/**
 * Thread Execution Routes
 * Routes for thread→task spawning, AI execution loop, and thread context.
 * NOTE: POST /:id/messages already exists in thread.routes.js — do NOT redefine it.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ASH_USER_ID = 'cmash00000000001';

export default async function threadExecutionRoutes(fastify) {

  // ── Spawn: create task→thread link and set execution state ─────────────────
  fastify.post('/:id/spawn', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const threadId = request.params.id;

    const thread = await prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });

    const existing = await prisma.taskThread.findUnique({ where: { task_id: thread.taskId } });
    if (existing) return reply.send({ message: 'Already linked', link: existing });

    const link = await prisma.taskThread.create({
      data: { task_id: thread.taskId, thread_id: threadId }
    });

    await prisma.thread.update({
      where: { id: threadId },
      data: { status: 'NEEDS_ATTENTION', execution_state: 'planning' }
    });

    return reply.status(201).send({ link, thread });
  });

  // ── Execution polling: runner fetches threads needing work ─────────────────
  fastify.get('/execution', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const threads = await prisma.thread.findMany({
      where: {
        status: { in: ['NEEDS_ATTENTION', 'IN_PROGRESS'] },
        execution_state: { in: ['planning', 'executing'] },
        assignedToId: ASH_USER_ID
      },
      include: {
        project: {
          select: { id: true, name: true, serviceType: true, client: true }
        },
        client: { select: { id: true, name: true } },
        taskThread: true,
        internalNotes: { orderBy: { createdAt: 'desc' }, take: 10 }
      },
      orderBy: { lastActivityAt: 'asc' },
      take: 5
    });
    return { threads, runnerVersion: '1.0.0' };
  });

  // ── Trigger execution on a specific thread ───────────────────────────────
  fastify.post('/:id/execute', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const thread = await prisma.thread.update({
      where: { id },
      data: { status: 'NEEDS_ATTENTION', execution_state: 'planning' }
    });
    return { triggered: true, thread };
  });

  // ── Update execution state ───────────────────────────────────────────────
  fastify.put('/:id/execution-state', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { executionState, status, stepPlan } = request.body;
    const data = {};
    if (executionState !== undefined) data.execution_state = executionState;
    if (status !== undefined) data.status = status;
    if (stepPlan !== undefined) data.step_plan = JSON.stringify(stepPlan);
    const thread = await prisma.thread.update({ where: { id }, data });
    return thread;
  });

  // ── Get full context for a thread (project, credentials, active tasks) ────
  fastify.get('/:id/context', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const thread = await prisma.thread.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            client: true,
            context: true,
            tasks: {
              where: { status: { in: ['IN_PROGRESS', 'PENDING'] } },
              orderBy: { priority: 'asc' },
              take: 10
            }
          }
        },
        client: true,
        taskThread: { include: { task: true } }
      }
    });

    if (!thread) return reply.status(404).send({ error: 'Thread not found' });

    let credentials = [];
    if (thread.projectId) {
      credentials = await prisma.credential.findMany({
        where: {
          projectId: thread.projectId,
          visibility: { in: ['AI_ONLY', 'SHARED'] }
        },
        select: { id: true, name: true, type: true, lastUsed: true }
      });
    }

    return {
      thread,
      projectContext: thread.project?.context || null,
      activeTasks: thread.project?.tasks || [],
      credentials
    };
  });

  // ── Add execution note (PLAN/ACTION/ASK/SUMMARY/BLOCKED) ──────────────────
  // NOTE: We use /notes endpoint (different from /messages which is for emails)
  fastify.post('/:id/execution-note', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { body, messageType, metadata } = request.body;

    if (!body) return reply.status(400).send({ error: 'body is required' });

    const isAsh = request.user.id === ASH_USER_ID;

    const note = await prisma.internalNote.create({
      data: {
        content: body,
        threadId: id,
        authorId: request.user.id,
        messageType: messageType || 'NOTE',
        authorRole: isAsh ? 'AI' : 'HUMAN',
        metadata: metadata ? JSON.stringify(metadata) : undefined
      },
      include: { author: { select: { id: true, name: true } } }
    });

    await prisma.thread.update({
      where: { id },
      data: { lastActivityAt: new Date() }
    });

    return reply.status(201).send(note);
  });
}
