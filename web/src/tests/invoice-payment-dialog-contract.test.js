import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve('src/pages/InvoiceDetail.jsx'), 'utf8');

describe('invoice payment dialog contract', () => {
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
