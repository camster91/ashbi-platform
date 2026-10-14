import { z } from 'zod';
import { INVOICE_CURRENCIES } from '../utils/money.js';

const id = z.string().min(1).max(50);
const observedSource = z.object({ id, updatedAt: z.string().datetime({ offset: true }) }).strict();
export const unbilledCandidateSchema = z.object({
  clientId: id, projectId: id.optional(), kind: z.enum(['TIME', 'EXPENSE']),
  after: id.optional(), limit: z.number().int().min(1).max(50).default(25),
}).strict();
export const unbilledInvoiceSchema = z.object({
  clientId: id, projectId: id.optional(), title: z.string().trim().min(1).max(200),
  currency: z.enum(/** @type {[string, ...string[]]} */ ([...INVOICE_CURRENCIES])),
  taxRate: z.number().finite().min(0).max(50), taxType: z.enum(['HST', 'GST', 'PST', 'TAX', 'NONE']),
  times: z.array(observedSource.extend({ hourlyRate: z.number().finite().min(0).max(1_000_000) }).strict()).max(50).default([]),
  expenses: z.array(observedSource).max(50).default([]),
}).strict().superRefine((input, ctx) => {
  if (!input.times.length && !input.expenses.length) ctx.addIssue({ code: 'custom', message: 'Select approved time or billable expenses.' });
  if (input.taxType === 'NONE' && input.taxRate !== 0) ctx.addIssue({ code: 'custom', path: ['taxRate'], message: 'No tax requires a zero tax rate.' });
  for (const kind of ['times', 'expenses']) {
    if (new Set(input[kind].map(source => source.id)).size !== input[kind].length) ctx.addIssue({ code: 'custom', path: [kind], message: 'Select each source once.' });
  }
});
