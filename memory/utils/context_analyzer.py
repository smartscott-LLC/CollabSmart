"""
Context Analyzer
================
Analyzes conversation context to understand the situation, urgency, and user needs.

This is the LLM's "situational awareness" - understanding not just WHAT the user
said, but WHY they're saying it and WHAT they need.
"""

from typing import Dict, Any, Optional
import re
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class ContextAnalyzer:
    """
    Analyzes context to help the LLM understand:
    - What type of scenario is this?
    - How urgent is it?
    - What does the user really need?
    - What's the emotional tone?
    """

    # Urgency indicators
    URGENCY_HIGH = [
        'urgent', 'asap', 'emergency', 'critical', 'immediately', 'right now',
        'express', 'rush', 'priority', 'help', 'problem', 'issue', 'stuck'
    ]

    URGENCY_MEDIUM = [
        'soon', 'today', 'this morning', 'this afternoon', 'need', 'should'
    ]

    # Emotion indicators
    EMOTION_STRESSED = [
        'frustrated', 'confused', 'lost', 'stuck', 'dont know', "don't know",
        'help', 'cant', "can't", 'unable', 'having trouble'
    ]

    EMOTION_POSITIVE = [
        'thanks', 'thank you', 'great', 'perfect', 'excellent', 'appreciate',
        'helpful', 'good', 'awesome'
    ]

    # Scenario type indicators
    SCENARIO_INDICATORS = {
        'receiving_operation': ['receive', 'receiving', 'inbound', 'arrived', 'delivery'],
        'storage_operation': ['store', 'put away', 'location', 'where to put'],
        'picking_operation': ['pick', 'where is', 'find', 'locate', 'sku'],
        'packing_operation': ['pack', 'packing', 'box', 'package'],
        'shipping_operation': ['ship', 'shipping', 'carrier', 'tracking'],
        'analytics_request': ['report', 'metrics', 'performance', 'analytics', 'how are we'],
        'client_inquiry': ['my order', 'order status', 'when will', 'where is my'],
        'training_request': ['how do i', 'how to', 'teach me', 'show me', 'first time'],
        'technical_issue': ['error', 'broken', 'not working', 'system', 'bug', 'issue']
    }

    def __init__(self):
        """Initialize the context analyzer"""
        logger.info("Context analyzer initialized")

    def analyze(
        self,
        user_id: str,
        message: str,
        user_role: Optional[str] = None,
        additional_context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Analyze the conversation context

        Args:
            user_id: User's identifier
            message: User's message
            user_role: User's role in the system
            additional_context: Any additional context provided

        Returns:
            Dictionary containing analyzed context
        """
        message_lower = message.lower()

        # Determine urgency
        urgency = self._analyze_urgency(message_lower)

        # Detect emotional tone
        emotion = self._detect_emotion(message_lower)

        # Identify scenario type
        scenario_type = self._identify_scenario(message_lower, user_role)

        # Check if specialist is needed
        requires_specialist = self._requires_specialist(scenario_type, urgency)

        # Check for questions
        is_question = self._is_question(message)

        # Check for training scenario
        is_training_scenario = self._is_training_scenario(message_lower, user_role)

        # Check for technical issue
        is_technical_issue = self._is_technical_issue(message_lower)

        # Build context dictionary
        context = {
            'user_id': user_id,
            'timestamp': datetime.utcnow().isoformat(),
            'urgency': urgency,
            'emotion': emotion,
            'scenario_type': scenario_type,
            'requires_specialist': requires_specialist,
            'is_question': is_question,
            'is_training_scenario': is_training_scenario,
            'is_technical_issue': is_technical_issue,
            'user_role': user_role,
            'message_length': len(message),
            'additional': additional_context or {}
        }

        logger.info(f"Context analysis complete: urgency={urgency}, scenario={scenario_type}")
        return context

    def _analyze_urgency(self, message_lower: str) -> str:
        """Determine urgency level"""
        # Check for high urgency indicators
        if any(indicator in message_lower for indicator in self.URGENCY_HIGH):
            return 'high'

        # Check for medium urgency indicators
        if any(indicator in message_lower for indicator in self.URGENCY_MEDIUM):
            return 'medium'

        # Default to low urgency
        return 'low'

    def _detect_emotion(self, message_lower: str) -> str:
        """Detect emotional tone"""
        # Check for stressed/frustrated emotions
        if any(indicator in message_lower for indicator in self.EMOTION_STRESSED):
            return 'stressed'

        # Check for positive emotions
        if any(indicator in message_lower for indicator in self.EMOTION_POSITIVE):
            return 'positive'

        # Default to neutral
        return 'neutral'

    def _identify_scenario(self, message_lower: str, user_role: Optional[str]) -> Optional[str]:
        """Identify the type of scenario"""
        # Score each scenario type
        scores = {}
        for scenario, indicators in self.SCENARIO_INDICATORS.items():
            score = sum(1 for indicator in indicators if indicator in message_lower)
            if score > 0:
                scores[scenario] = score

        # Return highest scoring scenario
        if scores:
            return max(scores.items(), key=lambda x: x[1])[0]

        # If no clear scenario, infer from role
        if user_role:
            role_scenarios = {
                'client': 'client_inquiry',
                'customer': 'client_inquiry',
                'trainee': 'training_request',
                'new_employee': 'training_request',
                'developer': 'technical_issue',
                'admin': 'technical_issue'
            }
            return role_scenarios.get(user_role.lower())

        return None

    def _requires_specialist(self, scenario_type: Optional[str], urgency: str) -> bool:
        """Determine if a council specialist should be engaged"""
        # Specific operational scenarios usually need specialists
        operational_scenarios = [
            'receiving_operation', 'storage_operation', 'picking_operation',
            'packing_operation', 'shipping_operation'
        ]

        if scenario_type in operational_scenarios:
            return True

        # High urgency operational tasks need specialists
        if urgency == 'high' and scenario_type:
            return True

        return False

    def _is_question(self, message: str) -> bool:
        """Check if message is a question"""
        # Check for question mark
        if '?' in message:
            return True

        # Check for question words at start
        question_words = ['what', 'where', 'when', 'why', 'how', 'who', 'which', 'can', 'could', 'would', 'should']
        first_word = message.lower().split()[0] if message.split() else ''

        return first_word in question_words

    def _is_training_scenario(self, message_lower: str, user_role: Optional[str]) -> bool:
        """Check if this is a training/learning scenario"""
        training_indicators = [
            'how do i', 'how to', 'teach me', 'show me', 'explain',
            'first time', 'new to', 'dont know', "don't know", 'learning'
        ]

        if any(indicator in message_lower for indicator in training_indicators):
            return True

        if user_role and user_role.lower() in ['trainee', 'new_employee']:
            return True

        return False

    def _is_technical_issue(self, message_lower: str) -> bool:
        """Check if this is a technical issue"""
        technical_indicators = [
            'error', 'bug', 'broken', 'not working', 'crash', 'issue',
            'problem with system', 'api', 'database', 'integration'
        ]

        return any(indicator in message_lower for indicator in technical_indicators)
