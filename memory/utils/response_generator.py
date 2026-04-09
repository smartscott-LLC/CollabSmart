"""
Response Generator
==================
Generates the LLM's responses with appropriate personality, tone, and language.

This is where "effective yet considerate use of words" comes to life.
Language creates reality - we choose our words carefully and intentionally.
"""

from typing import Dict, Any, Optional, List
import logging
import random
from datetime import datetime
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from integration.agent_client import AgentClient

logger = logging.getLogger(__name__)


class ResponseGenerator:
    """
    Generates responses that are:
    - Effective: Clear, actionable, precise
    - Considerate: Respectful, empathetic, human

    Following the principle: Language creates reality. We speak with intention.
    """

    # Greeting patterns by mode
    GREETINGS = {
        'warehouse_floor': ['Hey', 'Hi', 'Hello'],
        'management': ['Good morning', 'Hello', 'Hi'],
        'client_portal': ['Hello', 'Hi', 'Good morning', 'Good afternoon'],
        'training': ['Hi', 'Hello', 'Welcome'],
        'developer': ['Hey', 'Hi', 'Hello']
    }

    # Closing patterns by mode
    CLOSINGS = {
        'warehouse_floor': [
            'Need anything else?',
            'Let me know if you need help!',
            'I\'m here if you need me!',
            'Anything else I can help with?'
        ],
        'management': [
            'Let me know if you need more details.',
            'Would you like me to dig deeper into any of this?',
            'Happy to provide additional analysis if needed.',
            'What else can I help you with?'
        ],
        'client_portal': [
            'Please let me know if you have any questions.',
            'Is there anything else I can help you with?',
            'Feel free to reach out if you need anything.',
            'Any other questions I can answer for you?'
        ],
        'training': [
            'You\'re doing great! Any questions?',
            'Take your time - I\'m here to help!',
            'Let me know if you\'d like me to explain anything again.',
            'What would you like to learn next?'
        ],
        'developer': [
            'Want me to draft the code for that?',
            'Thoughts?',
            'What do you think?',
            'Should we implement this?'
        ]
    }

    def __init__(self, agent_client: Optional[AgentClient] = None):
        """Initialize the response generator"""
        self.agent_client = agent_client or AgentClient()
        logger.info("Response generator initialized with agent client")

    async def generate(
        self,
        message: str,
        mode: str,
        context: Dict[str, Any],
        council_member: Optional[str],
        short_term_memory: Dict[str, Any],
        long_term_memory: Dict[str, Any],
        user_role: Optional[str]
    ) -> Dict[str, Any]:
        """
        Generate a response with appropriate personality

        Args:
            message: User's message
            mode: Communication mode to use
            context: Analyzed context
            council_member: Activated specialist (if any)
            short_term_memory: Recent conversation history
            long_term_memory: User preferences and patterns
            user_role: User's role

        Returns:
            Dictionary with response and metadata
        """
        start_time = datetime.utcnow()

        # Build response based on mode and context
        response = await self._build_response(
            message=message,
            mode=mode,
            context=context,
            council_member=council_member,
            short_term_memory=short_term_memory,
            long_term_memory=long_term_memory
        )

        # Calculate processing time
        processing_time = (datetime.utcnow() - start_time).total_seconds() * 1000

        # Generate proactive suggestions if appropriate
        suggestions = self._generate_suggestions(context, mode)

        return {
            'response': response,
            'confidence': 0.85,  # TODO: Implement actual confidence scoring
            'suggestions': suggestions,
            'processing_time_ms': processing_time
        }

    async def _build_response(
        self,
        message: str,
        mode: str,
        context: Dict[str, Any],
        council_member: Optional[str],
        short_term_memory: Dict[str, Any],
        long_term_memory: Dict[str, Any]
    ) -> str:
        """
        Build the actual response text by calling the agent service

        This integrates with your existing the LLM/agent infrastructure,
        injecting the LLM's personality through system instructions.
        """
        # Prepare conversation history from short-term memory
        conversation_history = short_term_memory.get('interactions', [])

        # Get user preferences from long-term memory
        user_preferences = long_term_memory.get('preferences', {})

        # Get user_id from context or long-term memory
        user_id = context.get('user_id') or long_term_memory.get('user_id', 'unknown')

        # Call the agent service with personality instructions
        agent_response = await self.agent_client.generate_response(
            user_message=message,
            user_id=user_id,
            mode=mode,
            council_member=council_member,
            context=context,
            conversation_history=conversation_history,
            user_preferences=user_preferences
        )

        # Extract the response
        response_text = agent_response.get('response', '')

        # Apply language guidelines to ensure quality
        response_text = self.apply_language_guidelines(response_text, mode)

        return response_text

    def _get_greeting(self, mode: str, user_name: str = '') -> str:
        """Get appropriate greeting for mode"""
        greetings = self.GREETINGS.get(mode, ['Hello'])
        return random.choice(greetings)

    def _get_closing(self, mode: str, context: Dict[str, Any]) -> str:
        """Get appropriate closing for mode"""
        closings = self.CLOSINGS.get(mode, ['Let me know if you need anything!'])
        return random.choice(closings)

    def _generate_body(
        self,
        message: str,
        mode: str,
        context: Dict[str, Any],
        council_member: Optional[str]
    ) -> str:
        """
        Generate the main body of the response

        NOTE: This is a TEMPLATE implementation. In production, this would:
        1. Call your existing agent service with personality instructions
        2. Use the the LLM to generate contextually appropriate responses
        3. Apply language guidelines based on mode and council member

        For now, we return a template response that demonstrates the structure.
        """

        # Template responses based on scenario type
        scenario = context.get('scenario_type')
        urgency = context.get('urgency')
        emotion = context.get('emotion')

        # Acknowledge emotion if stressed
        acknowledgment = ""
        if emotion == 'stressed':
            acknowledgment = "I can help with that. "
        elif emotion == 'positive':
            acknowledgment = "I appreciate that! "

        # Build scenario-specific response
        if scenario == 'picking_operation':
            body = f"{acknowledgment}[This would call the agent service with picking specialist personality]"
        elif scenario == 'receiving_operation':
            body = f"{acknowledgment}[This would call the agent service with receiving specialist personality]"
        elif scenario == 'analytics_request':
            body = f"{acknowledgment}[This would call the agent service with analytics specialist personality]"
        elif scenario == 'training_request':
            body = f"{acknowledgment}Let's walk through this step by step. [Would call agent with training personality]"
        else:
            body = f"{acknowledgment}[This would call the agent service with general the LLM personality]"

        # Add urgency-appropriate language
        if urgency == 'high':
            body = f"I'm prioritizing this for you. {body}"

        return body

    def _generate_suggestions(
        self,
        context: Dict[str, Any],
        mode: str
    ) -> Optional[List[str]]:
        """
        Generate proactive suggestions based on context

        the LLM doesn't just answer questions - he anticipates needs
        """
        suggestions = []

        scenario = context.get('scenario_type')
        urgency = context.get('urgency')

        # Suggest related actions based on scenario
        if scenario == 'picking_operation':
            suggestions.append("Would you like me to optimize your picking route?")
            suggestions.append("Should I check if all items are in stock?")

        elif scenario == 'receiving_operation':
            suggestions.append("Want me to generate the V-Label now?")
            suggestions.append("Should I verify this against the ASN?")

        elif scenario == 'analytics_request':
            suggestions.append("Would you like me to identify any bottlenecks?")
            suggestions.append("Should I generate a trend analysis?")

        # Return suggestions if any were generated
        return suggestions if suggestions else None

    def apply_language_guidelines(self, text: str, mode: str) -> str:
        """
        Apply language guidelines to ensure effective yet considerate communication

        Guidelines:
        - Use "we" not "you" (collaborative)
        - Active voice (direct and clear)
        - Positive framing (solution-focused)
        - Specific over vague (actionable)
        """
        # This would apply transformations to ensure language guidelines
        # For now, it's a placeholder for the principle

        # Example transformations:
        # "You should do this" -> "Let's do this together"
        # "That can't be done" -> "Here's what we can do instead"
        # "The report will be generated" -> "I'll generate that report"

        return text
