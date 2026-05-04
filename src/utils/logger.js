import pino from 'pino';
import env from '../config/env.js';

// Enterprise structured logging
const logger = pino({
  level: env.isDev ? 'debug' : 'info',
  transport: env.isDev ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  } : undefined, // In production, we log pure JSON for ELK/Datadog
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
