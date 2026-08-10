import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const automations = readFileSync(resolve(process.cwd(), 'src/pages/Automations.jsx'), 'utf8');
const approvals = readFileSync(resolve(process.cwd(), 'src/pages/ApprovalQueue.jsx'), 'utf8');

describe('automation and approval actions accessibility contract', () => {
  it('keeps automation pagination named, typed, focused, and touch-sized', () => {
    expect(automations).toContain('aria-label="Previous automation page"');
    expect(automations).toContain('aria-label="Next automation page"');
    expect(automations).toContain('min-h-11 min-w-11');
    expect(automations).toContain('focus-visible:ring-2');
  });

  it('names approval selection controls and exposes their state', () => {
    expect(approvals).toContain('type="button"');
    expect(approvals).toContain('aria-label={`');
    expect(approvals).toContain('aria-expanded={isSelected}');
    expect(approvals).toContain('focus-visible:ring-2');
  });
});
