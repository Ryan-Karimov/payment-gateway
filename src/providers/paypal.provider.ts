import {
  BaseProvider,
  PaymentRequest,
  PaymentResponse,
  RefundRequest,
  RefundResponse,
  WebhookEvent,
} from './base.provider.js';
import { generateHmacSignature, verifyHmacSignature } from '../utils/crypto.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export class PayPalProvider extends BaseProvider {
  readonly name = 'paypal';

  async processPayment(request: PaymentRequest): Promise<PaymentResponse> {
    logger.info({ request }, 'Processing PayPal payment');

    await this.simulateDelay();

    const scenario = this.determineScenario(request.amount);
    const transactionId = `PAY-${uuidv4().toUpperCase().replace(/-/g, '').slice(0, 20)}`;

    if (scenario === 'decline') {
      return {
        success: false,
        transactionId,
        status: 'failed',
        rawResponse: {
          id: transactionId,
          intent: 'CAPTURE',
          status: 'VOIDED',
          purchase_units: [{
            amount: {
              currency_code: request.currency,
              value: request.amount.toFixed(2),
            },
          }],
          error: {
            name: 'INSTRUMENT_DECLINED',
            message: 'The instrument presented was declined.',
          },
        },
        errorCode: 'INSTRUMENT_DECLINED',
        errorMessage: 'The instrument presented was declined.',
      };
    }

    if (scenario === 'pending') {
      return {
        success: true,
        transactionId,
        status: 'pending',
        rawResponse: {
          id: transactionId,
          intent: 'CAPTURE',
          status: 'PENDING',
          purchase_units: [{
            amount: {
              currency_code: request.currency,
              value: request.amount.toFixed(2),
            },
          }],
        },
      };
    }

    return {
      success: true,
      transactionId,
      status: 'completed',
      rawResponse: {
        id: transactionId,
        intent: 'CAPTURE',
        status: 'COMPLETED',
        purchase_units: [{
          reference_id: request.paymentId,
          amount: {
            currency_code: request.currency,
            value: request.amount.toFixed(2),
          },
          payments: {
            captures: [{
              id: `CAP-${uuidv4().toUpperCase().slice(0, 17)}`,
              status: 'COMPLETED',
              amount: {
                currency_code: request.currency,
                value: request.amount.toFixed(2),
              },
              final_capture: true,
            }],
          },
        }],
        payer: {
          email_address: 'test@example.com',
        },
      },
    };
  }

  async processRefund(request: RefundRequest): Promise<RefundResponse> {
    logger.info({ request }, 'Processing PayPal refund');

    await this.simulateDelay();

    const refundId = `REF-${uuidv4().toUpperCase().replace(/-/g, '').slice(0, 17)}`;

    if (request.amount === 0.01) {
      return {
        success: false,
        refundId,
        status: 'failed',
        rawResponse: {
          id: refundId,
          status: 'CANCELLED',
          error: {
            name: 'CAPTURE_FULLY_REFUNDED',
            message: 'The capture has already been fully refunded.',
          },
        },
        errorCode: 'CAPTURE_FULLY_REFUNDED',
        errorMessage: 'The capture has already been fully refunded.',
      };
    }

    return {
      success: true,
      refundId,
      status: 'completed',
      rawResponse: {
        id: refundId,
        status: 'COMPLETED',
        amount: {
          currency_code: 'USD',
          value: request.amount.toFixed(2),
        },
        note_to_payer: request.reason,
      },
    };
  }

  parseWebhook(payload: Record<string, unknown>): WebhookEvent {
    const eventType = payload['event_type'] as string;
    const resource = payload['resource'] as Record<string, unknown> | undefined;

    const transactionId = resource?.['id'] as string || '';
    let status = resource?.['status'] as string || '';

    // Normalize PayPal status to our format
    if (status === 'COMPLETED') {
      status = 'completed';
    } else if (status === 'VOIDED' || status === 'CANCELLED') {
      status = 'failed';
    } else if (status === 'PENDING') {
      status = 'pending';
    }

    return {
      type: eventType,
      transactionId,
      status,
      rawPayload: payload,
    };
  }

  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    // PayPal uses a different verification method with transmission headers
    // For emulation, we use simple HMAC verification
    return verifyHmacSignature(payload, signature, secret);
  }

  generateWebhookSignature(payload: string, secret: string): string {
    return generateHmacSignature(payload, secret);
  }

  private async simulateDelay(): Promise<void> {
    const delay = 150 + Math.random() * 250;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private determineScenario(amount: number): 'success' | 'decline' | 'pending' {
    const cents = Math.round((amount % 1) * 100);

    if (cents === 99) {
      return 'decline';
    }
    if (cents === 50) {
      return 'pending';
    }
    return 'success';
  }
}

export const paypalProvider = new PayPalProvider();
