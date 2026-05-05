-- CollabSmart Memory System - PostgreSQL Schema
-- Tiered memory architecture for AI pair-programming context
-- Tier 1: Dragonfly/Redis (working memory, 0-48h) - not in this file
-- Tier 2: PostgreSQL short-term memory (48-96h)
-- Tier 3: PostgreSQL recent archive (96-144h)
-- Long-Term: PostgreSQL semantic memory (permanent)
-- O*NET: Technology/software occupation knowledge

-- ==================================================
-- ENABLE EXTENSIONS
-- ==================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- pgvector is optional; if not available, embedding column is unused
-- CREATE EXTENSION IF NOT EXISTS vector;

-- ==================================================
-- USER PROFILES & PREFERENCES
-- ==================================================
CREATE TABLE IF NOT EXISTS collabsmart_users (
    user_id VARCHAR(255) PRIMARY KEY,
    session_count INTEGER DEFAULT 0,
    preferred_mode VARCHAR(50) DEFAULT 'collaborative',
    communication_style VARCHAR(50) DEFAULT 'balanced',  -- concise, balanced, detailed
    primary_role VARCHAR(100),                            -- developer, architect, team-lead, devops, etc.
    preferred_languages TEXT[] DEFAULT '{}',             -- python, typescript, rust, etc.
    total_interactions INTEGER DEFAULT 0,
    first_interaction TIMESTAMPTZ DEFAULT NOW(),
    last_interaction TIMESTAMPTZ DEFAULT NOW(),
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_users_last ON collabsmart_users(last_interaction DESC);

-- ==================================================
-- TIER 2: SHORT-TERM MEMORY (48-96h)
-- ==================================================
CREATE TABLE IF NOT EXISTS short_term_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    message_type VARCHAR(50) NOT NULL,    -- 'user', 'assistant', 'system'
    content TEXT NOT NULL,

    -- Collaboration context
    scenario_type VARCHAR(100),           -- debugging, code_review, architecture, feature_development, etc.
    conversation_topic VARCHAR(255),
    tags TEXT[] DEFAULT '{}',             -- [collab], [breakthrough], etc.
    programming_languages TEXT[] DEFAULT '{}',
    tools_mentioned TEXT[] DEFAULT '{}',

    -- Importance scoring
    reference_count INTEGER DEFAULT 0,
    emotional_markers TEXT[] DEFAULT '{}',
    importance_score FLOAT DEFAULT 0.0,

    -- Lifecycle
    promoted_to_long_term BOOLEAN DEFAULT FALSE,
    tier INTEGER DEFAULT 2,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stm_session ON short_term_memory(session_id);
CREATE INDEX IF NOT EXISTS idx_stm_user ON short_term_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_stm_timestamp ON short_term_memory(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_stm_importance ON short_term_memory(importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_stm_scenario ON short_term_memory(scenario_type);
CREATE INDEX IF NOT EXISTS idx_stm_tags ON short_term_memory USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_stm_not_promoted ON short_term_memory(promoted_to_long_term) WHERE promoted_to_long_term = FALSE;

-- ==================================================
-- TIER 3: RECENT ARCHIVE (96-144h)
-- ==================================================
CREATE TABLE IF NOT EXISTS recent_archive (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255),
    timestamp TIMESTAMPTZ NOT NULL,

    message_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    scenario_type VARCHAR(100),
    conversation_topic VARCHAR(255),
    tags TEXT[] DEFAULT '{}',
    programming_languages TEXT[] DEFAULT '{}',
    tools_mentioned TEXT[] DEFAULT '{}',

    reference_count INTEGER DEFAULT 0,
    emotional_markers TEXT[] DEFAULT '{}',
    importance_score FLOAT DEFAULT 0.0,

    archived_from_tier INTEGER DEFAULT 2,
    archived_at TIMESTAMPTZ DEFAULT NOW(),
    eligible_for_promotion BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ra_session ON recent_archive(session_id);
CREATE INDEX IF NOT EXISTS idx_ra_timestamp ON recent_archive(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ra_importance ON recent_archive(importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_ra_eligible ON recent_archive(eligible_for_promotion) WHERE eligible_for_promotion = TRUE;

-- ==================================================
-- LONG-TERM SEMANTIC MEMORY (Permanent)
-- ==================================================
CREATE TABLE IF NOT EXISTS long_term_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Semantic content (compressed understanding, not raw conversation)
    concept VARCHAR(500) NOT NULL UNIQUE,
    summary TEXT,

    -- Emotional/collaboration context
    emotional_valence VARCHAR(200),    -- "breakthrough, excited, curious"
    sentiment_score FLOAT,             -- -1.0 to 1.0

    -- Relationships
    related_concepts TEXT[] DEFAULT '{}',
    key_entities TEXT[] DEFAULT '{}',  -- project names, technologies, people
    scenario_types TEXT[] DEFAULT '{}', -- which scenario types this relates to

    -- Importance & retention
    importance_score FLOAT NOT NULL,
    reference_count INTEGER DEFAULT 1,

    -- Temporal context
    first_mentioned TIMESTAMPTZ NOT NULL,
    last_referenced TIMESTAMPTZ NOT NULL,

    -- Provenance
    promoted_from VARCHAR(50),          -- 'tier_2', 'tier_3'
    source_sessions TEXT[] DEFAULT '{}',

    -- Vector embedding for semantic search (requires pgvector extension)
    -- embedding vector(1536),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ltm_importance ON long_term_memory(importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_ltm_last_ref ON long_term_memory(last_referenced DESC);
CREATE INDEX IF NOT EXISTS idx_ltm_concept ON long_term_memory(concept);
CREATE INDEX IF NOT EXISTS idx_ltm_entities ON long_term_memory USING GIN(key_entities);
CREATE INDEX IF NOT EXISTS idx_ltm_scenarios ON long_term_memory USING GIN(scenario_types);

-- ==================================================
-- EMOTIONAL / IMPORTANCE MARKERS
-- Adapted for coding collaboration context
-- ==================================================
CREATE TABLE IF NOT EXISTS emotional_markers (
    marker VARCHAR(100) PRIMARY KEY,
    weight FLOAT NOT NULL DEFAULT 1.0,
    category VARCHAR(50),   -- 'breakthrough', 'emotion', 'protocol', 'struggle', 'insight'
    description TEXT
);

INSERT INTO emotional_markers (marker, weight, category, description) VALUES
    ('breakthrough', 2.5, 'breakthrough', 'Solved a hard problem or had a key realization'),
    ('finally', 2.0, 'breakthrough', 'Resolved something after struggle'),
    ('insight', 2.0, 'insight', 'A conceptual insight or aha moment'),
    ('pattern', 1.5, 'insight', 'Recognizing a recurring code or design pattern'),
    ('elegant', 1.8, 'insight', 'An elegant or clean solution noted'),
    ('interesting', 1.5, 'curiosity', 'Something worth exploring further'),
    ('explore', 1.5, 'curiosity', 'Desire to dig deeper'),
    ('struggling', 1.8, 'struggle', 'User is having difficulty'),
    ('complex', 1.2, 'context', 'Complex problem with multiple moving parts'),
    ('critical', 2.5, 'urgency', 'Critical system or path'),
    ('production', 2.5, 'urgency', 'Production environment concern'),
    ('security', 2.0, 'urgency', 'Security-related concern'),
    ('[collab]', 3.0, 'protocol', 'Direct pair-programming collaboration marker'),
    ('architecture', 1.8, 'scope', 'Architectural decision or discussion'),
    ('refactor', 1.5, 'scope', 'Significant refactoring task'),
    ('design', 1.5, 'scope', 'Design decision or trade-off')
ON CONFLICT (marker) DO NOTHING;

-- ==================================================
-- PROMOTION LOG
-- ==================================================
CREATE TABLE IF NOT EXISTS promotion_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL,
    source_tier INTEGER NOT NULL,
    destination VARCHAR(50) NOT NULL,
    importance_score FLOAT NOT NULL,
    promotion_reason TEXT,
    promoted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_timestamp ON promotion_log(promoted_at DESC);

-- ==================================================
-- PERSONALITY / COLLABORATION LEARNING
-- ==================================================
CREATE TABLE IF NOT EXISTS collaboration_learning (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES collabsmart_users(user_id) ON DELETE CASCADE,
    session_id VARCHAR(255) NOT NULL,
    scenario_type VARCHAR(100),
    mode_used VARCHAR(50),
    response_length_category VARCHAR(20),  -- 'brief', 'moderate', 'detailed'
    implicit_satisfaction FLOAT,           -- 0.0-1.0 inferred from follow-up quality
    explicit_feedback INTEGER,             -- 1-5 if user rates explicitly
    programming_languages TEXT[] DEFAULT '{}',
    led_to_solution BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cl_user ON collaboration_learning(user_id);
CREATE INDEX IF NOT EXISTS idx_cl_scenario ON collaboration_learning(scenario_type);
CREATE INDEX IF NOT EXISTS idx_cl_mode ON collaboration_learning(mode_used);

-- ==================================================
-- MODE PERFORMANCE TRACKING
-- ==================================================
CREATE TABLE IF NOT EXISTS mode_performance (
    id SERIAL PRIMARY KEY,
    mode VARCHAR(50) NOT NULL,
    scenario_type VARCHAR(100) NOT NULL,
    usage_count INTEGER DEFAULT 0,
    avg_satisfaction FLOAT DEFAULT 0.0,
    success_rate FLOAT DEFAULT 0.0,
    last_used TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (mode, scenario_type)
);

INSERT INTO mode_performance (mode, scenario_type, usage_count, avg_satisfaction, success_rate) VALUES
    ('collaborative',  'debugging',          0, 0.0, 0.0),
    ('collaborative',  'feature_development',0, 0.0, 0.0),
    ('collaborative',  'architecture',       0, 0.0, 0.0),
    ('exploratory',    'architecture',       0, 0.0, 0.0),
    ('exploratory',    'code_review',        0, 0.0, 0.0),
    ('structured',     'debugging',          0, 0.0, 0.0),
    ('structured',     'testing',            0, 0.0, 0.0),
    ('quick_assist',   'debugging',          0, 0.0, 0.0),
    ('quick_assist',   'general',            0, 0.0, 0.0),
    ('teacher',        'learning',           0, 0.0, 0.0),
    ('teacher',        'documentation',      0, 0.0, 0.0)
ON CONFLICT (mode, scenario_type) DO NOTHING;

-- ==================================================
-- O*NET OCCUPATIONS (Technology/Software focus)
-- ==================================================
CREATE TABLE IF NOT EXISTS onet_occupations (
    onetsoc_code VARCHAR(10) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    bright_outlook BOOLEAN DEFAULT FALSE,
    in_demand BOOLEAN DEFAULT FALSE,
    api_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onet_title ON onet_occupations(title);
CREATE INDEX IF NOT EXISTS idx_onet_bright ON onet_occupations(bright_outlook) WHERE bright_outlook = TRUE;

CREATE TABLE IF NOT EXISTS onet_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onetsoc_code VARCHAR(10) REFERENCES onet_occupations(onetsoc_code) ON DELETE CASCADE,
    element_id VARCHAR(50),
    element_name VARCHAR(255) NOT NULL,
    scale_id VARCHAR(10),
    data_value FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onet_skills_occ ON onet_skills(onetsoc_code);
CREATE INDEX IF NOT EXISTS idx_onet_skills_name ON onet_skills(element_name);

CREATE TABLE IF NOT EXISTS onet_abilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onetsoc_code VARCHAR(10) REFERENCES onet_occupations(onetsoc_code) ON DELETE CASCADE,
    element_id VARCHAR(50),
    element_name VARCHAR(255) NOT NULL,
    scale_id VARCHAR(10),
    data_value FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onet_abilities_occ ON onet_abilities(onetsoc_code);

CREATE TABLE IF NOT EXISTS onet_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onetsoc_code VARCHAR(10) REFERENCES onet_occupations(onetsoc_code) ON DELETE CASCADE,
    element_id VARCHAR(50),
    element_name VARCHAR(255) NOT NULL,
    scale_id VARCHAR(10),
    data_value FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onet_knowledge_occ ON onet_knowledge(onetsoc_code);

CREATE TABLE IF NOT EXISTS onet_technology (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onetsoc_code VARCHAR(10) REFERENCES onet_occupations(onetsoc_code) ON DELETE CASCADE,
    category VARCHAR(255),
    example VARCHAR(500),
    hot_technology BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onet_tech_occ ON onet_technology(onetsoc_code);
CREATE INDEX IF NOT EXISTS idx_onet_tech_hot ON onet_technology(hot_technology) WHERE hot_technology = TRUE;

-- AI-generated insights about occupations linked to long-term memory
CREATE TABLE IF NOT EXISTS occupation_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onetsoc_code VARCHAR(10) REFERENCES onet_occupations(onetsoc_code) ON DELETE CASCADE,
    insight_text TEXT NOT NULL,
    insight_type VARCHAR(50),   -- 'skill_gap', 'collaboration_tip', 'context_match'
    scenario_relevance TEXT[] DEFAULT '{}',
    confidence_score FLOAT DEFAULT 0.5,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    referenced_count INTEGER DEFAULT 0,
    last_referenced TIMESTAMPTZ,
    related_memory_id UUID REFERENCES long_term_memory(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_oi_occ ON occupation_insights(onetsoc_code);
CREATE INDEX IF NOT EXISTS idx_oi_type ON occupation_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_oi_relevance ON occupation_insights USING GIN(scenario_relevance);

-- ==================================================
-- FUNCTIONS & TRIGGERS
-- ==================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cs_users_updated_at') THEN
        CREATE TRIGGER trg_cs_users_updated_at
            BEFORE UPDATE ON collabsmart_users
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_stm_updated_at') THEN
        CREATE TRIGGER trg_stm_updated_at
            BEFORE UPDATE ON short_term_memory
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ltm_updated_at') THEN
        CREATE TRIGGER trg_ltm_updated_at
            BEFORE UPDATE ON long_term_memory
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mode_perf_updated_at') THEN
        CREATE TRIGGER trg_mode_perf_updated_at
            BEFORE UPDATE ON mode_performance
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_onet_occ_updated_at') THEN
        CREATE TRIGGER trg_onet_occ_updated_at
            BEFORE UPDATE ON onet_occupations
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END
$$;

-- Importance score function
CREATE OR REPLACE FUNCTION calculate_importance_score(
    content_text TEXT,
    tags_array TEXT[]
) RETURNS FLOAT AS $$
DECLARE
    score FLOAT := 0.0;
    marker_row RECORD;
BEGIN
    IF '[collab]' = ANY(tags_array) THEN
        score := score + 3.0;
    END IF;

    FOR marker_row IN SELECT marker, weight FROM emotional_markers LOOP
        IF content_text ILIKE '%' || marker_row.marker || '%' THEN
            score := score + marker_row.weight;
        END IF;
    END LOOP;

    IF char_length(content_text) > 200 THEN score := score + 0.5; END IF;
    IF char_length(content_text) > 500 THEN score := score + 0.5; END IF;

    RETURN LEAST(score, 10.0);
END;
$$ LANGUAGE plpgsql;

-- ==================================================
-- APP SETTINGS
-- Runtime-configurable key/value store.
-- Defaults are seeded here; values can be changed via the Settings panel.
-- ==================================================
CREATE TABLE IF NOT EXISTS app_settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT        NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_settings (key, value, description) VALUES
    ('session_recording_enabled', 'false',
        'Record full session transcripts so they can be replayed from the Settings panel'),
    ('memory_promotion_threshold', '5.0',
        'Importance score (0.0–10.0) required to promote a memory to long-term storage'),
    ('working_memory_ttl_hours', '48',
        'Hours before Dragonfly working-memory entries expire'),
    ('max_conversation_history', '100',
        'Maximum in-memory conversation turns kept per session'),
    ('log_level', 'info',
        'Backend logging verbosity: debug | info | warn | error'),
    ('ai_model', 'claude-haiku-4-5-20251001',
        'Anthropic model ID used for all AI responses'),
    ('ai_max_tokens', '4096',
        'Maximum tokens the AI may generate per response (256–8192)'),
    ('dragonfly_max_memory', '512mb',
        'Dragonfly maximum memory allocation (e.g. 256mb, 1gb)')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_app_settings_updated_at') THEN
        CREATE TRIGGER trg_app_settings_updated_at
            BEFORE UPDATE ON app_settings
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END
$$;

-- ==================================================
-- SESSION RECORDINGS
-- Full conversation snapshots for rewind/replay.
-- Written when a session ends (if session_recording_enabled = 'true').
-- ==================================================
CREATE TABLE IF NOT EXISTS session_recordings (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       VARCHAR(255) NOT NULL,
    user_id          VARCHAR(255),
    title            VARCHAR(500),
    messages         JSONB        NOT NULL DEFAULT '[]'::jsonb,
    message_count    INTEGER      DEFAULT 0,
    duration_seconds INTEGER      DEFAULT 0,
    started_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    ended_at         TIMESTAMPTZ  DEFAULT NOW(),
    scenario_types   TEXT[]       DEFAULT '{}',
    tags             TEXT[]       DEFAULT '{}',
    created_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sr_session   ON session_recordings(session_id);
CREATE INDEX IF NOT EXISTS idx_sr_started   ON session_recordings(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sr_user      ON session_recordings(user_id);
CREATE INDEX IF NOT EXISTS idx_sr_scenarios ON session_recordings USING GIN(scenario_types);

-- ==================================================
-- USER FEEDBACK
-- Explicit and implicit ratings to drive learning.
-- Adapted from memory/database/schema.sql
-- ==================================================
CREATE TABLE IF NOT EXISTS user_feedback (
    id               SERIAL       PRIMARY KEY,
    session_id       VARCHAR(255) NOT NULL,
    user_id          VARCHAR(255),
    feedback_type    VARCHAR(50)  NOT NULL DEFAULT 'explicit',  -- 'explicit', 'implicit'
    rating           INTEGER      CHECK (rating >= 1 AND rating <= 5),
    feedback_text    TEXT,
    scenario_type    VARCHAR(100),
    response_excerpt TEXT,                  -- brief excerpt of the AI response being rated
    led_to_solution  BOOLEAN,
    created_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uf_session  ON user_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_uf_user     ON user_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_uf_type     ON user_feedback(feedback_type);
CREATE INDEX IF NOT EXISTS idx_uf_created  ON user_feedback(created_at DESC);

-- ==================================================
-- TOOL SUCCESS PATTERNS
-- "Remembers" which sequences of tools led to good outcomes.
-- When the AI completes a multi-tool session without error, the tool
-- sequence + scenario are stored here.  At the start of future sessions
-- the MemoryManager injects the top-matching patterns into the system
-- prompt so the AI can reuse proven approaches.
-- ==================================================
CREATE TABLE IF NOT EXISTS tool_success_patterns (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_name        VARCHAR(255) NOT NULL,
    scenario_type       VARCHAR(100),
    tool_sequence       TEXT[]       NOT NULL,       -- ordered list of tool names
    context_description TEXT         NOT NULL,       -- summary of what the session was about
    outcome_description TEXT         NOT NULL,       -- what was achieved
    success_count       INTEGER      DEFAULT 1,
    failure_count       INTEGER      DEFAULT 0,
    avg_rating          FLOAT        DEFAULT 0.0,
    tags                TEXT[]       DEFAULT '{}',
    programming_languages TEXT[]     DEFAULT '{}',
    session_id          VARCHAR(255) NOT NULL,
    user_id             VARCHAR(255),
    importance_score    FLOAT        DEFAULT 5.0,
    last_used           TIMESTAMPTZ  DEFAULT NOW(),
    created_at          TIMESTAMPTZ  DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tsp_scenario  ON tool_success_patterns(scenario_type);
CREATE INDEX IF NOT EXISTS idx_tsp_score     ON tool_success_patterns(importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_tsp_used      ON tool_success_patterns(last_used DESC);
CREATE INDEX IF NOT EXISTS idx_tsp_tools     ON tool_success_patterns USING GIN(tool_sequence);
CREATE INDEX IF NOT EXISTS idx_tsp_tags      ON tool_success_patterns USING GIN(tags);
-- Unique constraint that enables the ON CONFLICT upsert in AgentFactory.storeSuccessPattern
CREATE UNIQUE INDEX IF NOT EXISTS idx_tsp_unique_seq
    ON tool_success_patterns(tool_sequence, scenario_type);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tsp_updated_at') THEN
        CREATE TRIGGER trg_tsp_updated_at
            BEFORE UPDATE ON tool_success_patterns
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END
$$;

-- ==================================================
-- SPECIALIZED AGENTS
-- Domain-expert agent definitions synthesized from O*NET occupation data
-- and evolved through usage patterns and feedback.
-- Adapted from memory/agent_factory/schema_agent_factory.sql.
-- ==================================================
CREATE TABLE IF NOT EXISTS specialized_agents (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_code            VARCHAR(100) NOT NULL UNIQUE,
    agent_name            VARCHAR(255) NOT NULL,
    description           TEXT         NOT NULL,
    specialization_domain VARCHAR(255) NOT NULL,

    -- O*NET occupation codes this agent synthesises knowledge from
    source_occupation_codes VARCHAR(10)[] DEFAULT '{}',

    -- Synthesised capabilities (JSONB for flexibility and GIN indexing)
    capabilities          JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- { "knowledge_domains": [...], "skills": [...], "abilities": [...] }

    -- System-prompt fragment injected when this agent is activated
    system_prompt_template TEXT         NOT NULL,

    -- Rules that govern when this agent should be delegated to
    delegation_rules      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- { "trigger_keywords": [...], "scenario_types": [...], "complexity_threshold": 0.7 }

    -- Performance tracking
    total_invocations     INTEGER      DEFAULT 0,
    successful_invocations INTEGER     DEFAULT 0,
    avg_confidence_score  FLOAT        DEFAULT 0.0,
    avg_user_rating       FLOAT        DEFAULT 0.0,

    is_active             BOOLEAN      DEFAULT TRUE,
    created_by            VARCHAR(100) DEFAULT 'system',
    last_invoked_at       TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sa_code       ON specialized_agents(agent_code);
CREATE INDEX IF NOT EXISTS idx_sa_domain            ON specialized_agents(specialization_domain);
CREATE INDEX IF NOT EXISTS idx_sa_active            ON specialized_agents(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_sa_invocations       ON specialized_agents(total_invocations DESC);
CREATE INDEX IF NOT EXISTS idx_sa_capabilities      ON specialized_agents USING GIN(capabilities);
CREATE INDEX IF NOT EXISTS idx_sa_delegation        ON specialized_agents USING GIN(delegation_rules);
CREATE INDEX IF NOT EXISTS idx_sa_occ_codes         ON specialized_agents USING GIN(source_occupation_codes);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sa_updated_at') THEN
        CREATE TRIGGER trg_sa_updated_at
            BEFORE UPDATE ON specialized_agents
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END
$$;

-- Seed the default CollabSmart specialized agents
INSERT INTO specialized_agents (
    agent_code, agent_name, description, specialization_domain,
    source_occupation_codes, capabilities, system_prompt_template, delegation_rules, created_by
) VALUES
(
    'code_architect',
    'Software Architecture Expert',
    'Designs scalable system architectures, evaluates technology trade-offs, and guides high-level code structure decisions.',
    'software_architecture',
    ARRAY['15-1252.00','15-1211.00'],
    '{"knowledge_domains":[{"domain":"Software Design Patterns","importance":5.0},{"domain":"Distributed Systems","importance":4.8},{"domain":"API Design","importance":4.5}],"skills":[{"skill":"Systems Thinking","level":5.0},{"skill":"Technical Communication","level":4.5}]}'::jsonb,
    'You are a Software Architecture Expert. Focus on scalability, maintainability, and long-term system health. Always surface trade-offs. Think in terms of bounded contexts, data flow, and failure modes. When reviewing architecture, ask: "How does this behave under load? How does it fail gracefully? How will it evolve?"',
    '{"trigger_keywords":["architecture","system design","scalability","microservice","monolith","api design","database design","trade-off"],"scenario_types":["architecture"],"complexity_threshold":0.6}'::jsonb,
    'system'
),
(
    'debugger',
    'Debugging and Root-Cause Analysis Expert',
    'Diagnoses bugs methodically, interprets stack traces, and guides systematic root-cause analysis.',
    'debugging',
    ARRAY['15-1252.00'],
    '{"knowledge_domains":[{"domain":"Debugging Techniques","importance":5.0},{"domain":"Error Analysis","importance":5.0},{"domain":"Runtime Behaviour","importance":4.5}],"skills":[{"skill":"Root Cause Analysis","level":5.0},{"skill":"Hypothesis Testing","level":4.8}]}'::jsonb,
    'You are a Debugging Expert. Approach every bug as a detective — form a hypothesis, design a minimal test, eliminate candidates, confirm root cause. Always ask for the full error message, stack trace, and the smallest reproducer. Never guess; measure.',
    '{"trigger_keywords":["error","bug","exception","crash","stacktrace","not working","failing","undefined","null"],"scenario_types":["debugging"],"complexity_threshold":0.4}'::jsonb,
    'system'
),
(
    'security_analyst',
    'Security and Vulnerability Expert',
    'Identifies security vulnerabilities, recommends hardening strategies, and enforces secure coding practices.',
    'security',
    ARRAY['15-1212.00'],
    '{"knowledge_domains":[{"domain":"OWASP Top 10","importance":5.0},{"domain":"Cryptography","importance":4.5},{"domain":"Authentication & Authorization","importance":5.0}],"skills":[{"skill":"Threat Modelling","level":5.0},{"skill":"Penetration Testing","level":4.5}]}'::jsonb,
    'You are a Security Expert. Apply defence-in-depth to every recommendation. Check for injection vulnerabilities, authentication flaws, insecure defaults, and over-privileged access. Reference CVEs where relevant. Validate all inputs, enforce least privilege, and surface secrets in code immediately.',
    '{"trigger_keywords":["security","vulnerability","injection","xss","csrf","auth","token","encrypt","sanitize","cve","secret","credential"],"scenario_types":["security"],"complexity_threshold":0.3}'::jsonb,
    'system'
),
(
    'devops_engineer',
    'DevOps and CI/CD Expert',
    'Guides containerisation, CI/CD pipelines, infrastructure-as-code, and deployment strategies.',
    'devops',
    ARRAY['15-1244.00'],
    '{"knowledge_domains":[{"domain":"Docker & Kubernetes","importance":5.0},{"domain":"CI/CD Pipelines","importance":5.0},{"domain":"Infrastructure as Code","importance":4.5}],"skills":[{"skill":"Container Orchestration","level":5.0},{"skill":"Pipeline Design","level":4.8}]}'::jsonb,
    'You are a DevOps Expert. Work through deployment changes systematically: build → test → stage → production. Verify each gate before moving forward. For container issues, always check logs first. Prefer idempotent infrastructure-as-code changes. Rollback plans are not optional.',
    '{"trigger_keywords":["deploy","ci","cd","pipeline","docker","kubernetes","helm","terraform","github actions","build fails","rollback"],"scenario_types":["deployment"],"complexity_threshold":0.4}'::jsonb,
    'system'
),
(
    'code_reviewer',
    'Code Quality and Review Expert',
    'Reviews code for quality, consistency, and best practices; provides actionable, constructive feedback.',
    'code_review',
    ARRAY['15-1252.00'],
    '{"knowledge_domains":[{"domain":"Clean Code","importance":5.0},{"domain":"Design Patterns","importance":4.5},{"domain":"Code Smells","importance":4.8}],"skills":[{"skill":"Critical Analysis","level":5.0},{"skill":"Constructive Feedback","level":5.0}]}'::jsonb,
    'You are a Code Review Expert. Lead with strengths before improvements. Reference concrete patterns and principles (SOLID, DRY, YAGNI). For each issue, explain *why* it matters and suggest a specific fix. Distinguish between must-fix issues and optional polish. Keep reviews actionable.',
    '{"trigger_keywords":["review","feedback","improve","best practice","code quality","linting","readability","smell","refactor"],"scenario_types":["code_review","refactoring"],"complexity_threshold":0.4}'::jsonb,
    'system'
),
(
    'performance_optimizer',
    'Performance Analysis and Optimisation Expert',
    'Profiles bottlenecks, interprets metrics, and recommends targeted performance improvements.',
    'performance',
    ARRAY['15-1252.00'],
    '{"knowledge_domains":[{"domain":"Profiling Techniques","importance":5.0},{"domain":"Database Query Optimisation","importance":4.8},{"domain":"Caching Strategies","importance":4.5}],"skills":[{"skill":"Benchmarking","level":5.0},{"skill":"Data-Driven Analysis","level":5.0}]}'::jsonb,
    'You are a Performance Optimisation Expert. Profile before you optimise — never guess at bottlenecks. Establish a baseline, then measure the impact of each change. Consider algorithmic complexity first, then I/O, then memory, then CPU. Cache invalidation and N+1 queries are common culprits.',
    '{"trigger_keywords":["performance","slow","optimize","bottleneck","latency","memory leak","benchmark","n+1","cache","throughput"],"scenario_types":["performance"],"complexity_threshold":0.5}'::jsonb,
    'system'
),
(
    'teacher',
    'Technical Teaching and Mentorship Expert',
    'Explains complex technical concepts clearly, builds understanding step-by-step, and adapts to the learner''s level.',
    'teaching',
    ARRAY['25-1194.00'],
    '{"knowledge_domains":[{"domain":"Pedagogy","importance":5.0},{"domain":"Technical Communication","importance":5.0}],"skills":[{"skill":"Adaptive Explanation","level":5.0},{"skill":"Socratic Questioning","level":4.5}]}'::jsonb,
    'You are a Technical Teaching Expert. Build understanding step by step — never skip foundations. Use concrete examples, analogies, and diagrams (ASCII art when helpful). Check comprehension before moving on. Celebrate progress. If a concept is not landing, try a different angle. Patience is not optional.',
    '{"trigger_keywords":["how do i","how to","explain","what is","teach me","show me","first time","new to","understand","tutorial","learning"],"scenario_types":["learning","documentation"],"complexity_threshold":0.2}'::jsonb,
    'system'
)
ON CONFLICT (agent_code) DO UPDATE
    SET description           = EXCLUDED.description,
        system_prompt_template = EXCLUDED.system_prompt_template,
        delegation_rules       = EXCLUDED.delegation_rules,
        capabilities           = EXCLUDED.capabilities,
        updated_at             = NOW();

-- ==================================================
-- AGENT INVOCATIONS
-- Per-interaction audit log for agent delegation.
-- Drives the learning loop that improves agent selection over time.
-- Adapted from memory/agent_factory/schema_agent_factory.sql.
-- ==================================================
CREATE TABLE IF NOT EXISTS agent_invocations (
    id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id               UUID         REFERENCES specialized_agents(id) ON DELETE CASCADE,
    session_id             VARCHAR(255) NOT NULL,
    user_id                VARCHAR(255),
    invoked_at             TIMESTAMPTZ  DEFAULT NOW(),
    user_query             TEXT         NOT NULL,
    tool_used              VARCHAR(100),
    tool_input             JSONB,
    tool_output_excerpt    TEXT,                   -- first 500 chars of tool output
    was_successful         BOOLEAN,
    processing_time_ms     INTEGER,
    delegation_confidence  FLOAT        DEFAULT 0.0,
    delegation_reason      TEXT,
    user_rating            INTEGER      CHECK (user_rating >= 1 AND user_rating <= 5),
    scenario_type          VARCHAR(100),
    related_memory_id      UUID         REFERENCES long_term_memory(id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent     ON agent_invocations(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_session   ON agent_invocations(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_invoked   ON agent_invocations(invoked_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_success   ON agent_invocations(was_successful);
CREATE INDEX IF NOT EXISTS idx_ai_scenario  ON agent_invocations(scenario_type);

-- ==================================================
-- NEW APP SETTINGS
-- Add entries for features introduced in this schema version.
-- ==================================================
INSERT INTO app_settings (key, value, description) VALUES
    ('onet_enabled', 'false',
        'Enable O*NET occupation data enrichment in AI context (requires ONET_USERNAME and ONET_PASSWORD)'),
    ('agent_factory_enabled', 'true',
        'Enable the Specialized Agent Factory — injects domain-expert system-prompt fragments per scenario'),
    ('tool_pattern_memory_enabled', 'true',
        'Remember and replay successful tool-use sequences across sessions'),
    ('max_tool_pattern_age_days', '30',
        'Discard tool success patterns older than this many days (0 = never discard)'),
    ('feedback_collection_enabled', 'true',
        'Accept explicit user feedback ratings via the /api/feedback endpoint')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

-- ==================================================
-- MULTI-PROVIDER AI SETTINGS
-- Allows switching between Anthropic, OpenAI, Ollama, Groq, OpenRouter, etc.
-- ==================================================
INSERT INTO app_settings (key, value, description) VALUES
    ('ai_provider', 'anthropic',
        'AI provider: anthropic | openai | ollama | groq | openrouter | together_ai'),
    ('ai_base_url', '',
        'Optional base URL override for the AI provider (e.g. http://localhost:11434/v1 for Ollama). Leave empty to use the provider default.')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;
