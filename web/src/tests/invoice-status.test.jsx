import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  invoiceBalanceDue,
  invoiceDisplayStatus,
  isOpenInvoice,
  isPartlyPaid,
  recurrenceSummary,
  taxTypeLabel,
  UNPAID_INVOICE_STATUSES,
} from '../lib/invoice-status';
import { getStatus } from '../lib/status';
import { StatusBadge } from '../components/ui';
import { invoiceStatusBadge, statusBadge } from '../pages/client-portal/shared';
import { InvoiceAmount } from '../pages/ClientPortal';

const partlyPaid = { status: 'SENT', total: 1130, amountPaid: 300, balanceDue: 830, currency: 'CAD' };

describe('invoice display status', () => {
  it('shows a sent invoice with some paid and a balance left as Partly paid', () => {
    expect(isPartlyPaid(partlyPaid)).toBe(true);
    expect(invoiceDisplayStatus(partlyPaid)).toBe('PARTLY_PAID');
    expect(getStatus('invoice', 'PARTLY_PAID').label).toBe('Partly paid');
    render(<StatusBadge domain="invoice" status={invoiceDisplayStatus(partlyPaid)} />);
    expect(screen.getByText('Partly paid')).toBeInTheDocument();
  });

  it('keeps Overdue, Paid, Sent and Draft as they are', () => {
    expect(invoiceDisplayStatus({ ...partlyPaid, isOverdue: true })).toBe('OVERDUE');
    expect(invoiceDisplayStatus({ ...partlyPaid, status: 'OVERDUE' })).toBe('OVERDUE');
    expect(invoiceDisplayStatus({ status: 'PAID', total: 10, amountPaid: 10, balanceDue: 0 })).toBe('PAID');
    expect(invoiceDisplayStatus({ status: 'SENT', total: 10, amountPaid: 0, balanceDue: 10 })).toBe('SENT');
    expect(invoiceDisplayStatus({ status: 'DRAFT', total: 10 })).toBe('DRAFT');
    // Within half a cent is nothing.
    expect(isPartlyPaid({ status: 'SENT', amountPaid: 0.004, balanceDue: 10 })).toBe(false);
  });

  it('owes the balance, falling back to the total when the API sent none', () => {
    expect(invoiceBalanceDue(partlyPaid)).toBe(830);
    expect(invoiceBalanceDue({ total: 99 })).toBe(99);
    expect(invoiceBalanceDue({ total: 99, balanceDue: 0 })).toBe(0);
  });

  it('says how an invoice repeats in plain words', () => {
    expect(recurrenceSummary({ isRecurring: true, recurringInterval: 'MONTHLY', recurringNextDate: '2026-11-02T00:00:00.000Z' }))
      .toBe('Repeats monthly · next on Nov 2, 2026');
    expect(recurrenceSummary({ isRecurring: true, recurringInterval: 'QUARTERLY' })).toBe('Repeats every 3 months');
    expect(recurrenceSummary({ isRecurring: true, recurringInterval: 'ANNUALLY' })).toBe('Repeats yearly');
    expect(recurrenceSummary({ isRecurring: false, recurringInterval: 'MONTHLY' })).toBeNull();
  });

  it('labels a neutral TAX type as "Tax"', () => {
    expect(taxTypeLabel('TAX')).toBe('Tax');
    expect(taxTypeLabel('HST')).toBe('HST');
    expect(taxTypeLabel('NONE')).toBe('No tax');
    expect(taxTypeLabel(undefined)).toBe('Tax');
  });
});

describe('client portal invoice amounts', () => {
  it('badges a partly paid invoice and shows the balance with what was paid so far', () => {
    render(<div>{invoiceStatusBadge(partlyPaid)}<InvoiceAmount invoice={partlyPaid} /></div>);
    expect(screen.getByText('PARTLY PAID')).toBeInTheDocument();
    expect(screen.getByText('$830.00 CAD')).toBeInTheDocument();
    expect(screen.getByText('Balance due')).toBeInTheDocument();
    expect(screen.getByText('Paid so far $300.00 CAD of $1,130.00 CAD')).toBeInTheDocument();
    expect(screen.queryByText('$1,130.00 CAD')).not.toBeInTheDocument();
  });

  it('treats a VIEWED invoice as open: labelled Viewed for staff, awaiting payment for the client', () => {
    expect(isOpenInvoice({ status: 'VIEWED' })).toBe(true);
    expect(isOpenInvoice({ status: 'SENT' })).toBe(true);
    expect(isOpenInvoice({ status: 'PAID' })).toBe(false);
    expect(isOpenInvoice({ status: 'DRAFT' })).toBe(false);
    expect(invoiceDisplayStatus({ status: 'VIEWED', isOverdue: true })).toBe('OVERDUE');
    expect(invoiceDisplayStatus({ status: 'VIEWED', total: 100, amountPaid: 40, balanceDue: 60 })).toBe('PARTLY_PAID');
    render(<div><StatusBadge domain="invoice" status="VIEWED" />{statusBadge('VIEWED')}</div>);
    expect(screen.getByText('Viewed')).toBeInTheDocument();
    expect(screen.getByText('AWAITING PAYMENT')).toBeInTheDocument();
  });

  it('treats a VIEWED invoice as unpaid', () => {
    render(<InvoiceAmount invoice={{ status: 'VIEWED', total: 1130, amountPaid: 300, balanceDue: 830, currency: 'CAD' }} />);
    expect(screen.getByText('$830.00 CAD')).toBeInTheDocument();
    expect(screen.getByText(/Paid so far/)).toBeInTheDocument();
    expect(UNPAID_INVOICE_STATUSES).toEqual(['SENT', 'VIEWED', 'OVERDUE']);
  });

  it('shows the full amount on an unpaid open invoice and the total on a paid one', () => {
    const { unmount } = render(<InvoiceAmount invoice={{ status: 'SENT', total: 500, amountPaid: 0, balanceDue: 500, currency: 'CAD' }} />);
    expect(screen.getByText('$500.00 CAD')).toBeInTheDocument();
    expect(screen.queryByText(/Paid so far/)).not.toBeInTheDocument();
    unmount();
    render(<InvoiceAmount invoice={{ status: 'PAID', total: 500, amountPaid: 500, balanceDue: 0, currency: 'USD' }} />);
    expect(screen.getByText('$500.00 USD')).toBeInTheDocument();
  });
});
