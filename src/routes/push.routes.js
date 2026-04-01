// Push Notification Routes
import { prisma } from '../index.js';
import { getVapidPublicKey, sendPushToAll } from '../utils/web-push.js';

export default async function pushRoutes(fastify) {
  // Get VAPID public key (no auth needed — frontend needs this to subscribe)
  fastify.get('/vapid-key', async () => {
    return { publicKey: getVapidPublicKey() };
  });

  // Subscribe to push notifications
  fastify.post('/subscribe', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { endpoint, keys } = request.body || {};

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return reply.status(400).send({ error: 'Invalid push subscription' });
    }

    // Upsert: update if endpoint exists, create if not
    const existing = await prisma.pushSubscription.findFirst({
      where: { endpoint }
    });

    if (existing) {
      await prisma.pushSubscription.update({
        where: { id: existing.id },
        data: {
          keys: JSON.stringify(keys),
          userId: request.user.id,
          updatedAt: new Date()
        }
      });
    } else {
      await prisma.pushSubscription.create({
        data: {
          endpoint,
          keys: JSON.stringify(keys),
          userId: request.user.id
        }
      });
    }

    return { success: true };
  });

  // Unsubscribe
  fastify.post('/unsubscribe', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { endpoint } = request.body || {};
    if (!endpoint) {
      return reply.status(400).send({ error: 'Endpoint required' });
    }

    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: request.user.id }
    });

    return { success: true };
  });

  // Send push to all (admin only) — for testing
  fastify.post('/send', {
    onRequest: [fastify.adminOnly]
  }, async (request) => {
    const { title, body, url } = request.body || {};
    const sent = await sendPushToAll({
      title: title || 'Ashbi Hub',
      body: body || 'Test notification',
      data: { url: url || '/' }
    });
    return { sent };
  });
}
