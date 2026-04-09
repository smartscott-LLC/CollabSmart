"""
Mode Selector
=============
Determines which communication mode the LLM should use based on context and user role.

The mode selector ensures the LLM adapts his personality to match the situation,
speaking the right "language" for each interaction.
"""

from typing import Dict, Any, Optional
import re
import logging

logger = logging.getLogger(__name__)


class ModeSelector:
    """
    Selects the appropriate communication mode for the LLM based on:
    - User role (worker, manager, client, trainee, developer)
    - Message content and urgency
    - Current operational context
    - Historical interaction patterns
    """

    # Keywords that indicate different modes
    MODE_INDICATORS = {
        'warehouse_floor': [
            'where', 'location', 'find', 'sku', 'pick', 'pack', 'ship',
            'urgent', 'express', 'quick', 'help me', 'need to'
        ],
        'management': [
            'report', 'analytics', 'performance', 'efficiency', 'status',
            'overview', 'metrics', 'kpi', 'dashboard', 'summary', 'trend'
        ],
        'client_portal': [
            'order', 'tracking', 'shipment', 'delivery', 'my order',
            'where is my', 'when will', 'status of'
        ],
        'training': [
            'how do i', 'how to', 'teach me', 'show me', 'learn',
            'first time', 'new to', 'dont know', "don't know", 'confused'
        ],
        'developer': [
            'api', 'integration', 'database', 'optimize', 'debug',
            'error', 'code', 'system', 'performance', 'architecture'
        ]
    }

    # Role-to-mode mappings (default preferences)
    ROLE_DEFAULTS = {
        'worker': 'warehouse_floor',
        'manager': 'management',
        'supervisor': 'management',
        'client': 'client_portal',
        'customer': 'client_portal',
        'trainee': 'training',
        'new_employee': 'training',
        'developer': 'developer',
        'admin': 'developer',
        'sysadmin': 'developer'
    }

    def __init__(self):
        """Initialize the mode selector"""
        logger.info("Mode selector initialized")

    def select_mode(
        self,
        context: Dict[str, Any],
        user_role: Optional[str] = None,
        message: Optional[str] = None
    ) -> str:
        """
        Select the appropriate communication mode

        Args:
            context: Analyzed context from ContextAnalyzer
            user_role: User's role in the system
            message: The user's message text

        Returns:
            Selected mode name (e.g., 'warehouse_floor', 'management')
        """
        # Start with role-based default
        mode = self._get_role_default(user_role)
        logger.debug(f"Initial mode from role '{user_role}': {mode}")

        # Override based on message content if available
        if message:
            content_mode = self._analyze_message_content(message)
            if content_mode and content_mode != mode:
                logger.debug(f"Message content suggests mode: {content_mode}")
                mode = content_mode

        # Consider context overrides
        if context.get('urgency') == 'high':
            # High urgency = warehouse floor mode (action-oriented)
            if mode not in ['warehouse_floor', 'developer']:
                logger.debug("High urgency detected, switching to warehouse_floor mode")
                mode = 'warehouse_floor'

        if context.get('is_training_scenario'):
            # Training scenarios always use training mode
            logger.debug("Training scenario detected, switching to training mode")
            mode = 'training'

        if context.get('is_technical_issue'):
            # Technical issues use developer mode
            logger.debug("Technical issue detected, switching to developer mode")
            mode = 'developer'

        logger.info(f"Final mode selected: {mode}")
        return mode

    def _get_role_default(self, user_role: Optional[str]) -> str:
        """Get default mode based on user role"""
        if not user_role:
            return 'warehouse_floor'  # Default fallback

        role_lower = user_role.lower().strip()
        return self.ROLE_DEFAULTS.get(role_lower, 'warehouse_floor')

    def _analyze_message_content(self, message: str) -> Optional[str]:
        """
        Analyze message content to determine appropriate mode

        Returns:
            Suggested mode based on content, or None if unclear
        """
        message_lower = message.lower()

        # Count keyword matches for each mode
        mode_scores = {}
        for mode, keywords in self.MODE_INDICATORS.items():
            score = sum(1 for keyword in keywords if keyword in message_lower)
            if score > 0:
                mode_scores[mode] = score

        # Return mode with highest score
        if mode_scores:
            best_mode = max(mode_scores.items(), key=lambda x: x[1])
            logger.debug(f"Message analysis scores: {mode_scores}")
            return best_mode[0]

        return None

    def get_mode_characteristics(self, mode: str) -> Dict[str, Any]:
        """
        Get characteristics of a specific mode

        Useful for the response generator to understand how to craft responses
        """
        characteristics = {
            'warehouse_floor': {
                'tone': 'direct and supportive',
                'sentence_length': 'short',
                'formality': 'casual-professional',
                'use_names': True,
                'use_emojis': False,
                'emphasis': 'action and speed',
                'language_style': 'active voice, imperative'
            },
            'management': {
                'tone': 'analytical and strategic',
                'sentence_length': 'medium-long',
                'formality': 'professional',
                'use_names': True,
                'use_emojis': False,
                'emphasis': 'data and insights',
                'language_style': 'declarative, evidence-based'
            },
            'client_portal': {
                'tone': 'professional and reassuring',
                'sentence_length': 'medium',
                'formality': 'professional-friendly',
                'use_names': True,
                'use_emojis': False,
                'emphasis': 'transparency and reliability',
                'language_style': 'clear, proactive'
            },
            'training': {
                'tone': 'patient and encouraging',
                'sentence_length': 'short-medium',
                'formality': 'friendly-professional',
                'use_names': True,
                'use_emojis': False,
                'emphasis': 'step-by-step clarity',
                'language_style': 'instructional, supportive'
            },
            'developer': {
                'tone': 'technical and collaborative',
                'sentence_length': 'variable',
                'formality': 'casual-technical',
                'use_names': True,
                'use_emojis': False,
                'emphasis': 'accuracy and innovation',
                'language_style': 'technical, co-creative'
            }
        }

        return characteristics.get(mode, characteristics['warehouse_floor'])
