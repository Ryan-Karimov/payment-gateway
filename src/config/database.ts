import { Pool, PoolConfig } from 'pg';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

const poolConfig: PoolConfig = {
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  max: config.database.poolSize,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

export const pool = new Pool(poolConfig);

// Track consecutive errors for circuit breaker pattern
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

pool.on('error', (err) => {
  consecutiveErrors++;
  logger.error(
    { error: err.message, consecutiveErrors },
    'Unexpected error on idle database client'
  );

  // Only exit if we have sustained connection failures
  // This prevents a single transient error from killing the process
  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    logger.fatal(
      { consecutiveErrors },
      'Too many consecutive database errors, initiating shutdown'
    );
    // Emit SIGTERM to allow graceful shutdown
    process.kill(process.pid, 'SIGTERM');
  }
});

pool.on('connect', () => {
  // Reset error counter on successful connection
  consecutiveErrors = 0;
});

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
