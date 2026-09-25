// Team management routes

import bcrypt from 'bcrypt';
import { validateBody, teamInviteSchema, teamResetPasswordSchema, teamUpdateSchema } from '../validators/schemas.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { requireRecentAuth } from '../auth/reauth.js';

/**
 * preHandler for PUT /:id: changing a member's role or deactivating /
 * reactivating them is a privileged action (docs/privileged-actions.md) and
 * needs recent re-authentication; ordinary profile edits (name, skills,
 * capacity) do not. Compares against the stored state, so a form that
 * resubmits the unchanged role is not prompted.
 */
async function requireRecentAuthForAccessChange(request, reply) {
  const { role, isActive } = request.body || {};
  if (!role && isActive === undefined) return undefined;
  const current = await request.prisma.user.findUnique({
    where: { id: request.params.id },
    select: { role: true, isActive: true },
  });
  if (!current) return undefined; // the handler answers 404 / Prisma error as before
  const changesAccess = (role && role !== current.role)
    || (isActive !== undefined && isActive !== current.isActive);
  if (!changesAccess) return undefined;
  return requireRecentAuth(request, reply);
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export default async function teamRoutes(fastify) {
  // List all team members
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const team = await request.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        skills: true,
        capacity: true,
        isActive: true,
        mfaEnabled: true,
        mfaLockedUntil: true,
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

    // MFA state is security posture: only admins (who can reset it) see it.
    const isAdmin = request.user.role === 'ADMIN';
    const now = Date.now();
    return team.map(({ mfaLockedUntil, mfaEnabled, ...member }) => ({
      ...member,
      ...(isAdmin ? {
        mfaEnabled,
        mfaLocked: Boolean(mfaLockedUntil && new Date(mfaLockedUntil).getTime() > now),
      } : {}),
      skills: JSON.parse(member.skills),
      activeThreads: member._count.assignedThreads,
      activeTasks: member._count.assignedTasks
    }));
  });

  // Create team member (admin only)
  fastify.post('/', {
    onRequest: [fastify.adminOnly],
    preHandler: validateBody(teamInviteSchema),
  }, async (request, reply) => {
    const { email, password, name, role = 'TEAM', skills = [], capacity = 100 } = request.body;

    // Check for existing email
    const existing = await request.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(400).send({ error: 'Email already registered' });
    }

    const user = await request.prisma.user.create({
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

    const member = await request.prisma.user.findUnique({
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
    onRequest: [fastify.adminOnly],
    preHandler: [validateBody(teamUpdateSchema), requireRecentAuthForAccessChange],
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, role, skills, capacity, isActive } = request.body;

    const data = {};
    if (name) data.name = name;
    if (role) data.role = role;
    if (skills) data.skills = JSON.stringify(skills);
    if (capacity !== undefined) data.capacity = capacity;
    if (isActive !== undefined) data.isActive = isActive;

    // Read the prior access state only when it can change, so the audit
    // trail records real transitions rather than every profile save.
    const before = (role || isActive !== undefined)
      ? await request.prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true } })
      : null;

    const member = await request.prisma.user.update({
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

    if (before && role && before.role !== member.role) {
      await recordRequestAuditEvent(request.prisma, request, {
        action: 'user.role_changed',
        entityId: member.id,
        metadata: { fromRole: before.role, toRole: member.role },
      });
    }
    if (before && isActive !== undefined && before.isActive !== member.isActive) {
      await recordRequestAuditEvent(request.prisma, request, {
        action: member.isActive ? 'user.reactivated' : 'user.deactivated',
        entityId: member.id,
        metadata: { fromActive: before.isActive, toActive: member.isActive },
      });
    }

    return {
      ...member,
      skills: JSON.parse(member.skills)
    };
  });

  // Get team workload overview
  fastify.get('/workload', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const team = await request.prisma.user.findMany({
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
    onRequest: [fastify.adminOnly],
    preHandler: [requireRecentAuth, validateBody(teamResetPasswordSchema)],
  }, async (request, reply) => {
    const { id } = request.params;
    const { newPassword } = request.body;

    await request.prisma.user.update({
      where: { id },
      // Sign the member out everywhere: whoever held the old password must
      // not keep a session after an administrator replaces it.
      data: { password: await hashPassword(newPassword), sessionVersion: { increment: 1 } }
    });

    await recordRequestAuditEvent(request.prisma, request, {
      action: 'auth.password_changed',
      entityId: id,
      metadata: { method: 'admin_reset' },
    });

    return { success: true };
  });

  // GET /allocations — Resource allocation view
  fastify.get('/allocations', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const team = await request.prisma.user.findMany({
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
