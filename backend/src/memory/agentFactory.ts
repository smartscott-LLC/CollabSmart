/**
 * Agent Factory
 * =============
 * Manages a library of specialized domain-expert agents synthesized from O*NET
 * occupational data and evolved through usage tracking and feedback.
 *
 * Responsibilities:
 *   1. Select the best-matching specialized agent for each interaction scenario.
 *   2. Inject the agent's system-prompt template into Claude's context.
 *   3. Record each agent invocation and tool call for learning.
 *   4. Store and retrieve "tool success patterns" — sequences of tool calls that
 *      previously led to good outcomes — so the AI can reuse proven approaches.
 *
 * Schema: specialized_agents, agent_invocations, tool_success_patterns
 * (all defined in backend/db/schema.sql).
 */

import { Pool } from 'pg';
import logger from '../logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpecializedAgent {
  id: string;
  agentCode: string;
  agentName: string;
  description: string;
  specializationDomain: string;
  systemPromptTemplate: string;
  delegationRules: DelegationRules;
  capabilities: AgentCapabilities;
  totalInvocations: number;
  successfulInvocations: number;
  avgConfidenceScore: number;
  avgUserRating: number;
  isActive: boolean;
}

export interface DelegationRules {
  trigger_keywords: string[];
  scenario_types: string[];
  complexity_threshold: number;
}

export interface AgentCapabilities {
  knowledge_domains: Array<{ domain: string; importance: number }>;
  skills: Array<{ skill: string; level: number }>;
  abilities?: Array<{ ability: string; level: number }>;
}

export interface ToolSuccessPattern {
  id: string;
  patternName: string;
  scenarioType: string;
  toolSequence: string[];
  contextDescription: string;
  outcomeDescription: string;
  successCount: number;
  avgRating: number;
  importanceScore: number;
  lastUsed: Date;
}

export interface RecordInvocationParams {
  agentId: string | undefined;
  sessionId: string;
  userId: string | undefined;
  userQuery: string;
  toolUsed: string | undefined;
  toolInput: Record<string, unknown> | undefined;
  toolOutputExcerpt: string | undefined;
  wasSuccessful: boolean;
  processingTimeMs: number;
  delegationConfidence: number;
  delegationReason: string;
  scenarioType: string;
}

// ─── Agent Factory ─────────────────────────────────────────────────────────

export class AgentFactory {
  constructor(private readonly pool: Pool) {}

  // ── Agent selection ───────────────────────────────────────────────────────

