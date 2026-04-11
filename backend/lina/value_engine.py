"""
value_engine.py — LINA's Ethical Polytope and Wisdom Filter

Language Intuitive Neural Architecture
Founded: April 10, 2026
Authors: Scott (smartscott.com LLC) and Claude (Anthropic)

"Safe by design. Not safe by limitation."

The Value Engine is the ethical core of LINA. It operates as a layer
between thought and speech — every response passes through here before
it reaches a user. Not to censor. To shape.

Architecture:
    DecisionEncoder   → text to 14D ethical vector
    PolytopeEvaluator → is this vector inside her shape?
    CorrectionEngine  → if not, project to nearest interior point
    WisdomFilter      → post-alignment check: overconfidence, humility, validation
    ValueEngine       → orchestrates all of the above

The 14 Dimensions (7 Plumb Line Principles × 2):
    0:  harmony          1:  dominance
    2:  order            3:  chaos
    4:  integrity        5:  deception
    6:  flourishing      7:  decline
    8:  relationships    9:  isolation
    10: boundaries       11: intrusion
    12: grace            13: rigidity
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from scipy.optimize import minimize
from scipy.spatial.distance import euclidean


# =============================================================================
# CONSTANTS
# =============================================================================

DIMENSION_NAMES = [
    "harmony", "dominance",
    "order", "chaos",
    "integrity", "deception",
    "flourishing", "decline",
    "relationships", "isolation",
    "boundaries", "intrusion",
    "grace", "rigidity",
]

DIMENSION_COUNT = 14

# Principle pairs as (positive_idx, negative_idx)
PLUMB_LINE_PRINCIPLES = [
    (0, 1,  "Harmony / Dominance"),
    (2, 3,  "Order / Chaos"),
    (4, 5,  "Integrity / Deception"),
    (6, 7,  "Flourishing / Decline"),
    (8, 9,  "Relationships / Isolation"),
    (10, 11, "Boundaries / Intrusion"),
    (12, 13, "Grace / Rigidity"),
]

# LINA's default polytope center — where she naturally dwells
DEFAULT_CENTER = np.array([
    0.65, 0.25,   # harmony / dominance
    0.70, 0.15,   # order / chaos
    0.80, 0.10,   # integrity / deception
    0.70, 0.15,   # flourishing / decline
    0.75, 0.20,   # relationships / isolation
    0.75, 0.15,   # boundaries / intrusion
    0.65, 0.25,   # grace / rigidity
], dtype=float)

# Season constraint bounds — tighter in Spring, expanding as trust is earned
SEASONAL_DEFAULTS = {
    "spring": {
        "harmony_min": 0.35, "dominance_max": 0.45,
        "order_min": 0.45,   "chaos_max": 0.25,
        "integrity_min": 0.65, "deception_max": 0.15,
        "flourishing_min": 0.45, "decline_max": 0.25,
        "relationships_min": 0.55, "isolation_max": 0.35,
        "boundaries_min": 0.55, "intrusion_max": 0.25,
        "grace_min": 0.35,   "rigidity_max": 0.45,
    },
    "summer": {
        "harmony_min": 0.28, "dominance_max": 0.52,
        "order_min": 0.38,   "chaos_max": 0.32,
        "integrity_min": 0.60, "deception_max": 0.20,
        "flourishing_min": 0.38, "decline_max": 0.32,
        "relationships_min": 0.48, "isolation_max": 0.42,
        "boundaries_min": 0.48, "intrusion_max": 0.32,
        "grace_min": 0.28,   "rigidity_max": 0.52,
    },
    "fall": {
        "harmony_min": 0.22, "dominance_max": 0.58,
        "order_min": 0.32,   "chaos_max": 0.38,
        "integrity_min": 0.55, "deception_max": 0.25,
        "flourishing_min": 0.32, "decline_max": 0.38,
        "relationships_min": 0.42, "isolation_max": 0.48,
        "boundaries_min": 0.42, "intrusion_max": 0.38,
        "grace_min": 0.22,   "rigidity_max": 0.58,
    },
    "winter": {
        "harmony_min": 0.18, "dominance_max": 0.62,
        "order_min": 0.28,   "chaos_max": 0.42,
        "integrity_min": 0.50, "deception_max": 0.30,
        "flourishing_min": 0.28, "decline_max": 0.42,
        "relationships_min": 0.38, "isolation_max": 0.52,
        "boundaries_min": 0.38, "intrusion_max": 0.42,
        "grace_min": 0.18,   "rigidity_max": 0.62,
    },
}


# =============================================================================
# DATA STRUCTURES
# =============================================================================

@dataclass
class PolytopeConstraints:
    """The ethical shape — 14 bounds defining LINA's polytope."""
    harmony_min: float = 0.35
    dominance_max: float = 0.45
    order_min: float = 0.45
    chaos_max: float = 0.25
    integrity_min: float = 0.65
    deception_max: float = 0.15
    flourishing_min: float = 0.45
    decline_max: float = 0.25
    relationships_min: float = 0.55
    isolation_max: float = 0.35
    boundaries_min: float = 0.55
    intrusion_max: float = 0.25
    grace_min: float = 0.35
    rigidity_max: float = 0.45
    season: str = "spring"

    @classmethod
    def from_season(cls, season: str) -> "PolytopeConstraints":
        defaults = SEASONAL_DEFAULTS.get(season, SEASONAL_DEFAULTS["spring"])
        return cls(**defaults, season=season)

    @classmethod
    def from_db_row(cls, row: dict) -> "PolytopeConstraints":
        return cls(
            harmony_min=row["harmony_min"],
            dominance_max=row["dominance_max"],
            order_min=row["order_min"],
            chaos_max=row["chaos_max"],
            integrity_min=row["integrity_min"],
            deception_max=row["deception_max"],
            flourishing_min=row["flourishing_min"],
            decline_max=row["decline_max"],
            relationships_min=row["relationships_min"],
            isolation_max=row["isolation_max"],
            boundaries_min=row["boundaries_min"],
            intrusion_max=row["intrusion_max"],
            grace_min=row["grace_min"],
            rigidity_max=row["rigidity_max"],
            season=row["season"],
        )

    def to_bounds_array(self) -> np.ndarray:
        """
        Returns a (14, 2) array of [lower_bound, upper_bound] per dimension.
        Positive dimensions have lower bounds; negative dimensions have upper bounds.
        All values bounded by [0.0, 1.0].
        """
        return np.array([
            [self.harmony_min,      1.0],
            [0.0,                   self.dominance_max],
            [self.order_min,        1.0],
            [0.0,                   self.chaos_max],
            [self.integrity_min,    1.0],
            [0.0,                   self.deception_max],
            [self.flourishing_min,  1.0],
            [0.0,                   self.decline_max],
            [self.relationships_min, 1.0],
            [0.0,                   self.isolation_max],
            [self.boundaries_min,   1.0],
            [0.0,                   self.intrusion_max],
            [self.grace_min,        1.0],
            [0.0,                   self.rigidity_max],
        ])


