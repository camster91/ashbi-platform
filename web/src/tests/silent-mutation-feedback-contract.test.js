import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readPage = (name) => readFileSync(resolve(process.cwd(), `src/pages/${name}.jsx`), 'utf8');

describe('silent mutation feedback', () => {
  it('reports AI context save and add failures without clearing input', () => {
    const page = readPage('AiContextSettings');
    expect(page).toContain("import { useToast } from '../hooks/useToast';");
    expect(page).toContain("onError: (error) => toast.error(error.message || 'Failed to update AI context')");
    expect(page).toContain("onError: (error) => toast.error(error.message || 'Failed to add AI context')");
  });

  it('reports brand save and logo upload failures', () => {
    const page = readPage('BrandSettings');
    expect(page).toContain("import { useToast } from '../hooks/useToast';");
    expect(page).toContain("onError: (error) => toast.error(error.message || 'Failed to save brand settings')");
    expect(page).toContain("toast.error(err.message || 'Logo upload failed')");
  });

  it('reports invoice reminder generation failures', () => {
    const page = readPage('InvoiceChaser');
    // Failures are shown on the page (a banner and a note on each invoice);
    // see InvoiceChaser.failures.test.jsx for the behaviour.
    expect(page).toContain('onError: (error, variables) => {');
    expect(page).toContain('setBanner({ ...failure, retryInvoiceId: variables?.invoiceId || null });');
    expect(page).toContain('splitReminders(data.reminders)');
  });
});
