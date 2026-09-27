/**
 * Process lifecycle for long-running entry points (API server).
 *
 * A crashed or signalled process must actually exit so the container runtime
 * restarts it. Setting process.exitCode alone is not enough: open handles
 * (Redis sockets, BullMQ connections, timers) keep the event loop alive and
 * the API stays down while looking "running".
 */

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Build an idempotent shutdown function.
 *
 * @param {object} options
 * @param {Array<[string, () => unknown]>} options.steps Named cleanup steps, run in order.
 * @param {{ info: Function, error: Function }} options.logger
 * @param {(code: number) => void} [options.exit] Injected for tests.
 * @param {number} [options.timeoutMs] Hard deadline after which the process exits regardless.
 * @param {() => unknown} [options.flush] Final telemetry flush (Sentry), run after the steps.
 * @param {typeof setTimeout} [options.setTimer]
 */
export function createShutdown({
  steps,
  logger,
  exit = (code) => process.exit(code),
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  flush,
  setTimer = setTimeout,
}) {
  let pending;
  return function shutdown(reason, exitCode = 0) {
    if (pending) return pending;
    let code = exitCode;
    let exited = false;
    const finish = (finalCode) => {
      if (exited) return;
      exited = true;
      exit(finalCode);
    };
    const timer = setTimer(() => {
      logger.error({ reason, timeoutMs }, 'Shutdown drain timed out; forcing exit');
      finish(code || 1);
    }, timeoutMs);
    timer?.unref?.();

    pending = (async () => {
      logger.info({ reason }, 'Shutting down...');
      for (const [name, step] of steps) {
        try {
          await step();
        } catch (error) {
          code = 1;
          logger.error({ err: error, step: name }, 'Shutdown step failed');
        }
      }
      if (flush) {
        try {
          await flush();
        } catch {
          // Telemetry is best effort during shutdown.
        }
      }
      clearTimeout(timer);
      finish(code);
    })();
    return pending;
  };
}

/**
 * Route signals and fatal errors to `shutdown`. Fatal errors are logged,
 * reported, and exit non-zero after a graceful drain.
 */
export function installProcessHandlers({ proc = process, shutdown, logger, captureException }) {
  proc.once('SIGINT', () => void shutdown('SIGINT', 0));
  proc.once('SIGTERM', () => void shutdown('SIGTERM', 0));
  proc.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    captureException?.(reason);
    void shutdown('unhandledRejection', 1);
  });
  proc.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    captureException?.(error);
    void shutdown('uncaughtException', 1);
  });
}
