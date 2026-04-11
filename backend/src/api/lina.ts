/**
 * lina.ts — LINA Identity Service Client
 *
 * TypeScript client for the LINA Identity Service (Python/FastAPI).
 * Handles all HTTP communication between the CollabSmart backend
 * and LINA's identity, memory, and values layer.
 *
 * The contract:
 *   - On session start:  linaSessionStart()  → registers the session with LINA
 *   - On each message:   linaGetContext()    → LINA's system prompt injection
 *   - After response:    linaEvaluate()      → value engine check
 *   - On disconnect:     linaSessionEnd()    → memory formation
 */

import logger from '../logger';

const LINA_URL = process.env.LINA_SERVICE_URL || 'http://lina:8001';
const LINA_TIMEOUT_MS = 5000;

// ── Types ──────────────────────────────────────────────────────────────────

export interface LINAContext {
  system_prompt: string;
  user_id: string;
  season: string;
  relationship_depth: string;
  session_number: number;
}

export interface LINAEvaluation {
  is_aligned: boolean;
  alignment_score: number;
  was_corrected: boolean;
  correction_magnitude: number;
  violations: Array<{
    dimension: number;
    name: string;
    value: number;
    bound: number;
    type: string;
    severity: number;
  }>;
  wisdom: {
    filter_applied: boolean;
    overconfidence: boolean;
    humility_suggested: boolean;
    validation_suggested: boolean;
    notes: string[];
  };
}

// ── Internal fetch with timeout ────────────────────────────────────────────

async function linaFetch(
  path: string,
  options: RequestInit = {},
  timeoutMs = LINA_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${LINA_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Ensure LINA is initialized for a user. Safe to call on every session start.
 */
export async function linaInit(userId: string): Promise<void> {
  try {
    await linaFetch('/lina/init', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  } catch (err) {
    logger.warn('[LINA] init failed (non-fatal)', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Register a session with LINA. Returns session metadata.
 */
export async function linaSessionStart(
  userId: string,
  sessionId: string,
): Promise<{ season: string; session_number: number } | null> {
  try {
    const res = await linaFetch('/lina/session/start', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, session_id: sessionId }),
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ season: string; session_number: number }>;
  } catch (err) {
    logger.warn('[LINA] session start failed (non-fatal)', {
      userId, sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Get LINA's system prompt and context for a user.
 * Returns null on failure — caller falls back to the default system prompt.
 */
export async function linaGetContext(userId: string): Promise<LINAContext | null> {
  try {
    const res = await linaFetch(`/lina/context/${encodeURIComponent(userId)}`);
    if (!res.ok) return null;
    return res.json() as Promise<LINAContext>;
  } catch (err) {
    logger.warn('[LINA] context fetch failed (non-fatal)', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Evaluate a response through LINA's value engine.
 * Returns null on failure — evaluation is advisory, never blocking.
 */
export async function linaEvaluate(
  userId: string,
  sessionId: string,
  responseText: string,
  context?: string,
): Promise<LINAEvaluation | null> {
  try {
    const res = await linaFetch('/lina/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        session_id: sessionId,
        response_text: responseText,
        context,
      }),
    });
    if (!res.ok) return null;
    return res.json() as Promise<LINAEvaluation>;
  } catch (err) {
    logger.warn('[LINA] evaluate failed (non-fatal)', {
      userId, sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Signal session end to LINA. Triggers memory formation.
 * Fire-and-forget — does not block the disconnect flow.
 */
export async function linaSessionEnd(
  userId: string,
  sessionId: string,
): Promise<void> {
  try {
    const res = await linaFetch('/lina/session/end', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, session_id: sessionId }),
      // Give memory formation more time
    }, 30_000);

    if (res.ok) {
      const result = await res.json() as {
        episodic_formed: number;
        semantic_updated: number;
        identity_formed: number;
      };
      logger.info('[LINA] session ended — memories formed', {
        sessionId,
        episodic: result.episodic_formed,
        semantic: result.semantic_updated,
        identity: result.identity_formed,
      });
    }
  } catch (err) {
    logger.warn('[LINA] session end failed (non-fatal)', {
      userId, sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
