"""
smartSKU Client for the LLM
============================
Enables the LLM to identify products, decode smartSKUs, and provide
AI-powered explanations using VLM vision.

This gives the LLM "eyes" to see products and understand them deeply.
"""

import httpx
import logging
import os
from typing import Dict, Any, Optional, List
from datetime import datetime

logger = logging.getLogger(__name__)


class SmartSKUClient:
    """
    Client for smartSKU API integration with the LLM.

    Provides product identification, decoding, and AI vision capabilities
    to enhance the LLM's warehouse guidance abilities.
    """

    def __init__(
        self,
        smartsku_url: Optional[str] = None,
        timeout: float = 30.0
    ):
        """
        Initialize smartSKU client.

        Args:
            smartsku_url: URL of smartSKU API service
            timeout: Request timeout in seconds
        """
        self.smartsku_url = smartsku_url or os.getenv(
            'SMARTSKU_SERVICE_URL',
            'http://smartsku-smartsku-deployment-smartsku-service:8001'
        )
        self.timeout = timeout
        logger.info(f"smartSKU client initialized: {self.smartsku_url}")

    async def health_check(self) -> bool:
        """Check if smartSKU service is available"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.smartsku_url}/api/v1/smartsku/health")
                is_healthy = response.status_code == 200

                if is_healthy:
                    data = response.json()
                    vlm_available = data.get('dependencies', {}).get('vlm', False)
                    logger.info(f"smartSKU healthy | VLM: {vlm_available}")
                    return True
                return False
        except Exception as e:
            logger.warning(f"smartSKU health check failed: {e}")
            return False

    async def decode_product(
        self,
        image_url: str,
        use_vlm: bool = False
    ) -> Dict[str, Any]:
        """
        Decode a smartSKU image to get product data.

        Args:
            image_url: URL or path to smartSKU image
            use_vlm: Use VLM-enhanced decode with validation

        Returns:
            Product data dictionary with fields:
            - sku: Product SKU
            - name: Product name
            - weight: Weight in lbs
            - dimensions: {l, w, h} in inches
            - category: Product category
            - warehouse_location: Where it's stored
            - origin: Where it's from
            - flags: {fragile, hazmat, high_value, etc.}
        """
        endpoint = "/api/v1/smartsku/decode/vlm" if use_vlm else "/api/v1/smartsku/decode"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.smartsku_url}{endpoint}",
                    json={"image_url": image_url}
                )
                response.raise_for_status()
                result = response.json()

                if result.get('success'):
                    product_data = result.get('product_data', {})

                    # Add VLM insights if available
                    if use_vlm and 'vlm_validation' in result:
                        product_data['_vlm_validation'] = result['vlm_validation']

                    logger.info(f"Decoded smartSKU: {product_data.get('sku')}")
                    return product_data
                else:
                    logger.error(f"Decode failed: {result.get('error')}")
                    return {}

        except Exception as e:
            logger.error(f"Error decoding smartSKU: {e}")
            return {}

    async def blind_decode(self, image_url: str) -> Dict[str, Any]:
        """
        Attempt to decode smartSKU without schema using AI vision only.

        This is a fallback method when normal decode fails or schema unavailable.

        Args:
            image_url: URL or path to smartSKU image

        Returns:
            Dictionary with:
            - confidence: Confidence level (high/medium/low)
            - extracted_data: AI-extracted product information
            - warning: Accuracy warning
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.smartsku_url}/api/v1/smartsku/decode/blind",
                    json={"image_url": image_url}
                )
                response.raise_for_status()
                result = response.json()

                if result.get('success'):
                    logger.info(f"Blind decode confidence: {result.get('confidence')}")
                    return result.get('vlm_analysis', {})
                return {}

        except Exception as e:
            logger.error(f"Blind decode failed: {e}")
            return {}

    async def get_vlm_explanation(
        self,
        image_url: str,
        user_role: str = "worker"
    ) -> str:
        """
        Get AI vision explanation of smartSKU for the user's role.

        the LLM uses this to provide natural language product descriptions
        tailored to who he's talking to.

        Args:
            image_url: URL or path to smartSKU image
            user_role: User's role (worker, manager, client, etc.)

        Returns:
            Natural language explanation of the product
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.smartsku_url}/api/v1/smartsku/analyze",
                    json={"image_url": image_url}
                )
                response.raise_for_status()
                result = response.json()

                if result.get('success'):
                    analysis = result.get('general_analysis', {}).get('analysis', '')

                    # Adapt explanation to user role
                    explanation = self._adapt_explanation_to_role(analysis, user_role)
                    return explanation
                return "I can see this smartSKU, but I'm having trouble analyzing it right now."

        except Exception as e:
            logger.error(f"VLM explanation failed: {e}")
            return "I'm having trouble reading this smartSKU right now. Let me try another way."

    async def identify_product_for_the LLM(
        self,
        image_url: str,
        user_role: str = "worker",
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Complete product identification with the LLM-optimized response.

        This is the main method the LLM uses to understand products.
        Returns everything the LLM needs to give helpful guidance.

        Args:
            image_url: URL or path to smartSKU image
            user_role: User's role for appropriate explanations
            context: Additional context (what are they trying to do?)

        Returns:
            Dictionary with:
            - product_data: Full product information
            - the LLM_summary: Natural language summary for the LLM to use
            - suggestions: Proactive suggestions based on product
            - warnings: Any warnings the LLM should mention
        """
        # Try VLM-enhanced decode first
        product_data = await self.decode_product(image_url, use_vlm=True)

        if not product_data:
            # Fallback to blind decode
            logger.info("Standard decode failed, attempting blind decode...")
            blind_result = await self.blind_decode(image_url)
            return {
                'product_data': {},
                'the LLM_summary': f"I can see this item, but I don't have complete data. {blind_result.get('extracted_data', '')}",
                'suggestions': ["Let me look this up in the system for you"],
                'warnings': ["Using AI vision fallback - data may be incomplete"],
                'confidence': blind_result.get('confidence', 'low')
            }

        # Generate the LLM-friendly summary
        summary = self._generate_the LLM_summary(product_data, user_role, context)

        # Generate proactive suggestions
        suggestions = self._generate_suggestions(product_data, context)

        # Check for warnings
        warnings = self._check_warnings(product_data)

        return {
            'product_data': product_data,
            'the LLM_summary': summary,
            'suggestions': suggestions,
            'warnings': warnings,
            'confidence': 'high',
            'vlm_available': '_vlm_validation' in product_data
        }

    def _adapt_explanation_to_role(self, raw_analysis: str, user_role: str) -> str:
        """Adapt VLM analysis to user's role"""
        # This is where we could enhance with role-specific language
        # For now, return the analysis as-is
        return raw_analysis

    def _generate_the LLM_summary(
        self,
        product_data: Dict[str, Any],
        user_role: str,
        context: Optional[str]
    ) -> str:
        """
        Generate natural language summary for the LLM to use.

        This is what the LLM will say to the user about the product.
        """
        sku = product_data.get('sku', 'Unknown')
        name = product_data.get('name', 'this item')

        if user_role == "worker":
            # Simple, action-oriented for workers
            summary = f"That's {name} (SKU: {sku})"

            if product_data.get('fragile'):
                summary += " - handle with care, it's fragile"

            location = product_data.get('warehouse_location')
            if location:
                summary += f". It goes in {location}"

            weight = product_data.get('weight')
            if weight:
                summary += f" (about {weight} lbs)"

        elif user_role == "manager":
            # Detailed, data-driven for managers
            dims = product_data.get('dimensions', {})
            summary = f"{name} (SKU: {sku})\n"
            summary += f"Category: {product_data.get('category', 'N/A')}\n"
            summary += f"Weight: {product_data.get('weight', 'N/A')} lbs | "
            summary += f"Dims: {dims.get('l')}×{dims.get('w')}×{dims.get('h')} in\n"
            summary += f"Location: {product_data.get('warehouse_location', 'Unassigned')}\n"
            summary += f"Origin: {product_data.get('origin', 'N/A')}"

        else:
            # Balanced for other roles
            summary = f"{name} (SKU: {sku})"

        return summary

    def _generate_suggestions(
        self,
        product_data: Dict[str, Any],
        context: Optional[str]
    ) -> List[str]:
        """Generate proactive suggestions based on product"""
        suggestions = []

        if product_data.get('fragile'):
            suggestions.append("Use bubble wrap and mark as fragile")

        if product_data.get('high_value'):
            suggestions.append("Consider signature required delivery")

        if product_data.get('hazmat'):
            suggestions.append("Check hazmat handling procedures")

        if not product_data.get('warehouse_location'):
            suggestions.append("This needs a storage location assigned")

        return suggestions

    def _check_warnings(self, product_data: Dict[str, Any]) -> List[str]:
        """Check for warnings the LLM should mention"""
        warnings = []

        if product_data.get('hazmat'):
            warnings.append("⚠️ Hazardous material - follow safety protocols")

        if product_data.get('fragile'):
            warnings.append("⚠️ Fragile - handle with care")

        if product_data.get('high_value'):
            warnings.append("🔒 High-value item - secure handling required")

        return warnings


# Synchronous wrapper for non-async contexts
class SmartSKUClientSync:
    """Synchronous wrapper for SmartSKUClient"""

    def __init__(self, *args, **kwargs):
        self.client = SmartSKUClient(*args, **kwargs)

    def identify_product_for_the LLM(self, image_url, user_role="worker", context=None):
        import asyncio
        return asyncio.run(
            self.client.identify_product_for_the LLM(image_url, user_role, context)
        )

    def decode_product(self, image_url, use_vlm=False):
        import asyncio
        return asyncio.run(self.client.decode_product(image_url, use_vlm))

    def health_check(self):
        import asyncio
        return asyncio.run(self.client.health_check())
