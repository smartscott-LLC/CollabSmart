/**
 * Anthropic Provider Adapter
 * ==========================
 * Wraps the Anthropic SDK to satisfy the AIProvider interface.
 * This is the original provider; its agentic loop logic is extracted
 * directly from the original anthropic.ts implementation.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, AgentLoopParams, NormalizedTool } from './types';

function toAnthropicTool(tool: NormalizedTool): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as Anthropic.Tool['input_schema'],
  };
}

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
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
    const anthropicTools = tools.map(toAnthropicTool);

    // Build message list for the first call
    const messages: Anthropic.MessageParam[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ];

    let finalResponse = '';
    let continueLoop = true;

    while (continueLoop) {
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: anthropicTools,
        messages,
      });

      if (response.stop_reason === 'tool_use') {
        const assistantContent = response.content;
        messages.push({ role: 'assistant', content: assistantContent });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of assistantContent) {
          if (block.type === 'text') {
            callbacks.onTextChunk(block.text);
            finalResponse += block.text;
          } else if (block.type === 'tool_use') {
            const input = block.input as Record<string, unknown>;
            callbacks.onToolStart(block.name, input);
            callbacks.onToolName?.(block.name);

            const result = await callbacks.executeTool(block.name, input);
            callbacks.onToolResult(block.name, result.success, result.output ?? result.error ?? '');

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result.success ? result.output || '' : `Error: ${result.error}`,
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
      } else {
        for (const block of response.content) {
          if (block.type === 'text') {
            finalResponse += block.text;
          }
        }
        continueLoop = false;
      }
    }

    return finalResponse;
  }
}
