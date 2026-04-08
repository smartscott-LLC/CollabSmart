import { exec, spawn } from 'child_process';
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

function emitToolLog(tool: string, detail: string, actor: 'ai' | 'user' = 'ai'): void {
  broadcastLog({
    timestamp: new Date().toISOString(),
    source: tool,
    actor,
    message: detail,
    type: 'tool',
  });
}

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

export const TOOL_DEFINITIONS = [
  {
    name: 'bash',
    description: 'Execute a shell command in the workspace directory',
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
    description: 'Write content to a file in the workspace',
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
    description: 'Read a file from the workspace',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path within workspace' },
      },
      required: ['path'],
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
];

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case 'bash':
      return toolBash(input.command as string);
    case 'file_write':
      return toolFileWrite(input.path as string, input.content as string);
    case 'file_read':
      return toolFileRead(input.path as string);
    case 'process_monitor':
      return toolProcessMonitor();
    case 'log_tail':
      return toolLogTail(input.path as string, (input.lines as number) || 50);
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}
