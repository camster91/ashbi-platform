// Notification queue processor (QUEUES.NOTIFICATIONS, src/jobs/worker.js).
//
// Persists the in-app notification inside the job's tenant, then delivers it
// live through the realtime emitter (the same `notification:new` and
// `notification` events as fastify.notify), so the user does not wait for
// the web app's poll.

import { runTenantJob as defaultRunTenantJob } from './tenant-iteration.js';
import { emitNotification } from '../services/notification.service.js';
import { getRealtimeEmitter } from '../realtime/emitter.js';

/**
 * @param {{ data: { userId: string, type: string, title: string, message: string, data?: any, organizationId?: string } }} job
 * @param {{
 *   prisma: any,
 *   backgroundPrisma?: any,
 *   emitter?: { to: (room: string) => { emit: Function } },
 *   runTenantJob?: typeof defaultRunTenantJob,
 * }} deps
 */
export async function processNotificationJob(job, {
  prisma,
  backgroundPrisma = prisma,
  emitter = getRealtimeEmitter(),
  runTenantJob = defaultRunTenantJob,
}) {
  const { userId, type, title, message, data } = job.data;

  // Create in-app notification
  const notification = await runTenantJob(prisma, job.data?.organizationId, (tenantPrisma) => (
    tenantPrisma.notification.create({
      data: {
        type,
        title,
        message,
        data: data ? JSON.stringify(data) : null,
        userId
      }
    })
  ), backgroundPrisma);

  // After the write: a failed insert never announces a notification.
  emitNotification(emitter, userId, notification);

  return { delivered: true };
}
