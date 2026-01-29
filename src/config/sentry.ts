import * as Sentry from '@sentry/node';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './index.js';

export function initSentry(): void {
  if (!config.sentry.dsn) {
    console.log('Sentry DSN not configured, error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.server.nodeEnv,
    release: `payment-gateway@${process.env['npm_package_version'] || '1.0.0'}`,

    // Performance monitoring
    tracesSampleRate: config.server.isProduction ? 0.1 : 1.0,

    // Set sampling rate for profiling
    profilesSampleRate: config.server.isProduction ? 0.1 : 1.0,

    // Filter sensitive data
    beforeSend(event) {
      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers['x-api-key'];
        delete event.request.headers['authorization'];
      }

      // Remove sensitive data from breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
          if (breadcrumb.data) {
            delete breadcrumb.data['api_key'];
            delete breadcrumb.data['password'];
          }
          return breadcrumb;
        });
      }

      return event;
    },

    // Ignore certain errors
    ignoreErrors: [
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'Request aborted',
    ],
  });

  console.log('Sentry initialized');
}

/**
 * Setup Sentry for Fastify
 */
export function setupSentryFastify(fastify: FastifyInstance): void {
  if (!config.sentry.dsn) return;

  // Add request data to Sentry scope
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    Sentry.setUser({
      id: request.merchantId,
    });

    Sentry.setContext('request', {
      requestId: request.requestContext?.requestId,
      method: request.method,
      url: request.url,
      ip: request.ip,
    });
  });

  // Capture errors
  fastify.addHook('onError', async (request, _reply, error) => {
    Sentry.captureException(error, {
      extra: {
        requestId: request.requestContext?.requestId,
        merchantId: request.merchantId,
        method: request.method,
        url: request.url,
      },
    });
  });
}

/**
 * Capture an exception manually
 */
export function captureException(
  error: Error,
  context?: Record<string, unknown>
): string {
  return Sentry.captureException(error, { extra: context });
}

/**
 * Capture a message
 */
export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info'
): string {
  return Sentry.captureMessage(message, level);
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>
): void {
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: 'info',
  });
}

/**
 * Set user context
 */
export function setUser(merchantId: string): void {
  Sentry.setUser({ id: merchantId });
}

/**
 * Clear user context
 */
export function clearUser(): void {
  Sentry.setUser(null);
}

/**
 * Flush Sentry events (for graceful shutdown)
 */
export async function flushSentry(timeout: number = 2000): Promise<boolean> {
  return Sentry.flush(timeout);
}
