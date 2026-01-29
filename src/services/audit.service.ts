import { createAuditLog, CreateAuditLogInput, AuditLog } from '../models/audit-log.js';
import { logger } from '../utils/logger.js';
import type { PoolClient } from 'pg';

export interface AuditContext {
  actor?: string;
  actor_type?: string;
  ip_address?: string;
  user_agent?: string;
}

class AuditService {
  async log(
    entityType: string,
    entityId: string,
    action: string,
    options: {
      oldValue?: Record<string, unknown> | null;
      newValue?: Record<string, unknown> | null;
      context?: AuditContext;
      client?: PoolClient;
    } = {}
  ): Promise<AuditLog> {
    const input: CreateAuditLogInput = {
      entity_type: entityType,
      entity_id: entityId,
      action,
      old_value: options.oldValue,
      new_value: options.newValue,
      ...options.context,
    };

    try {
      const auditLog = await createAuditLog(input, options.client);
      logger.debug({ auditLog }, 'Audit log created');
      return auditLog;
    } catch (error) {
      logger.error({ error, input }, 'Failed to create audit log');
      throw error;
    }
  }

  async logPaymentCreated(
    paymentId: string,
    paymentData: Record<string, unknown>,
    context?: AuditContext,
    client?: PoolClient
  ): Promise<AuditLog> {
    return this.log('payment', paymentId, 'created', {
      newValue: paymentData,
      context,
      client,
    });
  }

  async logPaymentStatusChanged(
    paymentId: string,
    oldStatus: string,
    newStatus: string,
    context?: AuditContext,
    client?: PoolClient
  ): Promise<AuditLog> {
    return this.log('payment', paymentId, 'status_changed', {
      oldValue: { status: oldStatus },
      newValue: { status: newStatus },
      context,
      client,
    });
  }

  async logRefundCreated(
    refundId: string,
    refundData: Record<string, unknown>,
    context?: AuditContext,
    client?: PoolClient
  ): Promise<AuditLog> {
    return this.log('refund', refundId, 'created', {
      newValue: refundData,
      context,
      client,
    });
  }

  async logRefundStatusChanged(
    refundId: string,
    oldStatus: string,
    newStatus: string,
    context?: AuditContext,
    client?: PoolClient
  ): Promise<AuditLog> {
    return this.log('refund', refundId, 'status_changed', {
      oldValue: { status: oldStatus },
      newValue: { status: newStatus },
      context,
      client,
    });
  }

  async logWebhookSent(
    webhookId: string,
    webhookData: Record<string, unknown>,
    context?: AuditContext
  ): Promise<AuditLog> {
    return this.log('webhook', webhookId, 'sent', {
      newValue: webhookData,
      context,
    });
  }

  async logWebhookFailed(
    webhookId: string,
    error: string,
    attempts: number,
    context?: AuditContext
  ): Promise<AuditLog> {
    return this.log('webhook', webhookId, 'failed', {
      newValue: { error, attempts },
      context,
    });
  }
}

export const auditService = new AuditService();
