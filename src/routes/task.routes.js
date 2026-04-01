// Task routes

import { prisma } from '../index.js';

export default async function taskRoutes(fastify) {
  // List all tasks with filters
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { status, priority, category, projectId, assigneeId, tags, page: pageParam = '1', limit: limitParam = '50' } = request.query;

    const page = parseInt(pageParam);
    const limit = parseInt(limitParam);

    const where = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (category) where.category = category;
    if (projectId) where.projectId = projectId;

    // Filter by tags — comma-separated, all must match (stored as JSON array string)
    if (tags) {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      where.AND = tagList.map(tag => ({
        tags: { contains: `"${tag}"` }
      }));
    }

    // Team members see only their tasks
    if (request.user.role !== 'ADMIN') {
      where.assigneeId = request.user.id;
    } else if (assigneeId) {
      where.assigneeId = assigneeId;
    }

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: {
          project: { select: { id: true, name: true, clientId: true } },
          assignee: { select: { id: true, name: true } }
        },
        orderBy: [
          { priority: 'asc' },
          { dueDate: 'asc' },
          { createdAt: 'desc' }
        ],
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.task.count({ where })
    ]);

    return {
      tasks,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    };
  });

  // Get my tasks (current user)
  fastify.get('/my', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const tasks = await prisma.task.findMany({
      where: {
        assigneeId: request.user.id,
        status: { not: 'COMPLETED' }
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            client: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: [
        { priority: 'asc' },
        { dueDate: 'asc' }
      ]
    });

    // Group by category
    const grouped = {
      IMMEDIATE: [],
      THIS_WEEK: [],
      UPCOMING: [],
      WAITING_CLIENT: [],
      WAITING_US: []
    };

    tasks.forEach(task => {
      if (grouped[task.category]) {
        grouped[task.category].push(task);
      } else {
        grouped.UPCOMING.push(task);
      }
    });

    return grouped;
  });

  // Get single task
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            client: { select: { id: true, name: true } }
          }
        },
        assignee: { select: { id: true, name: true, email: true } }
      }
    });

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    return task;
  });

  // Update task
  fastify.put('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const {
      title,
      description,
      status,
      priority,
      category,
      estimatedTime,
      dueDate,
      assigneeId,
      blockedBy
    } = request.body;

    const data = {};
    if (title) data.title = title;
    if (description !== undefined) data.description = description;
    if (status) data.status = status;
    if (priority) data.priority = priority;
    if (category) data.category = category;
    if (estimatedTime !== undefined) data.estimatedTime = estimatedTime;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (assigneeId !== undefined) data.assigneeId = assigneeId;
    if (blockedBy !== undefined) data.blockedBy = blockedBy;

    const prevTask = await prisma.task.findUnique({ where: { id } });
    const task = await prisma.task.update({
      where: { id },
      data,
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } }
      }
    });

    // HITL trigger: fire email when task becomes BLOCKED
    if (data.status === 'BLOCKED' && prevTask?.status !== 'BLOCKED') {
      import('../utils/hitl-email.service.js').then(async ({ sendBlockedHITLEmail }) => {
        const cameron = await prisma.user.findFirst({ where: { email: 'cameron@ashbi.ca' } });
        if (cameron) {
          const hitlNotif = await prisma.notification.create({
            data: {
              type: 'HITL_REQUIRED',
              title: `Blocked: ${task.title}`,
              message: `Task blocked: ${task.blockedBy || 'No reason given'}`,
              userId: cameron.id,
              data: JSON.stringify({ type: 'TASK', refId: task.id }),
            }
          });
          sendBlockedHITLEmail({
            notificationId: hitlNotif.id,
            task,
            project: task.project,
            blockedReason: task.blockedBy || data.blockedBy || 'No reason specified',
          }).catch(console.error);
        }
      }).catch(console.error);
    }

    return task;
  });

  // Complete task
  fastify.post('/:id/complete', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const task = await prisma.task.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date()
      },
      include: {
        project: { select: { id: true, name: true } }
      }
    });

    return task;
  });

  // Delete task
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const task = await prisma.task.findUnique({ where: { id } });

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    // Only allow deletion by admin or assignee
    if (request.user.role !== 'ADMIN' && task.assigneeId !== request.user.id) {
      return reply.status(403).send({ error: 'Not authorized to delete this task' });
    }

    await prisma.task.delete({ where: { id } });

    return { success: true };
  });

  // Bulk update task categories (for drag-drop reordering)
  fastify.post('/bulk-update', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { updates } = request.body;

    // updates is an array of { id, category, priority }
    const results = await Promise.all(
      updates.map(update =>
        prisma.task.update({
          where: { id: update.id },
          data: {
            category: update.category,
            priority: update.priority
          }
        })
      )
    );

    return { success: true, updated: results.length };
  });

  // ===== NOTION-LIKE TASK PAGE FEATURES =====

  // Get task with full page content (Notion-style)
  fastify.get('/:id/page', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            client: { select: { id: true, name: true } }
          }
        },
        assignee: { select: { id: true, name: true, email: true } },
        subpages: {
          select: {
            id: true,
            title: true,
            icon: true,
            status: true,
            isPage: true,
            createdAt: true,
            assignee: { select: { id: true, name: true } }
          },
          orderBy: { createdAt: 'asc' }
        },
        parent: {
          select: {
            id: true,
            title: true,
            icon: true
          }
        },
        comments: {
          include: {
            author: { select: { id: true, name: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    // Parse content if it's stored as JSON string
    let parsedContent = [];
    try {
      parsedContent = JSON.parse(task.content || '[]');
    } catch (e) {
      parsedContent = [{ type: 'paragraph', content: task.content || '' }];
    }

    // Parse properties
    let parsedProperties = {};
    try {
      parsedProperties = JSON.parse(task.properties || '{}');
    } catch (e) {
      parsedProperties = {};
    }

    return {
      ...task,
      content: parsedContent,
      properties: parsedProperties
    };
  });

  // Update task content (Notion-style blocks)
  fastify.put('/:id/content', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { content, title, icon, coverImage, properties } = request.body;

    const updateData = {};
    if (content !== undefined) updateData.content = JSON.stringify(content);
    if (title !== undefined) updateData.title = title;
    if (icon !== undefined) updateData.icon = icon;
    if (coverImage !== undefined) updateData.coverImage = coverImage;
    if (properties !== undefined) updateData.properties = JSON.stringify(properties);

    const task = await prisma.task.update({
      where: { id },
      data: updateData,
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } }
      }
    });

    return task;
  });

  // Create subpage (Notion-style)
  fastify.post('/:id/subpage', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { title, icon, content } = request.body;

    const parentTask = await prisma.task.findUnique({
      where: { id },
      select: { projectId: true }
    });

    if (!parentTask) {
      return reply.status(404).send({ error: 'Parent task not found' });
    }

    const subpage = await prisma.task.create({
      data: {
        title: title || 'Untitled',
        icon: icon || '📄',
        content: JSON.stringify(content || [{ type: 'paragraph', content: '' }]),
        isPage: true,
        parentId: id,
        projectId: parentTask.projectId,
        assigneeId: request.user.id,
        status: 'PENDING'
      },
      include: {
        assignee: { select: { id: true, name: true } }
      }
    });

    return subpage;
  });

  // Get task breadcrumbs
  fastify.get('/:id/breadcrumbs', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const breadcrumbs = [];
    let currentId = id;

    while (currentId) {
      const task = await prisma.task.findUnique({
        where: { id: currentId },
        select: { id: true, title: true, icon: true, parentId: true, projectId: true }
      });

      if (!task) break;

      breadcrumbs.unshift({
        id: task.id,
        title: task.title,
        icon: task.icon,
        projectId: task.projectId
      });

      currentId = task.parentId;
    }

    // Add project at root if all tasks are from same project
    if (breadcrumbs.length > 0 && breadcrumbs[0].projectId) {
      const project = await prisma.project.findUnique({
        where: { id: breadcrumbs[0].projectId },
        select: { id: true, name: true }
      });
      if (project) {
        breadcrumbs.unshift({
          id: project.id,
          title: project.name,
          icon: '📁',
          isProject: true
        });
      }
    }

    return breadcrumbs;
  });

  // Search for mentions (@users, @tasks, @projects)
  fastify.get('/mentions/search', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { q, projectId } = request.query;

    if (!q || q.length < 2) {
      return { users: [], tasks: [] };
    }

    const searchQuery = q.toLowerCase();

    // Search users
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: searchQuery, mode: 'insensitive' } },
          { email: { contains: searchQuery, mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        name: true,
        email: true
      },
      take: 5
    });

    // Search tasks in project
    const tasksWhere = {
      title: { contains: searchQuery, mode: 'insensitive' }
    };
    if (projectId) {
      tasksWhere.projectId = projectId;
    }

    const tasks = await prisma.task.findMany({
      where: tasksWhere,
      select: {
        id: true,
        title: true,
        icon: true,
        isPage: true,
        project: { select: { name: true } }
      },
      take: 5
    });

    return {
      users: users.map(u => ({
        id: u.id,
        type: 'user',
        name: u.name,
        email: u.email,
        avatar: u.name.charAt(0).toUpperCase()
      })),
      tasks: tasks.map(t => ({
        id: t.id,
        type: 'task',
        title: t.title,
        icon: t.icon || (t.isPage ? '📄' : '✓'),
        projectName: t.project?.name
      }))
    };
  });

  // ===== KANBAN BOARD ROUTES =====

  // Get tasks for Kanban board (organized by status)
  fastify.get('/kanban/:projectId', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { projectId } = request.params;

    const tasks = await prisma.task.findMany({
      where: { projectId },
      include: {
        assignee: { select: { id: true, name: true, email: true } }
      },
      orderBy: [
        { priority: 'asc' },
        { dueDate: 'asc' }
      ]
    });

    // Group by status
    const board = {
      NOT_STARTED: tasks.filter(t => t.status === 'NOT_STARTED'),
      IN_PROGRESS: tasks.filter(t => t.status === 'IN_PROGRESS'),
      IN_REVIEW: tasks.filter(t => t.status === 'IN_REVIEW'),
      DONE: tasks.filter(t => t.status === 'DONE')
    };

    return board;
  });

  // Move task between Kanban columns
  fastify.post('/:id/move', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;
    const { status } = request.body;

    if (!['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'].includes(status)) {
      return request.reply.status(400).send({ error: 'Invalid status' });
    }

    const task = await prisma.task.update({
      where: { id },
      data: {
        status,
        completedAt: status === 'DONE' ? new Date() : null
      },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } }
      }
    });

    return task;
  });

  // Quick task create (for Kanban "Add Task" button)
  fastify.post('/:projectId/quick', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { projectId } = request.params;
    const { title, assigneeId, priority = 'MEDIUM' } = request.body;

    const task = await prisma.task.create({
      data: {
        projectId,
        title,
        description: '',
        status: 'NOT_STARTED',
        priority,
        assigneeId,
        assignedAt: new Date()
      },
      include: {
        assignee: { select: { id: true, name: true, email: true } }
      }
    });

    return task;
  });
}
