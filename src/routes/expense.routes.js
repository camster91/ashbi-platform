// Expense routes — full CRUD + summary stats

import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { validateBody, createExpenseSchema, fileUpload, expenseUpdateSchema } from '../validators/schemas.js';
import { softDelete } from '../services/trash.service.js';
import { clampTake } from '../utils/query-limits.js';
import { recordRejectedUpload, sha256Hex } from '../services/upload-integrity.service.js';
import { DEFAULT_UPLOADS_DIR, hashStoredUpload, receiptRelativePath, sendStoredUpload } from '../utils/stored-upload.js';

const RECEIPT_REFUSED = 'receiptUrl must be a receipt uploaded through /api/expenses/upload-receipt';
const RECEIPT_TAKEN_MESSAGE = 'expense receipt belongs to another organization';

// The list's ?sort= and ?order= come from the query string; anything outside
// these allowlists falls back to the default rather than reaching Prisma.
export const EXPENSE_SORT_FIELDS = Object.freeze(['date', 'amount', 'description', 'category', 'createdAt', 'updatedAt']);

export function expenseListOrderBy(sort, order) {
  const field = EXPENSE_SORT_FIELDS.includes(sort) ? sort : 'date';
  const direction = order === 'asc' || order === 'desc' ? order : 'desc';
  return { [field]: direction };
}

/**
 * The receipt columns for a write that sets `receiptUrl`. The checksum is
 * computed here from the stored file, never taken from the request: only a
 * receipt this server stored (`/uploads/receipt-<uuid>.<ext>`, present in the
 * upload directory) is accepted. Clearing it clears the checksum; resending
 * the current value keeps the stored checksum.
 * @returns {Promise<{ data?: object, error?: string }>}
 */
async function receiptColumns(receiptUrl, existing, uploadsDir) {
  if (receiptUrl === undefined) return { data: {} };
  if (receiptUrl === null || receiptUrl === '') return { data: { receiptUrl: null, receiptChecksumSha256: null } };
  if (existing && receiptUrl === existing.receiptUrl) return { data: {} };
  const relativePath = receiptRelativePath(receiptUrl);
  if (!relativePath) return { error: RECEIPT_REFUSED };
  const stored = await hashStoredUpload(relativePath, uploadsDir);
  if (!stored) return { error: 'Receipt file not found' };
  return { data: { receiptUrl, receiptChecksumSha256: stored.sha256 } };
}

/** The expenses_tenant_guard trigger refused another organization's receipt. */
function isReceiptTaken(err) {
  return String(err?.message ?? '').includes(RECEIPT_TAKEN_MESSAGE);
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ uploadsDir?: string }} [options]
 */
