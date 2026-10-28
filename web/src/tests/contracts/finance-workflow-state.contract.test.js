import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Loading, error, retry and empty states on finance and operations pages.
// Money area: merge only, never weaken.

describe('finance-list-workflow-state-contract.test.js', () => {
  const readPage = (name) => readFileSync(resolve(process.cwd(), `src/pages/${name}.jsx`), 'utf8');

  describe.each(['Estimates', 'Expenses'])('%s list workflow state', (pageName) => {
    const source = readPage(pageName);
    const prefix = pageName.toLowerCase();

    it('imports the shared typed query recovery state', () => {
      expect(source).toContain("import QueryErrorState from '../components/QueryErrorState';");
    });

    it('tracks request failure, retry, and retry progress', () => {
      expect(source).toContain(`${prefix}Error`);
      expect(source).toContain(`refetch${pageName}`);
      expect(source).toContain(`${prefix}Fetching`);
    });

    it('renders request failure before the legitimate empty state', () => {
      expect(source).toMatch(new RegExp(`${prefix}Error\\s*\\?\\s*\\([\\s\\S]*<QueryErrorState[\\s\\S]*length === 0`));
    });
  });
});

describe('operations-workflow-state-contract.test.js', () => {
  const team = readFileSync(resolve(process.cwd(), 'src/pages/Team.jsx'), 'utf8');
  const retainers = readFileSync(resolve(process.cwd(), 'src/pages/Retainers.jsx'), 'utf8');

  describe('team workflow states', () => {
    it('distinguishes a team request failure from an empty member list', () => {
      expect(team).toContain("import QueryErrorState from '../components/QueryErrorState';");
      expect(team).toContain('teamError');
      expect(team).toContain('refetchTeam');
      expect(team).toMatch(/if \(teamError\)[\s\S]*<QueryErrorState/);
    });

    it('shows partial workload and allocation failures with retries', () => {
      for (const token of ['workloadError', 'refetchWorkload', 'allocationsError', 'refetchAllocations']) {
        expect(team).toContain(token);
      }
      expect(team.match(/<QueryErrorState/g)?.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('retainer workflow states', () => {
    it('distinguishes a request failure from no retainer plans', () => {
      expect(retainers).toContain("import QueryErrorState from '../components/QueryErrorState';");
      expect(retainers).toContain('retainersError');
      expect(retainers).toContain('retainersFetching');
      expect(retainers).toMatch(/retainersError\s*\?\s*\([\s\S]*<QueryErrorState[\s\S]*allRetainers\.length === 0/);
    });
  });
});

describe('remaining-query-state-contract.test.js', () => {
  const readPage = (name) => readFileSync(resolve(process.cwd(), `src/pages/${name}.jsx`), 'utf8');

  describe('remaining collection and settings query states', () => {
    it.each([
      ['AiContextSettings', 'contextError', 'refetchContext'],
      ['BrandSettings', 'brandError', 'refetchBrand'],
      ['InvoiceChaser', 'invoicesError', 'refetchInvoices'],
    ])('%s exposes a request failure and retry', (name, errorToken, retryToken) => {
      const page = readPage(name);
      expect(page).toContain("import QueryErrorState from '../components/QueryErrorState';");
      expect(page).toContain(errorToken);
      expect(page).toContain(retryToken);
      expect(page).toContain('<QueryErrorState');
    });

    it('does not present a portal transport failure as an invalid link', () => {
      const portal = readPage('Portal');
      expect(portal).toContain('isError: portalError');
      expect(portal).toContain('refetch: refetchPortal');
      expect(portal).toContain('portalNotFound');
      expect(portal).toMatch(/portalError && !portalNotFound[\s\S]*Retry/);
    });
  });
});

describe('revenue-detail-state-contract.test.js', () => {
  const invoice = readFileSync(resolve(process.cwd(), 'src/pages/InvoiceDetail.jsx'), 'utf8');
  const proposal = readFileSync(resolve(process.cwd(), 'src/pages/ProposalDetail.jsx'), 'utf8');

  describe('revenue detail workflow states', () => {
    it.each([
      ['invoice', invoice, 'invoiceError', 'refetchInvoice'],
      ['proposal', proposal, 'proposalError', 'refetchProposal'],
    ])('distinguishes a %s request failure from a missing record', (_name, page, errorToken, retryToken) => {
      expect(page).toContain("import QueryErrorState from '../components/QueryErrorState';");
      expect(page).toContain(errorToken);
      expect(page).toContain(retryToken);
      expect(page).toMatch(new RegExp(`if \\(${errorToken}\\)[\\s\\S]*<QueryErrorState[\\s\\S]*if \\(!`));
    });

    it('makes invoice payment history failures visible and retryable', () => {
      for (const token of ['paymentsError', 'refetchPayments', 'paymentsFetching']) {
        expect(invoice).toContain(token);
      }
      expect(invoice).toMatch(/Payment history[\s\S]*paymentsError[\s\S]*<QueryErrorState/);
    });

    it('guards proposal-to-contract generation with explicit mutation state', () => {
      expect(proposal).toContain('const generateContractMutation = useMutation({');
      expect(proposal).toContain("onError: (error) => toast.error('Failed to generate contract', error.message)");
      expect(proposal).toContain('onClick={() => generateContractMutation.mutate()}');
      expect(proposal).toContain('loading={generateContractMutation.isPending}');
    });

    it('guards proposal-to-invoice generation with explicit mutation state', () => {
      expect(proposal).toContain('const createInvoiceMutation = useMutation({');
      expect(proposal).toContain("onError: (error) => toast.error('Failed to create invoice', error.message)");
      expect(proposal).toContain('onClick={() => createInvoiceMutation.mutate()}');
      expect(proposal).toContain('loading={createInvoiceMutation.isPending}');
    });
  });
});

describe('revenue-workflow-state-contract.test.js', () => {
  const pipeline = readFileSync(resolve(process.cwd(), 'src/pages/Pipeline.jsx'), 'utf8');
  const proposals = readFileSync(resolve(process.cwd(), 'src/pages/Proposals.jsx'), 'utf8');

  describe('revenue workflow states', () => {
    it('distinguishes a pipeline request failure from an empty funnel', () => {
      expect(pipeline).toContain("import QueryErrorState from '../components/QueryErrorState';");
      expect(pipeline).toContain('pipelineError');
      expect(pipeline).toContain('refetchPipeline');
      expect(pipeline).toMatch(/if \(pipelineError\)[\s\S]*<QueryErrorState/);
    });

    it('distinguishes a proposal request failure from an empty proposal list', () => {
      expect(proposals).toContain("import QueryErrorState from '../components/QueryErrorState';");
      expect(proposals).toContain('proposalsError');
      expect(proposals).toContain('refetchProposals');
      expect(proposals).toMatch(/proposalsError\s*\?\s*\([\s\S]*<QueryErrorState[\s\S]*proposals\.length === 0/);
    });
  });
});

describe('invoice payment dialog contract', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/InvoiceDetail.jsx'), 'utf8');
  it('uses the shared focus-managed modal and blocks dismissal during an uncertain write', () => {
    expect(source).toContain("import Modal, { ModalFooter } from '../components/Modal'");
    expect(source).toContain('isOpen={showMarkPaid}');
    expect(source).toContain('if (markPaidMutation.isPending) return;');
    expect(source).not.toContain('className="fixed inset-0 z-50 flex items-center justify-center bg-black/40');
  });

  it('associates every payment field with a label', () => {
    expect(source).toContain('htmlFor="invoice-payment-method"');
    expect(source).toContain('id="invoice-payment-method"');
    expect(source).toContain('htmlFor="invoice-payment-transaction"');
    expect(source).toContain('id="invoice-payment-transaction"');
    expect(source).toContain('htmlFor="invoice-payment-notes"');
    expect(source).toContain('id="invoice-payment-notes"');
  });

  it('announces failures, preserves input, and prevents duplicate submission', () => {
    expect(source).toContain('markPaidMutation.error');
    expect(source).toContain('role="alert"');
    expect(source).toContain('disabled={markPaidMutation.isPending}');
    expect(source).toContain('Marking as paid…');
  });
});

describe('Asset Library workflow contract', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/AssetLibrary.jsx'), 'utf8');
  it('removes the fake guidelines save and routes admins to the real editor', () => {
    expect(source).not.toContain('Save Guidelines');
    expect(source).not.toContain('setGuidelines');
    expect(source).toContain("navigate('/admin/brand')");
    expect(source).toContain("user?.role !== 'ADMIN'");
  });

  it('uses a shared upload dialog and recoverable asset loading', () => {
    expect(source).toContain("import Modal, { ModalFooter } from '../components/Modal'");
    expect(source).toContain('isOpen={showUpload}');
    expect(source).not.toContain('role="button" tabIndex={0}');
    expect(source).toContain('assetsError');
    expect(source).toContain('message="Failed to load assets"');
  });

  it('preserves upload failures and hardens deletion controls', () => {
    expect(source).toContain('if (createMutation.isPending) return;');
    expect(source).toContain('createMutation.error');
    expect(source).toContain('deleteMutation.error');
    expect(source).toContain('aria-label={`Delete asset ${asset.name}`}');
    expect(source).toContain('disabled={deleteMutation.isPending}');
    expect(source).toContain('min-h-11 min-w-11');
  });
});

describe('Rate Card workflow contract', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/RateCards.jsx'), 'utf8');
  it('uses shared dialogs and the actual Button loading API', () => {
    expect(source).toContain("import Modal, { ModalFooter } from '../components/Modal'");
    expect(source.match(/<Modal\b/g)).toHaveLength(2);
    expect(source).not.toContain('className="fixed inset-0');
    expect(source).not.toMatch(/<Button\b[^>]*\bisLoading=/);
    expect(source).toContain('loading={isLoading}');
  });

  it('distinguishes rate-card and client request failures from empty data', () => {
    expect(source).toContain('rateCardsError');
    expect(source).toContain('message="Failed to load rate cards"');
    expect(source).toContain('refetchRateCards');
    expect(source).toContain('clientsError');
    expect(source).toContain('message="Failed to load clients"');
    expect(source).toContain('refetchClients');
  });

  it('keeps pending writes open and exposes failures inline', () => {
    expect(source).toContain('if (formPending) return;');
    expect(source).toContain('if (deleteMutation.isPending) return;');
    expect(source).toContain('mutationError={createMutation.error || updateMutation.error}');
    expect(source).toContain('mutationError={deleteMutation.error}');
    expect(source.match(/role="alert"/g).length).toBeGreaterThanOrEqual(2);
  });

  it('names dynamic rate controls and stacks each row on narrow screens', () => {
    expect(source).toContain('aria-label={`Service ${idx + 1} name`}');
    expect(source).toContain('aria-label={`Remove service ${idx + 1}`}');
    expect(source).toContain('grid-cols-1 sm:grid-cols-12');
  });
});
