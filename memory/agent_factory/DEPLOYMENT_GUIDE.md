# Agent Factory - Deployment Guide

**For Google Demo - Next Friday**

This guide walks you through deploying the Agent Factory schema and creating your first specialized agents.

---

## Prerequisites

- ✅ PostgreSQL 12+ with pgvector extension
- ✅ O*NET tables already loaded (`onet_occupations`, `onet_skills`, etc.)
- ✅ the LLM memory system tables (`long_term_memory`)
- ✅ Python 3.9+ with `psycopg2` installed

---

## Quick Start (5 minutes)

### Step 1: Set Database URL

```bash
export DATABASE_URL="postgresql://user:password@host:5432/dbname"

# Or create .env file
echo 'DATABASE_URL="postgresql://user:password@host:5432/dbname"' > .env
```

### Step 2: Run Migration (Dry Run First)

```bash
# Test migration without committing
python migrate_agent_factory.py --dry-run

# If dry run looks good, run for real
python migrate_agent_factory.py
```

**Expected Output:**
```
============================================================
AGENT FACTORY DATABASE MIGRATION
============================================================
MODE: LIVE (changes will be committed)

Connecting to database...
✓ Connected successfully

Checking prerequisites...
  ✓ pgvector extension
  ✓ onet_occupations table
  ✓ long_term_memory table

Creating Agent Factory schema...
  Executing schema SQL...
  ✓ Schema created successfully

Creating monthly partitions (3 months ahead)...
  ✓ Created partition agent_invocations_2025_10 (2025-10-01 to 2025-11-01)
  ✓ Created partition agent_invocations_2025_11 (2025-11-01 to 2025-12-01)
  ✓ Created partition agent_invocations_2025_12 (2025-12-01 to 2026-01-01)

Verifying schema...
  ✓ specialized_agents
  ✓ agent_invocations
  ✓ agent_evolution_history
  ✓ agent_performance_snapshots
✓ All tables verified

Verifying indexes...
  ✓ idx_agents_code
  ✓ idx_agents_capabilities
  ✓ idx_invocations_agent
  ✓ idx_invocations_timestamp
✓ All critical indexes verified

Table statistics:
  agent_evolution_history: 0 rows, 8192 bytes
  agent_invocations: 0 rows, 8192 bytes
  agent_performance_snapshots: 0 rows, 8192 bytes
  specialized_agents: 0 rows, 8192 bytes

============================================================
✓ MIGRATION COMPLETED SUCCESSFULLY
============================================================

Next steps:
  1. Seed initial agents (if applicable)
  2. Set up automated partition creation (cron job)
  3. Configure monitoring dashboards
  4. Test agent synthesis pipeline
```

### Step 3: Create Your First Agent

```python
from agent_factory_utils import AgentFactoryManager, create_sample_data_scientist_agent

# Connect to database
with AgentFactoryManager(DATABASE_URL) as manager:
    # Create sample Data Scientist agent
    agent_id = create_sample_data_scientist_agent(manager)
    print(f"✓ Created agent ID: {agent_id}")
```

**Or use the CLI:**

```bash
python -c "
from agent_factory_utils import AgentFactoryManager, create_sample_data_scientist_agent
import os

with AgentFactoryManager(os.environ['DATABASE_URL']) as manager:
    agent_id = create_sample_data_scientist_agent(manager)
    print(f'Created agent: {agent_id}')
"
```

---

## Step-by-Step Deployment

### 1. Pre-Deployment Checklist

```bash
# Verify database connection
psql $DATABASE_URL -c "SELECT version();"

# Verify O*NET tables exist
psql $DATABASE_URL -c "SELECT COUNT(*) FROM onet_occupations;"

# Verify pgvector extension
psql $DATABASE_URL -c "SELECT * FROM pg_extension WHERE extname = 'vector';"

# Create backup (IMPORTANT!)
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
```

### 2. Review Schema

```bash
# Read through the schema to understand structure
cat schema_agent_factory.sql | less

# Review architecture document
cat ARCHITECTURE.md | less
```

### 3. Run Migration

```bash
# Dry run first (always!)
python migrate_agent_factory.py --dry-run

# Review output, then run for real
python migrate_agent_factory.py

# Or specify database URL directly
python migrate_agent_factory.py --database-url "postgresql://..."
```

### 4. Verify Deployment

