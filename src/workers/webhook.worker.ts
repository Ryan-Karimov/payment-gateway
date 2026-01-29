import { getChannel, QUEUES, connectRabbitMQ } from '../config/rabbitmq.js';
import { webhookService } from '../services/webhook.service.js';
import { logger } from '../utils/logger.js';

interface WebhookMessage {
  webhookId: string;
}

export async function startWebhookWorker(): Promise<void> {
  try {
    const channel = await connectRabbitMQ();

    // Set prefetch to process one message at a time
    await channel.prefetch(1);

    logger.info('Webhook worker started, waiting for messages...');

    channel.consume(
      QUEUES.WEBHOOK_EVENTS,
      async (msg) => {
        if (!msg) {
          return;
        }

        try {
          const content = msg.content.toString();
          const message: WebhookMessage = JSON.parse(content);

          logger.debug({ webhookId: message.webhookId }, 'Processing webhook');

          await webhookService.processWebhook(message.webhookId);

          // Acknowledge message
          channel.ack(msg);
        } catch (error) {
          logger.error({ error }, 'Failed to process webhook message');

          // Reject and requeue if it's a temporary error
          // For permanent errors, don't requeue
          const shouldRequeue = error instanceof Error &&
            !error.message.includes('not found');

          channel.nack(msg, false, shouldRequeue);
        }
      },
      { noAck: false }
    );

    // Start retry checker every minute
    setInterval(async () => {
      try {
        const count = await webhookService.retryPendingWebhooks();
        if (count > 0) {
          logger.info({ count }, 'Queued pending webhooks for retry');
        }
      } catch (error) {
        logger.error({ error }, 'Failed to check pending webhooks');
      }
    }, 60000);

  } catch (error) {
    logger.error({ error }, 'Failed to start webhook worker');
    throw error;
  }
}

export async function stopWebhookWorker(): Promise<void> {
  const channel = getChannel();
  if (channel) {
    await channel.close();
  }
  logger.info('Webhook worker stopped');
}
