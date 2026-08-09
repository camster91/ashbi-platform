import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = (...parts) => fs.readFileSync(path.resolve(process.cwd(), 'src', ...parts), 'utf8');

describe('shared destructive confirmation contract', () => {
  it('provides a named, pending-safe, error-aware shared confirmation dialog', () => {
    const dialog = src('components', 'ConfirmDialog.jsx');

    expect(dialog).toContain('<Modal');
    expect(dialog).toContain('showCloseButton={!pending}');
    expect(dialog).toContain('if (pending) return');
    expect(dialog).toContain('role="alert"');
    expect(dialog).toContain('loading={pending}');
    expect(dialog).toContain('disabled={pending}');
  });

  it.each([
    ['pages/Invoices.jsx', 'Void invoice'],
    ['pages/InvoiceDetail.jsx', 'Void invoice'],
    ['pages/Estimates.jsx', 'Delete estimate'],
    ['pages/Expenses.jsx', 'Delete expense'],
    ['pages/Pipeline.jsx', 'Delete pipeline item'],
  ])('%s adopts the shared dialog and removes native confirmation', (file, title) => {
    const source = src(...file.split('/'));

    expect(source).toContain("import ConfirmDialog from '../components/ConfirmDialog'");
    expect(source).toContain('<ConfirmDialog');
    expect(source).toContain(`title="${title}"`);
    expect(source).not.toMatch(/(?:window\.)?confirm\s*\(/);
  });
});
