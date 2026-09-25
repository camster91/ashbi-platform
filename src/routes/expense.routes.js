// Expense routes — full CRUD + summary stats

import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { validateBody, createExpenseSchema, fileUpload, expenseUpdateSchema } from '../validators/schemas.js';
import { softDelete } from '../services/trash.service.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

async function ensureUploadDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    // Directory exists
  }
}

export default async function expenseRoutes(fastify) {
  await ensureUploadDir();

  // ─── GET / — list expenses with filters ────────────────────────────────────
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const { category, clientId, projectId, startDate, endDate, search, sort = 'date', order = 'desc', limit, offset } = request.query;

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
        orderBy: { [sort]: order },
        ...(limit ? { take: parseInt(limit) } : {}),
        ...(offset ? { skip: parseInt(offset) } : {}),
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
  fastify.post('/', { onRequest: [fastify.authenticate], preHandler: [validateBody(createExpenseSchema)] }, async (request) => {
    const { description, amount, currency, category, date, billable, notes, clientId, projectId, receiptUrl } = request.body;

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
        receiptUrl: receiptUrl || null,
      },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });

    return expense;
  });

  // ─── POST /upload-receipt — upload a receipt file ───────────────────────────
  fastify.post('/upload-receipt', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const buffer = await data.toBuffer();
    const validation = fileUpload.validate(data.filename, data.mimetype, buffer);
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error });
    }

    const filename = `receipt-${randomUUID()}${validation.ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);
    await fs.writeFile(filepath, buffer);

    return { url: `/uploads/${filename}` };
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
        ...(receiptUrl !== undefined && { receiptUrl: receiptUrl || null }),
      },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });

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
