// One timeline for the client page's Activity panel, built from records that
// already exist for the client: conversations, the project feed (files,
// comments, milestones, logged time, client portal responses) and, for
// admins only, invoices sent and payments recorded.
//
// Every read goes through the caller's tenant-scoped Prisma client and is
// filtered to this client, so the feed never mixes in another client's or
// another organization's rows. Money rows are not even queried for non-admins.
// The feed never returns Activity metadata, chat message text or note
// activity: the project feed stores free text (feedback messages, the first
// characters of a chat message) whose audience the client page cannot check.

export const CLIENT_ACTIVITY_DEFAULT_LIMIT = 20;
export const CLIENT_ACTIVITY_MAX_LIMIT = 50;

/**
 * Project feed entries the client page may show, and the kind each one becomes.
 * Anything else (notes, bot-written entries, automation runs) stays out.
 */
export const CLIENT_ACTIVITY_PROJECT_TYPES = Object.freeze({
  FILE_UPLOADED: 'file',
  TASK_COMMENTED: 'comment',
  MILESTONE_CREATED: 'milestone',
  MILESTONE_UPDATED: 'milestone',
  MILESTONE_COMPLETED: 'milestone',
  TIME_LOGGED: 'time',
  CLIENT_FEEDBACK: 'client',
  CLIENT_REVISION_APPROVED: 'client',
  CLIENT_REVISION_CHANGES_REQUESTED: 'client',
  CHAT_MESSAGE: 'chat',
  EVENT_CREATED: 'event',
});

// Entity names that are free text written by someone else (a chat message's
// opening words), not a record's name.
const NAMELESS_TYPES = new Set(['CHAT_MESSAGE']);

function iso(value) {
  return new Date(value).toISOString();
}

// Keyset paging: items are ordered by time (newest first), then by their
// prefixed id ("activity:…", "thread:…"), so a page ends at an exact
// (time, id) point. Each source reads only what sorts after that point:
// older rows, plus rows at the same instant that sort after the cursor id.
// Without the id, rows sharing the boundary timestamp could be skipped.
function after(field, prefix, cursor) {
  if (!cursor) return null;
  const { before, beforeId } = cursor;
  if (!beforeId) return { [field]: { lt: before } };
  const split = beforeId.indexOf(':');
  const cursorPrefix = beforeId.slice(0, split);
  const cursorRawId = beforeId.slice(split + 1);
  if (prefix < cursorPrefix) return { [field]: { lt: before } };
  if (prefix > cursorPrefix) return { [field]: { lte: before } };
  return { OR: [{ [field]: { lt: before } }, { [field]: before, id: { gt: cursorRawId } }] };
}

const newestFirst = (field) => [{ [field]: 'desc' }, { id: 'asc' }];

/**
 * @param {any} prisma request-scoped (tenant) Prisma client
 * @param {string} clientId the client, already confirmed to exist for this tenant
 * @param {{ isAdmin: boolean, limit: number, before?: Date | null, beforeId?: string | null }} options
 * @returns {Promise<{ items: any[], nextBefore: string | null, nextBeforeId: string | null }>}
 */
export async function buildClientActivity(prisma, clientId, { isAdmin, limit, before = null, beforeId = null }) {
  const take = limit + 1;
  const cursor = before ? { before, beforeId } : null;

  const [threads, projectActivity, sentInvoices, paidInvoices, payments] = await Promise.all([
    prisma.thread.findMany({
      where: { clientId, ...after('lastActivityAt', 'thread', cursor) },
      orderBy: newestFirst('lastActivityAt'),
      take,
      select: {
        id: true, subject: true, status: true, lastActivityAt: true,
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.activity.findMany({
      where: {
        project: { clientId },
        type: { in: Object.keys(CLIENT_ACTIVITY_PROJECT_TYPES) },
        ...after('createdAt', 'activity', cursor),
      },
      orderBy: newestFirst('createdAt'),
      take,
      select: {
        id: true, type: true, action: true, entityType: true, entityId: true, entityName: true, createdAt: true,
        user: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    }),
    isAdmin
      ? prisma.invoice.findMany({
        where: { clientId, sentAt: { not: null }, ...after('sentAt', 'invoice-sent', cursor) },
        orderBy: newestFirst('sentAt'),
        take,
        select: { id: true, invoiceNumber: true, title: true, total: true, currency: true, sentAt: true },
      })
      : [],
    // An invoice marked paid with no payment rows (older records): its paid
    // date is the only trace of the payment.
    isAdmin
      ? prisma.invoice.findMany({
        where: { clientId, paidAt: { not: null }, payments: { none: {} }, ...after('paidAt', 'invoice-paid', cursor) },
        orderBy: newestFirst('paidAt'),
        take,
        select: { id: true, invoiceNumber: true, title: true, total: true, currency: true, paidAt: true, paymentMethod: true },
      })
      : [],
    isAdmin
      ? prisma.invoicePayment.findMany({
        where: { invoice: { clientId }, ...after('paidAt', 'payment', cursor) },
        orderBy: newestFirst('paidAt'),
        take,
        select: {
          id: true, amount: true, method: true, paidAt: true,
          invoice: { select: { id: true, invoiceNumber: true, currency: true } },
        },
      })
      : [],
  ]);

  const items = [
    ...threads.map((thread) => ({
      id: `thread:${thread.id}`,
      kind: 'conversation',
      at: iso(thread.lastActivityAt),
      title: thread.subject || 'No subject',
      status: thread.status,
      project: thread.project ?? null,
      href: `/thread/${thread.id}`,
    })),
    ...projectActivity.map((row) => ({
      id: `activity:${row.id}`,
      kind: CLIENT_ACTIVITY_PROJECT_TYPES[row.type],
      type: row.type,
      action: row.action,
      at: iso(row.createdAt),
      title: NAMELESS_TYPES.has(row.type) ? null : (row.entityName ?? null),
      actor: row.user ? { id: row.user.id, name: row.user.name } : null,
      project: row.project ?? null,
      href: row.project ? `/project/${row.project.id}` : null,
    })),
    ...sentInvoices.map((invoice) => ({
      id: `invoice-sent:${invoice.id}`,
      kind: 'invoice_sent',
      at: iso(invoice.sentAt),
      title: invoice.invoiceNumber,
      detail: invoice.title ?? null,
      amount: invoice.total,
      currency: invoice.currency,
      href: `/invoices/${invoice.id}`,
    })),
    ...paidInvoices.map((invoice) => ({
      id: `invoice-paid:${invoice.id}`,
      kind: 'invoice_paid',
      at: iso(invoice.paidAt),
      title: invoice.invoiceNumber,
      detail: invoice.title ?? null,
      amount: invoice.total,
      currency: invoice.currency,
      method: invoice.paymentMethod ?? null,
      href: `/invoices/${invoice.id}`,
    })),
    ...payments.map((payment) => ({
      id: `payment:${payment.id}`,
      kind: 'payment',
      at: iso(payment.paidAt),
      title: payment.invoice?.invoiceNumber ?? null,
      amount: payment.amount,
      currency: payment.invoice?.currency ?? null,
      method: payment.method,
      href: payment.invoice ? `/invoices/${payment.invoice.id}` : null,
    })),
  // Plain code-unit comparison (not localeCompare) so ids order the same way
  // here as in each source's `id: { gt }` filter.
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const page = items.slice(0, limit);
  const last = items.length > limit ? page[page.length - 1] : null;
  return {
    items: page,
    nextBefore: last ? last.at : null,
    nextBeforeId: last ? last.id : null,
  };
}
