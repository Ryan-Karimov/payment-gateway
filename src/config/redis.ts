import Redis from 'ioredis';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('error', (err) => {
  logger.error({ error: err.message }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Connected to Redis');
});

export async function checkRedisConnection(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch (error) {
    console.error('Redis connection failed:', error);
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
