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
    expect(source).toContain('dismissLabel="Dismiss upload error"');
    // Portal controls are shared primitives (44px `min-h-11` targets); the
    // portal scope adds a 3px solid ring-token outline to every focusable
    // control (#316 convergence keeps the #305/#317 focus contract).
    expect(source).toContain('.cp-root :is(a, button, input, select, textarea, [tabindex]):focus-visible');
    expect(source).toContain('outline: 3px solid hsl(var(--ring))');
    expect(source).toContain('return <div className="cp-root">{content}</div>;');
    expect(source).toContain('min-height: 44px');
  });

  it('announces workflow action progress while requests are pending', () => {
    expect(source).toContain('aria-busy={submittingWorkflow || undefined}');
    expect(source).toContain('disabled={submittingWorkflow || !generalFeedback.trim()}');
  });
});
