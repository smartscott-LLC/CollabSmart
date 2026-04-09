/**
 * Context Analyzer
 * ================
 * Analyzes conversation messages to detect coding scenario, urgency, emotion,
 * programming languages, tools, and suggests the optimal collaboration mode.
 *
 * Adapted from memory/utils/context_analyzer.py for AI pair-programming context.
 */

import { ContextAnalysis, CollabMode, ScenarioType } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Keyword tables
// ──────────────────────────────────────────────────────────────────────────────

const URGENCY_HIGH = [
  'urgent', 'asap', 'emergency', 'critical', 'immediately', 'right now',
  'broken', 'crash', 'crashed', 'down', 'outage', 'hotfix', 'incident',
  'production', 'deadline', 'blocked', 'cannot deploy', 'rollback',
];

const URGENCY_MEDIUM = [
  'soon', 'today', 'need', 'should', 'would like', 'trying to',
  'want to', 'planning', 'next sprint',
];

const EMOTION_STRUGGLING = [
  'frustrated', 'confused', 'lost', 'stuck', "don't know", 'cant', "can't",
  'unable', 'having trouble', 'not sure', 'struggling', "doesn't work",
  "doesn't make sense", 'weird behavior', 'weird error', 'no idea',
];

const EMOTION_POSITIVE = [
  'thanks', 'thank you', 'great', 'perfect', 'excellent', 'appreciate',
  'helpful', 'good', 'awesome', 'love it', 'nice', 'works now',
  'got it', 'finally', 'that worked',
];

const SCENARIO_INDICATORS: Record<ScenarioType, string[]> = {
  debugging: [
    'error', 'bug', 'exception', 'crash', 'stacktrace', 'traceback',
    'fix', 'broken', 'not working', 'failing', 'undefined', 'null',
    'typeerror', 'syntaxerror', 'referenceerror', 'why is', 'what is wrong',
    'issue', 'problem', 'panic', 'abort', 'segfault', 'runtime error',
  ],
  code_review: [
    'review', 'feedback', 'improve', 'refactor', 'clean up', 'best practice',
    'better way', 'looks good', 'check this', 'what do you think', 'opinion',
    'code quality', 'linting', 'style', 'readability', 'smell',
  ],
  architecture: [
    'design', 'structure', 'architecture', 'how should', 'pattern',
    'approach', 'organize', 'scalable', 'maintainable', 'system design',
    'microservice', 'monolith', 'api design', 'database design', 'schema',
    'trade-off', 'trade off', 'decision', 'when to use',
  ],
  feature_development: [
    'implement', 'add feature', 'new feature', 'build', 'create',
    'functionality', 'add support', 'integrate', 'develop', 'write code',
    'need to implement', 'how to build', 'add a',
  ],
  testing: [
    'test', 'spec', 'unit test', 'integration test', 'e2e', 'coverage',
    'mock', 'stub', 'spy', 'jest', 'mocha', 'pytest', 'vitest',
    'assert', 'expect', 'test suite', 'failing test', 'test case',
  ],
  documentation: [
    'document', 'comment', 'readme', 'docs', 'explain', 'describe',
    'jsdoc', 'docstring', 'api docs', 'documentation', 'type annotation',
    'changelog', 'annotate', 'inline comment',
  ],
  deployment: [
    'deploy', 'release', 'ci', 'cd', 'pipeline', 'docker', 'kubernetes',
    'container', 'helm', 'terraform', 'infra', 'cloud', 'aws', 'gcp', 'azure',
    'github actions', 'jenkins', 'build fails', 'rollback', 'migration',
  ],
  refactoring: [
    'refactor', 'cleanup', 'clean up', 'reorganize', 'simplify',
    'extract', 'rename', 'move', 'consolidate', 'technical debt',
    'legacy code', 'modernize', 'dry', "don't repeat",
  ],
  performance: [
    'performance', 'slow', 'optimize', 'speed up', 'bottleneck',
    'latency', 'memory leak', 'profil', 'benchmark', 'n+1',
    'cache', 'efficient', 'throughput', 'response time',
  ],
  security: [
    'security', 'vulnerability', 'injection', 'xss', 'csrf', 'sqli',
    'auth', 'authentication', 'authorization', 'permission', 'secret',
    'credential', 'token', 'encrypt', 'sanitize', 'input validation',
    'cve', 'pentest',
  ],
  learning: [
    'how do i', 'how to', 'explain', 'what is', 'teach me', 'show me',
    'first time', 'new to', 'understand', 'example', 'tutorial',
    'learning', 'curious about', 'difference between',
  ],
  general: [],  // fallback
};

