import { query, withTransaction } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export interface Payment {
  id: string;
  external_id: string | null;
  merchant_id: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  provider: string;
  provider_transaction_id: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  webhook_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePaymentInput {
  external_id?: string;
  merchant_id: string;
  amount: number;
  currency: string;
  provider: string;
  description?: string;
  metadata?: Record<string, unknown>;
  webhook_url?: string;
}

export interface UpdatePaymentInput {
  status?: PaymentStatus;
  provider_transaction_id?: string;
  metadata?: Record<string, unknown>;
}

export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  const id = uuidv4();
  const { rows } = await query<Payment>(
    `INSERT INTO payments (
      id, external_id, merchant_id, amount, currency, provider,
      description, metadata, webhook_url
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      id,
      input.external_id || null,
      input.merchant_id,
      input.amount,
      input.currency.toUpperCase(),
      input.provider.toLowerCase(),
      input.description || null,
      JSON.stringify(input.metadata || {}),
      input.webhook_url || null,
    ]
  );

  return rows[0]!;
}

export async function getPaymentById(id: string): Promise<Payment | null> {
  const { rows } = await query<Payment>(
    'SELECT * FROM payments WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

export async function getPaymentByExternalId(
  externalId: string,
  merchantId: string
): Promise<Payment | null> {
  const { rows } = await query<Payment>(
    'SELECT * FROM payments WHERE external_id = $1 AND merchant_id = $2',
    [externalId, merchantId]
  );
  return rows[0] || null;
}

export async function getPaymentsByMerchant(
  merchantId: string,
  options: {
    limit?: number;
    offset?: number;
    status?: PaymentStatus;
  } = {}
): Promise<{ payments: Payment[]; total: number }> {
  const { limit = 20, offset = 0, status } = options;

  let whereClause = 'WHERE merchant_id = $1';
  const params: unknown[] = [merchantId];
  let paramIndex = 2;

  if (status) {
    whereClause += ` AND status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM payments ${whereClause}`,
    params
  );

  params.push(limit, offset);
  const { rows } = await query<Payment>(
    `SELECT * FROM payments ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return {
    payments: rows,
    total: parseInt(countResult.rows[0]?.count || '0', 10),
  };
}

export async function updatePayment(
  id: string,
  input: UpdatePaymentInput
): Promise<Payment | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (input.status !== undefined) {
    updates.push(`status = $${paramIndex}`);
    params.push(input.status);
    paramIndex++;
  }

  if (input.provider_transaction_id !== undefined) {
    updates.push(`provider_transaction_id = $${paramIndex}`);
    params.push(input.provider_transaction_id);
    paramIndex++;
  }

  if (input.metadata !== undefined) {
    updates.push(`metadata = metadata || $${paramIndex}::jsonb`);
    params.push(JSON.stringify(input.metadata));
    paramIndex++;
  }

  if (updates.length === 0) {
    return getPaymentById(id);
  }

  params.push(id);
  const { rows } = await query<Payment>(
    `UPDATE payments SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    params
  );

  return rows[0] || null;
}

export async function updatePaymentStatus(
  id: string,
  status: PaymentStatus,
  providerTransactionId?: string
): Promise<Payment | null> {
  return updatePayment(id, { status, provider_transaction_id: providerTransactionId });
}

export async function getPaymentForUpdate(
  client: import('pg').PoolClient,
  id: string
): Promise<Payment | null> {
  const { rows } = await client.query<Payment>(
    'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
    [id]
  );
  return rows[0] || null;
}

// Note: getTotalRefundedAmount is defined in src/models/refund.ts
// Use that version as it supports transaction client parameter
