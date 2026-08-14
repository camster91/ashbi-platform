import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const api = readFileSync(resolve(process.cwd(), 'src/lib/api.js'), 'utf8');
const settings = readFileSync(resolve(process.cwd(), 'src/pages/Settings.jsx'), 'utf8');
const schedule = readFileSync(resolve(process.cwd(), 'src/pages/Schedule.jsx'), 'utf8');

describe('Google Calendar user workflow contract', () => {
  it('exposes a per-user connection lifecycle rather than a hidden backend-only integration', () => {
    expect(api).toContain('googleCalendarOAuthStartUrl');
    expect(api).toContain("getGoogleCalendarConnection: ()");
    expect(api).toContain("disconnectGoogleCalendar: ()");
    expect(settings).toContain('Connect Google Calendar');
    expect(settings).toContain('Disconnect Google Calendar');
    expect(settings).toContain('api.googleCalendarOAuthStartUrl()');
  });

  it('keeps calendar writes explicit and offers the reconciled Google event link', () => {
    expect(api).toContain('syncGoogleCalendarEvent: (eventId)');
    expect(schedule).toContain('Sync to Google Calendar');
    expect(schedule).toContain('Update Google Calendar');
    expect(schedule).toContain('Open in Google Calendar');
    expect(schedule).toContain('Only the event creator can explicitly sync this event.');
  });
});
