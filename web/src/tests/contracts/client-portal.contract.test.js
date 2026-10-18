import { describe, expect, it } from 'vitest';
import { clientPortalSource } from '../helpers/clientPortalSource';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Signed-in client portal source contracts. The invoice-pay checks guard
// money and security: keep them word for word.

describe('client-portal-action-accessibility-contract.test.js', () => {
  const source = clientPortalSource();

  describe('client portal action accessibility contract', () => {
    it('keeps overview and project navigation buttons native, named, and touch-sized', () => {
      expect(source).toContain('View invoices &rarr;{\' \'}<span className="sr-only">that are overdue</span>');
      expect(source).toContain('type="button" aria-label="View all projects"');
      expect(source).toContain('type="button" aria-label="View all invoices"');
      expect(source).toContain('type="button" aria-label="Back to projects"');
      expect(source).toContain('Logout{\' \'}<span className="sr-only">of client portal</span>');
    });

    it('keeps document actions explicitly named and keyboard-visible', () => {
      expect(source).toContain('Download PDF{\' \'}<span className="sr-only">for this invoice</span>');
      expect(source).toContain('dismissLabel="Dismiss upload error"');
      // Portal controls are shared primitives (44px `min-h-11` targets); the
      // portal scope adds a 3px solid ring-token outline to every focusable
      // control (#316 convergence keeps the #305/#317 focus contract).
      expect(source).toContain('.cp-root :is(a, button, input, select, textarea, [tabindex]):focus-visible');
      expect(source).toContain('outline: 3px solid hsl(var(--ring))');
      expect(source).toContain('className="cp-root"');
      expect(source).toContain('min-height: 44px');
    });

    it('announces workflow action progress while requests are pending', () => {
      expect(source).toContain('aria-busy={submittingWorkflow || undefined}');
      expect(source).toContain('disabled={submittingWorkflow || !generalFeedback.trim()}');
    });
  });
});

describe('client-portal-chat-recovery-contract.test.js', () => {
  const source = clientPortalSource();

  describe('client portal chat recovery', () => {
    it('preserves an unsent message and announces a recoverable failure in both chat surfaces', () => {
      expect(source).toContain('const [sendError, setSendError] = useState(\'\');');
      expect(source).toContain('const [sending, setSending] = useState(false);');
      expect(source).toContain('throw new Error(');
      expect(source).toContain('setChatInput(\'\');');
      expect(source).toContain('setInput(\'\');');
      expect(source).toContain("role=\"alert\"");
      // Send needs text or an uploaded file (docs/chat-media.md), never while sending.
      expect(source).toContain('disabled={!canSendPortalMessage(value, attachments) || sending}');
      expect(source).toContain("return Boolean(text.trim()) || (attachments?.readyIds.length ?? 0) > 0;");
    });

    it('does not present a failed chat history request as an empty conversation', () => {
      expect(source).toContain('const [messagesError, setMessagesError] = useState(\'\');');
      expect(source).toContain('const [loadingMessages, setLoadingMessages] = useState(false);');
      expect(source).toContain('Chat messages could not be loaded. Try again.');
      expect(source).toContain('onClick={reloadMessages}');
    });
  });
});

describe('client-portal-invoice-pay-contract.test.js', () => {
  const source = clientPortalSource();

  // H10/H12: the portal never offers to pay a draft or void invoice, and Pay
  // always opens the public invoice page (which starts a fresh Stripe Checkout
  // session) instead of a stored Checkout URL that expires within 24 hours.
  describe('client portal invoice pay contract', () => {
    it('only offers Pay for sent, viewed or overdue invoices with a server-issued pay link', () => {
      expect(source).toContain('UNPAID_INVOICE_STATUSES.includes(inv.status?.toUpperCase()) && Boolean(inv.payUrl)');
      expect(source).not.toMatch(/canPay[^\n]*DRAFT/);
      expect(source).toContain('href={inv.payUrl}');
    });

    it('never links to a stored Stripe Checkout URL', () => {
      expect(source).not.toContain('stripePaymentLink');
    });
  });
});

