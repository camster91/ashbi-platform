/**
 * Project Routes Unit Tests
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import projectRoutes from '../routes/project.routes.js';

describe('Project Routes (Unit)', () => {
  let fastify;
  let mockPrisma;

  beforeEach(async () => {
    fastify = Fastify();
    
    fastify.decorate('authenticate', async (request, reply) => {
      request.user = { id: 'user-1', role: 'ADMIN', email: 'admin@example.com' };
    });

    mockPrisma = {
      project: {
        findMany: async () => [],
        count: async () => 0,
        findUnique: async () => null,
        create: async ({ data }) => ({ id: 'new-project', ...data }),
        update: async ({ where, data }) => ({ id: where.id, ...data }),
        upsert: async ({ where, create, update }) => ({ id: where.projectId, ...create, ...update })
      },
      task: {
        findMany: async () => [],
        groupBy: async () => [],
        create: async ({ data }) => ({ id: 'new-task', ...data })
      },
      timeEntry: {
        findMany: async () => []
      },
      expense: {
        findMany: async () => []
      },
      projectCommunication: {
        findMany: async () => [],
        count: async () => 0
      },
      projectContext: {
        findUnique: async () => null,
        upsert: async ({ create }) => create
      }
    };
    
    fastify.decorate('prisma', mockPrisma);
    await fastify.register(projectRoutes);
  });

  test('GET / should return projects with completed task counts', async () => {
    mockPrisma.project.findMany = async () => [
      { id: 'proj-1', name: 'Project One', health: 'ON_TRACK' }
    ];
    mockPrisma.project.count = async () => 1;
    mockPrisma.task.groupBy = async () => [
      { projectId: 'proj-1', _count: 5 }
    ];

    const res = await fastify.inject({
      method: 'GET',
      url: '/'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.projects[0].completedTaskCount, 5);
  });

  test('POST / should create a project', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/',
      payload: { name: 'New Project', clientId: 'client-1' }
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.name, 'New Project');
  });

  test('GET /:id/budget should calculate budget usage', async () => {
    mockPrisma.project.findUnique = async () => ({
      id: 'proj-1',
      budget: 1000,
      hourlyBudget: 20
    });
    mockPrisma.timeEntry.findMany = async () => [
      { duration: 120, billable: true, userId: 'u1', user: { hourlyRate: 100 } } // 2 hours * 100 = 200
    ];
    mockPrisma.expense.findMany = async () => [
      { amount: 50 }
    ];

    const res = await fastify.inject({
      method: 'GET',
      url: '/proj-1/budget'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.budgetUsed, 250); // 200 + 50
    assert.equal(body.budgetRemaining, 750);
    assert.equal(body.hoursRemaining, 18); // 20 - 2
  });
});
