// Notification routes

import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount
} from '../services/notification.service.js';

export default async function notificationRoutes(fastify) {
  // Get user's notifications (paginated)
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { unreadOnly, limit = '50', offset = '0' } = request.query;

    const result = await getNotifications(request.user.id, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      unreadOnly: unreadOnly === 'true'
    });

    return result;
  });

  // Get unread count
  fastify.get('/unread-count', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const count = await getUnreadCount(request.user.id);
    return { count };
  });

  // Mark single notification as read
  fastify.patch('/:id/read', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const notification = await markAsRead(request.user.id, id);

    if (!notification) {
      return reply.status(404).send({ error: 'Notification not found' });
    }

    return notification;
  });

  // Mark all notifications as read
  fastify.patch('/read-all', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const count = await markAllAsRead(request.user.id);
    return { success: true, count };
  });

  // Delete old read notifications (admin only)
  fastify.delete('/cleanup', {
    onRequest: [fastify.adminOnly]
  }, async (request) => {
    const { olderThanDays = '30' } = request.query;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(olderThanDays));

    const { prisma } = await import('../index.js');
    const result = await prisma.notification.deleteMany({
      where: {
        read: true,
        createdAt: { lt: cutoffDate }
      }
    });

    return { deleted: result.count };
  });
}