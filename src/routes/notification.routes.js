// Notification routes

import { prisma } from '../index.js';

export default async function notificationRoutes(fastify) {
  // Get user's notifications
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { unreadOnly, limit = 50 } = request.query;

    const where = { userId: request.user.id };
    if (unreadOnly === 'true') {
      where.read = false;
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit)
    });

    // Parse data JSON field
    return notifications.map(n => ({
      ...n,
      data: n.data ? JSON.parse(n.data) : null
    }));
  });

  // Get unread count
  fastify.get('/unread-count', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const count = await prisma.notification.count({
      where: {
        userId: request.user.id,
        read: false
      }
    });

    return { count };
  });

  // Mark single notification as read
  fastify.post('/read/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const notification = await prisma.notification.findUnique({
      where: { id }
    });

    if (!notification) {
      return reply.status(404).send({ error: 'Notification not found' });
    }

    if (notification.userId !== request.user.id) {
      return reply.status(403).send({ error: 'Not authorized' });
    }

    await prisma.notification.update({
      where: { id },
      data: {
        read: true,
        readAt: new Date()
      }
    });

    return { success: true };
  });

  // Mark all notifications as read
  fastify.post('/read-all', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    await prisma.notification.updateMany({
      where: {
        userId: request.user.id,
        read: false
      },
      data: {
        read: true,
        readAt: new Date()
      }
    });

    return { success: true };
  });

  // Delete old notifications (admin only)
  fastify.delete('/cleanup', {
    onRequest: [fastify.adminOnly]
  }, async (request) => {
    const { olderThanDays = 30 } = request.query;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(olderThanDays));

    const result = await prisma.notification.deleteMany({
      where: {
        read: true,
        createdAt: { lt: cutoffDate }
      }
    });

    return { deleted: result.count };
  });
}

// Helper to create notifications (used by other services)
export async function createNotification(fastify, { userId, type, title, message, data }) {
  const notification = await prisma.notification.create({
    data: {
      type,
      title,
      message,
      data: data ? JSON.stringify(data) : null,
      userId
    }
  });

  // Send real-time notification via Socket.io
  if (fastify.notify) {
    fastify.notify(userId, type, {
      id: notification.id,
      title,
      message,
      data,
      createdAt: notification.createdAt
    });
  }

  return notification;
}
