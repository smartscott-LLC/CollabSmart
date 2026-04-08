import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import logger from './logger';
import { initOrchestrator } from './orchestrator';
import { processChat, clearConversation } from './api/anthropic';

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

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// REST endpoint to clear conversation history
app.delete('/api/conversation/:sessionId', (req, res) => {
  clearConversation(req.params.sessionId);
  res.json({ success: true });
});

// Initialize the WebSocket orchestrator
initOrchestrator(io);

// Chat message handler
io.on('connection', (socket) => {
  socket.on('chat:message', async (data: { sessionId: string; message: string }) => {
    const { sessionId, message } = data;
    if (!sessionId || !message) {
      socket.emit('chat:error', { error: 'Missing sessionId or message' });
      return;
    }

    try {
      socket.emit('chat:start', { sessionId });
      const response = await processChat(sessionId, message, socket);
      socket.emit('chat:response', { sessionId, message: response });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`Chat error: ${error}`);
      socket.emit('chat:error', { error });
    }
  });
});

server.listen(PORT, () => {
  logger.info(`CollabSmart backend listening on port ${PORT}`);
});

export default app;
