import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import logger from '../logger';
import { broadcastLog } from '../orchestrator';

const execAsync = promisify(exec);

const WORKSPACE_PATH = process.env.WORKSPACE_PATH || '/workspace';

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

/** Optional context passed to tools that need memory access */
export interface ToolContext {
  sessionId?: string;
  userId?: string;
  // Memory accessors — injected by anthropic.ts when available
  recallLongTermMemory?: (scenarioType: string, entities: string[]) => Promise<Array<{ concept: string; summary: string }>>;
  storeLongTermMemory?: (concept: string, summary: string, entities: string[], scenarios: string[]) => Promise<void>;
}

function emitToolLog(tool: string, detail: string, actor: 'ai' | 'user' = 'ai'): void {
  broadcastLog({
    timestamp: new Date().toISOString(),
    source: tool,
    actor,
    message: detail,
    type: 'tool',
  });
}

// ── Workspace tools ───────────────────────────────────────────────────────────

/**
 * Execute a shell command inside the workspace container context.
 * Commands run with limited permissions - no host filesystem access outside workspace.
 */
export async function toolBash(command: string): Promise<ToolResult> {
  logger.info(`[tool:bash] Executing: ${command}`);
  emitToolLog('bash', `$ ${command}`);
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: WORKSPACE_PATH,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    const output = stdout || stderr || '';
    emitToolLog('bash', output);
    return { success: true, output };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    emitToolLog('bash', `Error: ${error}`);
    return { success: false, error };
  }
}

/**
 * Write a file into the workspace.
 */
