/**
 * Mode Selector
 * =============
 * Determines the optimal collaboration mode for each interaction based on
 * learned user preferences, detected scenario, and emotional context.
 *
 * Modes (replacing warehouse communication modes):
 *   collaborative  - active pair-programming, building together
 *   exploratory    - brainstorming, open-ended design discussions
 *   structured     - step-by-step debugging, systematic analysis
 *   quick_assist   - fast targeted answers
 *   teacher        - patient explanations, learning-focused
 *
 * Adapted from memory/personality/mode_selector.py for CollabSmart.
 */

import { Pool } from 'pg';
import logger from '../logger';
import { CollabMode, ContextAnalysis, UserProfile } from './types';

/** Scenario-to-default-mode mapping */
const SCENARIO_DEFAULTS: Record<string, CollabMode> = {
  debugging: 'structured',
  code_review: 'exploratory',
  architecture: 'exploratory',
  feature_development: 'collaborative',
  testing: 'structured',
  documentation: 'teacher',
  deployment: 'structured',
  refactoring: 'exploratory',
  performance: 'structured',
  security: 'structured',
  learning: 'teacher',
  general: 'collaborative',
};

export class ModeSelector {
  constructor(private readonly pool: Pool) {}

  /**
   * Select the collaboration mode for the current interaction.
   * Priority: user explicit preference → context override → scenario default.
   */
  select(context: ContextAnalysis, profile: UserProfile | null): CollabMode {
    // Base mode from scenario
    let mode: CollabMode = SCENARIO_DEFAULTS[context.scenarioType] ?? 'collaborative';

    // Override: high urgency → structured (systematic and fast)
    if (context.urgency === 'high') {
      mode = 'structured';
    }

    // Override: user struggling → teacher (patient guidance)
    if (context.emotion === 'struggling') {
      mode = 'teacher';
    }

    // Override: explicit user preference when no strong urgency/emotion signal
    if (profile && context.urgency !== 'high' && context.emotion !== 'struggling') {
      mode = profile.preferredMode;
    }

    logger.debug(`[ModeSelector] selected mode=${mode} for scenario=${context.scenarioType}`);
    return mode;
  }

  /** Record that a mode was used for a given scenario and track its performance */
  async recordUsage(
    sessionId: string,
    userId: string | undefined,
    mode: CollabMode,
    scenarioType: string,
    programmingLanguages: string[],
  ): Promise<void> {
    if (!userId) return;

    await this.pool.query(
      `INSERT INTO collaboration_learning
         (user_id, session_id, scenario_type, mode_used, programming_languages)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, sessionId, scenarioType, mode, programmingLanguages],
    );

    // Update aggregate mode performance table
    await this.pool.query(
      `INSERT INTO mode_performance (mode, scenario_type, usage_count, last_used)
       VALUES ($1,$2,1,NOW())
       ON CONFLICT (mode, scenario_type) DO UPDATE
         SET usage_count = mode_performance.usage_count + 1,
             last_used = NOW()`,
      [mode, scenarioType],
    );
  }

  /** Record implicit satisfaction (based on whether the user's follow-up was successful) */
  async recordSatisfaction(
    userId: string,
    mode: CollabMode,
    scenarioType: string,
    score: number,
  ): Promise<void> {
    // Update the most recent unscored record for this user+mode+scenario combination
    await this.pool.query(
      `UPDATE collaboration_learning
       SET implicit_satisfaction = $1
       WHERE id = (
         SELECT id
         FROM collaboration_learning
         WHERE user_id = $2
           AND mode_used = $3
           AND scenario_type = $4
           AND implicit_satisfaction IS NULL
         ORDER BY created_at DESC
         LIMIT 1
       )`,
      [score, userId, mode, scenarioType],
    );

    // Refresh aggregate average satisfaction
    await this.pool.query(
      `UPDATE mode_performance
       SET avg_satisfaction = (
             SELECT AVG(implicit_satisfaction)
             FROM collaboration_learning
             WHERE mode_used = $1
               AND scenario_type = $2
               AND implicit_satisfaction IS NOT NULL
           ),
           updated_at = NOW()
       WHERE mode = $1 AND scenario_type = $2`,
      [mode, scenarioType],
    );
  }

  /** Retrieve user's learned mode preference based on past success rates */
  async inferPreferredMode(userId: string): Promise<CollabMode | null> {
    const result = await this.pool.query<{ mode_used: string; cnt: string }>(
      `SELECT mode_used, COUNT(*) as cnt
       FROM collaboration_learning
       WHERE user_id = $1
         AND implicit_satisfaction >= 0.7
       GROUP BY mode_used
       ORDER BY cnt DESC
       LIMIT 1`,
      [userId],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].mode_used as CollabMode;
  }

  getModeCharacteristics(mode: CollabMode): {
    tone: string;
    responseLength: string;
    approach: string;
  } {
    const chars: Record<CollabMode, { tone: string; responseLength: string; approach: string }> = {
      collaborative: {
        tone: 'collegial and engaged, thinking alongside the user',
        responseLength: 'medium',
        approach: 'share reasoning, propose, iterate together',
      },
      exploratory: {
        tone: 'open and curious, surfaces trade-offs',
        responseLength: 'medium-long',
        approach: 'present multiple options, explain pros/cons, invite feedback',
      },
      structured: {
        tone: 'precise and systematic',
        responseLength: 'as needed — concise for simple steps, detailed for complex ones',
        approach: 'numbered steps, verify each step, anticipate blockers',
      },
      quick_assist: {
        tone: 'direct and efficient',
        responseLength: 'brief',
        approach: 'answer first, optional brief explanation, no preamble',
      },
      teacher: {
        tone: 'patient and encouraging',
        responseLength: 'detailed when needed',
        approach: 'build understanding, use examples, check comprehension',
      },
    };
    return chars[mode];
  }
}
