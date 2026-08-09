import { buildApp, closeRuntimeHealth, env, logger, prisma, Sentry } from './index.js';
import { initVapid } from './utils/web-push.js';

let app;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down...');
  try {
    if (app) await app.close();
    await closeRuntimeHealth();
    await prisma.$disconnect();
  } catch (error) {
    logger.error({ err: error }, 'Shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
  if (env.sentryDsn) Sentry.captureException(reason);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  if (env.sentryDsn) Sentry.captureException(error);
  process.exitCode = 1;
  void shutdown('uncaughtException');
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
  app?.log.error(error);
  process.exitCode = 1;
  await shutdown('startupFailure');
}
