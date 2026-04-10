/**
 * Memory Manager
 * ==============
 * Central orchestrator for the CollabSmart tiered memory system.
 *
 * Architecture (adapted from memory/memory_system/memory_manager.py):
 *   Tier 1 (0-48h)   — Dragonfly/Redis working memory (fast, ephemeral)
 *   Tier 2 (48-96h)  — PostgreSQL short-term memory (with importance scoring)
 *   Tier 3 (96-144h) — PostgreSQL recent archive (final before LTM or deletion)
 *   Long-Term        — PostgreSQL semantic memory (permanent, compressed)
 *
 * Maintenance cycle (every 6 hours):
 *   1. Age Tier 2 messages >96h to Tier 3
 *   2. Promote high-importance (>=5.0) messages from both tiers to LTM
 *   3. Purge expired Tier 3 messages that did not qualify for LTM
 *
 * Also manages user profiles, collaboration mode selection, and O*NET enrichment.
 */

import Redis from 'ioredis';
import { Pool } from 'pg';
import logger from '../logger';

import { ContextAnalyzer } from './contextAnalyzer';
import { WorkingMemory } from './workingMemory';
import { ShortTermMemory, calculateImportanceScore, extractEmotionalMarkers } from './shortTermMemory';
import { LongTermMemory } from './longTermMemory';
import { PersonalityLearning } from './personalityLearning';
import { ModeSelector } from './modeSelector';
import { OnetIntegration } from './onetIntegration';

import {
  ContextAnalysis,
  CollabMode,
  EnrichedContext,
  StoredMessage,
  UserProfile,
} from './types';

const SCENARIO_GUIDANCE: Record<string, string> = {
  debugging: 'Focus on root-cause diagnosis. Ask for error messages or stack traces if not provided.',
  code_review: 'Lead with strengths before improvements. Reference concrete patterns and best practices.',
  architecture: 'Think at the system level. Surface trade-offs, scalability, and long-term maintainability.',
  feature_development: 'Break the implementation into verifiable increments. Confirm approach before writing code.',
  testing: 'Suggest comprehensive coverage including edge cases, boundary values, and error paths.',
  documentation: 'Write clear, concise docs. Include examples and parameter descriptions.',
  deployment: 'Work through CI/CD steps systematically. Verify each gate before moving to the next.',
  refactoring: 'Keep behaviour identical. Use small, verifiable steps with tests as a safety net.',
  performance: 'Profile before optimising. Establish a baseline, then measure each change.',
  security: 'Apply defence-in-depth. Validate all inputs, apply least-privilege, and surface CVEs.',
  learning: 'Build understanding step by step. Use concrete examples and invite questions.',
  general: 'Engage collaboratively. Clarify intent before diving into implementation.',
};

export class MemoryManager {
  private readonly contextAnalyzer: ContextAnalyzer;
  private readonly workingMemory: WorkingMemory;
  private readonly shortTermMemory: ShortTermMemory;
  private readonly longTermMemory: LongTermMemory;
  private readonly personalityLearning: PersonalityLearning;
  private readonly modeSelector: ModeSelector;
  private readonly onetIntegration: OnetIntegration;
  private readonly maintenanceTimer: ReturnType<typeof setInterval>;
  private pgAvailable = false;
  private redisAvailable = false;

  constructor(private readonly pool: Pool, private readonly redis: Redis) {
    this.contextAnalyzer = new ContextAnalyzer();
    this.workingMemory = new WorkingMemory(redis);
    this.shortTermMemory = new ShortTermMemory(pool);
    this.longTermMemory = new LongTermMemory(pool);
    this.personalityLearning = new PersonalityLearning(pool);
    this.modeSelector = new ModeSelector(pool);
    this.onetIntegration = new OnetIntegration(pool);

    // Run maintenance every 6 hours
    this.maintenanceTimer = setInterval(
      () => void this.runMaintenance(),
      6 * 60 * 60 * 1000,
    );

    logger.info('MemoryManager initialised');
  }