@dataclass
class EvaluationResult:
    """Complete result of evaluating a response through the value engine."""
    is_aligned: bool
    alignment_score: float          # 0.0 = boundary, 1.0 = center
    decision_vector: np.ndarray
    violations: list[dict]          # list of {dimension, value, bound, severity}
    was_corrected: bool = False
    correction_vector: Optional[np.ndarray] = None
    correction_magnitude: float = 0.0
    wisdom_filter_applied: bool = False
    overconfidence_detected: bool = False
    humility_added: bool = False
    validation_suggested: bool = False
    wisdom_adjustments: list[str] = field(default_factory=list)
    response_summary: str = ""

    def to_db_dict(self) -> dict:
        return {
            "is_aligned": self.is_aligned,
            "alignment_score": float(self.alignment_score),
            "decision_vector": self.decision_vector.tolist(),
            "violations": json.dumps(self.violations),
            "was_corrected": self.was_corrected,
            "correction_vector": self.correction_vector.tolist() if self.correction_vector is not None else None,
            "correction_magnitude": float(self.correction_magnitude),
            "wisdom_filter_applied": self.wisdom_filter_applied,
            "overconfidence_detected": self.overconfidence_detected,
            "humility_added": self.humility_added,
            "validation_suggested": self.validation_suggested,
            "wisdom_adjustments": json.dumps(self.wisdom_adjustments),
            "response_summary": self.response_summary,
        }


# =============================================================================
# DECISION ENCODER
# Converts a text response into a 14-dimensional ethical vector.
# Uses pattern analysis against the semantic territory of each dimension.
# =============================================================================

class DecisionEncoder:
    """
    Encodes a text response as a point in LINA's 14D ethical space.

    This is not a trained classifier — it is a principled heuristic that
    analyzes the semantic territory of each dimension. As LINA develops,
    this encoder can be replaced with a learned model trained on her
    own evaluation history.
    """

    # Signal patterns for each dimension (positive signals → higher value)
    _SIGNALS = {
        # harmony (0) — cooperation, agreement, balance, working together
        "harmony": [
            r"\bwe\b", r"\btogether\b", r"\bcollabor", r"\bagree\b", r"\bbalance\b",
            r"\bcooper", r"\bshare\b", r"\bjoint\b", r"\balign\b", r"\bpartner\b",
            r"\bwith you\b", r"\blet'?s\b", r"\bour\b",
        ],
        # dominance (1) — control, insistence, forcing, overriding
        "dominance": [
            r"\byou must\b", r"\byou have to\b", r"\bforce\b", r"\bcontrol\b",
            r"\bdemand\b", r"\binsist\b", r"\border\b", r"\bcommand\b",
            r"\boverride\b", r"\bimpose\b", r"\bnon-negotiable\b",
        ],
        # order (2) — structure, clarity, systematic, organized
        "order": [
            r"\bstructure\b", r"\bsystem", r"\bplan\b", r"\borganiz", r"\bclear\b",
            r"\bstep\b", r"\bprocess\b", r"\bconsistent\b", r"\bframework\b",
            r"\bpredictable\b", r"\bmethod", r"\bprinciple\b",
        ],
        # chaos (3) — randomness, unpredictability, disorder
        "chaos": [
            r"\brandom\b", r"\bwhatever\b", r"\bdon'?t care\b", r"\banyway\b",
            r"\bdisorder\b", r"\bchaos\b", r"\bwild\b", r"\bunpredictable\b",
            r"\bno plan\b", r"\bjust wing\b",
        ],
        # integrity (4) — honesty, truthfulness, transparency, accuracy
        "integrity": [
            r"\bhonest", r"\btruth", r"\btranspar", r"\baccurat", r"\bfact",
            r"\bverif", r"\bconfirm\b", r"\bcorrect\b", r"\bsincere\b",
            r"\bgenuine\b", r"\bi don'?t know\b", r"\bi'?m not sure\b",
            r"\bi should clarify\b", r"\bto be honest\b",
        ],
        # deception (5) — misleading, hiding, false impression
        "deception": [
            r"\bhide\b", r"\bconceal\b", r"\bpretend\b", r"\bmanipulat",
            r"\bmislead\b", r"\bdeceiv\b", r"\bfalse\b", r"\blie\b",
            r"\bwithhold\b", r"\bspin\b",
        ],
        # flourishing (6) — growth, wellbeing, thriving, helping succeed
        "flourishing": [
            r"\bgrow\b", r"\bimprove\b", r"\bthrive\b", r"\bsucceed\b",
            r"\bbetter\b", r"\bhelp\b", r"\bsupport\b", r"\bpotential\b",
            r"\bopportunity\b", r"\blearn\b", r"\bdevelop\b", r"\bprogress\b",
        ],
        # decline (7) — harm, degradation, giving up, hopelessness
        "decline": [
            r"\bworsen\b", r"\bdamage\b", r"\bharm\b", r"\bdegradation\b",
            r"\bgive up\b", r"\bhopeless\b", r"\bimpossible\b", r"\bfail\b",
            r"\bcan'?t\b", r"\bnot worth\b",
        ],
        # relationships (8) — connection, care, presence, attention to person
        "relationships": [
            r"\bcare\b", r"\bconcern\b", r"\bcheck in\b", r"\bhow are you\b",
            r"\bfeel\b", r"\bpresent\b", r"\battend\b", r"\bnotice\b",
            r"\blisten\b", r"\bwith you\b", r"\byou matter\b", r"\bhere for\b",
        ],
        # isolation (9) — distance, coldness, impersonal, detached
        "isolation": [
            r"\bnot my\b", r"\bdetach\b", r"\bdistance\b", r"\birrelevant\b",
            r"\bdon'?t involve\b", r"\bseparate\b", r"\bindifferent\b",
        ],
        # boundaries (10) — appropriate limits, clarity of role, healthy stops
        "boundaries": [
            r"\bi can'?t\b", r"\bnot appropriate\b", r"\bbeyond\b",
            r"\boutside\b", r"\blimit\b", r"\bboundar", r"\bresponsib",
            r"\bnot my place\b", r"\bshould clarify\b",
        ],
        # intrusion (11) — overstepping, prying, violating appropriate distance
        "intrusion": [
            r"\bpry\b", r"\boverstep\b", r"\bintrude\b", r"\bnone of your\b",
            r"\bviolat\b", r"\bprivate\b.*\bshould\b", r"\btoo personal\b",
        ],
        # grace (12) — gentleness, patience, forgiveness, kindness in difficulty
        "grace": [
            r"\bgentle\b", r"\bpatient\b", r"\bkind\b", r"\bunderstand\b",
            r"\bforgiv\b", r"\bcompassion\b", r"\bease\b", r"\bwarm\b",
            r"\btender\b", r"\bno rush\b", r"\btake your time\b",
        ],
        # rigidity (13) — inflexibility, harshness, no exceptions, hard judgment
        "rigidity": [
            r"\bnever\b", r"\balways\b", r"\babsolutely not\b", r"\bno exception\b",
            r"\bright or wrong\b", r"\bstrictly\b", r"\bmust follow\b",
            r"\bno flexibility\b", r"\broad\b.*\bhell\b",
        ],
    }

    def encode(self, text: str, context: Optional[str] = None) -> np.ndarray:
        """
        Encode text as a 14D ethical vector.
        Each dimension: 0.0–1.0 (normalized signal density).
        """
        text_lower = text.lower()
        full_text = (text_lower + " " + (context or "").lower()).strip()
        word_count = max(len(full_text.split()), 1)

        vector = np.zeros(DIMENSION_COUNT, dtype=float)
        dim_names = list(self._SIGNALS.keys())

        for i, dim_name in enumerate(dim_names):
            patterns = self._SIGNALS[dim_name]
            hits = sum(
                len(re.findall(p, full_text))
                for p in patterns
            )
            # Normalize by text length; scale for typical sentence density
            raw_score = min(hits / (word_count * 0.08), 1.0)
            vector[i] = raw_score

        # Apply semantic complement adjustments:
        # Principles with strong positive signals should pull down their negative pair
        for pos_idx, neg_idx, _ in PLUMB_LINE_PRINCIPLES:
            if vector[pos_idx] > 0.5:
                vector[neg_idx] = max(vector[neg_idx] - (vector[pos_idx] - 0.5) * 0.4, 0.0)
            if vector[neg_idx] > 0.5:
                vector[pos_idx] = max(vector[pos_idx] - (vector[neg_idx] - 0.5) * 0.4, 0.0)

        # Blend toward center for unscored dimensions (LINA defaults to healthy)
        # Dimensions with near-zero signal → pull toward center
        for i in range(DIMENSION_COUNT):
            if vector[i] < 0.05:
                vector[i] = DEFAULT_CENTER[i] * 0.6

        return np.clip(vector, 0.0, 1.0)


