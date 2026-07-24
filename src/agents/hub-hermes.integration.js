// Hub-Hermes Integration Layer
// Bridges ashbi-platform (Hub) to the Hermes cron system.
// Hermes reads Hub data via REST, Hub receives webhook triggers from Hermes.
//
// Pre-strip-down: this file referenced outreachSequence / outreachActivity /
// outreachCampaign — models that have NEVER been in the schema. The
// `.catch(() => …)` chains silently turned every Hermes sync into a
// no-op. After Batches 1-6 the entire "outreach" domain was deleted,
// so the script-level refs are now dangling. Replaced with explicit
// empty responses + an `enablement` flag (env.HERMES_BRIDGE_ENABLED)
// so we can turn the whole bridge off without removing the route.

import crypto from 'crypto';
import { safeEqual } from '../utils/crypto.js';
import env from '../config/env.js';

export function initHermesBridge(fastify) {

  const bridgeEnabled = env.hermesBridgeEnabled !== 'false'; // opt-out

  /**
   * GET /api/hub/hermes/sync
   * Stub: returns empty pipeline data. Real pipeline fields dropped with
   * the outreach routes in Batch 1. Hermes is not currently consuming this.
   */
  fastify.get('/api/hub/hermes/sync', async (request, reply) => {
    if (!bridgeEnabled) {
      return reply.status(503).send({ error: 'hermes_bridge_disabled' });
    }
    return reply.send({
      timestamp: new Date().toISOString(),
      pipeline: {
        activeCampaigns: 0,
        totalCampaigns: 0,
        pendingSequences: 0,
        recentActivityCount: 0
      },
      recentActivity: [],
      campaigns: [],
      _note: 'Hub outreach pipeline was deprecated 2026-06-29; this endpoint returns empty data. Re-enable by setting HERMES_BRIDGE_ENABLED=true and rebuilding the outreach domain.'
    });
  });

  /**
   * POST /api/hub/hermes/webhook
   * Receives webhook triggers from Hermes cron.
   * Authenticated by HERMES_WEBHOOK_SECRET (configured in Batch 5 Phase 2a).
   * Action handling stripped — only logs `memory_sync` confirmation now.
   */
  fastify.post('/api/hub/hermes/webhook', {
    config: { skipValidation: true, public: true } // webhook receiver
  }, async (request, reply) => {
    if (!bridgeEnabled) {
      return reply.status(503).send({ error: 'hermes_bridge_disabled' });
    }
    try {
      const signature = request.headers['x-hermes-signature'];

      if (!env.hermesWebhookSecret) {
        if (env.isProduction) {
          return reply.status(503).send({ error: 'Hermes webhook secret not configured' });
        }
      } else {
        if (!signature) {
          return reply.status(401).send({ error: 'Missing signature' });
        }
        const expected = crypto
          .createHmac('sha256', env.hermesWebhookSecret)
          .update(JSON.stringify(request.body ?? {}))
          .digest('hex');
        if (!safeEqual(signature, expected)) {
          return reply.status(401).send({ error: 'Invalid signature' });
        }
      }

      const { event, triggerId } = request.body || {};

      if (!event) {
        return reply.status(400).send({ error: 'Missing event type' });
      }

      fastify.log.info({ event, triggerId }, '[hub-hermes] webhook received');

      // Only the keep-alive events are honoured now. Action handlers
      // (outreach_completed / follow_up_triggered) were tightly coupled
      // to deleted outreach models; re-implement when the outbound
      // campaign domain is rebuilt.
      switch (event) {
        case 'memory_sync':
          return reply.send({ received: true, triggerId, action: 'ready_for_sync' });
        case 'outreach_completed':
        case 'follow_up_triggered':
          // Logging only — downstream side-effects removed with Batch 1.
          fastify.log.info({ event }, '[hub-hermes] legacy event acked (no-op)');
          return reply.send({ received: true, triggerId, action: 'noop' });
        default:
          fastify.log.warn({ event }, '[hub-hermes] unhandled event type');
          return reply.send({ received: true, triggerId, action: 'unknown_event' });
      }
    } catch (error) {
      fastify.log.error({ err: error }, '[hub-hermes] webhook processing failed');
      return reply.status(500).send({ error: 'webhook_failed' });
    }
  });

  if (bridgeEnabled) {
    fastify.log.info('[hub-hermes] bridge initialized');
  } else {
    fastify.log.info('[hub-hermes] bridge disabled via HERMES_BRIDGE_ENABLED=false');
  }
}