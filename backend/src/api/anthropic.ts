import Anthropic from '@anthropic-ai/sdk';
import { Socket } from 'socket.io';
import logger from '../logger';
import { TOOL_DEFINITIONS, dispatchTool, ToolContext } from '../tools';
import { broadcastLog } from '../orchestrator';
import { MemoryManager } from '../memory';
import { getSetting } from '../settings';
import { linaGetContext, linaEvaluate } from './lina';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// Env-var defaults; overridden at call time by the DB settings.
const DEFAULT_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '4096', 10);

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationSession {
  history: ChatMessage[];
  userId?: string;
  startedAt: Date;
}

const conversations = new Map<string, ConversationSession>();

function getOrCreateConversation(sessionId: string, userId?: string): ConversationSession {
  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, { history: [], userId, startedAt: new Date() });
  }
  return conversations.get(sessionId)!;
}

export function getConversation(sessionId: string): ConversationSession | undefined {
  return conversations.get(sessionId);
}

export function clearConversation(sessionId: string, memory: MemoryManager): void {
  conversations.delete(sessionId);
  void memory.clearSession(sessionId);
}

function emitAILog(message: string, model: string, type = 'ai'): void {
  broadcastLog({
    timestamp: new Date().toISOString(),
    source: model,
    actor: 'ai',
    message,
    type,
  });
}

const CORE_SYSTEM_PROMPT = `You are an AI pair programmer working inside a shared containerized Linux environment (CollabSmart).
You have access to a live workspace directory where both you and the user can read and write files, run commands, and observe processes.
You are a co-worker, not a tool — think, explore, suggest, and build alongside the human as an equal collaborator.

You have the following tools available:

Workspace tools:
- bash: Execute shell commands in the workspace (30 s timeout)
- file_write: Write files to the workspace
- file_read: Read files from the workspace
- file_list: List files and directories in the workspace
- file_search: Search file contents with a literal pattern (like grep)
- process_monitor: Check running processes
- log_tail: Tail log files in the workspace

Version control tools (operate on the workspace git repo):
- git_status: Show which files are changed/staged/untracked
- git_diff: Show diff of current changes
- git_log: Show recent commit history
- git_commit: Stage all changes and commit (only when user requests)

Memory tools (your persistent memory across sessions):
- memory_recall: Search your long-term memory for relevant concepts and lessons
- memory_store: Store an important concept or pattern to long-term memory for future sessions

Guidelines:
- Always explain what you are doing before executing commands
- Show the user what you observe in the environment
- Prefer making incremental, verifiable changes
- Report errors clearly and suggest fixes
- Keep the user in control — they can stop you at any time
- All your actions are visible to the user in real-time
- Use memory_recall at the start of complex tasks to check for relevant past learnings
- Use memory_store when you discover something reusable that should persist across sessions`;

