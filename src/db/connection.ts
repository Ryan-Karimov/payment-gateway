import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { pool } from '../config/database.js';

export { pool };

export interface TransactionCallback<T> {
  (client: PoolClient): Promise<T>;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export async function withTransaction<T>(
  callback: TransactionCallback<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withLock<T>(
  lockKey: string,
  callback: TransactionCallback<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Advisory lock using hash of the key
    const lockId = hashStringToInt(lockKey);
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockId]);

    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function hashStringToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
