const GOOGLE_TIME_ZONE = 'UTC';

export function buildGoogleCalendarEvent(event) {
  const base = {
    summary: event.title,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    extendedProperties: { private: { ashbiEventId: event.id } },
  };
  if (event.isAllDay) {
    const start = event.startTime.toISOString().slice(0, 10);
    const end = event.endTime.toISOString().slice(0, 10);
    return { ...base, start: { date: start }, end: { date: end } };
  }
  return {
    ...base,
    start: { dateTime: event.startTime.toISOString(), timeZone: GOOGLE_TIME_ZONE },
    end: { dateTime: event.endTime.toISOString(), timeZone: GOOGLE_TIME_ZONE },
  };
}

export async function syncCalendarEvent({ client, calendarId, event }) {
  const resource = buildGoogleCalendarEvent(event);
  if (event.googleEventId) {
    const result = await client.events.update({ calendarId, eventId: event.googleEventId, resource });
    return { googleEventId: result.data.id, googleEventUrl: result.data.htmlLink };
  }
  const result = await client.events.insert({ calendarId, resource });
  return { googleEventId: result.data.id, googleEventUrl: result.data.htmlLink };
}
