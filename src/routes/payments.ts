import { FastifyInstance } from 'fastify';
import { paymentService } from '../services/payment.service.js';
import { apiKeyAuth, requirePermission } from '../middleware/api-key-auth.js';
import {
  idempotencyMiddleware,
  idempotencyComplete,
  idempotencyRemove,
} from '../middleware/idempotency.js';
import { PaymentStatus } from '../models/payment.js';
import { getTransactionsByPaymentId } from '../models/transaction.js';
import { getRefundsByPaymentId } from '../models/refund.js';
import { paymentSchemas } from '../config/swagger.js';
import { paymentRateLimit } from '../config/rate-limit.js';
import { recordPayment } from '../config/metrics.js';

interface CreatePaymentBody {
  external_id?: string;
  amount: number;
  currency: string;
  provider: string;
  description?: string;
  metadata?: Record<string, unknown>;
  webhook_url?: string;
}

interface GetPaymentsQuery {
  limit?: number;
  offset?: number;
  status?: PaymentStatus;
}

interface PaymentParams {
  id: string;
}

export async function paymentRoutes(fastify: FastifyInstance): Promise<void> {
  // Apply API key auth to all routes
  fastify.addHook('preHandler', apiKeyAuth);

  // Create payment
  fastify.post<{ Body: CreatePaymentBody }>(
    '/',
    {
      schema: paymentSchemas.createPayment,
      preHandler: [
        requirePermission('payments:write'),
        idempotencyMiddleware,
      ],
      ...paymentRateLimit,
    },
    async (request, reply) => {
      const { body, merchantId, idempotencyKey } = request;

      if (!merchantId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      try {
        const result = await paymentService.processPayment(
          {
            external_id: body.external_id,
            merchant_id: merchantId,
            amount: body.amount,
            currency: body.currency,
            provider: body.provider,
            description: body.description,
            metadata: body.metadata,
            webhook_url: body.webhook_url,
          },
          {
            actor: merchantId,
            actor_type: 'merchant',
            ip_address: request.ip,
            user_agent: request.headers['user-agent'],
          }
        );

        // Record metrics
        recordPayment(
          result.payment.provider,
          result.payment.status,
          result.payment.currency,
          body.amount
        );

        const statusCode = result.success ? 201 : 200;
        const response = {
          id: result.payment.id,
          external_id: result.payment.external_id,
          amount: result.payment.amount,
          currency: result.payment.currency,
          status: result.payment.status,
          provider: result.payment.provider,
          provider_transaction_id: result.payment.provider_transaction_id,
          description: result.payment.description,
          metadata: result.payment.metadata,
          created_at: result.payment.created_at,
          updated_at: result.payment.updated_at,
        };

        if (idempotencyKey) {
          await idempotencyComplete(request, response, statusCode);
        }

        return reply.code(statusCode).send(response);
      } catch (error) {
        if (idempotencyKey) {
          await idempotencyRemove(request);
        }
        throw error;
      }
    }
  );

  // Get payments list
  fastify.get<{ Querystring: GetPaymentsQuery }>(
    '/',
    {
      schema: paymentSchemas.getPayments,
      preHandler: requirePermission('payments:read'),
    },
    async (request, reply) => {
      const { merchantId } = request;
      const { limit = 20, offset = 0, status } = request.query;

      if (!merchantId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const result = await paymentService.getPayments(merchantId, {
        limit,
        offset,
        status,
      });

      return reply.send({
        data: result.payments.map(p => ({
          id: p.id,
          external_id: p.external_id,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          provider: p.provider,
          created_at: p.created_at,
        })),
        pagination: {
          total: result.total,
          limit,
          offset,
          has_more: offset + result.payments.length < result.total,
        },
      });
    }
  );

  // Get single payment
  fastify.get<{ Params: PaymentParams }>(
    '/:id',
    {
      schema: paymentSchemas.getPayment,
      preHandler: requirePermission('payments:read'),
    },
    async (request, reply) => {
      const { id } = request.params;
      const { merchantId } = request;

      const payment = await paymentService.getPayment(id);

      if (!payment) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Payment ${id} not found`,
        });
      }

      // Verify merchant ownership
      if (payment.merchant_id !== merchantId) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Payment ${id} not found`,
        });
      }

      // Get transaction history
      const transactions = await getTransactionsByPaymentId(id);

      // Get refunds
      const refunds = await getRefundsByPaymentId(id);

      return reply.send({
        id: payment.id,
        external_id: payment.external_id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        provider: payment.provider,
        provider_transaction_id: payment.provider_transaction_id,
        description: payment.description,
        metadata: payment.metadata,
        webhook_url: payment.webhook_url,
        created_at: payment.created_at,
        updated_at: payment.updated_at,
        transactions: transactions.map(t => ({
          id: t.id,
          status: t.status,
          created_at: t.created_at,
        })),
        refunds: refunds.map(r => ({
          id: r.id,
          amount: r.amount,
          status: r.status,
          reason: r.reason,
          created_at: r.created_at,
        })),
      });
    }
  );
}
