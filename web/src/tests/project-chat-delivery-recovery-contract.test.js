import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps a failed project-chat message available for an explicit retry', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/ProjectChat.jsx'), 'utf8');
  expect(source).toContain('sendError');
  expect(source).toContain('onClick={sendCurrent}');
  expect(source).toContain('Message not sent. Try again.');
});

// Chat media (docs/chat-media.md): files upload before the message is sent and
// the send claims them atomically, so a failed send never leaves a message
// without its files; the text and uploaded files stay in the composer (the
// draft is cleared only on success) and "Try again" resends both.
it('sends uploaded files with the message and clears them only after a successful send', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/ProjectChat.jsx'), 'utf8');
  expect(source).toContain('api.uploadChatFile(projectId, file, options)');
  expect(source).toContain('attachmentIds.length ? { content, visibility, attachmentIds } : { content, visibility }');
  const onSuccess = source.slice(source.indexOf('onSuccess: (created'), source.indexOf('onError: (error)'));
  expect(onSuccess.indexOf('onSuccess')).toBe(0);
  // Only the files that were sent leave the tray (one added mid-send stays).
  expect(onSuccess).toContain('draft.clear(attachmentIds)');
  expect(source.slice(source.indexOf('onError: (error)'), source.indexOf('const canSend'))).not.toContain('draft.clear(');
  expect(source).not.toContain("api.uploadAttachment(retryAttachment, 'CHAT', messageId)");
});
