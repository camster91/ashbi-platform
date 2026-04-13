// Team management routes

import { prisma } from '../index.js';
import bcrypt from 'bcrypt';

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export default async function teamRoutes(fastify) {
  // List all team members
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const team = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        skills: true,
        capacity: true,
        isActive: true,
        _count: {
          select: {
            assignedThreads: { where: { status: { not: 'RESOLVED' } } },
            assignedTasks: { where: { status: { not: 'COMPLETED' } } }
          }
        }
      },
      orderBy: [
        { role: 'asc' }, // ADMIN first
        { name: 'asc' }
      ]
    });

    return team.map(member => ({
      ...member,
      skills: JSON.parse(member.skills),
      activeThreads: member._count.assignedThreads,
      activeTasks: member._count.assignedTasks
    }));
  });

  // Create team member (admin only)
  fastify.post('/', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { email, password, name, role = 'TEAM', skills = [], capacity = 100 } = request.body;

    // Check for existing email
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(400).send({ error: 'Email already registered' });
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: await hashPassword(password),
        name,
        role,
        skills: JSON.stringify(skills),
        capacity
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        skills: true,
        capacity: true,
        isActive: true
      }
    });

    return reply.status(201).send({
      ...user,
      skills: JSON.parse(user.skills)
    });
  });

  // Get single team member
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const member = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        skills: true,
        capacity: true,
        isActive: true,
        createdAt: true,
        assignedThreads: {
          where: { status: { not: 'RESOLVED' } },
          include: {
            client: { select: { id: true, name: true } },
            project: { select: { id: true, name: true } }
          },
          orderBy: { lastActivityAt: 'desc' },
          take: 10
        },
        assignedTasks: {
          where: { status: { not: 'COMPLETED' } },
          include: {
            project: { select: { id: true, name: true } }
          },
          orderBy: { dueDate: 'asc' },
          take: 10
        }
      }
    });

    if (!member) {
      return reply.status(404).send({ error: 'Team member not found' });
    }

    return {
      ...member,
      skills: JSON.parse(member.skills)
    };
  });

  // Update team member
  fastify.put('/:id', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, role, skills, capacity, isActive } = request.body;

    const data = {};
    if (name) data.name = name;
    if (role) data.role = role;
    if (skills) data.skills = JSON.stringify(skills);
    if (capacity !== undefined) data.capacity = capacity;
    if (isActive !== undefined) data.isActive = isActive;

    const member = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        skills: true,
        capacity: true,
        isActive: true
      }
    });

    return {
      ...member,
      skills: JSON.parse(member.skills)
    };
  });

  // Get team workload overview
  fastify.get('/workload', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const team = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        role: true,
        capacity: true,
        skills: true,
        _count: {
          select: {
            assignedThreads: { where: { status: { not: 'RESOLVED' } } },
            assignedTasks: { where: { status: { not: 'COMPLETED' } } }
          }
        }
      }
    });

    // Calculate workload score (simplified)
    return team.map(member => {
      const threadWeight = 10; // Points per active thread
      const taskWeight = 5; // Points per active task

      const workload = (member._count.assignedThreads * threadWeight) +
                       (member._count.assignedTasks * taskWeight);

      const maxCapacity = member.capacity; // Percentage
      const utilizationPercent = Math.min(100, (workload / maxCapacity) * 100);

      let status = 'available';
      if (utilizationPercent >= 90) status = 'overloaded';
      else if (utilizationPercent >= 70) status = 'busy';

      return {
        id: member.id,
        name: member.name,
        role: member.role,
        skills: JSON.parse(member.skills),
        activeThreads: member._count.assignedThreads,
        activeTasks: member._count.assignedTasks,
        workloadScore: workload,
        capacity: member.capacity,
        utilizationPercent: Math.round(utilizationPercent),
        status
      };
    }).sort((a, b) => a.utilizationPercent - b.utilizationPercent);
  });

  // Reset password (admin only)
  fastify.post('/:id/reset-password', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;
    const { newPassword } = request.body;

    await prisma.user.update({
      where: { id },
      data: { password: await hashPassword(newPassword) }
    });

    return { success: true };
  });

  // GET /allocations — Resource allocation view
  fastify.get('/allocations', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const team = await prisma.user.findMany({
      where: { isActive: true, role: { not: 'BOT' } },
      select: {
        id: true, name: true, role: true, capacity: true, hourlyRate: true,
        assignedTasks: {
          where: { status: { not: 'COMPLETED' } },
          select: { id: true, title: true, priority: true, projectId: true,
            project: { select: { id: true, name: true } } }
        },
        timeEntries: {
          where: { date: { gte: new Date(Date.now() - 7 * 86400000) } },
          select: { duration: true, projectId: true }
        }
      }
    });

    const allocations = team.map(member => {
      const recentMinutes = member.timeEntries.reduce((s, e) => s + e.duration, 0);
      const recentHours = recentMinutes / 60;
      const weeklyCapacity = (member.capacity || 100) * 40 / 100;
      const utilization = weeklyCapacity > 0 ? Math.round((recentHours / weeklyCapacity) * 100) : 0;

      const projectMap = {};
      for (const task of member.assignedTasks) {
        const pid = task.projectId;
        if (!projectMap[pid]) projectMap[pid] = { project: task.project, taskCount: 0 };
        projectMap[pid].taskCount++;
      }

      return {
        id: member.id, name: member.name, role: member.role,
        capacity: member.capacity, hourlyRate: member.hourlyRate,
        utilization, weeklyHours: recentHours,
        activeTasks: member.assignedTasks.length,
        projects: Object.values(projectMap)
      };
    });

    return { allocations };
  });
}
