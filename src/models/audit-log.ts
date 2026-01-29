import { query } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import type { PoolClient } from 'pg';

export interface AuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  actor: string | null;
  actor_type: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export interface CreateAuditLogInput {
  entity_type: string;
  entity_id: string;
  action: string;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  actor?: string;
  actor_type?: string;
  ip_address?: string;
  user_agent?: string;
}

export async function createAuditLog(
  input: CreateAuditLogInput,
  client?: PoolClient
): Promise<AuditLog> {
  const id = uuidv4();
  const queryFn = client ? client.query.bind(client) : query;

  const { rows } = await queryFn<AuditLog>(
    `INSERT INTO audit_logs (
      id, entity_type, entity_id, action, old_value, new_value,
      actor, actor_type, ip_address, user_agent
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      id,
      input.entity_type,
      input.entity_id,
      input.action,
      input.old_value ? JSON.stringify(input.old_value) : null,
      input.new_value ? JSON.stringify(input.new_value) : null,
      input.actor || null,
      input.actor_type || 'system',
      input.ip_address || null,
      input.user_agent || null,
    ]
  );

  return rows[0]!;
}

export async function getAuditLogsByEntity(
  entityType: string,
  entityId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ logs: AuditLog[]; total: number }> {
  const { limit = 50, offset = 0 } = options;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM audit_logs
     WHERE entity_type = $1 AND entity_id = $2`,
    [entityType, entityId]
  );

  const { rows } = await query<AuditLog>(
    `SELECT * FROM audit_logs
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [entityType, entityId, limit, offset]
  );

  return {
    logs: rows,
    total: parseInt(countResult.rows[0]?.count || '0', 10),
  };
}

export async function getAuditLogsByActor(
  actor: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ logs: AuditLog[]; total: number }> {
  const { limit = 50, offset = 0 } = options;

  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM audit_logs WHERE actor = $1',
    [actor]
  );

  const { rows } = await query<AuditLog>(
    `SELECT * FROM audit_logs
     WHERE actor = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [actor, limit, offset]
  );

  return {
    logs: rows,
    total: parseInt(countResult.rows[0]?.count || '0', 10),
  };
}
