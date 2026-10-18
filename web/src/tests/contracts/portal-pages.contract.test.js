import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Public portal pages (booking, contract, estimate, intake, invoice,
// proposal): native buttons, busy state and alerts on every action.

describe('portal-booking-actions-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/PortalBooking.jsx'), 'utf8');

  describe('portal booking actions accessibility contract', () => {
    it('keeps calendar, slot, and submission controls touch-sized and focus-visible', () => {
      expect(source).toContain('aria-label={`Previous month');
      expect(source).toContain('aria-label={`Next month');
      expect(source).toContain('aria-busy={bookMutation.isPending}');
      expect(source).toContain('min-h-11');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('announces booking confirmation and preserves mutation errors', () => {
      expect(source).toContain('role="status" aria-live="polite"');
      expect(source).toContain('role="alert"');
      expect(source).toContain('bookMutation.isError');
    });
  });
});

describe('portal-contract-actions-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/PortalContract.jsx'), 'utf8');

  describe('portal contract signing accessibility contract', () => {
    it('keeps signature mode and clear controls touch-sized and focus-visible', () => {
      expect(source).toContain('aria-label="Clear drawn signature"');
      expect(source).toContain('aria-pressed={signatureMode ===');
      expect(source).toContain('min-h-11');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('exposes pending state for the legally consequential sign action', () => {
      expect(source).toContain('type="button"');
      expect(source).toContain('aria-busy={signMutation.isPending}');
      expect(source).toContain('<p role="alert"');
      expect(source).toContain('role="status" aria-live="polite"');
    });
  });
});

describe('portal-estimate-actions-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/PortalEstimate.jsx'), 'utf8');

  describe('portal estimate actions accessibility contract', () => {
    it('keeps response actions native, touch-sized, and pending-aware', () => {
      expect(source).toContain('type="button"');
      expect(source).toContain('aria-busy={respondMutation.isPending}');
      expect(source).toContain('min-h-11');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('labels decline feedback and announces validation and mutation failures', () => {
      expect(source).toContain('htmlFor="estimate-decline-reason"');
      expect(source).toContain('aria-invalid={Boolean(declineError)}');
      expect(source).toContain('id="estimate-decline-reason-error" role="alert"');
      expect(source).toContain('role="status" aria-live="polite"');
    });
  });
});

describe('portal-intake-actions-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/PortalIntakeForm.jsx'), 'utf8');

  describe('public intake action contract', () => {
    it('keeps submit state observable and touch-friendly', () => {
      expect(source).toContain('aria-busy={submitMutation.isPending}');
      expect(source).toContain('disabled={submitMutation.isPending}');
      expect(source).toContain('w-full min-h-11 py-3 px-4');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('preserves validation and recovery announcements', () => {
      expect(source).toContain('role="alert"');
      expect(source).toContain('requestAnimationFrame(() => summaryRef.current?.focus())');
      expect(source).toContain("submitMutation.error?.message || 'Failed to submit. Please try again.'");
    });
  });
});

describe('portal-invoice-actions-contract.test.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/PortalInvoice.jsx'), 'utf8');

  describe('portal invoice payment accessibility contract', () => {
    it('keeps payment initiation native, touch-sized, and pending-aware', () => {
      expect(source).toContain('type="button"');
      expect(source).toContain('aria-busy={payMutation.isPending}');
      expect(source).toContain('min-h-11');
      expect(source).toContain('focus-visible:ring-2');
    });

    it('announces paid status and payment failures', () => {
      expect(source).toContain('role="status" aria-live="polite"');
      expect(source).toContain('<p role="alert"');
    });
  });
});

describe('portal-proposal-actions-contract.test.js', () => {
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
  });
});

describe('portal-estimate-response-contract.test.js', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/pages/PortalEstimate.jsx'), 'utf8');

  describe('portal estimate response workflow', () => {
    it('submits the selected action and records the matching completion state', () => {
      expect(page).toContain("mutationFn: (action) => api.approveEstimateByToken(viewToken, action)");
      expect(page).toContain("setCompleted(action === 'approve' ? 'approved' : 'declined')");
      expect(page).toContain("respondMutation.mutate('approve')");
      expect(page).toContain("respondMutation.mutate('decline')");
    });
  });
});
