import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('explains a failed Kanban move and lets the user retry the same transition', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/TaskKanban.jsx'), 'utf8');
  expect(source).toContain('moveError');
  expect(source).toContain('Task move was not saved. Try again.');
  expect(source).toContain('moveMutation.mutate(moveError)');
});

it('keeps a failed quick task creation available for retry', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/TaskKanban.jsx'), 'utf8');
  expect(source).toContain('createError');
  expect(source).toContain('Task was not created. Try again.');
  expect(source).toContain('createMutation.mutate(createError)');
});
