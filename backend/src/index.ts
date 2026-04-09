import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import logger from './logger';
import { initOrchestrator } from './orchestrator';
import { processChat, clearConversation } from './api/anthropic';
import { getPgPool, getRedisClient, initSchema, closePools } from './db/pool';
import { MemoryManager } from './memory';

const PORT = parseInt(process.env.PORT || '3001', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const WORKSPACE_PATH = process.env.WORKSPACE_PATH || '/workspace';

const app = express();
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '50mb' }));

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Initialise memory system (non-blocking - graceful degradation if DBs not ready)
const memory = new MemoryManager(getPgPool(), getRedisClient());

async function bootstrap(): Promise<void> {
  // Attempt to connect to backing stores and run schema migration
  try {
    await initSchema();
  } catch (err) {
    logger.warn('Schema init failed (will retry on next startup)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await memory.connect();
}

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// REST endpoint to clear conversation history and all memory tiers for a session
app.delete('/api/conversation/:sessionId', (req, res) => {
  clearConversation(req.params.sessionId, memory);
  res.json({ success: true });
});

interface UploadFile {
  relativePath: string;
  content: string;
  encoding: 'utf8' | 'base64';
}

// Simple in-memory rate limiter: max 20 upload requests per IP per minute
const uploadRateMap = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = uploadRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    uploadRateMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  if (entry.count >= 20) return true;
  entry.count += 1;
  return false;
}

// REST endpoint to upload files/folders into the workspace
app.post('/api/upload', (req, res) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many upload requests. Please wait a moment.' });
    return;
  }

  const files: UploadFile[] = req.body?.files;

  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: 'No files provided' });
    return;
  }

  if (files.length > 200) {
    res.status(400).json({ error: 'Too many files (max 200 per upload)' });
    return;
  }

  const uploadedPaths: string[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (!file.relativePath || typeof file.content !== 'string') {
      errors.push(`Invalid file entry: ${String(file.relativePath)}`);
      continue;
    }

    // Normalise and guard against path traversal
    const normalised = path.normalize(file.relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const destPath = path.resolve(WORKSPACE_PATH, 'uploads', normalised);

    if (!destPath.startsWith(path.resolve(WORKSPACE_PATH))) {
      errors.push(`Blocked path traversal attempt: ${file.relativePath}`);
      continue;
    }

    try {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const buffer =
        file.encoding === 'base64'
          ? Buffer.from(file.content, 'base64')
          : Buffer.from(file.content, 'utf8');
      fs.writeFileSync(destPath, buffer);
      const relativeToWorkspace = path.relative(WORKSPACE_PATH, destPath);
      uploadedPaths.push(relativeToWorkspace);
      logger.info(`[upload] Written: ${destPath}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to write ${file.relativePath}: ${msg}`);
      logger.error(`[upload] Error writing ${destPath}: ${msg}`);
    }
  }

  res.json({ uploadedPaths, errors });
});

// Initialise WebSocket orchestrator
initOrchestrator(io);

// Chat message handler
io.on('connection', (socket) => {
  socket.on('chat:message', async (data: { sessionId: string; message: string; userId?: string }) => {
    const { sessionId, message, userId } = data;
    if (!sessionId || !message) {
      socket.emit('chat:error', { error: 'Missing sessionId or message' });
      return;
    }

    try {
      socket.emit('chat:start', { sessionId });
      const response = await processChat(sessionId, message, socket, memory, userId);
      socket.emit('chat:response', { sessionId, message: response });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`Chat error: ${error}`);
      socket.emit('chat:error', { error });
    }
  });
});

// Graceful shutdown
function shutdown(): void {
  logger.info('Shutting down...');
  memory.destroy();
  void closePools().then(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  logger.info(`CollabSmart backend listening on port ${PORT}`);
  void bootstrap();
});

export default app;
