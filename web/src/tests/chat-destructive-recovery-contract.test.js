import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Chat.jsx'), 'utf8');

describe('Ash chat destructive recovery contract', () => {
  it('requires an accessible shared confirmation before permanent deletion', () => {
    expect(source).toContain("import ConfirmDialog from '../components/ConfirmDialog'");
    expect(source).toContain('conversationToDelete');
    expect(source).toContain('<ConfirmDialog');
    expect(source).toContain('This permanently removes the conversation and its messages. This cannot be undone.');
  });

  it('keeps mutation errors visible and prevents duplicate deletion', () => {
    expect(source).toContain('deleteConversationMutation');
    expect(source).toContain('pending={deleteConversationMutation.isPending}');
    expect(source).toContain('error={deleteConversationMutation.error?.message}');
    expect(source).toContain('disabled={deleteConversationMutation.isPending}');
  });

  it('names the new-chat, message, and send controls', () => {
    expect(source).toContain('aria-label="Start a new conversation"');
    expect(source).toContain('aria-label="Message Ash"');
    expect(source).toContain('aria-label="Send message to Ash"');
  });
});
