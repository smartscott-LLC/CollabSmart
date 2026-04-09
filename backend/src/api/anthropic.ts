import Anthropic from '@anthropic-ai/sdk';
import { Socket } from 'socket.io';
import logger from '../logger';
import { TOOL_DEFINITIONS, dispatchTool } from '../tools';
import { broadcastLog } from '../orchestrator';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 4096;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationSession {
  history: ChatMessage[];
}

const conversations = new Map<string, ConversationSession>();

function getOrCreateConversation(sessionId: string): ConversationSession {
  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, { history: [] });
  }
  return conversations.get(sessionId)!;
}

export function clearConversation(sessionId: string): void {
  conversations.delete(sessionId);
}

function emitAILog(message: string, type = 'ai'): void {
  broadcastLog({
    timestamp: new Date().toISOString(),
    source: 'claude-haiku-4-5-20251001',
    actor: 'ai',
    message,
    type,
  });
}

export async function processChat(
  sessionId: string,
  userMessage: string,
  socket: Socket
): Promise<string> {
  const conversation = getOrCreateConversation(sessionId);

  conversation.history.push({ role: 'user', content: userMessage });

  const systemPrompt = `You are an AI pair programmer working inside a shared containerized Linux environment (CollabSmart). 
You have access to a live workspace directory where both you and the user can read and write files, run commands, and observe processes.

You have the following tools available:
- bash: Execute shell commands in the workspace
- file_write: Write files to the workspace  
- file_read: Read files from the workspace
- process_monitor: Check running processes
- log_tail: Tail log files in the workspace

Guidelines:
- Always explain what you're doing before executing commands
- Show the user what you observe in the environment
- Prefer making incremental, verifiable changes
- Report errors clearly and suggest fixes
- Keep the user in control - they can stop you at any time
- All your actions are visible to the user in real-time`;

  let messages: Anthropic.MessageParam[] = conversation.history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let finalResponse = '';

  try {
    let continueLoop = true;

    while (continueLoop) {
      emitAILog('Thinking...', 'thinking');

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools: TOOL_DEFINITIONS as Anthropic.Tool[],
        messages,
      });

      if (response.stop_reason === 'tool_use') {
        // Process tool calls
        const assistantContent = response.content;
        messages.push({ role: 'assistant', content: assistantContent });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of assistantContent) {
          if (block.type === 'text') {
            socket.emit('chat:typing', { text: block.text });
            finalResponse += block.text;
            emitAILog(block.text, 'text');
          } else if (block.type === 'tool_use') {
            emitAILog(`Using tool: ${block.name}`, 'tool-call');
            socket.emit('tool:start', { name: block.name, input: block.input });

            const result = await dispatchTool(
              block.name,
              block.input as Record<string, unknown>
            );

            socket.emit('tool:result', {
              name: block.name,
              success: result.success,
              output: result.output || result.error,
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result.success
                ? result.output || ''
                : `Error: ${result.error}`,
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
      } else {
        // End of conversation turn
        for (const block of response.content) {
          if (block.type === 'text') {
            finalResponse += block.text;
          }
        }
        continueLoop = false;
      }
    }

    conversation.history.push({ role: 'assistant', content: finalResponse });
    emitAILog(finalResponse, 'response');

    return finalResponse;
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`AI API error: ${error}`);
    emitAILog(`Error: ${error}`, 'error');
    throw err;
  }
}