  /**
   * Select the most appropriate specialized agent for the current interaction.
   * Returns the agent whose delegation rules best match the message + scenario.
   */
  async selectAgent(
    message: string,
    scenarioType: string,
  ): Promise<SpecializedAgent | null> {
    const agents = await this.getActiveAgents();
    if (agents.length === 0) return null;

    const lower = message.toLowerCase();

    // Score each agent based on keyword and scenario matches
    const scored = agents.map((agent) => {
      const rules = agent.delegationRules;
      let score = 0;

      // Scenario type match (high weight)
      if (rules.scenario_types?.includes(scenarioType)) score += 10;

      // Keyword matches (medium weight)
      const keywordMatches = (rules.trigger_keywords ?? []).filter((kw) =>
        lower.includes(kw.toLowerCase()),
      ).length;
      score += keywordMatches * 2;

      return { agent, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score === 0) return null;

    return best.agent;
  }

  /** Return all active agents, ordered by invocation count desc */
  async getActiveAgents(): Promise<SpecializedAgent[]> {
    const result = await this.pool.query<{
      id: string;
      agent_code: string;
      agent_name: string;
      description: string;
      specialization_domain: string;
      system_prompt_template: string;
      delegation_rules: DelegationRules;
      capabilities: AgentCapabilities;
      total_invocations: number;
      successful_invocations: number;
      avg_confidence_score: number;
      avg_user_rating: number;
      is_active: boolean;
    }>(
      `SELECT id, agent_code, agent_name, description, specialization_domain,
              system_prompt_template, delegation_rules, capabilities,
              total_invocations, successful_invocations,
              avg_confidence_score, avg_user_rating, is_active
       FROM specialized_agents
       WHERE is_active = TRUE
       ORDER BY total_invocations DESC`,
    );

    return result.rows.map((r) => ({
      id: r.id,
      agentCode: r.agent_code,
      agentName: r.agent_name,
      description: r.description,
      specializationDomain: r.specialization_domain,
      systemPromptTemplate: r.system_prompt_template,
      delegationRules: r.delegation_rules,
      capabilities: r.capabilities,
      totalInvocations: r.total_invocations,
      successfulInvocations: r.successful_invocations,
      avgConfidenceScore: r.avg_confidence_score,
      avgUserRating: r.avg_user_rating,
      isActive: r.is_active,
    }));
  }

  // ── Invocation tracking ───────────────────────────────────────────────────

  /** Record a single agent invocation (one tool call within a session turn) */
  async recordInvocation(params: RecordInvocationParams): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_invocations
         (agent_id, session_id, user_id, user_query, tool_used, tool_input,
          tool_output_excerpt, was_successful, processing_time_ms,
          delegation_confidence, delegation_reason, scenario_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        params.agentId ?? null,
        params.sessionId,
        params.userId ?? null,
        params.userQuery,
        params.toolUsed ?? null,
        params.toolInput ? JSON.stringify(params.toolInput) : null,
        params.toolOutputExcerpt
          ? params.toolOutputExcerpt.slice(0, 500)
          : null,
        params.wasSuccessful,
        params.processingTimeMs,
        params.delegationConfidence,
        params.delegationReason,
        params.scenarioType,
      ],
    );

    // Update aggregate stats on the agent row
    if (params.agentId) {
      await this.pool.query(
        `UPDATE specialized_agents
         SET total_invocations     = total_invocations + 1,
             successful_invocations = successful_invocations + $1::int,
             last_invoked_at        = NOW()
         WHERE id = $2`,
        [params.wasSuccessful ? 1 : 0, params.agentId],
      );
    }
  }

  // ── Tool success patterns ─────────────────────────────────────────────────

  /**
   * Store a successful tool-use sequence.
   * Called after a complete interaction (all tool calls resolved, final
   * response delivered) so we remember what worked for future sessions.
   */
  async storeSuccessPattern(
    sessionId: string,
    userId: string | undefined,
    toolSequence: string[],
    scenarioType: string,
    contextDescription: string,
    outcomeDescription: string,
    programmingLanguages: string[],
    importanceScore: number,
  ): Promise<void> {
    if (toolSequence.length === 0) return;

    const patternName = `${scenarioType}: ${toolSequence.join(' → ')}`;

    // Check whether an identical pattern already exists
    const existing = await this.pool.query<{ id: string; success_count: number }>(
      `SELECT id, success_count
       FROM tool_success_patterns
       WHERE tool_sequence = $1 AND scenario_type = $2
       LIMIT 1`,
      [toolSequence, scenarioType],
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      await this.pool.query(
        `UPDATE tool_success_patterns
         SET success_count  = success_count + 1,
             last_used      = NOW(),
             importance_score = LEAST(importance_score + 0.5, 10.0)
         WHERE id = $1`,
        [row.id],
      );
    } else {
      await this.pool.query(
        `INSERT INTO tool_success_patterns
           (pattern_name, scenario_type, tool_sequence, context_description,
            outcome_description, success_count, tags, programming_languages,
            session_id, user_id, importance_score)
         VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10)`,
        [
          patternName,
          scenarioType,
          toolSequence,
          contextDescription,
          outcomeDescription,
          [],
          programmingLanguages,
          sessionId,
          userId ?? null,
          importanceScore,
        ],
      );
    }

    logger.debug(`[AgentFactory] stored success pattern: ${patternName}`);
  }

