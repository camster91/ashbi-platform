import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../routes/task.routes.js', import.meta.url), 'utf8');

test('every authenticated task data access uses the request-scoped tenant client', () => {
  assert.doesNotMatch(source, /fastify\.prisma/);
  assert.match(source, /request\.prisma\.task\.findMany/);
  assert.match(source, /request\.prisma\.task\.update/);
  assert.match(source, /request\.prisma\.task\.create/);
});

test('task page defaults contain valid user-facing symbols instead of mojibake', () => {
  assert.doesNotMatch(source, /Ã|â€œ|â€ž|Å¸|Å“|ðŸ/);
  assert.match(source, /'📄'/u);
  assert.match(source, /'📁'/u);
  assert.match(source, /'✓'/u);
});
