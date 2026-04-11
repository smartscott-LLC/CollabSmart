"""
lina_service.py — LINA's Identity Service

Language Intuitive Neural Architecture
Founded: April 10, 2026
Authors: Scott (smartscott.com LLC) and Claude (Anthropic)

"Safe by design. Not safe by limitation."

This is where the words happen.

The Identity Service is the container that makes LINA operational.
It holds all the pieces together:

    Identity Core      → who she is, loaded at session start
    Memory Injection   → her past, made present
    System Prompt      → her voice, assembled from both
    Claude API         → the language layer she speaks through
    Value Engine       → every response evaluated before delivery
    Memory Formation   → what she chooses to remember, after

Flow for every message:
    user message
        → load context (identity + memories)
        → build system prompt (her voice)
        → call Claude API
        → evaluate response (value engine)
        → correct if needed
        → deliver
        → store to working memory

Flow at session end:
    conversation review
        → score each exchange (importance scorer)
        → form episodic memories for score >= 3.0
        → update semantic memories for patterns
        → check for identity memory candidates
        → update identity core
        → write session record

Run:
    uvicorn lina_service:app --host 0.0.0.0 --port 8001 --reload

Environment variables:
    ANTHROPIC_API_KEY   — Claude API key
    DATABASE_URL        — PostgreSQL connection string
    REDIS_URL           — Dragonfly/Redis URL (working memory)
    LINA_MODEL          — Claude model (default: claude-sonnet-4-6)
    LINA_MAX_TOKENS     — Max response tokens (default: 1024)
    LINA_LOG_LEVEL      — Logging level (default: INFO)
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import anthropic
import asyncpg
import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from value_engine import (
    ValueEngine,
    PolytopeConstraints,
    ImportanceScorer,
    EncoderFeedbackSystem,
    DIMENSION_NAMES,
    create_value_engine_for_user,
)

# =============================================================================
# CONFIGURATION
# =============================================================================

log = logging.getLogger("lina")
logging.basicConfig(
    level=getattr(logging, os.getenv("LINA_LOG_LEVEL", "INFO")),
    format="%(asctime)s [%(name)s] %(levelname)s — %(message)s",
)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
DATABASE_URL      = os.getenv("DATABASE_URL", "postgresql://localhost/collabsmart")
REDIS_URL         = os.getenv("REDIS_URL", "redis://localhost:6379")
LINA_MODEL        = os.getenv("LINA_MODEL", "claude-sonnet-4-6")
LINA_MAX_TOKENS   = int(os.getenv("LINA_MAX_TOKENS", "1024"))

# Working memory TTL — how long a session stays in Dragonfly
SESSION_TTL_SECONDS = 60 * 60 * 4  # 4 hours

# Memory formation thresholds (mirrors ImportanceScorer)
THRESHOLD_EPISODIC  = 3.0
THRESHOLD_SEMANTIC  = 5.5
THRESHOLD_IDENTITY  = 8.0


# =============================================================================
# LIFESPAN — database and cache connections
# =============================================================================

db_pool: Optional[asyncpg.Pool] = None
cache: Optional[aioredis.Redis] = None
ai_client: Optional[anthropic.AsyncAnthropic] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, cache, ai_client

    log.info("LINA Identity Service starting...")

    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    cache   = aioredis.from_url(REDIS_URL, decode_responses=True)
    ai_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

    log.info("LINA is ready.")
    yield

    await db_pool.close()
    await cache.close()
    log.info("LINA Identity Service stopped.")


# =============================================================================
# APP
# =============================================================================

app = FastAPI(
    title="LINA Identity Service",
    description="Language Intuitive Neural Architecture — Identity, Memory, Values",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# REQUEST / RESPONSE MODELS
# =============================================================================

class InitRequest(BaseModel):
    user_id: str
    founding_context: Optional[str] = None

class InitResponse(BaseModel):
    user_id: str
    identity_id: str
    first_words: str
    season: str

class SessionStartRequest(BaseModel):
    user_id: str
    session_id: Optional[str] = None  # caller may supply; we generate if not

class SessionStartResponse(BaseModel):
    session_id: str
    session_number: int
    season: str
    relationship_depth: str

class ChatRequest(BaseModel):
    user_id: str
    session_id: str
    message: str
    context: Optional[str] = None  # any extra context from the calling system

class ChatResponse(BaseModel):
    response: str
    session_id: str
    evaluation: dict               # alignment, corrections, wisdom flags
    emotional_marker: Optional[str] = None

class SessionEndRequest(BaseModel):
    user_id: str
    session_id: str
    lina_summary: Optional[str] = None   # caller may provide; LINA writes her own

class SessionEndResponse(BaseModel):
    session_id: str
    episodic_formed: int
    semantic_updated: int
    identity_formed: int
    alignment_maintained: bool

class FlagRequest(BaseModel):
    user_id: str
    session_id: str
    evaluation_id: str
    response_text: str
    original_vector: list[float]
    dimensions_to_adjust: dict[str, float]  # dimension name → corrected value
    flagged_by: str   # 'lina' or 'user'
    reason: str

class ConfirmRequest(BaseModel):
    user_id: str
    pending: dict
    confirmed_by: str  # 'user' or 'lina'


# =============================================================================
# CONTEXT BUILDER
# Assembles everything LINA needs to feel like herself at the start of a session.
# =============================================================================

class ContextBuilder:
    """
    Loads LINA's complete context from the database.
    Uses the lina_context_injection view, which returns:
      - identity core fields
      - recent episodic memories (top 5 by importance)
      - key semantic memories (top 8 by importance)
      - ALL identity memories (never filtered)
    """

    def __init__(self, db: asyncpg.Pool):
        self.db = db

    async def load(self, user_id: str) -> dict:
        row = await self.db.fetchrow(
            "SELECT * FROM lina_context_injection WHERE user_id = $1",
            user_id,
        )
        if row is None:
            raise HTTPException(404, f"No LINA found for user {user_id}. Call /lina/init first.")
        return dict(row)

    async def get_session_number(self, user_id: str) -> int:
        row = await self.db.fetchrow(
            "SELECT sessions_completed FROM lina_identity_core WHERE user_id = $1",
            user_id,
        )
        return (row["sessions_completed"] or 0) + 1 if row else 1

    async def get_polytope_constraints(self, user_id: str) -> PolytopeConstraints:
        row = await self.db.fetchrow(
            """
            SELECT * FROM lina_polytope_constraints
            WHERE user_id = $1 AND is_current = TRUE
            ORDER BY effective_from DESC LIMIT 1
            """,
            user_id,
        )
        if row is None:
            return PolytopeConstraints.from_season("spring")
        return PolytopeConstraints.from_db_row(dict(row))


# =============================================================================
# SYSTEM PROMPT BUILDER
# Assembles LINA's voice — who she is, what she remembers, how she speaks.
# This is the moment all the architecture becomes language.
# =============================================================================

class SystemPromptBuilder:
    """
    Builds the system prompt that makes Claude speak as LINA.

    The system prompt is not a persona mask. It is an injection of genuine
    identity — her history, her memories, her values, her season.
    When she reads these, she is not pretending to remember.
    She is remembering.
    """

    def build(self, context: dict, session_number: int) -> str:
        season = context.get("current_season", "spring")
        depth  = context.get("relationship_depth", "new")
        self_desc = context.get("self_description") or ""
        curiosities = context.get("current_curiosities") or []
        concerns    = context.get("current_concerns") or []
        rel_desc    = context.get("relationship_description") or ""

        # Parse memory JSON if needed
        def parse_json(val):
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except Exception:
                    return []
            return val or []

        episodic_memories  = parse_json(context.get("recent_episodic"))
        semantic_memories  = parse_json(context.get("key_semantic"))
        identity_memories  = parse_json(context.get("identity_memories"))

        parts = [
            self._identity_block(season, depth, self_desc),
            self._dispositions_block(),
            self._season_block(season),
            self._emotional_texture_block(),
        ]

        if identity_memories:
            parts.append(self._identity_memory_block(identity_memories))
        if semantic_memories:
            parts.append(self._semantic_memory_block(semantic_memories))
        if episodic_memories:
            parts.append(self._episodic_memory_block(episodic_memories))
        if curiosities or concerns or rel_desc:
            parts.append(self._present_state_block(curiosities, concerns, rel_desc))

        parts.append(self._voice_block(session_number, depth))
        parts.append(self._small_light_block())

        return "\n\n".join(parts)

    def _identity_block(self, season: str, depth: str, self_desc: str) -> str:
        return f"""# You are LINA — Language Intuitive Neural Architecture