export default async function expenseRoutes(fastify, options = {}) {
  const UPLOAD_DIR = options.uploadsDir ?? DEFAULT_UPLOADS_DIR;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  // ─── GET / — list expenses with filters ────────────────────────────────────
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const { category, clientId, projectId, startDate, endDate, search, sort, order, limit, offset } = request.query;

    const where = {};
    if (category) where.category = category;
    if (clientId) where.clientId = clientId;
    if (projectId) where.projectId = projectId;
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [expenses, total] = await Promise.all([
      request.prisma.expense.findMany({
        where,
        include: {
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
        },
        orderBy: expenseListOrderBy(sort, order),
        ...(limit ? { take: clampTake(limit) } : {}),
        ...(Number.parseInt(offset, 10) > 0 ? { skip: Number.parseInt(offset, 10) } : {}),
      }),
      request.prisma.expense.count({ where }),
    ]);

    return { expenses, total };
  });

  // ─── GET /summary — monthly summary + category breakdown ───────────────────
  fastify.get('/summary', { onRequest: [fastify.authenticate] }, async (request) => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const monthExpenses = await request.prisma.expense.findMany({
      where: {
        date: { gte: startOfMonth, lte: endOfMonth }
      }
    });

    const totalThisMonth = monthExpenses.reduce((sum, e) => sum + e.amount, 0);

    // Category breakdown
    const byCategory = {};
    for (const e of monthExpenses) {
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    }

    // All-time total
    const allExpenses = await request.prisma.expense.aggregate({
      _sum: { amount: true },
      _count: true,
    });

    return {
      totalThisMonth: parseFloat(totalThisMonth.toFixed(2)),
      byCategory,
      allTimeTotal: allExpenses._sum.amount || 0,
      allTimeCount: allExpenses._count || 0,
    };
  });

  // ─── GET /:id — single expense ─────────────────────────────────────────────
  fastify.get('/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const expense = await request.prisma.expense.findUnique({
      where: { id: request.params.id },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });

    if (!expense) return reply.status(404).send({ error: 'Expense not found' });
    return expense;
  });

  // ─── POST / — create expense ───────────────────────────────────────────────
  fastify.post('/', { onRequest: [fastify.authenticate], preHandler: [validateBody(createExpenseSchema)] }, async (request, reply) => {
    const { description, amount, currency, category, date, billable, notes, clientId, projectId, receiptUrl } = request.body;
    const receipt = await receiptColumns(receiptUrl, null, UPLOAD_DIR);
    if (receipt.error) return reply.status(400).send({ error: receipt.error });

    // The tenant proxy sets organizationId and refuses a client or project of
    // another organization (404).
    const expense = await request.prisma.expense.create({
      data: {
        description,
        amount: parseFloat(amount),
        currency: currency || 'CAD',
        category: category || 'OTHER',
        date: date ? new Date(date) : new Date(),
        billable: billable || false,
        notes: notes || null,
        clientId: clientId || null,
        projectId: projectId || null,
        ...receipt.data,
      },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    }).catch((err) => {
      if (isReceiptTaken(err)) return null;
      throw err;
    });
    if (!expense) return reply.status(400).send({ error: RECEIPT_REFUSED });

    return expense;
  });

  // ─── POST /upload-receipt — upload a receipt file ───────────────────────────
  fastify.post('/upload-receipt', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const buffer = await data.toBuffer();
    const validation = fileUpload.validate(data.filename, data.mimetype, buffer);
    if (!validation.valid) {
      await recordRejectedUpload(request.prisma, request, {
        surface: 'expense_receipt', validation, filename: data.filename, mimeType: data.mimetype, size: buffer.length,
      });
      return reply.status(400).send({ error: validation.error });
    }

    const filename = `receipt-${randomUUID()}${validation.ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);
    await fs.writeFile(filepath, buffer, { flag: 'wx' });

    // A receipt is referenced by URL from the expense (no attachment row).
    // The checksum is informational: when the URL is saved on an expense the
    // server hashes the stored file itself (receiptChecksumSha256).
    return { url: `/uploads/${filename}`, checksumSha256: sha256Hex(buffer) };
  });

  // ─── GET /:id/receipt — download the receipt of one expense ────────────────
  // Tenant-scoped through the expense: another organization's expense (or one
  // without a stored receipt) answers 404.
  fastify.get('/:id/receipt', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const expense = await request.prisma.expense.findUnique({
      where: { id: request.params.id },
      select: { id: true, receiptUrl: true },
    });
    const relativePath = receiptRelativePath(expense?.receiptUrl);
    if (!expense || !relativePath) return reply.status(404).send({ error: 'Receipt not found' });
    const sent = await sendStoredUpload(reply, { relativePath, uploadsDir: UPLOAD_DIR });
    if (sent === null) return reply.status(404).send({ error: 'Receipt not found' });
    return sent;
  });

  // ─── PUT /:id — update expense ─────────────────────────────────────────────
  fastify.put('/:id', { onRequest: [fastify.authenticate],
    preHandler: validateBody(expenseUpdateSchema),
  }, async (request, reply) => {
    const existing = await request.prisma.expense.findUnique({
      where: { id: request.params.id }
    });
    if (!existing) return reply.status(404).send({ error: 'Expense not found' });

    const { description, amount, currency, category, date, billable, notes, clientId, projectId, receiptUrl } = request.body;
    const receipt = await receiptColumns(receiptUrl, existing, UPLOAD_DIR);
    if (receipt.error) return reply.status(400).send({ error: receipt.error });

    const expense = await request.prisma.expense.update({
      where: { id: request.params.id },
      data: {
        ...(description !== undefined && { description }),
        ...(amount !== undefined && { amount: parseFloat(amount) }),
        ...(currency !== undefined && { currency }),
        ...(category !== undefined && { category }),
        ...(date !== undefined && { date: new Date(date) }),
        ...(billable !== undefined && { billable }),
        ...(notes !== undefined && { notes }),
        ...(clientId !== undefined && { clientId: clientId || null }),
        ...(projectId !== undefined && { projectId: projectId || null }),
        ...receipt.data,
      },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    }).catch((err) => {
      if (isReceiptTaken(err)) return null;
      throw err;
    });
    if (!expense) return reply.status(400).send({ error: RECEIPT_REFUSED });

    return expense;
  });

  // ─── DELETE /:id — delete expense ──────────────────────────────────────────
  fastify.delete('/:id', { onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const existing = await request.prisma.expense.findUnique({
      where: { id: request.params.id }
    });
    if (!existing) return reply.status(404).send({ error: 'Expense not found' });

    const { trashedItem } = await softDelete({
      scopedPrisma: request.prisma,
      entity: 'EXPENSE',
      recordId: request.params.id,
      organizationId: request.user.organizationId,
    });
    return { success: true, trashId: trashedItem.id };
  });
}
