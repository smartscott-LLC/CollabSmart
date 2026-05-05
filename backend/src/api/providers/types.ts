/**
 * AI Provider Abstraction
 * =======================
 * Defines the common interface that every AI provider adapter must implement.
 * Each adapter runs its own agentic tool-use loop internally, so the
 * provider-specific message formats (Anthropic vs OpenAI-style) are fully
 * encapsulated here and invisible to the rest of the application.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface NormalizedTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface AgentLoopCallbacks {
  /** Called with each incremental text fragment as the model streams. */
  onTextChunk: (text: string) => void;
  /** Called before the tool executes; return value is ignored. */
  onToolStart: (name: string, input: Record<string, unknown>) => void;
  /** Called after the tool completes. */
  onToolResult: (name: string, success: boolean, output: string) => void;
  /** Execute a named tool and return the result. */
  executeTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  /** Called each time a tool is invoked so callers can track sequence. */
  onToolName?: (name: string) => void;
}

export interface AgentLoopParams {
  model: string;
  maxTokens: number;
  systemPrompt: string;
  /** Full conversation history (excluding the current user turn). */
  history: ChatMessage[];
  userMessage: string;
  tools: NormalizedTool[];
  callbacks: AgentLoopCallbacks;
}

/**
 * Every AI provider adapter must implement this interface.
 * The adapter is responsible for:
 *  1. Translating `NormalizedTool` definitions to the provider-specific format.
 *  2. Running the agentic loop (model → tool calls → model …) until the
 *     model stops requesting tools.
 *  3. Returning the complete final text response.
 */
export interface AIProvider {
  runAgentLoop(params: AgentLoopParams): Promise<string>;
}

/** Supported provider identifiers (stored in the `ai_provider` setting). */
export type ProviderName =
  | 'anthropic'
  | 'openai'
  | 'ollama'
  | 'groq'
  | 'openrouter'
  | 'together_ai'
  | 'gemini';
