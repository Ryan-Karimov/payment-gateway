import {
  createPayment,
  getPaymentById,
  getPaymentsByMerchant,
  updatePayment,
  getPaymentForUpdate,
  Payment,
  CreatePaymentInput,
  PaymentStatus,
} from '../models/payment.js';
import { createTransaction } from '../models/transaction.js';
import { getProvider, getSupportedProviders, ProviderError } from '../providers/index.js';
import { createSaga, SagaOrchestrator } from './saga.service.js';
import { auditService, AuditContext } from './audit.service.js';
import { webhookService } from './webhook.service.js';
import { logger } from '../utils/logger.js';
import { withTransaction } from '../db/connection.js';
import type { PoolClient } from 'pg';

export interface ProcessPaymentInput {
  external_id?: string;
  merchant_id: string;
  amount: number;
  currency: string;
  provider: string;
  description?: string;
  metadata?: Record<string, unknown>;
  webhook_url?: string;
}

export interface ProcessPaymentResult {
  payment: Payment;
  success: boolean;
  error?: string;
}

interface PaymentSagaContext {
  input: ProcessPaymentInput;
  payment?: Payment;
  providerResponse?: Record<string, unknown>;
  auditContext?: AuditContext;
  client?: PoolClient;
}

class PaymentService {
  async processPayment(
    input: ProcessPaymentInput,
    auditContext?: AuditContext
  ): Promise<ProcessPaymentResult> {
    // Validate provider
    const supportedProviders = getSupportedProviders();
    if (!supportedProviders.includes(input.provider.toLowerCase())) {
      throw new PaymentValidationError(
        `Unsupported provider: ${input.provider}. Supported: ${supportedProviders.join(', ')}`
      );
    }

    // Validate amount
    if (input.amount <= 0) {
      throw new PaymentValidationError('Amount must be greater than 0');
    }

    // Validate amount precision (max 2 decimal places for most currencies)
    const amountStr = input.amount.toString();
    const decimalMatch = amountStr.match(/\.(\d+)$/);
    if (decimalMatch && decimalMatch[1] && decimalMatch[1].length > 4) {
      throw new PaymentValidationError('Amount cannot have more than 4 decimal places');
    }

    // Validate currency - common ISO 4217 codes
    const validCurrencies = new Set([
      'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'HKD', 'NZD',
      'SEK', 'KRW', 'SGD', 'NOK', 'MXN', 'INR', 'RUB', 'ZAR', 'TRY', 'BRL',
      'TWD', 'DKK', 'PLN', 'THB', 'IDR', 'HUF', 'CZK', 'ILS', 'CLP', 'PHP',
      'AED', 'COP', 'SAR', 'MYR', 'RON', 'BGN', 'HRK', 'ISK',
    ]);

    const currencyUpper = input.currency.toUpperCase();
    if (!input.currency || input.currency.length !== 3) {
      throw new PaymentValidationError('Currency must be a valid 3-letter code');
    }

    if (!validCurrencies.has(currencyUpper)) {
      throw new PaymentValidationError(
        `Currency ${currencyUpper} is not supported. Use ISO 4217 currency codes.`
      );
    }

    const saga = this.createPaymentSaga();

    const result = await saga.execute({
      input,
      auditContext,
    });

    if (!result.success || !result.context.payment) {
      return {
        payment: result.context.payment!,
        success: false,
        error: result.error?.message || 'Payment processing failed',
      };
    }

    return {
      payment: result.context.payment,
      success: result.context.payment.status === 'completed',
    };
  }

