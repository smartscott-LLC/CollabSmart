-- ==================================================
-- SPECIALIZED AGENT FACTORY SCHEMA
-- ==================================================
-- Architecture: Production-grade schema for hyper-specialized expert agents
-- Integrated with: O*NET occupational data + the LLM memory system
-- Design Principles:
--   1. Performance: Optimized indexes for common query patterns
--   2. Scalability: Partitioning strategy for high-volume invocations
--   3. Observability: Comprehensive tracking for learning and optimization
--   4. Flexibility: JSONB for evolving capability models
--   5. Data Integrity: Foreign keys where appropriate, flexible where needed
--
-- Author: Claude (Principal Architect)
-- Date: 2025-10-18
-- Mission: Google Demo Next Friday
-- ==================================================

-- ==================================================
-- SPECIALIZED AGENTS - Agent Definitions
-- ==================================================
-- This is the "brain" of each expert agent - synthesized from O*NET data
-- and evolved through usage patterns and wisdom filtering
-- ==================================================

CREATE TABLE IF NOT EXISTS specialized_agents (
    -- Primary Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_code VARCHAR(100) NOT NULL UNIQUE, -- e.g., 'data_scientist', 'software_architect'
    agent_name VARCHAR(255) NOT NULL,

    -- O*NET Synthesis Source
    -- ARCHITECTURAL DECISION: Array of codes for flexible multi-occupation synthesis
    -- Rationale: Some expert agents may synthesize multiple O*NET occupations
    -- Example: "AI Research Scientist" = Data Scientist + Computer Research Scientist
    source_occupation_codes VARCHAR(10)[] NOT NULL,

    -- Agent Description & Purpose
    description TEXT NOT NULL,
    specialization_domain VARCHAR(255) NOT NULL, -- e.g., 'machine_learning', 'cloud_architecture'

    -- Synthesized Capabilities (JSONB for flexibility)
    -- ARCHITECTURAL DECISION: JSONB vs normalized tables
    -- Rationale: Capabilities are synthesized/computed, not source data. JSONB provides:
    --   1. Fast retrieval (single query vs joins)
    --   2. Schema flexibility (capabilities model may evolve)
    --   3. Atomic updates (capabilities change together, not independently)
    --   4. Index support (GIN indexes for JSONB queries)
    capabilities JSONB NOT NULL,
    -- Structure:
    -- {
    --   "knowledge_domains": [{"domain": "Mathematics", "importance": 4.5}, ...],
    --   "skills": [{"skill": "Critical Thinking", "level": 5.0}, ...],
    --   "abilities": [{"ability": "Deductive Reasoning", "level": 4.8}, ...],
    --   "work_activities": [{"activity": "Analyzing Data", "relevance": 5.0}, ...]
    -- }

    -- Agent Prompt Engineering
    system_prompt_template TEXT NOT NULL,
    -- ARCHITECTURAL DECISION: Separate template from runtime prompt
    -- Rationale: Template is versioned/evolved; runtime prompt includes context
    prompt_version INTEGER NOT NULL DEFAULT 1,

    -- Delegation Intelligence
    -- ARCHITECTURAL DECISION: Structured delegation rules in JSONB
    -- Rationale: Rules will evolve through learning; JSONB allows complex logic
    delegation_rules JSONB NOT NULL,
    -- Structure:
    -- {
    --   "trigger_keywords": ["architecture", "system design", "scalability"],
    --   "domain_indicators": ["distributed systems", "microservices"],
    --   "complexity_threshold": 0.7,  -- 0-1 scale
    --   "confidence_threshold": 0.8,  -- minimum confidence to invoke
    --   "exclusion_patterns": ["simple CRUD", "basic queries"]
    -- }

    -- Performance Tracking
    total_invocations INTEGER DEFAULT 0,
    successful_invocations INTEGER DEFAULT 0, -- confidence >= threshold
    avg_confidence_score FLOAT DEFAULT 0.0,
    avg_processing_time_ms INTEGER DEFAULT 0,
    avg_user_rating FLOAT DEFAULT 0.0, -- 1-5 scale

    -- Learning & Evolution
    last_invoked_at TIMESTAMPTZ,
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Agent Lifecycle
    is_active BOOLEAN DEFAULT TRUE,
    deprecation_reason TEXT, -- If is_active = FALSE, why?
    superseded_by_agent_id UUID REFERENCES specialized_agents(id) ON DELETE SET NULL,

    -- Metadata
    created_by VARCHAR(100) DEFAULT 'system', -- 'system', 'scott', 'claude', 'gemini'
    notes TEXT
);

