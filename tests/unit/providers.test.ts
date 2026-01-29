import { describe, it, expect, beforeEach } from 'vitest';
import { StripeProvider } from '../../src/providers/stripe.provider.js';
import { PayPalProvider } from '../../src/providers/paypal.provider.js';
import { getProvider, getSupportedProviders, ProviderError } from '../../src/providers/index.js';

describe('Payment Providers', () => {
  describe('StripeProvider', () => {
    let provider: StripeProvider;

    beforeEach(() => {
      provider = new StripeProvider();
    });

    it('should have correct name', () => {
      expect(provider.name).toBe('stripe');
    });

    it('should process successful payment', async () => {
      const result = await provider.processPayment({
        amount: 100.00,
        currency: 'USD',
        paymentId: 'test-payment-id',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.transactionId).toMatch(/^ch_/);
    });

    it('should decline payment ending in .99', async () => {
      const result = await provider.processPayment({
        amount: 100.99,
        currency: 'USD',
        paymentId: 'test-payment-id',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.errorCode).toBe('card_declined');
    });

    it('should return pending for amount ending in .50', async () => {
      const result = await provider.processPayment({
        amount: 100.50,
        currency: 'USD',
        paymentId: 'test-payment-id',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('pending');
    });

    it('should process successful refund', async () => {
      const result = await provider.processRefund({
        transactionId: 'ch_test123',
        amount: 50.00,
        reason: 'Customer request',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.refundId).toMatch(/^re_/);
    });

    it('should fail refund for $0.01', async () => {
      const result = await provider.processRefund({
        transactionId: 'ch_test123',
        amount: 0.01,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('charge_already_refunded');
    });

    it('should parse webhook correctly', () => {
      const payload = {
        type: 'charge.succeeded',
        data: {
          object: {
            id: 'ch_test123',
            status: 'succeeded',
          },
        },
      };

      const event = provider.parseWebhook(payload);

      expect(event.type).toBe('charge.succeeded');
      expect(event.transactionId).toBe('ch_test123');
      expect(event.status).toBe('completed');
    });
  });

  describe('PayPalProvider', () => {
    let provider: PayPalProvider;

    beforeEach(() => {
      provider = new PayPalProvider();
    });

    it('should have correct name', () => {
      expect(provider.name).toBe('paypal');
    });

    it('should process successful payment', async () => {
      const result = await provider.processPayment({
        amount: 75.00,
        currency: 'EUR',
        paymentId: 'test-payment-id',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.transactionId).toMatch(/^PAY-/);
    });

    it('should decline payment ending in .99', async () => {
      const result = await provider.processPayment({
        amount: 50.99,
        currency: 'USD',
        paymentId: 'test-payment-id',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.errorCode).toBe('INSTRUMENT_DECLINED');
    });

    it('should parse webhook correctly', () => {
      const payload = {
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'PAY-TEST123',
          status: 'COMPLETED',
        },
      };

      const event = provider.parseWebhook(payload);

      expect(event.type).toBe('PAYMENT.CAPTURE.COMPLETED');
      expect(event.transactionId).toBe('PAY-TEST123');
      expect(event.status).toBe('completed');
    });
  });

  describe('Provider Registry', () => {
    it('should return stripe provider', () => {
      const provider = getProvider('stripe');
      expect(provider.name).toBe('stripe');
    });

    it('should return paypal provider', () => {
      const provider = getProvider('paypal');
      expect(provider.name).toBe('paypal');
    });

    it('should be case insensitive', () => {
      const provider1 = getProvider('STRIPE');
      const provider2 = getProvider('Stripe');

      expect(provider1.name).toBe('stripe');
      expect(provider2.name).toBe('stripe');
    });

    it('should throw for unknown provider', () => {
      expect(() => getProvider('unknown')).toThrow(ProviderError);
    });

    it('should list supported providers', () => {
      const providers = getSupportedProviders();

      expect(providers).toContain('stripe');
      expect(providers).toContain('paypal');
    });
  });
});
