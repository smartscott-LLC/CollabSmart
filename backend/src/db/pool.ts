/**
 * Database connection pools for CollabSmart memory system.
 * Exports a pg.Pool (PostgreSQL) and an ioredis.Redis (Dragonfly/Redis) instance.
 * Both are lazy-initialized and share the same lifecycle.
 */

import { Pool } from 'pg';
import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../logger';

let pgPool: Pool | null = null;
let redisClient: Redis | null = null;

export function getPgPool(): Pool {
  if (!pgPool) {
    pgPool = new Pool({
      host: process.env.POSTGRES_HOST || 'postgres',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_DB || 'collabsmart',
      user: process.env.POSTGRES_USER || 'collabsmart',
      password: process.env.POSTGRES_PASSWORD || 'collabsmart',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pgPool.on('error', (err) => {
      logger.error('PostgreSQL pool error', { error: err.message });
    });
  }
  return pgPool;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.DRAGONFLY_HOST || process.env.REDIS_HOST || 'dragonfly',
      port: parseInt(process.env.DRAGONFLY_PORT || process.env.REDIS_PORT || '6379', 10),
      password: process.env.DRAGONFLY_PASSWORD || process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.DRAGONFLY_DB || '0', 10),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    redisClient.on('error', (err) => {
      logger.warn('Dragonfly/Redis error (memory degraded to DB-only)', { error: err.message });
    });

    redisClient.on('connect', () => {
      logger.info('Dragonfly/Redis connected');
    });
  }
  return redisClient;
}

/** Initialise schema. Safe to call multiple times. */
export async function initSchema(): Promise<void> {
  const schemaPath = path.join(__dirname, '../../../backend/db/schema.sql');
  if (!fs.existsSync(schemaPath)) {
    logger.warn('schema.sql not found at expected path, skipping DB init');
    return;
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const pool = getPgPool();
  await pool.query(sql);
  logger.info('CollabSmart schema initialised');
}

export async function closePools(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  if (redisClient) {
    redisClient.disconnect();
    redisClient = null;
  }
}
