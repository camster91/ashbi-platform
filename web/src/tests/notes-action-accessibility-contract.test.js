import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const project = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');
const docs = readFileSync(resolve(process.cwd(), 'src/pages/Docs.jsx'), 'utf8');

describe('notes action accessibility contract', () => {
  it.each([
    ['Project Notes', project],
    ['Docs NoteCard', docs],
  ])('%s gives every icon action a named 44px keyboard target', (_surface, source) => {
    expect(source).toContain("aria-label={`${note.isPinned ? 'Unpin' : 'Pin'} ${note.title}`}");
    expect(source).toContain('aria-label={`Edit ${note.title}`}');
    expect(source).toContain('aria-label={`Delete ${note.title}`}');
    expect(source).toContain('min-h-11 min-w-11');
    expect(source).toContain('focus-visible:ring-2');
  });
});
