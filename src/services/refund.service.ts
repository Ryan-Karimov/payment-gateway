import {
  createRefund,
  getRefundById,
  getRefundsByPaymentId,
  updateRefund,
  getTotalRefundedAmount,
  getPendingRefundsAmount,
  Refund,
  RefundStatus,
} from '../models/refund.js';
import {
  getPaymentById,
  updatePayment,
  Payment,
  PaymentStatus,
} from '../models/payment.js';
import { createTransaction } from '../models/transaction.js';
import { getProvider } from '../providers/index.js';
import { auditService, AuditContext } from './audit.service.js';
import { webhookService } from './webhook.service.js';
import { withTransaction } from '../db/connection.js';
import { logger } from '../utils/logger.js';

export interface CreateRefundInput {
  payment_id: string;
  amount: number;
  reason?: string;
}

export interface RefundResult {
  refund: Refund;
  payment: Payment;
  success: boolean;
  error?: string;
}

class RefundService {
  async createRefund(
    input: CreateRefundInput,
    auditContext?: AuditContext
  ): Promise<RefundResult> {
    return withTransaction(async (client) => {
      // Get payment with lock
      const { rows: paymentRows } = await client.query<Payment>(
        'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
        [input.payment_id]
      );

      const payment = paymentRows[0];
      if (!payment) {
        throw new RefundValidationError('Payment not found');
      }

      // Validate payment status
      if (!['completed', 'partially_refunded'].includes(payment.status)) {
        throw new RefundValidationError(
          `Cannot refund payment with status: ${payment.status}`
        );
      }

      // Validate refund amount
      if (input.amount <= 0) {
        throw new RefundValidationError('Refund amount must be greater than 0');
      }

      const paymentAmount = parseFloat(payment.amount);
      const totalRefunded = await getTotalRefundedAmount(payment.id, client);
      const pendingRefunds = await getPendingRefundsAmount(payment.id, client);
      const availableForRefund = paymentAmount - totalRefunded - pendingRefunds;

      if (input.amount > availableForRefund) {
        throw new RefundValidationError(
          `Refund amount ${input.amount} exceeds available amount ${availableForRefund.toFixed(2)}`
        );
      }

      // Create refund record
      const refund = await createRefund(
        {
          payment_id: input.payment_id,
          amount: input.amount,
          reason: input.reason,
        },
        client
      );

      await auditService.logRefundCreated(
        refund.id,
        {
          payment_id: refund.payment_id,
          amount: refund.amount,
          reason: refund.reason,
        },
        auditContext,
        client
      );

      // Process with provider
      try {
        const provider = getProvider(payment.provider);

        if (!payment.provider_transaction_id) {
          throw new RefundValidationError('Payment has no provider transaction ID');
        }

        const response = await provider.processRefund({
          transactionId: payment.provider_transaction_id,
          amount: input.amount,
          reason: input.reason,
        });

        const newRefundStatus: RefundStatus = response.success ? 'completed' : 'failed';

        await updateRefund(
          refund.id,
          {
            status: newRefundStatus,
            provider_refund_id: response.refundId,
          },
          client
        );

        await auditService.logRefundStatusChanged(
          refund.id,
          'pending',
          newRefundStatus,
          auditContext,
          client
        );

        if (response.success) {
          // Update payment status
          const newTotalRefunded = totalRefunded + input.amount;
          const newPaymentStatus: PaymentStatus =
            newTotalRefunded >= paymentAmount ? 'refunded' : 'partially_refunded';

          await client.query(
            'UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2',
            [newPaymentStatus, payment.id]
          );

          await createTransaction(
            {
              payment_id: payment.id,
              status: newPaymentStatus,
              provider_response: {
                refund_id: response.refundId,
                refund_amount: input.amount,
              },
            },
            client
          );

          await auditService.logPaymentStatusChanged(
            payment.id,
            payment.status,
            newPaymentStatus,
            auditContext,
            client
          );

          // Get updated payment
          const { rows: updatedPaymentRows } = await client.query<Payment>(
            'SELECT * FROM payments WHERE id = $1',
            [payment.id]
          );

          const updatedPayment = updatedPaymentRows[0]!;

          // Queue webhook
          if (payment.webhook_url) {
            await webhookService.queueWebhook({
              payment_id: payment.id,
              event_type: 'refund.completed',
              url: payment.webhook_url,
              payload: {
                refund_id: refund.id,
                payment_id: payment.id,
                amount: input.amount,
                status: 'completed',
                payment_status: newPaymentStatus,
              },
            });
          }

          // Get updated refund
          const { rows: updatedRefundRows } = await client.query<Refund>(
            'SELECT * FROM refunds WHERE id = $1',
            [refund.id]
          );

          return {
            refund: updatedRefundRows[0]!,
            payment: updatedPayment,
            success: true,
          };
        }

        // Refund failed
        const { rows: failedRefundRows } = await client.query<Refund>(
          'SELECT * FROM refunds WHERE id = $1',
          [refund.id]
        );

        return {
          refund: failedRefundRows[0]!,
          payment,
          success: false,
          error: response.errorMessage || 'Refund failed',
        };
      } catch (error) {
        // Mark refund as failed
        await updateRefund(
          refund.id,
          { status: 'failed' },
          client
        );

        const errorMessage = error instanceof Error ? error.message : String(error);

        await auditService.logRefundStatusChanged(
          refund.id,
          'pending',
          'failed',
          auditContext,
          client
        );

        const { rows: failedRefundRows } = await client.query<Refund>(
          'SELECT * FROM refunds WHERE id = $1',
          [refund.id]
        );

        return {
          refund: failedRefundRows[0]!,
          payment,
          success: false,
          error: errorMessage,
        };
      }
    });
  }

  async getRefund(id: string): Promise<Refund | null> {
    return getRefundById(id);
  }

  async getRefundsByPayment(paymentId: string): Promise<Refund[]> {
    return getRefundsByPaymentId(paymentId);
  }

  async getRefundableAmount(paymentId: string): Promise<{
    paymentAmount: number;
    totalRefunded: number;
    pendingRefunds: number;
    availableForRefund: number;
  }> {
    const payment = await getPaymentById(paymentId);
    if (!payment) {
      throw new RefundValidationError('Payment not found');
    }

    const paymentAmount = parseFloat(payment.amount);
    const totalRefunded = await getTotalRefundedAmount(paymentId);
    const pendingRefunds = await getPendingRefundsAmount(paymentId);
    const availableForRefund = Math.max(0, paymentAmount - totalRefunded - pendingRefunds);

    return {
      paymentAmount,
      totalRefunded,
      pendingRefunds,
      availableForRefund,
    };
  }
}

export class RefundValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundValidationError';
  }
}

export const refundService = new RefundService();