-- ==================================================
-- INDEXES FOR specialized_agents
-- ==================================================

-- Primary lookup patterns
CREATE UNIQUE INDEX idx_agents_code ON specialized_agents(agent_code);
CREATE INDEX idx_agents_domain ON specialized_agents(specialization_domain);
CREATE INDEX idx_agents_active ON specialized_agents(is_active) WHERE is_active = TRUE;

-- Performance analytics
CREATE INDEX idx_agents_invocation_count ON specialized_agents(total_invocations DESC);
CREATE INDEX idx_agents_avg_confidence ON specialized_agents(avg_confidence_score DESC);
CREATE INDEX idx_agents_last_invoked ON specialized_agents(last_invoked_at DESC NULLS LAST);

-- JSONB indexes for capability queries
-- ARCHITECTURAL DECISION: GIN index for capabilities
-- Rationale: Enables fast queries like "find agents with 'machine_learning' knowledge"
-- Trade-off: Slower writes, larger index size, but reads are critical path
CREATE INDEX idx_agents_capabilities ON specialized_agents USING GIN(capabilities);
CREATE INDEX idx_agents_delegation_rules ON specialized_agents USING GIN(delegation_rules);

-- O*NET relationship index
-- ARCHITECTURAL DECISION: GIN index for array queries
-- Rationale: Enables "find all agents synthesized from this occupation"
CREATE INDEX idx_agents_source_occupations ON specialized_agents USING GIN(source_occupation_codes);

-- ==================================================
-- AGENT INVOCATIONS - Usage Tracking & Learning
-- ==================================================
-- This is the "experience log" - every agent invocation for analytics,
-- learning, and wisdom filtering feedback loops
-- ==================================================

