import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps a failed project-chat message available for an explicit retry', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/ProjectChat.jsx'), 'utf8');
  expect(source).toContain('sendError');
  expect(source).toContain('onClick={() => sendMutation.mutate(message.trim())}');
  expect(source).toContain('Message not sent. Try again.');
});
