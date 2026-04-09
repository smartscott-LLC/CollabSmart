#!/usr/bin/env python3
"""
Specialized Agent Factory - Utility Functions

This module provides high-level utilities for working with the Agent Factory:
- Agent creation and synthesis from O*NET data
- Delegation decision-making
- Performance tracking and analytics
- Wisdom filter integration

Author: Claude (Principal Architect)
Date: 2025-10-18
"""

import json
import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
import psycopg2
from psycopg2.extras import RealDictCursor, Json
import uuid

logger = logging.getLogger(__name__)


# ==================================================
# DATA MODELS
# ==================================================

@dataclass
class AgentCapabilities:
    """Structured representation of agent capabilities."""
    knowledge_domains: List[Dict[str, Any]]
    skills: List[Dict[str, Any]]
    abilities: List[Dict[str, Any]]
    work_activities: List[Dict[str, Any]]

    def to_json(self) -> Dict:
        """Convert to JSON-serializable dict."""
        return asdict(self)


@dataclass
class DelegationRules:
    """Structured representation of delegation rules."""
    trigger_keywords: List[str]
    domain_indicators: List[str]
    complexity_threshold: float
    confidence_threshold: float
    exclusion_patterns: List[str]

    def to_json(self) -> Dict:
        """Convert to JSON-serializable dict."""
        return asdict(self)


@dataclass
class SpecializedAgent:
    """Represents a specialized agent."""
    agent_code: str
    agent_name: str
    source_occupation_codes: List[str]
    description: str
    specialization_domain: str
    capabilities: AgentCapabilities
    system_prompt_template: str
    delegation_rules: DelegationRules
    id: Optional[uuid.UUID] = None
    is_active: bool = True
    created_by: str = 'system'


@dataclass
class AgentInvocation:
    """Represents an agent invocation."""
    agent_id: uuid.UUID
    user_query: str
    invoked_by: str
    delegation_confidence: float
    session_id: Optional[str] = None
    query_context: Optional[Dict] = None
    delegation_reason: Optional[str] = None
    alternative_agents_considered: Optional[List[uuid.UUID]] = None


@dataclass
class WisdomFilterResult:
    """Represents wisdom filter processing result."""
    filter_applied: bool
    verdict: str  # 'approved', 'adjusted', 'rejected'
    adjustments: Optional[Dict] = None


# ==================================================
# AGENT FACTORY MANAGER
# ==================================================

