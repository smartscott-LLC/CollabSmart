/**
 * App Settings Service
 * ====================
 * Reads/writes runtime settings from the app_settings PostgreSQL table.
 * Falls back to environment variables when the database is unavailable.
 * Settings are cached in memory for 60 seconds to avoid per-request DB hits.
 */

import { getPgPool } from '../db/pool';
import logger from '../logger';

export interface AppSetting {
  key: string;
  value: string;
  description: string;
}

// Env-var fallbacks used when the DB is unavailable.
const ENV_DEFAULTS: Record<string, string> = {
  session_recording_enabled: process.env.SESSION_RECORDING_ENABLED ?? 'false',
  memory_promotion_threshold: process.env.MEMORY_PROMOTION_THRESHOLD ?? '5.0',
  working_memory_ttl_hours: process.env.WORKING_MEMORY_TTL_HOURS ?? '48',
  max_conversation_history: process.env.MAX_CONVERSATION_HISTORY ?? '100',
  log_level: process.env.LOG_LEVEL ?? 'info',
  ai_provider: process.env.AI_PROVIDER ?? 'anthropic',
  ai_model: process.env.AI_MODEL ?? 'claude-haiku-4-5-20251001',
  ai_max_tokens: process.env.AI_MAX_TOKENS ?? '4096',
  ai_base_url: process.env.AI_BASE_URL ?? '',
  dragonfly_max_memory: process.env.DRAGONFLY_MAX_MEMORY ?? '2gb',
};

let cache: Record<string, string> | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60_000;

/** Return all settings, keyed by name. Values come from DB with env-var fallback. */
export async function getAllSettings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cache && now < cacheExpiresAt) return cache;

  try {
    const pool = getPgPool();
    const result = await pool.query<{ key: string; value: string }>(
      'SELECT key, value FROM app_settings ORDER BY key',
    );
    const fresh: Record<string, string> = { ...ENV_DEFAULTS };
    for (const row of result.rows) {
      fresh[row.key] = row.value;
    }
    cache = fresh;
    cacheExpiresAt = now + CACHE_TTL_MS;
    return fresh;
  } catch {
    return { ...ENV_DEFAULTS };
  }
}

/** Return all settings with metadata (for the Settings API endpoint). */
export async function getAllSettingsWithMeta(): Promise<AppSetting[]> {
  try {
    const pool = getPgPool();
    const result = await pool.query<AppSetting>(
      'SELECT key, value, COALESCE(description, \'\') AS description FROM app_settings ORDER BY key',
    );
    return result.rows;
  } catch {
    return Object.entries(ENV_DEFAULTS).map(([key, value]) => ({ key, value, description: '' }));
  }
}

/** Return a single setting value, with an env-var / hardcoded fallback. */
export async function getSetting(key: string, defaultValue: string): Promise<string> {
  const all = await getAllSettings();
  return all[key] ?? defaultValue;
}

/** Persist a setting change and invalidate the cache. */
export async function setSetting(key: string, value: string): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO app_settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value],
  );
  cache = null; // invalidate so next read fetches fresh values
  logger.info(`Setting updated: ${key} = ${value}`);
}
