import {
  BaseProvider,
  PaymentRequest,
  PaymentResponse,
  RefundRequest,
  RefundResponse,
  WebhookEvent,
  ProviderError,
} from './base.provider.js';
import { generateHmacSignature, verifyHmacSignature } from '../utils/crypto.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export class StripeProvider extends BaseProvider {
  readonly name = 'stripe';

  async processPayment(request: PaymentRequest): Promise<PaymentResponse> {
    logger.info({ request }, 'Processing Stripe payment');

    // Simulate network delay
    await this.simulateDelay();

    // Simulate different scenarios based on amount
    const scenario = this.determineScenario(request.amount);
    const transactionId = `ch_${uuidv4().replace(/-/g, '').slice(0, 24)}`;

    if (scenario === 'decline') {
      return {
        success: false,
        transactionId,
        status: 'failed',
        rawResponse: {
          id: transactionId,
          object: 'charge',
          amount: Math.round(request.amount * 100),
          currency: request.currency.toLowerCase(),
          status: 'failed',
          failure_code: 'card_declined',
          failure_message: 'Your card was declined.',
        },
        errorCode: 'card_declined',
        errorMessage: 'Your card was declined.',
      };
    }

    if (scenario === 'pending') {
      return {
        success: true,
        transactionId,
        status: 'pending',
        rawResponse: {
          id: transactionId,
          object: 'charge',
          amount: Math.round(request.amount * 100),
          currency: request.currency.toLowerCase(),
          status: 'pending',
          metadata: request.metadata,
        },
      };
    }

    // Success scenario
    return {
      success: true,
      transactionId,
      status: 'completed',
      rawResponse: {
        id: transactionId,
        object: 'charge',
        amount: Math.round(request.amount * 100),
        currency: request.currency.toLowerCase(),
        status: 'succeeded',
        paid: true,
        captured: true,
        metadata: request.metadata,
      },
    };
  }

  async processRefund(request: RefundRequest): Promise<RefundResponse> {
    logger.info({ request }, 'Processing Stripe refund');

    await this.simulateDelay();

    const refundId = `re_${uuidv4().replace(/-/g, '').slice(0, 24)}`;

    // Simulate refund failure for specific amounts
    if (request.amount === 0.01) {
      return {
        success: false,
        refundId,
        status: 'failed',
        rawResponse: {
          id: refundId,
          object: 'refund',
          amount: Math.round(request.amount * 100),
          charge: request.transactionId,
          status: 'failed',
          failure_reason: 'charge_already_refunded',
        },
        errorCode: 'charge_already_refunded',
        errorMessage: 'This charge has already been refunded.',
      };
    }

    return {
      success: true,
      refundId,
      status: 'completed',
      rawResponse: {
        id: refundId,
        object: 'refund',
        amount: Math.round(request.amount * 100),
        charge: request.transactionId,
        status: 'succeeded',
        reason: request.reason || 'requested_by_customer',
      },
    };
  }

  parseWebhook(payload: Record<string, unknown>): WebhookEvent {
    const data = payload['data'] as Record<string, unknown> | undefined;
    const object = data?.['object'] as Record<string, unknown> | undefined;

    const type = payload['type'] as string;
    const transactionId = object?.['id'] as string || '';
    const status = object?.['status'] as string || '';

    let normalizedStatus = status;
    if (status === 'succeeded') {
      normalizedStatus = 'completed';
    }

    return {
      type,
      transactionId,
      status: normalizedStatus,
      rawPayload: payload,
    };
  }

  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    // Stripe webhook signature format: t=timestamp,v1=signature
    const elements = signature.split(',');
    const timestampElement = elements.find(e => e.startsWith('t='));
    const signatureElement = elements.find(e => e.startsWith('v1='));

    if (!timestampElement || !signatureElement) {
      return false;
    }

    const timestamp = timestampElement.slice(2);
    const expectedSignature = signatureElement.slice(3);

    // SECURITY: Validate timestamp to prevent replay attacks
    // Stripe recommends rejecting webhooks older than 5 minutes
    const timestampSeconds = parseInt(timestamp, 10);
    if (isNaN(timestampSeconds)) {
      return false;
    }

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const tolerance = 300; // 5 minutes in seconds

    if (Math.abs(currentTimestamp - timestampSeconds) > tolerance) {
      logger.warn(
        { timestampAge: currentTimestamp - timestampSeconds },
        'Webhook timestamp too old or in the future (possible replay attack)'
      );
      return false;
    }

    const signedPayload = `${timestamp}.${payload}`;
    return verifyHmacSignature(signedPayload, expectedSignature, secret);
  }

  generateWebhookSignature(payload: string, secret: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signedPayload = `${timestamp}.${payload}`;
    const signature = generateHmacSignature(signedPayload, secret);
    return `t=${timestamp},v1=${signature}`;
  }

  private async simulateDelay(): Promise<void> {
    const delay = 100 + Math.random() * 200;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private determineScenario(amount: number): 'success' | 'decline' | 'pending' {
    // Use specific amounts to trigger different scenarios
    // amount ending in .99 = decline
    // amount ending in .50 = pending
    // everything else = success

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

export const stripeProvider = new StripeProvider();
