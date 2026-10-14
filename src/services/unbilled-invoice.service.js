import { createHash } from 'node:crypto';
import { unbilledCandidateSchema, unbilledInvoiceSchema } from '../shared/unbilled-invoice.js';
import { invoiceTotals, lineTotal } from '../utils/money-totals.js';
import { allocateInvoiceNumber } from '../utils/invoice.js';
import { recordAuditEvent } from './audit-event.service.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const parse = (schema, input) => {
  const result = schema.safeParse(input);
  if (!result.success) fail(400, result.error.issues[0]?.message || 'Invalid invoice selection.');
  return result.data;
};
export async function currentInvoiceAdmin(prisma, actor) {
  if (!actor?.organizationId || actor.role !== 'ADMIN') fail(403, 'An administrator reviews billing drafts.');
  const current = await prisma.user.findFirst({ where: { id: actor.id, organizationId: actor.organizationId, role: 'ADMIN', isActive: true }, select: { id: true, organizationId: true, role: true } });
  if (!current) fail(403, 'An active administrator reviews billing drafts.');
  return current;
}
async function targets(prisma, input, actor) {
  const client = await prisma.client.findFirst({ where: { id: input.clientId, organizationId: actor.organizationId, deletedAt: null }, select: { id: true, name: true } });
  if (!client) fail(404, 'Client not found.');
  const project = input.projectId ? await prisma.project.findFirst({ where: { id: input.projectId, clientId: client.id, organizationId: actor.organizationId, deletedAt: null }, select: { id: true, name: true } }) : null;
  if (input.projectId && !project) fail(404, 'Project not found for this client.');
  return { client, project };
}
function sourceWhere(input, organizationId, kind) {
  const project = { organizationId, clientId: input.clientId, deletedAt: null };
  const common = { deletedAt: null, billable: true, invoiced: false, invoiceId: null, ...(input.projectId ? { projectId: input.projectId } : {}) };
  if (kind === 'TIME') return { ...common, duration: { gt: 0 }, reviewStatus: 'APPROVED', project, user: { organizationId } };
  // A direct client link cannot override a different project's client.
  return { ...common, organizationId, AND: [
    { OR: [{ clientId: input.clientId }, { clientId: null, project }] },
    { OR: [{ projectId: null }, { project }] },
  ] };
}
const select = kind => kind === 'TIME' ? {
  id: true, description: true, duration: true, date: true, hourlyRate: true, updatedAt: true, projectId: true,
  project: { select: { id: true, name: true } }, user: { select: { id: true, name: true } },
} : { id: true, description: true, amount: true, currency: true, date: true, updatedAt: true, projectId: true, project: { select: { id: true, name: true } } };
function candidate(row, kind) {
  return { id: row.id, kind, description: row.description ?? '', date: row.date, updatedAt: row.updatedAt,
    project: row.project ? { id: row.project.id, name: row.project.name } : null,
    ...(kind === 'TIME' ? { duration: row.duration, suggestedHourlyRate: Number.isFinite(row.hourlyRate) && row.hourlyRate >= 0 ? row.hourlyRate : null, user: row.user ? { id: row.user.id, name: row.user.name } : null }
      : { amount: row.amount, currency: row.currency }),
  };
}
export async function listUnbilledCandidates(prisma, rawInput, actor) {
  const input = parse(unbilledCandidateSchema, rawInput);
  const admin = await currentInvoiceAdmin(prisma, actor);
  const scope = await targets(prisma, input, admin);
  const delegate = input.kind === 'TIME' ? prisma.timeEntry : prisma.expense;
  const rows = await delegate.findMany({ where: { ...sourceWhere(input, admin.organizationId, input.kind), ...(input.after ? { id: { gt: input.after } } : {}) }, select: select(input.kind), take: input.limit + 1, orderBy: { id: 'asc' } });
  const items = rows.slice(0, input.limit).map(row => candidate(row, input.kind));
  return { ...scope, items, nextCursor: rows.length > input.limit ? items.at(-1).id : null };
}
async function selected(prisma, input, admin, kind) {
  const selections = kind === 'TIME' ? input.times : input.expenses;
  if (!selections.length) return [];
  const delegate = kind === 'TIME' ? prisma.timeEntry : prisma.expense;
  const rows = await delegate.findMany({ where: { ...sourceWhere(input, admin.organizationId, kind), id: { in: selections.map(item => item.id) } }, select: select(kind), take: 50 });
  const byId = new Map(rows.map(row => [row.id, row]));
  return selections.map(observed => {
    const row = byId.get(observed.id);
    if (!row) fail(409, 'Selected work is no longer available for billing. Refresh the selection.');
    if (new Date(row.updatedAt).getTime() !== new Date(observed.updatedAt).getTime()) fail(409, 'Selected work changed. Review it again.');
    if (kind === 'TIME' && (!Number.isInteger(row.duration) || row.duration <= 0)) fail(409, 'Selected time has an invalid duration.');
    if (kind === 'TIME' && row.hourlyRate !== null && row.hourlyRate !== undefined && (!Number.isFinite(row.hourlyRate) || row.hourlyRate < 0)) fail(409, 'Selected time has an invalid stored rate. Review the source first.');
    if (kind === 'EXPENSE' && (!Number.isFinite(row.amount) || row.amount < 0 || row.currency !== input.currency)) fail(409, 'Selected expenses must have valid amounts in the invoice currency. No conversion is performed.');
    return { row, observed };
  });
}
export async function previewUnbilledInvoice(prisma, rawInput, actor) {
  const input = parse(unbilledInvoiceSchema, rawInput);
  const admin = await currentInvoiceAdmin(prisma, actor);
  const scope = await targets(prisma, input, admin);
  const [times, expenses] = await Promise.all([selected(prisma, input, admin, 'TIME'), selected(prisma, input, admin, 'EXPENSE')]);
  const lineItems = [...times.map(({ row, observed }) => ({
    description: (row.description || 'Approved time').slice(0, 500), itemType: 'LABOR', quantity: row.duration / 60, unitPrice: observed.hourlyRate,
    total: lineTotal(row.duration / 60, observed.hourlyRate), source: { ...candidate(row, 'TIME'), declaredHourlyRate: observed.hourlyRate, declaredRateCurrency: input.currency },
  })), ...expenses.map(({ row }) => ({
    description: row.description.slice(0, 500), itemType: 'EXPENSE', quantity: 1, unitPrice: row.amount, total: lineTotal(1, row.amount), source: candidate(row, 'EXPENSE'),
  }))].map((line, position) => ({ ...line, position }));
  const preview = { ...scope, title: input.title, currency: input.currency, taxRate: input.taxRate, taxType: input.taxType, lineItems,
    totals: invoiceTotals(lineItems, input.taxRate), sourceCount: { time: times.length, expense: expenses.length },
    status: 'DRAFT', sendsMessage: false, chargesPayment: false,
  };
  if ([...lineItems.map(line => line.total), ...Object.values(preview.totals)].some(amount => !Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER / 100)) {
    fail(400, 'The selected billing amounts are too large to represent safely.');
  }
  return { ...preview, fingerprint: createHash('sha256').update(JSON.stringify(preview)).digest('hex') };
}

