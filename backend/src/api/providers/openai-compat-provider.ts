/**
 * OpenAI-Compatible Provider Adapter
 * ====================================
 * Implements the AIProvider interface using the OpenAI SDK, which supports
 * any provider that speaks the OpenAI API format.  This covers:
 *
 *   • OpenAI        — https://api.openai.com/v1
 *   • Ollama        — http://localhost:11434/v1  (fully local, free)
 *   • Groq          — https://api.groq.com/openai/v1  (free tier)
 *   • OpenRouter    — https://openrouter.ai/api/v1  (has free models)
 *   • Together AI   — https://api.together.xyz/v1  (free tier)
 *   • Any other OAI-compatible endpoint via a custom base URL
 */

import OpenAI from 'openai';
import type { AIProvider, AgentLoopParams, NormalizedTool } from './types';

type OAITool = OpenAI.Chat.Completions.ChatCompletionTool;
type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toOAITool(tool: NormalizedTool): OAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema as Record<string, unknown>,
    },
  };
}

export class OpenAICompatProvider implements AIProvider {
  private client: OpenAI;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || 'ollama', // Ollama ignores the key but the SDK requires a non-empty string
      baseURL,
    });
  }

  async runAgentLoop({
    model,
    maxTokens,
    systemPrompt,
    history,
    userMessage,
    tools,
    callbacks,
  }: AgentLoopParams): Promise<string> {
    const oaiTools = tools.map(toOAITool);

    // Build message list
    const messages: OAIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content } as OAIMessage)),
      { role: 'user', content: userMessage },
    ];

    let finalResponse = '';
    let continueLoop = true;

    while (continueLoop) {
      const response = await this.client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        tools: oaiTools.length > 0 ? oaiTools : undefined,
        messages,
      });

      const choice = response.choices[0];
      if (!choice) break;

      const { finish_reason, message } = choice;

      if (finish_reason === 'tool_calls' && message.tool_calls && message.tool_calls.length > 0) {
        // Add the assistant's tool-requesting message to history
        messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });

        const toolResultMessages: OAIMessage[] = [];

        for (const tc of message.tool_calls) {
          if (tc.type !== 'function') continue;

          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            input = {};
          }

          // Emit partial text if the model included any alongside the tool call
          if (message.content) {
            callbacks.onTextChunk(message.content);
            finalResponse += message.content;
          }

          callbacks.onToolStart(tc.function.name, input);
          callbacks.onToolName?.(tc.function.name);

          const result = await callbacks.executeTool(tc.function.name, input);
          callbacks.onToolResult(tc.function.name, result.success, result.output ?? result.error ?? '');

          toolResultMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result.success ? result.output || '' : `Error: ${result.error}`,
          });
        }

        messages.push(...toolResultMessages);
      } else {
        // Terminal turn — collect text
        const text = message.content ?? '';
        finalResponse += text;
        continueLoop = false;
      }
    }

    return finalResponse;
  }
}
