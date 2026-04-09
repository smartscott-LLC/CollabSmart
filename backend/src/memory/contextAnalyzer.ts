/**
 * Context Analyzer
 * ================
 * Analyzes conversation context to understand the situation, urgency, and user needs.
 * Adapted from memory/utils/context_analyzer.py for CollabSmart (AI pair-programming).
 *
 * This is the AI's "situational awareness" - understanding not just WHAT the user
 * said, but WHY they're saying it and WHAT they need.
 */

export interface ContextAnalysis {
  timestamp: string;
  urgency: 'low' | 'medium' | 'high';
  emotion: 'neutral' | 'stressed' | 'positive';
  scenarioType: string | null;
  isQuestion: boolean;
  isLearningScenario: boolean;
  isTechnicalIssue: boolean;
  requiresDeepAnalysis: boolean;
  messageLength: number;
}

const URGENCY_HIGH = [
  'urgent', 'asap', 'emergency', 'critical', 'immediately', 'right now',
  'broken', 'crash', 'crashed', 'down', 'not working', 'stuck', 'blocked',
  'deadline', 'production', 'outage',
];

const URGENCY_MEDIUM = [
  'soon', 'today', 'need', 'should', 'would like', 'trying to', 'want to',
];

const EMOTION_STRESSED = [
  'frustrated', 'confused', 'lost', 'stuck', "don't know", 'cant', "can't",
  'unable', 'having trouble', 'not sure', 'struggling',
];

const EMOTION_POSITIVE = [
  'thanks', 'thank you', 'great', 'perfect', 'excellent', 'appreciate',
  'helpful', 'good', 'awesome', 'love it', 'nice',
];

const SCENARIO_INDICATORS: Record<string, string[]> = {
  debugging: [
    'error', 'bug', 'exception', 'crash', 'stacktrace', 'traceback',
    'fix', 'broken', 'not working', 'failing', 'undefined', 'null',
    'typeerror', 'syntaxerror', 'referenceerror', 'why is', 'what is wrong',
  ],
  code_review: [
    'review', 'feedback', 'improve', 'refactor', 'clean up', 'best practice',
    'better way', 'looks good', 'check this', 'what do you think', 'opinion',
  ],
  architecture: [
    'design', 'structure', 'architecture', 'how should', 'pattern',
    'approach', 'organize', 'scalable', 'maintainable', 'system design',
  ],
  documentation: [
    'document', 'comment', 'readme', 'docs', 'explain', 'describe',
    'jsdoc', 'docstring', 'api docs', 'documentation',
  ],
  testing: [
    'test', 'spec', 'unit test', 'integration test', 'coverage', 'mock',
    'stub', 'jest', 'mocha', 'pytest', 'assert', 'expect',
  ],
  general_coding: [
    'code', 'implement', 'write', 'create', 'build', 'make', 'function',
    'class', 'module', 'component', 'feature',
  ],
  environment: [
    'install', 'setup', 'config', 'configuration', 'environment', 'docker',
    'container', 'dependency', 'package', 'version', 'compatibility',
  ],
  learning: [
    'how do i', 'how to', 'explain', 'what is', 'teach me', 'show me',
    'first time', 'new to', 'understand', 'example',
  ],
};

function analyzeUrgency(lower: string): 'low' | 'medium' | 'high' {
  if (URGENCY_HIGH.some((kw) => lower.includes(kw))) return 'high';
  if (URGENCY_MEDIUM.some((kw) => lower.includes(kw))) return 'medium';
  return 'low';
}

function detectEmotion(lower: string): 'neutral' | 'stressed' | 'positive' {
  if (EMOTION_STRESSED.some((kw) => lower.includes(kw))) return 'stressed';
  if (EMOTION_POSITIVE.some((kw) => lower.includes(kw))) return 'positive';
  return 'neutral';
}

function identifyScenario(lower: string): string | null {
  const scores: Record<string, number> = {};
  for (const [scenario, indicators] of Object.entries(SCENARIO_INDICATORS)) {
    const score = indicators.filter((kw) => lower.includes(kw)).length;
    if (score > 0) scores[scenario] = score;
  }
  if (Object.keys(scores).length === 0) return null;
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

function isQuestion(message: string): boolean {
  if (message.includes('?')) return true;
  const questionWords = [
    'what', 'where', 'when', 'why', 'how', 'who', 'which',
    'can', 'could', 'would', 'should', 'is', 'are', 'does', 'do',
  ];
  const firstWord = message.toLowerCase().trim().split(/\s+/)[0] ?? '';
  return questionWords.includes(firstWord);
}

function isLearningScenario(lower: string): boolean {
  const indicators = [
    'how do i', 'how to', 'teach me', 'show me', 'explain',
    'first time', 'new to', 'understanding', 'learning',
  ];
  return indicators.some((kw) => lower.includes(kw));
}

function isTechnicalIssue(lower: string): boolean {
  const indicators = [
    'error', 'bug', 'broken', 'not working', 'crash', 'exception', 'fail', 'issue',
  ];
  return indicators.some((kw) => lower.includes(kw));
}

function requiresDeepAnalysis(lower: string): boolean {
  const indicators = [
    'architecture', 'design', 'refactor', 'performance', 'optimize', 'scalable', 'review',
  ];
  return indicators.some((kw) => lower.includes(kw));
}

export class ContextAnalyzer {
  analyze(message: string): ContextAnalysis {
    const lower = message.toLowerCase();
    return {
      timestamp: new Date().toISOString(),
      urgency: analyzeUrgency(lower),
      emotion: detectEmotion(lower),
      scenarioType: identifyScenario(lower),
      isQuestion: isQuestion(message),
      isLearningScenario: isLearningScenario(lower),
      isTechnicalIssue: isTechnicalIssue(lower),
      requiresDeepAnalysis: requiresDeepAnalysis(lower),
      messageLength: message.length,
    };
  }
}
