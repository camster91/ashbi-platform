// Hub-Hermes Integration Layer
// Bridges ashbi-platform (Hub) to the Hermes cron system
// Hermes reads Hub data via REST, Hub receives webhook triggers from Hermes

import env from '../config/env.js';

export function initHermesBridge(fastify) {
  
  /**
   * GET /api/hub/hermes/sync
   * Exposes outreach pipeline stats for Hermes cron to read into memory
   * Returns: campaign stats, pending sequences, recent activity
   */
  fastify.get('/api/hub/hermes/sync', async (request, reply) => {
    try {
      // Fetch outreach pipeline stats
      const [pendingSequences, recentActivity, campaignStats] = await Promise.all([
        // Pending outreach sequences
        fastify.prisma.outreachSequence.count({
          where: { status: 'ACTIVE' }
        }).catch(() => 0),
        
        // Recent outreach activity (last 24h)
        fastify.prisma.outreachActivity.findMany({
          where: {
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          },
          orderBy: { createdAt: 'desc' },
          take: 50
        }).catch(() => []),
        
        // Campaign stats
        fastify.prisma.outreachCampaign.findMany({
          select: {
            id: true,
            name: true,
            status: true,
            _count: {
              select: { sequences: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 20
        }).catch(() => [])
      ]);

      const syncData = {
        timestamp: new Date().toISOString(),
        pipeline: {
          activeCampaigns: campaignStats.filter(c => c.status === 'ACTIVE').length,
          totalCampaigns: campaignStats.length,
          pendingSequences,
          recentActivityCount: recentActivity.length
        },
        recentActivity: recentActivity.slice(0, 20).map(a => ({
          type: a.type,
          prospectEmail: a.prospectEmail,
          outcome: a.outcome,
          createdAt: a.createdAt
        })),
        campaigns: campaignStats.map(c => ({
          id: c.id,
          name: c.name,
          status: c.status,
          sequenceCount: c._count?.sequences || 0
        }))
      };

      return reply.send(syncData);
    } catch (error) {
      fastify.log.error({ err: error }, '[hub-hermes] sync endpoint failed');
      return reply.status(500).send({ 
        error: 'sync_failed',
        message: error.message 
      });
    }
  });

  /**
   * POST /api/hub/hermes/webhook
   * Receives webhook triggers from Hermes cron
   * Used by Hermes to notify Hub of events or request actions
   */
  fastify.post('/api/hub/hermes/webhook', async (request, reply) => {
    try {
      const signature = request.headers['x-hermes-signature'];
      
      // Verify webhook signature if HERMES_WEBHOOK_SECRET is set
      if (env.hermesWebhookSecret) {
        if (!signature) {
          return reply.status(401).send({ error: 'Missing signature' });
        }
        // In production, verify HMAC signature here
        // const expected = crypto.createHmac('sha256', env.hermesWebhookSecret).update(JSON.stringify(request.body)).digest('hex');
        // if (signature !== expected) return reply.status(401).send({ error: 'Invalid signature' });
      }

      const { event, data, triggerId } = request.body || {};

      if (!event) {
        return reply.status(400).send({ error: 'Missing event type' });
      }

      fastify.log.info({ event, triggerId }, '[hub-hermes] webhook received');

      switch (event) {
        case 'outreach_completed':
          // Hermes completed an outreach cycle - log it
          await fastify.prisma.outreachActivity.create({
            data: {
              type: 'HERMES_TRIGGER',
              prospectEmail: data?.prospectEmail || 'system',
              outcome: 'completed',
              metadata: { triggerId, event }
            }
          }).catch(() => {});
          break;

        case 'follow_up_triggered':
          // Hermes triggered a follow-up - record it
          fastify.log.info({ data }, '[hub-hermes] follow-up triggered');
          break;

        case 'memory_sync':
          // Hermes wants to sync Hub data into its memory
          // Return the sync data as confirmation
          return reply.send({ 
            received: true, 
            triggerId,
            action: 'ready_for_sync' 
          });

        default:
          fastify.log.warn({ event }, '[hub-hermes] unhandled event type');
      }

      return reply.send({ received: true, triggerId });
    } catch (error) {
      fastify.log.error({ err: error }, '[hub-hermes] webhook processing failed');
      return reply.status(500).send({ 
        error: 'webhook_failed',
        message: error.message 
      });
    }
  });

  fastify.log.info('[hub-hermes] bridge initialized');
}