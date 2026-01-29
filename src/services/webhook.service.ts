import { query } from '../db/connection.js';
import { getChannel, QUEUES } from '../config/rabbitmq.js';
import { generateHmacSignature } from '../utils/crypto.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

// SECURITY: Blocked hosts/IPs to prevent SSRF attacks
const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'metadata.google.internal', // GCP metadata
  '169.254.169.254', // AWS/GCP/Azure metadata
  'metadata.google.internal.',
]);

// SECURITY: Only allow HTTPS in production
const ALLOWED_PROTOCOLS = config.server.isProduction
  ? ['https:']
  : ['https:', 'http:'];

function validateWebhookUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);

    // Check protocol
    if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
      return {
        valid: false,
        error: `Invalid protocol: ${url.protocol}. Only ${ALLOWED_PROTOCOLS.join(', ')} allowed.`,
      };
    }

    // Check for blocked hosts (SSRF prevention)
    const hostname = url.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(hostname)) {
      return {
        valid: false,
        error: `Blocked host: ${hostname}`,
      };
    }

    // Check for private IP ranges
    if (isPrivateIP(hostname)) {
      return {
        valid: false,
        error: `Private IP addresses not allowed: ${hostname}`,
      };
    }

    // Check for internal domain patterns
    if (hostname.endsWith('.internal') || hostname.endsWith('.local')) {
      return {
        valid: false,
        error: `Internal domains not allowed: ${hostname}`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Invalid URL format: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

function isPrivateIP(hostname: string): boolean {
  // Simple check for common private IP patterns
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./, // Link-local
    /^fc00:/i, // IPv6 private
    /^fd00:/i, // IPv6 private
    /^fe80:/i, // IPv6 link-local
  ];

  return privateRanges.some(range => range.test(hostname));
}

export type WebhookStatus = 'pending' | 'sent' | 'failed';

export interface WebhookEvent {
  id: string;
  payment_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  url: string;
  signature: string | null;
  attempts: number;
  max_attempts: number;
  next_retry_at: Date | null;
  last_error: string | null;
  status: WebhookStatus;
  created_at: Date;
  sent_at: Date | null;
}

export interface QueueWebhookInput {
  payment_id?: string;
  event_type: string;
  url: string;
  payload: Record<string, unknown>;
}

class WebhookService {
  private readonly maxAttempts = config.webhook.maxRetries;
  private readonly retryDelays = config.webhook.retryDelays;
  private readonly secret = config.webhook.secret;

  async queueWebhook(input: QueueWebhookInput): Promise<WebhookEvent> {
    // SECURITY: Validate webhook URL before accepting
    const urlValidation = validateWebhookUrl(input.url);
    if (!urlValidation.valid) {
      logger.warn(
        { url: input.url, error: urlValidation.error },
        'Rejected webhook with invalid URL'
      );
      throw new WebhookUrlValidationError(urlValidation.error || 'Invalid webhook URL');
    }

    const id = uuidv4();

    // Add timestamp to payload
    const payloadWithTimestamp = {
      ...input.payload,
      event_type: input.event_type,
      timestamp: new Date().toISOString(),
    };

    // Generate signature
    const payloadString = JSON.stringify(payloadWithTimestamp);
    const signature = this.generateSignature(payloadString);

    // Store in database
    const { rows } = await query<WebhookEvent>(
      `INSERT INTO webhook_events (
        id, payment_id, event_type, payload, url, signature, max_attempts
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        id,
        input.payment_id || null,
        input.event_type,
        JSON.stringify(payloadWithTimestamp),
        input.url,
        signature,
        this.maxAttempts,
      ]
    );

    const webhook = rows[0]!;

    // Queue for immediate processing
    await this.publishToQueue(webhook);

    logger.info({ webhookId: id, eventType: input.event_type }, 'Webhook queued');

    return webhook;
  }

  async processWebhook(webhookId: string): Promise<boolean> {
    const webhook = await this.getWebhookById(webhookId);
    if (!webhook) {
      logger.warn({ webhookId }, 'Webhook not found');
      return false;
    }

    if (webhook.status === 'sent') {
      logger.info({ webhookId }, 'Webhook already sent');
      return true;
    }

    if (webhook.status === 'failed') {
      logger.info({ webhookId }, 'Webhook already failed permanently');
      return false;
    }

    try {
      const response = await this.sendWebhook(webhook);

      if (response.ok) {
        await this.markAsSent(webhookId);
        logger.info({ webhookId }, 'Webhook sent successfully');
        return true;
      }

      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.handleFailure(webhook, errorMessage);
      return false;
    }
  }

  async retryPendingWebhooks(): Promise<number> {
    const { rows } = await query<WebhookEvent>(
      `SELECT * FROM webhook_events
       WHERE status = 'pending'
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       AND attempts < max_attempts
       ORDER BY created_at ASC
       LIMIT 100`
    );

    let processed = 0;
    for (const webhook of rows) {
      await this.publishToQueue(webhook);
      processed++;
    }

    return processed;
  }

  generateSignature(payload: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = generateHmacSignature(`${timestamp}.${payload}`, this.secret);
    return `t=${timestamp},v1=${signature}`;
  }

  verifySignature(payload: string, signature: string): boolean {
    const elements = signature.split(',');
    const timestampElement = elements.find(e => e.startsWith('t='));
    const signatureElement = elements.find(e => e.startsWith('v1='));

    if (!timestampElement || !signatureElement) {
      return false;
    }

    const timestamp = timestampElement.slice(2);
    const expectedSignature = signatureElement.slice(3);

    // Check timestamp is within 5 minutes
    const timestampAge = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
    if (timestampAge > 300) {
      return false;
    }

    const computedSignature = generateHmacSignature(
      `${timestamp}.${payload}`,
      this.secret
    );

    return computedSignature === expectedSignature;
  }

  private async sendWebhook(webhook: WebhookEvent): Promise<Response> {
    const payload = JSON.stringify(webhook.payload);

    return fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': webhook.signature || this.generateSignature(payload),
        'X-Webhook-Id': webhook.id,
        'X-Event-Type': webhook.event_type,
      },
      body: payload,
      signal: AbortSignal.timeout(30000),
    });
  }

  private async publishToQueue(webhook: WebhookEvent): Promise<void> {
    const channel = getChannel();
    if (!channel) {
      logger.warn('RabbitMQ channel not available, webhook will be processed later');
      return;
    }

    channel.sendToQueue(
      QUEUES.WEBHOOK_EVENTS,
      Buffer.from(JSON.stringify({ webhookId: webhook.id })),
      { persistent: true }
    );
  }

  private async handleFailure(
    webhook: WebhookEvent,
    errorMessage: string
  ): Promise<void> {
    const newAttempts = webhook.attempts + 1;

    if (newAttempts >= webhook.max_attempts) {
      // Mark as permanently failed
      await query(
        `UPDATE webhook_events
         SET status = 'failed', attempts = $1, last_error = $2
         WHERE id = $3`,
        [newAttempts, errorMessage, webhook.id]
      );

      logger.error(
        { webhookId: webhook.id, attempts: newAttempts },
        'Webhook failed permanently'
      );
      return;
    }

    // Calculate next retry time with exponential backoff
    const delay = this.retryDelays[Math.min(newAttempts - 1, this.retryDelays.length - 1)] || 3600000;
    const nextRetryAt = new Date(Date.now() + delay);

    await query(
      `UPDATE webhook_events
       SET attempts = $1, last_error = $2, next_retry_at = $3
       WHERE id = $4`,
      [newAttempts, errorMessage, nextRetryAt, webhook.id]
    );

    // Schedule retry
    const channel = getChannel();
    if (channel) {
      setTimeout(() => {
        this.publishToQueue(webhook);
      }, delay);
    }

    logger.warn(
      { webhookId: webhook.id, attempts: newAttempts, nextRetryAt },
      'Webhook delivery failed, scheduled for retry'
    );
  }

  private async markAsSent(webhookId: string): Promise<void> {
    await query(
      `UPDATE webhook_events
       SET status = 'sent', sent_at = NOW()
       WHERE id = $1`,
      [webhookId]
    );
  }

  private async getWebhookById(id: string): Promise<WebhookEvent | null> {
    const { rows } = await query<WebhookEvent>(
      'SELECT * FROM webhook_events WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  }
}

export class WebhookUrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlValidationError';
  }
}

export const webhookService = new WebhookService();
