/**
 * Memory Manager
 * ==============
 * Orchestrates the CollabSmart memory system.
 * Adapted from memory/memory_system/memory_manager.py.
 *
 * Provides:
 * - Interaction storage with importance scoring
 * - Context-enriched system prompt additions
 * - Conversation history for AI context
 */

import { ContextAnalyzer, ContextAnalysis } from './contextAnalyzer';
import { ShortTermMemory, Interaction } from './shortTermMemory';
import logger from '../logger';

// Importance weights for message markers (adapted from memory_system/memory_manager.py)
const IMPORTANCE_MARKERS: Record<string, number> = {
  urgent: 2.0,
  critical: 2.5,
  important: 1.5,
  please: 0.5,
  stuck: 2.0,
  blocked: 2.0,
  production: 2.5,
  deadline: 2.0,
  broken: 2.0,
};

// Per-scenario guidance injected into the system prompt
const SCENARIO_GUIDANCE: Record<string, string> = {
  debugging:
    'Focus on diagnosing the root cause. Ask for error messages or stack traces if not provided.',
  code_review:
    'Provide constructive feedback. Highlight strengths before suggesting improvements.',
  architecture:
    'Think at the system level. Consider scalability, maintainability, and trade-offs.',
  documentation: 'Write clear, concise, and complete documentation.',
  testing: 'Suggest comprehensive test coverage. Include edge cases and boundary conditions.',
  general_coding: 'Write clean, idiomatic code following existing project conventions.',
  environment: 'Help troubleshoot setup issues step by step, checking one thing at a time.',
  learning: 'Be patient and educational. Use concrete examples and build on what the user knows.',
};

export interface EnrichedContext {
  analysis: ContextAnalysis;
  recentHistory: string;
  systemPromptAddition: string;
  importanceScore: number;
}

export class MemoryManager {
  private readonly contextAnalyzer = new ContextAnalyzer();
  private readonly shortTermMemory = new ShortTermMemory();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    // Run periodic cleanup every hour; store timer so it can be cleared on destroy
    this.cleanupTimer = setInterval(() => this.shortTermMemory.evictExpired(), 60 * 60 * 1000);
    logger.info('Memory system initialized');
  }

  /** Stop background cleanup. Call when shutting down the server. */
  destroy(): void {
    clearInterval(this.cleanupTimer);
  }

  /**
   * Analyze a new user message and retrieve relevant history.
   * Call this before sending the message to Claude.
   */
  analyzeAndRetrieve(sessionId: string, message: string): EnrichedContext {
    const analysis = this.contextAnalyzer.analyze(message);
    const recentHistory = this.shortTermMemory.getConversationContext(sessionId, 5);
    const importanceScore = this.calculateImportance(message, analysis);
    const systemPromptAddition = this.buildSystemPromptAddition(analysis, recentHistory);

    return { analysis, recentHistory, systemPromptAddition, importanceScore };
  }

  /**
   * Store a completed interaction in short-term memory.
   * Call this after receiving Claude's response.
   */
  storeInteraction(
    sessionId: string,
    message: string,
    response: string,
    context: ContextAnalysis,
  ): void {
    const importanceScore = this.calculateImportance(message, context);
    this.shortTermMemory.store(sessionId, { message, response, context, importanceScore });
  }

  /**
   * Clear memory for a session (e.g., on disconnect or explicit reset).
   */
  clearSession(sessionId: string): void {
    this.shortTermMemory.clearSession(sessionId);
    logger.info(`Memory cleared for session ${sessionId}`);
  }

  /**
   * Get recent interactions for a session.
   */
  getRecentInteractions(sessionId: string, limit = 10): Interaction[] {
    return this.shortTermMemory.retrieve(sessionId, limit);
  }

  /**
   * Get session stats (interaction count, age).
   */
  getSessionStats(sessionId: string) {
    return this.shortTermMemory.getSessionStats(sessionId);
  }

  private calculateImportance(message: string, context: ContextAnalysis): number {
    let score = 0.0;
    const lower = message.toLowerCase();

    for (const [marker, weight] of Object.entries(IMPORTANCE_MARKERS)) {
      if (lower.includes(marker)) score += weight;
    }

    if (context.urgency === 'high') score += 2.0;
    else if (context.urgency === 'medium') score += 1.0;

    if (message.length > 200) score += 0.5;
    if (message.length > 500) score += 0.5;

    if (context.requiresDeepAnalysis) score += 1.5;

    return Math.min(score, 10.0);
  }

  private buildSystemPromptAddition(analysis: ContextAnalysis, recentHistory: string): string {
    const parts: string[] = [];

    if (recentHistory) {
      parts.push(`## Recent Conversation\n${recentHistory}`);
    }

    const contextLines: string[] = [];

    if (analysis.urgency === 'high') {
      contextLines.push('- The user has an urgent issue. Be direct and prioritize actionable steps.');
    }

    if (analysis.emotion === 'stressed') {
      contextLines.push('- The user seems frustrated or stuck. Be patient and especially clear.');
    }

    if (analysis.scenarioType && SCENARIO_GUIDANCE[analysis.scenarioType]) {
      contextLines.push(
        `- Detected scenario: **${analysis.scenarioType}**. ${SCENARIO_GUIDANCE[analysis.scenarioType]}`,
      );
    }

    if (analysis.isQuestion) {
      contextLines.push('- The user is asking a question. Provide a clear, direct answer first.');
    }

    if (contextLines.length > 0) {
      parts.push(`## Interaction Context\n${contextLines.join('\n')}`);
    }

    return parts.join('\n\n');
  }
}

// Singleton instance shared across all sessions
export const memoryManager = new MemoryManager();
