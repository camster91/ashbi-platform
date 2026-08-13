import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoogleCalendarEvent, syncCalendarEvent } from '../../services/google-calendar-sync.service.js';

test('builds a timezone-preserving Google event from an Ashbi event', () => {
  const event = buildGoogleCalendarEvent({
    id: 'ashbi-event-1', title: 'Client kickoff', description: 'Review scope',
    startTime: new Date('2026-08-13T14:00:00.000Z'), endTime: new Date('2026-08-13T15:00:00.000Z'),
    location: 'https://meet.example/1', isAllDay: false,
  });

  assert.deepEqual(event, {
    summary: 'Client kickoff', description: 'Review scope', location: 'https://meet.example/1',
    start: { dateTime: '2026-08-13T14:00:00.000Z', timeZone: 'UTC' },
    end: { dateTime: '2026-08-13T15:00:00.000Z', timeZone: 'UTC' },
    extendedProperties: { private: { ashbiEventId: 'ashbi-event-1' } },
  });
});

test('updates an existing linked Google event instead of duplicating it', async () => {
  const calls = [];
  const client = { events: { update: async (input) => { calls.push(input); return { data: { id: 'google-1' } }; } } };
  const result = await syncCalendarEvent({
    client, calendarId: 'primary', event: { id: 'ashbi-event-1', googleEventId: 'google-1', title: 'Updated', startTime: new Date('2026-08-13T14:00:00.000Z'), endTime: new Date('2026-08-13T15:00:00.000Z'), isAllDay: false },
  });

  assert.equal(result.googleEventId, 'google-1');
  assert.equal(calls[0].eventId, 'google-1');
  assert.equal(calls[0].calendarId, 'primary');
});

test('creates a Google event once when Ashbi has no external link', async () => {
  const client = { events: { insert: async (input) => ({ data: { id: 'google-2', htmlLink: input.resource.htmlLink } }) } };
  const result = await syncCalendarEvent({
    client, calendarId: 'primary', event: { id: 'ashbi-event-2', title: 'New', startTime: new Date('2026-08-13T14:00:00.000Z'), endTime: new Date('2026-08-13T15:00:00.000Z'), isAllDay: false },
  });

  assert.deepEqual(result, { googleEventId: 'google-2', googleEventUrl: undefined });
});
