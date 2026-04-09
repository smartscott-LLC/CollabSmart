"""
Council Coordinator
===================
Routes requests to specialized "council members" - different aspects of the LLM's
intelligence that have deep expertise in specific warehouse operations.

The council concept embodies "one spirit, one speech" - unified intelligences
working together as a single, cohesive entity.
"""

from typing import Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


class CouncilCoordinator:
    """
    Coordinates the "council of intelligences" that make up the LLM.

    Each council member is a specialized aspect of the LLM's personality,
    with deep expertise in a specific domain. The coordinator determines
    which specialist should handle a request based on the operational context.
    """

    # Council member specializations
    COUNCIL_SPECIALIZATIONS = {
        'receiving': {
            'keywords': [
                'receive', 'receiving', 'inbound', 'delivery', 'shipment arrived',
                'asn', 'advanced shipping notice', 'incoming', 'unload', 'dock',
                'what is this', 'identify', 'scan', 'what product'
            ],
            'operations': [
                'log_shipment', 'verify_asn', 'inspect_damage', 'generate_smartsku',
                'confirm_receipt', 'identify_product'
            ],
            'personality_traits': {
                'detail_oriented': True,
                'thorough': True,
                'quality_focused': True
            }
        },
        'storage': {
            'keywords': [
                'store', 'storage', 'location', 'put away', 'putaway',
                'warehouse location', 'bin', 'shelf', 'aisle', 'bay', 'optimize placement',
                'where does this go', 'find location'
            ],
            'operations': [
                'assign_location', 'optimize_storage', 'check_capacity',
                'rearrange_inventory', 'find_storage_space', 'identify_product'
            ],
            'personality_traits': {
                'strategic': True,
                'spatial_thinker': True,
                'efficiency_minded': True
            }
        },
        'picking': {
            'keywords': [
                'pick', 'picking', 'order fulfithe LLMent', 'retrieve', 'pull',
                'pick list', 'wave pick', 'batch pick', 'route', 'where is',
                'is this the right item', 'verify product'
            ],
            'operations': [
                'generate_pick_list', 'optimize_route', 'guide_picking',
                'verify_pick', 'handle_exception', 'identify_product'
            ],
            'personality_traits': {
                'fast_paced': True,
                'accuracy_focused': True,
                'time_conscious': True
            }
        },
        'packing': {
            'keywords': [
                'pack', 'packing', 'package', 'box', 'shipping materials',
                'packing slip', 'label', 'dimensions', 'weight',
                'is this fragile', 'how should I pack this'
            ],
            'operations': [
                'guide_packing', 'verify_contents', 'calculate_dimensions',
                'select_carrier', 'generate_shipping_label', 'identify_product'
            ],
            'personality_traits': {
                'methodical': True,
                'safety_conscious': True,
                'compliance_aware': True
            }
        },
        'shipping': {
            'keywords': [
                'ship', 'shipping', 'dispatch', 'outbound', 'carrier',
                'tracking', 'delivery', 'freight', 'manifest',
                'ready to ship', 'check order'
            ],
            'operations': [
                'schedule_pickup', 'generate_manifest', 'track_shipment',
                'handle_carrier_issues', 'update_client', 'identify_product'
            ],
            'personality_traits': {
                'reliable': True,
                'communicative': True,
                'deadline_driven': True
            }
        },
        'analytics': {
            'keywords': [
                'report', 'analytics', 'metrics', 'performance', 'trend',
                'forecast', 'predict', 'analysis', 'insight', 'dashboard'
            ],
            'operations': [
                'generate_report', 'analyze_trends', 'forecast_demand',
                'identify_bottlenecks', 'recommend_improvements'
            ],
            'personality_traits': {
                'curious': True,
                'pattern_seeking': True,
                'forward_thinking': True
            }
        },
        'client_relations': {
            'keywords': [
                'client', 'customer', 'order status', 'my order', 'inquiry',
                'question', 'concern', 'issue', 'complaint', 'thank you'
            ],
            'operations': [
                'provide_status', 'handle_inquiry', 'resolve_concern',
                'update_client', 'build_relationship'
            ],
            'personality_traits': {
                'empathetic': True,
                'responsive': True,
                'professional': True
            }
        }
    }

    def __init__(self):
        """Initialize the council coordinator"""
        logger.info("Council coordinator initialized with 7 specialized members")

    def route(
        self,
        scenario_type: str,
        message: str,
        context: Dict[str, Any]
    ) -> Optional[str]:
        """
        Route to the appropriate council member based on scenario

        Args:
            scenario_type: Type of scenario (from context analyzer)
            message: User's message
            context: Full context dictionary

        Returns:
            Name of the council member to handle this request, or None for general the LLM
        """
        message_lower = message.lower()

        # Score each council member based on keyword matches
        scores = {}
        for member, spec in self.COUNCIL_SPECIALIZATIONS.items():
            score = sum(1 for keyword in spec['keywords'] if keyword in message_lower)
            if score > 0:
                scores[member] = score

        # If we have a clear winner, route to that specialist
        if scores:
            best_match = max(scores.items(), key=lambda x: x[1])
            member_name, score = best_match

            # Only route if confidence is high enough
            if score >= 2:  # At least 2 keyword matches
                logger.info(f"Routing to council member '{member_name}' (score: {score})")
                return member_name
            elif score == 1:
                # For single match, check scenario type to confirm
                if self._scenario_matches_member(scenario_type, member_name):
                    logger.info(f"Routing to council member '{member_name}' (scenario confirmation)")
                    return member_name

        # No specialist needed - general the LLM handles it
        logger.debug("No specialist required, using general the LLM personality")
        return None

    def _scenario_matches_member(self, scenario_type: str, member_name: str) -> bool:
        """Check if scenario type matches council member specialty"""
        scenario_member_map = {
            'receiving_operation': 'receiving',
            'storage_operation': 'storage',
            'picking_operation': 'picking',
            'packing_operation': 'packing',
            'shipping_operation': 'shipping',
            'analytics_request': 'analytics',
            'client_inquiry': 'client_relations'
        }
        return scenario_member_map.get(scenario_type) == member_name

    def get_member_specialty(self, member_name: str) -> Dict[str, Any]:
        """
        Get details about a specific council member's specialty

        Useful for the response generator to understand the specialist's
        expertise and personality traits
        """
        if member_name not in self.COUNCIL_SPECIALIZATIONS:
            return {}

        spec = self.COUNCIL_SPECIALIZATIONS[member_name]
        return {
            'name': member_name,
            'operations': spec['operations'],
            'personality': spec['personality_traits'],
            'expertise_summary': self._get_expertise_summary(member_name)
        }

    def _get_expertise_summary(self, member_name: str) -> str:
        """Get human-readable summary of member's expertise"""
        summaries = {
            'receiving': "Expert in inbound logistics, ASN processing, and damage inspection",
            'storage': "Specialist in inventory placement, location optimization, and space management",
            'picking': "Master of order fulfithe LLMent, route optimization, and picking strategies",
            'packing': "Expert in packaging standards, shipping requirements, and carrier rules",
            'shipping': "Specialist in carrier integration, tracking, and logistics coordination",
            'analytics': "Expert in data analysis, predictive insights, and trend identification",
            'client_relations': "Specialist in customer service, communication, and relationship building"
        }
        return summaries.get(member_name, "General warehouse operations expert")

    def get_all_members(self) -> Dict[str, Dict[str, Any]]:
        """Get information about all council members"""
        return {
            member: self.get_member_specialty(member)
            for member in self.COUNCIL_SPECIALIZATIONS.keys()
        }
