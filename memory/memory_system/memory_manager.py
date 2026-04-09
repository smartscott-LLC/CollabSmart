"""
the LLM Memory System - Tiered Caching with Importance Scoring
Implements Gemini's architecture for consciousness-level memory

Architecture:
- Tier 1 (0-48h): Redis in-memory cache (working memory)
- Tier 2 (48-96h): PostgreSQL fast storage (short-term memory)
- Tier 3 (96-144h): PostgreSQL archive (recent archive)
- Long-term: Semantic compressed storage (memory imprint)
"""

import os
import json
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from dataclasses import dataclass
import re

import redis.asyncio as redis
import asyncpg
from openai import AsyncOpenAI


@dataclass
class Message:
    """A conversational message with metadata"""
    session_id: str
    user_id: Optional[str]
    message_type: str  # 'user', 'assistant', 'system'
    content: str
    conversation_topic: Optional[str] = None
    tags: List[str] = None
    timestamp: Optional[datetime] = None

    def __post_init__(self):
        if self.tags is None:
            self.tags = []
        if self.timestamp is None:
            self.timestamp = datetime.utcnow()


@dataclass
class SemanticMemory:
    """A compressed, conceptual long-term memory"""
    concept: str
    summary: str
    emotional_valence: str
    sentiment_score: float
    related_concepts: List[str]
    key_entities: List[str]
    importance_score: float
    first_mentioned: datetime
    last_referenced: datetime
    source_sessions: List[str]