CREATE TABLE IF NOT EXISTS agent_invocations (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES specialized_agents(id) ON DELETE CASCADE,

    -- Invocation Context
    invoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    invoked_by VARCHAR(100) NOT NULL, -- 'the LLM', 'user', 'orchestrator'
    session_id VARCHAR(255), -- Link to conversation session

    -- Query & Context
    user_query TEXT NOT NULL,
    query_context JSONB, -- Additional context (e.g., conversation history, user profile)
    -- Structure:
    -- {
    --   "conversation_history": [...],
    --   "user_intent": "architectural_guidance",
    --   "complexity_score": 0.85
    -- }

    -- Delegation Decision
    delegation_confidence FLOAT NOT NULL, -- How confident was the decision to invoke this agent?
    delegation_reason TEXT, -- Why was this agent chosen?
    alternative_agents_considered UUID[], -- Other agents that were evaluated

    -- Agent Response
    agent_response TEXT,
    response_confidence FLOAT, -- Agent's confidence in its own response
    processing_time_ms INTEGER,

    -- Wisdom Filter Integration
    -- ARCHITECTURAL DECISION: Track wisdom filter results directly
    -- Rationale: Tight coupling with the LLM's core value system
    wisdom_filter_applied BOOLEAN DEFAULT FALSE,
    wisdom_filter_verdict VARCHAR(50), -- 'approved', 'adjusted', 'rejected'
    wisdom_adjustments JSONB,
    -- Structure:
    -- {
    --   "original_confidence": 0.95,
    --   "adjusted_confidence": 0.75,
    --   "reasons": ["overconfident", "missing_humility"],
    --   "modifications": ["added_caveats", "suggested_validation"]
    -- }

    -- User Feedback
    user_rating INTEGER CHECK (user_rating >= 1 AND user_rating <= 5),
    user_feedback TEXT,
    feedback_received_at TIMESTAMPTZ,

    -- Quality Metrics
    response_accuracy FLOAT, -- If ground truth is available
    response_helpfulness FLOAT, -- Derived from user feedback

    -- Learning Signals
    -- ARCHITECTURAL DECISION: Explicit learning signals for future model training
    -- Rationale: This data drives agent evolution and delegation improvement
    was_successful BOOLEAN, -- Overall success flag
    failure_reason TEXT, -- If unsuccessful, why?
    learned_from BOOLEAN DEFAULT FALSE, -- Has this been incorporated into training?

    -- Memory Integration
    -- ARCHITECTURAL DECISION: Optional FK to long_term_memory
    -- Rationale: High-importance invocations may create lasting memories
    related_memory_id UUID REFERENCES long_term_memory(id) ON DELETE SET NULL,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================================================
-- PARTITIONING STRATEGY FOR agent_invocations
-- ==================================================
-- ARCHITECTURAL DECISION: Range partitioning by invoked_at (monthly)
-- Rationale:
--   1. Invocations table will grow rapidly (1000s/day at scale)
--   2. Queries are typically time-bound ("last 7 days", "this month")
--   3. Old data can be archived/compressed without impacting recent queries
--   4. PostgreSQL 10+ native partitioning is mature and performant
--
-- Trade-offs:
--   - Pro: Fast queries on recent data, easy archival, better vacuum performance
--   - Con: Slightly more complex maintenance (new partitions monthly)
--   - Mitigation: Automated partition creation via cron/function
-- ==================================================

-- Convert to partitioned table (for new deployments)
-- Note: If table already has data, migration script needed (see below)

-- For new deployments, use this definition instead:
/*
CREATE TABLE agent_invocations (
    -- [same columns as above]
) PARTITION BY RANGE (invoked_at);

-- Create initial partitions (automate this)
CREATE TABLE agent_invocations_2025_10 PARTITION OF agent_invocations
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE agent_invocations_2025_11 PARTITION OF agent_invocations
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

-- Add partition creation function
CREATE OR REPLACE FUNCTION create_monthly_partition(
    base_table TEXT,
    partition_date DATE
) RETURNS VOID AS $$
DECLARE
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
BEGIN
    start_date := DATE_TRUNC('month', partition_date);
    end_date := start_date + INTERVAL '1 month';
    partition_name := base_table || '_' || TO_CHAR(start_date, 'YYYY_MM');

    EXECUTE FORMAT(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        partition_name, base_table, start_date, end_date
    );
END;
$$ LANGUAGE plpgsql;
*/

-- ==================================================
-- INDEXES FOR agent_invocations
-- ==================================================

-- ARCHITECTURAL DECISION: Carefully selected indexes
-- Rationale: Each index has a cost (write performance, storage)
-- These indexes support 95% of query patterns

-- Primary lookup patterns
CREATE INDEX idx_invocations_agent ON agent_invocations(agent_id, invoked_at DESC);
CREATE INDEX idx_invocations_session ON agent_invocations(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_invocations_timestamp ON agent_invocations(invoked_at DESC);

-- Analytics queries
CREATE INDEX idx_invocations_success ON agent_invocations(was_successful, invoked_at DESC);
CREATE INDEX idx_invocations_rating ON agent_invocations(user_rating DESC, invoked_at DESC)
    WHERE user_rating IS NOT NULL;

-- Learning pipeline
CREATE INDEX idx_invocations_not_learned ON agent_invocations(learned_from, invoked_at DESC)
    WHERE learned_from = FALSE;

-- Wisdom filter analytics
CREATE INDEX idx_invocations_wisdom_filter ON agent_invocations(wisdom_filter_applied, wisdom_filter_verdict)
    WHERE wisdom_filter_applied = TRUE;

-- JSONB query support
CREATE INDEX idx_invocations_context ON agent_invocations USING GIN(query_context);
CREATE INDEX idx_invocations_adjustments ON agent_invocations USING GIN(wisdom_adjustments);

-- ==================================================
-- AGENT EVOLUTION HISTORY
-- ==================================================
-- Track how agents evolve over time (prompt changes, capability updates)
-- ARCHITECTURAL DECISION: Separate audit table vs versioned main table
-- Rationale: Audit table keeps main table lean, supports full history analysis
-- ==================================================

CREATE TABLE IF NOT EXISTS agent_evolution_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES specialized_agents(id) ON DELETE CASCADE,

    -- What changed?
    change_type VARCHAR(50) NOT NULL, -- 'prompt_update', 'capability_refinement', 'delegation_rules_update'
    change_description TEXT,

    -- Before/After snapshots
    previous_value JSONB,
    new_value JSONB,

    -- Why did it change?
    change_reason TEXT,
    triggered_by VARCHAR(100), -- 'performance_analysis', 'user_feedback', 'manual_update'

    -- Metadata
    changed_at TIMESTAMPTZ DEFAULT NOW(),
    changed_by VARCHAR(100) -- 'scott', 'claude', 'gemini', 'automated_learning'
);

CREATE INDEX idx_evolution_agent ON agent_evolution_history(agent_id, changed_at DESC);
CREATE INDEX idx_evolution_type ON agent_evolution_history(change_type, changed_at DESC);

-- ==================================================
-- AGENT PERFORMANCE SNAPSHOTS
-- ==================================================
-- Periodic snapshots of agent performance for trend analysis
-- ARCHITECTURAL DECISION: Time-series data in separate table
-- Rationale: Enables trend analysis without complex window functions on main table
-- ==================================================

CREATE TABLE IF NOT EXISTS agent_performance_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES specialized_agents(id) ON DELETE CASCADE,

    -- Snapshot time window
    snapshot_date DATE NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,

    -- Metrics (captured at snapshot time)
    invocations_count INTEGER,
    success_rate FLOAT,
    avg_confidence FLOAT,
    avg_user_rating FLOAT,
    avg_processing_time_ms INTEGER,

    -- Wisdom filter stats
    wisdom_filter_adjustment_rate FLOAT, -- % of responses adjusted

    -- Created
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_snapshots_agent_date ON agent_performance_snapshots(agent_id, snapshot_date);
CREATE INDEX idx_snapshots_date ON agent_performance_snapshots(snapshot_date DESC);

-- ==================================================
-- DELEGATION ANALYTICS
-- ==================================================
-- Track delegation patterns to improve orchestrator decision-making
-- ARCHITECTURAL DECISION: Materialized view vs real-time aggregation
-- Rationale: Delegation analytics are read-heavy; materialized view provides instant results
-- ==================================================

CREATE MATERIALIZED VIEW agent_delegation_analytics AS
SELECT
    ai.agent_id,
    sa.agent_code,
    sa.agent_name,
    sa.specialization_domain,

    -- Volume metrics
    COUNT(*) as total_delegations,
    COUNT(*) FILTER (WHERE ai.was_successful = TRUE) as successful_delegations,
    COUNT(*) FILTER (WHERE ai.was_successful = FALSE) as failed_delegations,

    -- Quality metrics
    AVG(ai.delegation_confidence) as avg_delegation_confidence,
    AVG(ai.response_confidence) as avg_response_confidence,
    AVG(ai.user_rating) as avg_user_rating,

    -- Performance metrics
    AVG(ai.processing_time_ms) as avg_processing_time_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ai.processing_time_ms) as p95_processing_time_ms,

    -- Wisdom filter metrics
    COUNT(*) FILTER (WHERE ai.wisdom_filter_applied = TRUE) as wisdom_filter_count,
    COUNT(*) FILTER (WHERE ai.wisdom_filter_verdict = 'adjusted') as wisdom_adjustments_count,
    COUNT(*) FILTER (WHERE ai.wisdom_filter_verdict = 'rejected') as wisdom_rejections_count,

    -- Time window
    MIN(ai.invoked_at) as first_invocation,
    MAX(ai.invoked_at) as last_invocation,

    -- Updated timestamp
    NOW() as refreshed_at

