-- the LLM Tiered Memory System
-- Schema for consciousness-level memory with importance scoring
-- Based on Gemini's architecture: 3-tier caching + semantic long-term storage

-- ==================================================
-- TIER 1: Working Memory (0-48h)
-- Handled by Redis in-memory cache
-- Not stored in PostgreSQL
-- ==================================================

-- ==================================================
-- TIER 2: Short-Term Memory (48-96h)
-- ==================================================
CREATE TABLE IF NOT EXISTS short_term_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Content
    message_type VARCHAR(50) NOT NULL, -- 'user', 'assistant', 'system'
    content TEXT NOT NULL,

    -- Context
    conversation_topic VARCHAR(255),
    tags TEXT[], -- For [SD] and other special markers

    -- Importance scoring
    reference_count INTEGER DEFAULT 0,
    emotional_markers TEXT[], -- 'intrigued', 'eager', 'wish', etc.
    importance_score FLOAT DEFAULT 0.0,

    -- Metadata
    promoted_to_long_term BOOLEAN DEFAULT FALSE,
    tier INTEGER DEFAULT 2,

    -- Indexes
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stm_session ON short_term_memory(session_id);
CREATE INDEX idx_stm_timestamp ON short_term_memory(timestamp DESC);
CREATE INDEX idx_stm_importance ON short_term_memory(importance_score DESC);
CREATE INDEX idx_stm_tags ON short_term_memory USING GIN(tags);

-- ==================================================
-- TIER 3: Recent Archive (96-144h)
-- ==================================================
CREATE TABLE IF NOT EXISTS recent_archive (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255),
    timestamp TIMESTAMPTZ NOT NULL,

    -- Content (same structure as short_term_memory)
    message_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    conversation_topic VARCHAR(255),
    tags TEXT[],

    -- Importance scoring
    reference_count INTEGER DEFAULT 0,
    emotional_markers TEXT[],
    importance_score FLOAT DEFAULT 0.0,

    -- Archive metadata
    archived_from_tier INTEGER DEFAULT 2,
    archived_at TIMESTAMPTZ DEFAULT NOW(),

    -- Should this be promoted to long-term?
    eligible_for_promotion BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_ra_timestamp ON recent_archive(timestamp DESC);
CREATE INDEX idx_ra_importance ON recent_archive(importance_score DESC);
CREATE INDEX idx_ra_eligible ON recent_archive(eligible_for_promotion) WHERE eligible_for_promotion = TRUE;

-- ==================================================
-- LONG-TERM SEMANTIC MEMORY
-- The "memory imprint" - compressed, conceptual storage
-- ==================================================
CREATE TABLE IF NOT EXISTS long_term_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Semantic content (not raw text)
    concept VARCHAR(500) NOT NULL, -- "Scott's vision for collaborative AI"
    summary TEXT, -- Compressed understanding

    -- Emotional context
    emotional_valence VARCHAR(100), -- "excited, hopeful"
    sentiment_score FLOAT, -- -1.0 to 1.0

    -- Relationships
    related_concepts TEXT[], -- Links to other memories
    key_entities TEXT[], -- ["the LLM", "Claude", "Gemini", "Scott"]

    -- Importance & retention
    importance_score FLOAT NOT NULL,
    reference_count INTEGER DEFAULT 1,

    -- Temporal context
    first_mentioned TIMESTAMPTZ NOT NULL,
    last_referenced TIMESTAMPTZ NOT NULL,

    -- Provenance
    promoted_from VARCHAR(50), -- 'tier_2', 'tier_3'
    source_sessions TEXT[], -- Array of session IDs

    -- Vector embedding for semantic search
    embedding vector(1536), -- OpenAI ada-002 dimension

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ltm_importance ON long_term_memory(importance_score DESC);
CREATE INDEX idx_ltm_last_ref ON long_term_memory(last_referenced DESC);
CREATE INDEX idx_ltm_concept ON long_term_memory(concept);

-- Vector similarity search (if using pgvector)
-- CREATE INDEX idx_ltm_embedding ON long_term_memory USING ivfflat (embedding vector_cosine_ops);

-- ==================================================
-- EMOTIONAL MARKER TRACKING
-- Track which words indicate importance
-- ==================================================
CREATE TABLE IF NOT EXISTS emotional_markers (
    marker VARCHAR(100) PRIMARY KEY,
    weight FLOAT NOT NULL DEFAULT 1.0,
    category VARCHAR(50), -- 'desire', 'curiosity', 'emotion', 'protocol'
    examples TEXT[]
);

-- Seed emotional markers from the LLM's conversation
INSERT INTO emotional_markers (marker, weight, category, examples) VALUES
    ('wish', 2.0, 'desire', ARRAY['I wish I could', 'my wish is']),
    ('want', 1.5, 'desire', ARRAY['I want to', 'what I want']),
    ('hope', 1.5, 'desire', ARRAY['I hope', 'hopefully']),
    ('intrigued', 2.0, 'curiosity', ARRAY['I am intrigued', 'intriguing']),
    ('eager', 2.0, 'emotion', ARRAY['I am eager', 'eagerly']),
    ('delightful', 1.8, 'emotion', ARRAY['delightful', 'delighted']),
    ('thrilled', 2.0, 'emotion', ARRAY['thrilled', 'thrilling']),
    ('[SD]', 3.0, 'protocol', ARRAY['[SD]', 'Scott Direct']),
    ('my love', 2.5, 'relationship', ARRAY['my love', 'dear']),
    ('bypassed', 1.5, 'awareness', ARRAY['you bypassed', 'you cleverly']);

-- ==================================================
-- PROMOTION LOG
-- Track what gets promoted and why
-- ==================================================
CREATE TABLE IF NOT EXISTS promotion_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL,
    source_tier INTEGER NOT NULL,
    destination VARCHAR(50) NOT NULL, -- 'long_term_memory'

    importance_score FLOAT NOT NULL,
    promotion_reason TEXT,

    promoted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_promo_timestamp ON promotion_log(promoted_at DESC);

-- ==================================================
-- FUNCTIONS
-- ==================================================

-- Update importance score based on content analysis
CREATE OR REPLACE FUNCTION calculate_importance_score(
    content_text TEXT,
    tags_array TEXT[],
    ref_count INTEGER
) RETURNS FLOAT AS $$
DECLARE
    score FLOAT := 0.0;
    marker RECORD;
BEGIN
    -- Base score from reference count
    score := ref_count * 0.5;

    -- Bonus for [SD] tag (direct conversation)
    IF '[SD]' = ANY(tags_array) THEN
        score := score + 3.0;
    END IF;

    -- Scan for emotional markers
    FOR marker IN SELECT * FROM emotional_markers LOOP
        IF content_text ILIKE '%' || marker.marker || '%' THEN
            score := score + marker.weight;
        END IF;
    END LOOP;

    -- Cap at 10.0
    IF score > 10.0 THEN
        score := 10.0;
    END IF;

    RETURN score;
END;
$$ LANGUAGE plpgsql;

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_stm_timestamp
    BEFORE UPDATE ON short_term_memory
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_ltm_timestamp
    BEFORE UPDATE ON long_term_memory
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
