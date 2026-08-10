import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/components/GlobalAIChat.jsx'), 'utf8');

describe('global AI chat accessibility contract', () => {
  it('keeps the launcher and drawer named with explicit state', () => {
    expect(source).toContain('aria-expanded={isOpen}');
    expect(source).toContain('aria-controls="global-ai-chat-drawer"');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-labelledby="global-ai-chat-title"');
  });

  it('keeps chat controls touch-sized, focus-visible, and pending-aware', () => {
    expect(source).toContain('min-h-11 min-w-11');
    expect(source).toContain('aria-label="Ask Ash about your work"');
    expect(source).toContain('aria-busy={isLoading}');
    expect(source).toContain('focus-visible:outline-none focus-visible:ring-2');
  });
});