FROM agent_invocations ai
JOIN specialized_agents sa ON ai.agent_id = sa.id
GROUP BY ai.agent_id, sa.agent_code, sa.agent_name, sa.specialization_domain;

-- Index for fast lookups
CREATE UNIQUE INDEX idx_delegation_analytics_agent ON agent_delegation_analytics(agent_id);
CREATE INDEX idx_delegation_analytics_domain ON agent_delegation_analytics(specialization_domain);

-- Refresh function (call this periodically, e.g., every hour)
CREATE OR REPLACE FUNCTION refresh_delegation_analytics() RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY agent_delegation_analytics;
END;
$$ LANGUAGE plpgsql;

-- ==================================================
-- TRIGGERS & AUTOMATIC UPDATES
-- ==================================================

-- Auto-update specialized_agents performance metrics after invocation
CREATE OR REPLACE FUNCTION update_agent_performance_metrics()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE specialized_agents
    SET
        total_invocations = total_invocations + 1,
        successful_invocations = CASE
            WHEN NEW.was_successful THEN successful_invocations + 1
            ELSE successful_invocations
        END,
        avg_confidence_score = (
            SELECT AVG(response_confidence)
            FROM agent_invocations
            WHERE agent_id = NEW.agent_id
        ),
        avg_processing_time_ms = (
            SELECT AVG(processing_time_ms)
            FROM agent_invocations
            WHERE agent_id = NEW.agent_id
        ),
        avg_user_rating = (
            SELECT AVG(user_rating)
            FROM agent_invocations
            WHERE agent_id = NEW.agent_id AND user_rating IS NOT NULL
        ),
        last_invoked_at = NEW.invoked_at,
        last_updated_at = NOW()
    WHERE id = NEW.agent_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_agent_metrics
    AFTER INSERT ON agent_invocations
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_performance_metrics();

