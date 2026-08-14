import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderMarkdown } from '../lib/markdown';

const docs = readFileSync(resolve(process.cwd(), 'src/pages/Docs.jsx'), 'utf8');
const project = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');

describe('renderMarkdown', () => {
  it('renders the supported document subset while treating source HTML as text', () => {
    const html = renderMarkdown('# Project brief\n\n**Approved** with `scope`.\n\n- First item\n- Second item\n\n[Open brief](https://example.test/brief)\n\n<img src=x onerror=alert(1)>');

    expect(html).toContain('<h1');
    expect(html).toContain('<strong>Approved</strong>');
    expect(html).toContain('<code');
    expect(html).toContain('<ul');
    expect(html).toContain('href="https://example.test/brief"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
  });

  it('preserves paragraphs and never emits an unsafe URL scheme', () => {
    const html = renderMarkdown('One line\nsecond line\n\n[Bad](javascript:alert(1))');

    expect(html).toContain('One line<br>second line');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('[Bad](javascript:alert(1))');
  });

  it('uses the same sanitized renderer in the global and project document views', () => {
    expect(docs).toContain("import { renderMarkdown } from '../lib/markdown'");
    expect(project).toContain("import { renderMarkdown } from '../lib/markdown'");
    expect(docs).toContain('dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}');
    expect(project).toContain('dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}');
  });
});
