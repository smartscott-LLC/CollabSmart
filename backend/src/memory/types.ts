/**
 * Shared types for the CollabSmart memory system.
 */

/** Communication / collaboration modes the AI adapts to */
export type CollabMode =
  | 'collaborative'   // active pair-programming, building together
  | 'exploratory'     // brainstorming, architecture discussions
  | 'structured'      // step-by-step debugging or systematic analysis
  | 'quick_assist'    // fast answer, minimal back-and-forth
  | 'teacher';        // patient explanations, learning-focused

/** Coding scenario types detected from messages */
export type ScenarioType =
  | 'debugging'
  | 'code_review'
  | 'architecture'
  | 'feature_development'
  | 'testing'
  | 'documentation'
  | 'deployment'
  | 'refactoring'
  | 'performance'
  | 'security'
  | 'learning'
  | 'general';

export interface ContextAnalysis {
  timestamp: string;
  urgency: 'low' | 'medium' | 'high';
  emotion: 'neutral' | 'struggling' | 'positive';
  scenarioType: ScenarioType;
  detectedLanguages: string[];
  detectedTools: string[];
  isQuestion: boolean;
  isLearningScenario: boolean;
  isTechnicalIssue: boolean;
  requiresDeepAnalysis: boolean;
  messageLength: number;
  suggestedMode: CollabMode;
}

export interface StoredMessage {
  id?: string;
  sessionId: string;
  userId?: string;
  messageType: 'user' | 'assistant' | 'system';
  content: string;
  scenarioType: ScenarioType;
  conversationTopic?: string;
  tags: string[];
  programmingLanguages: string[];
  toolsMentioned: string[];
  emotionalMarkers: string[];
  importanceScore: number;
  timestamp: Date;
}

export interface SemanticMemory {
  concept: string;
  summary: string;
  emotionalValence: string;
  sentimentScore: number;
  relatedConcepts: string[];
  keyEntities: string[];
  scenarioTypes: string[];
  importanceScore: number;
  firstMentioned: Date;
  lastReferenced: Date;
  sourceSessions: string[];
}

export interface UserProfile {
  userId: string;
  sessionCount: number;
  preferredMode: CollabMode;
  communicationStyle: 'concise' | 'balanced' | 'detailed';
  primaryRole?: string;
  preferredLanguages: string[];
  totalInteractions: number;
  firstInteraction: Date;
  lastInteraction: Date;
  preferences: Record<string, unknown>;
}

export interface EnrichedContext {
  analysis: ContextAnalysis;
  recentHistory: string;
  longTermContext: string;
  systemPromptAddition: string;
  importanceScore: number;
  userProfile: UserProfile | null;
}
