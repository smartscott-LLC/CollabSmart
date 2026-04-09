-- O*NET Occupational Data Schema for the LLM
-- Integrated with Cloud SQL PostgreSQL database

-- ==================================================
-- OCCUPATIONS - Core occupation data
-- ==================================================
CREATE TABLE IF NOT EXISTS onet_occupations (
    onetsoc_code VARCHAR(10) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    bright_outlook BOOLEAN DEFAULT FALSE,
    green_occupation BOOLEAN DEFAULT FALSE,
    api_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- For semantic search
    description_embedding vector(1536)
);

CREATE INDEX idx_onet_occupations_title ON onet_occupations(title);
CREATE INDEX idx_onet_occupations_bright_outlook ON onet_occupations(bright_outlook) WHERE bright_outlook = TRUE;

-- ==================================================
-- SKILLS - Skills required for occupations
-- ==================================================
CREATE TABLE IF NOT EXISTS onet_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onetsoc_code VARCHAR(10) REFERENCES onet_occupations(onetsoc_code) ON DELETE CASCADE,
    element_id VARCHAR(50),
    element_name VARCHAR(255) NOT NULL,
    scale_id VARCHAR(10),
    data_value FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_onet_skills_occupation ON onet_skills(onetsoc_code);
CREATE INDEX idx_onet_skills_name ON onet_skills(element_name);
CREATE INDEX idx_onet_skills_value ON onet_skills(data_value DESC);

-- ==================================================
-- ABILITIES - Abilities needed for occupations
-- ==================================================
CREATE TABLE IF NOT EXISTS onet_abilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onetsoc_code VARCHAR(10) REFERENCES onet_occupations(onetsoc_code) ON DELETE CASCADE,
    element_id VARCHAR(50),
    element_name VARCHAR(255) NOT NULL,
    scale_id VARCHAR(10),
    data_value FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_onet_abilities_occupation ON onet_abilities(onetsoc_code);
CREATE INDEX idx_onet_abilities_name ON onet_abilities(element_name);

-- ==================================================
-- KNOWLEDGE - Knowledge areas for occupations
-- ==================================================
CREATE TABLE IF NOT EXISTS onet_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onetsoc_code VARCHAR(10) REFERENCES onet_occupations(onetsoc_code) ON DELETE CASCADE,
    element_id VARCHAR(50),
    element_name VARCHAR(255) NOT NULL,
    scale_id VARCHAR(10),
    data_value FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_onet_knowledge_occupation ON onet_knowledge(onetsoc_code);
CREATE INDEX idx_onet_knowledge_name ON onet_knowledge(element_name);

-- ==================================================
-- WORK ACTIVITIES - Tasks and activities
-- ==================================================
CREATE TABLE IF NOT EXISTS onet_work_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onetsoc_code VARCHAR(10) REFERENCES onet_occupations(onetsoc_code) ON DELETE CASCADE,
    element_id VARCHAR(50),
    element_name VARCHAR(255) NOT NULL,
    scale_id VARCHAR(10),
    data_value FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_onet_work_activities_occupation ON onet_work_activities(onetsoc_code);

-- ==================================================
-- TECHNOLOGY - Tools and technology used
-- ==================================================
CREATE TABLE IF NOT EXISTS onet_technology (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onetsoc_code VARCHAR(10) REFERENCES onet_occupations(onetsoc_code) ON DELETE CASCADE,
    category VARCHAR(255),
    example VARCHAR(500),
    hot_technology BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_onet_technology_occupation ON onet_technology(onetsoc_code);
CREATE INDEX idx_onet_technology_hot ON onet_technology(hot_technology) WHERE hot_technology = TRUE;

-- ==================================================
-- the LLM'S OCCUPATION INSIGHTS
-- ==================================================
CREATE TABLE IF NOT EXISTS the LLM_occupation_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onetsoc_code VARCHAR(10) REFERENCES onet_occupations(onetsoc_code) ON DELETE CASCADE,
    insight_text TEXT NOT NULL,
    insight_type VARCHAR(50), -- e.g., 'trend', 'skill_gap', 'product_match'
    confidence_score FLOAT,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    referenced_count INTEGER DEFAULT 0,
    last_referenced TIMESTAMPTZ,
    -- Link to the LLM's memory
    related_memory_id UUID,
    FOREIGN KEY (related_memory_id) REFERENCES long_term_memory(id) ON DELETE SET NULL
);

CREATE INDEX idx_the LLM_insights_occupation ON the LLM_occupation_insights(onetsoc_code);
CREATE INDEX idx_the LLM_insights_type ON the LLM_occupation_insights(insight_type);

-- ==================================================
-- AUTO-UPDATE TRIGGER
-- ==================================================
CREATE TRIGGER update_onet_occupations_timestamp
    BEFORE UPDATE ON onet_occupations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE onet_occupations IS 'Core O*NET occupational data for the LLM';
COMMENT ON TABLE the LLM_occupation_insights IS 'the LLM generated insights about occupations - connects to his memory system';
