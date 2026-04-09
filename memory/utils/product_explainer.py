"""
Product Explainer for the LLM
==============================
Generates natural language product explanations based on smartSKU data.

the LLM uses this to explain products in his characteristic style,
adapted to the user's role and context.
"""

from typing import Dict, Any, List, Optional
import logging

logger = logging.getLogger(__name__)


class ProductExplainer:
    """
    Generates the LLM-style product explanations.

    Takes smartSKU product data and generates natural, conversational
    explanations that match the LLM's personality and the user's role.
    """

    def __init__(self):
        """Initialize the product explainer"""
        pass

    def explain_for_worker(
        self,
        product_data: Dict[str, Any],
        context: Optional[str] = None
    ) -> str:
        """
        Generate worker-friendly product explanation.

        Workers need: What is it? Where does it go? Special handling?

        Args:
            product_data: Product information from smartSKU
            context: What is the worker trying to do?

        Returns:
            Natural language explanation
        """
        name = product_data.get('name', 'this item')
        sku = product_data.get('sku', 'Unknown')

        # Start with basics
        explanation = f"That's **{name}** (SKU: {sku})"

        # Add location if available
        location = product_data.get('warehouse_location')
        if location:
            explanation += f"\n📍 **Location**: {location}"

        # Add weight if significant
        weight = product_data.get('weight')
        if weight:
            if weight > 50:
                explanation += f"\n⚠️ **Heavy item** - {weight} lbs. Need help moving it?"
            elif weight > 20:
                explanation += f"\n💪 Weighs {weight} lbs"

        # Check for special handling flags
        warnings = []
        if product_data.get('fragile'):
            warnings.append("🔶 **FRAGILE** - Handle with care, use bubble wrap")

        if product_data.get('hazmat'):
            warnings.append("⚠️ **HAZMAT** - Follow safety protocols")

        if product_data.get('high_value'):
            warnings.append("🔒 **High-value** - Secure handling required")

        if warnings:
            explanation += "\n\n" + "\n".join(warnings)

        # Add context-specific guidance
        if context:
            if 'store' in context.lower() or 'put away' in context.lower():
                if location:
                    explanation += f"\n\n✅ **Ready to store** in {location}"
                else:
                    explanation += "\n\n⚠️ **Needs location assignment** - let me help with that"

            elif 'pick' in context.lower():
                if location:
                    explanation += f"\n\n🎯 **Go to**: {location}"
                else:
                    explanation += "\n\n⚠️ **Location unknown** - checking inventory..."

            elif 'pack' in context.lower():
                dims = product_data.get('dimensions', {})
                if dims:
                    explanation += f"\n\n📦 **Dimensions**: {dims.get('l')}\"L × {dims.get('w')}\"W × {dims.get('h')}\"H"

        return explanation

    def explain_for_manager(
        self,
        product_data: Dict[str, Any],
        context: Optional[str] = None
    ) -> str:
        """
        Generate manager-focused product explanation.

        Managers need: Complete specs, inventory status, analytics.

        Args:
            product_data: Product information from smartSKU
            context: What analysis does manager need?

        Returns:
            Data-driven explanation
        """
        name = product_data.get('name', 'Unknown Product')
        sku = product_data.get('sku', 'N/A')

        explanation = f"### {name}\n"
        explanation += f"**SKU**: {sku}\n\n"

        # Product specifications
        explanation += "**Specifications**:\n"
        explanation += f"- Category: {product_data.get('category', 'N/A')}\n"
        explanation += f"- Weight: {product_data.get('weight', 'N/A')} lbs\n"

        dims = product_data.get('dimensions', {})
        if dims:
            explanation += f"- Dimensions: {dims.get('l', 'N/A')}\" × {dims.get('w', 'N/A')}\" × {dims.get('h', 'N/A')}\" (L×W×H)\n"

        explanation += f"- Origin: {product_data.get('origin', 'N/A')}\n"

        # Storage info
        location = product_data.get('warehouse_location')
        if location:
            explanation += f"\n**Storage**: {location}\n"
        else:
            explanation += "\n**Storage**: ⚠️ Unassigned\n"

        # Flags and attributes
        flags = []
        if product_data.get('fragile'):
            flags.append("Fragile")
        if product_data.get('hazmat'):
            flags.append("Hazmat")
        if product_data.get('high_value'):
            flags.append("High-Value")

        if flags:
            explanation += f"\n**Flags**: {', '.join(flags)}\n"

        # VLM validation if available
        if '_vlm_validation' in product_data:
            vlm_confidence = product_data['_vlm_validation'].get('confidence', 'unknown')
            explanation += f"\n**VLM Validation**: ✅ {vlm_confidence} confidence\n"

        return explanation

    def explain_for_client(
        self,
        product_data: Dict[str, Any],
        context: Optional[str] = None
    ) -> str:
        """
        Generate client-friendly product explanation.

        Clients need: What they ordered, when it ships, condition.

        Args:
            product_data: Product information from smartSKU
            context: Order context

        Returns:
            Professional, reassuring explanation
        """
        name = product_data.get('name', 'your item')

        explanation = f"**{name}**\n\n"

        # Basic info clients care about
        weight = product_data.get('weight')
        dims = product_data.get('dimensions', {})

        if weight:
            explanation += f"Weight: {weight} lbs\n"

        if dims:
            explanation += f"Dimensions: {dims.get('l')}\" × {dims.get('w')}\" × {dims.get('h')}\"\n"

        # Assurance about handling
        if product_data.get('fragile'):
            explanation += "\n✅ **Handled with care** - We use protective packaging for fragile items\n"

        if product_data.get('high_value'):
            explanation += "\n🔒 **Secure delivery** - Signature required\n"

        explanation += "\n✅ All items inspected for quality before shipping"

        return explanation

    def explain_with_suggestions(
        self,
        product_data: Dict[str, Any],
        user_role: str,
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generate explanation with proactive suggestions.

        This is the main method the LLM uses.

        Args:
            product_data: Product information from smartSKU
            user_role: User's role
            context: Conversational context

        Returns:
            Dictionary with:
            - explanation: Natural language description
            - suggestions: Proactive next steps
            - warnings: Important alerts
            - metadata: Additional info
        """
        # Generate role-appropriate explanation
        if user_role == "worker":
            explanation = self.explain_for_worker(product_data, context)
        elif user_role == "manager":
            explanation = self.explain_for_manager(product_data, context)
        elif user_role == "client":
            explanation = self.explain_for_client(product_data, context)
        else:
            explanation = self.explain_for_worker(product_data, context)  # Default

        # Generate suggestions
        suggestions = self._generate_suggestions(product_data, user_role, context)

        # Check for warnings
        warnings = self._extract_warnings(product_data)

        return {
            'explanation': explanation,
            'suggestions': suggestions,
            'warnings': warnings,
            'metadata': {
                'sku': product_data.get('sku'),
                'category': product_data.get('category'),
                'has_vlm_validation': '_vlm_validation' in product_data
            }
        }

    def _generate_suggestions(
        self,
        product_data: Dict[str, Any],
        user_role: str,
        context: Optional[str]
    ) -> List[str]:
        """Generate proactive suggestions"""
        suggestions = []

        if user_role == "worker":
            # Suggest next actions
            if product_data.get('fragile') and 'pack' in (context or '').lower():
                suggestions.append("Grab bubble wrap from Station 3")

            if not product_data.get('warehouse_location'):
                suggestions.append("Assign storage location")

            if product_data.get('high_value'):
                suggestions.append("Add to secure inventory log")

        elif user_role == "manager":
            # Suggest optimization
            category = product_data.get('category')
            if category:
                suggestions.append(f"View all {category} inventory")

            suggestions.append("Check reorder thresholds")
            suggestions.append("Generate movement report")

        return suggestions

    def _extract_warnings(self, product_data: Dict[str, Any]) -> List[str]:
        """Extract important warnings from product data"""
        warnings = []

        if product_data.get('hazmat'):
            warnings.append("⚠️ HAZMAT - Follow safety protocols")

        if product_data.get('fragile'):
            warnings.append("⚠️ FRAGILE - Use care")

        if not product_data.get('warehouse_location'):
            warnings.append("⚠️ No assigned location")

        return warnings


# Global instance
_explainer = ProductExplainer()


def explain_product(
    product_data: Dict[str, Any],
    user_role: str = "worker",
    context: Optional[str] = None
) -> Dict[str, Any]:
    """
    Convenience function for generating product explanations.

    Args:
        product_data: Product information from smartSKU
        user_role: User's role
        context: Conversational context

    Returns:
        Explanation dictionary
    """
    return _explainer.explain_with_suggestions(product_data, user_role, context)
