import { FastifyInstance } from 'fastify';
import { paymentService } from '../services/payment.service.js';
import { getProvider } from '../providers/index.js';
import { logger } from '../utils/logger.js';
import { PaymentStatus } from '../models/payment.js';
import { paymentSchemas } from '../config/swagger.js';
import { recordWebhook } from '../config/metrics.js';
import { config } from '../config/index.js';

interface ProviderParams {
  provider: string;
}

interface WebhookBody {
  [key: string]: unknown;
}

// Provider-specific webhook secrets should be configured per provider
function getWebhookSecret(providerName: string): string {
  const secrets: Record<string, string | undefined> = {
    stripe: process.env['STRIPE_WEBHOOK_SECRET'],
    paypal: process.env['PAYPAL_WEBHOOK_SECRET'],
  };
  return secrets[providerName] || config.webhook.secret;
}

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  // Receive webhook from payment provider
  fastify.post<{ Params: ProviderParams; Body: WebhookBody }>(
    '/:provider',
    {
      schema: paymentSchemas.providerWebhook,
      config: {
        rawBody: true,
      },
    },
    async (request, reply) => {
      const { provider: providerName } = request.params;
      const signature = (request.headers['stripe-signature'] ||
        request.headers['paypal-transmission-sig'] ||
        request.headers['x-webhook-signature']) as string | undefined;

      logger.info(
        { provider: providerName, hasSignature: !!signature },
        'Received provider webhook'
      );

      try {
        const provider = getProvider(providerName);

        // SECURITY: Verify webhook signature before processing
        const rawBody = JSON.stringify(request.body);
        const webhookSecret = getWebhookSecret(providerName);

        if (!signature) {
          logger.warn({ provider: providerName }, 'Webhook received without signature');
          return reply.code(401).send({
            error: 'Unauthorized',
            message: 'Missing webhook signature'
          });
        }

        const isValid = provider.verifyWebhookSignature(rawBody, signature, webhookSecret);
        if (!isValid) {
          logger.warn({ provider: providerName }, 'Invalid webhook signature');
          recordWebhook('invalid_signature', 'rejected');
          return reply.code(401).send({
            error: 'Unauthorized',
            message: 'Invalid webhook signature'
          });
        }

        // Parse webhook event after signature verification
        const event = provider.parseWebhook(request.body as Record<string, unknown>, signature);

        logger.info(
          { eventType: event.type, transactionId: event.transactionId },
          'Parsed webhook event'
        );

        // Map provider status to our status
        let newStatus: PaymentStatus | null = null;

        switch (event.status) {
          case 'completed':
            newStatus = 'completed';
            break;
          case 'failed':
            newStatus = 'failed';
            break;
          case 'pending':
            newStatus = 'pending';
            break;
          default:
            logger.warn({ status: event.status }, 'Unknown status in webhook');
        }

        if (newStatus && event.transactionId) {
          await paymentService.updatePaymentFromWebhook(
            event.transactionId,
            providerName,
            newStatus,
            event.rawPayload
          );
        }

        // Record metrics
        recordWebhook(event.type, 'received');

        return reply.code(200).send({ received: true });
      } catch (error) {
        logger.error({ error, provider: providerName }, 'Webhook processing failed');
        recordWebhook('unknown', 'error');

        return reply.code(200).send({ received: true, processed: false });
      }
    }
  );

  // Health check endpoint for webhook receiver
  fastify.get('/health', {
    schema: {
      hide: true,
    },
  }, async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });
}
