// Initialize tracing before other imports (must be first)
import { initTracing, shutdownTracing } from './config/tracing.js';
initTracing();

// Initialize Sentry
import { initSentry, captureException } from './config/sentry.js';
initSentry();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config/index.js';
import { checkDatabaseConnection, closeDatabase } from './config/database.js';
import { checkRedisConnection, closeRedis } from './config/redis.js';
import { connectRabbitMQ, closeRabbitMQ } from './config/rabbitmq.js';
import { setupSwagger, paymentSchemas } from './config/swagger.js';
import { setupRateLimit } from './config/rate-limit.js';
import { setupMetrics } from './config/metrics.js';
import { paymentRoutes } from './routes/payments.js';
import { refundRoutes } from './routes/refunds.js';
import { webhookRoutes } from './routes/webhooks.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestIdMiddleware, getRequestContext } from './middleware/request-id.js';
import { startWebhookWorker } from './workers/webhook.worker.js';
import { getAllCircuitBreakerStats } from './utils/circuit-breaker.js';
import { logger } from './utils/logger.js';

const fastify = Fastify({
  logger: {
    level: config.logging.level,
    transport: config.server.nodeEnv === 'development' ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    } : undefined,
  },
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'requestId',
});

// Register plugins
await fastify.register(cors, {
  origin: true,
  credentials: true,
});

// Setup Request ID middleware for distributed tracing
requestIdMiddleware(fastify);

// Setup Swagger documentation
await setupSwagger(fastify);

// Setup rate limiting
await setupRateLimit(fastify);

// Setup Prometheus metrics
await setupMetrics(fastify);

// Register error handler
fastify.setErrorHandler(errorHandler);

// Health check
fastify.get('/health', {
  schema: paymentSchemas.healthCheck,
}, async (_request, reply) => {
  const dbOk = await checkDatabaseConnection();
  const redisOk = await checkRedisConnection();

  const healthy = dbOk && redisOk;

  return reply.code(healthy ? 200 : 503).send({
    status: healthy ? 'healthy' : 'unhealthy',
    checks: {
      database: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
    },
    timestamp: new Date().toISOString(),
  });
});

// Readiness check (includes circuit breaker status)
fastify.get('/ready', async (_request, reply) => {
  const dbOk = await checkDatabaseConnection();
  const redisOk = await checkRedisConnection();
  const circuitBreakers = getAllCircuitBreakerStats();

  // Check if any circuit breaker is open
  const openCircuits = circuitBreakers.filter(cb => cb.state === 'open');

  const ready = dbOk && redisOk && openCircuits.length === 0;

  return reply.code(ready ? 200 : 503).send({
    status: ready ? 'ready' : 'not_ready',
    checks: {
      database: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
      circuitBreakers: {
        total: circuitBreakers.length,
        open: openCircuits.map(cb => cb.name),
      },
    },
    timestamp: new Date().toISOString(),
  });
});

// Register routes
await fastify.register(paymentRoutes, { prefix: '/api/v1/payments' });
await fastify.register(refundRoutes, { prefix: '/api/v1' });
await fastify.register(webhookRoutes, { prefix: '/api/v1/webhooks' });

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Received shutdown signal');

  try {
    await fastify.close();
    await closeRabbitMQ();
    await closeRedis();
    await closeDatabase();
    await shutdownTracing();

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    captureException(error as Error);
    logger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
async function start(): Promise<void> {
  try {
    // Check database connection
    const dbOk = await checkDatabaseConnection();
    if (!dbOk) {
      throw new Error('Database connection failed');
    }
    logger.info('Database connected');

    // Check Redis connection
    const redisOk = await checkRedisConnection();
    if (!redisOk) {
      throw new Error('Redis connection failed');
    }
    logger.info('Redis connected');

    // Connect to RabbitMQ and start webhook worker
    try {
      await connectRabbitMQ();
      await startWebhookWorker();
      logger.info('RabbitMQ connected and webhook worker started');
    } catch (error) {
      logger.warn({ error }, 'RabbitMQ not available, webhooks will be processed synchronously');
    }

    // Start Fastify server
    await fastify.listen({
      port: config.server.port,
      host: config.server.host,
    });

    logger.info(
      { port: config.server.port, host: config.server.host },
      'Payment Gateway server started'
    );

    logger.info('');
    logger.info('Available endpoints:');
    logger.info('  POST   /api/v1/payments              - Create payment');
    logger.info('  GET    /api/v1/payments              - List payments');
    logger.info('  GET    /api/v1/payments/:id          - Get payment');
    logger.info('  POST   /api/v1/payments/:id/refunds  - Create refund');
    logger.info('  GET    /api/v1/payments/:id/refundable - Get refundable amount');
    logger.info('  GET    /api/v1/refunds/:id           - Get refund');
    logger.info('  POST   /api/v1/webhooks/:provider    - Provider webhook');
    logger.info('  GET    /health                       - Health check');
    logger.info('  GET    /ready                        - Readiness check');
    logger.info('  GET    /metrics                      - Prometheus metrics');
    logger.info('  GET    /docs                         - Swagger UI');

  } catch (error) {
    captureException(error as Error);
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
