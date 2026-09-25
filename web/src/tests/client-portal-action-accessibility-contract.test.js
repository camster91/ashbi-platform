import { describe, expect, it } from 'vitest';
import { clientPortalSource } from './helpers/clientPortalSource';

const source = clientPortalSource();

describe('client portal action accessibility contract', () => {
  it('keeps overview and project navigation buttons native, named, and touch-sized', () => {
    expect(source).toContain('type="button" aria-label="View overdue invoices"');
    expect(source).toContain('type="button" aria-label="View all projects"');
    expect(source).toContain('type="button" aria-label="View all invoices"');
    expect(source).toContain('type="button" aria-label="Back to projects"');
    expect(source).toContain('type="button" aria-label="Log out of client portal"');
  });

  it('keeps document actions explicitly named and keyboard-visible', () => {
    expect(source).toContain('type="button" aria-label="Download invoice PDF"');
    expect(source).toContain('aria-label="Dismiss upload error"');
    expect(source).toContain('.cp-btn-primary:focus-visible');
    expect(source).toContain('.cp-btn-danger:focus-visible');
    expect(source).toContain('min-height: 44px');
  });

  it('announces workflow action progress while requests are pending', () => {
    expect(source).toContain('aria-busy={submittingWorkflow || undefined}');
    expect(source).toContain('disabled={submittingWorkflow || !generalFeedback.trim()}');
  });
});