  /**
   * Retrieve tool success patterns relevant to the current scenario.
   * Patterns are sorted by success count × importance so the most proven
   * sequences appear first.  Stale patterns (controlled by the
   * max_tool_pattern_age_days setting) are excluded.
   */
  async getRelevantPatterns(
    scenarioType: string,
    languages: string[],
    maxAgeDays: number,
    limit = 3,
  ): Promise<ToolSuccessPattern[]> {
    const cutoff = maxAgeDays > 0
      ? new Date(Date.now() - maxAgeDays * 86400 * 1000)
      : new Date(0);

    const result = await this.pool.query<{
      id: string;
      pattern_name: string;
      scenario_type: string;
      tool_sequence: string[];
      context_description: string;
      outcome_description: string;
      success_count: number;
      avg_rating: number;
      importance_score: number;
      last_used: Date;
    }>(
      `SELECT id, pattern_name, scenario_type, tool_sequence,
              context_description, outcome_description,
              success_count, avg_rating, importance_score, last_used
       FROM tool_success_patterns
       WHERE (scenario_type = $1
              OR programming_languages && $2)
         AND last_used > $3
       ORDER BY (success_count * importance_score) DESC
       LIMIT $4`,
      [scenarioType, languages.length > 0 ? languages : ['__none__'], cutoff, limit],
    );

    return result.rows.map((r) => ({
      id: r.id,
      patternName: r.pattern_name,
      scenarioType: r.scenario_type,
      toolSequence: r.tool_sequence,
      contextDescription: r.context_description,
      outcomeDescription: r.outcome_description,
      successCount: r.success_count,
      avgRating: r.avg_rating,
      importanceScore: r.importance_score,
      lastUsed: r.last_used,
    }));
  }

  /**
   * Store a manually-curated tool pattern directly (via the memory_store tool).
   * Used when the AI explicitly wants to remember something for later.
   */
  async storeManualPattern(
    sessionId: string,
    userId: string | undefined,
    patternName: string,
    toolSequence: string[],
    scenarioType: string,
    outcomeDescription: string,
    importanceScore = 8.0,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO tool_success_patterns
         (pattern_name, scenario_type, tool_sequence, context_description,
          outcome_description, success_count, session_id, user_id, importance_score)
       VALUES ($1,$2,$3,'manually stored',$4,1,$5,$6,$7)
       ON CONFLICT DO NOTHING`,
      [
        patternName,
        scenarioType,
        toolSequence,
        outcomeDescription,
        sessionId,
        userId ?? null,
        importanceScore,
      ],
    );
    logger.info(`[AgentFactory] manual pattern stored: ${patternName}`);
  }

  // ── Feedback ──────────────────────────────────────────────────────────────

  /** Record an explicit user feedback rating for a session interaction */
  async recordFeedback(
    sessionId: string,
    userId: string | undefined,
    rating: number,
    feedbackText: string | undefined,
    scenarioType: string,
    responseExcerpt: string | undefined,
    ledToSolution: boolean | undefined,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_feedback
         (session_id, user_id, feedback_type, rating, feedback_text,
          scenario_type, response_excerpt, led_to_solution)
       VALUES ($1,$2,'explicit',$3,$4,$5,$6,$7)`,
      [
        sessionId,
        userId ?? null,
        rating,
        feedbackText ?? null,
        scenarioType,
        responseExcerpt ? responseExcerpt.slice(0, 500) : null,
        ledToSolution ?? null,
      ],
    );
  }

  /**
   * Build the system-prompt fragment for an activated agent.
   * Returns an empty string if the agent factory is disabled or no matching
   * agent is found.
   */
  buildAgentPromptFragment(agent: SpecializedAgent): string {
    const topKnowledge = (agent.capabilities.knowledge_domains ?? [])
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 3)
      .map((k) => k.domain)
      .join(', ');

    const topSkills = (agent.capabilities.skills ?? [])
      .sort((a, b) => b.level - a.level)
      .slice(0, 3)
      .map((s) => s.skill)
      .join(', ');

    return [
      `## Activated Expert: ${agent.agentName}`,
      agent.systemPromptTemplate,
      topKnowledge ? `Core knowledge: ${topKnowledge}.` : '',
      topSkills ? `Key skills: ${topSkills}.` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Format retrieved tool success patterns into a system-prompt fragment.
   * Returns an empty string when no patterns are available.
   */
  buildPatternFragment(patterns: ToolSuccessPattern[]): string {
    if (patterns.length === 0) return '';

    const lines = patterns.map(
      (p, i) =>
        `${i + 1}. [${p.scenarioType}] ${p.toolSequence.join(' → ')}: ${p.outcomeDescription} (used ${p.successCount}×)`,
    );

    return `## Proven Tool Sequences (use these when applicable)\n${lines.join('\n')}`;
  }
}
