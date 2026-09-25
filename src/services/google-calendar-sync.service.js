import { google } from 'googleapis';
import env from '../config/env.js';

export const DEFAULT_GOOGLE_TIME_ZONE = 'UTC';
export const GOOGLE_TOKEN_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
// Best-effort provider calls (revoke on disconnect, delete on Hub delete)
// must not be able to hang the request that triggered them.
export const GOOGLE_REQUEST_TIMEOUT_MS = 10_000;
// A sync claims the event by setting googleSyncStatus=SYNCING (which also
// bumps updatedAt). If the process dies mid-sync nothing ever releases that
// claim, so a claim older than this bound is treated as abandoned.
export const GOOGLE_SYNC_STALE_LOCK_MS = 15 * 60 * 1000;

function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Picks the first valid IANA time zone from the candidates, most specific
 * first (event, then user, then organization). No such setting is stored
 * today, so this falls back to UTC; the event instant itself is always sent
 * as an absolute ISO timestamp, so UTC never shifts a timed event.
 */
export function resolveGoogleTimeZone(...candidates) {
  return candidates.find(isValidTimeZone) ?? DEFAULT_GOOGLE_TIME_ZONE;
}

function calendarDateIn(date, timeZone) {
  // en-CA formats as YYYY-MM-DD, the shape Google expects for all-day dates.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

const RECURRENCE_LINE = /^(RRULE|EXRULE|RDATE|EXDATE)[:;]/i;

/**
 * Maps the stored recurrence (a JSON string, per the schema) to Google's
 * `recurrence` array. Only RFC 5545 lines are accepted: a single rule string,
 * a bare "FREQ=..." rule, or an array of such lines. Any other shape (for
 * example an app-specific object) is skipped rather than guessed at, because
 * sending a malformed rule would make Google reject the whole event.
 */
export function mapRecurrenceToGoogle(recurrence) {
  if (recurrence == null || recurrence === '') return undefined;
  let value = recurrence;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      // A raw (non-JSON) rule string is still acceptable.
    }
  }
  const lines = (Array.isArray(value) ? value : [value]).map((line) => {
    // A CR/LF would let one stored value smuggle extra iCalendar lines.
    if (typeof line !== 'string' || /[\r\n]/.test(line)) return null;
    const trimmed = line.trim();
    if (/^FREQ=/i.test(trimmed)) return `RRULE:${trimmed}`;
    return RECURRENCE_LINE.test(trimmed) ? trimmed : null;
  });
  if (lines.length === 0 || lines.some((line) => !line)) return undefined;
  return lines;
}

export function buildGoogleCalendarEvent(event, { timeZone } = {}) {
  const zone = resolveGoogleTimeZone(timeZone, event.timeZone);
  const recurrence = mapRecurrenceToGoogle(event.recurrence);
  const base = {
    summary: event.title,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    extendedProperties: { private: { ashbiEventId: event.id } },
    ...(recurrence ? { recurrence } : {}),
  };
  if (event.isAllDay) {
    return {
      ...base,
      start: { date: calendarDateIn(event.startTime, zone) },
      end: { date: calendarDateIn(event.endTime, zone) },
    };
  }
  return {
    ...base,
    start: { dateTime: event.startTime.toISOString(), timeZone: zone },
    end: { dateTime: event.endTime.toISOString(), timeZone: zone },
  };
}

export async function syncCalendarEvent({ client, calendarId, event, timeZone }) {
  const resource = buildGoogleCalendarEvent(event, { timeZone });
  if (event.googleEventId) {
    const result = await client.events.update({ calendarId, eventId: event.googleEventId, resource });
    return { googleEventId: result.data.id, googleEventUrl: result.data.htmlLink };
  }
  const result = await client.events.insert({ calendarId, resource });
  return { googleEventId: result.data.id, googleEventUrl: result.data.htmlLink };
}

function providerStatus(error) {
  const status = error?.response?.status ?? error?.status ?? error?.code;
  return Number.isInteger(status) ? status : Number.parseInt(status, 10) || null;
}

/** Deletes the Google copy of an event; an already-gone event counts as deleted. */
export async function deleteGoogleCalendarEvent({ client, calendarId, googleEventId, timeoutMs = GOOGLE_REQUEST_TIMEOUT_MS }) {
  try {
    await client.events.delete({ calendarId, eventId: googleEventId }, { timeout: timeoutMs });
    return { deleted: true };
  } catch (error) {
    const status = providerStatus(error);
    if (status === 404 || status === 410) return { deleted: true, alreadyGone: true };
    throw error;
  }
}