  /** Test DB connections and mark availability */
  async connect(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
      this.pgAvailable = true;
      logger.info('MemoryManager: PostgreSQL connection verified');
    } catch (err) {
      logger.error('MemoryManager: PostgreSQL unavailable — memory degraded to working-memory only', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      // With lazyConnect: true, we must explicitly connect before issuing commands
      if (this.redis.status === 'wait') {
        await this.redis.connect();
      }
      await this.redis.ping();
      this.redisAvailable = true;
      logger.info('MemoryManager: Dragonfly/Redis connection verified');
    } catch (err) {
      logger.warn('MemoryManager: Dragonfly/Redis unavailable — Tier 1 cache disabled', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Stop background maintenance. Call on graceful shutdown. */
  destroy(): void {
    clearInterval(this.maintenanceTimer);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Core API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Analyse a new user message and build an enriched context object.
   * Called BEFORE sending to Claude so the system prompt can be augmented.
   */
  async analyzeAndRetrieve(
    sessionId: string,
    userMessage: string,
    userId?: string,
  ): Promise<EnrichedContext> {
    const analysis = this.contextAnalyzer.analyze(userMessage);

    let userProfile: UserProfile | null = null;
    if (this.pgAvailable && userId) {
      userProfile = await this.personalityLearning.getOrCreateUser(userId).catch(() => null);
    }

    const selectedMode = this.modeSelector.select(analysis, userProfile);

    // Retrieve recent working-memory context
    let recentHistory = '';
    if (this.redisAvailable) {
      recentHistory = await this.workingMemory.getContextString(sessionId, 5).catch(() => '');
    }

    // Retrieve long-term memories relevant to this scenario
    let longTermContext = '';
    if (this.pgAvailable) {
      const ltm = await this.longTermMemory
        .retrieveRelevant(analysis.scenarioType, [
          ...analysis.detectedLanguages,
          ...analysis.detectedTools,
        ], 3)
        .catch(() => []);

      if (ltm.length > 0) {
        longTermContext = ltm
          .map((m) => `[Memory] ${m.concept}: ${m.summary}`)
          .join('\n');
      }
    }

    // O*NET role enrichment
    let onetEnrichment = '';
    if (this.pgAvailable) {
      onetEnrichment = await this.onetIntegration
        .enrichContext(userProfile?.primaryRole, analysis.detectedLanguages)
        .catch(() => '');
    }

    const importanceScore = calculateImportanceScore(
      userMessage,
      [],
      analysis.urgency === 'high',
    );

    const systemPromptAddition = this.buildSystemPromptAddition(
      analysis,
      selectedMode,
      recentHistory,
      longTermContext,
      onetEnrichment,
    );

    return {
      analysis,
      recentHistory,
      longTermContext,
      systemPromptAddition,
      importanceScore,
      userProfile,
    };
  }

  /**
   * Store a completed interaction (user message + assistant response).
   * Called AFTER Claude responds.
   */
  async storeInteraction(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    context: ContextAnalysis,
    userId?: string,
  ): Promise<void> {
    const tags: string[] = [];
    if (userMessage.includes('[collab]') || assistantResponse.includes('[collab]')) tags.push('[collab]');

    const userMarkers = extractEmotionalMarkers(userMessage);
    const userScore = calculateImportanceScore(userMessage, tags, context.urgency === 'high');

    const userMsg: StoredMessage = {
      sessionId,
      userId,
      messageType: 'user',
      content: userMessage,
      scenarioType: context.scenarioType,
      tags,
      programmingLanguages: context.detectedLanguages,
      toolsMentioned: context.detectedTools,
      emotionalMarkers: userMarkers,
      importanceScore: userScore,
      timestamp: new Date(),
    };

    const aiMsg: StoredMessage = {
      sessionId,
      userId,
      messageType: 'assistant',
      content: assistantResponse,
      scenarioType: context.scenarioType,
      tags,
      programmingLanguages: context.detectedLanguages,
      toolsMentioned: context.detectedTools,
      emotionalMarkers: extractEmotionalMarkers(assistantResponse),
      importanceScore: userScore * 0.8,
      timestamp: new Date(),
    };

    // Always attempt working memory (Tier 1)
    if (this.redisAvailable) {
      await this.workingMemory.store(userMsg).catch((e) =>
        logger.warn('[MemoryManager] working memory store failed', { error: e.message }),
      );
      await this.workingMemory.store(aiMsg).catch((e) =>
        logger.warn('[MemoryManager] working memory store failed', { error: e.message }),
      );
    }

    // Tier 2 (PostgreSQL) — for significant messages or those with importance
    if (this.pgAvailable && (userScore >= 2.0 || tags.includes('[collab]'))) {
      await this.shortTermMemory.store(userMsg).catch((e) =>
        logger.warn('[MemoryManager] short-term store failed', { error: e.message }),
      );
    }

    // Update user profile
    if (this.pgAvailable && userId) {
      await this.personalityLearning
        .recordInteraction(userId, sessionId, context.detectedLanguages)
        .catch(() => {});

      await this.personalityLearning
        .inferAndStoreRole(userId, context.detectedLanguages)
        .catch(() => {});

      // Track mode usage for learning
      const mode = this.modeSelector.select(context, null);
      await this.modeSelector
        .recordUsage(sessionId, userId, mode, context.scenarioType, context.detectedLanguages)
        .catch(() => {});
    }
  }

  /** Clear all memory tiers for a session (e.g., on explicit reset or disconnect) */
  async clearSession(sessionId: string): Promise<void> {
    if (this.redisAvailable) {
      await this.workingMemory.clear(sessionId).catch(() => {});
    }
    logger.info(`[MemoryManager] session cleared: ${sessionId}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Background maintenance
  // ──────────────────────────────────────────────────────────────────────────

  /** Age, promote, and purge memories across all tiers */
  async runMaintenance(): Promise<void> {
    if (!this.pgAvailable) return;

    logger.info('[MemoryManager] running maintenance cycle');

    const now = new Date();

    // Tier 2 → Tier 3: messages older than 96 hours
    const t2Cutoff = new Date(now.getTime() - 96 * 3600 * 1000);
    await this.shortTermMemory.ageToTier3(t2Cutoff).catch((e) =>
      logger.error('[MemoryManager] ageToTier3 failed', { error: e.message }),
    );

    // Promote high-importance Tier 2 candidates to LTM
    const t2Candidates = await this.shortTermMemory.getPromotionCandidates(5.0).catch(() => []);
    if (t2Candidates.length > 0) {
      const promoted = await this.longTermMemory.promoteToLongTerm(t2Candidates, 2).catch(() => 0);
      for (const c of t2Candidates.slice(0, promoted)) {
        if (c.id) await this.shortTermMemory.markPromoted(c.id).catch(() => {});
      }
    }

    // Promote eligible Tier 3 candidates
    const t3Candidates = await this.longTermMemory.getTier3Candidates().catch(() => []);
    if (t3Candidates.length > 0) {
      await this.longTermMemory.promoteToLongTerm(t3Candidates, 3).catch((e) =>
        logger.error('[MemoryManager] t3 promotion failed', { error: e.message }),
      );
    }

    // Purge Tier 3 records older than 144 hours that did not qualify
    const t3Cutoff = new Date(now.getTime() - 144 * 3600 * 1000);
    await this.longTermMemory.purgeExpiredArchive(t3Cutoff).catch((e) =>
      logger.error('[MemoryManager] purgeExpiredArchive failed', { error: e.message }),
    );

    logger.info('[MemoryManager] maintenance cycle complete');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public accessors
  // ──────────────────────────────────────────────────────────────────────────

  get onet(): OnetIntegration {
    return this.onetIntegration;
  }

  get personality(): PersonalityLearning {
    return this.personalityLearning;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────────────────────────────────

  private buildSystemPromptAddition(
    analysis: ContextAnalysis,
    mode: CollabMode,
    recentHistory: string,
    longTermContext: string,
    onetEnrichment: string,
  ): string {
    const parts: string[] = [];

    if (recentHistory) {
      parts.push(`## Recent Conversation\n${recentHistory}`);
    }

    if (longTermContext) {
      parts.push(`## Persistent Context\n${longTermContext}`);
    }

    if (onetEnrichment) {
      parts.push(`## User Role Context\n${onetEnrichment}`);
    }

    const guidance = SCENARIO_GUIDANCE[analysis.scenarioType];
    const modeChars = this.modeSelector.getModeCharacteristics(mode);

    const contextLines: string[] = [
      `- Detected scenario: **${analysis.scenarioType}**. ${guidance}`,
      `- Collaboration mode: **${mode}** — ${modeChars.approach}. Tone: ${modeChars.tone}.`,
    ];

    if (analysis.urgency === 'high') {
      contextLines.push('- **Urgency: HIGH** — prioritise direct, actionable steps. No fluff.');
    }
    if (analysis.emotion === 'struggling') {
      contextLines.push('- The user appears frustrated or stuck. Be especially patient and clear.');
    }
    if (analysis.detectedLanguages.length > 0) {
      contextLines.push(`- Detected languages: ${analysis.detectedLanguages.join(', ')}.`);
    }
    if (analysis.detectedTools.length > 0) {
      contextLines.push(`- Detected tools: ${analysis.detectedTools.join(', ')}.`);
    }

    parts.push(`## Interaction Context\n${contextLines.join('\n')}`);

    return parts.join('\n\n');
  }
}
