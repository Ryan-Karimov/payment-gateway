import amqplib, { type Channel, type ChannelModel } from 'amqplib';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

export const QUEUES = {
  WEBHOOK_EVENTS: 'webhook_events',
  WEBHOOK_RETRY: 'webhook_retry',
} as const;

export const EXCHANGES = {
  WEBHOOK_DELAYED: 'webhook_delayed',
} as const;

export async function connectRabbitMQ(): Promise<Channel> {
  if (channel) {
    return channel;
  }

  try {
    connection = await amqplib.connect(config.rabbitmq.url);
    channel = await connection.createChannel();

    if (!channel) {
      throw new Error('Failed to create RabbitMQ channel');
    }

    // Set up queues
    await channel.assertQueue(QUEUES.WEBHOOK_EVENTS, {
      durable: true,
    });

    // Set up delayed exchange for retries
    await channel.assertExchange(EXCHANGES.WEBHOOK_DELAYED, 'x-delayed-message', {
      durable: true,
      arguments: {
        'x-delayed-type': 'direct',
      },
    }).catch(() => {
      // Fallback if delayed message plugin is not installed
      logger.info('Delayed message exchange not available, using direct queue');
    });

    await channel.assertQueue(QUEUES.WEBHOOK_RETRY, {
      durable: true,
    });

    logger.info('Connected to RabbitMQ');
    return channel;
  } catch (error) {
    logger.error({ error }, 'RabbitMQ connection failed');
    throw error;
  }
}

export function getChannel(): Channel | null {
  return channel;
}

export async function checkRabbitMQConnection(): Promise<boolean> {
  try {
    await connectRabbitMQ();
    return true;
  } catch (error) {
    logger.error({ error }, 'RabbitMQ connection check failed');
    return false;
  }
}

export async function closeRabbitMQ(): Promise<void> {
  if (channel) {
    await channel.close();
    channel = null;
  }
  if (connection) {
    await connection.close();
    connection = null;
  }
}
