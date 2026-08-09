import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(testDirectory, '..');

function readPage(name) {
  return fs.readFileSync(path.join(sourceRoot, 'pages', name), 'utf8');
}

describe('manual request failure contract', () => {
  it('Chat distinguishes failed conversation and message loads from empty results', () => {
    const source = readPage('Chat.jsx');

    expect(source).toContain("import QueryErrorState from '../components/QueryErrorState'");
    expect(source).toContain('conversationError');
    expect(source).toContain('messageError');
    expect(source).toContain('onRetry={loadConversations}');
    expect(source).toContain('onRetry={() => loadMessages(activeId)}');
  });

  it('Chat exposes separate named controls for opening and deleting a conversation', () => {
    const source = readPage('Chat.jsx');

    expect(source).not.toContain('<button\n                        key={c.id}');
    expect(source).toContain('aria-label={`Delete ${c.title}`}');
    expect(source).toContain('onClick={() => loadMessages(c.id)}');
  });

  it('Trash distinguishes a failed load from an empty trash', () => {
    const source = readPage('Trash.jsx');

    expect(source).toContain("import QueryErrorState from '../components/QueryErrorState'");
    expect(source).toContain('loadError');
    expect(source).toContain('onRetry={loadTrash}');
    expect(source).toMatch(/!loading\s*&&\s*!loadError\s*&&\s*filtered\.length === 0/);
  });
});
