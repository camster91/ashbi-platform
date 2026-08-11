import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('project chat mutations bind message IDs to the requested project', async () => {
  const source = await readFile(new URL('../../routes/chat.routes.js', import.meta.url), 'utf8');
  assert.match(source, /chatMessage\.findFirst\(\{ where: \{ id: messageId, projectId \} \}\)/);
  assert.match(source, /Project not found/);
  assert.match(source, /Message not found/);
});
