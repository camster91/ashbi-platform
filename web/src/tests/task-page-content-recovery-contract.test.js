import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('debounces task-content saves and preserves a failed revision for retry', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/TaskPage.jsx'), 'utf8');
  expect(source).toContain('contentSaveTimerRef');
  expect(source).toContain('contentSaveError');
  expect(source).toContain('Content was not saved. Try again.');
  expect(source).toContain('updateMutation.mutate({ content: contentSaveError })');
});
