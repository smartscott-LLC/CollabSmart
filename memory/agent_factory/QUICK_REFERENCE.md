# Agent Factory - Quick Reference

**One-page cheat sheet for common operations**

---

## Installation & Migration

```bash
# Quick deploy
export DATABASE_URL="postgresql://user:pass@host/db"
python migrate_agent_factory.py

# With .env file
python migrate_agent_factory.py --env-file .env

# Dry run (test without changes)
python migrate_agent_factory.py --dry-run
```

---

## Create an Agent

### Python

```python
from agent_factory_utils import AgentFactoryManager, DelegationRules

delegation_rules = DelegationRules(
    trigger_keywords=["keyword1", "keyword2"],
    domain_indicators=["domain1"],
    complexity_threshold=0.7,
    confidence_threshold=0.8,
    exclusion_patterns=["exclude1"]
)

with AgentFactoryManager(DATABASE_URL) as mgr:
    agent_id = mgr.synthesize_agent_from_onet(
        agent_code='my_agent',
        agent_name='My Expert Agent',
        onet_codes=['15-2051.00'],
        description='Expert description',
        specialization_domain='my_domain',
        prompt_template='You are an expert in...',
        delegation_rules=delegation_rules,
        created_by='scott'
    )
```

### SQL

```sql
INSERT INTO specialized_agents (
    agent_code, agent_name, source_occupation_codes,
    description, specialization_domain,
    capabilities, system_prompt_template, delegation_rules
) VALUES (
    'agent_code', 'Agent Name', ARRAY['15-2051.00'],
    'Description', 'domain',
    '{"knowledge_domains": [], "skills": []}'::jsonb,
    'Prompt template',
    '{"trigger_keywords": [], "confidence_threshold": 0.8}'::jsonb
);
```

---

## Find Best Agent

```python
with AgentFactoryManager(DATABASE_URL) as mgr:
    matches = mgr.find_best_agent(
        query="User query here",
        min_confidence=0.7,
        top_k=5
    )

    for match in matches:
        print(f"{match['agent_name']}: {match['match_score']}")
```

---

## Record Invocation

```python
from agent_factory_utils import AgentInvocation, WisdomFilterResult

invocation = AgentInvocation(
    agent_id=agent_uuid,
    user_query="User's question",
    invoked_by='the LLM',
    delegation_confidence=0.85,
    session_id='session_123'
)

wisdom_filter = WisdomFilterResult(
    filter_applied=True,
    verdict='adjusted',
    adjustments={'original_confidence': 0.95, 'adjusted_confidence': 0.80}
)

with AgentFactoryManager(DATABASE_URL) as mgr:
    inv_id = mgr.record_invocation(
        invocation=invocation,
        response="Agent's response",
        response_confidence=0.90,
        processing_time_ms=250,
        wisdom_filter=wisdom_filter,
        was_successful=True
    )
```

---

## Record User Feedback

```python
with AgentFactoryManager(DATABASE_URL) as mgr:
    mgr.record_user_feedback(
        invocation_id=inv_uuid,
        rating=5,  # 1-5
        feedback="Very helpful explanation!"
    )
```

---

## Get Agent Performance

```python
with AgentFactoryManager(DATABASE_URL) as mgr:
    perf = mgr.get_agent_performance(
        agent_id=agent_uuid,
        days_back=30
    )

    print(f"Success Rate: {perf['success_rate']:.2%}")
    print(f"Avg Rating: {perf['avg_user_rating']:.2f}/5")
```

---

## Analytics Queries

### Top Agents

```sql
SELECT
    agent_code, agent_name,
    total_invocations, avg_user_rating
FROM specialized_agents
WHERE is_active = TRUE
ORDER BY total_invocations DESC
LIMIT 10;
```

### Recent Invocations

```sql
SELECT
    sa.agent_name,
    ai.user_query,
    ai.response_confidence,
    ai.user_rating,
    ai.invoked_at
FROM agent_invocations ai
JOIN specialized_agents sa ON ai.agent_id = sa.id
WHERE ai.invoked_at >= NOW() - INTERVAL '7 days'
ORDER BY ai.invoked_at DESC
LIMIT 100;
```

### Delegation Analytics

```sql
SELECT * FROM agent_delegation_analytics
ORDER BY total_delegations DESC;
```

### Wisdom Filter Stats

