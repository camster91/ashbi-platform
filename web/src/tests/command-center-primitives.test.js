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

  it('gives command actions named native touch targets', () => {
    expect(source).toContain('aria-label="Refresh GitHub panel"');
    expect(source).toContain('aria-label="Refresh VPS panel"');
    expect(source).toContain('aria-label="Refresh Hostinger Sites panel"');
    expect(source).toContain('aria-label="Refresh AI Agents panel"');
    expect(source).toContain('aria-label={`Restart ${app.name}`}');
    expect(source).toContain('aria-label={`Run ${agent.displayName}`}');
    expect(source).toContain('aria-label="Refresh all command center panels"');
    expect(source).toContain('type="button"');
    expect(source).toContain('min-h-11 min-w-11');
  });

  it('makes today task navigation keyboard-operable and descriptive', () => {
    expect(source).toContain('aria-label={`Open task ${task.title}`}');
    expect(source).toContain('className="flex min-h-11 w-full items-start justify-between');
    expect(source).toContain('focus-visible:ring-2');
  });
});
