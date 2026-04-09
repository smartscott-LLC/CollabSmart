/**
 * Working Memory — Tier 1 (0-48 hours)
 * ======================================
 * Fast in-session storage using Dragonfly (Redis-compatible).
 * Raw conversation messages stored as JSON lists, keyed by session_id.
 * Expires after 48 hours automatically via Redis TTL.
 *
 * Adapted from memory/memory_system/memory_manager.py Tier 1 section.
 */

import Redis from 'ioredis';
import logger from '../logger';
import { StoredMessage } from './types';

const TTL_SECONDS = 48 * 3600; // 48 hours

export class WorkingMemory {
  constructor(private readonly redis: Redis) {}

  private key(sessionId: string): string {
    return `collabsmart:working:${sessionId}`;
  }

  async store(message: Omit<StoredMessage, 'id'>): Promise<void> {
    const k = this.key(message.sessionId);
    const payload = JSON.stringify({
      messageType: message.messageType,
      content: message.content,
      scenarioType: message.scenarioType,
      conversationTopic: message.conversationTopic,
      tags: message.tags,
      programmingLanguages: message.programmingLanguages,
      toolsMentioned: message.toolsMentioned,
      emotionalMarkers: message.emotionalMarkers,
      importanceScore: message.importanceScore,
      timestamp: (message.timestamp ?? new Date()).toISOString(),
    });

    await this.redis.rpush(k, payload);
    await this.redis.expire(k, TTL_SECONDS);
    logger.debug(`[WorkingMemory] stored message for session ${message.sessionId}`);
  }

  async retrieve(sessionId: string): Promise<StoredMessage[]> {
    const k = this.key(sessionId);
    const raw = await this.redis.lrange(k, 0, -1);
    return raw.map((item) => {
      const parsed = JSON.parse(item) as {
        messageType: 'user' | 'assistant' | 'system';
        content: string;
        scenarioType: StoredMessage['scenarioType'];
        conversationTopic?: string;
        tags: string[];
        programmingLanguages: string[];
        toolsMentioned: string[];
        emotionalMarkers: string[];
        importanceScore: number;
        timestamp: string;
      };
      return {
        sessionId,
        messageType: parsed.messageType,
        content: parsed.content,
        scenarioType: parsed.scenarioType,
        conversationTopic: parsed.conversationTopic,
        tags: parsed.tags,
        programmingLanguages: parsed.programmingLanguages,
        toolsMentioned: parsed.toolsMentioned,
        emotionalMarkers: parsed.emotionalMarkers,
        importanceScore: parsed.importanceScore,
        timestamp: new Date(parsed.timestamp),
      } satisfies StoredMessage;
    });
  }

  async getContextString(sessionId: string, limit = 5): Promise<string> {
    const messages = await this.retrieve(sessionId);
    if (messages.length === 0) return '';

    const MESSAGES_PER_TURN = 2; // one user message + one assistant message per turn
    const recent = messages.slice(-limit * MESSAGES_PER_TURN);
    const pairs: string[] = [];

    for (let i = 0; i < recent.length - 1; i++) {
      const m = recent[i];
      const next = recent[i + 1];
      if (m.messageType === 'user' && next.messageType === 'assistant') {
        pairs.push(`User: ${m.content}\nAssistant: ${next.content}`);
        i++;
      }
    }

    return pairs.slice(-limit).join('\n\n');
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
    logger.debug(`[WorkingMemory] cleared session ${sessionId}`);
  }

  /** Returns all session keys for maintenance operations */
  async getAllSessionKeys(): Promise<string[]> {
    return this.redis.keys('collabsmart:working:*');
  }
}