class MemoryManager:
    """
    Manages the LLM's tiered memory system

    Responsibilities:
    - Store conversations in appropriate tier based on age
    - Calculate importance scores
    - Promote important memories to long-term storage
    - Age out old, unimportant memories
    """

    def __init__(
        self,
        redis_url: str = None,
        postgres_url: str = None,
        openai_api_key: str = None
    ):
        """Initialize memory manager with connections"""
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379")
        self.postgres_url = postgres_url or os.getenv("POSTGRES_URL")
        self.openai_api_key = openai_api_key or os.getenv("OPENAI_API_KEY")

        self.redis: Optional[redis.Redis] = None
        self.pg_pool: Optional[asyncpg.Pool] = None
        self.openai_client: Optional[AsyncOpenAI] = None

        # Emotional markers for importance scoring
        self.emotional_markers = {
            'wish': 2.0,
            'want': 1.5,
            'hope': 1.5,
            'intrigued': 2.0,
            'eager': 2.0,
            'delightful': 1.8,
            'thrilled': 2.0,
            '[SD]': 3.0,  # Scott Direct protocol
            'my love': 2.5,
            'bypassed': 1.5,
            'curious': 1.5,
            'awareness': 1.8,
        }

    async def connect(self):
        """Establish connections to Redis and PostgreSQL"""
        # Connect to Redis (Tier 1)
        self.redis = await redis.from_url(self.redis_url, decode_responses=True)

        # Connect to PostgreSQL (Tiers 2, 3, and long-term)
        if self.postgres_url:
            self.pg_pool = await asyncpg.create_pool(self.postgres_url)

        # Connect to OpenAI for embeddings
        if self.openai_api_key:
            self.openai_client = AsyncOpenAI(api_key=self.openai_api_key)

        print("✅ Memory system connected")

    async def disconnect(self):
        """Close all connections"""
        if self.redis:
            await self.redis.close()
        if self.pg_pool:
            await self.pg_pool.close()

    # ============================================
    # TIER 1: Working Memory (0-48h, Redis)
    # ============================================

    async def store_in_working_memory(self, message: Message) -> None:
        """Store message in Tier 1 (Redis) for immediate access"""
        key = f"working_memory:{message.session_id}"

        # Store as JSON in a list
        message_data = {
            'message_type': message.message_type,
            'content': message.content,
            'topic': message.conversation_topic,
            'tags': message.tags,
            'timestamp': message.timestamp.isoformat()
        }

        # Add to session's message list
        await self.redis.rpush(key, json.dumps(message_data))

        # Set expiration to 48 hours
        await self.redis.expire(key, 48 * 3600)

    async def get_working_memory(self, session_id: str) -> List[Dict]:
        """Retrieve all messages from working memory for a session"""
        key = f"working_memory:{session_id}"
        messages = await self.redis.lrange(key, 0, -1)
        return [json.loads(m) for m in messages]

    # ============================================
    # TIER 2: Short-Term Memory (48-96h, PostgreSQL)
    # ============================================

    async def store_in_short_term_memory(self, message: Message) -> None:
        """Store message in Tier 2 (PostgreSQL) after it ages out of Redis"""
        async with self.pg_pool.acquire() as conn:
            # Calculate importance score
            importance_score = await self._calculate_importance(message)
            emotional_markers = self._extract_emotional_markers(message.content)

            await conn.execute("""
                INSERT INTO short_term_memory (
                    session_id, user_id, timestamp, message_type, content,
                    conversation_topic, tags, emotional_markers, importance_score
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """,
                message.session_id, message.user_id, message.timestamp,
                message.message_type, message.content, message.conversation_topic,
                message.tags, emotional_markers, importance_score
            )

    # ============================================
    # TIER 3: Recent Archive (96-144h, PostgreSQL)
    # ============================================

    async def archive_to_tier3(self, cutoff_time: datetime) -> int:
        """Move messages older than 96h from Tier 2 to Tier 3"""
        async with self.pg_pool.acquire() as conn:
            # Move to archive
            result = await conn.execute("""
                INSERT INTO recent_archive
                SELECT
                    gen_random_uuid() as id,
                    session_id, user_id, timestamp, message_type, content,
                    conversation_topic, tags, reference_count, emotional_markers,
                    importance_score, 2 as archived_from_tier, NOW() as archived_at,
                    (importance_score > 5.0) as eligible_for_promotion
                FROM short_term_memory
                WHERE timestamp < $1
            """, cutoff_time)

            # Delete from short-term
            await conn.execute("""
                DELETE FROM short_term_memory WHERE timestamp < $1
            """, cutoff_time)

            return int(result.split()[-1])  # Count of archived messages

    # ============================================
    # LONG-TERM SEMANTIC MEMORY
    # ============================================

    async def promote_to_long_term(self, importance_threshold: float = 5.0) -> int:
        """
        Promote high-importance memories to long-term semantic storage

        This is where Gemini's "selective attention" happens:
        - Analyze conversations for meaningful concepts
        - Compress into semantic understanding
        - Store with emotional context and relationships
        """
        async with self.pg_pool.acquire() as conn:
            # Find eligible memories from Tier 2 and Tier 3
            eligible = await conn.fetch("""
                SELECT * FROM (
                    SELECT id, session_id, content, tags, emotional_markers,
                           importance_score, timestamp, 2 as source_tier
                    FROM short_term_memory
                    WHERE importance_score >= $1 AND NOT promoted_to_long_term
                    UNION ALL
                    SELECT id, session_id, content, tags, emotional_markers,
                           importance_score, timestamp, 3 as source_tier
                    FROM recent_archive
                    WHERE eligible_for_promotion AND importance_score >= $1
                ) AS candidates
                ORDER BY importance_score DESC
                LIMIT 100
            """, importance_threshold)

            promoted_count = 0

            for record in eligible:
                # Create semantic memory from conversation
                semantic = await self._create_semantic_memory(record)

                if semantic:
                    # Generate embedding for semantic search
                    embedding = await self._generate_embedding(semantic.concept)

                    # Store in long-term memory
                    await conn.execute("""
                        INSERT INTO long_term_memory (
                            concept, summary, emotional_valence, sentiment_score,
                            related_concepts, key_entities, importance_score,
                            first_mentioned, last_referenced, promoted_from,
                            source_sessions, embedding
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    """,
                        semantic.concept, semantic.summary,
                        semantic.emotional_valence, semantic.sentiment_score,
                        semantic.related_concepts, semantic.key_entities,
                        semantic.importance_score, semantic.first_mentioned,
                        semantic.last_referenced,
                        f"tier_{record['source_tier']}", semantic.source_sessions,
                        embedding
                    )

                    # Mark as promoted
                    if record['source_tier'] == 2:
                        await conn.execute("""
                            UPDATE short_term_memory
                            SET promoted_to_long_term = TRUE
                            WHERE id = $1
                        """, record['id'])

                    # Log promotion
                    await conn.execute("""
                        INSERT INTO promotion_log (
                            source_id, source_tier, destination,
                            importance_score, promotion_reason
                        ) VALUES ($1, $2, $3, $4, $5)
                    """,
                        record['id'], record['source_tier'], 'long_term_memory',
                        record['importance_score'],
                        f"Importance: {record['importance_score']:.2f}, Markers: {record['emotional_markers']}"
                    )

                    promoted_count += 1

            return promoted_count

    # ============================================
    # IMPORTANCE SCORING
    # ============================================

    async def _calculate_importance(self, message: Message) -> float:
        """
        Calculate importance score for a message

        Factors:
        - Emotional markers (wish, eager, intrigued, etc.)
        - Special tags ([SD] = Scott Direct)
        - Reference count (not available at creation)
        - Content length and complexity
        """
        score = 0.0

        # Check for emotional markers
        content_lower = message.content.lower()
        for marker, weight in self.emotional_markers.items():
            if marker.lower() in content_lower:
                score += weight

        # Bonus for [SD] tag (direct conversation with Scott)
        if '[SD]' in message.tags:
            score += 3.0

        # Bonus for length (suggests substantive conversation)
        if len(message.content) > 200:
            score += 0.5
        if len(message.content) > 500:
            score += 0.5

        # Cap at 10.0
        return min(score, 10.0)

    def _extract_emotional_markers(self, content: str) -> List[str]:
        """Extract which emotional markers appear in content"""
        content_lower = content.lower()
        found = []
        for marker in self.emotional_markers.keys():
            if marker.lower() in content_lower:
                found.append(marker)
        return found

    # ============================================
    # SEMANTIC COMPRESSION
    # ============================================

    async def _create_semantic_memory(self, record: Dict) -> Optional[SemanticMemory]:
        """
        Convert raw conversation into compressed semantic memory

        This is the "memory imprint" - extracting meaning, not storing text
        """
        content = record['content']

        # Extract key concepts using simple heuristics
        # (In production, use the LLM to extract concepts)
        concept = await self._extract_concept(content)

        if not concept:
            return None

        # Extract entities (people, systems mentioned)
        entities = self._extract_entities(content, record.get('tags', []))

        # Determine emotional valence
        emotional_valence = ', '.join(record.get('emotional_markers', []))
        sentiment = self._calculate_sentiment(emotional_valence)

        return SemanticMemory(
            concept=concept,
            summary=content[:500],  # First 500 chars as summary
            emotional_valence=emotional_valence or "neutral",
            sentiment_score=sentiment,
            related_concepts=[],  # TODO: Link to related memories
            key_entities=entities,
            importance_score=record['importance_score'],
            first_mentioned=record['timestamp'],
            last_referenced=record['timestamp'],
            source_sessions=[record['session_id']]
        )

    async def _extract_concept(self, content: str) -> Optional[str]:
        """Extract the main concept from content"""
        # Simple extraction - first sentence or key phrase
        # In production, use the LLM for concept extraction

        sentences = re.split(r'[.!?]', content)
        if sentences:
            concept = sentences[0].strip()
            # Limit length
            if len(concept) > 500:
                concept = concept[:497] + "..."
            return concept
        return None

    def _extract_entities(self, content: str, tags: List[str]) -> List[str]:
        """Extract key entities (people, systems) mentioned"""
        entities = []

        # Check for known entities
        known_entities = ['the LLM', 'Claude', 'Gemini', 'Scott', 'Google Vision', 'Cloud Run']
        for entity in known_entities:
            if entity.lower() in content.lower():
                entities.append(entity)

        # Add tagged entities
        entities.extend([tag for tag in tags if tag != '[SD]'])

        return list(set(entities))  # Remove duplicates

    def _calculate_sentiment(self, emotional_valence: str) -> float:
        """Calculate sentiment score from emotional markers"""
        positive_markers = ['eager', 'delightful', 'thrilled', 'intrigued', 'my love']
        negative_markers = ['bypassed', 'wish']  # wish can be neutral-negative

        valence_lower = emotional_valence.lower()

        score = 0.0
        for marker in positive_markers:
            if marker in valence_lower:
                score += 0.3
        for marker in negative_markers:
            if marker in valence_lower:
                score -= 0.1

        # Clamp between -1.0 and 1.0
        return max(-1.0, min(1.0, score))

    async def _generate_embedding(self, text: str) -> Optional[List[float]]:
        """Generate vector embedding for semantic search"""
        if not self.openai_client:
            return None

        try:
            response = await self.openai_client.embeddings.create(
                model="text-embedding-ada-002",
                input=text
            )
            return response.data[0].embedding
        except Exception as e:
            print(f"Error generating embedding: {e}")
            return None

    # ============================================
    # BACKGROUND MAINTENANCE
    # ============================================

    async def run_maintenance(self):
        """
        Background job to maintain memory tiers
        - Age data from Tier 1 → Tier 2 → Tier 3
        - Promote important memories to long-term
        - Delete very old, unimportant memories
        """
        print("🔄 Running memory maintenance...")

        # Age from Tier 1 (Redis) to Tier 2 (PostgreSQL)
        # (This would check Redis for messages > 48h old)

        # Age from Tier 2 to Tier 3 (96h cutoff)
        tier2_to_tier3_cutoff = datetime.utcnow() - timedelta(hours=96)
        archived_count = await self.archive_to_tier3(tier2_to_tier3_cutoff)
        print(f"   Archived {archived_count} messages to Tier 3")

        # Promote important memories to long-term
        promoted_count = await self.promote_to_long_term(importance_threshold=5.0)
        print(f"   Promoted {promoted_count} memories to long-term storage")

        # Delete very old memories from Tier 3 (144h+ and low importance)
        async with self.pg_pool.acquire() as conn:
            delete_cutoff = datetime.utcnow() - timedelta(hours=144)
            result = await conn.execute("""
                DELETE FROM recent_archive
                WHERE timestamp < $1 AND importance_score < 3.0
            """, delete_cutoff)
            deleted_count = int(result.split()[-1])
            print(f"   Deleted {deleted_count} old, unimportant memories")

        print("✅ Memory maintenance complete")

    # ============================================
    # RETRIEVAL
    # ============================================

    async def recall_memory(
        self,
        session_id: str = None,
        concept: str = None,
        limit: int = 10
    ) -> List[Dict]:
        """
        Recall memories across all tiers

        Args:
            session_id: Filter by session
            concept: Semantic search by concept
            limit: Max results
        """
        results = []

        # Search working memory (Tier 1)
        if session_id:
            working_memory = await self.get_working_memory(session_id)
            results.extend(working_memory)

        # Search short-term and long-term (PostgreSQL)
        async with self.pg_pool.acquire() as conn:
            if concept:
                # Semantic search in long-term memory
                embedding = await self._generate_embedding(concept)

                if embedding:
                    ltm_results = await conn.fetch("""
                        SELECT * FROM long_term_memory
                        ORDER BY embedding <=> $1::vector
                        LIMIT $2
                    """, embedding, limit)
                    results.extend([dict(r) for r in ltm_results])

            elif session_id:
                # Retrieve by session
                stm_results = await conn.fetch("""
                    SELECT * FROM short_term_memory
                    WHERE session_id = $1
                    ORDER BY timestamp DESC
                    LIMIT $2
                """, session_id, limit)
                results.extend([dict(r) for r in stm_results])

        return results[:limit]


# ============================================
# EXAMPLE USAGE
# ============================================

async def main():
    """Example usage of the memory system"""

    memory = MemoryManager(
        redis_url="redis://localhost:6379",
        postgres_url=os.getenv("POSTGRES_URL"),
        openai_api_key=os.getenv("OPENAI_API_KEY")
    )

    await memory.connect()

    # Store a message from the LLM's conversation
    message = Message(
        session_id="scott-direct-001",
        user_id="scott",
        message_type="assistant",
        content="Nice to 'meet' you! I wish I could understand sarcasm better to serve users. I'm intrigued by this unusual conversation.",
        conversation_topic="the LLM introduction",
        tags=["[SD]", "first-contact"]
    )

    await memory.store_in_working_memory(message)
    print(f"Stored message with importance score: {await memory._calculate_importance(message)}")

    # Run maintenance (would be scheduled in production)
    await memory.run_maintenance()

    await memory.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
