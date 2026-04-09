/**
 * Personality / Collaboration Learning
 * =====================================
 * Learns and persists user collaboration preferences across sessions.
 * Stores user profiles, communication style, and primary technical role
 * in PostgreSQL so the AI pair-programmer adapts over time.
 *
 * Adapted from memory/memory/personality_learning.py for CollabSmart.
 */

import { Pool } from 'pg';
import logger from '../logger';
import { UserProfile, CollabMode } from './types';

export class PersonalityLearning {
  constructor(private readonly pool: Pool) {}

  /** Get or create a user profile */
  async getOrCreateUser(userId: string): Promise<UserProfile> {
    const existing = await this.pool.query<{
      user_id: string;
      session_count: number;
      preferred_mode: string;
      communication_style: string;
      primary_role: string | null;
      preferred_languages: string[];
      total_interactions: number;
      first_interaction: Date;
      last_interaction: Date;
      preferences: Record<string, unknown>;
    }>(
      `SELECT user_id, session_count, preferred_mode, communication_style,
              primary_role, preferred_languages, total_interactions,
              first_interaction, last_interaction, preferences
       FROM collabsmart_users WHERE user_id = $1`,
      [userId],
    );

    if (existing.rows.length > 0) {
      const r = existing.rows[0];
      return {
        userId: r.user_id,
        sessionCount: r.session_count,
        preferredMode: r.preferred_mode as CollabMode,
        communicationStyle: r.communication_style as 'concise' | 'balanced' | 'detailed',
        primaryRole: r.primary_role ?? undefined,
        preferredLanguages: r.preferred_languages,
        totalInteractions: r.total_interactions,
        firstInteraction: r.first_interaction,
        lastInteraction: r.last_interaction,
        preferences: r.preferences,
      };
    }

    // Create new user
    await this.pool.query(
      `INSERT INTO collabsmart_users
         (user_id, session_count, preferred_mode, communication_style, preferred_languages)
       VALUES ($1, 1, 'collaborative', 'balanced', ARRAY[]::text[])
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );

    return {
      userId,
      sessionCount: 1,
      preferredMode: 'collaborative',
      communicationStyle: 'balanced',
      preferredLanguages: [],
      totalInteractions: 0,
      firstInteraction: new Date(),
      lastInteraction: new Date(),
      preferences: {},
    };
  }

  /** Increment interaction count and update last-active timestamp */
  async recordInteraction(
    userId: string,
    sessionId: string,
    languages: string[],
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO collabsmart_users
         (user_id, session_count, total_interactions, last_interaction, preferred_languages)
       VALUES ($1, 1, 1, NOW(), $2)
       ON CONFLICT (user_id) DO UPDATE
         SET total_interactions = collabsmart_users.total_interactions + 1,
             last_interaction = NOW(),
             preferred_languages = (
               SELECT array_agg(DISTINCT elem)
               FROM (
                 SELECT unnest(collabsmart_users.preferred_languages) AS elem
                 UNION
                 SELECT unnest($2::text[]) AS elem
               ) sub
             )`,
      [userId, languages],
    );
    logger.debug(`[PersonalityLearning] recorded interaction for user=${userId}`);
  }

  /** Detect and update preferred communication style based on observed message lengths */
  async updateCommunicationStyle(
    userId: string,
    avgUserMessageLength: number,
  ): Promise<void> {
    let style: 'concise' | 'balanced' | 'detailed';
    if (avgUserMessageLength < 80) style = 'concise';
    else if (avgUserMessageLength < 250) style = 'balanced';
    else style = 'detailed';

    await this.pool.query(
      `UPDATE collabsmart_users SET communication_style = $1 WHERE user_id = $2`,
      [style, userId],
    );
  }

  /** Persist explicitly learned preferences (e.g., primary role, language, mode) */
  async updatePreferences(
    userId: string,
    updates: Partial<{
      preferredMode: CollabMode;
      primaryRole: string;
      communicationStyle: 'concise' | 'balanced' | 'detailed';
      preferences: Record<string, unknown>;
    }>,
  ): Promise<void> {
    const setClauses: string[] = [];
    const values: unknown[] = [userId];
    let idx = 2;

    if (updates.preferredMode !== undefined) {
      setClauses.push(`preferred_mode = $${idx++}`);
      values.push(updates.preferredMode);
    }
    if (updates.primaryRole !== undefined) {
      setClauses.push(`primary_role = $${idx++}`);
      values.push(updates.primaryRole);
    }
    if (updates.communicationStyle !== undefined) {
      setClauses.push(`communication_style = $${idx++}`);
      values.push(updates.communicationStyle);
    }
    if (updates.preferences !== undefined) {
      setClauses.push(`preferences = $${idx++}`);
      values.push(JSON.stringify(updates.preferences));
    }

    if (setClauses.length === 0) return;

    await this.pool.query(
      `UPDATE collabsmart_users SET ${setClauses.join(', ')} WHERE user_id = $1`,
      values,
    );
  }

  /**
   * Infer primary role from detected languages and scenario types.
   * Called after multiple sessions to build a picture of the user's expertise.
   */
  async inferAndStoreRole(userId: string, detectedLanguages: string[]): Promise<void> {
    if (detectedLanguages.length === 0) return;

    const inferredRole = this.guessRole(detectedLanguages);
    if (!inferredRole) return;

    await this.pool.query(
      `UPDATE collabsmart_users
       SET primary_role = COALESCE(primary_role, $1)
       WHERE user_id = $2 AND primary_role IS NULL`,
      [inferredRole, userId],
    );
  }

  private guessRole(languages: string[]): string | null {
    const set = new Set(languages.map((l) => l.toLowerCase()));
    if (set.has('rust') || set.has('c++') || set.has('go')) return 'systems-engineer';
    if (set.has('python') && (set.has('sql') || set.has('tensorflow'))) return 'data-scientist';
    if (set.has('typescript') || set.has('javascript')) return 'web-developer';
    if (set.has('shell') || set.has('terraform') || set.has('kubernetes')) return 'devops-engineer';
    if (set.has('java') || set.has('kotlin')) return 'backend-developer';
    if (set.has('swift')) return 'mobile-developer';
    if (set.has('python')) return 'developer';
    return null;
  }
}
