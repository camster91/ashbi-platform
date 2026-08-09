import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/CommandCenter.jsx'), 'utf8');

describe('Command Center primitive contract', () => {
  it('adapts status badges to the shared primitive instead of duplicating styles', () => {
    expect(source).toContain("import SharedBadge from '../components/ui/Badge'");
    expect(source).toContain('<SharedBadge variant="subtle"');
    expect(source).not.toMatch(/function Badge\(/);
  });

  it('names health dots and collapse controls without relying on colour', () => {
    expect(source).toContain('aria-label={`${labels[health] || labels.unknown} status`}');
    expect(source).toContain("role=\"img\"");
    expect(source).toContain("aria-expanded={!collapsed}");
    expect(source).toContain("min-h-11 min-w-11");
  });

  it('keeps progress understandable when motion is reduced', () => {
    expect(source).toContain('motion-reduce:animate-none');
    expect(source).toContain('<span className="sr-only">Refreshing {title}</span>');
  });
});
