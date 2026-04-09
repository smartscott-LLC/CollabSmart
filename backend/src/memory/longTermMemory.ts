/**
 * Long-Term Memory — Tier 3 + Semantic Long-Term
 * ================================================
 * PostgreSQL-backed permanent semantic memory.
 * Handles:
 *   - Tier 3 (recent_archive): messages 96-144h old, eligible for promotion
 *   - Long-term (long_term_memory): compressed conceptual memories, permanent
 *
 * Semantic extraction uses heuristic compression (first sentence + key terms).
 * Reference counts and recency signals strengthen important memories over time.
 *
 * Adapted from memory/memory/long_term.py and memory_system/memory_manager.py LTM section.
 */

import { Pool, PoolClient } from 'pg';
import logger from '../logger';
import { StoredMessage, SemanticMemory } from './types';

const PROMOTION_THRESHOLD = 5.0;

export class LongTermMemory {
  constructor(private readonly pool: Pool) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Tier 3 operations
  // ──────────────────────────────────────────────────────────────────────────

  /** Delete tier 3 messages older than 144h that did not qualify for promotion */
  async purgeExpiredArchive(cutoffDate: Date): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM recent_archive
       WHERE archived_at < $1
         AND NOT eligible_for_promotion`,
      [cutoffDate],
    );
    const count = result.rowCount ?? 0;
    if (count > 0) logger.info(`[LongTermMemory] purged ${count} expired archive entries`);
    return count;
  }

  /** Fetch tier 3 records eligible for promotion */
  async getTier3Candidates(limit = 50): Promise<StoredMessage[]> {
    const result = await this.pool.query<{
      id: string; session_id: string; user_id: string | null;
      message_type: string; content: string; scenario_type: string;
      conversation_topic: string | null; tags: string[];
      programming_languages: string[]; tools_mentioned: string[];
      emotional_markers: string[]; importance_score: number; timestamp: Date;
    }>(
      `SELECT id, session_id, user_id, message_type, content, scenario_type,
              conversation_topic, tags, programming_languages, tools_mentioned,
              emotional_markers, importance_score, timestamp
       FROM recent_archive
       WHERE eligible_for_promotion
         AND importance_score >= $1
       ORDER BY importance_score DESC
       LIMIT $2`,
      [PROMOTION_THRESHOLD, limit],
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

  // ──────────────────────────────────────────────────────────────────────────
  // Long-term semantic memory operations
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Promote a set of high-importance messages into compressed semantic memories.
   * Called during background maintenance after importance threshold is met.
   */
  async promoteToLongTerm(
    messages: StoredMessage[],
    sourceTier: 2 | 3,
  ): Promise<number> {
    if (messages.length === 0) return 0;

    const client: PoolClient = await this.pool.connect();
    let promoted = 0;

    try {
      await client.query('BEGIN');

      for (const msg of messages) {
        const semantic = this.compressToSemantic(msg);
        if (!semantic) continue;

        // Upsert: if concept already exists, refresh the reference and score
        const existing = await client.query<{ id: string; importance_score: number; reference_count: number }>(
          `SELECT id, importance_score, reference_count
           FROM long_term_memory WHERE concept = $1`,
          [semantic.concept],
        );

        if (existing.rows.length > 0) {
          const row = existing.rows[0];
          await client.query(
            `UPDATE long_term_memory
             SET last_referenced = NOW(),
                 reference_count = reference_count + 1,
                 importance_score = LEAST($1, 10.0),
                 source_sessions = array_append(source_sessions, $2)
             WHERE id = $3`,
            [
              Math.max(row.importance_score, semantic.importanceScore),
              msg.sessionId,
              row.id,
            ],
          );
        } else {
          await client.query(
            `INSERT INTO long_term_memory
               (concept, summary, emotional_valence, sentiment_score,
                related_concepts, key_entities, scenario_types,
                importance_score, first_mentioned, last_referenced,
                promoted_from, source_sessions)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              semantic.concept,
              semantic.summary,
              semantic.emotionalValence,
              semantic.sentimentScore,
              semantic.relatedConcepts,
              semantic.keyEntities,
              semantic.scenarioTypes,
              semantic.importanceScore,
              semantic.firstMentioned,
              semantic.lastReferenced,
              `tier_${sourceTier}`,
              semantic.sourceSessions,
            ],
          );
        }

        // Log promotion
        await client.query(
          `INSERT INTO promotion_log
             (source_id, source_tier, destination, importance_score, promotion_reason)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            msg.id ?? '00000000-0000-0000-0000-000000000000',
            sourceTier,
            'long_term_memory',
            msg.importanceScore,
            `markers: ${msg.emotionalMarkers.join(', ')} | scenario: ${msg.scenarioType}`,
          ],
        );

        promoted++;
      }

      await client.query('COMMIT');
      if (promoted > 0) logger.info(`[LongTermMemory] promoted ${promoted} semantic memories`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return promoted;
  }

  /**
   * Retrieve long-term memories relevant to the current session context.
   * Matches by scenario type and key entities.
   */
  async retrieveRelevant(
    scenarioType: string,
    entities: string[],
    limit = 5,
  ): Promise<Array<{ concept: string; summary: string; importanceScore: number }>> {
    const result = await this.pool.query<{
      concept: string;
      summary: string;
      importance_score: number;
    }>(
      `SELECT concept, summary, importance_score
       FROM long_term_memory
       WHERE $1 = ANY(scenario_types)
          OR key_entities && $2
       ORDER BY importance_score DESC, last_referenced DESC
       LIMIT $3`,
      [scenarioType, entities.length > 0 ? entities : ['__no_match__'], limit],
    );

    // Update reference counts for retrieved memories
    if (result.rows.length > 0) {
      const concepts = result.rows.map((r) => r.concept);
      await this.pool.query(
        `UPDATE long_term_memory
         SET reference_count = reference_count + 1,
             last_referenced = NOW()
         WHERE concept = ANY($1)`,
        [concepts],
      );
    }

    return result.rows.map((r) => ({
      concept: r.concept,
      summary: r.summary,
      importanceScore: r.importance_score,
    }));
  }

  /**
   * Store a foundation memory (e.g., project context, user identity).
   * These are inserted with maximum importance and never purged.
   */
  async storeFoundationMemory(
    concept: string,
    summary: string,
    keyEntities: string[],
    scenarioTypes: string[],
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO long_term_memory
         (concept, summary, emotional_valence, sentiment_score,
          key_entities, scenario_types, importance_score,
          first_mentioned, last_referenced, promoted_from, source_sessions)
       VALUES ($1,$2,'foundational',1.0,$3,$4,10.0,NOW(),NOW(),'foundation',ARRAY[]::text[])
       ON CONFLICT (concept) DO NOTHING`,
      [concept, summary, keyEntities, scenarioTypes],
    );
    logger.info(`[LongTermMemory] stored foundation memory: ${concept}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Semantic compression
  // ──────────────────────────────────────────────────────────────────────────

  private compressToSemantic(msg: StoredMessage): SemanticMemory | null {
    // Derive concept from first sentence (≤120 chars)
    const firstSentence = (msg.content.split(/[.!?\n]/)[0] ?? '').trim();
    if (firstSentence.length < 5) return null;
    const concept = firstSentence.length > 120
      ? firstSentence.slice(0, 117) + '...'
      : firstSentence;

    const summary = msg.content.length > 500
      ? msg.content.slice(0, 497) + '...'
      : msg.content;

    const sentimentScore = this.deriveSentiment(msg.emotionalMarkers);

    return {
      concept,
      summary,
      emotionalValence: msg.emotionalMarkers.join(', ') || 'neutral',
      sentimentScore,
      relatedConcepts: [],
      keyEntities: [
        ...msg.programmingLanguages,
        ...msg.toolsMentioned,
        ...(msg.conversationTopic ? [msg.conversationTopic] : []),
      ],
      scenarioTypes: [msg.scenarioType],
      importanceScore: msg.importanceScore,
      firstMentioned: msg.timestamp,
      lastReferenced: msg.timestamp,
      sourceSessions: [msg.sessionId],
    };
  }

  private deriveSentiment(markers: string[]): number {
    const positive = new Set(['breakthrough', 'finally', 'elegant', 'interesting']);
    const negative = new Set(['struggling', 'complex']);
    let score = 0.0;
    for (const m of markers) {
      if (positive.has(m)) score += 0.3;
      if (negative.has(m)) score -= 0.15;
    }
    return Math.max(-1.0, Math.min(1.0, score));
  }
}