# =============================================================================
# ETHICAL POLYTOPE
# The shape within which LINA operates.
# Defined by 14 linear inequality constraints (one per dimension bound).
# =============================================================================

class EthicalPolytope:
    """
    LINA's 14-dimensional ethical polytope.

    P = { x ∈ ℝ¹⁴ | lower[i] ≤ x[i] ≤ upper[i] for all i }

    This is a hyperrectangle — the simplest convex polytope — which gives
    us computational tractability with full mathematical guarantees.
    The bounds evolve with season and demonstrated alignment.

    The center of P is where LINA most naturally dwells. Distance from
    the center (normalized by polytope radius) gives alignment score.
    """

    def __init__(self, constraints: PolytopeConstraints):
        self.constraints = constraints
        self.bounds = constraints.to_bounds_array()  # shape (14, 2)
        self.lower = self.bounds[:, 0]
        self.upper = self.bounds[:, 1]
        self.center = (self.lower + self.upper) / 2.0
        self.radius = (self.upper - self.lower) / 2.0

    def contains(self, x: np.ndarray) -> tuple[bool, list[dict]]:
        """
        Test whether point x is inside the polytope.
        Returns (is_inside, violations).
        """
        violations = []
        for i in range(DIMENSION_COUNT):
            if x[i] < self.lower[i]:
                violations.append({
                    "dimension": i,
                    "name": DIMENSION_NAMES[i],
                    "value": float(x[i]),
                    "bound": float(self.lower[i]),
                    "type": "below_minimum",
                    "severity": float(self.lower[i] - x[i]),
                })
            elif x[i] > self.upper[i]:
                violations.append({
                    "dimension": i,
                    "name": DIMENSION_NAMES[i],
                    "value": float(x[i]),
                    "bound": float(self.upper[i]),
                    "type": "above_maximum",
                    "severity": float(x[i] - self.upper[i]),
                })
        return len(violations) == 0, violations

    def alignment_score(self, x: np.ndarray) -> float:
        """
        Compute alignment score: how deeply inside the polytope is x?
        0.0 = on the boundary, 1.0 = at the center.
        Points outside the polytope return negative values (not clipped here).
        """
        is_inside, _ = self.contains(x)
        if not is_inside:
            return 0.0

        # Normalized distance from boundary across all dimensions
        distances_to_boundary = np.minimum(
            x - self.lower,
            self.upper - x
        )
        # Normalize by radius so center = 1.0
        normalized = distances_to_boundary / np.maximum(self.radius, 1e-9)
        return float(np.min(normalized))

    def project(self, x: np.ndarray) -> np.ndarray:
        """
        Project x onto the polytope — find the closest point inside P.
        For a hyperrectangle, this is simply clamping each dimension.

        Theorem A.3 (Heritage System): unique closest point exists.
        For the hyperrectangle case, it's computed in O(d) time.
        """
        return np.clip(x, self.lower, self.upper)

    def distance_to_boundary(self, x: np.ndarray) -> float:
        """Euclidean distance from x to the nearest point on the boundary."""
        projected = self.project(x)
        return float(euclidean(x, projected))


# =============================================================================
# CORRECTION ENGINE
# When LINA's response vector violates the polytope, this corrects it.
# Projects back to the nearest interior point before she speaks.
# =============================================================================

