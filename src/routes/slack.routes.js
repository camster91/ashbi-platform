import { encrypt } from '../utils/crypto.js';
import { validateBody, slackInstallationSchema, slackChannelMappingSchema } from '../validators/schemas.js';

function installationResponse(installation) {
  const { botTokenEncrypted: _botTokenEncrypted, ...safeInstallation } = installation;
  return safeInstallation;
}

function validSlackId(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9]+$/.test(value);
}

export default async function slackAdminRoutes(fastify, options = {}) {
  const encryptSecret = options.encryptSecret ?? encrypt;
  const adminOnly = { onRequest: [fastify.authenticate, fastify.adminOnly] };

  fastify.get('/', adminOnly, async (request) => {
    const installations = await request.prisma.slackInstallation.findMany({
      include: { channelMappings: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return { installations: installations.map(installationResponse) };
  });

  fastify.post('/install', { ...adminOnly, preHandler: validateBody(slackInstallationSchema) }, async (request, reply) => {
    const { teamId, teamName, botUserId, botToken, scopes = [] } = request.body ?? {};
    if (!validSlackId(teamId) || typeof botToken !== 'string' || !botToken.trim() || !Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) {
      return reply.status(400).send({ error: 'Invalid Slack installation data', code: 'SLACK_INSTALLATION_INVALID' });
    }

    const data = {
      teamName: typeof teamName === 'string' ? teamName.trim() || null : null,
      botUserId: validSlackId(botUserId) ? botUserId : null,
      botTokenEncrypted: encryptSecret(botToken.trim()),
      scopes: JSON.stringify(scopes),
      status: 'ACTIVE',
      disconnectedAt: null,
    };
    const existing = await request.prisma.slackInstallation.findFirst({ where: { teamId } });
    if (existing) {
      const installation = await request.prisma.slackInstallation.update({ where: { id: existing.id }, data });
      return { installation: installationResponse(installation) };
    }

    try {
      const installation = await request.prisma.slackInstallation.create({ data: { teamId, ...data } });
      return reply.status(201).send(installationResponse(installation));
    } catch (error) {
      if (error?.code === 'P2002') {
        return reply.status(409).send({ error: 'Slack workspace is already connected', code: 'SLACK_WORKSPACE_CONFLICT' });
      }
      throw error;
    }
  });

  fastify.post('/installations/:installationId/mappings', { ...adminOnly, preHandler: validateBody(slackChannelMappingSchema) }, async (request, reply) => {
    const { installationId } = request.params;
    const { projectId, channelId, channelName, inboundEnabled = true, outboundEnabled = false } = request.body ?? {};
    if (typeof projectId !== 'string' || !validSlackId(channelId) || typeof inboundEnabled !== 'boolean' || typeof outboundEnabled !== 'boolean') {
      return reply.status(400).send({ error: 'Invalid Slack channel mapping', code: 'SLACK_MAPPING_INVALID' });
    }

    const [installation, project] = await Promise.all([
      request.prisma.slackInstallation.findFirst({ where: { id: installationId, status: 'ACTIVE' } }),
      request.prisma.project.findFirst({ where: { id: projectId } }),
    ]);
    if (!installation || !project) return reply.status(404).send({ error: 'Slack installation or project not found' });

    const data = {
      installationId, projectId, channelId,
      channelName: typeof channelName === 'string' ? channelName.trim() || null : null,
      inboundEnabled, outboundEnabled,
    };
    const existing = await request.prisma.slackChannelMapping.findFirst({ where: { installationId, channelId } });
    const mapping = existing
      ? await request.prisma.slackChannelMapping.update({ where: { id: existing.id }, data })
      : await request.prisma.slackChannelMapping.create({ data });
    return reply.status(existing ? 200 : 201).send({ mapping });
  });

  fastify.post('/installations/:installationId/disconnect', adminOnly, async (request, reply) => {
    const installation = await request.prisma.slackInstallation.findFirst({ where: { id: request.params.installationId } });
    if (!installation) return reply.status(404).send({ error: 'Slack installation not found' });
    await request.prisma.slackInstallation.update({
      where: { id: installation.id },
      data: { status: 'DISCONNECTED', botTokenEncrypted: null, disconnectedAt: new Date() },
    });
    return { success: true };
  });
}