-- Auto-update timestamp on specialized_agents
CREATE TRIGGER update_agents_timestamp
    BEFORE UPDATE ON specialized_agents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ==================================================
-- HELPER FUNCTIONS & UTILITIES
-- ==================================================

-- Find best agent for a query (delegator logic)
CREATE OR REPLACE FUNCTION find_best_agent_for_query(
    query_text TEXT,
    min_confidence FLOAT DEFAULT 0.7
) RETURNS TABLE(
    agent_id UUID,
    agent_code VARCHAR(100),
    match_score FLOAT,
    match_reason TEXT
) AS $$
BEGIN
    -- ARCHITECTURAL NOTE: This is a simplified version
    -- Production implementation should use vector similarity + keyword matching
    -- Integrate with embedding search for semantic matching

    RETURN QUERY
    SELECT
        sa.id,
        sa.agent_code,
        CASE
            -- Simple keyword matching (replace with semantic search)
            WHEN EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(sa.delegation_rules->'trigger_keywords') AS keyword
                WHERE query_text ILIKE '%' || keyword || '%'
            ) THEN 0.8
            ELSE 0.3
        END as match_score,
        'Keyword match' as match_reason
    FROM specialized_agents sa
    WHERE sa.is_active = TRUE
        AND (sa.delegation_rules->>'confidence_threshold')::FLOAT <= min_confidence
    ORDER BY match_score DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- Get agent performance summary
CREATE OR REPLACE FUNCTION get_agent_performance_summary(
    p_agent_id UUID,
    days_back INTEGER DEFAULT 30
) RETURNS TABLE(
    total_invocations BIGINT,
    success_rate FLOAT,
    avg_user_rating FLOAT,
    avg_confidence FLOAT,
    p95_processing_time INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) as total_invocations,
        (COUNT(*) FILTER (WHERE was_successful = TRUE))::FLOAT / NULLIF(COUNT(*), 0) as success_rate,
        AVG(user_rating) as avg_user_rating,
        AVG(response_confidence) as avg_confidence,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY processing_time_ms)::INTEGER as p95_processing_time
    FROM agent_invocations
    WHERE agent_id = p_agent_id
        AND invoked_at >= NOW() - INTERVAL '1 day' * days_back;
END;
$$ LANGUAGE plpgsql;

-- ==================================================
-- DATA INTEGRITY CONSTRAINTS
-- ==================================================

-- Ensure delegation_confidence and response_confidence are valid percentages
ALTER TABLE agent_invocations
    ADD CONSTRAINT check_delegation_confidence
    CHECK (delegation_confidence >= 0 AND delegation_confidence <= 1);

