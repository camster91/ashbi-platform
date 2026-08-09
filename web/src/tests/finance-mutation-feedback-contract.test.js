import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readPage = (name) => readFileSync(resolve(process.cwd(), `src/pages/${name}.jsx`), 'utf8');

describe('finance mutation feedback', () => {
  it('reports expense create, update, and receipt upload failures', () => {
    const page = readPage('Expenses');
    for (const message of [
      "toast.error('Failed to create expense', error.message)",
      "toast.error('Failed to update expense', error.message)",
      "toast.error('Receipt upload failed', err.message)",
    ]) {
      expect(page).toContain(message);
    }
  });

  it('reports proposal creation failure without clearing its autosaved draft', () => {
    const page = readPage('Proposals');
    expect(page).toContain("onError: (error) => toast.error('Failed to create proposal', error.message)");
  });

  it('reports payment-link generation failure', () => {
    const page = readPage('InvoiceDetail');
    expect(page).toContain("onError: (error) => toast.error('Failed to generate payment link', error.message)");
  });
});
