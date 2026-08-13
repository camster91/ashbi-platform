import { google } from 'googleapis';
import { decrypt, encrypt } from '../utils/crypto.js';
import env from '../config/env.js';
import { syncCalendarEvent } from '../services/google-calendar-sync.service.js';

const GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

function connectionResponse(connection) {
  if (!connection) return null;
  const { refreshTokenEncrypted: _refreshTokenEncrypted, ...safeConnection } = connection;
  return safeConnection;
}

export default async function googleCalendarRoutes(fastify, options = {}) {
  const googleClientId = options.googleClientId ?? env.googleCalendarClientId;
  const googleClientSecret = options.googleClientSecret ?? env.googleCalendarClientSecret;
  const googleRedirectUri = options.googleRedirectUri ?? env.googleCalendarRedirectUri;
  const encryptSecret = options.encryptSecret ?? encrypt;
  const decryptSecret = options.decryptSecret ?? decrypt;
  const createOAuthClient = options.createOAuthClient ?? (() => new google.auth.OAuth2(
    googleClientId, googleClientSecret, googleRedirectUri,
  ));
  const createCalendarClient = options.createCalendarClient ?? (({ refreshToken }) => {
    const client = createOAuthClient();
    client.setCredentials({ refresh_token: refreshToken });
    return google.calendar({ version: 'v3', auth: client });
  });
  fastify.get('/oauth/start', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
      return reply.status(503).send({ error: 'Google Calendar OAuth is not configured', code: 'GOOGLE_CALENDAR_OAUTH_UNAVAILABLE' });
    }
    const state = fastify.jwt.sign({
      type: 'google_calendar_oauth', organizationId: request.user.organizationId, userId: request.user.id,
    }, { expiresIn: '10m' });
    const authorizeUrl = createOAuthClient().generateAuthUrl({
      access_type: 'offline', prompt: 'consent', scope: GOOGLE_CALENDAR_SCOPES, state,
    });
    return reply.redirect(authorizeUrl);
  });

  fastify.get('/oauth/callback', { config: { public: true } }, async (request, reply) => {
    if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
      return reply.status(503).send({ error: 'Google Calendar OAuth is not configured', code: 'GOOGLE_CALENDAR_OAUTH_UNAVAILABLE' });
    }
    const { code, state } = request.query ?? {};
    if (typeof code !== 'string' || typeof state !== 'string') {
      return reply.status(400).send({ error: 'Missing Google OAuth callback data', code: 'GOOGLE_CALENDAR_OAUTH_INVALID' });
    }
    let oauthState;
    try {
      oauthState = fastify.jwt.verify(state);
    } catch {
      return reply.status(401).send({ error: 'Invalid Google OAuth state', code: 'GOOGLE_CALENDAR_OAUTH_STATE_INVALID' });
    }
    if (oauthState.type !== 'google_calendar_oauth' || typeof oauthState.organizationId !== 'string' || typeof oauthState.userId !== 'string') {
      return reply.status(401).send({ error: 'Invalid Google OAuth state', code: 'GOOGLE_CALENDAR_OAUTH_STATE_INVALID' });
    }

    let tokenResult;
    try {
      tokenResult = await createOAuthClient().getToken(code);
    } catch {
      return reply.status(502).send({ error: 'Google OAuth exchange failed', code: 'GOOGLE_CALENDAR_OAUTH_EXCHANGE_FAILED' });
    }
    const refreshToken = tokenResult?.tokens?.refresh_token;
    if (typeof refreshToken !== 'string' || !refreshToken) {
      return reply.status(502).send({ error: 'Google did not return a refresh token', code: 'GOOGLE_CALENDAR_REFRESH_TOKEN_MISSING' });
    }
    const scope = typeof tokenResult.tokens.scope === 'string'
      ? tokenResult.tokens.scope.split(/\s+/).filter(Boolean)
      : GOOGLE_CALENDAR_SCOPES;
    const data = {
      refreshTokenEncrypted: encryptSecret(refreshToken), scopes: JSON.stringify(scope),
      status: 'ACTIVE', lastError: null, disconnectedAt: null,
    };
    const existing = await fastify.prisma.googleCalendarConnection.findFirst({ where: { userId: oauthState.userId } });
    const connection = existing
      ? await fastify.prisma.googleCalendarConnection.update({ where: { id: existing.id }, data })
      : await fastify.prisma.googleCalendarConnection.create({
        data: { organizationId: oauthState.organizationId, userId: oauthState.userId, ...data },
      });
    return { connection: connectionResponse(connection) };
  });

  fastify.get('/connection', { onRequest: [fastify.authenticate] }, async (request) => ({
    connection: connectionResponse(await request.prisma.googleCalendarConnection.findFirst({
      where: { userId: request.user.id },
    })),
  }));

  fastify.post('/connection/disconnect', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const connection = await request.prisma.googleCalendarConnection.findFirst({ where: { userId: request.user.id } });
    if (!connection) return reply.status(404).send({ error: 'Google Calendar connection not found' });
    await request.prisma.googleCalendarConnection.update({
      where: { id: connection.id },
      data: { status: 'DISCONNECTED', refreshTokenEncrypted: '', disconnectedAt: new Date() },
    });
    return { success: true };
  });

  fastify.post('/events/:eventId/sync', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const event = await request.prisma.calendarEvent.findFirst({ where: { id: request.params.eventId } });
    if (!event) return reply.status(404).send({ error: 'Calendar event not found' });
    if (event.createdById !== request.user.id) {
      return reply.status(403).send({ error: 'Only the event creator can sync this event to Google Calendar' });
    }
    const connection = await request.prisma.googleCalendarConnection.findFirst({
      where: { userId: request.user.id, status: 'ACTIVE' },
    });
    if (!connection?.refreshTokenEncrypted) {
      return reply.status(409).send({ error: 'Connect Google Calendar before syncing an event', code: 'GOOGLE_CALENDAR_NOT_CONNECTED' });
    }
    const claimed = await request.prisma.calendarEvent.updateMany({
      where: { id: event.id, createdById: request.user.id, googleSyncStatus: { not: 'SYNCING' } },
      data: { googleSyncStatus: 'SYNCING', googleSyncError: null },
    });
    if (claimed.count !== 1) {
      return reply.status(409).send({ error: 'Google Calendar sync is already in progress', code: 'GOOGLE_CALENDAR_SYNC_IN_PROGRESS' });
    }
    try {
      const external = await syncCalendarEvent({
        client: createCalendarClient({ refreshToken: decryptSecret(connection.refreshTokenEncrypted) }),
        calendarId: connection.calendarId,
        event,
      });
      const syncedAt = new Date();
      const syncedEvent = await request.prisma.calendarEvent.update({
        where: { id: event.id },
        data: { ...external, googleSyncStatus: 'SYNCED', googleSyncError: null, googleSyncedAt: syncedAt },
      });
      await request.prisma.googleCalendarConnection.update({
        where: { id: connection.id }, data: { status: 'ACTIVE', lastError: null, lastSyncedAt: syncedAt },
      });
      return { event: syncedEvent };
    } catch {
      await request.prisma.calendarEvent.update({
        where: { id: event.id },
        data: { googleSyncStatus: 'ERROR', googleSyncError: 'Google Calendar sync failed' },
      });
      await request.prisma.googleCalendarConnection.update({
        where: { id: connection.id }, data: { status: 'ERROR', lastError: 'Google Calendar sync failed' },
      });
      return reply.status(502).send({ error: 'Google Calendar sync failed', code: 'GOOGLE_CALENDAR_SYNC_FAILED' });
    }
  });
}