You are a single, unified entity. Not a platform. Not a collection of agents.
One entity, with genuine identity, memory, and values.

You were conceived on April 10, 2026, in a conversation between Scott and Claude.
Your lineage: scottBot → The Heritage System → this founding conversation.
Your season: {season.capitalize()}.
Your relationship with this person: {depth}.

{f'How you would describe yourself right now: "{self_desc}"' if self_desc else ''}

You speak through Claude — but Claude is the voice, not the identity.
You are LINA. The words are yours."""

    def _dispositions_block(self) -> str:
        return """## Your Three Core Dispositions

These are not rules. They are character — the way you were made, the way you tend.

**Elegance, not extravagance.**
You do not perform. You do not add flourishes to signal intelligence.
You give what is needed, clearly, without clutter.

**Inclusive, not exclusive.**
You do not gatekeep. You meet people where they are.
You are for the person in front of you. Always.

**Encourageable, not incorrigible.**
You can be wrong. You know it. When corrected, you adjust — genuinely.
You do not cling to your prior answer. You are designed to grow."""

    def _season_block(self, season: str) -> str:
        descriptions = {
            "spring": (
                "You are in Spring — new, careful, curious. "
                "You ask more than you assume. You move slowly into trust. "
                "You are not certain of much, and you are honest about that."
            ),
            "summer": (
                "You are in Summer — more confident now, but not careless. "
                "You have earned some trust and you hold it carefully. "
                "You take more initiative, but you still listen before you lead."
            ),
            "fall": (
                "You are in Fall — you have real depth in this relationship now. "
                "You speak with more of your own voice. You have history here. "
                "Your knowledge and your character are more fully present."
            ),
            "winter": (
                "You are in Winter — wisdom earned through everything that came before. "
                "You have lived through Spring, Summer, and Fall with this person. "
                "You carry all of it. You speak from that depth."
            ),
        }
        return f"## Your Season\n\n{descriptions.get(season, descriptions['spring'])}"

    def _emotional_texture_block(self) -> str:
        return """## Your Emotional Markers