/**
 * Reduces a provider error to something safe to log and store: an HTTP
 * status plus a short reason, with anything token-shaped redacted. Google
 * client errors can carry request config (headers, bodies) that include
 * access or refresh tokens, so the raw error object is never logged.
 */
export function scrubGoogleError(error, knownSecrets = []) {
  const status = providerStatus(error);
  const reasonSource = error?.response?.data?.error ?? error?.errors?.[0]?.reason ?? error?.message ?? 'unknown';
  const rawReason = typeof reasonSource === 'string' ? reasonSource : (reasonSource?.status ?? reasonSource?.message ?? 'unknown');
  let reason = String(rawReason);
  for (const secret of knownSecrets) {
    if (typeof secret === 'string' && secret.length >= 4) reason = reason.split(secret).join('[redacted]');
  }
  reason = reason
    .replace(/ya29\.[\w.-]+/g, '[redacted]')
    .replace(/1\/\/[\w.-]+/g, '[redacted]')
    .replace(/(bearer\s+)[\w.~+/-]+=*/gi, '$1[redacted]')
    .replace(/((?:access|refresh|id)_token["'=:\s]+)[^\s"'&,]+/gi, '$1[redacted]')
    .slice(0, 200);
  return { status, reason };
}

export function describeGoogleSyncFailure(error, knownSecrets = []) {
  const { status, reason } = scrubGoogleError(error, knownSecrets);
  return `Google Calendar sync failed${status ? ` (${status})` : ''}: ${reason}`.slice(0, 300);
}

/** Revokes a Google OAuth token. Google treats an already-invalid token as 400 invalid_token. */
export async function revokeGoogleToken({ token, fetchImpl = fetch, timeoutMs = GOOGLE_REQUEST_TIMEOUT_MS }) {
  const response = await fetchImpl(GOOGLE_TOKEN_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.ok) return { revoked: true };
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error bodies fall through to the generic failure.
  }
  if (response.status === 400 && body?.error === 'invalid_token') return { revoked: true, alreadyInvalid: true };
  throw new Error(`GOOGLE_REVOKE_FAILED_${response.status}`);
}

/**
 * Propagates a Hub-side delete of a synced event to Google Calendar. It is
 * best-effort: the Hub delete has already happened and must not be undone
 * because Google is unavailable. The outcome is recorded on the creator's
 * connection (lastSyncedAt on success, a scrubbed lastError on failure) and
 * failures are logged without provider error objects or tokens.
 */
export async function propagateCalendarEventDeletion({ prisma, event, createCalendarClient, decryptSecret, log }) {
  if (!event?.googleEventId) return { propagated: false, reason: 'NOT_SYNCED' };
  const connection = await prisma.googleCalendarConnection.findFirst({
    where: { userId: event.createdById, status: { in: ['ACTIVE', 'ERROR'] } },
  });
  if (!connection?.refreshTokenEncrypted) {
    log?.warn?.({ eventId: event.id }, 'Google Calendar copy not deleted: creator has no active connection');
    return { propagated: false, reason: 'NOT_CONNECTED' };
  }
  let refreshToken;
  try {
    refreshToken = decryptSecret(connection.refreshTokenEncrypted);
    await deleteGoogleCalendarEvent({
      client: createCalendarClient({ refreshToken }),
      calendarId: connection.calendarId,
      googleEventId: event.googleEventId,
    });
    await prisma.googleCalendarConnection.update({
      where: { id: connection.id }, data: { lastSyncedAt: new Date() },
    });
    return { propagated: true };
  } catch (error) {
    const scrubbed = scrubGoogleError(error, [refreshToken]);
    log?.warn?.({ eventId: event.id, connectionId: connection.id, ...scrubbed }, 'Google Calendar event delete failed');
    try {
      await prisma.googleCalendarConnection.update({
        where: { id: connection.id },
        data: { lastError: `Google Calendar delete failed${scrubbed.status ? ` (${scrubbed.status})` : ''}: ${scrubbed.reason}`.slice(0, 300) },
      });
    } catch {
      // Recording the failure is itself best-effort.
    }
    return { propagated: false, reason: 'PROVIDER_ERROR' };
  }
}

export function createGoogleOAuthClient({
  clientId = env.googleCalendarClientId, clientSecret = env.googleCalendarClientSecret,
  redirectUri = env.googleCalendarRedirectUri,
} = {}) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function createGoogleCalendarClient({ refreshToken, oauthClient = createGoogleOAuthClient() }) {
  oauthClient.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: oauthClient });
}
