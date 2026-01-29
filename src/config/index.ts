import dotenv from 'dotenv';

dotenv.config();

// SECURITY: Validate that required secrets are set in production
const nodeEnv = process.env['NODE_ENV'] || 'development';
const isProduction = nodeEnv === 'production';

function requireEnvInProduction(key: string, defaultValue: string): string {
  const value = process.env[key];
  if (isProduction && !value) {
    throw new Error(`SECURITY: Required environment variable ${key} is not set in production`);
  }
  return value || defaultValue;
}

export const config = {
  server: {
    port: parseInt(process.env['PORT'] || '3000', 10),
    host: process.env['HOST'] || '0.0.0.0',
    nodeEnv,
    isProduction,
  },
  database: {
    url: requireEnvInProduction('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/payment_gateway'),
    host: process.env['DB_HOST'] || 'localhost',
    port: parseInt(process.env['DB_PORT'] || '5432', 10),
    name: process.env['DB_NAME'] || 'payment_gateway',
    user: process.env['DB_USER'] || 'postgres',
    password: requireEnvInProduction('DB_PASSWORD', 'postgres'),
    poolSize: parseInt(process.env['DB_POOL_SIZE'] || '10', 10),
    ssl: process.env['DB_SSL'] === 'true',
  },
  redis: {
    url: process.env['REDIS_URL'] || 'redis://localhost:6379',
    host: process.env['REDIS_HOST'] || 'localhost',
    port: parseInt(process.env['REDIS_PORT'] || '6379', 10),
    password: process.env['REDIS_PASSWORD'] || undefined,
  },
  rabbitmq: {
    url: requireEnvInProduction('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672'),
    host: process.env['RABBITMQ_HOST'] || 'localhost',
    port: parseInt(process.env['RABBITMQ_PORT'] || '5672', 10),
    user: process.env['RABBITMQ_USER'] || 'guest',
    password: requireEnvInProduction('RABBITMQ_PASSWORD', 'guest'),
  },
  webhook: {
    secret: (() => {
      const secret = process.env['WEBHOOK_SECRET'];
      if (isProduction && !secret) {
        throw new Error('SECURITY: WEBHOOK_SECRET must be set in production');
      }
      if (!isProduction && !secret) {
        console.warn('WARNING: Using default webhook secret. Set WEBHOOK_SECRET in production.');
        return 'dev-only-default-secret-do-not-use-in-prod';
      }
      return secret!;
    })(),
    maxRetries: parseInt(process.env['WEBHOOK_MAX_RETRIES'] || '5', 10),
    retryDelays: (process.env['WEBHOOK_RETRY_DELAYS'] || '60000,300000,900000,3600000')
      .split(',')
      .map(d => parseInt(d, 10)),
  },
  idempotency: {
    ttlSeconds: parseInt(process.env['IDEMPOTENCY_TTL_SECONDS'] || '86400', 10),
  },
  logging: {
    level: process.env['LOG_LEVEL'] || 'info',
  },
  tracing: {
    enabled: process.env['TRACING_ENABLED'] === 'true',
    jaegerEndpoint: process.env['JAEGER_ENDPOINT'] || 'http://localhost:14268/api/traces',
  },
  sentry: {
    dsn: process.env['SENTRY_DSN'] || '',
  },
  circuitBreaker: {
    timeout: parseInt(process.env['CIRCUIT_BREAKER_TIMEOUT'] || '10000', 10),
    errorThresholdPercentage: parseInt(process.env['CIRCUIT_BREAKER_ERROR_THRESHOLD'] || '50', 10),
    resetTimeout: parseInt(process.env['CIRCUIT_BREAKER_RESET_TIMEOUT'] || '30000', 10),
  },
} as const;

export type Config = typeof config;