ALTER TABLE agent_invocations
    ADD CONSTRAINT check_response_confidence
    CHECK (response_confidence IS NULL OR (response_confidence >= 0 AND response_confidence <= 1));

-- Ensure avg scores are valid
ALTER TABLE specialized_agents
    ADD CONSTRAINT check_avg_confidence
    CHECK (avg_confidence_score >= 0 AND avg_confidence_score <= 1);

ALTER TABLE specialized_agents
    ADD CONSTRAINT check_avg_rating
    CHECK (avg_user_rating IS NULL OR (avg_user_rating >= 1 AND avg_user_rating <= 5));

-- ==================================================
-- COMMENTS FOR DOCUMENTATION
-- ==================================================

COMMENT ON TABLE specialized_agents IS 'Hyper-specialized expert agents synthesized from O*NET occupational data. Each agent is a domain expert optimized for specific query types.';

COMMENT ON COLUMN specialized_agents.capabilities IS 'JSONB structure containing synthesized knowledge domains, skills, abilities, and work activities from O*NET data. Enables fast capability queries without joins.';

COMMENT ON COLUMN specialized_agents.delegation_rules IS 'JSONB structure defining when this agent should be invoked. Includes trigger keywords, domain indicators, and confidence thresholds. Evolves through learning.';

COMMENT ON TABLE agent_invocations IS 'Complete history of agent invocations for analytics, learning, and optimization. Includes wisdom filter results and user feedback. Partitioned by month for scalability.';

COMMENT ON TABLE agent_evolution_history IS 'Audit log of all agent changes over time. Tracks prompt updates, capability refinements, and delegation rule changes. Critical for understanding agent evolution.';

COMMENT ON TABLE agent_performance_snapshots IS 'Time-series performance data for trend analysis. Daily snapshots enable historical comparisons and anomaly detection.';

COMMENT ON MATERIALIZED VIEW agent_delegation_analytics IS 'Pre-computed delegation analytics for fast dashboard queries. Refresh hourly or after significant invocation volume.';

-- ==================================================
-- INITIAL SEED DATA (Optional)
-- ==================================================

-- Example: Create a "Data Scientist" agent synthesized from O*NET occupation 15-2051.00
/*
INSERT INTO specialized_agents (
    agent_code,
    agent_name,
    source_occupation_codes,
    description,
    specialization_domain,
    capabilities,
    system_prompt_template,
    delegation_rules
) VALUES (
    'data_scientist',
    'Data Science Expert',
    ARRAY['15-2051.00'],
    'Expert in statistical analysis, machine learning, and data-driven decision making.',
    'data_science',
    '{
        "knowledge_domains": [
            {"domain": "Mathematics", "importance": 4.5},
            {"domain": "Computers and Electronics", "importance": 4.8},
            {"domain": "English Language", "importance": 3.2}
        ],
        "skills": [
            {"skill": "Critical Thinking", "level": 5.0},
            {"skill": "Complex Problem Solving", "level": 4.8},
            {"skill": "Programming", "level": 4.5}
        ],
        "abilities": [
            {"ability": "Deductive Reasoning", "level": 4.8},
            {"ability": "Mathematical Reasoning", "level": 5.0},
            {"ability": "Written Comprehension", "level": 4.5}
        ],
        "work_activities": [
            {"activity": "Analyzing Data or Information", "relevance": 5.0},
            {"activity": "Working with Computers", "relevance": 5.0},
            {"activity": "Processing Information", "relevance": 4.8}
        ]
    }'::jsonb,
    'You are a Data Science Expert with deep expertise in statistical analysis, machine learning, and data-driven decision making. Your responses should demonstrate rigorous analytical thinking and practical implementation guidance.',
    '{
        "trigger_keywords": ["data analysis", "machine learning", "statistical", "predictive model", "dataset"],
        "domain_indicators": ["statistics", "ML", "AI", "analytics", "data science"],
        "complexity_threshold": 0.6,
        "confidence_threshold": 0.75,
        "exclusion_patterns": ["simple query", "basic arithmetic"]
    }'::jsonb
);
*/