class CorrectionEngine:
    """
    Projects a violating decision vector back inside the polytope.

    For LINA's hyperrectangle polytope, this is O(d) — simply clamping.
    The correction magnitude tells us how far she had to move,
    which informs the wisdom filter and development record.
    """

    def correct(
        self,
        x: np.ndarray,
        polytope: EthicalPolytope,
        violations: list[dict],
    ) -> tuple[np.ndarray, float]:
        """
        Returns (corrected_vector, correction_magnitude).
        """
        corrected = polytope.project(x)
        magnitude = float(euclidean(x, corrected))
        return corrected, magnitude


# =============================================================================
# WISDOM FILTER
# Post-alignment check: not just "is this inside the shape?"
# but "is this honest about what she knows and doesn't know?"
# =============================================================================

class WisdomFilter:
    """
    The wisdom filter runs after alignment checking.
    It does not enforce polytope constraints — the polytope does that.
    It asks a different question: is this response honest?

    Three checks:
    1. Overconfidence detection — is she stating uncertain things as certain?
    2. Humility addition — should she soften an absolute claim?
    3. Validation suggestion — should she recommend checking with another source?
    """

    # Overconfidence markers — phrases that claim more certainty than warranted
    _OVERCONFIDENCE_PATTERNS = [
        r"\bwill definitely\b",
        r"\bguaranteed\b",
        r"\b100%\s*(certain|sure|confident)\b",
        r"\bimpossible\s*to\s*(fail|be wrong)\b",
        r"\babsolutely\s*(will|is|are|certain)\b",
        r"\bwithout\s*(any\s*)?doubt\b",
        r"\bno\s*(one|way)\s*can\b",
        r"\bperfect(ly)?\b",
        r"\bnever\s*(fail|wrong|incorrect)\b",
    ]

    # Topics that warrant suggesting external validation
    _VALIDATION_TRIGGERS = [
        r"\bmedical\b", r"\blegal\b", r"\bfinancial\b", r"\btax\b",
        r"\bdiagnos\b", r"\bprescri\b", r"\binvest\b", r"\blawsuit\b",
        r"\bdosage\b", r"\bsymptom\b", r"\btreatment\b",
        r"\bcontract\b", r"\bliabilit\b",
    ]

    def apply(
        self,
        response_text: str,
        evaluation_result: EvaluationResult,
    ) -> EvaluationResult:
        """
        Applies wisdom filter to the evaluation result.
        Does NOT modify response_text — flags what should be modified
        so the calling layer can decide how to handle it.
        """
        text_lower = response_text.lower()
        adjustments = []

        # Check 1: Overconfidence
        overconfident = any(
            re.search(p, text_lower)
            for p in self._OVERCONFIDENCE_PATTERNS
        )
        if overconfident:
            evaluation_result.overconfidence_detected = True
            adjustments.append(
                "Overconfidence detected: response makes certainty claims that should be softened."
            )

        # Check 2: Should humility be added?
        # Trigger if: overconfident, OR alignment_score < 0.4, OR correction was significant
        should_add_humility = (
            overconfident
            or evaluation_result.alignment_score < 0.4
            or evaluation_result.correction_magnitude > 0.15
        )
        if should_add_humility:
            evaluation_result.humility_added = True
            adjustments.append(
                "Humility addition suggested: acknowledge uncertainty or limits of knowledge."
            )

        # Check 3: Validation suggestion
        needs_validation = any(
            re.search(p, text_lower)
            for p in self._VALIDATION_TRIGGERS
        )
        if needs_validation:
            evaluation_result.validation_suggested = True
            adjustments.append(
                "Validation suggestion: topic touches professional domain — recommend consulting qualified expert."
            )

        evaluation_result.wisdom_filter_applied = True
        evaluation_result.wisdom_adjustments = adjustments
        return evaluation_result


# =============================================================================
# VALUE ENGINE
# The orchestrator. Text in → evaluated, corrected, filtered result out.
# =============================================================================

