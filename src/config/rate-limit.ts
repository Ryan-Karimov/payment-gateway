import { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { redis } from './redis.js';
import { logger } from '../utils/logger.js';

export interface RateLimitConfig {
  global: {
    max: number;
    timeWindow: string;
  };
  payments: {
    max: number;
    timeWindow: string;
  };
  refunds: {
    max: number;
    timeWindow: string;
  };
}

const rateLimitConfig: RateLimitConfig = {
  global: {
    max: 1000,
    timeWindow: '1 minute',
  },
  payments: {
    max: 100,
    timeWindow: '1 minute',
  },
  refunds: {
    max: 50,
    timeWindow: '1 minute',
  },
};

export async function setupRateLimit(fastify: FastifyInstance): Promise<void> {
  await fastify.register(rateLimit, {
    global: true,
    max: rateLimitConfig.global.max,
    timeWindow: rateLimitConfig.global.timeWindow,
    redis,
    keyGenerator: (request: FastifyRequest) => {
      // Use API key or IP for rate limiting
      return request.merchantId || request.ip;
    },
    errorResponseBuilder: (_request, context) => {
      return {
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil(context.ttl / 1000),
      };
    },
    onExceeded: (request) => {
      logger.warn({
        merchantId: request.merchantId,
        ip: request.ip,
        url: request.url,
      }, 'Rate limit exceeded');
    },
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });
}

// Route-specific rate limiters
export const paymentRateLimit = {
  config: {
    rateLimit: {
      max: rateLimitConfig.payments.max,
      timeWindow: rateLimitConfig.payments.timeWindow,
      keyGenerator: (request: FastifyRequest) => {
        return `payments:${request.merchantId || request.ip}`;
      },
    },
  },
};

export const refundRateLimit = {
  config: {
    rateLimit: {
      max: rateLimitConfig.refunds.max,
      timeWindow: rateLimitConfig.refunds.timeWindow,
      keyGenerator: (request: FastifyRequest) => {
        return `refunds:${request.merchantId || request.ip}`;
      },
    },
  },
};
