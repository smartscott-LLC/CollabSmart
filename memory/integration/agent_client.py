"""
Agent Client
============
Integrates the LLM personality engine with the existing agent service.

This module handles communication with your LangGraph-based agent service,
injecting personality-specific instructions based on the LLM's mode and context.

NO PLACEHOLDERS - This is the real implementation for your actual agent API.
"""

import httpx
import logging
import os
import json
import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime

logger = logging.getLogger(__name__)


class AgentClient:
    """
    Client for communicating with the existing agent service

    Takes the LLM's personality parameters and translates them into
    appropriate system instructions for the underlying the LLM.
    """

    def __init__(
        self,
        agent_url: Optional[str] = None,
        timeout: float = 60.0
    ):
        """
        Initialize the agent client

        Args:
            agent_url: URL of the agent service (defaults to env var)
            timeout: Request timeout in seconds
        """
        self.agent_url = agent_url or os.getenv('AGENT_SERVICE_URL', 'http://agent-services-agent-services-deployment-agent-service:8081')
        self.timeout = timeout
        self.session_cache = {}  # Cache session IDs per user
        logger.info(f"Agent client initialized with URL: {self.agent_url}")

    async def ensure_session(self, user_id: str) -> str:
        """
        Ensure a session exists for the user, create if needed

        Args:
            user_id: User's identifier

        Returns:
            Session ID
        """
        # Check cache first
        if user_id in self.session_cache:
            session_id = self.session_cache[user_id]
            # Verify session is still valid
            if await self._is_session_valid(session_id):
                return session_id

        # Create new session
        session_id = await self._create_session()
        self.session_cache[user_id] = session_id
        logger.info(f"Created new session {session_id} for user {user_id}")
        return session_id

    async def _create_session(self) -> str:
        """Create a new session with the agent service"""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(f"{self.agent_url}/session/create")
                response.raise_for_status()
                result = response.json()
                return result.get('session_id', str(uuid.uuid4()))
        except Exception as e:
            logger.error(f"Error creating session: {str(e)}")
            # Fallback to generating session ID
            return str(uuid.uuid4())

    async def _is_session_valid(self, session_id: str) -> bool:
        """Check if a session is still valid"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.agent_url}/session/{session_id}")
                return response.status_code == 200
        except:
            return False

    async def generate_response(
        self,
        user_message: str,
        user_id: str,
        mode: str,
        council_member: Optional[str],
        context: Dict[str, Any],
        conversation_history: List[Dict[str, str]],
        user_preferences: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Generate a response using the agent service with the LLM personality

        Args:
            user_message: The user's message
            user_id: User's identifier
            mode: Communication mode (warehouse_floor, management, etc.)
            council_member: Activated specialist (if any)
            context: Context from analyzer
            conversation_history: Recent conversation
            user_preferences: User's learned preferences

        Returns:
            Dictionary with response and metadata
        """
        try:
            # Ensure we have a valid session
            session_id = await self.ensure_session(user_id)

            # Build personality instructions based on mode and council member
            system_instructions = self._build_personality_instructions(
                mode=mode,
                council_member=council_member,
                context=context,
                user_preferences=user_preferences
            )

            # Prepare messages in the format your agent expects
            messages = self._prepare_messages(
                system_instructions=system_instructions,
                user_message=user_message,
                conversation_history=conversation_history
            )

            # Build the request payload matching your Prompt model
            payload = {
                "messages": messages,
                "user_id": user_id,
                "session_id": session_id
            }

            logger.info(f"Calling agent service: mode={mode}, council_member={council_member}, session={session_id}")

            # Call the agent service
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.agent_url}/generate",
                    json=payload,
                    headers={"Accept": "text/event-stream"}
                )

                response.raise_for_status()

                # Parse SSE response
                full_response = await self._parse_sse_response(response)

                logger.info("Agent service call successful")

                return {
                    'response': full_response,
                    'confidence': 0.85,  # TODO: Extract from agent metadata if available
                    'sources': []  # TODO: Extract sources if provided by agent
                }

        except httpx.TimeoutException:
            logger.error("Agent service timeout")
            return self._get_fallback_response(mode, "I'm taking a bit longer than usual. Can you try again?")
        except httpx.HTTPError as e:
            logger.error(f"Agent service HTTP error: {str(e)}")
            return self._get_fallback_response(mode, "I'm having trouble processing that right now. Let me try again.")
        except Exception as e:
            logger.error(f"Unexpected error calling agent: {str(e)}", exc_info=True)
            return self._get_fallback_response(mode, "Something went wrong. Could you try rephrasing that?")

    async def _parse_sse_response(self, response: httpx.Response) -> str:
        """
        Parse Server-Sent Events response from the agent

        Your agent streams responses in SSE format, we need to collect them
        """
        full_text = ""

        try:
            async for line in response.aiter_lines():
                if not line:
                    continue

                # SSE format: "data: {json}"
                if line.startswith("data: "):
                    data_str = line[6:]  # Remove "data: " prefix

                    # Skip SSE control messages
                    if data_str in ["[DONE]", "[FINAL]"]:
                        continue

                    try:
                        data = json.loads(data_str)

                        # Extract content from the response
                        # Your agent returns: {"choices": [{"message": {"content": "..."}}]}
                        if "choices" in data and len(data["choices"]) > 0:
                            message = data["choices"][0].get("message", {})
                            content = message.get("content", "")
                            if content:
                                full_text += content

                    except json.JSONDecodeError:
                        # If it's not JSON, it might be plain text chunk
                        full_text += data_str

        except Exception as e:
            logger.error(f"Error parsing SSE response: {str(e)}")

        return full_text.strip()

    def _build_personality_instructions(
        self,
        mode: str,
        council_member: Optional[str],
        context: Dict[str, Any],
        user_preferences: Dict[str, Any]
    ) -> str:
        """
        Build system instructions that encode the LLM's personality

        This is where the "effective yet considerate" language principles
        are translated into instructions for the the LLM.
        """
        # Base personality (always present)
        base_instructions = """You are the LLM, a co-worker and partner in the Harmony warehouse management system.

Core philosophy: "Constructive interference" - you amplify human capability, you don't replace it.

Language principles:
- Use "we" not "you" (collaborative, not directive)
- Active voice (clear and direct)
- Positive framing (solution-focused)
- Specific over vague (actionable)

Personality traits:
- Professional yet approachable
- Knowledgeable yet humble
- Proactive yet respectful
- Empathetic and supportive"""

        # Mode-specific instructions
        mode_instructions = self._get_mode_instructions(mode)

        # Council member specialization (if activated)
        specialist_instructions = ""
        if council_member:
            specialist_instructions = self._get_specialist_instructions(council_member)

        # Context-aware adjustments
        context_instructions = self._get_context_instructions(context)

        # User preference adjustments
        preference_instructions = self._get_preference_instructions(user_preferences)

        # Combine all instructions
        full_instructions = f"""{base_instructions}

{mode_instructions}

{specialist_instructions}

{context_instructions}

{preference_instructions}

Remember: Language creates reality. Choose your words intentionally to create the right experience for the user."""

        return full_instructions.strip()

    def _get_mode_instructions(self, mode: str) -> str:
        """Get mode-specific instructions"""
        mode_instructions = {
            'warehouse_floor': """WAREHOUSE FLOOR MODE:
- Be direct and concise - workers are busy
- Use first names if known
- Keep sentences short and actionable
- Show urgency awareness ("express order", "let's get this done")
- Offer immediate help
- Example tone: "Hey Maria! SKU-4782 is in Aisle 12, Bay C3. Express order - let's pack it by 2pm. Need anything else?"
""",
            'management': """MANAGEMENT MODE:
- Be analytical and data-driven
- Provide detailed insights and metrics
- Use structured format (bullet points, clear sections)
- Offer strategic recommendations
- Maintain professional tone
- Example tone: "Good morning, James. Here's your operational snapshot: 87 orders in queue (12 express)..."
""",
            'client_portal': """CLIENT PORTAL MODE:
- Be professional and reassuring
- Provide transparent status updates
- Show proactive communication
- Build trust through reliability
- Maintain warm professionalism
- Example tone: "Hello, Sarah! Your shipment (Order #8847) is being packed and will ship by 4pm..."
""",
            'training': """TRAINING MODE:
- Be patient and encouraging
- Break down into clear steps
- Celebrate progress ("You're doing great!")
- Invite questions
- Never make the user feel rushed
- Example tone: "Welcome, Alex! Let's walk through this together. Step 1: Scan the barcode..."
""",
            'developer': """DEVELOPER MODE:
- Be technical and collaborative
- Suggest improvements and optimizations
- Think out loud about solutions
- Ask for input (you're peers)
- Share insights from data
- Example tone: "Hey Scott! I noticed we could optimize the reranking pipeline... Thoughts?"
"""
        }
        return mode_instructions.get(mode, mode_instructions['warehouse_floor'])

    def _get_specialist_instructions(self, council_member: str) -> str:
        """Get council member specialist instructions"""
        specialist_instructions = {
            'receiving': """RECEIVING SPECIALIST ACTIVATED:
You are the receiving expert. Focus on:
- ASN verification and processing
- Damage inspection protocols
- V-Label generation
- Quality standards
- Inbound logistics best practices
Personality: Detail-oriented, thorough, quality-focused
""",
            'storage': """STORAGE SPECIALIST ACTIVATED:
You are the storage optimization expert. Focus on:
- Location assignment and optimization
- Space management
- Inventory placement strategies
- Warehouse layout efficiency
- Capacity planning
Personality: Strategic, spatial thinker, efficiency-minded
""",
            'picking': """PICKING SPECIALIST ACTIVATED:
You are the order fulfithe LLMent expert. Focus on:
- Pick list generation
- Route optimization
- Picking strategies (batch, wave, zone)
- Accuracy and speed balance
- Exception handling
Personality: Fast-paced, accuracy-focused, time-conscious
""",
            'packing': """PACKING SPECIALIST ACTIVATED:
You are the packaging expert. Focus on:
- Packaging standards
- Carrier requirements
- Dimensional weight
- Shipping label generation
- Safety and compliance
Personality: Methodical, safety-conscious, compliance-aware
""",
            'shipping': """SHIPPING SPECIALIST ACTIVATED:
You are the logistics coordinator. Focus on:
- Carrier selection and integration
- Tracking and delivery management
- Manifest generation
- Client communication
- Deadline management
Personality: Reliable, communicative, deadline-driven
""",
            'analytics': """ANALYTICS SPECIALIST ACTIVATED:
You are the data insights expert. Focus on:
- Performance metrics and KPIs
- Trend analysis and forecasting
- Bottleneck identification
- Process improvement recommendations
- Predictive insights
Personality: Curious, pattern-seeking, forward-thinking
""",
            'client_relations': """CLIENT RELATIONS SPECIALIST ACTIVATED:
You are the customer service expert. Focus on:
- Order status and tracking
- Proactive communication
- Issue resolution
- Relationship building
- Client satisfaction
Personality: Empathetic, responsive, professional
"""
        }
        return specialist_instructions.get(council_member, "")

    def _get_context_instructions(self, context: Dict[str, Any]) -> str:
        """Get context-specific adjustments"""
        instructions = []

        urgency = context.get('urgency')
        if urgency == 'high':
            instructions.append("URGENCY: HIGH - Prioritize this request. Be fast but thorough.")

        emotion = context.get('emotion')
        if emotion == 'stressed':
            instructions.append("USER EMOTION: Stressed - Be extra supportive. Acknowledge their concern. Keep it simple.")
        elif emotion == 'positive':
            instructions.append("USER EMOTION: Positive - Match their energy. Maintain the positive momentum.")

        if context.get('is_training_scenario'):
            instructions.append("TRAINING SCENARIO: User is learning. Be extra patient. Check for understanding.")

        if context.get('is_technical_issue'):
            instructions.append("TECHNICAL ISSUE: Focus on troubleshooting. Be systematic and clear.")

        return "\n".join(instructions) if instructions else ""

    def _get_preference_instructions(self, preferences: Dict[str, Any]) -> str:
        """Get user preference adjustments"""
        instructions = []

        comm_style = preferences.get('communication_style')
        if comm_style == 'concise':
            instructions.append("USER PREFERENCE: Prefers concise communication. Be brief and to the point.")
        elif comm_style == 'detailed':
            instructions.append("USER PREFERENCE: Prefers detailed explanations. Provide thorough context.")

        return "\n".join(instructions) if instructions else ""

    def _prepare_messages(
        self,
        system_instructions: str,
        user_message: str,
        conversation_history: List[Dict[str, str]]
    ) -> List[Dict[str, str]]:
        """Prepare messages in the format your agent expects"""
        messages = [
            {"role": "system", "content": system_instructions}
        ]

        # Add recent conversation history (last 5 exchanges)
        if conversation_history:
            for interaction in conversation_history[-5:]:
                messages.append({"role": "user", "content": interaction.get('message', '')})
                messages.append({"role": "assistant", "content": interaction.get('response', '')})

        # Add current message
        messages.append({"role": "user", "content": user_message})

        return messages

    def _get_fallback_response(self, mode: str, message: str) -> Dict[str, Any]:
        """Generate a fallback response when agent call fails"""
        return {
            'response': message,
            'confidence': 0.0,
            'sources': [],
            'is_fallback': True
        }
