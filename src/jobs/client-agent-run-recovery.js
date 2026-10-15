import { requestStorage } from '../utils/request-context.js';

const QUEUE_MAX_AGE_MS = 10 * 60 * 1000;

/** Expiry records a final outcome; it never reclaims or retries inference. */
export async function expireClientAgentRuns(prisma, organizationId, { now = () => new Date() } = {}) {
  const store = requestStorage.getStore();
  if (typeof organizationId !== 'string' || !organizationId || store?.organizationId !== organizationId || store?.prisma !== prisma) {
    throw Object.assign(new Error('A verified client agent tenant job context is required.'), { code: 'TENANT_CONTEXT_REQUIRED' });
  }
  const at = now();
  if (!(at instanceof Date) || !Number.isFinite(+at)) throw new Error('Client agent recovery requires a valid time.');
  const changed = await prisma.clientAgentRun.updateMany({
    where: { organizationId, status: 'RUNNING', deadlineAt: { lte: at } },
    data: { status: 'UNKNOWN', errorCode: 'RUN_DEADLINE_EXCEEDED', finishedAt: at },
  });
  const queued = await prisma.clientAgentRun.updateMany({
    where: { organizationId, status: 'QUEUED', createdAt: { lte: new Date(+at - QUEUE_MAX_AGE_MS) } },
    data: { status: 'FAILED', errorCode: 'RUN_QUEUE_EXPIRED', finishedAt: at },
  });
  return { expired: changed.count, queueExpired: queued.count };
}
