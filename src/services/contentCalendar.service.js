// Content Calendar service
// Migrated from ashbi-hub raw SQL to Prisma

import prisma from '../config/db.js';

/**
 * Get content calendar events with optional filters
 */
export async function getEvents(filters = {}) {
  const { startDate, endDate, contentType, status, clientId } = filters;

  const where = {};
  if (startDate || endDate) {
    where.scheduledAt = {};
    if (startDate) where.scheduledAt.gte = new Date(startDate);
    if (endDate) where.scheduledAt.lte = new Date(endDate);
  }
  if (contentType) where.contentType = contentType;
  if (status) where.status = status;
  if (clientId) where.clientId = clientId;

  return prisma.contentCalendarEvent.findMany({
    where,
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } }
    },
    orderBy: { scheduledAt: 'asc' }
  });
}

/**
 * Get a single event
 */
export async function getEvent(id) {
  return prisma.contentCalendarEvent.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } }
    }
  });
}

/**
 * Create a calendar event
 */
export async function createEvent(data) {
  const { title, description, contentType, platform, scheduledAt, clientId, projectId, assigneeId } = data;

  return prisma.contentCalendarEvent.create({
    data: {
      title,
      description,
      contentType: contentType || 'BLOG',
      platform,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      clientId: clientId || undefined,
      projectId: projectId || undefined,
      assigneeId: assigneeId || undefined
    },
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } }
    }
  });
}

/**
 * Update a calendar event
 */
export async function updateEvent(id, data) {
  const updateData = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.contentType !== undefined) updateData.contentType = data.contentType;
  if (data.platform !== undefined) updateData.platform = data.platform;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.scheduledAt !== undefined) updateData.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
  if (data.contentUrl !== undefined) updateData.contentUrl = data.contentUrl;
  if (data.clientId !== undefined) updateData.clientId = data.clientId;
  if (data.projectId !== undefined) updateData.projectId = data.projectId;
  if (data.assigneeId !== undefined) updateData.assigneeId = data.assigneeId;

  return prisma.contentCalendarEvent.update({
    where: { id },
    data: updateData,
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } }
    }
  });
}

/**
 * Update event status
 */
export async function updateEventStatus(id, status) {
  const data = { status };
  if (status === 'PUBLISHED') data.publishedAt = new Date();

  return prisma.contentCalendarEvent.update({
    where: { id },
    data,
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } }
    }
  });
}

/**
 * Delete an event
 */
export async function deleteEvent(id) {
  return prisma.contentCalendarEvent.delete({ where: { id } });
}

/**
 * Get upcoming deadlines
 */
export async function getUpcoming(limit = 10) {
  return prisma.contentCalendarEvent.findMany({
    where: {
      status: { in: ['IDEA', 'DRAFT', 'IN_REVIEW', 'SCHEDULED'] },
      scheduledAt: { gte: new Date() }
    },
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } }
    },
    orderBy: { scheduledAt: 'asc' },
    take: limit
  });
}

/**
 * Process due social posts - auto-publish scheduled posts that are past their scheduled time
 * Called by the social posts worker on a cron schedule
 */
export async function processDueSocialPosts() {
  const now = new Date();

  // Find SCHEDULED posts where scheduledAt <= now
  const duePosts = await prisma.socialPost.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { lte: now }
    }
  });

  const results = [];
  for (const post of duePosts) {
    try {
      // Import here to avoid circular deps
      const { formatPostForPlatform } = await import('./socialScheduler.service.js');
      const formatted = formatPostForPlatform(post.content, post.platform, { truncate: false });

      await prisma.socialPost.update({
        where: { id: post.id },
        data: {
          status: 'PUBLISHED',
          content: formatted,
          publishedAt: new Date()
        }
      });

      // Create a content calendar event record if it was auto-published
      // to track it in the calendar
      await prisma.contentCalendarEvent.create({
        data: {
          title: `Auto-posted: ${post.platform}`,
          description: post.content.substring(0, 200),
          contentType: 'SOCIAL',
          platform: post.platform,
          status: 'PUBLISHED',
          publishedAt: new Date()
        }
      });

      results.push({ id: post.id, platform: post.platform, status: 'PUBLISHED' });
    } catch (err) {
      await prisma.socialPost.update({
        where: { id: post.id },
        data: { status: 'FAILED' }
      });
      results.push({ id: post.id, platform: post.platform, status: 'FAILED', error: err.message });
    }
  }

  return results;
}