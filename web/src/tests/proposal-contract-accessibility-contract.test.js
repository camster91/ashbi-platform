import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const proposals = readFileSync(resolve(process.cwd(), 'src/pages/Proposals.jsx'), 'utf8');
const contracts = readFileSync(resolve(process.cwd(), 'src/pages/Contracts.jsx'), 'utf8');

describe('proposal and contract accessibility contract', () => {
  it('keeps proposal actions explicit, named, and focus-visible', () => {
    expect(proposals).toContain('type="button"');
    expect(proposals).toContain('aria-pressed={filterStatus === s}');
    expect(proposals).toContain('aria-label="Close proposal generator"');
    expect(proposals).toContain('focus-visible:ring-2');
  });

  it('keeps contract filters and proposal picker keyboard-safe', () => {
    expect(contracts).toContain('aria-pressed={filterStatus === s}');
    expect(contracts).toContain('type="button"');
    expect(contracts).toContain('focus-visible:outline-none');
    expect(contracts).toContain('min-h-11');
  });
});
