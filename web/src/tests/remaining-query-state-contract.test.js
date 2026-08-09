import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
