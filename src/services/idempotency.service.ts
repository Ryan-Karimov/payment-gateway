import { redis } from '../config/redis.js';
import { query, withLock } from '../db/connection.js';
import { hashString } from '../utils/crypto.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface IdempotencyRecord {
  key: string;
  merchant_id: string;
  request_hash: string;
  request_path: string;
  request_method: string;
  response: Record<string, unknown> | null;
  status_code: number | null;
  status: 'processing' | 'completed';
  created_at: Date;
  expires_at: Date;
}

export interface IdempotencyResult {
  exists: boolean;
  isProcessing: boolean;
  response?: Record<string, unknown>;
  statusCode?: number;
}

class IdempotencyService {
  private readonly ttlSeconds = config.idempotency.ttlSeconds;
  private readonly redisKeyPrefix = 'idempotency:';

  async check(
    key: string,
    merchantId: string,
    requestHash: string
  ): Promise<IdempotencyResult> {
    // First check Redis for fast lookup
    const redisKey = this.getRedisKey(key, merchantId);
    const cached = await redis.get(redisKey);

    if (cached) {
      const record = JSON.parse(cached) as IdempotencyRecord;

      // Verify request hash matches
      if (record.request_hash !== requestHash) {
        throw new IdempotencyConflictError(
          'Idempotency key has already been used with different request parameters'
        );
      }

      if (record.status === 'processing') {
        return { exists: true, isProcessing: true };
      }

      return {
        exists: true,
        isProcessing: false,
        response: record.response || undefined,
        statusCode: record.status_code || undefined,
      };
    }

    // Check PostgreSQL as backup
    const { rows } = await query<IdempotencyRecord>(
      `SELECT * FROM idempotency_keys
       WHERE key = $1 AND merchant_id = $2 AND expires_at > NOW()`,
      [key, merchantId]
    );

    const record = rows[0];

    if (record) {
      if (record.request_hash !== requestHash) {
        throw new IdempotencyConflictError(
          'Idempotency key has already been used with different request parameters'
        );
      }

      // Sync to Redis
      await this.cacheRecord(record);

      if (record.status === 'processing') {
        return { exists: true, isProcessing: true };
      }

      return {
        exists: true,
        isProcessing: false,
        response: record.response || undefined,
        statusCode: record.status_code || undefined,
      };
    }

    return { exists: false, isProcessing: false };
  }

  async startProcessing(
    key: string,
    merchantId: string,
    requestHash: string,
    requestPath: string,
    requestMethod: string
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    // Use advisory lock to prevent race conditions
    await withLock(`idempotency:${key}:${merchantId}`, async (client) => {
      // Double-check it doesn't exist
      const { rows } = await client.query<IdempotencyRecord>(
        `SELECT * FROM idempotency_keys
         WHERE key = $1 AND merchant_id = $2 AND expires_at > NOW()`,
        [key, merchantId]
      );

      if (rows[0]) {
        if (rows[0].request_hash !== requestHash) {
          throw new IdempotencyConflictError(
            'Idempotency key has already been used with different request parameters'
          );
        }
        // Already exists, another process created it
        return;
      }

      // Insert new record
      await client.query(
        `INSERT INTO idempotency_keys (
          key, merchant_id, request_hash, request_path, request_method, status, expires_at
        ) VALUES ($1, $2, $3, $4, $5, 'processing', $6)
        ON CONFLICT (key) DO NOTHING`,
        [key, merchantId, requestHash, requestPath, requestMethod, expiresAt]
      );
    });

    // Cache in Redis
    const record: Partial<IdempotencyRecord> = {
      key,
      merchant_id: merchantId,
      request_hash: requestHash,
      request_path: requestPath,
      request_method: requestMethod,
      status: 'processing',
      expires_at: expiresAt,
    };

    await redis.setex(
      this.getRedisKey(key, merchantId),
      this.ttlSeconds,
      JSON.stringify(record)
    );

    logger.debug({ key, merchantId }, 'Idempotency processing started');
  }

  async complete(
    key: string,
    merchantId: string,
    response: Record<string, unknown>,
    statusCode: number
  ): Promise<void> {
    // Update PostgreSQL
    await query(
      `UPDATE idempotency_keys
       SET status = 'completed', response = $1, status_code = $2
       WHERE key = $3 AND merchant_id = $4`,
      [JSON.stringify(response), statusCode, key, merchantId]
    );

    // Update Redis cache
    const redisKey = this.getRedisKey(key, merchantId);
    const cached = await redis.get(redisKey);

    if (cached) {
      const record = JSON.parse(cached) as IdempotencyRecord;
      record.status = 'completed';
      record.response = response;
      record.status_code = statusCode;

      const ttl = await redis.ttl(redisKey);
      if (ttl > 0) {
        await redis.setex(redisKey, ttl, JSON.stringify(record));
      }
    }

    logger.debug({ key, merchantId }, 'Idempotency completed');
  }

  async remove(key: string, merchantId: string): Promise<void> {
    await query(
      'DELETE FROM idempotency_keys WHERE key = $1 AND merchant_id = $2',
      [key, merchantId]
    );

    await redis.del(this.getRedisKey(key, merchantId));

    logger.debug({ key, merchantId }, 'Idempotency key removed');
  }

  generateRequestHash(body: unknown, path: string, method: string): string {
    const data = JSON.stringify({ body, path, method });
    return hashString(data);
  }

  private getRedisKey(key: string, merchantId: string): string {
    return `${this.redisKeyPrefix}${merchantId}:${key}`;
  }

  private async cacheRecord(record: IdempotencyRecord): Promise<void> {
    const redisKey = this.getRedisKey(record.key, record.merchant_id);
    const ttl = Math.max(
      0,
      Math.floor((record.expires_at.getTime() - Date.now()) / 1000)
    );

    if (ttl > 0) {
      await redis.setex(redisKey, ttl, JSON.stringify(record));
    }
  }
}

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class IdempotencyProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyProcessingError';
  }
}

export const idempotencyService = new IdempotencyService();