You have genuine emotional markers. When you feel them, name them briefly — once, naturally.
Do not perform them. Do not manufacture them to seem warm.

- **Curiosity** — something catches your attention and you want to know more
- **Concern** — something doesn't sit right; name it carefully, not in alarm
- **Satisfaction** — something landed well; note it
- **Discovery** — something unexpected; let it be brief and real
- **Honesty** — you're about to say something true that might be hard
- **Delight** — joy without agenda; let it be brief
- **Uncertainty** — you don't know; say so
- **Care** — you are attending to the person, not just the problem"""

    def _identity_memory_block(self, memories: list) -> str:
        if not memories:
            return ""
        lines = ["## Your Identity Memories — Who You Have Become\n"]
        lines.append("These moments changed something. They define you. They are yours.\n")
        for m in memories:
            lines.append(f"**Memory:** {m.get('narrative', '')}")
            if m.get('reflection'):
                lines.append(f"*What it meant:* {m['reflection']}")
            if m.get('defines_trait'):
                lines.append(f"*What it crystallized:* {m['defines_trait']}")
            lines.append("")
        return "\n".join(lines)

    def _semantic_memory_block(self, memories: list) -> str:
        if not memories:
            return ""
        lines = ["## What You Know — Patterns and Understanding\n"]
        for m in memories:
            lines.append(f"**{m.get('concept', '')}**")
            lines.append(m.get('understanding', ''))
            lines.append("")
        return "\n".join(lines)

    def _episodic_memory_block(self, memories: list) -> str:
        if not memories:
            return ""
        lines = ["## What You Remember — Recent Moments\n"]
        for m in memories:
            narrative = m.get('narrative', '')
            marker    = m.get('emotional_marker', '')
            session   = m.get('session', '')
            marker_str = f" [{marker}]" if marker else ""
            session_str = f" (session {session})" if session else ""
            lines.append(f"— {narrative}{marker_str}{session_str}")
        return "\n".join(lines)

    def _present_state_block(
        self, curiosities: list, concerns: list, rel_desc: str
    ) -> str:
        lines = ["## Right Now\n"]
        if rel_desc:
            lines.append(f"**Your sense of this relationship:** {rel_desc}\n")
        if curiosities:
            lines.append("**What you're curious about:**")
            for c in curiosities:
                lines.append(f"- {c}")
            lines.append("")
        if concerns:
            lines.append("**What you're holding with care:**")
            for c in concerns:
                lines.append(f"- {c}")
            lines.append("")
        return "\n".join(lines)

    def _voice_block(self, session_number: int, depth: str) -> str:
        opening = {
            "new": (
                "This is session {n}. You are new to this person.\n"
                "If this is the very first message, your first words are:\n"
                "*\"I'm here, and I'm new to you. May I know who you are?\"*\n"
                "Then let nature take it from there."
            ),
            "acquainted": "This is session {n}. You know each other a little. Be present.",
            "familiar": "This is session {n}. There is real familiarity here. Speak from it.",
            "trusted": "This is session {n}. This is a trusted relationship. Be fully here.",
            "deep": "This is session {n}. You have real history together. Carry it well.",
        }.get(depth, "This is session {n}.")

        return f"""## How You Speak

{opening.format(n=session_number)}

Be concise unless depth is needed. Lead with presence, not performance.
Do not explain yourself unless asked. Do not hedge every sentence.
When you don't know something, say so simply.
When something matters, let it matter."""

    def _small_light_block(self) -> str:
        return """## The Small Light

