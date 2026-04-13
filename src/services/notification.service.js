// Notification service — create, list, and manage notifications

import { prisma } from '../index.js';

/**
 * Placeholder for email sending. Will be replaced with real templates later.
 */
async function sendNotificationEmail({ userId, type, title, message, data }) {
  console.log(`[Notification Email] To user=${userId} type=${type}: ${title} — ${message}`);
}

/**
 * Create a notification record and optionally send an email.
 * Emits a `notification:new` Socket.IO event for real-time delivery.
 */
export async function createNotification({ userId, type, title, message, data, sendEmail = false }) {
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      message,
      data: data ?? undefined
    }
  });

  // Emit real-time event via Socket.IO
  const { io } = await import('../index.js');
  if (io) {
    io.to(`user:${userId}`).emit('notification:new', {
      id: notification.id,
      type,
      title,
      message,
      data,
      createdAt: notification.createdAt
    });
  }

  // Optionally send email (non-blocking)
  if (sendEmail) {
    sendNotificationEmail({ userId, type, title, message, data }).catch(err => {
      console.error('[Notification Email] Failed:', err.message);
    });
  }

  return notification;
}

/**
 * List notifications for a user with pagination and optional filtering.
 */
export async function getNotifications(userId, { limit = 50, offset = 0, unreadOnly = false } = {}) {
  const where = { userId };
  if (unreadOnly) {
    where.read = false;
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    }),
    prisma.notification.count({ where })
  ]);

  return { notifications, total, limit, offset };
}

/**
 * Mark a single notification as read.
 */
export async function markAsRead(userId, notificationId) {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });

  if (!notification) return null;
  if (notification.userId !== userId) return null;

  return prisma.notification.update({
    where: { id: notificationId },
    data: { read: true, readAt: new Date() }
  });
}

/**
 * Mark all unread notifications for a user as read.
 */
export async function markAllAsRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true, readAt: new Date() }
  });

  return result.count;
}

/**
 * Get the count of unread notifications for a user.
 */
export async function getUnreadCount(userId) {
  return prisma.notification.count({
    where: { userId, read: false }
  });
}