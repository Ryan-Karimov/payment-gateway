import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logging.level,
  transport: config.server.nodeEnv === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  } : undefined,
  base: {
    service: 'payment-gateway',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
