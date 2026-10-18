import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('command center import claim', () => {
  it('does not present an unavailable Notion sync as a working action', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/CommandCenter.jsx'), 'utf8');
    expect(source).not.toContain('Sync Notion');
    expect(source).toContain("window.location.href = '/docs'");
  });
});
