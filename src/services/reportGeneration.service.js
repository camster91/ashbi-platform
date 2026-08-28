import { generateWeeklyReport } from './weeklyReport.service.js';

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return String(value ?? '').trim();
}

async function existingReport(prisma, requestId, clientId) {
  return prisma.report.findFirst({
    where: { requestId, clientId },
    include: { client: { select: { id: true, name: true } } },
  });
}

export async function createWeeklyReportOnce({
  prisma,
  clientId,
  requestId,
  generate = generateWeeklyReport,
} = {}) {
  const clientIdentity = text(clientId);
  const requestIdentity = text(requestId);
  if (!prisma?.client?.findFirst || !prisma?.report?.findFirst || !prisma?.report?.create) {
    throw new TypeError('A tenant-scoped Prisma client is required');
  }
  if (!clientIdentity) throw new TypeError('Client is required');
  if (!REQUEST_ID.test(requestIdentity)) throw new TypeError('A UUID requestId is required');

  const client = await prisma.client.findFirst({
    where: { id: clientIdentity, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!client) {
    const error = new Error('Client not found');
    error.code = 'CLIENT_NOT_FOUND';
    throw error;
  }

  const existing = await existingReport(prisma, requestIdentity, client.id);
  if (existing) return { report: existing, reused: true };

  const generated = await generate(client.id, { prismaClient: prisma });
  if (generated?.clientId !== client.id || !text(generated?.subject) || !text(generated?.body)) {
    throw new Error('Generated report is incomplete or belongs to another client');
  }

  try {
    const report = await prisma.report.create({
      data: {
        requestId: requestIdentity,
        type: 'WEEKLY',
        subject: text(generated.subject),
        body: text(generated.body),
        clientId: client.id,
      },
      include: { client: { select: { id: true, name: true } } },
    });
    return { report, reused: false };
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const winner = await existingReport(prisma, requestIdentity, client.id);
    if (!winner) throw error;
    return { report: winner, reused: true };
  }
}
