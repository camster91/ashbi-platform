import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps a failed project-chat message available for an explicit retry', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/ProjectChat.jsx'), 'utf8');
  expect(source).toContain('sendError');
  expect(source).toContain('attachmentRetry ? uploadMutation.mutate(attachmentRetry) : sendMutation.mutate(message.trim())');
  expect(source).toContain('Message not sent. Try again.');
});

it('retries a failed attachment against its existing message instead of resending text', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/ProjectChat.jsx'), 'utf8');
  expect(source).toContain('attachmentRetry');
  expect(source).toContain("api.uploadAttachment(retryAttachment, 'CHAT', messageId)");
});