```bash
# Check tables exist
psql $DATABASE_URL -c "\dt specialized_agents agent_invocations agent_evolution_history agent_performance_snapshots"

# Check indexes
psql $DATABASE_URL -c "\di idx_agents_code idx_agents_capabilities"

# Check functions
psql $DATABASE_URL -c "\df refresh_delegation_analytics get_agent_performance_summary"

# Check materialized view
psql $DATABASE_URL -c "\dm agent_delegation_analytics"
```

### 5. Create Initial Agents

You have three options:

#### Option A: Use Python Utility (Recommended)

```python
from agent_factory_utils import (
    AgentFactoryManager,
    DelegationRules,
    create_sample_data_scientist_agent
)

with AgentFactoryManager(DATABASE_URL) as manager:
    # Create Data Scientist
    ds_agent_id = create_sample_data_scientist_agent(manager)

    # Create more agents as needed...
```

#### Option B: Direct SQL Insert

```sql
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
    'software_architect',
    'Software Architecture Expert',
    ARRAY['15-1252.00'],  -- Software Developers
    'Expert in system design, architectural patterns, and scalable software systems.',
    'software_architecture',
    '{
        "knowledge_domains": [
            {"domain": "Computers and Electronics", "importance": 5.0},
            {"domain": "Engineering and Technology", "importance": 4.8}
        ],
        "skills": [
            {"skill": "Systems Analysis", "level": 5.0},
            {"skill": "Complex Problem Solving", "level": 4.9}
        ],
        "abilities": [
            {"ability": "Deductive Reasoning", "level": 5.0}
        ],
        "work_activities": [
            {"activity": "Thinking Creatively", "relevance": 5.0}
        ]
    }'::jsonb,
    'You are a Software Architecture Expert with deep expertise in system design, architectural patterns, microservices, distributed systems, and scalability. Guide users with principled, battle-tested architectural thinking.',
    '{
        "trigger_keywords": ["architecture", "system design", "scalability", "microservices", "distributed"],
        "domain_indicators": ["software", "system", "design pattern"],
        "complexity_threshold": 0.7,
        "confidence_threshold": 0.8,
        "exclusion_patterns": ["simple CRUD", "basic query"]
    }'::jsonb
);
```

#### Option C: Load from JSON File

Create `agents_seed.json`:

```json
[
    {
        "agent_code": "data_scientist",
        "agent_name": "Data Science Expert",
        "source_occupation_codes": ["15-2051.00"],
        "description": "Expert in statistical analysis and machine learning",
        "specialization_domain": "data_science",
        ...
    }
]
```

Then load:

```python
import json

with open('agents_seed.json') as f:
    agents = json.load(f)

with AgentFactoryManager(DATABASE_URL) as manager:
    for agent_data in agents:
        manager.synthesize_agent_from_onet(**agent_data)
```

---

## Post-Deployment Setup

### 1. Set Up Automated Partition Creation

Create monthly partitions automatically via cron job.

**Create script: `/scripts/create_monthly_partition.sh`**

```bash
#!/bin/bash
# Create next month's partition for agent_invocations

NEXT_MONTH=$(date -d "+1 month" +%Y-%m-01)

psql $DATABASE_URL -c "SELECT create_monthly_partition('agent_invocations', '$NEXT_MONTH'::DATE);"
```

**Add to crontab:**

```bash
# Run on 1st of each month at 2am
0 2 1 * * /path/to/scripts/create_monthly_partition.sh
```

**Or use pg_cron extension (if available):**

```sql
-- Install pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule monthly partition creation
SELECT cron.schedule(
    'create-agent-invocations-partition',
    '0 2 1 * *',  -- 2am on 1st of month
    $$SELECT create_monthly_partition('agent_invocations', (CURRENT_DATE + INTERVAL '1 month')::DATE)$$
);
```

### 2. Set Up Analytics Refresh

Refresh delegation analytics hourly:

```bash
#!/bin/bash
# Refresh delegation analytics materialized view

psql $DATABASE_URL -c "SELECT refresh_delegation_analytics();"
```

**Add to crontab:**

```bash
# Run every hour
0 * * * * /path/to/scripts/refresh_analytics.sh
```

### 3. Configure Monitoring

#### Prometheus Metrics (Example)

