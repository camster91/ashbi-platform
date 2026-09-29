// Notification service — create, list, and manage notifications

import prisma from '../config/db.js';

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
export async function createNotification({ userId, type, title, message, data, sendEmail = false }, { io } = {}) {
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
 * The application's single notification path (H4). Routes call
 * `fastify.notify(userId, { type, title, message, data })`, which persists
 * exactly one human-readable row and emits it in realtime; they must not
 * also create notification rows. `data` carries the ids the web app turns
 * into a deep link (taskId, projectId, threadId, eventId, clientId...).
 * `emit` delivers a row that was already persisted inside a transaction.
 *
 * @param {{ to: (room: string) => { emit: Function } }} io
 * @param {{ error: Function }} [log]
 */
export function createNotifier(io, log = console) {
  const emit = (userId, notification) => {
    io.to(`user:${userId}`).emit('notification:new', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      createdAt: notification.createdAt,
    });
    // Legacy event used for cache invalidation (no title, so the web app
    // never shows a second toast for it).
    io.to(`user:${userId}`).emit('notification', { id: notification.id, type: notification.type, data: notification.data });
  };
  const notify = async (userId, { type, title, message, data } = /** @type {any} */ ({})) => {
    try {
      const notification = await prisma.notification.create({
        data: { userId, type, title: title || type, message: message || '', data: data ?? undefined },
      });
      emit(userId, notification);
      return notification;
    } catch (err) {
      log.error({ err, type }, '[notify] Failed to persist notification');
      return null;
    }
  };
  return { notify, emit };
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
