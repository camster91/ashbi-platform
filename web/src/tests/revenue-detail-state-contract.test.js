import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
    expect(invoice).toMatch(/Payment History[\s\S]*paymentsError[\s\S]*<QueryErrorState/);
  });
});
