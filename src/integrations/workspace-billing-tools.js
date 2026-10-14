import { z } from 'zod';
import { ToolError } from '../ai/tools/registry.js';
import { unbilledCandidateSchema, unbilledInvoiceSchema } from '../shared/unbilled-invoice.js';
import { listUnbilledCandidates, previewUnbilledInvoice, previewUnbilledRelease,
  createUnbilledInvoiceInTransaction, releaseUnbilledSourcesInTransaction } from '../services/unbilled-invoice.service.js';

const id = z.string().min(1).max(50);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
async function billingCall(work) {
  try { return await work(); }
  catch (error) {
    const codes = { 400: 'INVALID_INPUT', 403: 'ROLE_DENIED', 404: 'RECORD_NOT_FOUND', 409: 'TARGET_UNAVAILABLE', 503: 'STORAGE_UNAVAILABLE' };
    if (codes[error.statusCode]) throw new ToolError(codes[error.statusCode], error.message, { statusCode: error.statusCode });
    throw error;
  }
}
function billingRead(name, description, inputSchema, read) {
  return { name, description, class: 'read', roles: ['ADMIN'], inputSchema, timeoutMs: 10_000,
    resolveScope: ({ prisma, user, input }) => billingCall(async () => ({ ids: { organizationId: user.organizationId }, records: { output: await read(prisma, input, user) } })),
    run: async ({ scope }) => scope.records.output,
  };
}

export const WORKSPACE_BILLING_TOOLS = [
  billingRead('list_unbilled_candidates', 'Read approved unbilled time or billable expenses for one canonical client. Returns bounded pages and original currencies; administrators only.',
    unbilledCandidateSchema, listUnbilledCandidates),
  billingRead('preview_unbilled_invoice', 'Read the exact proposed draft lines, selected source identities, declared rates/currency/tax and totals. Does not claim work, send or charge. Use its fingerprint for a separately confirmed draft creation.',
    unbilledInvoiceSchema, previewUnbilledInvoice),
  billingRead('preview_unbilled_release', 'Read an exact source-release preview for an unpaid voided invoice after its undo window. Retains original billing history; does not release claims.',
    z.object({ invoiceId: id }).strict(), (prisma, input, user) => previewUnbilledRelease(prisma, input.invoiceId, user)),
  {
    name: 'create_unbilled_invoice_draft', description: 'Create a draft from the exact reviewed approved-work preview. Claims sources once with number, lines, original history and audit. No invoice send, payment link or charge. Requires human confirmation.',
    class: 'execute', roles: ['ADMIN'], requiresConfirmation: true, idempotency: 'required', approval: { approverRoles: ['ADMIN'] }, timeoutMs: 15_000,
    inputSchema: z.object({ selection: unbilledInvoiceSchema, fingerprint }).strict(),
    resolveScope: ({ prisma, user, input }) => billingCall(async () => {
      const preview = await previewUnbilledInvoice(prisma, input.selection, user);
      if (preview.fingerprint !== input.fingerprint) throw Object.assign(new Error('The billing preview changed. Review it again.'), { statusCode: 409 });
      return { ids: { organizationId: user.organizationId, clientId: preview.client.id }, records: { preview } };
    }),
    preview: async ({ scope }) => ({ kind: 'create_unbilled_invoice_draft', ...scope.records.preview }),
    rollback: 'Failure rolls back invoice, number, lines, claims, audit and receipt. Reverse committed draft claims by voiding the unpaid draft and reviewing source release after its undo window; original history is retained.',
    execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: ({ prisma, user, input }) => billingCall(() => createUnbilledInvoiceInTransaction(prisma, input.selection, input.fingerprint, user)) },
  },
  {
    name: 'release_unbilled_invoice_sources', description: 'Release exactly the reviewed invoice-owned claims on an unpaid voided invoice after its undo window. Retains original history and does not reopen the invoice. Requires human confirmation.',
    class: 'execute', roles: ['ADMIN'], requiresConfirmation: true, idempotency: 'required', approval: { approverRoles: ['ADMIN'] }, timeoutMs: 15_000,
    inputSchema: z.object({ invoiceId: id, fingerprint }).strict(),
    resolveScope: ({ prisma, user, input }) => billingCall(async () => {
      const preview = await previewUnbilledRelease(prisma, input.invoiceId, user);
      if (preview.fingerprint !== input.fingerprint) throw Object.assign(new Error('The release preview changed. Review it again.'), { statusCode: 409 });
      return { ids: { organizationId: user.organizationId, invoiceId: input.invoiceId }, records: { preview } };
    }),
    preview: async ({ scope }) => ({ kind: 'release_unbilled_invoice_sources', ...scope.records.preview }),
    rollback: 'Failure retains claims, invoice marker, audit and receipt. After a committed release, a fresh confirmed draft can claim the work again; the original voided invoice and its history remain retained.',
    execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: ({ prisma, user, input }) => billingCall(() => releaseUnbilledSourcesInTransaction(prisma, input.invoiceId, input.fingerprint, user)) },
  },
];
