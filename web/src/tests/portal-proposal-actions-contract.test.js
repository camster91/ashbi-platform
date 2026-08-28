import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/PortalProposal.jsx'), 'utf8');

describe('portal proposal actions accessibility contract', () => {
  it('keeps approval and decline actions native, touch-sized, and focus-visible', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('aria-busy={respondMutation.isPending}');
    expect(source).toContain('min-h-11');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('announces completed proposal responses', () => {
    expect(source).toContain('role="status" aria-live="polite"');
    expect(source).toContain('respondMutation.isError');
  });

  it('labels every client-facing amount with proposal currency evidence', () => {
    expect(source).toContain("const verifiedCurrency = ['CAD', 'USD'].includes(proposal.currency)");
    expect(source).toContain("currencyDisplay: 'code'");
    expect(source.match(/formatProposalAmount\(/g)?.length).toBeGreaterThanOrEqual(5);
    expect(source).toContain('Approval is unavailable because this proposal currency has not been verified.');
  });
});
