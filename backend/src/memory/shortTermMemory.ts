/**
 * Short-Term Memory — Tier 2 (48-96 hours)
 * ==========================================
 * PostgreSQL-backed storage for messages that have aged out of working memory.
 * Includes importance scoring, scenario tracking, and promotion eligibility.
 *
 * Adapted from memory/memory/short_term.py and memory_system/memory_manager.py Tier 2.
 */

import { Pool, PoolClient } from 'pg';
import logger from '../logger';
import { StoredMessage } from './types';

const IMPORTANCE_MARKERS: Record<string, number> = {
  breakthrough: 2.5,
  finally: 2.0,
  insight: 2.0,
  pattern: 1.5,
  elegant: 1.8,
  interesting: 1.5,
  explore: 1.5,
  struggling: 1.8,
  complex: 1.2,
  critical: 2.5,
  production: 2.5,
  security: 2.0,
  '[collab]': 3.0,
  architecture: 1.8,
  refactor: 1.5,
  design: 1.5,
};

export function calculateImportanceScore(
  content: string,
  tags: string[],
  urgencyHigh = false,
): number {
  let score = 0.0;
  const lower = content.toLowerCase();

  for (const [marker, weight] of Object.entries(IMPORTANCE_MARKERS)) {
    if (lower.includes(marker.toLowerCase())) score += weight;
  }

  if (tags.includes('[collab]')) score += 1.0;  // bonus on top of marker weight
  if (urgencyHigh) score += 2.0;
  if (content.length > 200) score += 0.5;
  if (content.length > 500) score += 0.5;

  return Math.min(score, 10.0);
}

export function extractEmotionalMarkers(content: string): string[] {
  const lower = content.toLowerCase();
  return Object.keys(IMPORTANCE_MARKERS).filter((m) => lower.includes(m.toLowerCase()));
}

export class ShortTermMemory {
  constructor(private readonly pool: Pool) {}

  async store(message: StoredMessage): Promise<string> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ id: string }>(
        `INSERT INTO short_term_memory
           (session_id, user_id, message_type, content, scenario_type,
            conversation_topic, tags, programming_languages, tools_mentioned,
            emotional_markers, importance_score, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          message.sessionId,
          message.userId ?? null,
          message.messageType,
          message.content,
          message.scenarioType,
          message.conversationTopic ?? null,
          message.tags,
          message.programmingLanguages,
          message.toolsMentioned,
          message.emotionalMarkers,
          message.importanceScore,
          message.timestamp,
        ],
      );
      logger.debug(`[ShortTermMemory] stored id=${result.rows[0].id} for session ${message.sessionId}`);
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  /** Retrieve recent messages for a session from Tier 2 */
  async retrieve(sessionId: string, limit = 20): Promise<StoredMessage[]> {
    const result = await this.pool.query<{
      id: string;
      session_id: string;
      user_id: string | null;
      message_type: string;
      content: string;
      scenario_type: string;
      conversation_topic: string | null;
      tags: string[];
      programming_languages: string[];
      tools_mentioned: string[];
      emotional_markers: string[];
      importance_score: number;
      timestamp: Date;
    }>(
      `SELECT id, session_id, user_id, message_type, content, scenario_type,
              conversation_topic, tags, programming_languages, tools_mentioned,
              emotional_markers, importance_score, timestamp
       FROM short_term_memory
       WHERE session_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [sessionId, limit],
    );

    return result.rows.reverse().map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      userId: r.user_id ?? undefined,
      messageType: r.message_type as 'user' | 'assistant' | 'system',
      content: r.content,
      scenarioType: r.scenario_type as StoredMessage['scenarioType'],
      conversationTopic: r.conversation_topic ?? undefined,
      tags: r.tags,
      programmingLanguages: r.programming_languages,
      toolsMentioned: r.tools_mentioned,
      emotionalMarkers: r.emotional_markers,
      importanceScore: r.importance_score,
      timestamp: r.timestamp,
    }));
  }

  /** Move messages older than 96h (tier 2 upper bound) from short_term to recent_archive */
  async ageToTier3(cutoffDate: Date): Promise<number> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const archive = await client.query(
        `INSERT INTO recent_archive
           (session_id, user_id, timestamp, message_type, content, scenario_type,
            conversation_topic, tags, programming_languages, tools_mentioned,
            reference_count, emotional_markers, importance_score,
            archived_from_tier, archived_at, eligible_for_promotion)
         SELECT
           session_id, user_id, timestamp, message_type, content, scenario_type,
           conversation_topic, tags, programming_languages, tools_mentioned,
           reference_count, emotional_markers, importance_score,
           2, NOW(),
           (importance_score >= 5.0) AS eligible_for_promotion
         FROM short_term_memory
         WHERE timestamp < $1
           AND NOT promoted_to_long_term
         RETURNING id`,
        [cutoffDate],
      );

      await client.query(
        `DELETE FROM short_term_memory WHERE timestamp < $1 AND NOT promoted_to_long_term`,
        [cutoffDate],
      );

      await client.query('COMMIT');
      const count = archive.rowCount ?? 0;
      if (count > 0) logger.info(`[ShortTermMemory] aged ${count} messages to Tier 3`);
      return count;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Retrieve top candidates for long-term promotion from Tier 2 */
  async getPromotionCandidates(threshold: number, limit = 50): Promise<StoredMessage[]> {
    const result = await this.pool.query<{
      id: string; session_id: string; user_id: string | null;
      message_type: string; content: string; scenario_type: string;
      conversation_topic: string | null; tags: string[]; programming_languages: string[];
      tools_mentioned: string[]; emotional_markers: string[];
      importance_score: number; timestamp: Date;
    }>(
      `SELECT id, session_id, user_id, message_type, content, scenario_type,
              conversation_topic, tags, programming_languages, tools_mentioned,
              emotional_markers, importance_score, timestamp
       FROM short_term_memory
       WHERE importance_score >= $1
         AND NOT promoted_to_long_term
       ORDER BY importance_score DESC
       LIMIT $2`,
      [threshold, limit],
    );
    return result.rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      userId: r.user_id ?? undefined,
      messageType: r.message_type as 'user' | 'assistant' | 'system',
      content: r.content,
      scenarioType: r.scenario_type as StoredMessage['scenarioType'],
      conversationTopic: r.conversation_topic ?? undefined,
      tags: r.tags,
      programmingLanguages: r.programming_languages,
      toolsMentioned: r.tools_mentioned,
      emotionalMarkers: r.emotional_markers,
      importanceScore: r.importance_score,
      timestamp: r.timestamp,
    }));
  }

  async markPromoted(id: string): Promise<void> {
    await this.pool.query(
      'UPDATE short_term_memory SET promoted_to_long_term = TRUE WHERE id = $1',
      [id],
    );
  }
}