```sql
SELECT
    wisdom_filter_verdict,
    COUNT(*) as count,
    AVG(response_confidence) as avg_confidence
FROM agent_invocations
WHERE wisdom_filter_applied = TRUE
    AND invoked_at >= NOW() - INTERVAL '7 days'
GROUP BY wisdom_filter_verdict;
```

### Agent Evolution History

```sql
SELECT
    change_type,
    change_description,
    changed_at,
    changed_by
FROM agent_evolution_history
WHERE agent_id = 'agent-uuid-here'
ORDER BY changed_at DESC;
```

---

## Maintenance

### Create Monthly Partition

```sql
SELECT create_monthly_partition('agent_invocations', '2025-12-01'::DATE);
```

### Refresh Analytics

```sql
SELECT refresh_delegation_analytics();
```

### Update Agent Prompt

```python
with AgentFactoryManager(DATABASE_URL) as mgr:
    mgr.update_agent_prompt(
        agent_id=agent_uuid,
        new_prompt="Updated prompt template",
        reason="Improved clarity based on user feedback",
        changed_by='claude'
    )
```

### Deactivate Agent

```sql
UPDATE specialized_agents
SET
    is_active = FALSE,
    deprecation_reason = 'Superseded by improved version'
WHERE agent_code = 'old_agent';
```

---

## Monitoring Queries

### Partition Sizes

```sql
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size('public.'||tablename)) AS size
FROM pg_tables
WHERE tablename LIKE 'agent_invocations_%'
ORDER BY pg_total_relation_size('public.'||tablename) DESC;
```

### Slow Invocations

```sql
SELECT
    sa.agent_code,
    ai.processing_time_ms,
    ai.user_query,
    ai.invoked_at
FROM agent_invocations ai
JOIN specialized_agents sa ON ai.agent_id = sa.id
WHERE ai.processing_time_ms > 1000
ORDER BY ai.processing_time_ms DESC
LIMIT 20;
```

### Daily Invocation Volume

```sql
SELECT
    DATE(invoked_at) as date,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE was_successful = TRUE) as successful,
    AVG(processing_time_ms)::INTEGER as avg_time_ms
FROM agent_invocations
WHERE invoked_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(invoked_at)
ORDER BY date DESC;
```

### Agent Performance Leaderboard

```sql
SELECT
    agent_code,
    total_invocations,
    ROUND(avg_confidence_score::NUMERIC, 2) as avg_confidence,
    ROUND(avg_user_rating::NUMERIC, 2) as avg_rating,
    last_invoked_at
FROM specialized_agents
WHERE is_active = TRUE
    AND total_invocations > 0
ORDER BY avg_user_rating DESC NULLS LAST
LIMIT 10;
```

---

## Common O*NET Occupation Codes

| Code | Occupation |
|------|------------|
| 15-2051.00 | Data Scientists |
| 15-1252.00 | Software Developers |
| 15-1244.00 | Network and Computer Systems Administrators |
| 15-1299.08 | Computer Systems Engineers/Architects |
| 15-1221.00 | Computer and Information Research Scientists |
| 13-2011.00 | Accountants and Auditors |
| 17-2112.00 | Industrial Engineers |
| 19-1029.01 | Bioinformatics Scientists |
| 25-1021.00 | Computer Science Teachers, Postsecondary |

[Full list in your O*NET database]

---

## Environment Variables

```bash
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
export LOG_LEVEL="INFO"  # DEBUG, INFO, WARNING, ERROR
```

---

## File Locations

```
src/the LLM_personality/agent_factory/
├── schema_agent_factory.sql      # Database schema
├── migrate_agent_factory.py      # Migration script
├── agent_factory_utils.py        # Python utilities
├── ARCHITECTURE.md               # Design documentation
├── DEPLOYMENT_GUIDE.md           # Deployment walkthrough
└── QUICK_REFERENCE.md            # This file
```

---

## Key Design Principles

1. **Wisdom Over Knowledge:** Quality responses > quick responses
2. **Performance:** Sub-100ms queries, partitioned for scale
3. **Observability:** Track everything for learning
4. **Flexibility:** JSONB for evolving schemas
5. **Integrity:** Foreign keys where meaningful, soft where flexible

---

## Help & Support

- **Schema Details:** `psql -c "\d+ specialized_agents"`
- **Function Help:** `psql -c "\df+ get_agent_performance_summary"`
- **Architecture:** See `ARCHITECTURE.md`
- **Deployment:** See `DEPLOYMENT_GUIDE.md`

---

**Built with precision for the LLM's Google Demo 🚀**
