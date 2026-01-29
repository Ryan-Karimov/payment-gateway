import { describe, it, expect } from 'vitest';
import {
  generateHmacSignature,
  verifyHmacSignature,
  hashString,
  generateApiKey,
  generateIdempotencyKey,
  hashApiKey,
  verifyApiKey,
} from '../../src/utils/crypto.js';

describe('Crypto utilities', () => {
  describe('generateHmacSignature', () => {
    it('should generate consistent HMAC signatures', () => {
      const payload = '{"amount": 100}';
      const secret = 'test-secret';

      const sig1 = generateHmacSignature(payload, secret);
      const sig2 = generateHmacSignature(payload, secret);

      expect(sig1).toBe(sig2);
      expect(sig1).toHaveLength(64); // SHA256 hex length
    });

    it('should generate different signatures for different payloads', () => {
      const secret = 'test-secret';

      const sig1 = generateHmacSignature('payload1', secret);
      const sig2 = generateHmacSignature('payload2', secret);

      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different secrets', () => {
      const payload = 'test-payload';

      const sig1 = generateHmacSignature(payload, 'secret1');
      const sig2 = generateHmacSignature(payload, 'secret2');

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifyHmacSignature', () => {
    it('should verify valid signatures', () => {
      const payload = '{"test": true}';
      const secret = 'my-secret';
      const signature = generateHmacSignature(payload, secret);

      expect(verifyHmacSignature(payload, signature, secret)).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const payload = '{"test": true}';
      const secret = 'my-secret';

      expect(verifyHmacSignature(payload, 'invalid-signature', secret)).toBe(false);
    });

    it('should reject signatures with wrong secret', () => {
      const payload = '{"test": true}';
      const signature = generateHmacSignature(payload, 'secret1');

      expect(verifyHmacSignature(payload, signature, 'secret2')).toBe(false);
    });
  });

  describe('hashString', () => {
    it('should generate consistent hashes', () => {
      const input = 'test-string';

      const hash1 = hashString(input);
      const hash2 = hashString(input);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should generate different hashes for different inputs', () => {
      const hash1 = hashString('input1');
      const hash2 = hashString('input2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateApiKey', () => {
    it('should generate keys with correct prefix', () => {
      const key = generateApiKey();

      expect(key).toMatch(/^sk_live_/);
    });

    it('should generate unique keys', () => {
      const keys = new Set<string>();

      for (let i = 0; i < 100; i++) {
        keys.add(generateApiKey());
      }

      expect(keys.size).toBe(100);
    });
  });

  describe('generateIdempotencyKey', () => {
    it('should generate 32 character hex strings', () => {
      const key = generateIdempotencyKey();

      expect(key).toHaveLength(32);
      expect(key).toMatch(/^[a-f0-9]+$/);
    });

    it('should generate unique keys', () => {
      const keys = new Set<string>();

      for (let i = 0; i < 100; i++) {
        keys.add(generateIdempotencyKey());
      }

      expect(keys.size).toBe(100);
    });
  });

  describe('hashApiKey', () => {
    it('should generate consistent hashes with prefix', () => {
      const apiKey = 'sk_test_abc123';

      const hash1 = hashApiKey(apiKey);
      const hash2 = hashApiKey(apiKey);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^sha256:/);
    });

    it('should generate different hashes for different keys', () => {
      const hash1 = hashApiKey('sk_test_key1');
      const hash2 = hashApiKey('sk_test_key2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyApiKey', () => {
    it('should verify valid API key', () => {
      const apiKey = 'sk_test_abc123';
      const storedHash = hashApiKey(apiKey);

      expect(verifyApiKey(apiKey, storedHash)).toBe(true);
    });

    it('should reject invalid API key', () => {
      const storedHash = hashApiKey('sk_test_correct');

      expect(verifyApiKey('sk_test_wrong', storedHash)).toBe(false);
    });
  });
});
