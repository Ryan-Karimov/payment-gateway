import { query } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import type { PoolClient } from 'pg';

export interface Transaction {
  id: string;
  payment_id: string;
  status: string;
  provider_response: Record<string, unknown> | null;
  error_message: string | null;
  created_at: Date;
}

export interface CreateTransactionInput {
  payment_id: string;
  status: string;
  provider_response?: Record<string, unknown>;
  error_message?: string;
}

export async function createTransaction(
  input: CreateTransactionInput,
  client?: PoolClient
): Promise<Transaction> {
  const id = uuidv4();
  const queryFn = client ? client.query.bind(client) : query;

  const { rows } = await queryFn<Transaction>(
    `INSERT INTO transactions (id, payment_id, status, provider_response, error_message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      id,
      input.payment_id,
      input.status,
      input.provider_response ? JSON.stringify(input.provider_response) : null,
      input.error_message || null,
    ]
  );

  return rows[0]!;
}

export async function getTransactionsByPaymentId(
  paymentId: string
): Promise<Transaction[]> {
  const { rows } = await query<Transaction>(
    `SELECT * FROM transactions
     WHERE payment_id = $1
     ORDER BY created_at ASC`,
    [paymentId]
  );
  return rows;
}

export async function getLatestTransaction(
  paymentId: string
): Promise<Transaction | null> {
  const { rows } = await query<Transaction>(
    `SELECT * FROM transactions
     WHERE payment_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [paymentId]
  );
  return rows[0] || null;
}