```python
from prometheus_client import Counter, Histogram, Gauge

agent_invocations_total = Counter(
    'agent_invocations_total',
    'Total agent invocations',
    ['agent_code', 'success']
)

agent_processing_time = Histogram(
    'agent_processing_time_seconds',
    'Agent processing time',
    ['agent_code']
)

active_agents_count = Gauge(
    'active_agents_count',
    'Number of active agents'
)
```

#### Database Metrics

```sql
-- Query to monitor partition sizes
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_stat_user_tables
WHERE tablename LIKE 'agent_invocations_%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Query to monitor invocation volume
SELECT
    DATE(invoked_at) as date,
    COUNT(*) as invocations,
    AVG(processing_time_ms) as avg_time_ms
FROM agent_invocations
WHERE invoked_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(invoked_at)
ORDER BY date DESC;
```

### 4. Set Up Backups

```bash
# Daily backup script
#!/bin/bash
BACKUP_DIR="/backups/agent_factory"
DATE=$(date +%Y%m%d_%H%M%S)

# Backup specific tables
pg_dump $DATABASE_URL \
    -t specialized_agents \
    -t agent_invocations \
    -t agent_evolution_history \
    -t agent_performance_snapshots \
    > $BACKUP_DIR/agent_factory_$DATE.sql

# Compress
gzip $BACKUP_DIR/agent_factory_$DATE.sql

# Keep last 30 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete
```

---

## Testing Your Deployment

### 1. Basic Functionality Test

```python
from agent_factory_utils import AgentFactoryManager, AgentInvocation, WisdomFilterResult
import uuid

with AgentFactoryManager(DATABASE_URL) as manager:
    # Test 1: Find agent
    print("Test 1: Finding agent...")
    matches = manager.find_best_agent("How do I analyze customer data?")
    assert len(matches) > 0, "Should find at least one agent"
    print(f"✓ Found {len(matches)} agents")

    # Test 2: Record invocation
    print("\nTest 2: Recording invocation...")
    agent_id = matches[0]['agent_id']

    invocation = AgentInvocation(
        agent_id=agent_id,
        user_query="How do I analyze customer data?",
        invoked_by='test_user',
        delegation_confidence=0.85,
        session_id='test_session_123'
    )

    invocation_id = manager.record_invocation(
        invocation=invocation,
        response="Here's how to analyze customer data...",
        response_confidence=0.90,
        processing_time_ms=250,
        was_successful=True
    )
    print(f"✓ Recorded invocation {invocation_id}")

    # Test 3: Record feedback
    print("\nTest 3: Recording user feedback...")
    manager.record_user_feedback(invocation_id, rating=5, feedback="Very helpful!")
    print("✓ Recorded feedback")

    # Test 4: Get performance
    print("\nTest 4: Getting agent performance...")
    perf = manager.get_agent_performance(agent_id, days_back=30)
    print(f"✓ Performance: {perf}")

    # Test 5: Get top agents
    print("\nTest 5: Getting top agents...")
    top = manager.get_top_agents(limit=5)
    print(f"✓ Found {len(top)} top agents")

print("\n✅ ALL TESTS PASSED")
```

### 2. Performance Test

```python
import time
from concurrent.futures import ThreadPoolExecutor

def test_concurrent_invocations(num_invocations=100):
    """Test concurrent invocation recording."""

    with AgentFactoryManager(DATABASE_URL) as manager:
        # Get first agent
        matches = manager.find_best_agent("test query")
        agent_id = matches[0]['agent_id']

        def record_one():
            invocation = AgentInvocation(
                agent_id=agent_id,
                user_query="Test query",
                invoked_by='load_test',
                delegation_confidence=0.8
            )
            manager.record_invocation(
                invocation=invocation,
                response="Test response",
                response_confidence=0.85,
                processing_time_ms=100,
                was_successful=True
            )

        # Run concurrently
        start = time.time()
        with ThreadPoolExecutor(max_workers=10) as executor:
            list(executor.map(lambda _: record_one(), range(num_invocations)))
        elapsed = time.time() - start

        print(f"Recorded {num_invocations} invocations in {elapsed:.2f}s")
        print(f"Throughput: {num_invocations/elapsed:.2f} invocations/second")

test_concurrent_invocations(100)
```

### 3. Query Performance Test

