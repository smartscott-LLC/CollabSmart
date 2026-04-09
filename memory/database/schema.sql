-- the LLM Personality Engine - Database Schema
-- PostgreSQL (Neon) for long-term memory and learning

-- User profiles and preferences
CREATE TABLE IF NOT EXISTS the LLM_users (
    user_id VARCHAR(255) PRIMARY KEY,
    user_role VARCHAR(50),
    preferred_mode VARCHAR(50),
    interaction_count INTEGER DEFAULT 0,
    first_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conversation history for long-term context
CREATE TABLE IF NOT EXISTS the LLM_conversations (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES the LLM_users(user_id),
    session_id VARCHAR(255),
    message TEXT,
    response TEXT,
    mode_used VARCHAR(50),
    council_member VARCHAR(50),
    context_data JSONB,
    sentiment VARCHAR(50),
    urgency_level VARCHAR(20),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Learning data - what works, what doesn't
CREATE TABLE IF NOT EXISTS the LLM_learning (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES the LLM_users(user_id),
    interaction_type VARCHAR(100),
    context_snapshot JSONB,
    response_strategy TEXT,
    feedback_score INTEGER, -- implicit feedback based on follow-up questions
    success_indicator BOOLEAN,
    learned_pattern TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User feedback (explicit and implicit)
CREATE TABLE IF NOT EXISTS the LLM_feedback (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER REFERENCES the LLM_conversations(id),
    user_id VARCHAR(255) REFERENCES the LLM_users(user_id),
    feedback_type VARCHAR(50), -- 'explicit', 'implicit', 'follow_up'
    rating INTEGER, -- 1-5 if explicit
    feedback_text TEXT,
    implied_satisfaction VARCHAR(50), -- 'satisfied', 'confused', 'frustrated'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Personality mode effectiveness tracking
CREATE TABLE IF NOT EXISTS the LLM_mode_performance (
    id SERIAL PRIMARY KEY,
    mode VARCHAR(50),
    user_role VARCHAR(50),
    scenario_type VARCHAR(100),
    usage_count INTEGER DEFAULT 0,
    avg_satisfaction DECIMAL(3,2),
    success_rate DECIMAL(3,2),
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(mode, user_role, scenario_type)
);

-- Council member activation patterns
CREATE TABLE IF NOT EXISTS the LLM_council_patterns (
    id SERIAL PRIMARY KEY,
    council_member VARCHAR(50),
    keywords TEXT[],
    context_triggers JSONB,
    activation_count INTEGER DEFAULT 0,
    success_rate DECIMAL(3,2),
    avg_response_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON the LLM_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON the LLM_conversations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON the LLM_conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_learning_user_id ON the LLM_learning(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_conversation ON the LLM_feedback(conversation_id);
CREATE INDEX IF NOT EXISTS idx_users_last_interaction ON the LLM_users(last_interaction DESC);

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for auto-updating timestamps
CREATE TRIGGER update_the LLM_users_updated_at BEFORE UPDATE ON the LLM_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_the LLM_mode_performance_updated_at BEFORE UPDATE ON the LLM_mode_performance
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_the LLM_council_patterns_updated_at BEFORE UPDATE ON the LLM_council_patterns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Initial seed data for mode performance tracking
INSERT INTO the LLM_mode_performance (mode, user_role, scenario_type, usage_count, avg_satisfaction, success_rate)
VALUES
    ('warehouse_floor', 'worker', 'product_location', 0, 0.00, 0.00),
    ('warehouse_floor', 'worker', 'task_assistance', 0, 0.00, 0.00),
    ('management', 'manager', 'analytics_request', 0, 0.00, 0.00),
    ('management', 'manager', 'performance_review', 0, 0.00, 0.00),
    ('client_portal', 'client', 'order_inquiry', 0, 0.00, 0.00),
    ('training', 'trainee', 'process_learning', 0, 0.00, 0.00),
    ('developer', 'developer', 'system_query', 0, 0.00, 0.00)
ON CONFLICT (mode, user_role, scenario_type) DO NOTHING;

-- Initial council member patterns
INSERT INTO the LLM_council_patterns (council_member, keywords, context_triggers, activation_count, success_rate)
VALUES
    ('receiving', ARRAY['receive', 'shipment', 'delivery', 'unload', 'incoming'], '{"scenarios": ["receiving_operations"]}', 0, 0.00),
    ('storage', ARRAY['store', 'put away', 'location', 'bin', 'slot'], '{"scenarios": ["storage_operations"]}', 0, 0.00),
    ('picking', ARRAY['pick', 'order', 'pull', 'grab', 'collect'], '{"scenarios": ["picking_operations"]}', 0, 0.00),
    ('packing', ARRAY['pack', 'box', 'ship', 'package', 'wrap'], '{"scenarios": ["packing_operations"]}', 0, 0.00),
    ('shipping', ARRAY['ship', 'dispatch', 'carrier', 'tracking', 'outbound'], '{"scenarios": ["shipping_operations"]}', 0, 0.00),
    ('analytics', ARRAY['report', 'metrics', 'performance', 'analysis', 'data'], '{"scenarios": ["analytics_queries"]}', 0, 0.00),
    ('client_relations', ARRAY['customer', 'client', 'order status', 'complaint', 'inquiry'], '{"scenarios": ["client_interactions"]}', 0, 0.00)
ON CONFLICT DO NOTHING;
