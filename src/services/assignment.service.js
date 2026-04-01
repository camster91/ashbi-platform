// Assignment service - handles thread/task routing

import { prisma } from '../index.js';

/**
 * Assignment algorithm priority:
 * 1. Critical → Admin (always escalate)
 * 2. Project default owner (if set and has capacity)
 * 3. Client routing rule (specific client → specific member)
 * 4. Skill matching (match intent to skill)
 * 5. Thread continuity (keep same handler for ongoing thread)
 * 6. Load balancing (assign to least loaded member)
 * 7. Escalate to admin (if no capacity)
 */
export async function assignThread(thread) {
  const analysis = thread.aiAnalysis ? JSON.parse(thread.aiAnalysis) : null;
  const priority = analysis?.urgency || thread.priority || 'NORMAL';
  const intent = analysis?.intent || 'general';

  // 1. Critical → Admin
  if (priority === 'CRITICAL') {
    const admin = await getAdmin();
    if (admin) {
      return {
        userId: admin.id,
        reason: 'Critical priority - escalated to admin',
        rule: 'CRITICAL_ESCALATION'
      };
    }
  }

  // 2. Project default owner
  if (thread.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: thread.projectId },
      select: { defaultOwnerId: true }
    });

    if (project?.defaultOwnerId) {
      const owner = await prisma.user.findUnique({
        where: { id: project.defaultOwnerId, isActive: true }
      });

      if (owner && await hasCapacity(owner.id)) {
        return {
          userId: owner.id,
          reason: 'Project default owner',
          rule: 'PROJECT_OWNER'
        };
      }
    }
  }

  // 3. Client routing rule
  if (thread.clientId) {
    const clientRule = await prisma.assignmentRule.findFirst({
      where: {
        type: 'CLIENT',
        isActive: true,
        conditions: { contains: thread.clientId }
      }
    });

    if (clientRule?.assignToId) {
      const assignee = await prisma.user.findUnique({
        where: { id: clientRule.assignToId, isActive: true }
      });

      if (assignee && await hasCapacity(assignee.id)) {
        return {
          userId: assignee.id,
          reason: `Client routing rule: ${clientRule.name}`,
          rule: 'CLIENT_RULE'
        };
      }
    }
  }

  // 4. Skill matching
  const skillMatch = await findBySkill(intent);
  if (skillMatch) {
    return {
      userId: skillMatch.id,
      reason: `Skill match for intent: ${intent}`,
      rule: 'SKILL_MATCH'
    };
  }

  // 5. Thread continuity (check if this is part of existing conversation)
  // For now, we skip this as new threads don't have history

  // 6. Load balancing - assign to least loaded team member
  const leastLoaded = await findLeastLoaded();
  if (leastLoaded) {
    return {
      userId: leastLoaded.id,
      reason: 'Load balanced assignment',
      rule: 'LOAD_BALANCE'
    };
  }

  // 7. Escalate to admin
  const admin = await getAdmin();
  if (admin) {
    return {
      userId: admin.id,
      reason: 'No available team members - escalated to admin',
      rule: 'ESCALATION'
    };
  }

  return {
    userId: null,
    reason: 'No assignee available',
    rule: 'NONE'
  };
}

/**
 * Get admin user
 */
async function getAdmin() {
  return prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true }
  });
}

/**
 * Check if user has capacity for more work
 */
async function hasCapacity(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      _count: {
        select: {
          assignedThreads: { where: { status: { not: 'RESOLVED' } } }
        }
      }
    }
  });

  if (!user) return false;

  // Simple capacity check: max 10 active threads per 100% capacity
  const maxThreads = Math.floor((user.capacity / 100) * 10);
  return user._count.assignedThreads < maxThreads;
}

/**
 * Find team member by skill matching
 */
async function findBySkill(intent) {
  // Map intents to skills
  const skillMap = {
    'bug_report': ['development', 'technical', 'debugging'],
    'feature_request': ['development', 'product'],
    'question': ['support', 'general'],
    'approval_request': ['admin', 'management'],
    'feedback': ['design', 'product'],
    'status_update': ['project_management'],
    'urgent_issue': ['admin', 'development'],
    'general': ['support', 'general']
  };

  const requiredSkills = skillMap[intent] || ['general'];

  // Find users with matching skills who have capacity
  const users = await prisma.user.findMany({
    where: { isActive: true, role: 'TEAM' },
    include: {
      _count: {
        select: {
          assignedThreads: { where: { status: { not: 'RESOLVED' } } }
        }
      }
    }
  });

  // Filter by skill and capacity
  const candidates = users.filter(user => {
    const userSkills = JSON.parse(user.skills || '[]');
    const hasSkill = requiredSkills.some(skill =>
      userSkills.some(us => us.toLowerCase().includes(skill.toLowerCase()))
    );
    const maxThreads = Math.floor((user.capacity / 100) * 10);
    const hasCapacity = user._count.assignedThreads < maxThreads;

    return hasSkill && hasCapacity;
  });

  // Return least loaded matching candidate
  if (candidates.length > 0) {
    candidates.sort((a, b) => a._count.assignedThreads - b._count.assignedThreads);
    return candidates[0];
  }

  return null;
}

/**
 * Find least loaded team member
 */
async function findLeastLoaded() {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: {
      _count: {
        select: {
          assignedThreads: { where: { status: { not: 'RESOLVED' } } }
        }
      }
    }
  });

  // Filter by capacity and sort by load
  const available = users.filter(user => {
    const maxThreads = Math.floor((user.capacity / 100) * 10);
    return user._count.assignedThreads < maxThreads;
  });

  if (available.length > 0) {
    available.sort((a, b) => a._count.assignedThreads - b._count.assignedThreads);
    return available[0];
  }

  return null;
}

/**
 * Suggest rebalancing for overloaded team members
 */
export async function suggestRebalancing() {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: {
      _count: {
        select: {
          assignedThreads: { where: { status: { not: 'RESOLVED' } } }
        }
      }
    }
  });

  const suggestions = [];

  for (const user of users) {
    const maxThreads = Math.floor((user.capacity / 100) * 10);
    const utilization = (user._count.assignedThreads / maxThreads) * 100;

    if (utilization > 90) {
      // Find someone to transfer threads to
      const available = users.filter(u =>
        u.id !== user.id &&
        ((u._count.assignedThreads / Math.floor((u.capacity / 100) * 10)) * 100) < 70
      );

      if (available.length > 0) {
        suggestions.push({
          overloadedUser: { id: user.id, name: user.name },
          utilization: Math.round(utilization),
          suggestedTransferTo: available.map(a => ({
            id: a.id,
            name: a.name,
            currentUtilization: Math.round((a._count.assignedThreads / Math.floor((a.capacity / 100) * 10)) * 100)
          }))
        });
      }
    }
  }

  return suggestions;
}
