/**
 * Process lifecycle for long-running entry points (API server and worker).
 *
 * A crashed or signalled process must actually exit so the container runtime
 * restarts it. Setting process.exitCode alone is not enough: open handles
 * (Redis sockets, BullMQ connections, timers) keep the event loop alive and
 * the API stays down while looking "running".
 */

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/** Process-wide counters surfaced by the detailed health view. */
const counters = { unhandledRejections: 0 };

export function processCounters() {
  return { ...counters };
}

/**
 * Build an idempotent shutdown function. Repeated calls (a second signal,
 * a fatal error during the drain) return the same pending shutdown instead of
 * exiting mid-drain.
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
  let code = 0;
  return function shutdown(reason, exitCode = 0) {
    // A fatal error while already draining still makes the exit non-zero.
    code = Math.max(code, exitCode);
    if (pending) return pending;
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
 * Route signals and fatal errors to `shutdown`.
 *
 * - SIGINT/SIGTERM: graceful shutdown, exit 0. Handlers stay installed, so a
 *   second signal joins the running drain instead of killing the process
 *   mid-drain (the drain deadline still bounds it).
 * - uncaughtException: log, report, graceful shutdown with exit 1 (process
 *   state is unknown after a synchronous throw).
 * - unhandledRejection: log, report and count, but keep serving by default.
 *   Existing fire-and-forget code paths may still reject unobserved; turning
 *   each into an outage would be worse than the leak. Plan: once the
 *   `unhandledRejections` counter in /api/health/details stays at zero in
 *   production, pass `fatalUnhandledRejection: true` (see
 *   docs/deployment-and-rollback.md "Process lifecycle").
 */
export function installProcessHandlers({
  proc = process,
  shutdown,
  logger,
  captureException,
  fatalUnhandledRejection = false,
}) {
  proc.on('SIGINT', () => void shutdown('SIGINT', 0));
  proc.on('SIGTERM', () => void shutdown('SIGTERM', 0));
  proc.on('unhandledRejection', (reason) => {
    counters.unhandledRejections += 1;
    logger.error({ err: reason, unhandledRejections: counters.unhandledRejections }, 'Unhandled promise rejection');
    captureException?.(reason);
    if (fatalUnhandledRejection) void shutdown('unhandledRejection', 1);
  });
  proc.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    captureException?.(error);
    void shutdown('uncaughtException', 1);
  });
}