export async function processChat(
  sessionId: string,
  userMessage: string,
  socket: Socket,
  memory: MemoryManager,
  userId?: string,
): Promise<string> {
  const conversation = getOrCreateConversation(sessionId, userId);

  // Read runtime settings (DB-backed, cached 60 s, env-var fallback)
  const model = await getSetting('ai_model', DEFAULT_MODEL);
  const maxTokens = parseInt(await getSetting('ai_max_tokens', String(DEFAULT_MAX_TOKENS)), 10);
  const toolPatternEnabled = await getSetting('tool_pattern_memory_enabled', 'true');
  const maxPatternAgeDays = parseInt(await getSetting('max_tool_pattern_age_days', '30'), 10);

  // Analyse context and retrieve tiered memory before calling Claude
  const enrichedContext = await memory.analyzeAndRetrieve(sessionId, userMessage, userId);

  // Build tool context so memory tools can access LTM
  const toolCtx: ToolContext = {
    sessionId,
    userId,
    recallLongTermMemory: (scenarioType, entities) =>
      memory.ltm.retrieveRelevant(scenarioType, entities, 5),
    storeLongTermMemory: (concept, summary, entities, scenarios) =>
      memory.ltm.storeFoundationMemory(concept, summary, entities, scenarios),
  };

  conversation.history.push({ role: 'user', content: userMessage });

  // Attempt to get LINA's identity-aware system prompt.
  // Falls back to the flat CORE_SYSTEM_PROMPT if LINA is unavailable.
  const effectiveUserId = userId ?? sessionId;
  const linaCtx = await linaGetContext(effectiveUserId);
  const basePrompt = linaCtx?.system_prompt ?? CORE_SYSTEM_PROMPT;

  const systemPrompt = enrichedContext.systemPromptAddition
    ? `${basePrompt}\n\n${enrichedContext.systemPromptAddition}`
    : basePrompt;

  const messages: Anthropic.MessageParam[] = conversation.history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let finalResponse = '';
  const toolSequenceUsed: string[] = []; // track tool calls in this turn

  try {
    let continueLoop = true;

    while (continueLoop) {
      emitAILog('Thinking...', model, 'thinking');

      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
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
            emitAILog(block.text, model, 'text');
          } else if (block.type === 'tool_use') {
            const startTime = Date.now();
            emitAILog(`Using tool: ${block.name}`, model, 'tool-call');
            socket.emit('tool:start', { name: block.name, input: block.input });

            const result = await dispatchTool(
              block.name,
              block.input as Record<string, unknown>,
              toolCtx,
            );

            const processingMs = Date.now() - startTime;
            toolSequenceUsed.push(block.name);

            socket.emit('tool:result', {
              name: block.name,
              success: result.success,
              output: result.output || result.error,
            });

            // Record invocation in agent factory (best-effort)
            const agentFactoryEnabled = await getSetting('agent_factory_enabled', 'true');
            if (agentFactoryEnabled === 'true') {
              const agent = await memory.agentFactory
                .selectAgent(userMessage, enrichedContext.analysis.scenarioType)
                .catch(() => null);

              await memory.agentFactory
                .recordInvocation({
                  agentId: agent?.id,
                  sessionId,
                  userId,
                  userQuery: userMessage,
                  toolUsed: block.name,
                  toolInput: block.input as Record<string, unknown>,
                  toolOutputExcerpt: result.output ?? result.error,
                  wasSuccessful: result.success,
                  processingTimeMs: processingMs,
                  delegationConfidence: agent ? 0.8 : 0.0,
                  delegationReason: agent
                    ? `Scenario match: ${enrichedContext.analysis.scenarioType}`
                    : 'No agent matched',
                  scenarioType: enrichedContext.analysis.scenarioType,
                })
                .catch(() => {});
            }

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
    emitAILog(finalResponse, model, 'response');

    // Run LINA's value engine on the final response (non-blocking)
    void linaEvaluate(effectiveUserId, sessionId, finalResponse, userMessage).then(
      (evaluation) => {
        if (evaluation && !evaluation.is_aligned) {
          logger.warn('[LINA] response outside polytope', {
            sessionId,
            alignment_score: evaluation.alignment_score,
            violations: evaluation.violations.map((v) => v.name),
          });
        }
        if (evaluation?.wisdom.overconfidence) {
          logger.info('[LINA] overconfidence detected in response', { sessionId });
        }
      },
    );

    // Persist the completed interaction across all memory tiers
    await memory.storeInteraction(
      sessionId,
      userMessage,
      finalResponse,
      enrichedContext.analysis,
      userId,
    );

    // Store successful tool-use pattern if any tools were used
    if (toolPatternEnabled === 'true' && toolSequenceUsed.length > 0) {
      const contextDesc = userMessage.length > 200
        ? userMessage.slice(0, 197) + '...'
        : userMessage;
      const outcomeDesc = finalResponse.length > 200
        ? finalResponse.slice(0, 197) + '...'
        : finalResponse;

      await memory.agentFactory
        .storeSuccessPattern(
          sessionId,
          userId,
          toolSequenceUsed,
          enrichedContext.analysis.scenarioType,
          contextDesc,
          outcomeDesc,
          enrichedContext.analysis.detectedLanguages,
          enrichedContext.importanceScore,
        )
        .catch((e) => logger.warn('[processChat] storeSuccessPattern failed', {
          error: e instanceof Error ? e.message : String(e),
        }));
    }

    return finalResponse;
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`AI API error: ${error}`);
    emitAILog(`Error: ${error}`, model, 'error');
    throw err;
  }
}