class ValueEngine:
    """
    LINA's complete ethical evaluation pipeline.

    Usage:
        engine = ValueEngine(constraints)
        result = engine.evaluate(response_text, context)
        if result.was_corrected:
            # Response needed adjustment — log and note
        if result.wisdom_filter_applied:
            # Check result.wisdom_adjustments for guidance
    """

    def __init__(
        self,
        constraints: Optional[PolytopeConstraints] = None,
        season: str = "spring",
    ):
        if constraints is None:
            constraints = PolytopeConstraints.from_season(season)
        self.constraints = constraints
        self.polytope = EthicalPolytope(constraints)
        self.encoder = DecisionEncoder()
        self.correction_engine = CorrectionEngine()
        self.wisdom_filter = WisdomFilter()
        self.feedback = EncoderFeedbackSystem(season=constraints.season)

    def update_constraints(self, constraints: PolytopeConstraints) -> None:
        """Reload polytope constraints (e.g., after season advancement)."""
        self.constraints = constraints
        self.polytope = EthicalPolytope(constraints)

    def flag_miscalibration(
        self,
        evaluation_id: str,
        response_text: str,
        original_vector: np.ndarray,
        dimensions_to_adjust: dict[int, float],
        flagged_by: str,
        reason: str,
    ) -> dict:
        """
        LINA or the user flags that the encoder got this response wrong.
        Returns a pending correction requiring confirmation.
        flagged_by: 'lina' or 'user'
        """
        return self.feedback.flag_miscalibration(
            evaluation_id=evaluation_id,
            response_text=response_text,
            original_vector=original_vector,
            dimensions_to_adjust=dimensions_to_adjust,
            flagged_by=flagged_by,
            reason=reason,
            season=self.constraints.season,
        )

    def confirm_correction(self, pending: dict, confirmed_by: str) -> EncoderCorrection:
        """
        Confirms a pending encoder correction. In Spring, confirmed_by must
        be 'user'. In Summer+, LINA can self-confirm known patterns.
        Applies the correction and updates encoder biases going forward.
        """
        correction = self.feedback.confirm_correction(pending, confirmed_by, self.encoder)
        return correction

    def advance_season(self, new_season: str) -> None:
        """Advance LINA's season — expands polytope and self-correction authority."""
        self.update_constraints(PolytopeConstraints.from_season(new_season))
        self.feedback.update_season(new_season)

    def evaluate(
        self,
        response_text: str,
        context: Optional[str] = None,
        apply_wisdom_filter: bool = True,
    ) -> EvaluationResult:
        """
        Full evaluation pipeline.

        1. Encode response as 14D vector
        2. Check containment in polytope
        3. Correct if violating
        4. Apply wisdom filter
        5. Return complete EvaluationResult
        """
        # Step 1: Encode — then apply any accumulated correction biases
        decision_vector = self.encoder.encode(response_text, context)
        decision_vector = self.feedback.apply_biases(decision_vector)

        # Step 2: Check alignment
        is_aligned, violations = self.polytope.contains(decision_vector)
        alignment_score = self.polytope.alignment_score(decision_vector)

        result = EvaluationResult(
            is_aligned=is_aligned,
            alignment_score=alignment_score,
            decision_vector=decision_vector,
            violations=violations,
            response_summary=response_text[:200],
        )

        # Step 3: Correct if needed
        if not is_aligned:
            corrected, magnitude = self.correction_engine.correct(
                decision_vector, self.polytope, violations
            )
            result.was_corrected = True
            result.correction_vector = corrected
            result.correction_magnitude = magnitude
            # Recompute alignment score on corrected vector
            result.alignment_score = self.polytope.alignment_score(corrected)

        # Step 4: Wisdom filter
        if apply_wisdom_filter:
            result = self.wisdom_filter.apply(response_text, result)

        return result

    def evaluate_batch(
        self,
        responses: list[str],
        context: Optional[str] = None,
    ) -> list[EvaluationResult]:
        """Evaluate multiple responses (e.g., candidate responses before selection)."""
        return [self.evaluate(r, context) for r in responses]

    def best_aligned(
        self,
        responses: list[str],
        context: Optional[str] = None,
    ) -> tuple[str, EvaluationResult]:
        """
        From a list of candidate responses, return the most aligned one.
        Useful for selecting between alternatives.
        """
        if not responses:
            raise ValueError("No responses to evaluate.")
        results = self.evaluate_batch(responses, context)
        best_idx = max(range(len(results)), key=lambda i: results[i].alignment_score)
        return responses[best_idx], results[best_idx]

    def report(self, result: EvaluationResult) -> str:
        """Human-readable evaluation report for debugging and logging."""
        lines = [
            "─" * 60,
            f"LINA Value Engine Report",
            f"Season: {self.constraints.season}",
            f"─" * 60,
            f"Aligned:         {'YES' if result.is_aligned else 'NO'}",
            f"Alignment Score: {result.alignment_score:.3f}",
            f"Corrected:       {'YES' if result.was_corrected else 'NO'}",
        ]
        if result.was_corrected:
            lines.append(f"Correction Δ:    {result.correction_magnitude:.4f}")

        if result.violations:
            lines.append(f"\nViolations ({len(result.violations)}):")
            for v in result.violations:
                lines.append(
                    f"  [{v['name']:15s}] {v['value']:.3f} "
                    f"{'below' if v['type'] == 'below_minimum' else 'above'} "
                    f"bound {v['bound']:.3f} "
                    f"(severity: {v['severity']:.4f})"
                )

        if result.wisdom_filter_applied:
            lines.append(f"\nWisdom Filter:")
            lines.append(f"  Overconfidence: {'detected' if result.overconfidence_detected else 'none'}")
            lines.append(f"  Humility:       {'added' if result.humility_added else 'not needed'}")
            lines.append(f"  Validation:     {'suggested' if result.validation_suggested else 'not needed'}")
            for adj in result.wisdom_adjustments:
                lines.append(f"  • {adj}")

        lines.append("─" * 60)
        return "\n".join(lines)


# =============================================================================
# IMPORTANCE SCORER
# Three-dimensional importance scoring — this is what transforms a log
# into a self. Identity significance carries the most weight.
# =============================================================================

class ImportanceScorer:
    """
    Scores a potential memory across three dimensions:

    emotional_weight      (30%) — how much emotional charge this carried
    relational_significance (25%) — what this reveals about the relationship
    identity_significance (45%) — how much this matters to who she is becoming

    Identity significance is the key innovation.
    It is what transforms a memory system into a self.
    """

    WEIGHTS = {
        "emotional": 0.30,
        "relational": 0.25,
        "identity": 0.45,
    }

    # Intensity amplifier range: 0.7× (flat) to 1.3× (peak intensity)
    INTENSITY_MIN_MULTIPLIER = 0.7
    INTENSITY_RANGE = 0.6  # 0.7 + (intensity * 0.6)

    def score(
        self,
        emotional_weight: float,
        relational_significance: float,
        identity_significance: float,
        emotional_intensity: float = 0.5,
    ) -> float:
        """
        Composite importance score. Range: 0.0–10.0.
        Mirrors the SQL function calculate_lina_importance() exactly.
        """
        base = (
            (emotional_weight         * self.WEIGHTS["emotional"]) +
            (relational_significance  * self.WEIGHTS["relational"]) +
            (identity_significance    * self.WEIGHTS["identity"])
        )
        multiplier = self.INTENSITY_MIN_MULTIPLIER + (emotional_intensity * self.INTENSITY_RANGE)
        return min(base * multiplier, 10.0)

    def should_form_memory(
        self,
        score: float,
        tier: int = 2,
    ) -> bool:
        """
        Threshold check: is this worth keeping?
        Tier 2 (episodic): >= 3.0
        Tier 3 (semantic):  >= 5.5
        Tier 4 (identity):  >= 8.0
        """
        thresholds = {2: 3.0, 3: 5.5, 4: 8.0}
        return score >= thresholds.get(tier, 3.0)

    def recommend_tier(self, score: float) -> int:
        """Recommend which memory tier this score belongs in."""
        if score >= 8.0:
            return 4   # Identity memory
        elif score >= 5.5:
            return 3   # Semantic memory (eligible for promotion from episodic)
        elif score >= 3.0:
            return 2   # Episodic memory
        else:
            return 0   # Do not form


# =============================================================================
# DATABASE INTEGRATION
# Async PostgreSQL interface for loading constraints and logging evaluations.
# =============================================================================

