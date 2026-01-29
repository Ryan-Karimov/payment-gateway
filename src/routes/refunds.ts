import { FastifyInstance } from 'fastify';
import { refundService, RefundValidationError } from '../services/refund.service.js';
import { paymentService } from '../services/payment.service.js';
import { apiKeyAuth, requirePermission } from '../middleware/api-key-auth.js';
import {
  idempotencyMiddleware,
  idempotencyComplete,
  idempotencyRemove,
} from '../middleware/idempotency.js';
import { paymentSchemas } from '../config/swagger.js';
import { refundRateLimit } from '../config/rate-limit.js';
import { recordRefund } from '../config/metrics.js';

interface CreateRefundBody {
  amount: number;
  reason?: string;
}

interface PaymentParams {
  id: string;
}

interface RefundParams {
  id: string;
}

export async function refundRoutes(fastify: FastifyInstance): Promise<void> {
  // Apply API key auth to all routes
  fastify.addHook('preHandler', apiKeyAuth);

  // Create refund for a payment
  fastify.post<{ Params: PaymentParams; Body: CreateRefundBody }>(
    '/payments/:id/refunds',
    {
      schema: paymentSchemas.createRefund,
      preHandler: [
        requirePermission('refunds:write'),
        idempotencyMiddleware,
      ],
      ...refundRateLimit,
    },
    async (request, reply) => {
      const { id: paymentId } = request.params;
      const { amount, reason } = request.body;
      const { merchantId, idempotencyKey } = request;

      if (!merchantId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Verify payment ownership
      const payment = await paymentService.getPayment(paymentId);
      if (!payment || payment.merchant_id !== merchantId) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Payment ${paymentId} not found`,
        });
      }

      try {
        const result = await refundService.createRefund(
          {
            payment_id: paymentId,
            amount,
            reason,
          },
          {
            actor: merchantId,
            actor_type: 'merchant',
            ip_address: request.ip,
            user_agent: request.headers['user-agent'],
          }
        );

        // Record metrics
        recordRefund(result.refund.status);

        const statusCode = result.success ? 201 : 200;
        const response = {
          id: result.refund.id,
          payment_id: result.refund.payment_id,
          amount: result.refund.amount,
          status: result.refund.status,
          reason: result.refund.reason,
          provider_refund_id: result.refund.provider_refund_id,
          created_at: result.refund.created_at,
          payment_status: result.payment.status,
          ...(result.error && { error: result.error }),
        };

        if (idempotencyKey) {
          await idempotencyComplete(request, response, statusCode);
        }

        return reply.code(statusCode).send(response);
      } catch (error) {
        if (idempotencyKey) {
          await idempotencyRemove(request);
        }

        if (error instanceof RefundValidationError) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: error.message,
          });
        }

        throw error;
      }
    }
  );

  // Get refund by ID
  fastify.get<{ Params: RefundParams }>(
    '/refunds/:id',
    {
      schema: paymentSchemas.getRefund,
      preHandler: requirePermission('payments:read'),
    },
    async (request, reply) => {
      const { id } = request.params;
      const { merchantId } = request;

      const refund = await refundService.getRefund(id);

      if (!refund) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Refund ${id} not found`,
        });
      }

      // Verify merchant ownership via payment
      const payment = await paymentService.getPayment(refund.payment_id);
      if (!payment || payment.merchant_id !== merchantId) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Refund ${id} not found`,
        });
      }

      return reply.send({
        id: refund.id,
        payment_id: refund.payment_id,
        amount: refund.amount,
        status: refund.status,
        reason: refund.reason,
        provider_refund_id: refund.provider_refund_id,
        created_at: refund.created_at,
        updated_at: refund.updated_at,
      });
    }
  );

  // Get refundable amount for a payment
  fastify.get<{ Params: PaymentParams }>(
    '/payments/:id/refundable',
    {
      schema: paymentSchemas.getRefundable,
      preHandler: requirePermission('payments:read'),
    },
    async (request, reply) => {
      const { id: paymentId } = request.params;
      const { merchantId } = request;

      // Verify payment ownership
      const payment = await paymentService.getPayment(paymentId);
      if (!payment || payment.merchant_id !== merchantId) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Payment ${paymentId} not found`,
        });
      }

      try {
        const info = await refundService.getRefundableAmount(paymentId);
        return reply.send(info);
      } catch (error) {
        if (error instanceof RefundValidationError) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: error.message,
          });
        }
        throw error;
      }
    }
  );
}
