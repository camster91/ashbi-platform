import env from '../config/env.js';
import { verifySlackEventRequest } from '../security/slack-events-auth.js';

/**
 * Slack Events API receiver. This endpoint is public only because Slack signs
 * every delivery; tenant ownership is derived from the active installation,
 * never from a caller-supplied organization identifier.
 */
export default async function slackEventRoutes(fastify, options = {}) {
  const signingSecret = options.signingSecret ?? env.slackSigningSecret;

  fastify.post('/', { config: { public: true } }, async (request, reply) => {
    if (!signingSecret) {
      return reply.status(503).send({ error: 'Slack events are not configured', code: 'SLACK_EVENTS_UNAVAILABLE' });
    }

    const verification = verifySlackEventRequest({
      rawBody: request.rawBody,
      timestamp: request.headers['x-slack-request-timestamp'],
      signature: request.headers['x-slack-signature'],
      signingSecret,
    });
    if (!verification.valid) {
      return reply.status(401).send({ error: 'Invalid Slack signature', code: verification.reason });
    }

    const body = request.body ?? {};
    if (body.type === 'url_verification' && typeof body.challenge === 'string') {
      return { challenge: body.challenge };
    }

    if (body.type !== 'event_callback' || typeof body.team_id !== 'string' || typeof body.event_id !== 'string') {
      return reply.status(400).send({ error: 'Invalid Slack event payload', code: 'SLACK_EVENT_INVALID' });
    }

    const event = body.event ?? {};
    const channelId = typeof event.channel === 'string' ? event.channel : null;
    const installation = await fastify.prisma.slackInstallation.findFirst({
      where: { teamId: body.team_id, status: 'ACTIVE' },
      select: { id: true, organizationId: true },
    });
    if (!installation || !channelId) return reply.status(202).send({ ok: true, ignored: true });

    const mapping = await fastify.prisma.slackChannelMapping.findFirst({
      where: { installationId: installation.id, channelId, inboundEnabled: true },
      select: { id: true, projectId: true },
    });
    if (!mapping) return reply.status(202).send({ ok: true, ignored: true });

    try {
      await fastify.prisma.$transaction(async (transaction) => {
        await transaction.slackEventReceipt.create({
          data: {
            organizationId: installation.organizationId,
            installationId: installation.id,
            eventId: body.event_id,
            eventType: typeof event.type === 'string' ? event.type : 'unknown',
            channelId,
            status: 'RECEIVED',
          },
        });
        if (event.type === 'message' && typeof event.text === 'string' && event.text.trim()) {
          const externalMessageId = typeof event.ts === 'string' ? event.ts : null;
          const externalThreadId = typeof event.thread_ts === 'string' ? event.thread_ts : externalMessageId;
          let parentId = null;
          if (externalThreadId && externalThreadId !== externalMessageId) {
            const parent = await transaction.chatMessage.findFirst({
              where: { projectId: mapping.projectId, externalSource: 'SLACK', externalMessageId: externalThreadId },
              select: { id: true },
            });
            parentId = parent?.id ?? null;
          }
          const message = await transaction.chatMessage.create({
            data: {
              projectId: mapping.projectId,
              content: event.text.trim(),
              type: 'TEXT',
              parentId,
              externalSource: 'SLACK',
              externalAuthorName: typeof event.username === 'string' ? event.username : 'Slack user',
              externalMessageId,
              externalThreadId,
              metadata: JSON.stringify({
                source: 'SLACK', teamId: body.team_id, channelId, eventId: body.event_id,
                externalUserId: typeof event.user === 'string' ? event.user : null,
              }),
            },
          });
          if (externalMessageId && externalThreadId === externalMessageId) {
            await transaction.chatMessage.updateMany({
              where: {
                projectId: mapping.projectId,
                externalSource: 'SLACK',
                externalThreadId: externalMessageId,
                parentId: null,
                id: { not: message.id },
              },
              data: { parentId: message.id },
            });
          }
        }
      });
    } catch (error) {
      if (error?.code === 'P2002') return reply.status(200).send({ ok: true, duplicate: true });
      throw error;
    }

    return reply.status(202).send({ ok: true, accepted: true });
  });
}
