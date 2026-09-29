import assert from 'node:assert/strict';
import test from 'node:test';
import { timeEntryCreateSchema, timeEntryUpdateSchema } from '../../validators/schemas.js';

test('time entry duration is documented as minutes, matching TimeEntry.duration', () => {
  assert.match(timeEntryCreateSchema.shape.duration.description, /minutes/i);
  assert.match(timeEntryUpdateSchema.shape.duration.unwrap().description, /minutes/i);
  // 7.5 hours is 450 minutes — the value the UI renders as 7.50h.
  assert.equal(timeEntryCreateSchema.safeParse({ projectId: 'p1', duration: 450 }).success, true);
});
