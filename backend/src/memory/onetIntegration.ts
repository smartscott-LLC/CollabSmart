/**
 * O*NET Integration
 * =================
 * Fetches and stores technology/software occupation data from the O*NET Web Services API.
 * Enriches AI context with role-specific skills, knowledge areas, and technology stacks
 * so the AI pair-programmer can adapt guidance to the user's professional context.
 *
 * Adapted from memory/onet_integration/ingest_onet_data.py for CollabSmart (tech focus).
 * O*NET API docs: https://services.onetcenter.org/reference/online/search
 */

import axios, { AxiosInstance } from 'axios';
import { Pool } from 'pg';
import logger from '../logger';

const ONET_API_BASE = process.env.ONET_API_BASE ?? 'https://services.onetcenter.org/ws';
const ONET_USERNAME = process.env.ONET_USERNAME ?? '';
const ONET_PASSWORD = process.env.ONET_PASSWORD ?? '';

interface OnetOccupation {
  code: string;
  title: string;
  description?: string;
  tags?: { bright_outlook?: boolean; in_demand?: boolean };
  href?: string;
}

interface OnetSkillOrKnowledge {
  element_id: string;
  name: string;
  scale?: { id: string };
  score?: { value: number };
}

interface OnetTechnology {
  category?: { title?: string };
  example: string;
  hot_technology?: boolean;
}

export class OnetIntegration {
  private readonly client: AxiosInstance;