  private createPaymentSaga(): SagaOrchestrator<PaymentSagaContext> {
    return createSaga<PaymentSagaContext>()
      // Step 1: Create payment record
      .addStep({
        name: 'create_payment_record',
        execute: async (ctx) => {
          const payment = await createPayment({
            external_id: ctx.input.external_id,
            merchant_id: ctx.input.merchant_id,
            amount: ctx.input.amount,
            currency: ctx.input.currency,
            provider: ctx.input.provider,
            description: ctx.input.description,
            metadata: ctx.input.metadata,
            webhook_url: ctx.input.webhook_url,
          });

          await createTransaction({
            payment_id: payment.id,
            status: 'pending',
            provider_response: { message: 'Payment created' },
          });

          await auditService.logPaymentCreated(
            payment.id,
            {
              amount: payment.amount,
              currency: payment.currency,
              provider: payment.provider,
            },
            ctx.auditContext
          );

          return { ...ctx, payment };
        },
        compensate: async (ctx) => {
          if (ctx.payment) {
            await updatePayment(ctx.payment.id, { status: 'failed' });
            await auditService.logPaymentStatusChanged(
              ctx.payment.id,
              'pending',
              'failed',
              ctx.auditContext
            );
          }
        },
      })
      // Step 2: Process with provider
      .addStep({
        name: 'process_with_provider',
        execute: async (ctx) => {
          if (!ctx.payment) {
            throw new Error('Payment not found in context');
          }

          // Update status to processing
          await updatePayment(ctx.payment.id, { status: 'processing' });
          await createTransaction({
            payment_id: ctx.payment.id,
            status: 'processing',
          });

          const provider = getProvider(ctx.input.provider);

          const response = await provider.processPayment({
            amount: ctx.input.amount,
            currency: ctx.input.currency,
            paymentId: ctx.payment.id,
            description: ctx.input.description,
            metadata: ctx.input.metadata,
          });

          ctx.providerResponse = response.rawResponse;

          const newStatus: PaymentStatus = response.success
            ? (response.status === 'completed' ? 'completed' : 'pending')
            : 'failed';

          const updated = await updatePayment(ctx.payment.id, {
            status: newStatus,
            provider_transaction_id: response.transactionId,
          });

          await createTransaction({
            payment_id: ctx.payment.id,
            status: newStatus,
            provider_response: response.rawResponse,
            error_message: response.errorMessage,
          });

          await auditService.logPaymentStatusChanged(
            ctx.payment.id,
            'processing',
            newStatus,
            ctx.auditContext
          );

          return { ...ctx, payment: updated || ctx.payment };
        },
      })
      // Step 3: Send webhook notification
      .addStep({
        name: 'send_webhook',
        execute: async (ctx) => {
          if (!ctx.payment) {
            throw new Error('Payment not found in context');
          }

          if (ctx.payment.webhook_url) {
            await webhookService.queueWebhook({
              payment_id: ctx.payment.id,
              event_type: `payment.${ctx.payment.status}`,
              url: ctx.payment.webhook_url,
              payload: {
                id: ctx.payment.id,
                external_id: ctx.payment.external_id,
                amount: ctx.payment.amount,
                currency: ctx.payment.currency,
                status: ctx.payment.status,
                provider: ctx.payment.provider,
                provider_transaction_id: ctx.payment.provider_transaction_id,
                created_at: ctx.payment.created_at,
              },
            });
          }

          return ctx;
        },
      });
  }

  async getPayment(id: string): Promise<Payment | null> {
    return getPaymentById(id);
  }

  async getPayments(
    merchantId: string,
    options: { limit?: number; offset?: number; status?: PaymentStatus }
  ): Promise<{ payments: Payment[]; total: number }> {
    return getPaymentsByMerchant(merchantId, options);
  }

  async updatePaymentFromWebhook(
    providerTransactionId: string,
    provider: string,
    newStatus: PaymentStatus,
    providerResponse: Record<string, unknown>
  ): Promise<Payment | null> {
    return withTransaction(async (client) => {
      // Find payment by provider transaction ID
      const { rows } = await client.query<Payment>(
        `SELECT * FROM payments
         WHERE provider_transaction_id = $1 AND provider = $2
         FOR UPDATE`,
        [providerTransactionId, provider]
      );

      const payment = rows[0];
      if (!payment) {
        logger.warn(
          { providerTransactionId, provider },
          'Payment not found for webhook'
        );
        return null;
      }

      // Check if status update is valid
      if (!this.isValidStatusTransition(payment.status, newStatus)) {
        logger.warn(
          { currentStatus: payment.status, newStatus },
          'Invalid status transition'
        );
        return payment;
      }

      // Update payment
      await client.query(
        `UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2`,
        [newStatus, payment.id]
      );

      // Create transaction record
      await createTransaction(
        {
          payment_id: payment.id,
          status: newStatus,
          provider_response: providerResponse,
        },
        client
      );

      await auditService.logPaymentStatusChanged(
        payment.id,
        payment.status,
        newStatus,
        { actor: `webhook:${provider}`, actor_type: 'webhook' },
        client
      );

      // Send webhook to merchant
      if (payment.webhook_url) {
        await webhookService.queueWebhook({
          payment_id: payment.id,
          event_type: `payment.${newStatus}`,
          url: payment.webhook_url,
          payload: {
            id: payment.id,
            external_id: payment.external_id,
            status: newStatus,
            provider_response: providerResponse,
          },
        });
      }

      const { rows: updatedRows } = await client.query<Payment>(
        'SELECT * FROM payments WHERE id = $1',
        [payment.id]
      );

      return updatedRows[0] || null;
    });
  }

  private isValidStatusTransition(
    currentStatus: PaymentStatus,
    newStatus: PaymentStatus
  ): boolean {
    const validTransitions: Record<PaymentStatus, PaymentStatus[]> = {
      pending: ['processing', 'completed', 'failed'],
      processing: ['completed', 'failed'],
      completed: ['refunded', 'partially_refunded'],
      failed: [],
      refunded: [],
      partially_refunded: ['refunded'],
    };

    return validTransitions[currentStatus]?.includes(newStatus) ?? false;
  }
}

export class PaymentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentValidationError';
  }
}

export class PaymentNotFoundError extends Error {
  constructor(paymentId: string) {
    super(`Payment not found: ${paymentId}`);
    this.name = 'PaymentNotFoundError';
  }
}

export const paymentService = new PaymentService();