describe('client-portal-navigation-accessibility-contract.test.js', () => {
  const source = clientPortalSource();

  describe('client portal navigation accessibility contract', () => {
    it('exposes selected state and keyboard-visible focus for project detail tabs', () => {
      expect(source).toContain('role="tablist"');
      expect(source).toContain('role="tab"');
      expect(source).toContain('aria-selected={activeView === tab.id}');
      expect(source).toContain('className="cp-tab"');
    });

    it('exposes selected state for the portal-level tabs', () => {
      expect(source).toContain('aria-selected={activeTab === tab.id}');
      expect(source).toContain('aria-label="Portal sections"');
      expect(source).toContain('type="button"');
    });
  });
});

describe('portal-contract-download-contract.test.js', () => {
  const source = clientPortalSource();

  describe('client portal signed contract download contract', () => {
    it('downloads signed contracts through the session-scoped portal route', () => {
      expect(source).toContain('/api/client-portal/contracts/${contract.id}/pdf');
      expect(source).toContain('<ContractsTab contracts={contracts} token={token} />');
    });

    it('only offers the download for contracts the API marks downloadable', () => {
      expect(source).toContain('{contract.canDownload && (');
      expect(source).toContain('<span className="sr-only">for signed contract {contract.title}</span>');
    });

    it('announces download failures and pending state', () => {
      expect(source).toContain('The signed contract could not be downloaded.');
      expect(source).toContain('aria-busy={downloadingId === contract.id || undefined}');
    });
  });
});

describe('portal-document-delete-contract.test.js', () => {
  const source = clientPortalSource();

  describe('client portal document deletion contract', () => {
    it('uses a shared accessible confirmation in both document surfaces', () => {
      expect(source).toContain("import ConfirmDialog from '../../components/ConfirmDialog'");
      expect(source.match(/<ConfirmDialog/g)).toHaveLength(2);
      expect(source.match(/Permanently delete .*This removes the file from the client portal and cannot be undone\./g)).toHaveLength(2);
    });

    it('names the selected document and guards duplicate deletion requests', () => {
      expect(source.match(/documentToDelete/g).length).toBeGreaterThanOrEqual(10);
      expect(source.match(/pending=\{deletingDocument\}/g)).toHaveLength(2);
      // Both surfaces render the shared PortalDocumentList, which disables every
      // delete trigger while a deletion is pending.
      expect(source.match(/deleting=\{deletingDocument\}/g)).toHaveLength(2);
      expect(source.match(/disabled=\{deleting\}/g)).toHaveLength(1);
    });

    it('keeps delete failures in the open dialog instead of reporting success', () => {
      expect(source.match(/deleteError/g).length).toBeGreaterThanOrEqual(4);
      expect(source.match(/error=\{deleteError\}/g)).toHaveLength(2);
      expect(source).not.toContain('onClick={() => handleDeleteDoc(doc.id)}');
    });
  });
});

describe('portal-control-accessibility.test.js', () => {
  const portal = clientPortalSource();
  const layout = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');
  const intake = readFileSync(resolve(process.cwd(), 'src/pages/PortalIntakeForm.jsx'), 'utf8');
  const proposal = readFileSync(resolve(process.cwd(), 'src/pages/PortalProposal.jsx'), 'utf8');
  const contract = readFileSync(resolve(process.cwd(), 'src/pages/PortalContract.jsx'), 'utf8');
  const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');

  describe('critical portal and shell control semantics', () => {
    it('uses native upload buttons and named file inputs instead of clickable divs', () => {
      expect(portal).not.toMatch(/<div\s+className="cp-upload-zone"/);
      // One shared PortalUploadZone renders the native button; count the render
      // sites so neither the Documents tab nor the project view can drop it.
      expect(portal.match(/<button\s+type="button"\s+className="cp-upload-zone"/g)).toHaveLength(1);
      expect(portal.match(/<PortalUploadZone\b/g)).toHaveLength(2);
      expect(portal).toContain('aria-label={inputLabel}');
      expect(portal).toContain('inputLabel="Choose project documents to upload"');
      expect(portal).toContain('inputLabel="Choose documents to upload"');
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
      expect(portal.match(/aria-label=\{sending \? 'Sending message' : 'Send message'\}/g)).toHaveLength(1);
      expect(portal.match(/aria-label={`Delete \${doc\.originalName}`}/g)).toHaveLength(1);
      expect(portal.match(/<PortalDocumentList\b/g)).toHaveLength(2);
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
});
