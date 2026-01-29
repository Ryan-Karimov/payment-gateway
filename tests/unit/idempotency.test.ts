import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Redis
vi.mock('../../src/config/redis.js', () => ({
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    ttl: vi.fn().mockResolvedValue(3600),
  },
}));

// Mock database
vi.mock('../../src/db/connection.js', () => ({
  query: vi.fn(),
  withLock: vi.fn().mockImplementation(async (_key, callback) => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    return callback(mockClient);
  }),
}));

import { idempotencyService, IdempotencyConflictError } from '../../src/services/idempotency.service.js';
import { redis } from '../../src/config/redis.js';
import { query } from '../../src/db/connection.js';

describe('IdempotencyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('check', () => {
    it('should return not exists for new key', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      const result = await idempotencyService.check('new-key', 'merchant-1', 'hash-123');

      expect(result.exists).toBe(false);
      expect(result.isProcessing).toBe(false);
    });

    it('should return cached response from Redis', async () => {
      const cachedRecord = {
        key: 'cached-key',
        merchant_id: 'merchant-1',
        request_hash: 'hash-123',
        status: 'completed',
        response: { id: 'payment-123' },
        status_code: 201,
      };
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedRecord));

      const result = await idempotencyService.check('cached-key', 'merchant-1', 'hash-123');

      expect(result.exists).toBe(true);
      expect(result.isProcessing).toBe(false);
      expect(result.response).toEqual({ id: 'payment-123' });
      expect(result.statusCode).toBe(201);
    });

    it('should return processing state', async () => {
      const processingRecord = {
        key: 'processing-key',
        merchant_id: 'merchant-1',
        request_hash: 'hash-123',
        status: 'processing',
      };
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(processingRecord));

      const result = await idempotencyService.check('processing-key', 'merchant-1', 'hash-123');

      expect(result.exists).toBe(true);
      expect(result.isProcessing).toBe(true);
    });

    it('should throw on hash mismatch', async () => {
      const cachedRecord = {
        key: 'key-1',
        merchant_id: 'merchant-1',
        request_hash: 'hash-original',
        status: 'completed',
      };
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedRecord));

      await expect(
        idempotencyService.check('key-1', 'merchant-1', 'hash-different')
      ).rejects.toThrow(IdempotencyConflictError);
    });

    it('should fallback to PostgreSQL when not in Redis', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(query).mockResolvedValue({
        rows: [{
          key: 'pg-key',
          merchant_id: 'merchant-1',
          request_hash: 'hash-123',
          status: 'completed',
          response: { id: 'payment-456' },
          status_code: 201,
          expires_at: new Date(Date.now() + 3600000),
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await idempotencyService.check('pg-key', 'merchant-1', 'hash-123');

      expect(result.exists).toBe(true);
      expect(result.response).toEqual({ id: 'payment-456' });
    });
  });

  describe('generateRequestHash', () => {
    it('should generate consistent hash', () => {
      const hash1 = idempotencyService.generateRequestHash(
        { amount: 100 },
        '/api/v1/payments',
        'POST'
      );
      const hash2 = idempotencyService.generateRequestHash(
        { amount: 100 },
        '/api/v1/payments',
        'POST'
      );

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different body', () => {
      const hash1 = idempotencyService.generateRequestHash(
        { amount: 100 },
        '/api/v1/payments',
        'POST'
      );
      const hash2 = idempotencyService.generateRequestHash(
        { amount: 200 },
        '/api/v1/payments',
        'POST'
      );

      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hash for different path', () => {
      const hash1 = idempotencyService.generateRequestHash(
        { amount: 100 },
        '/api/v1/payments',
        'POST'
      );
      const hash2 = idempotencyService.generateRequestHash(
        { amount: 100 },
        '/api/v1/refunds',
        'POST'
      );

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('complete', () => {
    it('should update PostgreSQL and Redis', async () => {
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify({
        key: 'complete-key',
        merchant_id: 'merchant-1',
        status: 'processing',
      }));
      vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1, command: 'UPDATE', oid: 0, fields: [] });

      await idempotencyService.complete(
        'complete-key',
        'merchant-1',
        { id: 'payment-123' },
        201
      );

      expect(query).toHaveBeenCalled();
      expect(redis.setex).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should remove from both storages', async () => {
      vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1, command: 'DELETE', oid: 0, fields: [] });
      vi.mocked(redis.del).mockResolvedValue(1);

      await idempotencyService.remove('remove-key', 'merchant-1');

      expect(query).toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalled();
    });
  });
});
