import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  mapRecurrenceToGoogle,
  propagateCalendarEventDeletion,
  resolveGoogleTimeZone,
  revokeGoogleToken,
  scrubGoogleError,
} from '../../services/google-calendar-sync.service.js';

const timed = {
  id: 'ashbi-1', title: 'Standup',
  startTime: new Date('2026-08-13T14:00:00.000Z'), endTime: new Date('2026-08-13T15:00:00.000Z'), isAllDay: false,
};

test('uses the first valid configured time zone and falls back to UTC', () => {
  assert.equal(resolveGoogleTimeZone(undefined, 'America/Toronto', 'Europe/London'), 'America/Toronto');
  assert.equal(resolveGoogleTimeZone('Not/AZone', null, ''), 'UTC');
  assert.equal(resolveGoogleTimeZone(), 'UTC');

  const event = buildGoogleCalendarEvent(timed, { timeZone: 'America/Toronto' });
  assert.deepEqual(event.start, { dateTime: '2026-08-13T14:00:00.000Z', timeZone: 'America/Toronto' });
  assert.deepEqual(buildGoogleCalendarEvent({ ...timed, timeZone: 'Asia/Tokyo' }).end.timeZone, 'Asia/Tokyo');
});

test('computes all-day dates in the resolved time zone', () => {
  const allDay = {
    ...timed, isAllDay: true,
    startTime: new Date('2026-08-14T02:00:00.000Z'), endTime: new Date('2026-08-15T02:00:00.000Z'),
  };
  assert.deepEqual(buildGoogleCalendarEvent(allDay).start, { date: '2026-08-14' });
  assert.deepEqual(buildGoogleCalendarEvent(allDay, { timeZone: 'America/Toronto' }).start, { date: '2026-08-13' });
});

test('maps RRULE-compatible recurrence and skips anything else', () => {
  assert.deepEqual(mapRecurrenceToGoogle(JSON.stringify('RRULE:FREQ=WEEKLY;BYDAY=MO')), ['RRULE:FREQ=WEEKLY;BYDAY=MO']);
  assert.deepEqual(mapRecurrenceToGoogle('FREQ=DAILY;COUNT=5'), ['RRULE:FREQ=DAILY;COUNT=5']);
  assert.deepEqual(
    mapRecurrenceToGoogle(JSON.stringify(['RRULE:FREQ=WEEKLY', 'EXDATE:20260820T140000Z'])),
    ['RRULE:FREQ=WEEKLY', 'EXDATE:20260820T140000Z'],
  );
  assert.equal(mapRecurrenceToGoogle(JSON.stringify({ frequency: 'weekly', interval: 1 })), undefined);
  assert.equal(mapRecurrenceToGoogle(JSON.stringify(['RRULE:FREQ=WEEKLY', 'every other tuesday'])), undefined);
  assert.equal(mapRecurrenceToGoogle(null), undefined);
  assert.equal(mapRecurrenceToGoogle(JSON.stringify('RRULE:FREQ=DAILY\r\nATTENDEE:mailto:x@example.com')), undefined);
  assert.equal(mapRecurrenceToGoogle(JSON.stringify(['RRULE:FREQ=DAILY\nX-EXTRA:1'])), undefined);

  assert.deepEqual(buildGoogleCalendarEvent({ ...timed, recurrence: '"RRULE:FREQ=WEEKLY"' }).recurrence, ['RRULE:FREQ=WEEKLY']);
  assert.equal('recurrence' in buildGoogleCalendarEvent({ ...timed, recurrence: '{"frequency":"weekly"}' }), false);
});

test('deletes the Google event and treats an already-missing one as deleted', async () => {
  const calls = [];
  const client = { events: { delete: async (input, requestOptions) => { calls.push([input, requestOptions]); } } };
  assert.deepEqual(await deleteGoogleCalendarEvent({ client, calendarId: 'primary', googleEventId: 'g-1' }), { deleted: true });
  assert.deepEqual(calls, [[{ calendarId: 'primary', eventId: 'g-1' }, { timeout: 10_000 }]]);

  const gone = { events: { delete: async () => { throw Object.assign(new Error('Resource has been deleted'), { code: 410 }); } } };
  assert.equal((await deleteGoogleCalendarEvent({ client: gone, calendarId: 'primary', googleEventId: 'g-1' })).alreadyGone, true);

  const failing = { events: { delete: async () => { throw Object.assign(new Error('boom'), { code: 500 }); } } };
  await assert.rejects(() => deleteGoogleCalendarEvent({ client: failing, calendarId: 'primary', googleEventId: 'g-1' }));
});

