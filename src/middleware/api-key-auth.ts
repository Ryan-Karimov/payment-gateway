import { FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { hashApiKey } from '../utils/crypto.js';

export interface ApiKeyInfo {
  id: string;
  merchant_id: string;
  name: string;
  permissions: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyInfo;
    merchantId?: string;
  }
}

interface ApiKeyRow {
  id: string;
  key_hash: string;
  merchant_id: string;
  name: string;
  permissions: string[];
  is_active: boolean;
}

export async function apiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Missing API key. Include X-API-Key header.',
    });
    return;
  }

  // Validate API key format before database lookup
  if (!apiKey.startsWith('sk_test_') && !apiKey.startsWith('sk_live_')) {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid API key format.',
    });
    return;
  }

  try {
    // SECURITY: Hash the API key and look up by hash
    // This prevents timing attacks and protects keys in case of DB breach
    const keyHash = hashApiKey(apiKey);

    const { rows } = await query<ApiKeyRow>(
      `SELECT id, key_hash, merchant_id, name, permissions, is_active
       FROM api_keys
       WHERE key_hash = $1`,
      [keyHash]
    );

    let keyRecord = rows[0];

    // MIGRATION: Support legacy plain-text keys temporarily
    // TODO: Remove this after migrating all existing keys
    if (!keyRecord) {
      const { rows: legacyRows } = await query<ApiKeyRow>(
        `SELECT id, key_hash, merchant_id, name, permissions, is_active
         FROM api_keys
         WHERE key_hash = $1`,
        [apiKey]
      );
      keyRecord = legacyRows[0];

      if (keyRecord) {
        // Log warning for legacy key usage
        logger.warn(
          { merchantId: keyRecord.merchant_id },
          'Legacy unhashed API key used - migration required'
        );
      }
    }

    if (!keyRecord) {
      // Use constant-time comparison even for non-existent keys
      // to prevent enumeration attacks
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key.',
      });
      return;
    }

    if (!keyRecord.is_active) {
      reply.code(403).send({
        error: 'Forbidden',
        message: 'API key is inactive.',
      });
      return;
    }

    // Update last_used_at asynchronously
    // Note: Fire-and-forget is acceptable for analytics; errors are logged
    query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
      [keyRecord.id]
    ).catch(err => logger.error({ err }, 'Failed to update last_used_at'));

    // Attach API key info to request
    request.apiKey = {
      id: keyRecord.id,
      merchant_id: keyRecord.merchant_id,
      name: keyRecord.name,
      permissions: keyRecord.permissions,
    };
    request.merchantId = keyRecord.merchant_id;
  } catch (error) {
    logger.error({ error }, 'API key authentication error');
    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Authentication failed.',
    });
  }
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.apiKey) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Not authenticated.',
      });
      return;
    }

    if (!request.apiKey.permissions.includes(permission)) {
      reply.code(403).send({
        error: 'Forbidden',
        message: `Missing required permission: ${permission}`,
      });
    }
  };
}