export async function toolFileWrite(
  filePath: string,
  content: string
): Promise<ToolResult> {
  const safePath = path.resolve(WORKSPACE_PATH, filePath.replace(/^\//, ''));
  if (!safePath.startsWith(WORKSPACE_PATH)) {
    return { success: false, error: 'Path traversal attempt blocked' };
  }
  logger.info(`[tool:file_write] Writing: ${safePath}`);
  emitToolLog('file_write', `Writing ${filePath}`);
  try {
    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    fs.writeFileSync(safePath, content, 'utf8');
    return { success: true, output: `Written ${filePath}` };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Read a file from the workspace.
 */
export async function toolFileRead(filePath: string): Promise<ToolResult> {
  const safePath = path.resolve(WORKSPACE_PATH, filePath.replace(/^\//, ''));
  if (!safePath.startsWith(WORKSPACE_PATH)) {
    return { success: false, error: 'Path traversal attempt blocked' };
  }
  logger.info(`[tool:file_read] Reading: ${safePath}`);
  emitToolLog('file_read', `Reading ${filePath}`);
  try {
    const content = fs.readFileSync(safePath, 'utf8');
    return { success: true, output: content };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * List files and directories in a workspace path.
 */
export async function toolFileList(dirPath = '.'): Promise<ToolResult> {
  const safePath = path.resolve(WORKSPACE_PATH, dirPath.replace(/^\//, ''));
  if (!safePath.startsWith(WORKSPACE_PATH)) {
    return { success: false, error: 'Path traversal attempt blocked' };
  }
  emitToolLog('file_list', `Listing ${dirPath}`);
  try {
    const entries = fs.readdirSync(safePath, { withFileTypes: true });
    const lines = entries
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((e) => `${e.isDirectory() ? 'd' : '-'}  ${e.name}${e.isDirectory() ? '/' : ''}`);
    const output = `${safePath}\n${lines.join('\n')}`;
    return { success: true, output };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Search file contents in the workspace using grep.
 * Pattern is a basic string (not a regex) — escaped before passing to grep.
 */
export async function toolFileSearch(
  pattern: string,
  dirPath = '.',
  fileGlob = '*',
): Promise<ToolResult> {
  const safePath = path.resolve(WORKSPACE_PATH, dirPath.replace(/^\//, ''));
  if (!safePath.startsWith(WORKSPACE_PATH)) {
    return { success: false, error: 'Path traversal attempt blocked' };
  }
  emitToolLog('file_search', `Searching for "${pattern}" in ${dirPath}`);
  // Use -r for recursive, -l for filenames only when too many results, --include for glob filter
  // execAsync is used; the pattern argument is passed via env to avoid injection
  try {
    const { stdout, stderr } = await execAsync(
      `grep -r --include="${fileGlob}" -n -I --max-count=20 -F "${pattern.replace(/"/g, '\\"')}" .`,
      { cwd: safePath, timeout: 10000, maxBuffer: 512 * 1024 },
    );
    const output = stdout || stderr || '(no matches)';
    emitToolLog('file_search', output.slice(0, 500));
    return { success: true, output };
  } catch (err: unknown) {
    // grep exits 1 when no match — treat as success with empty results
    if (err instanceof Error && 'code' in err && Number((err as NodeJS.ErrnoException & { code: unknown }).code) === 1) {
      return { success: true, output: '(no matches)' };
    }
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * List running processes in the workspace.
 */
export async function toolProcessMonitor(): Promise<ToolResult> {
  emitToolLog('process_monitor', 'Listing processes');
  return toolBash('ps aux --no-headers 2>&1 | head -30');
}

/**
 * Tail a log file from the workspace.
 */
export async function toolLogTail(logFile: string, lines = 50): Promise<ToolResult> {
  const safePath = path.resolve(WORKSPACE_PATH, logFile.replace(/^\//, ''));
  if (!safePath.startsWith(WORKSPACE_PATH)) {
    return { success: false, error: 'Path traversal attempt blocked' };
  }
  emitToolLog('log_tail', `Tailing ${logFile} (${lines} lines)`);
  return toolBash(`tail -n ${lines} "${safePath}" 2>&1`);
}

// ── Git tools ─────────────────────────────────────────────────────────────────

/**
 * Show git status for the workspace repository.
 */
export async function toolGitStatus(): Promise<ToolResult> {
  emitToolLog('git_status', 'git status');
  return toolBash('git status 2>&1');
}

/**
 * Show git diff for the workspace repository.
 * Pass a specific file path to limit the diff, or leave empty for all changes.
 */
export async function toolGitDiff(filePath?: string): Promise<ToolResult> {
  const target = filePath ? ` -- "${filePath.replace(/"/g, '\\"')}"` : '';
  emitToolLog('git_diff', `git diff${target}`);
  return toolBash(`git diff${target} 2>&1`);
}

/**
 * Show recent git log entries.
 */
export async function toolGitLog(limit = 10): Promise<ToolResult> {
  const safeLimit = Math.min(Math.max(1, limit), 50);
  emitToolLog('git_log', `git log --oneline -${safeLimit}`);
  return toolBash(`git log --oneline -${safeLimit} 2>&1`);
}

/**
 * Stage all changes and commit with the given message.
 * Only operates within the workspace directory.
 */
export async function toolGitCommit(message: string): Promise<ToolResult> {
  if (!message || message.trim().length === 0) {
    return { success: false, error: 'Commit message cannot be empty' };
  }
  const safeMsg = message.replace(/"/g, '\\"').slice(0, 500);
  emitToolLog('git_commit', `git commit: ${safeMsg}`);
  return toolBash(`git add -A && git commit -m "${safeMsg}" 2>&1`);
}

// ── Memory tools ──────────────────────────────────────────────────────────────

/**
 * Recall relevant long-term memories for the current context.
 * The AI uses this to explicitly query its persistent memory.
 */
export async function toolMemoryRecall(
  query: string,
  ctx?: ToolContext,
): Promise<ToolResult> {
  emitToolLog('memory_recall', `Recalling memories for: ${query}`);

  if (!ctx?.recallLongTermMemory) {
    return { success: false, error: 'Memory system not available in this context' };
  }

  try {
    const memories = await ctx.recallLongTermMemory('general', [query]);
    if (memories.length === 0) {
      return { success: true, output: 'No relevant memories found.' };
    }
    const output = memories
      .map((m) => `• ${m.concept}: ${m.summary}`)
      .join('\n');
    emitToolLog('memory_recall', `Found ${memories.length} memories`);
    return { success: true, output };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Store a concept or lesson to long-term memory.
 * The AI uses this to explicitly memorise something important for future sessions.
 */
export async function toolMemoryStore(
  concept: string,
  summary: string,
  entities: string[],
  scenarioTypes: string[],
  ctx?: ToolContext,
): Promise<ToolResult> {
  emitToolLog('memory_store', `Storing memory: ${concept}`);

  if (!ctx?.storeLongTermMemory) {
    return { success: false, error: 'Memory system not available in this context' };
  }

  try {
    await ctx.storeLongTermMemory(concept, summary, entities, scenarioTypes);
    return { success: true, output: `Memory stored: "${concept}"` };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: 'bash',
    description: 'Execute a shell command in the workspace directory. Use for running scripts, installing packages, compiling code, running tests, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'file_write',
    description: 'Write content to a file in the workspace. Creates parent directories as needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path within workspace' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'file_read',
    description: 'Read a file from the workspace and return its content.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path within workspace' },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_list',
    description: 'List files and directories in a workspace directory. Directories are shown first.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path within workspace (default: ".")' },
      },
      required: [],
    },
  },
  {
    name: 'file_search',
    description: 'Search file contents in the workspace using a literal string pattern (like grep -F). Returns matching lines with line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Literal string to search for' },
        path: { type: 'string', description: 'Relative directory path to search in (default: ".")' },
        file_glob: { type: 'string', description: 'File glob pattern to filter files (default: "*", e.g. "*.ts")' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'process_monitor',
    description: 'List running processes in the workspace environment',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'log_tail',
    description: 'Tail a log file from the workspace',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative log file path within workspace' },
        lines: { type: 'number', description: 'Number of lines to tail (default 50)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'git_status',
    description: 'Show git status of the workspace repository — which files are modified, staged, or untracked.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'git_diff',
    description: 'Show git diff of the workspace repository. Optionally limit to a specific file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional relative file path to diff' },
      },
      required: [],
    },
  },
  {
    name: 'git_log',
    description: 'Show recent git commit history for the workspace repository.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of commits to show (default 10, max 50)' },
      },
      required: [],
    },
  },
  {
    name: 'git_commit',
    description: 'Stage all changes and create a git commit with the provided message. Use only when the user explicitly requests committing work.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message (max 500 characters)' },
      },
      required: ['message'],
    },
  },
  {
    name: 'memory_recall',
    description: 'Search long-term memory for concepts, patterns, or lessons relevant to the given query. Use to recall what has been learned across previous sessions.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query or concept to recall' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_store',
    description: 'Store a concept, lesson, or pattern to long-term memory so it can be recalled in future sessions. Use when you discover something important that should be remembered.',
    input_schema: {
      type: 'object',
      properties: {
        concept: { type: 'string', description: 'Short concept title (max 120 characters)' },
        summary: { type: 'string', description: 'Detailed summary of what should be remembered' },
        entities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key entities: technologies, project names, people',
        },
        scenario_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Relevant scenario types: debugging, architecture, security, deployment, etc.',
        },
      },
      required: ['concept', 'summary'],
    },
  },
];

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx?: ToolContext,
): Promise<ToolResult> {
  switch (name) {
    case 'bash':
      return toolBash(input.command as string);
    case 'file_write':
      return toolFileWrite(input.path as string, input.content as string);
    case 'file_read':
      return toolFileRead(input.path as string);
    case 'file_list':
      return toolFileList((input.path as string | undefined) ?? '.');
    case 'file_search':
      return toolFileSearch(
        input.pattern as string,
        (input.path as string | undefined) ?? '.',
        (input.file_glob as string | undefined) ?? '*',
      );
    case 'process_monitor':
      return toolProcessMonitor();
    case 'log_tail':
      return toolLogTail(input.path as string, (input.lines as number) || 50);
    case 'git_status':
      return toolGitStatus();
    case 'git_diff':
      return toolGitDiff(input.path as string | undefined);
    case 'git_log':
      return toolGitLog((input.limit as number) || 10);
    case 'git_commit':
      return toolGitCommit(input.message as string);
    case 'memory_recall':
      return toolMemoryRecall(input.query as string, ctx);
    case 'memory_store':
      return toolMemoryStore(
        input.concept as string,
        input.summary as string,
        (input.entities as string[] | undefined) ?? [],
        (input.scenario_types as string[] | undefined) ?? [],
        ctx,
      );
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

