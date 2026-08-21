import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../lib/api.js';

function response(data = {}) {
  return { ok: true, status: 200, json: vi.fn().mockResolvedValue(data) };
}

describe('timesheet API contract', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ timesheets: [] }))));
  afterEach(() => vi.unstubAllGlobals());

  it('uses the server-registered weekly and review routes', async () => {
    await api.getWeeklyTimesheet('2026-08-17T04:00:00.000Z');
    await api.approveTimesheetEntry('entry-1');
    await api.rejectTimesheetEntry('entry-1', 'Needs a project reference');

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/time/timesheets/weekly?weekStart=2026-08-17T04:00:00.000Z', expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/time/timesheets/entry-1/approve', expect.objectContaining({ method: 'PATCH' }));
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/time/timesheets/entry-1/reject', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ reason: 'Needs a project reference' }) }));
  });
});
