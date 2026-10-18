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
