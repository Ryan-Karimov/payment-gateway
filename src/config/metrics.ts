import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import client from 'prom-client';

// Extend FastifyRequest type for metrics
declare module 'fastify' {
  interface FastifyRequest {
    metricsStartTime?: bigint;
  }
}

// Create a Registry
const register = new client.Registry();

// Add default metrics
client.collectDefaultMetrics({ register });

// Custom metrics
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const paymentsTotal = new client.Counter({
  name: 'payments_total',
  help: 'Total number of payments processed',
  labelNames: ['provider', 'status', 'currency'],
  registers: [register],
});

export const paymentAmount = new client.Histogram({
  name: 'payment_amount',
  help: 'Payment amounts distribution',
  labelNames: ['provider', 'currency'],
  buckets: [1, 10, 50, 100, 500, 1000, 5000, 10000, 50000],
  registers: [register],
});

export const refundsTotal = new client.Counter({
  name: 'refunds_total',
  help: 'Total number of refunds processed',
  labelNames: ['status'],
  registers: [register],
});

export const providerRequestDuration = new client.Histogram({
  name: 'provider_request_duration_seconds',
  help: 'Duration of payment provider requests in seconds',
  labelNames: ['provider', 'operation', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const webhooksTotal = new client.Counter({
  name: 'webhooks_total',
  help: 'Total number of webhooks',
  labelNames: ['event_type', 'status'],
  registers: [register],
});

export const webhookRetries = new client.Counter({
  name: 'webhook_retries_total',
  help: 'Total number of webhook retries',
  labelNames: ['event_type'],
  registers: [register],
});

export const activeConnections = new client.Gauge({
  name: 'active_connections',
  help: 'Number of active connections',
  labelNames: ['type'],
  registers: [register],
});

export const idempotencyHits = new client.Counter({
  name: 'idempotency_cache_hits_total',
  help: 'Total number of idempotency cache hits',
  registers: [register],
});

export const idempotencyMisses = new client.Counter({
  name: 'idempotency_cache_misses_total',
  help: 'Total number of idempotency cache misses',
  registers: [register],
});

export async function setupMetrics(fastify: FastifyInstance): Promise<void> {
  // Request timing hook - using typed property instead of any
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    request.metricsStartTime = process.hrtime.bigint();
  });

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = request.metricsStartTime;
    if (!startTime) return;

    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    const route = request.routeOptions?.url || request.url;
    const labels = {
      method: request.method,
      route,
      status_code: reply.statusCode.toString(),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, duration);
  });

  // Metrics endpoint
  fastify.get('/metrics', {
    schema: {
      hide: true,
    },
  }, async (_request, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
}

// Helper functions for recording metrics
export function recordPayment(
  provider: string,
  status: string,
  currency: string,
  amount: number
): void {
  paymentsTotal.inc({ provider, status, currency });
  paymentAmount.observe({ provider, currency }, amount);
}

export function recordRefund(status: string): void {
  refundsTotal.inc({ status });
}

export function recordProviderRequest(
  provider: string,
  operation: string,
  status: string,
  durationSeconds: number
): void {
  providerRequestDuration.observe({ provider, operation, status }, durationSeconds);
}

export function recordWebhook(eventType: string, status: string): void {
  webhooksTotal.inc({ event_type: eventType, status });
}

export function recordWebhookRetry(eventType: string): void {
  webhookRetries.inc({ event_type: eventType });
}

export function recordIdempotencyHit(): void {
  idempotencyHits.inc();
}

export function recordIdempotencyMiss(): void {
  idempotencyMisses.inc();
}

export { register };
