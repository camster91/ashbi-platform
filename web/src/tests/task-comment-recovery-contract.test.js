import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps a failed task comment available for an explicit retry', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/TaskPage.jsx'), 'utf8');
  expect(source).toContain('commentError');
  expect(source).toContain('Comment was not posted. Try again.');
  expect(source).toContain('addCommentMutation.mutate(commentError)');
});
