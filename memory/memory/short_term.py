"""
Short-Term Memory
=================
Manages the LLM's short-term conversation memory using Redis.

This is like the LLM's "working memory" - recent conversations, active tasks,
current context. Kept in fast cache for immediate retrieval.
"""

import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class ShortTermMemory:
    """
    Short-term memory using Redis for fast access to recent interactions

    Stores:
    - Current conversation context
    - Recent messages (last 24-48 hours)
    - Active tasks and priorities
    - Session-specific data
    """

    def __init__(self, redis_client=None):
        """
        Initialize short-term memory

        Args:
            redis_client: Redis client instance (will be injected)
        """
        self.redis = redis_client
        self.ttl_hours = 48  # Keep short-term memories for 48 hours
        logger.info("Short-term memory initialized")

    def store(
        self,
        user_id: str,
        session_id: Optional[str],
        interaction: Dict[str, Any]
    ):
        """
        Store an interaction in short-term memory

        Args:
            user_id: User's identifier
            session_id: Session identifier
            interaction: Interaction data to store
        """
        try:
            if not self.redis:
                logger.warning("Redis not available, using in-memory fallback")
                return

            # Create key
            key = self._make_key(user_id, session_id)

            # Get existing interactions
            existing = self._get_interactions(key)

            # Add new interaction
            interaction['stored_at'] = datetime.utcnow().isoformat()
            existing.append(interaction)

            # Keep only recent interactions (last 50)
            if len(existing) > 50:
                existing = existing[-50:]

            # Store back to Redis
            self.redis.setex(
                key,
                timedelta(hours=self.ttl_hours),
                json.dumps(existing)
            )

            logger.debug(f"Stored interaction for user {user_id}")

        except Exception as e:
            logger.error(f"Error storing short-term memory: {str(e)}")

    def retrieve(
        self,
        user_id: str,
        session_id: Optional[str] = None,
        limit: int = 10
    ) -> Dict[str, Any]:
        """
        Retrieve recent interactions from short-term memory

        Args:
            user_id: User's identifier
            session_id: Session identifier
            limit: Maximum number of interactions to retrieve

        Returns:
            Dictionary with recent interactions
        """
        try:
            if not self.redis:
                return {'interactions': []}

            key = self._make_key(user_id, session_id)
            interactions = self._get_interactions(key)

            # Return most recent interactions
            recent = interactions[-limit:] if interactions else []

            return {
                'interactions': recent,
                'total_count': len(interactions),
                'retrieved_count': len(recent)
            }

        except Exception as e:
            logger.error(f"Error retrieving short-term memory: {str(e)}")
            return {'interactions': []}

    def get_conversation_context(
        self,
        user_id: str,
        session_id: Optional[str] = None
    ) -> str:
        """
        Get a summary of recent conversation for context

        Returns:
            String summary of recent conversation
        """
        memory = self.retrieve(user_id, session_id, limit=5)
        interactions = memory.get('interactions', [])

        if not interactions:
            return "No recent conversation history"

        # Build context string
        context_parts = []
        for interaction in interactions:
            msg = interaction.get('message', '')
            resp = interaction.get('response', '')
            context_parts.append(f"User: {msg}\nthe LLM: {resp}")

        return "\n\n".join(context_parts)

    def clear_session(self, user_id: str, session_id: str):
        """Clear a specific session's memory"""
        try:
            if not self.redis:
                return

            key = self._make_key(user_id, session_id)
            self.redis.delete(key)
            logger.info(f"Cleared session memory for {user_id}/{session_id}")

        except Exception as e:
            logger.error(f"Error clearing session: {str(e)}")

    def _make_key(self, user_id: str, session_id: Optional[str]) -> str:
        """Create Redis key"""
        if session_id:
            return f"the LLM:memory:short:{user_id}:{session_id}"
        return f"the LLM:memory:short:{user_id}"

    def _get_interactions(self, key: str) -> List[Dict[str, Any]]:
        """Get interactions from Redis"""
        try:
            data = self.redis.get(key)
            if data:
                return json.loads(data)
            return []
        except Exception as e:
            logger.error(f"Error getting interactions: {str(e)}")
            return []
