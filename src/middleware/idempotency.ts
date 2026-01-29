import { FastifyRequest, FastifyReply } from 'fastify';
import {
  idempotencyService,
  IdempotencyConflictError,
} from '../services/idempotency.service.js';
import { logger } from '../utils/logger.js';

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
  }
}

export async function idempotencyMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Only apply to mutating methods
  if (!['POST', 'PUT', 'PATCH'].includes(request.method)) {
    return;
  }

  const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

  if (!idempotencyKey) {
    // Idempotency key is optional but recommended
    return;
  }

  if (!request.merchantId) {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Merchant ID not found',
    });
    return;
  }

  request.idempotencyKey = idempotencyKey;

  const requestHash = idempotencyService.generateRequestHash(
    request.body,
    request.url,
    request.method
  );

  try {
    const result = await idempotencyService.check(
      idempotencyKey,
      request.merchantId,
      requestHash
    );

    if (result.exists) {
      if (result.isProcessing) {
        reply.code(409).send({
          error: 'Conflict',
          message: 'A request with this idempotency key is currently being processed',
        });
        return;
      }

      // Return cached response
      logger.debug(
        { idempotencyKey },
        'Returning cached response for idempotency key'
      );

      reply
        .code(result.statusCode || 200)
        .send(result.response);
      return;
    }

    // Start processing
    await idempotencyService.startProcessing(
      idempotencyKey,
      request.merchantId,
      requestHash,
      request.url,
      request.method
    );
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      reply.code(409).send({
        error: 'Conflict',
        message: error.message,
      });
      return;
    }

    logger.error({ error }, 'Idempotency check failed');
    // Continue without idempotency on error
  }
}

export async function idempotencyComplete(
  request: FastifyRequest,
  response: Record<string, unknown>,
  statusCode: number
): Promise<void> {
  if (!request.idempotencyKey || !request.merchantId) {
    return;
  }

  try {
    await idempotencyService.complete(
      request.idempotencyKey,
      request.merchantId,
      response,
      statusCode
    );
  } catch (error) {
    logger.error({ error }, 'Failed to complete idempotency');
  }
}

export async function idempotencyRemove(request: FastifyRequest): Promise<void> {
  if (!request.idempotencyKey || !request.merchantId) {
    return;
  }

  try {
    await idempotencyService.remove(request.idempotencyKey, request.merchantId);
  } catch (error) {
    logger.error({ error }, 'Failed to remove idempotency key');
  }
}