  constructor(private readonly pool: Pool) {
    this.client = axios.create({
      baseURL: ONET_API_BASE,
      auth: { username: ONET_USERNAME, password: ONET_PASSWORD },
      headers: { Accept: 'application/json' },
      timeout: 15000,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Ingestion
  // ──────────────────────────────────────────────────────────────────────────

  /** Search O*NET for an occupation and return basic results */
  async searchOccupations(keyword: string, limit = 10): Promise<OnetOccupation[]> {
    const res = await this.client.get<{ occupation?: OnetOccupation[] }>('/online/search', {
      params: { keyword, start: 1, end: limit },
    });
    return res.data.occupation ?? [];
  }

  /** Fetch full occupation details by O*NET SOC code */
  async fetchOccupationDetails(code: string): Promise<OnetOccupation | null> {
    try {
      const res = await this.client.get<OnetOccupation>(`/online/occupations/${code}`);
      return res.data;
    } catch (err) {
      logger.warn(`[OnetIntegration] fetch failed for ${code}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /** Fetch skills for an occupation */
  async fetchSkills(code: string): Promise<OnetSkillOrKnowledge[]> {
    try {
      const res = await this.client.get<{ element?: OnetSkillOrKnowledge[] }>(
        `/online/occupations/${code}/details/skills`,
      );
      return res.data.element ?? [];
    } catch {
      return [];
    }
  }

  /** Fetch knowledge areas for an occupation */
  async fetchKnowledge(code: string): Promise<OnetSkillOrKnowledge[]> {
    try {
      const res = await this.client.get<{ element?: OnetSkillOrKnowledge[] }>(
        `/online/occupations/${code}/details/knowledge`,
      );
      return res.data.element ?? [];
    } catch {
      return [];
    }
  }

  /** Fetch technology tools used by an occupation */
  async fetchTechnology(code: string): Promise<OnetTechnology[]> {
    try {
      const res = await this.client.get<{ technology?: OnetTechnology[] }>(
        `/online/occupations/${code}/details/technology_skills`,
      );
      return res.data.technology ?? [];
    } catch {
      return [];
    }
  }

  /** Insert or update an occupation row */
  async upsertOccupation(occ: OnetOccupation): Promise<void> {
    await this.pool.query(
      `INSERT INTO onet_occupations (onetsoc_code, title, description, bright_outlook, in_demand, api_url)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (onetsoc_code) DO UPDATE
         SET title = EXCLUDED.title,
             description = EXCLUDED.description,
             bright_outlook = EXCLUDED.bright_outlook,
             in_demand = EXCLUDED.in_demand,
             updated_at = NOW()`,
      [
        occ.code,
        occ.title,
        occ.description ?? null,
        occ.tags?.bright_outlook ?? false,
        occ.tags?.in_demand ?? false,
        occ.href ?? null,
      ],
    );
  }

  /** Store skills for an occupation (replaces existing) */
  async storeSkills(code: string, skills: OnetSkillOrKnowledge[]): Promise<void> {
    if (skills.length === 0) return;
    await this.pool.query('DELETE FROM onet_skills WHERE onetsoc_code = $1', [code]);
    for (const s of skills) {
      await this.pool.query(
        `INSERT INTO onet_skills (onetsoc_code, element_id, element_name, scale_id, data_value)
         VALUES ($1,$2,$3,$4,$5)`,
        [code, s.element_id, s.name, s.scale?.id ?? null, s.score?.value ?? null],
      );
    }
  }

  /** Store knowledge areas for an occupation */
  async storeKnowledge(code: string, knowledge: OnetSkillOrKnowledge[]): Promise<void> {
    if (knowledge.length === 0) return;
    await this.pool.query('DELETE FROM onet_knowledge WHERE onetsoc_code = $1', [code]);
    for (const k of knowledge) {
      await this.pool.query(
        `INSERT INTO onet_knowledge (onetsoc_code, element_id, element_name, scale_id, data_value)
         VALUES ($1,$2,$3,$4,$5)`,
        [code, k.element_id, k.name, k.scale?.id ?? null, k.score?.value ?? null],
      );
    }
  }

  /** Store technology tools for an occupation */
  async storeTechnology(code: string, tech: OnetTechnology[]): Promise<void> {
    if (tech.length === 0) return;
    await this.pool.query('DELETE FROM onet_technology WHERE onetsoc_code = $1', [code]);
    for (const t of tech) {
      await this.pool.query(
        `INSERT INTO onet_technology (onetsoc_code, category, example, hot_technology)
         VALUES ($1,$2,$3,$4)`,
        [code, t.category?.title ?? null, t.example, t.hot_technology ?? false],
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Context enrichment
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Look up stored O*NET data relevant to the current user context.
   * Returns a short textual summary for injection into the system prompt.
   * Uses parameterized queries exclusively to prevent SQL injection.
   */
  async enrichContext(
    primaryRole: string | undefined,
    detectedLanguages: string[],
  ): Promise<string> {
    if (!primaryRole && detectedLanguages.length === 0) return '';

    try {
      let result;

      if (detectedLanguages.length > 0) {
        // Build parameterized query: match occupations whose technology list includes any detected language
        // Each language becomes a separate ILIKE parameter
        const params: string[] = detectedLanguages;
        const likeConditions = detectedLanguages
          .map((_, i) => `ot.example ILIKE $${i + 1}`)
          .join(' OR ');

        result = await this.pool.query<{ title: string; top_skills: string; hot_tools: string }>(
          `SELECT oo.title,
                  (SELECT string_agg(element_name, ', ' ORDER BY data_value DESC)
                   FROM onet_skills os WHERE os.onetsoc_code = oo.onetsoc_code LIMIT 5
                  ) AS top_skills,
                  (SELECT string_agg(example, ', ' ORDER BY hot_technology DESC)
                   FROM onet_technology ot2
                   WHERE ot2.onetsoc_code = oo.onetsoc_code AND ot2.hot_technology = TRUE
                   LIMIT 5
                  ) AS hot_tools
           FROM onet_occupations oo
           JOIN onet_technology ot ON ot.onetsoc_code = oo.onetsoc_code
           WHERE ${likeConditions}
           GROUP BY oo.onetsoc_code, oo.title
           ORDER BY oo.bright_outlook DESC
           LIMIT 2`,
          params.map((l) => `%${l}%`),
        );
      } else {
        // Fall back to role-title match — fully parameterized
        result = await this.pool.query<{ title: string; top_skills: string; hot_tools: string }>(
          `SELECT oo.title,
                  (SELECT string_agg(element_name, ', ' ORDER BY data_value DESC)
                   FROM onet_skills os WHERE os.onetsoc_code = oo.onetsoc_code LIMIT 5
                  ) AS top_skills,
                  (SELECT string_agg(example, ', ' ORDER BY hot_technology DESC)
                   FROM onet_technology ot2
                   WHERE ot2.onetsoc_code = oo.onetsoc_code AND ot2.hot_technology = TRUE
                   LIMIT 5
                  ) AS hot_tools
           FROM onet_occupations oo
           LEFT JOIN onet_technology ot ON ot.onetsoc_code = oo.onetsoc_code
           WHERE oo.title ILIKE $1
           GROUP BY oo.onetsoc_code, oo.title
           ORDER BY oo.bright_outlook DESC
           LIMIT 2`,
          [`%${primaryRole}%`],
        );
      }

      if (result.rows.length === 0) return '';

      return result.rows
        .map((r) => {
          const parts = [`Role context: ${r.title}`];
          if (r.top_skills) parts.push(`Top skills: ${r.top_skills}`);
          if (r.hot_tools) parts.push(`Hot tools: ${r.hot_tools}`);
          return parts.join(' | ');
        })
        .join('\n');
    } catch (err) {
      logger.warn('[OnetIntegration] enrichContext query failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return '';
    }
  }

  /** Store an AI-generated insight about an occupation */
  async storeInsight(
    code: string,
    insightText: string,
    insightType: string,
    scenarioRelevance: string[],
    relatedMemoryId?: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO occupation_insights
         (onetsoc_code, insight_text, insight_type, scenario_relevance, related_memory_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [code, insightText, insightType, scenarioRelevance, relatedMemoryId ?? null],
    );
  }

  /** Retrieve insights relevant to a scenario */
  async getInsightsForScenario(scenarioType: string, limit = 3): Promise<string[]> {
    const result = await this.pool.query<{ insight_text: string }>(
      `SELECT insight_text
       FROM occupation_insights
       WHERE $1 = ANY(scenario_relevance)
       ORDER BY confidence_score DESC, referenced_count DESC
       LIMIT $2`,
      [scenarioType, limit],
    );
    return result.rows.map((r) => r.insight_text);
  }
}
