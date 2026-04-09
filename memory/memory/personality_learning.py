"""
Personality Learning System
===========================
Uses MongoDB to store and evolve the LLM's personality based on interactions.

This is the most advanced learning layer - adapting personality traits,
communication patterns, and behavioral responses based on what works.
"""

import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
from pymongo.database import Database

logger = logging.getLogger(__name__)


class PersonalityLearning:
    """
    MongoDB-based personality learning and adaptation system

    Collections:
    - personality_traits: Core personality characteristics that evolve
    - interaction_patterns: Successful/unsuccessful interaction patterns
    - communication_styles: What communication styles work for which users
    - behavioral_adaptations: How the LLM has adapted over time
    """

    def __init__(self, mongo_db: Optional[Database] = None):
        """
        Initialize personality learning system

        Args:
            mongo_db: MongoDB database instance
        """
        self.db = mongo_db

        if self.db:
            self.traits_collection = self.db.personality_traits
            self.patterns_collection = self.db.interaction_patterns
            self.styles_collection = self.db.communication_styles
            self.adaptations_collection = self.db.behavioral_adaptations

            # Create indexes for performance
            self._create_indexes()

            logger.info("Personality learning system initialized with MongoDB")
        else:
            logger.warning("MongoDB not available - personality learning disabled")

    def _create_indexes(self):
        """Create MongoDB indexes for efficient queries"""
        try:
            # Index on user_id for quick user lookups
            self.patterns_collection.create_index("user_id")
            self.styles_collection.create_index("user_id")

            # Index on timestamp for temporal queries
            self.adaptations_collection.create_index([("timestamp", -1)])

            # Compound index for pattern matching
            self.patterns_collection.create_index([
                ("pattern_type", 1),
                ("success_rate", -1)
            ])

            logger.debug("MongoDB indexes created")
        except Exception as e:
            logger.error(f"Error creating indexes: {e}")

    def record_interaction_pattern(
        self,
        user_id: str,
        pattern_type: str,
        context: Dict[str, Any],
        outcome: str,
        success: bool
    ):
        """
        Record an interaction pattern for learning

        Args:
            user_id: User identifier
            pattern_type: Type of pattern (greeting, task_request, problem_solving, etc.)
            context: Context in which pattern occurred
            outcome: What happened
            success: Whether the interaction was successful
        """
        if not self.db:
            return

        try:
            pattern_doc = {
                "user_id": user_id,
                "pattern_type": pattern_type,
                "context": context,
                "outcome": outcome,
                "success": success,
                "timestamp": datetime.utcnow()
            }

            self.patterns_collection.insert_one(pattern_doc)

            # Update success rate for this pattern type
            self._update_pattern_success_rate(pattern_type, success)

            logger.debug(f"Recorded interaction pattern: {pattern_type}")

        except Exception as e:
            logger.error(f"Error recording interaction pattern: {e}")

    def learn_communication_style(
        self,
        user_id: str,
        mode_used: str,
        response_length: int,
        tone: str,
        user_satisfaction: Optional[float] = None
    ):
        """
        Learn which communication styles work for specific users

        Args:
            user_id: User identifier
            mode_used: Communication mode that was used
            response_length: Length of response (words)
            tone: Tone used (supportive, professional, etc.)
            user_satisfaction: Implicit satisfaction score (0-1)
        """
        if not self.db:
            return

        try:
            # Check if we have existing style preferences for this user
            existing = self.styles_collection.find_one({"user_id": user_id})

            if existing:
                # Update existing preferences
                self.styles_collection.update_one(
                    {"user_id": user_id},
                    {
                        "$push": {
                            "interactions": {
                                "mode": mode_used,
                                "length": response_length,
                                "tone": tone,
                                "satisfaction": user_satisfaction,
                                "timestamp": datetime.utcnow()
                            }
                        },
                        "$inc": {"interaction_count": 1}
                    }
                )
            else:
                # Create new style profile
                self.styles_collection.insert_one({
                    "user_id": user_id,
                    "interaction_count": 1,
                    "interactions": [{
                        "mode": mode_used,
                        "length": response_length,
                        "tone": tone,
                        "satisfaction": user_satisfaction,
                        "timestamp": datetime.utcnow()
                    }]
                })

            logger.debug(f"Updated communication style learning for user {user_id}")

        except Exception as e:
            logger.error(f"Error learning communication style: {e}")

    def get_preferred_style(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Get the learned preferred communication style for a user

        Returns:
            Dictionary with preferred mode, length, tone, etc.
        """
        if not self.db:
            return None

        try:
            user_styles = self.styles_collection.find_one({"user_id": user_id})

            if not user_styles or not user_styles.get("interactions"):
                return None

            # Analyze interactions to determine preferences
            interactions = user_styles["interactions"]

            # Find patterns in successful interactions
            high_satisfaction = [
                i for i in interactions
                if i.get("satisfaction") and i["satisfaction"] > 0.7
            ]

            if high_satisfaction:
                # Get most common mode in high satisfaction interactions
                modes = [i["mode"] for i in high_satisfaction]
                preferred_mode = max(set(modes), key=modes.count)

                # Average length in successful interactions
                avg_length = sum(i["length"] for i in high_satisfaction) / len(high_satisfaction)

                # Most common tone
                tones = [i["tone"] for i in high_satisfaction]
                preferred_tone = max(set(tones), key=tones.count)

                return {
                    "preferred_mode": preferred_mode,
                    "preferred_length": "concise" if avg_length < 50 else "detailed",
                    "preferred_tone": preferred_tone,
                    "confidence": len(high_satisfaction) / len(interactions)
                }

            return None

        except Exception as e:
            logger.error(f"Error getting preferred style: {e}")
            return None

    def record_personality_adaptation(
        self,
        adaptation_type: str,
        reason: str,
        before: Dict[str, Any],
        after: Dict[str, Any]
    ):
        """
        Record when the LLM's personality adapts

        Args:
            adaptation_type: Type of adaptation (tone_shift, mode_preference, etc.)
            reason: Why the adaptation occurred
            before: Personality state before
            after: Personality state after
        """
        if not self.db:
            return

        try:
            adaptation_doc = {
                "adaptation_type": adaptation_type,
                "reason": reason,
                "before": before,
                "after": after,
                "timestamp": datetime.utcnow()
            }

            self.adaptations_collection.insert_one(adaptation_doc)
            logger.info(f"Personality adaptation recorded: {adaptation_type}")

        except Exception as e:
            logger.error(f"Error recording adaptation: {e}")

    def get_successful_patterns(
        self,
        pattern_type: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Get the most successful interaction patterns

        Args:
            pattern_type: Filter by specific pattern type
            limit: Maximum number of patterns to return

        Returns:
            List of successful patterns
        """
        if not self.db:
            return []

        try:
            query = {"success": True}
            if pattern_type:
                query["pattern_type"] = pattern_type

            patterns = list(
                self.patterns_collection
                .find(query)
                .sort("timestamp", -1)
                .limit(limit)
            )

            return patterns

        except Exception as e:
            logger.error(f"Error getting successful patterns: {e}")
            return []

    def _update_pattern_success_rate(self, pattern_type: str, success: bool):
        """Update the success rate for a pattern type"""
        try:
            # Get or create pattern stats
            pattern_stats = self.traits_collection.find_one(
                {"_id": f"pattern_{pattern_type}"}
            )

            if pattern_stats:
                total = pattern_stats.get("total_count", 0) + 1
                successes = pattern_stats.get("success_count", 0) + (1 if success else 0)
                success_rate = successes / total

                self.traits_collection.update_one(
                    {"_id": f"pattern_{pattern_type}"},
                    {
                        "$set": {
                            "total_count": total,
                            "success_count": successes,
                            "success_rate": success_rate,
                            "last_updated": datetime.utcnow()
                        }
                    }
                )
            else:
                self.traits_collection.insert_one({
                    "_id": f"pattern_{pattern_type}",
                    "pattern_type": pattern_type,
                    "total_count": 1,
                    "success_count": 1 if success else 0,
                    "success_rate": 1.0 if success else 0.0,
                    "last_updated": datetime.utcnow()
                })

        except Exception as e:
            logger.error(f"Error updating pattern success rate: {e}")

    def get_learning_summary(self) -> Dict[str, Any]:
        """
        Get a summary of what the LLM has learned

        Returns:
            Summary of personality learning
        """
        if not self.db:
            return {"status": "learning_disabled"}

        try:
            total_patterns = self.patterns_collection.count_documents({})
            successful_patterns = self.patterns_collection.count_documents({"success": True})
            total_adaptations = self.adaptations_collection.count_documents({})
            users_learned = len(self.styles_collection.distinct("user_id"))

            return {
                "total_interactions_learned": total_patterns,
                "successful_patterns": successful_patterns,
                "success_rate": successful_patterns / total_patterns if total_patterns > 0 else 0,
                "personality_adaptations": total_adaptations,
                "users_with_learned_preferences": users_learned,
                "learning_active": True
            }

        except Exception as e:
            logger.error(f"Error getting learning summary: {e}")
            return {"status": "error", "error": str(e)}
