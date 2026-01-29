import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger.js';
import { PaymentValidationError, PaymentNotFoundError } from '../services/payment.service.js';
import { RefundValidationError } from '../services/refund.service.js';
import { IdempotencyConflictError } from '../services/idempotency.service.js';
import { ProviderError } from '../providers/base.provider.js';
import { WebhookUrlValidationError } from '../services/webhook.service.js';

export interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  logger.error(
    {
      error: {
        message: error.message,
        code: error.code,
        stack: error.stack,
      },
      request: {
        method: request.method,
        url: request.url,
        merchantId: request.merchantId,
      },
    },
    'Request error'
  );

  // Validation errors
  if (
    error instanceof PaymentValidationError ||
    error instanceof RefundValidationError ||
    error instanceof WebhookUrlValidationError
  ) {
    reply.code(400).send({
      error: 'Bad Request',
      message: error.message,
      code: 'VALIDATION_ERROR',
    } satisfies ErrorResponse);
    return;
  }

  // Not found errors
  if (error instanceof PaymentNotFoundError) {
    reply.code(404).send({
      error: 'Not Found',
      message: error.message,
      code: 'NOT_FOUND',
    } satisfies ErrorResponse);
    return;
  }

  // Idempotency conflicts
  if (error instanceof IdempotencyConflictError) {
    reply.code(409).send({
      error: 'Conflict',
      message: error.message,
      code: 'IDEMPOTENCY_CONFLICT',
    } satisfies ErrorResponse);
    return;
  }

  // Provider errors
  if (error instanceof ProviderError) {
    reply.code(502).send({
      error: 'Bad Gateway',
      message: error.message,
      code: error.code,
      details: {
        provider: error.provider,
      },
    } satisfies ErrorResponse);
    return;
  }

  // Fastify validation errors
  if (error.validation) {
    reply.code(400).send({
      error: 'Bad Request',
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: {
        validation: error.validation,
      },
    } satisfies ErrorResponse);
    return;
  }

  // Default error
  const statusCode = error.statusCode || 500;
  reply.code(statusCode).send({
    error: statusCode >= 500 ? 'Internal Server Error' : 'Error',
    message: statusCode >= 500 ? 'An unexpected error occurred' : error.message,
    code: error.code || 'UNKNOWN_ERROR',
  } satisfies ErrorResponse);
}
