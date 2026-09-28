import { buildApp, closeRuntimeHealth, env, logger, prisma, Sentry } from './index.js';
import { closeQueueInfrastructure } from './jobs/queue.js';
import { initVapid } from './utils/web-push.js';
import { createShutdown, installProcessHandlers } from './utils/process-lifecycle.js';

let app;

// Every step is isolated: a failing close still lets the others run, and the
// drain deadline forces an exit so a wedged handle cannot keep a crashed API
// process alive (the container runtime then restarts it).
const shutdown = createShutdown({
  logger,
  steps: [
    ['http', () => app?.close()],
    ['runtimeHealth', () => closeRuntimeHealth()],
    ['queues', () => closeQueueInfrastructure()],
    ['database', () => prisma.$disconnect()],
  ],
  flush: env.sentryDsn ? () => Sentry.flush(2_000) : undefined,
});

// unhandledRejection is logged, reported and counted but not fatal yet; see
// installProcessHandlers for the plan to make it fatal.
installProcessHandlers({
  shutdown,
  logger,
  captureException: env.sentryDsn ? (error) => Sentry.captureException(error) : undefined,
});

try {
  try {
    initVapid();
  } catch (error) {
    logger.warn({ err: error }, 'Web push init failed');
  }
  app = await buildApp();
  await app.listen({ port: env.port, host: '0.0.0.0' });
  logger.info(`Agency Hub running at http://localhost:${env.port}`);
} catch (error) {
  logger.fatal({ err: error }, 'API startup failed');
  await shutdown('startupFailure', 1);
}