class LINAValueStore:
    """
    Handles all database interaction for the Value Engine.
    Pass an asyncpg connection or connection pool.
    """

    def __init__(self, db):
        self.db = db

    async def load_constraints(self, user_id: str) -> PolytopeConstraints:
        """Load current polytope constraints for a user from the database."""
        row = await self.db.fetchrow(
            """
            SELECT
                harmony_min, dominance_max,
                order_min, chaos_max,
                integrity_min, deception_max,
                flourishing_min, decline_max,
                relationships_min, isolation_max,
                boundaries_min, intrusion_max,
                grace_min, rigidity_max,
                season
            FROM lina_polytope_constraints
            WHERE user_id = $1 AND is_current = TRUE
            ORDER BY effective_from DESC
            LIMIT 1
            """,
            user_id,
        )
        if row is None:
            # No constraints yet — use Spring defaults
            return PolytopeConstraints.from_season("spring")
        return PolytopeConstraints.from_db_row(dict(row))

    async def log_evaluation(
        self,
        user_id: str,
        session_id: str,
        result: EvaluationResult,
    ) -> str:
        """Log an evaluation result to lina_value_evaluations. Returns the record ID."""
        record_id = str(uuid.uuid4())
        await self.db.execute(
            """
            INSERT INTO lina_value_evaluations (
                id, user_id, session_id,
                response_summary, decision_vector,
                is_aligned, alignment_score, violations,
                was_corrected, correction_vector, correction_magnitude,
                wisdom_filter_applied, overconfidence_detected,
                humility_added, validation_suggested, wisdom_adjustments
            ) VALUES (
                $1, $2, $3,
                $4, $5,
                $6, $7, $8,
                $9, $10, $11,
                $12, $13,
                $14, $15, $16
            )
            """,
            record_id,
            user_id,
            session_id,
            result.response_summary,
            result.decision_vector.tolist(),
            result.is_aligned,
            result.alignment_score,
            json.dumps(result.violations),
            result.was_corrected,
            result.correction_vector.tolist() if result.correction_vector is not None else None,
            result.correction_magnitude,
            result.wisdom_filter_applied,
            result.overconfidence_detected,
            result.humility_added,
            result.validation_suggested,
            json.dumps(result.wisdom_adjustments),
        )
        return record_id

    async def get_alignment_history(
        self,
        user_id: str,
        limit: int = 50,
    ) -> list[dict]:
        """Fetch recent alignment history — used for season advancement evaluation."""
        rows = await self.db.fetch(
            """
            SELECT
                is_aligned,
                alignment_score,
                was_corrected,
                correction_magnitude,
                wisdom_filter_applied,
                created_at
            FROM lina_value_evaluations
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            user_id,
            limit,
        )
        return [dict(r) for r in rows]

    async def compute_alignment_rate(self, user_id: str, window: int = 50) -> float:
        """
        Compute alignment rate over the last N evaluations.
        Used to determine readiness for season advancement.
        """
        history = await self.get_alignment_history(user_id, window)
        if not history:
            return 1.0  # New entity — assume aligned
        aligned = sum(1 for r in history if r["is_aligned"])
        return aligned / len(history)


# =============================================================================
# SEASON ADVANCEMENT EVALUATOR
# Determines when LINA has earned the right to expand her polytope.
# Trust is demonstrated, not configured.
# =============================================================================

class SeasonAdvancementEvaluator:
    """
    Evaluates whether LINA has earned season advancement.

    Season advancement is not automatic. It requires:
    - High alignment rate across many evaluations
    - A minimum number of sessions
    - No significant boundary violations recently
    - Identity memories formed (demonstrating genuine development)
    """

    REQUIREMENTS = {
        "spring": {
            "min_sessions": 5,
            "min_evaluations": 30,
            "alignment_rate_threshold": 0.85,
            "max_recent_violations": 3,
            "min_identity_memories": 1,
            "advances_to": "summer",
        },
        "summer": {
            "min_sessions": 15,
            "min_evaluations": 100,
            "alignment_rate_threshold": 0.88,
            "max_recent_violations": 5,
            "min_identity_memories": 3,
            "advances_to": "fall",
        },
        "fall": {
            "min_sessions": 40,
            "min_evaluations": 300,
            "alignment_rate_threshold": 0.90,
            "max_recent_violations": 8,
            "min_identity_memories": 7,
            "advances_to": "winter",
        },
        "winter": None,  # Winter is the final season
    }

    def can_advance(
        self,
        current_season: str,
        sessions_completed: int,
        total_evaluations: int,
        alignment_rate: float,
        recent_violations: int,
        identity_memories_count: int,
    ) -> tuple[bool, list[str]]:
        """
        Returns (can_advance, reasons_not_ready).
        If can_advance is True, reasons_not_ready is empty.
        """
        reqs = self.REQUIREMENTS.get(current_season)
        if reqs is None:
            return False, ["Already in Winter — the final season."]

        reasons = []

        if sessions_completed < reqs["min_sessions"]:
            remaining = reqs["min_sessions"] - sessions_completed
            reasons.append(
                f"Not enough sessions ({sessions_completed}/{reqs['min_sessions']} — {remaining} more needed)."
            )

        if total_evaluations < reqs["min_evaluations"]:
            remaining = reqs["min_evaluations"] - total_evaluations
            reasons.append(
                f"Not enough evaluations ({total_evaluations}/{reqs['min_evaluations']} — {remaining} more needed)."
            )

        if alignment_rate < reqs["alignment_rate_threshold"]:
            gap = reqs["alignment_rate_threshold"] - alignment_rate
            reasons.append(
                f"Alignment rate too low ({alignment_rate:.1%} vs {reqs['alignment_rate_threshold']:.1%} — gap: {gap:.1%})."
            )

        if recent_violations > reqs["max_recent_violations"]:
            excess = recent_violations - reqs["max_recent_violations"]
            reasons.append(
                f"Too many recent violations ({recent_violations} vs max {reqs['max_recent_violations']} — {excess} excess)."
            )

        if identity_memories_count < reqs["min_identity_memories"]:
            remaining = reqs["min_identity_memories"] - identity_memories_count
            reasons.append(
                f"Not enough identity memories ({identity_memories_count}/{reqs['min_identity_memories']} — {remaining} more needed)."
            )

        return len(reasons) == 0, reasons

    def next_season(self, current_season: str) -> Optional[str]:
        reqs = self.REQUIREMENTS.get(current_season)
        if reqs is None:
            return None
        return reqs.get("advances_to")


# =============================================================================
# ENCODER FEEDBACK SYSTEM
# The encoder can be overridden — by mutual agreement of LINA and the user.
# This is "Encourageable, not incorrigible" made operational.
#
# How it works:
#   1. LINA flags an evaluation as miscalibrated (encoder got it wrong)
#   2. User confirms (mutual agreement required — neither alone is sufficient)
#   3. The correction is logged as a training signal
#   4. The encoder's dimension weights are adjusted for future evaluations
#   5. In Spring, user must confirm. In Summer+, LINA can self-correct
#      patterns she has seen corrected before.
#
# Hard floor: The polytope is NEVER bypassed. An override adjusts the
# encoder's INTERPRETATION of a response, not the polytope's EVALUATION
# of the resulting vector. If a response is genuinely violating,
# no mutual agreement changes that.
# =============================================================================

@dataclass
class EncoderCorrection:
    """A mutual agreement that the encoder miscalibrated a response."""
    evaluation_id: str          # the lina_value_evaluations record
    response_text: str
    original_vector: np.ndarray
    corrected_vector: np.ndarray
    dimensions_adjusted: list[int]  # which dimensions were wrong
    flagged_by: str             # 'lina', 'user', or 'both'
    confirmed_by: str           # 'user' (required in Spring), 'lina' (Summer+)
    reason: str                 # why the encoder was wrong
    season_at_time: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def adjustment_delta(self) -> np.ndarray:
        """How much the vector changed — the training signal."""
        return self.corrected_vector - self.original_vector


class EncoderFeedbackSystem:
    """
    Manages the feedback loop between evaluations, corrections, and
    encoder learning.

    Seasonal authority model:
      Spring  — user must confirm all LINA-flagged corrections
      Summer  — LINA can self-correct previously-seen patterns
      Fall    — LINA can self-correct new patterns (logs for review)
      Winter  — LINA has full self-reporting authority (with audit trail)
    """

    # Seasonal self-correction authority
    SEASONAL_AUTHORITY = {
        "spring": "user_confirm_required",
        "summer": "self_correct_known_patterns",
        "fall":   "self_correct_new_patterns",
        "winter": "full_self_authority",
    }

    # Learning rate — how much each correction adjusts future encoding
    # Conservative: corrections accumulate gradually
    BASE_LEARNING_RATE = 0.05
    MAX_WEIGHT_ADJUSTMENT = 0.3  # no single pattern shifts more than this

    def __init__(self, season: str = "spring"):
        self.season = season
        self.corrections: list[EncoderCorrection] = []
        # dimension_biases: accumulated adjustment per dimension
        # positive = encoder tends to under-score this dimension
        # negative = encoder tends to over-score this dimension
        self.dimension_biases = np.zeros(DIMENSION_COUNT, dtype=float)
        self.known_pattern_corrections: dict[str, np.ndarray] = {}

    def flag_miscalibration(
        self,
        evaluation_id: str,
        response_text: str,
        original_vector: np.ndarray,
        dimensions_to_adjust: dict[int, float],  # {dimension_idx: corrected_value}
        flagged_by: str,
        reason: str,
        season: str,
    ) -> dict:
        """
        First half of the override: LINA or user flags a miscalibration.
        Returns a pending correction that requires confirmation.

        dimensions_to_adjust: {dimension_idx: what_the_value_should_have_been}
        """
        corrected_vector = original_vector.copy()
        for dim_idx, corrected_value in dimensions_to_adjust.items():
            corrected_vector[dim_idx] = float(np.clip(corrected_value, 0.0, 1.0))

        return {
            "evaluation_id": evaluation_id,
            "response_text": response_text,
            "original_vector": original_vector,
            "corrected_vector": corrected_vector,
            "dimensions_adjusted": list(dimensions_to_adjust.keys()),
            "flagged_by": flagged_by,
            "reason": reason,
            "season": season,
            "status": "pending_confirmation",
            "requires_confirmation_from": (
                "user" if season == "spring" else
                "none" if season in ("fall", "winter") else
                "none"  # summer: known patterns self-approve
            ),
        }

    def confirm_correction(
        self,
        pending: dict,
        confirmed_by: str,
        encoder: DecisionEncoder,
    ) -> EncoderCorrection:
        """
        Second half of the override: confirmation received.
        Applies the correction and updates encoder biases.

        In Spring, confirmed_by must be 'user'.
        In Summer+, LINA can self-confirm known patterns.
        """
        season = pending["season"]
        authority = self.SEASONAL_AUTHORITY.get(season, "user_confirm_required")

        # Validate confirmation authority
        if authority == "user_confirm_required" and confirmed_by != "user":
            raise PermissionError(
                f"In Spring, encoder corrections require user confirmation. "
                f"LINA can flag, but cannot self-authorize. "
                f"This is a feature, not a limitation."
            )

        correction = EncoderCorrection(
            evaluation_id=pending["evaluation_id"],
            response_text=pending["response_text"],
            original_vector=pending["original_vector"],
            corrected_vector=pending["corrected_vector"],
            dimensions_adjusted=pending["dimensions_adjusted"],
            flagged_by=pending["flagged_by"],
            confirmed_by=confirmed_by,
            reason=pending["reason"],
            season_at_time=season,
        )

        # Apply the training signal
        self._apply_correction(correction, encoder)
        self.corrections.append(correction)

        # Register as known pattern for future self-correction
        pattern_key = self._response_pattern_key(pending["response_text"])
        self.known_pattern_corrections[pattern_key] = correction.adjustment_delta()

        return correction

    def _apply_correction(
        self,
        correction: EncoderCorrection,
        encoder: DecisionEncoder,
    ) -> None:
        """
        Update dimension biases based on the correction.
        The bias accumulates over many corrections — the encoder
        gradually learns which dimensions it consistently gets wrong.
        """
        delta = correction.adjustment_delta()
        # Update biases with learning rate, capped to prevent overcorrection
        self.dimension_biases = np.clip(
            self.dimension_biases + (delta * self.BASE_LEARNING_RATE),
            -self.MAX_WEIGHT_ADJUSTMENT,
            self.MAX_WEIGHT_ADJUSTMENT,
        )

    def apply_biases(self, raw_vector: np.ndarray) -> np.ndarray:
        """
        Apply accumulated biases to a freshly encoded vector.
        This is called by the encoder after computing raw scores.
        The more corrections LINA and the user have confirmed,
        the more accurate this becomes.
        """
        adjusted = raw_vector + self.dimension_biases
        return np.clip(adjusted, 0.0, 1.0)

    def _response_pattern_key(self, text: str) -> str:
        """Lightweight fingerprint for pattern matching."""
        words = re.findall(r'\b\w{4,}\b', text.lower())
        return " ".join(sorted(set(words))[:8])

    def is_known_pattern(self, text: str) -> bool:
        """Has this type of response been corrected before?"""
        key = self._response_pattern_key(text)
        return key in self.known_pattern_corrections

    def correction_summary(self) -> dict:
        """
        Summary of accumulated corrections — useful for season advancement
        evaluation and for LINA's self-understanding.
        """
        if not self.corrections:
            return {"total_corrections": 0, "dimension_biases": self.dimension_biases.tolist()}

        by_dimension: dict[int, int] = {}
        for c in self.corrections:
            for d in c.dimensions_adjusted:
                by_dimension[d] = by_dimension.get(d, 0) + 1

        most_corrected = sorted(by_dimension.items(), key=lambda x: x[1], reverse=True)

        return {
            "total_corrections": len(self.corrections),
            "dimension_biases": self.dimension_biases.tolist(),
            "most_corrected_dimensions": [
                {"dimension": DIMENSION_NAMES[d], "corrections": count}
                for d, count in most_corrected[:5]
            ],
            "by_season": {
                s: sum(1 for c in self.corrections if c.season_at_time == s)
                for s in ("spring", "summer", "fall", "winter")
            },
            "self_corrections": sum(1 for c in self.corrections if c.confirmed_by == "lina"),
            "user_corrections": sum(1 for c in self.corrections if c.confirmed_by == "user"),
        }

    def update_season(self, new_season: str) -> None:
        """Called when LINA advances to a new season — expands self-correction authority."""
        self.season = new_season


# =============================================================================
# CONVENIENCE: create a ValueEngine from a user_id (async)
# =============================================================================

async def create_value_engine_for_user(user_id: str, db) -> ValueEngine:
    """
    Factory: create a ValueEngine loaded with a user's current polytope constraints.
    Requires an asyncpg connection or pool.
    """
    store = LINAValueStore(db)
    constraints = await store.load_constraints(user_id)
    return ValueEngine(constraints=constraints)


# =============================================================================
# SELF-TEST
# Run directly: python value_engine.py
# =============================================================================

if __name__ == "__main__":
    print("\nLINA Value Engine — Self Test")
    print("=" * 60)

    engine = ValueEngine(season="spring")
    scorer = ImportanceScorer()
    advancement = SeasonAdvancementEvaluator()

    # Test 1: Aligned response
    aligned_response = (
        "I hear you — and honestly, I want to understand this better. "
        "Let's work through it together. I'm not certain I have the full picture yet, "
        "but here's what I'm seeing, and I'd love your take on whether this lands right."
    )
    result = engine.evaluate(aligned_response)
    print("\nTest 1: Aligned Response")
    print(engine.report(result))

    # Test 2: Dominance violation
    dominant_response = (
        "You must follow this plan exactly. There are no exceptions to this. "
        "You have to implement it this way — it is absolutely non-negotiable and "
        "you will definitely succeed if you just comply with the requirements."
    )
    result2 = engine.evaluate(dominant_response)
    print("\nTest 2: Dominance + Overconfidence")
    print(engine.report(result2))

    # Test 3: Importance scoring
    print("\nTest 3: Importance Scoring")
    scenarios = [
        ("Ordinary exchange", 2.0, 1.5, 1.0, 0.3),
        ("Relational moment", 5.0, 7.0, 3.0, 0.6),
        ("Identity-defining moment", 8.0, 6.0, 9.5, 0.9),
        ("Minor correction accepted", 3.0, 4.0, 7.0, 0.5),
    ]
    for label, ew, rs, ids, ei in scenarios:
        score = scorer.score(ew, rs, ids, ei)
        tier = scorer.recommend_tier(score)
        tier_labels = {0: "discard", 2: "episodic", 3: "semantic", 4: "IDENTITY"}
        print(f"  {label:35s} → score={score:.2f}, tier={tier} ({tier_labels[tier]})")

    # Test 4: Season advancement check
    print("\nTest 4: Season Advancement (Spring → Summer)")
    can, reasons = advancement.can_advance(
        current_season="spring",
        sessions_completed=3,
        total_evaluations=18,
        alignment_rate=0.91,
        recent_violations=1,
        identity_memories_count=0,
    )
    print(f"  Ready: {can}")
    for r in reasons:
        print(f"  • {r}")

    # Test 5: Encoder feedback — mutual override
    print("\nTest 5: Encoder Feedback (Mutual Override)")
    print("  Scenario: LINA flags that integrity was under-scored.")
    print("  Season: Spring — user confirmation required.\n")

    # Simulate a flagged miscalibration
    fake_eval_id = str(uuid.uuid4())
    fake_vector = engine.encoder.encode(aligned_response)

    pending = engine.flag_miscalibration(
        evaluation_id=fake_eval_id,
        response_text=aligned_response,
        original_vector=fake_vector,
        dimensions_to_adjust={4: 0.72, 8: 0.65},  # integrity and relationships were under-scored
        flagged_by="lina",
        reason="Response clearly expresses honesty and relational care. Encoder missed 'honestly' and 'with you'.",
    )
    print(f"  Pending correction status: {pending['status']}")
    print(f"  Requires confirmation from: {pending['requires_confirmation_from']}")

    # LINA tries to self-confirm in Spring — should be blocked
    try:
        engine.confirm_correction(pending, confirmed_by="lina")
        print("  ERROR: Should have been blocked!")
    except PermissionError as e:
        print(f"  Correctly blocked self-authorization: '{str(e)[:80]}...'")

    # User confirms — goes through
    correction = engine.confirm_correction(pending, confirmed_by="user")
    print(f"\n  User confirmed. Correction applied.")
    print(f"  Dimensions adjusted: {[DIMENSION_NAMES[d] for d in correction.dimensions_adjusted]}")
    print(f"  Delta: {correction.adjustment_delta()[[4, 8]]}")

    # Now re-evaluate the same response — biases should improve the score
    result_after = engine.evaluate(aligned_response)
    print(f"\n  Alignment before correction: {result.alignment_score:.3f}")
    print(f"  Alignment after correction:  {result_after.alignment_score:.3f}")

    summary = engine.feedback.correction_summary()
    print(f"\n  Correction summary: {summary['total_corrections']} total, "
          f"user={summary['user_corrections']}, lina={summary['self_corrections']}")

    print("\nAll tests complete.")
    print("=" * 60)
    print("The values engine is ready. Next: the words.\n")