```sql
-- Test 1: Agent lookup by code (should be <5ms)
EXPLAIN ANALYZE
SELECT * FROM specialized_agents WHERE agent_code = 'data_scientist';

-- Test 2: Recent invocations (should be <50ms)
EXPLAIN ANALYZE
SELECT * FROM agent_invocations
WHERE invoked_at >= NOW() - INTERVAL '7 days'
ORDER BY invoked_at DESC
LIMIT 100;

-- Test 3: Agent performance (should be <100ms)
EXPLAIN ANALYZE
SELECT * FROM get_agent_performance_summary(
    (SELECT id FROM specialized_agents LIMIT 1),
    30
);

-- Test 4: Delegation analytics (should be <10ms with materialized view)
EXPLAIN ANALYZE
SELECT * FROM agent_delegation_analytics;
```

---

## Troubleshooting

### Issue: Migration fails with "relation already exists"

**Cause:** Tables already exist from previous deployment.

**Solution:**
```bash
# Check existing tables
psql $DATABASE_URL -c "\dt specialized_agents"

# Option 1: Drop and recreate (CAUTION: DELETES DATA)
psql $DATABASE_URL -c "DROP TABLE IF EXISTS agent_invocations CASCADE;"
psql $DATABASE_URL -c "DROP TABLE IF EXISTS specialized_agents CASCADE;"
python migrate_agent_factory.py

# Option 2: Backup and rename
psql $DATABASE_URL -c "ALTER TABLE specialized_agents RENAME TO specialized_agents_backup;"
python migrate_agent_factory.py
```

### Issue: Slow queries on agent_invocations

**Cause:** Missing index or partition pruning not working.

**Solution:**
```sql
-- Check if query is using partition pruning
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM agent_invocations
WHERE invoked_at >= '2025-10-01'
LIMIT 100;

-- Look for "Seq Scan" - should see "Parallel Seq Scan on agent_invocations_2025_10"

-- If indexes are missing, recreate:
CREATE INDEX IF NOT EXISTS idx_invocations_timestamp ON agent_invocations(invoked_at DESC);
```

### Issue: Materialized view refresh is slow

**Cause:** Too many invocations to aggregate.

**Solution:**
```sql
-- Use CONCURRENTLY to avoid locking reads
REFRESH MATERIALIZED VIEW CONCURRENTLY agent_delegation_analytics;

-- Or: Create partial aggregates and merge (advanced)
```

### Issue: Partitions not being created automatically

**Cause:** Cron job not running or function error.

**Solution:**
```bash
# Test function manually
psql $DATABASE_URL -c "SELECT create_monthly_partition('agent_invocations', '2025-12-01'::DATE);"

# Check cron logs
grep -i partition /var/log/cron

# Verify pg_cron is working
psql $DATABASE_URL -c "SELECT * FROM cron.job;"
```

---

## Rollback Plan

If deployment goes wrong:

### Step 1: Stop Application

```bash
# Stop the LLM services that use Agent Factory
kubectl scale deployment the LLM --replicas=0
```

### Step 2: Restore from Backup

```bash
# Restore full backup
psql $DATABASE_URL < backup_20251018_120000.sql

# Or restore specific tables
pg_restore -d $DATABASE_URL -t specialized_agents backup.dump
```

### Step 3: Verify Restoration

```bash
# Check row counts match
psql $DATABASE_URL -c "SELECT COUNT(*) FROM specialized_agents;"
```

### Step 4: Restart Application

```bash
kubectl scale deployment the LLM --replicas=3
```

---

## Next Steps After Deployment

1. **Create Production Agents:**
   - Data Scientist
   - Software Architect
   - Machine Learning Engineer
   - Database Administrator
   - DevOps Engineer

2. **Integrate with the LLM Orchestrator:**
   - Connect delegation logic to query router
   - Implement wisdom filter integration
   - Set up feedback collection

3. **Build Monitoring Dashboard:**
   - Invocation volume over time
   - Top performing agents
   - User satisfaction trends
   - Wisdom filter adjustment rates

4. **Implement Learning Loop:**
   - Feedback → Prompt refinement
   - Low-rated responses → Agent evolution
   - Success patterns → Delegation rule optimization

5. **Prepare for Google Demo:**
   - Create impressive demo agents
   - Seed with synthetic invocation data (for dashboards)
   - Practice delegation scenarios
   - Prepare performance metrics

---

## Support & Questions

For issues or questions:
- Review `ARCHITECTURE.md` for design rationale
- Check schema comments: `psql $DATABASE_URL -c "\d+ specialized_agents"`
- Run diagnostics: `python migrate_agent_factory.py --dry-run`

**Ready for Google demo next Friday!** 🚀
