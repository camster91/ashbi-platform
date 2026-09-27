// @ts-check
import pino from 'pino';
import env from '../config/env.js';
import { LOG_REDACT_OPTIONS } from './log-redaction.js';

/**
 * Pick the log level, destination and transport for the current NODE_ENV.
 *
 * - development: debug level, human-readable output through the
 *   `pino-pretty` transport (a worker thread).
 * - test: silent unless LOG_LEVEL is set, and never through a transport. The
 *   Node test runner reads serialized report frames from each test file's
 *   stdout; an asynchronous transport worker writing to fd 1 can interleave
 *   with those frames ("Unable to deserialize cloned data", hung suites).
 *   When LOG_LEVEL is set, logs go synchronously to stderr instead.
 * - staging/production: info level, JSON to stdout for the log pipeline.
 *
 * LOG_LEVEL overrides the level in every environment.
 *
 * @param {{ isDevelopment: boolean, isTest: boolean }} runtime
 * @param {string | undefined} [logLevel]
 */
export function resolveLoggerSettings(runtime, logLevel = process.env.LOG_LEVEL) {
  if (runtime.isTest) {
    return {
      level: logLevel || 'silent',
      transport: undefined,
      destination: pino.destination({ dest: 2, sync: true }),
    };
  }
  if (runtime.isDevelopment) {
    return {
      level: logLevel || 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      },
      destination: undefined,
    };
  }
  // In deployed environments we log pure JSON for ELK/Datadog.
  return { level: logLevel || 'info', transport: undefined, destination: undefined };
}

const settings = resolveLoggerSettings(env);

// Enterprise structured logging
const logger = pino({
  level: settings.level,
  transport: settings.transport,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Never write API keys, session cookies or passwords to logs.
  redact: { ...LOG_REDACT_OPTIONS, paths: [...LOG_REDACT_OPTIONS.paths] },
}, settings.destination);

export default logger;
