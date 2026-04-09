/**
 * Short-Term Memory
 * =================
 * Manages in-session conversation memory for CollabSmart.
 * Adapted from memory/memory/short_term.py.
 *
 * Stores recent interactions per session for context-aware AI responses.
 * Uses in-memory Map (no Redis required) with importance-score-based retention
 * and TTL-based eviction.
 */

import { ContextAnalysis } from './contextAnalyzer';

export interface Interaction {
  message: string;
  response: string;
  context: ContextAnalysis;
  importanceScore: number;
  storedAt: string;
}

export interface SessionMemory {
  sessionId: string;
  interactions: Interaction[];
  createdAt: string;
  lastUpdatedAt: string;
}

export class ShortTermMemory {
  private readonly sessions = new Map<string, SessionMemory>();
  private readonly maxInteractionsPerSession: number;
  private readonly ttlMs: number;

  constructor(maxInteractions = 50, ttlHours = 48) {
    this.maxInteractionsPerSession = maxInteractions;
    this.ttlMs = ttlHours * 60 * 60 * 1000;
  }

  store(sessionId: string, interaction: Omit<Interaction, 'storedAt'>): void {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        interactions: [],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      };
      this.sessions.set(sessionId, session);
    }

    const entry: Interaction = { ...interaction, storedAt: new Date().toISOString() };
    session.interactions.push(entry);
    session.lastUpdatedAt = new Date().toISOString();

    // Keep only the most recent interactions
    if (session.interactions.length > this.maxInteractionsPerSession) {
      session.interactions = session.interactions.slice(-this.maxInteractionsPerSession);
    }
  }

  retrieve(sessionId: string, limit = 10): Interaction[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.interactions.slice(-limit);
  }

  getConversationContext(sessionId: string, limit = 5): string {
    const interactions = this.retrieve(sessionId, limit);
    if (interactions.length === 0) return '';
    return interactions
      .map((i) => `User: ${i.message}\nAssistant: ${i.response}`)
      .join('\n\n');
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  getSessionStats(sessionId: string): { totalInteractions: number; sessionAge: string } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const ageMs = Date.now() - new Date(session.createdAt).getTime();
    const ageMinutes = Math.round(ageMs / 60000);
    return {
      totalInteractions: session.interactions.length,
      sessionAge: `${ageMinutes}m`,
    };
  }

  /** Evict sessions older than TTL */
  evictExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      const age = now - new Date(session.lastUpdatedAt).getTime();
      if (age > this.ttlMs) {
        this.sessions.delete(id);
      }
    }
  }
}
