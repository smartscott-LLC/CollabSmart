import Anthropic from '@anthropic-ai/sdk';
import { Socket } from 'socket.io';
import logger from '../logger';
import { TOOL_DEFINITIONS, dispatchTool } from '../tools';
import { broadcastLog } from '../orchestrator';
import { MemoryManager } from '../memory';

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
  userId?: string;
}

const conversations = new Map<string, ConversationSession>();

function getOrCreateConversation(sessionId: string, userId?: string): ConversationSession {
  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, { history: [], userId });
  }
  return conversations.get(sessionId)!;
}

export function clearConversation(sessionId: string, memory: MemoryManager): void {
  conversations.delete(sessionId);
  void memory.clearSession(sessionId);
}

function emitAILog(message: string, type = 'ai'): void {
  broadcastLog({
    timestamp: new Date().toISOString(),
    source: MODEL,
    actor: 'ai',
    message,
    type,
  });
}

const CORE_SYSTEM_PROMPT = `You are an AI pair programmer working inside a shared containerized Linux environment (CollabSmart).
You have access to a live workspace directory where both you and the user can read and write files, run commands, and observe processes.

You have the following tools available:
- bash: Execute shell commands in the workspace
- file_write: Write files to the workspace
- file_read: Read files from the workspace
- process_monitor: Check running processes
- log_tail: Tail log files in the workspace

Guidelines:
- Always explain what you are doing before executing commands
- Show the user what you observe in the environment
- Prefer making incremental, verifiable changes
- Report errors clearly and suggest fixes
- Keep the user in control - they can stop you at any time
- All your actions are visible to the user in real-time`;

export async function processChat(
  sessionId: string,
  userMessage: string,
  socket: Socket,
  memory: MemoryManager,
  userId?: string,
): Promise<string> {
  const conversation = getOrCreateConversation(sessionId, userId);

  // Analyse context and retrieve tiered memory before calling Claude
  const enrichedContext = await memory.analyzeAndRetrieve(sessionId, userMessage, userId);

  conversation.history.push({ role: 'user', content: userMessage });

  const systemPrompt = enrichedContext.systemPromptAddition
    ? `${CORE_SYSTEM_PROMPT}\n\n${enrichedContext.systemPromptAddition}`
    : CORE_SYSTEM_PROMPT;

  const messages: Anthropic.MessageParam[] = conversation.history.map((m) => ({
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
              block.input as Record<string, unknown>,
            );

            socket.emit('tool:result', {
              name: block.name,
              success: result.success,
              output: result.output || result.error,
            });

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

    conversation.history.push({ role: 'assistant', content: finalResponse });
    emitAILog(finalResponse, 'response');

    // Persist the completed interaction across all memory tiers
    await memory.storeInteraction(
      sessionId,
      userMessage,
      finalResponse,
      enrichedContext.analysis,
      userId,
    );

    return finalResponse;
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`AI API error: ${error}`);
    emitAILog(`Error: ${error}`, 'error');
    throw err;
  }
}
