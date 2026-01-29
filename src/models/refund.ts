import { query } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import type { PoolClient } from 'pg';

export type RefundStatus = 'pending' | 'completed' | 'failed';

export interface Refund {
  id: string;
  payment_id: string;
  amount: string;
  status: RefundStatus;
  reason: string | null;
  provider_refund_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateRefundInput {
  payment_id: string;
  amount: number;
  reason?: string;
}

export interface UpdateRefundInput {
  status?: RefundStatus;
  provider_refund_id?: string;
}

export async function createRefund(
  input: CreateRefundInput,
  client?: PoolClient
): Promise<Refund> {
  const id = uuidv4();
  const queryFn = client ? client.query.bind(client) : query;

  const { rows } = await queryFn<Refund>(
    `INSERT INTO refunds (id, payment_id, amount, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, input.payment_id, input.amount, input.reason || null]
  );

  return rows[0]!;
}

export async function getRefundById(id: string): Promise<Refund | null> {
  const { rows } = await query<Refund>(
    'SELECT * FROM refunds WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

export async function getRefundsByPaymentId(paymentId: string): Promise<Refund[]> {
  const { rows } = await query<Refund>(
    `SELECT * FROM refunds
     WHERE payment_id = $1
     ORDER BY created_at DESC`,
    [paymentId]
  );
  return rows;
}

export async function updateRefund(
  id: string,
  input: UpdateRefundInput,
  client?: PoolClient
): Promise<Refund | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (input.status !== undefined) {
    updates.push(`status = $${paramIndex}`);
    params.push(input.status);
    paramIndex++;
  }

  if (input.provider_refund_id !== undefined) {
    updates.push(`provider_refund_id = $${paramIndex}`);
    params.push(input.provider_refund_id);
    paramIndex++;
  }

  if (updates.length === 0) {
    return getRefundById(id);
  }

  params.push(id);
  const queryFn = client ? client.query.bind(client) : query;

  const { rows } = await queryFn<Refund>(
    `UPDATE refunds SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    params
  );

  return rows[0] || null;
}

export async function getTotalRefundedAmount(
  paymentId: string,
  client?: PoolClient
): Promise<number> {
  const queryFn = client ? client.query.bind(client) : query;

  const { rows } = await queryFn<{ total: string | null }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM refunds
     WHERE payment_id = $1 AND status = 'completed'`,
    [paymentId]
  );

  return parseFloat(rows[0]?.total || '0');
}

export async function getPendingRefundsAmount(
  paymentId: string,
  client?: PoolClient
): Promise<number> {
  const queryFn = client ? client.query.bind(client) : query;

  const { rows } = await queryFn<{ total: string | null }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM refunds
     WHERE payment_id = $1 AND status = 'pending'`,
    [paymentId]
  );

  return parseFloat(rows[0]?.total || '0');
}
