import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database
vi.mock('../../src/db/connection.js', () => ({
  query: vi.fn(),
}));

vi.mock('../../src/models/audit-log.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({
    id: 'audit-123',
    entity_type: 'payment',
    entity_id: 'payment-123',
    action: 'created',
    old_value: null,
    new_value: { amount: 100 },
    actor: 'merchant-1',
    actor_type: 'merchant',
    ip_address: null,
    user_agent: null,
    created_at: new Date(),
  }),
}));

import { auditService } from '../../src/services/audit.service.js';
import { createAuditLog } from '../../src/models/audit-log.js';

describe('AuditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('log', () => {
    it('should create audit log', async () => {
      const result = await auditService.log(
        'payment',
        'payment-123',
        'created',
        {
          newValue: { amount: 100, currency: 'USD' },
          context: { actor: 'merchant-1' },
        }
      );

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'payment',
          entity_id: 'payment-123',
          action: 'created',
          new_value: { amount: 100, currency: 'USD' },
          actor: 'merchant-1',
        }),
        undefined
      );
      expect(result).toBeDefined();
    });
  });

  describe('logPaymentCreated', () => {
    it('should log payment creation', async () => {
      await auditService.logPaymentCreated(
        'payment-456',
        { amount: 200, currency: 'EUR', provider: 'stripe' },
        { actor: 'merchant-2', actor_type: 'merchant' }
      );

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'payment',
          entity_id: 'payment-456',
          action: 'created',
          new_value: { amount: 200, currency: 'EUR', provider: 'stripe' },
        }),
        undefined
      );
    });
  });

  describe('logPaymentStatusChanged', () => {
    it('should log status change', async () => {
      await auditService.logPaymentStatusChanged(
        'payment-789',
        'pending',
        'completed',
        { actor: 'system', actor_type: 'system' }
      );

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'payment',
          entity_id: 'payment-789',
          action: 'status_changed',
          old_value: { status: 'pending' },
          new_value: { status: 'completed' },
        }),
        undefined
      );
    });
  });

  describe('logRefundCreated', () => {
    it('should log refund creation', async () => {
      await auditService.logRefundCreated(
        'refund-123',
        { payment_id: 'payment-123', amount: 50, reason: 'Customer request' }
      );

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'refund',
          entity_id: 'refund-123',
          action: 'created',
        }),
        undefined
      );
    });
  });

  describe('logRefundStatusChanged', () => {
    it('should log refund status change', async () => {
      await auditService.logRefundStatusChanged(
        'refund-456',
        'pending',
        'completed'
      );

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'refund',
          entity_id: 'refund-456',
          action: 'status_changed',
          old_value: { status: 'pending' },
          new_value: { status: 'completed' },
        }),
        undefined
      );
    });
  });

  describe('logWebhookSent', () => {
    it('should log webhook sent', async () => {
      await auditService.logWebhookSent(
        'webhook-123',
        { event_type: 'payment.completed', url: 'https://example.com' }
      );

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'webhook',
          entity_id: 'webhook-123',
          action: 'sent',
        }),
        undefined
      );
    });
  });

  describe('logWebhookFailed', () => {
    it('should log webhook failure', async () => {
      await auditService.logWebhookFailed(
        'webhook-456',
        'Connection timeout',
        3
      );

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'webhook',
          entity_id: 'webhook-456',
          action: 'failed',
          new_value: { error: 'Connection timeout', attempts: 3 },
        }),
        undefined
      );
    });
  });
});
