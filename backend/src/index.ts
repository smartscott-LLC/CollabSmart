import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import logger from './logger';
import { initOrchestrator } from './orchestrator';
import { processChat, clearConversation } from './api/anthropic';
import { getPgPool, getRedisClient, initSchema, closePools } from './db/pool';
import { MemoryManager } from './memory';

const PORT = parseInt(process.env.PORT || '3001', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const app = express();
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

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