class AgentFactoryManager:
    """High-level manager for Agent Factory operations."""

    def __init__(self, database_url: str):
        self.database_url = database_url
        self.conn = None

    def connect(self):
        """Establish database connection."""
        self.conn = psycopg2.connect(
            self.database_url,
            cursor_factory=RealDictCursor
        )

    def disconnect(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()

    # ==================================================
    # AGENT CREATION & SYNTHESIS
    # ==================================================

    def synthesize_agent_from_onet(
        self,
        agent_code: str,
        agent_name: str,
        onet_codes: List[str],
        description: str,
        specialization_domain: str,
        prompt_template: str,
        delegation_rules: DelegationRules,
        created_by: str = 'system'
    ) -> uuid.UUID:
        """
        Synthesize a specialized agent from O*NET occupation data.

        This function:
        1. Fetches knowledge, skills, abilities, and work activities from O*NET tables
        2. Computes aggregated importance scores
        3. Creates AgentCapabilities structure
        4. Inserts agent into specialized_agents table

        Args:
            agent_code: Unique code for agent (e.g., 'data_scientist')
            agent_name: Human-readable name
            onet_codes: List of O*NET SOC codes to synthesize from
            description: Agent description
            specialization_domain: Domain (e.g., 'data_science')
            prompt_template: System prompt template
            delegation_rules: When to invoke this agent
            created_by: Who created this agent

        Returns:
            UUID of created agent
        """
        cursor = self.conn.cursor()

        try:
            # Step 1: Fetch O*NET knowledge domains
            knowledge_domains = self._fetch_onet_knowledge(cursor, onet_codes)

            # Step 2: Fetch O*NET skills
            skills = self._fetch_onet_skills(cursor, onet_codes)

            # Step 3: Fetch O*NET abilities
            abilities = self._fetch_onet_abilities(cursor, onet_codes)

            # Step 4: Fetch O*NET work activities
            work_activities = self._fetch_onet_work_activities(cursor, onet_codes)

            # Step 5: Create capabilities structure
            capabilities = AgentCapabilities(
                knowledge_domains=knowledge_domains,
                skills=skills,
                abilities=abilities,
                work_activities=work_activities
            )

            # Step 6: Insert agent
            cursor.execute("""
                INSERT INTO specialized_agents (
                    agent_code, agent_name, source_occupation_codes,
                    description, specialization_domain,
                    capabilities, system_prompt_template, delegation_rules,
                    created_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                agent_code,
                agent_name,
                onet_codes,
                description,
                specialization_domain,
                Json(capabilities.to_json()),
                prompt_template,
                Json(delegation_rules.to_json()),
                created_by
            ))

            agent_id = cursor.fetchone()['id']
            self.conn.commit()

            logger.info(f"✓ Created agent '{agent_code}' (ID: {agent_id})")
            return agent_id

        except Exception as e:
            self.conn.rollback()
            logger.error(f"✗ Failed to synthesize agent '{agent_code}': {e}")
            raise

        finally:
            cursor.close()

    def _fetch_onet_knowledge(
        self,
        cursor,
        onet_codes: List[str],
        top_n: int = 10
    ) -> List[Dict]:
        """Fetch top N knowledge domains from O*NET."""
        cursor.execute("""
            SELECT
                element_name as domain,
                AVG(data_value) as importance,
                ARRAY_AGG(DISTINCT onetsoc_code) as source_codes
            FROM onet_knowledge
            WHERE onetsoc_code = ANY(%s)
            GROUP BY element_name
            ORDER BY importance DESC
            LIMIT %s
        """, (onet_codes, top_n))

        return [
            {
                'domain': row['domain'],
                'importance': float(row['importance']),
                'source_codes': row['source_codes']
            }
            for row in cursor.fetchall()
        ]

    def _fetch_onet_skills(
        self,
        cursor,
        onet_codes: List[str],
        top_n: int = 10
    ) -> List[Dict]:
        """Fetch top N skills from O*NET."""
        cursor.execute("""
            SELECT
                element_name as skill,
                AVG(data_value) as level,
                ARRAY_AGG(DISTINCT onetsoc_code) as source_codes
            FROM onet_skills
            WHERE onetsoc_code = ANY(%s)
            GROUP BY element_name
            ORDER BY level DESC
            LIMIT %s
        """, (onet_codes, top_n))

        return [
            {
                'skill': row['skill'],
                'level': float(row['level']),
                'source_codes': row['source_codes']
            }
            for row in cursor.fetchall()
        ]

    def _fetch_onet_abilities(
        self,
        cursor,
        onet_codes: List[str],
        top_n: int = 10
    ) -> List[Dict]:
        """Fetch top N abilities from O*NET."""
        cursor.execute("""
            SELECT
                element_name as ability,
                AVG(data_value) as level,
                ARRAY_AGG(DISTINCT onetsoc_code) as source_codes
            FROM onet_abilities
            WHERE onetsoc_code = ANY(%s)
            GROUP BY element_name
            ORDER BY level DESC
            LIMIT %s
        """, (onet_codes, top_n))

        return [
            {
                'ability': row['ability'],
                'level': float(row['level']),
                'source_codes': row['source_codes']
            }
            for row in cursor.fetchall()
        ]

    def _fetch_onet_work_activities(
        self,
        cursor,
        onet_codes: List[str],
        top_n: int = 10
    ) -> List[Dict]:
        """Fetch top N work activities from O*NET."""
        cursor.execute("""
            SELECT
                element_name as activity,
                AVG(data_value) as relevance,
                ARRAY_AGG(DISTINCT onetsoc_code) as source_codes
            FROM onet_work_activities
            WHERE onetsoc_code = ANY(%s)
            GROUP BY element_name
            ORDER BY relevance DESC
            LIMIT %s
        """, (onet_codes, top_n))

        return [
            {
                'activity': row['activity'],
                'relevance': float(row['relevance']),
                'source_codes': row['source_codes']
            }
            for row in cursor.fetchall()
        ]

    # ==================================================
    # DELEGATION & INVOCATION
    # ==================================================

    def find_best_agent(
        self,
        query: str,
        min_confidence: float = 0.7,
        top_k: int = 5
    ) -> List[Dict]:
        """
        Find best agent(s) for a given query.

        This is a simplified implementation using keyword matching.
        Production implementation should use:
        - Vector embeddings for semantic similarity
        - Historical performance data
        - User preferences

        Args:
            query: User query text
            min_confidence: Minimum confidence threshold
            top_k: Return top K candidates

        Returns:
            List of agent matches with scores
        """
        cursor = self.conn.cursor()

        try:
            # Simple keyword matching (REPLACE WITH SEMANTIC SEARCH IN PRODUCTION)
            cursor.execute("""
                SELECT
                    id,
                    agent_code,
                    agent_name,
                    specialization_domain,
                    delegation_rules,
                    avg_confidence_score,
                    avg_user_rating,
                    total_invocations
                FROM specialized_agents
                WHERE is_active = TRUE
                ORDER BY total_invocations DESC
                LIMIT %s
            """, (top_k,))

            agents = cursor.fetchall()

            # Score each agent based on keyword matching
            scored_agents = []
            query_lower = query.lower()

            for agent in agents:
                rules = agent['delegation_rules']
                score = self._calculate_match_score(query_lower, rules)

                if score >= min_confidence:
                    scored_agents.append({
                        'agent_id': agent['id'],
                        'agent_code': agent['agent_code'],
                        'agent_name': agent['agent_name'],
                        'match_score': score,
                        'avg_confidence': agent['avg_confidence_score'],
                        'avg_rating': agent['avg_user_rating'],
                        'total_invocations': agent['total_invocations']
                    })

            # Sort by match score
            scored_agents.sort(key=lambda x: x['match_score'], reverse=True)

            return scored_agents[:top_k]

        finally:
            cursor.close()

    def _calculate_match_score(self, query: str, delegation_rules: Dict) -> float:
        """
        Calculate match score between query and delegation rules.

        This is a SIMPLIFIED implementation for initial deployment.
        Production should use vector embeddings + learned weights.
        """
        score = 0.0

        # Check trigger keywords
        trigger_keywords = delegation_rules.get('trigger_keywords', [])
        for keyword in trigger_keywords:
            if keyword.lower() in query:
                score += 0.3

        # Check domain indicators
        domain_indicators = delegation_rules.get('domain_indicators', [])
        for indicator in domain_indicators:
            if indicator.lower() in query:
                score += 0.2

        # Check exclusion patterns
        exclusion_patterns = delegation_rules.get('exclusion_patterns', [])
        for pattern in exclusion_patterns:
            if pattern.lower() in query:
                score -= 0.5

        # Cap score at 1.0
        return min(1.0, max(0.0, score))

    def record_invocation(
        self,
        invocation: AgentInvocation,
        response: str,
        response_confidence: float,
        processing_time_ms: int,
        wisdom_filter: Optional[WisdomFilterResult] = None,
        was_successful: bool = True
    ) -> uuid.UUID:
        """
        Record an agent invocation for tracking and learning.

        Args:
            invocation: Invocation details
            response: Agent's response
            response_confidence: Agent's confidence in response
            processing_time_ms: Processing time in milliseconds
            wisdom_filter: Wisdom filter results (if applied)
            was_successful: Was invocation successful?

        Returns:
            UUID of invocation record
        """
        cursor = self.conn.cursor()

        try:
            cursor.execute("""
                INSERT INTO agent_invocations (
                    agent_id, invoked_at, invoked_by, session_id,
                    user_query, query_context,
                    delegation_confidence, delegation_reason,
                    alternative_agents_considered,
                    agent_response, response_confidence, processing_time_ms,
                    wisdom_filter_applied, wisdom_filter_verdict, wisdom_adjustments,
                    was_successful
                ) VALUES (
                    %s, NOW(), %s, %s,
                    %s, %s,
                    %s, %s,
                    %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s
                ) RETURNING id
            """, (
                invocation.agent_id,
                invocation.invoked_by,
                invocation.session_id,
                invocation.user_query,
                Json(invocation.query_context) if invocation.query_context else None,
                invocation.delegation_confidence,
                invocation.delegation_reason,
                invocation.alternative_agents_considered,
                response,
                response_confidence,
                processing_time_ms,
                wisdom_filter.filter_applied if wisdom_filter else False,
                wisdom_filter.verdict if wisdom_filter else None,
                Json(wisdom_filter.adjustments) if wisdom_filter and wisdom_filter.adjustments else None,
                was_successful
            ))

            invocation_id = cursor.fetchone()['id']
            self.conn.commit()

            logger.info(f"✓ Recorded invocation {invocation_id}")
            return invocation_id

        except Exception as e:
            self.conn.rollback()
            logger.error(f"✗ Failed to record invocation: {e}")
            raise

        finally:
            cursor.close()

    def record_user_feedback(
        self,
        invocation_id: uuid.UUID,
        rating: int,
        feedback: Optional[str] = None
    ):
        """
        Record user feedback for an invocation.

        Args:
            invocation_id: UUID of invocation
            rating: User rating (1-5)
            feedback: Optional text feedback
        """
        cursor = self.conn.cursor()

        try:
            cursor.execute("""
                UPDATE agent_invocations
                SET
                    user_rating = %s,
                    user_feedback = %s,
                    feedback_received_at = NOW()
                WHERE id = %s
            """, (rating, feedback, invocation_id))

            self.conn.commit()
            logger.info(f"✓ Recorded user feedback for invocation {invocation_id}")

        except Exception as e:
            self.conn.rollback()
            logger.error(f"✗ Failed to record feedback: {e}")
            raise

        finally:
            cursor.close()

    # ==================================================
    # ANALYTICS & PERFORMANCE
    # ==================================================

    def get_agent_performance(
        self,
        agent_id: uuid.UUID,
        days_back: int = 30
    ) -> Dict[str, Any]:
        """
        Get performance summary for an agent.

        Args:
            agent_id: UUID of agent
            days_back: Number of days to analyze

        Returns:
            Performance metrics dictionary
        """
        cursor = self.conn.cursor()

        try:
            cursor.execute("""
                SELECT * FROM get_agent_performance_summary(%s, %s)
            """, (agent_id, days_back))

            result = cursor.fetchone()

            return {
                'total_invocations': result['total_invocations'],
                'success_rate': result['success_rate'],
                'avg_user_rating': result['avg_user_rating'],
                'avg_confidence': result['avg_confidence'],
                'p95_processing_time': result['p95_processing_time']
            }

        finally:
            cursor.close()

    def get_top_agents(
        self,
        metric: str = 'total_invocations',
        limit: int = 10
    ) -> List[Dict]:
        """
        Get top performing agents.

        Args:
            metric: Metric to sort by ('total_invocations', 'avg_user_rating', etc.)
            limit: Number of agents to return

        Returns:
            List of agent performance dictionaries
        """
        cursor = self.conn.cursor()

        valid_metrics = {
            'total_invocations': 'total_invocations',
            'avg_rating': 'avg_user_rating',
            'avg_confidence': 'avg_confidence_score',
            'success_rate': 'avg_confidence_score'  # Proxy for now
        }

        sort_column = valid_metrics.get(metric, 'total_invocations')

        try:
            cursor.execute(f"""
                SELECT
                    agent_code,
                    agent_name,
                    specialization_domain,
                    total_invocations,
                    successful_invocations,
                    avg_confidence_score,
                    avg_user_rating,
                    last_invoked_at
                FROM specialized_agents
                WHERE is_active = TRUE
                ORDER BY {sort_column} DESC NULLS LAST
                LIMIT %s
            """, (limit,))

            return [dict(row) for row in cursor.fetchall()]

        finally:
            cursor.close()

    def get_delegation_analytics(self) -> List[Dict]:
        """
        Get delegation analytics from materialized view.

        Returns:
            List of delegation analytics per agent
        """
        cursor = self.conn.cursor()

        try:
            cursor.execute("""
                SELECT * FROM agent_delegation_analytics
                ORDER BY total_delegations DESC
            """)

            return [dict(row) for row in cursor.fetchall()]

        finally:
            cursor.close()

    def refresh_delegation_analytics(self):
        """Refresh the delegation analytics materialized view."""
        cursor = self.conn.cursor()

        try:
            cursor.execute("SELECT refresh_delegation_analytics()")
            self.conn.commit()
            logger.info("✓ Refreshed delegation analytics")

        except Exception as e:
            self.conn.rollback()
            logger.error(f"✗ Failed to refresh analytics: {e}")
            raise

        finally:
            cursor.close()

    # ==================================================
    # AGENT EVOLUTION
    # ==================================================

    def update_agent_prompt(
        self,
        agent_id: uuid.UUID,
        new_prompt: str,
        reason: str,
        changed_by: str
    ):
        """
        Update an agent's system prompt and log the change.

        Args:
            agent_id: UUID of agent
            new_prompt: New system prompt template
            reason: Reason for change
            changed_by: Who made the change
        """
        cursor = self.conn.cursor()

        try:
            # Get current prompt
            cursor.execute("""
                SELECT system_prompt_template, prompt_version
                FROM specialized_agents
                WHERE id = %s
            """, (agent_id,))

            result = cursor.fetchone()
            old_prompt = result['system_prompt_template']
            old_version = result['prompt_version']

            # Update prompt
            cursor.execute("""
                UPDATE specialized_agents
                SET
                    system_prompt_template = %s,
                    prompt_version = %s,
                    last_updated_at = NOW()
                WHERE id = %s
            """, (new_prompt, old_version + 1, agent_id))

            # Log evolution
            cursor.execute("""
                INSERT INTO agent_evolution_history (
                    agent_id, change_type, change_description,
                    previous_value, new_value, change_reason, changed_by
                ) VALUES (
                    %s, 'prompt_update', %s,
                    %s, %s, %s, %s
                )
            """, (
                agent_id,
                f"Updated prompt from v{old_version} to v{old_version + 1}",
                Json({'prompt': old_prompt, 'version': old_version}),
                Json({'prompt': new_prompt, 'version': old_version + 1}),
                reason,
                changed_by
            ))

            self.conn.commit()
            logger.info(f"✓ Updated prompt for agent {agent_id} to v{old_version + 1}")

        except Exception as e:
            self.conn.rollback()
            logger.error(f"✗ Failed to update prompt: {e}")
            raise

        finally:
            cursor.close()


# ==================================================
# HELPER FUNCTIONS
# ==================================================

def create_sample_data_scientist_agent(manager: AgentFactoryManager) -> uuid.UUID:
    """
    Create a sample Data Scientist agent for testing/demo.

    This demonstrates the full agent synthesis workflow.
    """
    delegation_rules = DelegationRules(
        trigger_keywords=[
            "data analysis", "machine learning", "statistical",
            "predictive model", "dataset", "data science"
        ],
        domain_indicators=[
            "statistics", "ML", "AI", "analytics", "data science",
            "regression", "classification"
        ],
        complexity_threshold=0.6,
        confidence_threshold=0.75,
        exclusion_patterns=["simple query", "basic arithmetic"]
    )

    prompt_template = """You are a Data Science Expert with deep expertise in statistical analysis,
machine learning, and data-driven decision making. Your responses should demonstrate:

1. Rigorous analytical thinking
2. Practical implementation guidance
3. Awareness of statistical pitfalls and biases
4. Best practices for data quality and validation
5. Humility about model limitations and uncertainty

Always provide clear explanations, cite relevant statistical concepts, and suggest validation strategies."""

    agent_id = manager.synthesize_agent_from_onet(
        agent_code='data_scientist',
        agent_name='Data Science Expert',
        onet_codes=['15-2051.00'],  # Data Scientists
        description='Expert in statistical analysis, machine learning, and data-driven decision making.',
        specialization_domain='data_science',
        prompt_template=prompt_template,
        delegation_rules=delegation_rules,
        created_by='claude'
    )

    return agent_id


# ==================================================
# EXAMPLE USAGE
# ==================================================

if __name__ == '__main__':
    # Example usage
    import os

    DATABASE_URL = os.environ.get('DATABASE_URL')

    if not DATABASE_URL:
        print("Error: DATABASE_URL environment variable not set")
        exit(1)

    # Use context manager for automatic connection handling
    with AgentFactoryManager(DATABASE_URL) as manager:
        # Example 1: Create sample agent
        print("\n=== Creating Sample Data Scientist Agent ===")
        agent_id = create_sample_data_scientist_agent(manager)
        print(f"✓ Created agent ID: {agent_id}")

        # Example 2: Find best agent for query
        print("\n=== Finding Best Agent for Query ===")
        query = "How do I build a predictive model for customer churn?"
        matches = manager.find_best_agent(query, min_confidence=0.5)

        for match in matches:
            print(f"Agent: {match['agent_name']} (score: {match['match_score']:.2f})")

        # Example 3: Get top agents
        print("\n=== Top Agents by Invocation Count ===")
        top_agents = manager.get_top_agents(metric='total_invocations', limit=5)

        for agent in top_agents:
            print(f"{agent['agent_name']}: {agent['total_invocations']} invocations")
