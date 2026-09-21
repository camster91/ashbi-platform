import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portal = readFileSync(resolve(process.cwd(), 'src/pages/ClientPortal.jsx'), 'utf8');
const layout = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');
const intake = readFileSync(resolve(process.cwd(), 'src/pages/PortalIntakeForm.jsx'), 'utf8');
const proposal = readFileSync(resolve(process.cwd(), 'src/pages/PortalProposal.jsx'), 'utf8');
const contract = readFileSync(resolve(process.cwd(), 'src/pages/PortalContract.jsx'), 'utf8');
const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');

describe('critical portal and shell control semantics', () => {
  it('uses native upload buttons and named file inputs instead of clickable divs', () => {
    expect(portal).not.toMatch(/<div\s+className="cp-upload-zone"/);
    expect(portal.match(/<button\s+type="button"\s+className="cp-upload-zone"/g)).toHaveLength(2);
    expect(portal).toContain('aria-label="Choose project documents to upload"');
    expect(portal).toContain('aria-label="Choose documents to upload"');
  });

  it('exchanges URL magic tokens for an httpOnly-cookie session and supports real logout', () => {
    expect(app).toContain('path="/client-portal/verify"');
    expect(portal).toContain("portalFetch('/api/client-portal/verify-token'");
    expect(portal).toContain("window.history.replaceState({}, '', '/client-portal')");
    expect(portal).toContain("portalFetch('/api/client-portal/logout'");
    expect(portal).not.toContain('/pdf?token=');
  });

  it('names chat fields, send actions, delete actions, and connection status', () => {
    expect(portal).toContain('<label htmlFor="client-portal-email"');
    expect(portal).toContain('id="client-portal-login-error" role="alert"');
    // The chat composer is a single shared PortalChatComposer component rendered
    // from both the project-detail panel and the Chat tab, so its labels appear
    // once in source. Count the render sites, not the literals, so a future
    // de-duplication cannot quietly drop a surface.
    expect(portal.match(/<PortalChatComposer\b/g)).toHaveLength(2);
    expect(portal.match(/aria-label="Message to project team"/g)).toHaveLength(1);
    expect(portal.match(/aria-label="Send message"/g)).toHaveLength(1);
    expect(portal.match(/aria-label={`Delete \${doc\.originalName}`}/g)).toHaveLength(2);
    expect(portal.match(/role="status" aria-live="polite"/g).length).toBeGreaterThanOrEqual(2);
    expect(portal).toContain('aria-label="Project for chat"');
    expect(portal).toContain('aria-label="Project for documents"');
  });

  it('names every cited mobile and collapse navigation control', () => {
    for (const name of ['Collapse sidebar', 'Expand sidebar', 'Close navigation menu', 'Open navigation menu', 'Settings', 'Logout']) {
      expect(layout).toContain(`aria-label="${name}"`);
    }
  });

  it('associates public intake and decline labels and announces submission errors', () => {
    expect(intake).toContain('htmlFor="respondent-name"');
    expect(intake).toContain('htmlFor="respondent-email"');
    expect(intake).toContain('htmlFor={`intake-field-${i}`}');
    expect(intake).toContain('<div role="alert"');
    expect(intake).toContain('aria-invalid={!!validationErrors.name}');
    expect(intake).toContain('ref={summaryRef} tabIndex={-1} role="alert"');
    expect(proposal).toContain('htmlFor="decline-reason"');
    expect(proposal).toContain('<p role="alert"');
    expect(proposal).toContain('ref={declineRef}');
  });

  it('exposes signature instructions and selected method to assistive technology', () => {
    expect(contract).toContain('role="img"');
    expect(contract).toContain('aria-label="Signature drawing area.');
    expect(contract).toContain('role="group" aria-label="Signature method"');
    expect(contract.match(/aria-pressed=\{signatureMode ===/g)).toHaveLength(2);
    expect(contract).toContain('<p role="alert"');
    expect(contract).toContain('ref={signerRef}');
    expect(contract).toContain('aria-label="Typed signature preview"');
  });
});