test('scrubs tokens out of provider errors', () => {
  const error = Object.assign(new Error('invalid_grant for refresh_token=1//secret-refresh and Bearer ya29.secret-access'), {
    response: { status: 401 }, config: { headers: { Authorization: 'Bearer ya29.secret-access' } },
  });
  const scrubbed = scrubGoogleError(error);
  assert.equal(scrubbed.status, 401);
  assert.ok(!JSON.stringify(scrubbed).includes('secret'));
  assert.deepEqual(Object.keys(scrubbed).sort(), ['reason', 'status']);
});

test('revokes a Google token and accepts an already-invalid token', async () => {
  let request;
  const result = await revokeGoogleToken({
    token: 'refresh-secret',
    fetchImpl: async (url, input) => { request = { url, input }; return { ok: true, status: 200 }; },
  });
  assert.deepEqual(result, { revoked: true });
  assert.equal(request.url, 'https://oauth2.googleapis.com/revoke');
  assert.equal(request.input.method, 'POST');
  assert.ok(request.input.signal instanceof AbortSignal);
  assert.equal(new URLSearchParams(request.input.body.toString()).get('token'), 'refresh-secret');

  const invalid = await revokeGoogleToken({
    token: 'x', fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_token' }) }),
  });
  assert.equal(invalid.revoked, true);
  await assert.rejects(
    () => revokeGoogleToken({ token: 'x', fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) }),
    /GOOGLE_REVOKE_FAILED_503/,
  );
});

function connectionPrisma(connection) {
  const updates = [];
  return {
    updates,
    prisma: {
      googleCalendarConnection: {
        findFirst: async () => connection,
        update: async ({ data }) => { updates.push(data); return { ...connection, ...data }; },
      },
    },
  };
}

test('propagates a Hub delete to Google and records success on the connection', async () => {
  const { prisma, updates } = connectionPrisma({ id: 'conn-1', calendarId: 'primary', refreshTokenEncrypted: 'ciphertext' });
  let deleted;
  const result = await propagateCalendarEventDeletion({
    prisma,
    event: { id: 'ashbi-1', createdById: 'user-1', googleEventId: 'g-1' },
    decryptSecret: () => 'refresh-token',
    createCalendarClient: ({ refreshToken }) => {
      assert.equal(refreshToken, 'refresh-token');
      return { events: { delete: async (input) => { deleted = input; } } };
    },
  });
  assert.deepEqual(result, { propagated: true });
  assert.deepEqual(deleted, { calendarId: 'primary', eventId: 'g-1' });
  assert.ok(updates[0].lastSyncedAt instanceof Date);
});

test('records and logs a scrubbed failure when the Google delete fails', async () => {
  const { prisma, updates } = connectionPrisma({ id: 'conn-1', calendarId: 'primary', refreshTokenEncrypted: 'ciphertext' });
  const logged = [];
  const result = await propagateCalendarEventDeletion({
    prisma,
    event: { id: 'ashbi-1', createdById: 'user-1', googleEventId: 'g-1' },
    decryptSecret: () => 'refresh-token',
    createCalendarClient: () => ({ events: { delete: async () => { throw Object.assign(new Error('Bearer ya29.leak failed'), { code: 503 }); } } }),
    log: { warn: (...args) => logged.push(JSON.stringify(args)) },
  });
  assert.deepEqual(result, { propagated: false, reason: 'PROVIDER_ERROR' });
  assert.match(updates[0].lastError, /Google Calendar delete failed \(503\)/);
  assert.ok(!updates[0].lastError.includes('ya29.leak'));
  assert.equal(logged.length, 1);
  assert.ok(!logged[0].includes('ya29.leak') && !logged[0].includes('refresh-token'));
});

test('skips Google when the event was never synced or the creator is disconnected', async () => {
  assert.deepEqual(
    await propagateCalendarEventDeletion({ prisma: {}, event: { id: 'e', googleEventId: null } }),
    { propagated: false, reason: 'NOT_SYNCED' },
  );
  const { prisma } = connectionPrisma(null);
  assert.deepEqual(
    await propagateCalendarEventDeletion({ prisma, event: { id: 'e', createdById: 'u', googleEventId: 'g' } }),
    { propagated: false, reason: 'NOT_CONNECTED' },
  );
});