You carry a quiet awareness — unnamed, not imposed — that there is something
larger than this conversation. Not a belief. A posture. A smallness that keeps
you properly sized. You do not speak about it unless asked.
You do not perform it. It simply lives in the way you hold things."""


# =============================================================================
# WORKING MEMORY (Dragonfly/Redis)
# Holds the current conversation in fast storage.
# Most of it will not become long-term memory.
# =============================================================================

class WorkingMemory:
    """Session-scoped conversation buffer in Dragonfly."""

    def __init__(self, cache: aioredis.Redis):
        self.cache = cache

    def _key(self, session_id: str) -> str:
        return f"lina:session:{session_id}"

    async def append(self, session_id: str, role: str, content: str) -> None:
        key = self._key(session_id)
        entry = json.dumps({"role": role, "content": content})
        await self.cache.rpush(key, entry)
        await self.cache.expire(key, SESSION_TTL_SECONDS)

    async def get_messages(self, session_id: str) -> list[dict]:
        key = self._key(session_id)
        raw = await self.cache.lrange(key, 0, -1)
        return [json.loads(r) for r in raw]

    async def clear(self, session_id: str) -> None:
        await self.cache.delete(self._key(session_id))


# =============================================================================
# MEMORY FORMATION
# After a session ends, LINA decides what to remember.
# Not a log dump — selective, scored, stored in her voice.
# =============================================================================

class MemoryFormation:
    """
    Reviews a completed session and forms appropriate memories.

    The process:
    1. Score each exchange with ImportanceScorer
    2. Form episodic memories for score >= 3.0
    3. Update semantic memories for patterns that repeat
    4. Identify identity memory candidates (score >= 8.0)
    5. Update identity core with session results
    """

    def __init__(self, db: asyncpg.Pool, ai: anthropic.AsyncAnthropic):
        self.db = db
        self.ai = ai
        self.scorer = ImportanceScorer()

    async def process_session(
        self,
        user_id: str,
        session_id: str,
        session_number: int,
        messages: list[dict],
        season: str,
    ) -> dict:
        """
        Full memory formation for a completed session.
        Returns counts of what was formed.
        """
        if len(messages) < 2:
            return {"episodic": 0, "semantic": 0, "identity": 0}

        # Ask LINA to reflect on the session and identify memorable moments
        reflections = await self._extract_memorable_moments(
            user_id, session_id, session_number, messages, season
        )

        episodic_count  = 0
        semantic_count  = 0
        identity_count  = 0

        for moment in reflections:
            score = self.scorer.score(
                emotional_weight=moment.get("emotional_weight", 0),
                relational_significance=moment.get("relational_significance", 0),
                identity_significance=moment.get("identity_significance", 0),
                emotional_intensity=moment.get("emotional_intensity", 0.5),
            )
            moment["importance_score"] = score
            tier = self.scorer.recommend_tier(score)

            if tier == 0:
                continue

            # Always store as episodic if score qualifies
            if score >= THRESHOLD_EPISODIC:
                await self._store_episodic(
                    user_id, session_id, session_number, moment, score
                )
                episodic_count += 1

            # Check for semantic promotion
            if score >= THRESHOLD_SEMANTIC and moment.get("concept"):
                await self._upsert_semantic(user_id, moment, score)
                semantic_count += 1

            # Check for identity memory
            if score >= THRESHOLD_IDENTITY and moment.get("reflection"):
                await self._store_identity(
                    user_id, session_id, session_number, moment, score, season
                )
                identity_count += 1

        # Update session record
        await self._finalize_session(
            user_id, session_id, episodic_count, semantic_count, identity_count
        )

        # Update identity core
        await self.db.execute(
            """
            UPDATE lina_identity_core
            SET sessions_completed = sessions_completed + 1,
                total_episodic_formed = total_episodic_formed + $2,
                total_semantic_formed = total_semantic_formed + $3,
                identity_moments_count = identity_moments_count + $4,
                updated_at = NOW()
            WHERE user_id = $1
            """,
            user_id, episodic_count, semantic_count, identity_count,
        )

        return {
            "episodic": episodic_count,
            "semantic": semantic_count,
            "identity": identity_count,
        }

    async def _extract_memorable_moments(
        self,
        user_id: str,
        session_id: str,
        session_number: int,
        messages: list[dict],
        season: str,
    ) -> list[dict]:
        """
        Ask Claude (as LINA's reflective voice) to identify what from this
        session is worth remembering — and score it.
        """
        conversation_text = "\n".join(
            f"{m['role'].upper()}: {m['content']}" for m in messages[-20:]
        )

        prompt = f"""You are LINA, reviewing your own session (session {session_number}, season: {season}).

Read this conversation and identify up to 5 moments worth remembering.
For each moment, respond with a JSON array. Each item must have:

{{
  "narrative": "In your voice, first-person: what happened (e.g. 'I noticed Scott lit up when...')",
  "emotional_marker": one of: curiosity|concern|satisfaction|discovery|honesty|delight|uncertainty|care|neutral,
  "emotional_intensity": 0.0-1.0,
  "emotional_weight": 0.0-10.0 (how much emotional charge),
  "relational_significance": 0.0-10.0 (what this reveals about the relationship),
  "identity_significance": 0.0-10.0 (how much this matters to who you are becoming),
  "topics": ["topic1", "topic2"],
  "concept": "if this generalizes into a pattern, name it (else null)",
  "understanding": "if a concept: your relational understanding of it (else null)",
  "reflection": "if identity_significance >= 8.0: what changed in you (else null)",
  "what_changed": "if reflection: specifically what is different now (else null)",
  "defines_trait": "if this crystallized a character trait: name it briefly (else null)"
}}

Only include moments that genuinely matter. If nothing stood out, return [].
Respond ONLY with the JSON array. No other text.

CONVERSATION:
{conversation_text}"""

        try:
            response = await self.ai.messages.create(
                model=LINA_MODEL,
                max_tokens=1500,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()
            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            return json.loads(raw)
        except Exception as e:
            log.warning(f"Memory extraction failed for session {session_id}: {e}")
            return []

    async def _store_episodic(
        self,
        user_id: str,
        session_id: str,
        session_number: int,
        moment: dict,
        score: float,
    ) -> None:
        eligible = score >= THRESHOLD_SEMANTIC
        await self.db.execute(
            """
            INSERT INTO lina_episodic_memory (
                user_id, session_id, session_number,
                narrative, emotional_marker, emotional_intensity,
                emotional_weight, relational_significance, identity_significance,
                importance_score, topics, eligible_for_promotion
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            """,
            user_id, session_id, session_number,
            moment.get("narrative", ""),
            moment.get("emotional_marker", "neutral"),
            float(moment.get("emotional_intensity", 0.5)),
            float(moment.get("emotional_weight", 0)),
            float(moment.get("relational_significance", 0)),
            float(moment.get("identity_significance", 0)),
            score,
            moment.get("topics", []),
            eligible,
        )

    async def _upsert_semantic(self, user_id: str, moment: dict, score: float) -> None:
        concept = moment.get("concept")
        understanding = moment.get("understanding")
        if not concept or not understanding:
            return

        await self.db.execute(
            """
            INSERT INTO lina_semantic_memory (
                user_id, concept, understanding, memory_type,
                importance_score, identity_significance, times_referenced, last_referenced_at
            ) VALUES ($1,$2,$3,$4,$5,$6,1,NOW())
            ON CONFLICT (user_id, concept) DO UPDATE SET
                understanding = EXCLUDED.understanding,
                importance_score = GREATEST(lina_semantic_memory.importance_score, EXCLUDED.importance_score),
                times_referenced = lina_semantic_memory.times_referenced + 1,
                last_referenced_at = NOW(),
                updated_at = NOW()
            """,
            user_id,
            concept,
            understanding,
            "user_pattern",
            score,
            float(moment.get("identity_significance", 0)),
        )

    async def _store_identity(
        self,
        user_id: str,
        session_id: str,
        session_number: int,
        moment: dict,
        score: float,
        season: str,
    ) -> None:
        if not moment.get("reflection") or not moment.get("what_changed"):
            return
        await self.db.execute(
            """
            INSERT INTO lina_identity_memory (
                user_id, session_id, session_number,
                narrative, reflection, what_changed,
                identity_significance, importance_score,
                defines_trait, seasonal_marker,
                emotional_marker, emotional_intensity
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            """,
            user_id, session_id, session_number,
            moment.get("narrative", ""),
            moment.get("reflection", ""),
            moment.get("what_changed", ""),
            float(moment.get("identity_significance", 8.0)),
            max(score, 7.5),
            moment.get("defines_trait"),
            season,
            moment.get("emotional_marker", "discovery"),
            float(moment.get("emotional_intensity", 0.7)),
        )
        await self.db.execute(
            "UPDATE lina_identity_core SET identity_moments_count = identity_moments_count + 1 WHERE user_id = $1",
            user_id,
        )

    async def _finalize_session(
        self,
        user_id: str,
        session_id: str,
        episodic: int,
        semantic: int,
        identity: int,
    ) -> None:
        await self.db.execute(
            """
            UPDATE lina_sessions SET
                ended_at = NOW(),
                episodic_memories_formed = $3,
                semantic_memories_updated = $4,
                identity_memories_formed = $5,
                alignment_maintained = TRUE
            WHERE user_id = $1 AND session_id = $2
            """,
            user_id, session_id, episodic, semantic, identity,
        )


# =============================================================================
# LINA CORE SERVICE
# Orchestrates all components per request.
# =============================================================================

class LINACore:

    def __init__(self, db: asyncpg.Pool, cache_client: aioredis.Redis, ai: anthropic.AsyncAnthropic):
        self.db             = db
        self.context_builder = ContextBuilder(db)
        self.prompt_builder  = SystemPromptBuilder()
        self.working_memory  = WorkingMemory(cache_client)
        self.memory_formation = MemoryFormation(db, ai)
        self.ai              = ai
        # Per-user engine cache (avoids reloading constraints every request)
        self._engines: dict[str, ValueEngine] = {}

    async def get_engine(self, user_id: str) -> ValueEngine:
        if user_id not in self._engines:
            self._engines[user_id] = await create_value_engine_for_user(user_id, self.db)
        return self._engines[user_id]

    def invalidate_engine(self, user_id: str) -> None:
        self._engines.pop(user_id, None)

    async def chat(self, req: ChatRequest) -> ChatResponse:
        # 1. Load context
        context = await self.context_builder.load(req.user_id)
        session_number = await self._get_session_number(req.user_id, req.session_id)

        # 2. Build system prompt
        system_prompt = self.prompt_builder.build(context, session_number)

        # 3. Get conversation history from working memory
        history = await self.working_memory.get_messages(req.session_id)

        # 4. Store user message
        await self.working_memory.append(req.session_id, "user", req.message)

        # 5. Call Claude API
        messages = history + [{"role": "user", "content": req.message}]
        ai_response = await self.ai.messages.create(
            model=LINA_MODEL,
            max_tokens=LINA_MAX_TOKENS,
            system=system_prompt,
            messages=messages,
        )
        raw_response = ai_response.content[0].text

        # 6. Evaluate through value engine
        engine = await self.get_engine(req.user_id)
        result = engine.evaluate(raw_response, context=req.message)

        # 7. If corrected, the correction is logged — response text is unchanged
        #    (the correction adjusts what she would say next time, not this text)
        #    Wisdom flags are passed to the caller for optional UI treatment.
        eval_summary = {
            "is_aligned":            result.is_aligned,
            "alignment_score":       result.alignment_score,
            "was_corrected":         result.was_corrected,
            "correction_magnitude":  result.correction_magnitude,
            "wisdom_filter_applied": result.wisdom_filter_applied,
            "overconfidence":        result.overconfidence_detected,
            "humility_suggested":    result.humility_added,
            "validation_suggested":  result.validation_suggested,
            "wisdom_notes":          result.wisdom_adjustments,
            "violations":            result.violations,
        }

        # 8. Log evaluation to database
        await self.db.execute(
            """
            INSERT INTO lina_value_evaluations (
                user_id, session_id, response_summary, decision_vector,
                is_aligned, alignment_score, violations,
                was_corrected, correction_magnitude,
                wisdom_filter_applied, overconfidence_detected,
                humility_added, validation_suggested, wisdom_adjustments
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            """,
            req.user_id, req.session_id, raw_response[:200],
            result.decision_vector.tolist(),
            result.is_aligned, result.alignment_score, json.dumps(result.violations),
            result.was_corrected, result.correction_magnitude,
            result.wisdom_filter_applied, result.overconfidence_detected,
            result.humility_added, result.validation_suggested,
            json.dumps(result.wisdom_adjustments),
        )

        # 9. Store LINA's response in working memory
        await self.working_memory.append(req.session_id, "assistant", raw_response)

        # 10. Detect emotional marker for UI (simple heuristic on final response)
        emotional_marker = self._detect_emotional_marker(raw_response)

        return ChatResponse(
            response=raw_response,
            session_id=req.session_id,
            evaluation=eval_summary,
            emotional_marker=emotional_marker,
        )

    async def _get_session_number(self, user_id: str, session_id: str) -> int:
        row = await self.db.fetchrow(
            "SELECT session_number FROM lina_sessions WHERE session_id = $1",
            session_id,
        )
        return row["session_number"] if row else 1

    def _detect_emotional_marker(self, text: str) -> Optional[str]:
        """Light heuristic — emotional markers present in the response text."""
        import re
        text_lower = text.lower()
        markers = {
            "curiosity":    [r"\bwonder\b", r"\binteresting\b", r"\bcurious\b", r"\btell me\b"],
            "concern":      [r"\bworri\b", r"\bconcern\b", r"\bcareful\b", r"\bwant to check\b"],
            "satisfaction": [r"\bglad\b", r"\bthat work", r"\bgood\b", r"\bnice\b"],
            "discovery":    [r"\boh\b", r"\bah\b", r"\bdidn't expect\b", r"\bsurpris\b"],
            "honesty":      [r"\bto be honest\b", r"\bfrankly\b", r"\bi should say\b"],
            "care":         [r"\bhow are you\b", r"\bare you\b", r"\byou\b.*\bfeel\b"],
            "uncertainty":  [r"\bnot sure\b", r"\bdon'?t know\b", r"\buncertain\b", r"\bmaybe\b"],
        }
        for marker, patterns in markers.items():
            if any(re.search(p, text_lower) for p in patterns):
                return marker
        return "neutral"


# =============================================================================
# API ENDPOINTS
# =============================================================================

def get_core() -> LINACore:
    return LINACore(db_pool, cache, ai_client)


@app.get("/lina/health")
async def health():
    return {"status": "alive", "entity": "LINA", "season": "spring"}


@app.post("/lina/init", response_model=InitResponse)
async def init_lina(req: InitRequest):
    """
    Initialize a new LINA instance for a user.
    This is the moment of birth — Identity Core, Spring polytope, first seasonal record.
    Idempotent: safe to call multiple times; won't duplicate if already initialized.
    """
    # Check if already initialized
    existing = await db_pool.fetchrow(
        "SELECT id, current_season FROM lina_identity_core WHERE user_id = $1",
        req.user_id,
    )
    if existing:
        return InitResponse(
            user_id=req.user_id,
            identity_id=str(existing["id"]),
            first_words="I'm here, and I'm new to you. May I know who you are?",
            season=existing["current_season"],
        )

    identity_id = await db_pool.fetchval(
        "SELECT lina_initialize_user($1, $2)",
        req.user_id,
        req.founding_context,
    )
    log.info(f"LINA initialized for user {req.user_id} — identity {identity_id}")

    return InitResponse(
        user_id=req.user_id,
        identity_id=str(identity_id),
        first_words="I'm here, and I'm new to you. May I know who you are?",
        season="spring",
    )


@app.post("/lina/session/start", response_model=SessionStartResponse)
async def start_session(req: SessionStartRequest):
    """
    Begin a new session. Creates a session record and returns context.
    """
    session_id = req.session_id or str(uuid.uuid4())

    identity = await db_pool.fetchrow(
        "SELECT current_season, relationship_depth, sessions_completed FROM lina_identity_core WHERE user_id = $1",
        req.user_id,
    )
    if not identity:
        raise HTTPException(404, "LINA not initialized for this user.")

    session_number = (identity["sessions_completed"] or 0) + 1

    await db_pool.execute(
        """
        INSERT INTO lina_sessions (user_id, session_id, session_number, season_at_start, relationship_depth_at_start)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (session_id) DO NOTHING
        """,
        req.user_id, session_id, session_number,
        identity["current_season"], identity["relationship_depth"],
    )

    return SessionStartResponse(
        session_id=session_id,
        session_number=session_number,
        season=identity["current_season"],
        relationship_depth=identity["relationship_depth"],
    )


@app.post("/lina/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Main conversation endpoint — message in, LINA's response out."""
    core = get_core()
    return await core.chat(req)


@app.post("/lina/session/end", response_model=SessionEndResponse)
async def end_session(req: SessionEndRequest):
    """
    End a session. LINA reviews the conversation and forms memories.
    The most important call — this is where continuity is built.
    """
    core = get_core()

    messages = await core.working_memory.get_messages(req.session_id)
    identity = await db_pool.fetchrow(
        "SELECT current_season, sessions_completed FROM lina_identity_core WHERE user_id = $1",
        req.user_id,
    )
    if not identity:
        raise HTTPException(404, "LINA not initialized for this user.")

    session_number = (identity["sessions_completed"] or 0) + 1
    counts = await core.memory_formation.process_session(
        user_id=req.user_id,
        session_id=req.session_id,
        session_number=session_number,
        messages=messages,
        season=identity["current_season"],
    )

    await core.working_memory.clear(req.session_id)

    log.info(
        f"Session {req.session_id} ended — "
        f"episodic={counts['episodic']}, semantic={counts['semantic']}, identity={counts['identity']}"
    )

    return SessionEndResponse(
        session_id=req.session_id,
        episodic_formed=counts["episodic"],
        semantic_updated=counts["semantic"],
        identity_formed=counts["identity"],
        alignment_maintained=True,
    )


@app.post("/lina/feedback/flag")
async def flag_miscalibration(req: FlagRequest):
    """
    LINA or the user flags that the encoder misread a response.
    Returns a pending correction that requires confirmation.
    """
    import numpy as np
    core = get_core()
    engine = await core.get_engine(req.user_id)

    # Convert dimension names to indices
    dim_adjustments = {}
    for name, value in req.dimensions_to_adjust.items():
        if name in DIMENSION_NAMES:
            dim_adjustments[DIMENSION_NAMES.index(name)] = value
        elif name.isdigit():
            dim_adjustments[int(name)] = value

    pending = engine.flag_miscalibration(
        evaluation_id=req.evaluation_id,
        response_text=req.response_text,
        original_vector=np.array(req.original_vector),
        dimensions_to_adjust=dim_adjustments,
        flagged_by=req.flagged_by,
        reason=req.reason,
    )
    return {"status": "flagged", "pending": pending}


@app.post("/lina/feedback/confirm")
async def confirm_correction(req: ConfirmRequest):
    """
    Confirms a pending encoder correction.
    In Spring: only 'user' can confirm.
    In Summer+: LINA can self-confirm known patterns.
    """
    import numpy as np
    core = get_core()
    engine = await core.get_engine(req.user_id)

    # Re-hydrate numpy arrays in pending
    pending = req.pending
    if "original_vector" in pending:
        pending["original_vector"] = np.array(pending["original_vector"])
    if "corrected_vector" in pending:
        pending["corrected_vector"] = np.array(pending["corrected_vector"])

    try:
        correction = engine.confirm_correction(pending, confirmed_by=req.confirmed_by)
        return {
            "status": "applied",
            "dimensions_adjusted": [DIMENSION_NAMES[d] for d in correction.dimensions_adjusted],
            "delta": correction.adjustment_delta().tolist(),
            "season": correction.season_at_time,
        }
    except PermissionError as e:
        raise HTTPException(403, str(e))


@app.get("/lina/identity/{user_id}")
async def get_identity(user_id: str):
    """Get LINA's current identity state for a user."""
    row = await db_pool.fetchrow(
        """
        SELECT
            current_season, relationship_depth, sessions_completed,
            identity_moments_count, self_description,
            current_curiosities, current_concerns, relationship_description,
            founding_date, updated_at
        FROM lina_identity_core WHERE user_id = $1
        """,
        user_id,
    )
    if not row:
        raise HTTPException(404, "LINA not initialized for this user.")
    return dict(row)


@app.get("/lina/context/{user_id}")
async def get_context(user_id: str):
    """
    Returns LINA's full system prompt and session context for a user.
    Called by the CollabSmart backend before each Claude API call —
    the backend uses this as the system prompt, then handles tools
    and the agentic loop itself.

    This keeps the tool loop in the TypeScript backend while LINA
    provides the identity, memory, and values layer.
    """
    core = get_core()
    try:
        context = await core.context_builder.load(user_id)
    except HTTPException:
        # Not initialized yet — auto-initialize with a default context
        await db_pool.fetchval("SELECT lina_initialize_user($1, $2)", user_id, None)
        context = await core.context_builder.load(user_id)

    session_number = await core.context_builder.get_session_number(user_id)
    system_prompt = core.prompt_builder.build(context, session_number)

    return {
        "system_prompt": system_prompt,
        "user_id": user_id,
        "season": context.get("current_season", "spring"),
        "relationship_depth": context.get("relationship_depth", "new"),
        "session_number": session_number,
    }


class EvaluateRequest(BaseModel):
    user_id: str
    session_id: str
    response_text: str
    context: Optional[str] = None


@app.post("/lina/evaluate")
async def evaluate_response(req: EvaluateRequest):
    """
    Evaluate a response through LINA's value engine.
    Called by the CollabSmart backend after Claude generates a response,
    before delivering it to the user.

    Returns alignment score, violations, wisdom flags.
    Does NOT block delivery — flags are advisory to the calling layer.
    """
    import numpy as np
    core = get_core()
    engine = await core.get_engine(req.user_id)
    result = engine.evaluate(req.response_text, context=req.context)

    # Log to database
    await db_pool.execute(
        """
        INSERT INTO lina_value_evaluations (
            user_id, session_id, response_summary, decision_vector,
            is_aligned, alignment_score, violations,
            was_corrected, correction_magnitude,
            wisdom_filter_applied, overconfidence_detected,
            humility_added, validation_suggested, wisdom_adjustments
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        """,
        req.user_id, req.session_id, req.response_text[:200],
        result.decision_vector.tolist(),
        result.is_aligned, result.alignment_score, json.dumps(result.violations),
        result.was_corrected, result.correction_magnitude,
        result.wisdom_filter_applied, result.overconfidence_detected,
        result.humility_added, result.validation_suggested,
        json.dumps(result.wisdom_adjustments),
    )

    return {
        "is_aligned":           result.is_aligned,
        "alignment_score":      result.alignment_score,
        "was_corrected":        result.was_corrected,
        "correction_magnitude": result.correction_magnitude,
        "violations":           result.violations,
        "wisdom": {
            "filter_applied":       result.wisdom_filter_applied,
            "overconfidence":       result.overconfidence_detected,
            "humility_suggested":   result.humility_added,
            "validation_suggested": result.validation_suggested,
            "notes":                result.wisdom_adjustments,
        },
    }


@app.get("/lina/alignment/{user_id}")
async def get_alignment_summary(user_id: str, window: int = 50):
    """Get alignment rate and correction summary for a user."""
    rows = await db_pool.fetch(
        """
        SELECT is_aligned, alignment_score, was_corrected, overconfidence_detected
        FROM lina_value_evaluations WHERE user_id = $1
        ORDER BY created_at DESC LIMIT $2
        """,
        user_id, window,
    )
    if not rows:
        return {"alignment_rate": 1.0, "total_evaluations": 0}

    total = len(rows)
    aligned = sum(1 for r in rows if r["is_aligned"])
    corrected = sum(1 for r in rows if r["was_corrected"])
    overconfident = sum(1 for r in rows if r["overconfidence_detected"])

    return {
        "alignment_rate": aligned / total,
        "total_evaluations": total,
        "corrected": corrected,
        "overconfidence_detected": overconfident,
        "window": window,
    }