// The caller owns a serializable transaction (HTTP confirmation or the
// governed tool receipt). Never allocate a number or claim sources beforehand.
export async function createUnbilledInvoiceInTransaction(tx, rawInput, fingerprint, actor) {
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) fail(400, 'Provide the reviewed billing preview.');
  const input = parse(unbilledInvoiceSchema, rawInput);
  const preview = await previewUnbilledInvoice(tx, input, actor);
  if (preview.fingerprint !== fingerprint) fail(409, 'The billing preview changed. Review it again.');
  const allocated = await allocateInvoiceNumber(tx, { clientId: input.clientId, organizationId: actor.organizationId });
  const snapshot = JSON.parse(JSON.stringify({ version: 1, ...preview, clientId: input.clientId, projectId: input.projectId ?? null }));
  const invoice = await tx.invoice.create({ data: {
    organizationId: allocated.organizationId, invoiceNumber: allocated.invoiceNumber, clientId: input.clientId,
    projectId: input.projectId ?? null, createdById: actor.id, title: input.title, status: 'DRAFT', currency: input.currency,
    taxRate: input.taxRate, taxType: input.taxType, subtotal: preview.totals.subtotal, tax: preview.totals.tax, total: preview.totals.total,
    billingSources: snapshot, lineItems: { create: preview.lineItems.map(line => ({ description: line.description, itemType: line.itemType,
      quantity: line.quantity, unitPrice: line.unitPrice, total: line.total, position: line.position })) },
  }, include: { client: { select: { id: true, name: true } }, lineItems: { orderBy: { position: 'asc' } } } });
  for (const kind of ['TIME', 'EXPENSE']) {
    const selections = kind === 'TIME' ? input.times : input.expenses;
    if (!selections.length) continue;
    const delegate = kind === 'TIME' ? tx.timeEntry : tx.expense;
    const claimed = await delegate.updateMany({ where: { ...sourceWhere(input, actor.organizationId, kind),
      OR: selections.map(source => ({ id: source.id, updatedAt: new Date(source.updatedAt) })) }, data: { invoiced: true, invoiceId: invoice.id } });
    if (claimed.count !== selections.length) fail(409, 'Selected work was claimed or changed. Review it again.');
  }
  const event = await recordAuditEvent(tx, { organizationId: actor.organizationId, actorType: 'USER', actorUserId: actor.id,
    action: 'invoice.created_from_unbilled', entityId: invoice.id, metadata: { clientId: input.clientId, projectId: input.projectId ?? null,
      timeCount: input.times.length, expenseCount: input.expenses.length, total: invoice.total, currency: invoice.currency } });
  if (!event) fail(503, 'The invoice could not be saved with its audit record. No work was billed.');
  return invoice;
}