const LANGUAGE_PATTERNS: Array<[RegExp, string]> = [
  [/\btypescript\b|\\.ts\b|\.tsx\b/i, 'TypeScript'],
  [/\bjavascript\b|\\.js\b|\.jsx\b|\bnode\.?js\b/i, 'JavaScript'],
  [/\bpython\b|\\.py\b|\bpip\b|\bpytest\b|\bdjango\b|\bfastapi\b/i, 'Python'],
  [/\brust\b|\bcargo\b|\\.rs\b/i, 'Rust'],
  [/\bgo\b|\bgolang\b|\\.go\b/i, 'Go'],
  [/\bjava\b|\\.java\b|\bspring\b|\bmaven\b|\bgradle\b/i, 'Java'],
  [/\bc#\b|\\.cs\b|\bdotnet\b|\.net\b|\baspnet\b/i, 'C#'],
  [/\bc\+\+\b|\bcpp\b|\\.cpp\b|\\.hpp\b/i, 'C++'],
  [/\bruby\b|\\.rb\b|\brails\b/i, 'Ruby'],
  [/\bphp\b|\\.php\b|\blaravel\b/i, 'PHP'],
  [/\bswift\b|\\.swift\b/i, 'Swift'],
  [/\bkotlin\b|\\.kt\b/i, 'Kotlin'],
  [/\bsql\b|\bpostgres\b|\bmysql\b|\bsqlite\b/i, 'SQL'],
  [/\bbash\b|\bshell\b|\\.sh\b|\bzsh\b/i, 'Shell'],
];

const TOOL_PATTERNS: Array<[RegExp, string]> = [
  [/\bgit\b|\bgithub\b|\bgitlab\b/i, 'Git'],
  [/\bdocker\b/i, 'Docker'],
  [/\bkubernetes\b|\bk8s\b|\bhelm\b/i, 'Kubernetes'],
  [/\bterraform\b|\bpulumi\b/i, 'Terraform'],
  [/\bvscode\b|\bvs code\b/i, 'VSCode'],
  [/\bwebpack\b|\bvite\b|\bbabel\b/i, 'Bundler'],
  [/\breact\b|\bnextjs\b|\bnext\.js\b/i, 'React/Next'],
  [/\bvue\b|\bnuxt\b/i, 'Vue/Nuxt'],
  [/\bpostgres\b|\bpsql\b/i, 'PostgreSQL'],
  [/\bredis\b|\bdragonfly\b/i, 'Redis/Dragonfly'],
  [/\bangularjs\b|\bangular\b/i, 'Angular'],
  [/\bgraphql\b/i, 'GraphQL'],
  [/\brest api\b|\bopenapi\b|\bswagger\b/i, 'REST/OpenAPI'],
];

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

function detectUrgency(lower: string): 'low' | 'medium' | 'high' {
  if (URGENCY_HIGH.some((kw) => lower.includes(kw))) return 'high';
  if (URGENCY_MEDIUM.some((kw) => lower.includes(kw))) return 'medium';
  return 'low';
}

function detectEmotion(lower: string): 'neutral' | 'struggling' | 'positive' {
  if (EMOTION_STRUGGLING.some((kw) => lower.includes(kw))) return 'struggling';
  if (EMOTION_POSITIVE.some((kw) => lower.includes(kw))) return 'positive';
  return 'neutral';
}

function identifyScenario(lower: string): ScenarioType {
  const scores: Record<ScenarioType, number> = {
    debugging: 0, code_review: 0, architecture: 0, feature_development: 0,
    testing: 0, documentation: 0, deployment: 0, refactoring: 0,
    performance: 0, security: 0, learning: 0, general: 0,
  };

  for (const [type, indicators] of Object.entries(SCENARIO_INDICATORS) as [ScenarioType, string[]][]) {
    scores[type] = indicators.filter((kw) => lower.includes(kw)).length;
  }

  const best = (Object.entries(scores) as [ScenarioType, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])[0];

  return best ? best[0] : 'general';
}

function detectLanguages(message: string): string[] {
  return LANGUAGE_PATTERNS
    .filter(([pattern]) => pattern.test(message))
    .map(([, name]) => name);
}

function detectTools(message: string): string[] {
  return TOOL_PATTERNS
    .filter(([pattern]) => pattern.test(message))
    .map(([, name]) => name);
}

function isQuestion(message: string): boolean {
  if (message.includes('?')) return true;
  const questionWords = [
    'what', 'where', 'when', 'why', 'how', 'who', 'which',
    'can', 'could', 'would', 'should', 'is', 'are', 'does', 'do',
    'explain', 'tell me',
  ];
  const first = message.toLowerCase().trim().split(/\s+/)[0] ?? '';
  return questionWords.includes(first);
}

function suggestMode(
  scenario: ScenarioType,
  urgency: 'low' | 'medium' | 'high',
  emotion: 'neutral' | 'struggling' | 'positive',
): CollabMode {
  if (urgency === 'high') return 'structured';
  if (emotion === 'struggling') return 'teacher';
  switch (scenario) {
    case 'learning':
    case 'documentation': return 'teacher';
    case 'architecture':
    case 'refactoring':
    case 'code_review': return 'exploratory';
    case 'debugging':
    case 'performance':
    case 'security': return 'structured';
    case 'testing':
    case 'deployment': return 'structured';
    default: return 'collaborative';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Exported class
// ──────────────────────────────────────────────────────────────────────────────

export class ContextAnalyzer {
  analyze(message: string): ContextAnalysis {
    const lower = message.toLowerCase();
    const urgency = detectUrgency(lower);
    const emotion = detectEmotion(lower);
    const scenarioType = identifyScenario(lower);

    return {
      timestamp: new Date().toISOString(),
      urgency,
      emotion,
      scenarioType,
      detectedLanguages: detectLanguages(message),
      detectedTools: detectTools(message),
      isQuestion: isQuestion(message),
      isLearningScenario: scenarioType === 'learning',
      isTechnicalIssue: ['debugging', 'performance', 'security', 'deployment'].includes(scenarioType),
      requiresDeepAnalysis: ['architecture', 'refactoring', 'code_review', 'performance'].includes(scenarioType),
      messageLength: message.length,
      suggestedMode: suggestMode(scenarioType, urgency, emotion),
    };
  }
}
