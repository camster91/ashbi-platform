import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Contracts.jsx'), 'utf8');

describe('contracts actions accessibility contract', () => {
  it('keeps create-form cancellation from submitting and names the AI result copy action', () => {
    expect(source).toContain('<Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>');
    expect(source).toContain('aria-label="Copy AI result to clipboard"');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('exposes state and entity names for contract controls', () => {
    expect(source).toContain('aria-expanded={isExpanded}');
    expect(source).toContain('aria-label={`${isExpanded ? \'Collapse\' : \'Expand\'} contract ${contract.title}`}');
    expect(source).toContain('aria-label={`Refine contract ${contract.title} with AI`}');
    expect(source).toContain('aria-label={`Copy signing link for ${contract.title}`}');
  });
});
