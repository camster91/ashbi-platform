import { decrypt, encrypt } from '../utils/crypto.js';
import { validateBody, slackInstallationSchema, slackChannelMappingSchema } from '../validators/schemas.js';
import env from '../config/env.js';
import { revokeSlackToken } from '../services/slack-outbound.service.js';

const SLACK_BOT_SCOPES = ['channels:history', 'chat:write'];

function installationResponse(installation) {
  const { botTokenEncrypted: _botTokenEncrypted, ...safeInstallation } = installation;
  let scopes = [];
  try {
    const parsed = JSON.parse(installation.scopes || '[]');
    scopes = Array.isArray(parsed) ? parsed.filter((scope) => typeof scope === 'string') : [];
  } catch {
    // A malformed legacy value must not break the administrative lifecycle UI.
  }
  return { ...safeInstallation, scopes };
}

function validSlackId(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9]+$/.test(value);
}

export default async function slackAdminRoutes(fastify, options = {}) {
  const encryptSecret = options.encryptSecret ?? encrypt;
  const decryptSecret = options.decryptSecret ?? decrypt;
  const revokeToken = options.revokeSlackToken ?? revokeSlackToken;
  const fetchImpl = options.fetchImpl ?? fetch;
  const slackClientId = options.slackClientId ?? env.slackClientId;
  const slackClientSecret = options.slackClientSecret ?? env.slackClientSecret;
  const slackRedirectUri = options.slackRedirectUri ?? env.slackRedirectUri;
  const adminOnly = { onRequest: [fastify.authenticate, fastify.adminOnly] };

  fastify.get('/oauth/start', adminOnly, async (request, reply) => {
    if (!slackClientId || !slackClientSecret || !slackRedirectUri) {
      return reply.status(503).send({ error: 'Slack OAuth is not configured', code: 'SLACK_OAUTH_UNAVAILABLE' });
    }
    const state = fastify.jwt.sign({
      type: 'slack_oauth', organizationId: request.user.organizationId, userId: request.user.id,
    }, { expiresIn: '10m' });
    const authorizeUrl = new URL('https://slack.com/oauth/v2/authorize');
    authorizeUrl.searchParams.set('client_id', slackClientId);
    authorizeUrl.searchParams.set('redirect_uri', slackRedirectUri);
    authorizeUrl.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
    authorizeUrl.searchParams.set('state', state);
    return reply.redirect(authorizeUrl.toString());
  });

  fastify.get('/oauth/callback', { config: { public: true } }, async (request, reply) => {
    if (!slackClientId || !slackClientSecret || !slackRedirectUri) {
      return reply.status(503).send({ error: 'Slack OAuth is not configured', code: 'SLACK_OAUTH_UNAVAILABLE' });
    }
    const { code, state } = request.query ?? {};
    if (typeof code !== 'string' || typeof state !== 'string') {
      return reply.status(400).send({ error: 'Missing Slack OAuth callback data', code: 'SLACK_OAUTH_INVALID' });
    }
    let oauthState;
    try {
      oauthState = fastify.jwt.verify(state);
    } catch {
      return reply.status(401).send({ error: 'Invalid Slack OAuth state', code: 'SLACK_OAUTH_STATE_INVALID' });
    }
    if (oauthState.type !== 'slack_oauth' || typeof oauthState.organizationId !== 'string') {
      return reply.status(401).send({ error: 'Invalid Slack OAuth state', code: 'SLACK_OAUTH_STATE_INVALID' });
    }

    const credentials = Buffer.from(`${slackClientId}:${slackClientSecret}`).toString('base64');
    const tokenResponse = await fetchImpl('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, redirect_uri: slackRedirectUri }),
    });
    const tokenBody = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenBody?.ok || !validSlackId(tokenBody.team?.id) || typeof tokenBody.access_token !== 'string') {
      return reply.status(502).send({ error: 'Slack OAuth exchange failed', code: 'SLACK_OAUTH_EXCHANGE_FAILED' });
    }

    const data = {
      teamName: typeof tokenBody.team.name === 'string' ? tokenBody.team.name : null,
      botUserId: validSlackId(tokenBody.bot_user_id) ? tokenBody.bot_user_id : null,
      botTokenEncrypted: encryptSecret(tokenBody.access_token),
      scopes: JSON.stringify(typeof tokenBody.scope === 'string' ? tokenBody.scope.split(',').filter(Boolean) : []),
      status: 'ACTIVE', disconnectedAt: null,
    };
    const existing = await fastify.prisma.slackInstallation.findFirst({ where: { teamId: tokenBody.team.id } });
    if (existing && existing.organizationId !== oauthState.organizationId) {
      return reply.status(409).send({ error: 'Slack workspace is already connected', code: 'SLACK_WORKSPACE_CONFLICT' });
    }
    const installation = existing
      ? await fastify.prisma.slackInstallation.update({ where: { id: existing.id }, data })
      : await fastify.prisma.slackInstallation.create({ data: { organizationId: oauthState.organizationId, teamId: tokenBody.team.id, ...data } });
    // Slack redirects the administrator's browser here. Return to the
    // authenticated settings surface instead of rendering installation JSON
    // at the OAuth callback URL.
    return reply.redirect('/settings?slack=connected');
  });

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

    // Revoke the bot token with Slack first so it cannot be used even if a
    // copy survives elsewhere. This is best-effort: Slack being unreachable
    // must never keep a workspace connected that an administrator removed.
    // Only an error code is logged; the token itself never reaches logs.
    let tokenRevoked = false;
    if (installation.botTokenEncrypted) {
      try {
        await revokeToken({ botToken: decryptSecret(installation.botTokenEncrypted), fetchImpl });
        tokenRevoked = true;
      } catch (error) {
        request.log.warn({
          installationId: installation.id,
          code: typeof error?.message === 'string' && /^SLACK_[A-Z0-9_]+$/.test(error.message) ? error.message : 'SLACK_REVOKE_FAILED',
        }, 'Slack token revocation failed; disconnecting locally');
      }
    }

    await request.prisma.slackInstallation.update({
      where: { id: installation.id },
      data: { status: 'DISCONNECTED', botTokenEncrypted: null, disconnectedAt: new Date() },
    });
    return { success: true, tokenRevoked };
  });
}
