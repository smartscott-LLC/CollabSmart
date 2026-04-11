import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import logger from './logger';
import { initOrchestrator } from './orchestrator';
import { processChat, clearConversation, getConversation } from './api/anthropic';
import { linaInit, linaSessionStart, linaSessionEnd } from './api/lina';
import { getPgPool, getRedisClient, initSchema, closePools } from './db/pool';
import { MemoryManager } from './memory';
import { getAllSettingsWithMeta, getSetting, setSetting } from './settings';

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
  try {
    await initSchema();
  } catch (err) {
    logger.warn('Schema init failed (will retry on next startup)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await memory.connect();
}

// ── Health ─────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Resource metrics ───────────────────────────────────────────────────────

app.get('/api/health/resources', apiRateLimit, (_req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  let diskInfo = { total: 0, used: 0, available: 0, path: WORKSPACE_PATH };
  try {
    // execFileSync with an array avoids shell injection; the last non-header line is the data row
    const dfOutput = execFileSync('df', ['-k', WORKSPACE_PATH]).toString();
    const lines = dfOutput.trim().split('\n');
    const dataLine = lines[lines.length - 1] ?? '';
    const parts = dataLine.split(/\s+/);
    diskInfo = {
      path: WORKSPACE_PATH,
      total: parseInt(parts[1], 10) * 1024,
      used: parseInt(parts[2], 10) * 1024,
      available: parseInt(parts[3], 10) * 1024,
    };
  } catch {
    // df not available (e.g. non-Linux dev env) — leave zeros
  }

  res.json({
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      usedPct: Math.round(((totalMem - freeMem) / totalMem) * 100),
    },
    disk: {
      ...diskInfo,
      usedPct:
        diskInfo.total > 0
          ? Math.round((diskInfo.used / diskInfo.total) * 100)
          : 0,
    },
    uptime: Math.round(process.uptime()),
    nodeVersion: process.version,
  });
});

// ── Settings ───────────────────────────────────────────────────────────────

app.get('/api/settings', apiRateLimit, async (_req, res) => {
  try {
    const rows = await getAllSettingsWithMeta();
    res.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.put('/api/settings/:key', apiRateLimit, async (req, res) => {
  const { key } = req.params;
  const { value } = req.body as { value?: string };

  if (!key || value === undefined) {
    res.status(400).json({ error: 'key and value are required' });
    return;
  }

  try {
    await setSetting(key, String(value));
    res.json({ success: true, key, value });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Conversation ───────────────────────────────────────────────────────────

app.delete('/api/conversation/:sessionId', (req, res) => {
  clearConversation(req.params.sessionId, memory);
  res.json({ success: true });
});

// ── User Feedback ──────────────────────────────────────────────────────────

app.post('/api/feedback', apiRateLimit, async (req, res) => {
  const feedbackEnabled = await getSetting('feedback_collection_enabled', 'true').catch(() => 'true');
  if (feedbackEnabled !== 'true') {
    res.status(403).json({ error: 'Feedback collection is disabled' });
    return;
  }

  interface FeedbackBody {
    sessionId?: string;
    userId?: string;
    rating?: number;
    feedbackText?: string;
    scenarioType?: string;
    responseExcerpt?: string;
    ledToSolution?: boolean;
  }
  const { sessionId, userId, rating, feedbackText, scenarioType, responseExcerpt, ledToSolution } =
    req.body as FeedbackBody;

  if (!sessionId || !rating || rating < 1 || rating > 5) {
    res.status(400).json({ error: 'sessionId and rating (1-5) are required' });
    return;
  }

  try {
    await memory.agentFactory.recordFeedback(
      sessionId,
      userId,
      rating,
      feedbackText,
      scenarioType ?? 'general',
      responseExcerpt,
      ledToSolution,
    );
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Agents ─────────────────────────────────────────────────────────────────

app.get('/api/agents', apiRateLimit, async (_req, res) => {
  try {
    const agents = await memory.agentFactory.getActiveAgents();
    res.json(agents);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Tool Success Patterns ──────────────────────────────────────────────────

app.get('/api/patterns', apiRateLimit, async (req, res) => {
  try {
    const scenarioType = (req.query.scenario as string | undefined) ?? 'general';
    const maxAgeDays = parseInt((req.query.maxAge as string | undefined) ?? '30', 10);
    const patterns = await memory.agentFactory.getRelevantPatterns(
      scenarioType,
      [],
      maxAgeDays,
      20,
    );
    res.json(patterns);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Session Recordings ─────────────────────────────────────────────────────

app.get('/api/recordings', apiRateLimit, async (_req, res) => {
  try {
    const pool = getPgPool();
    const result = await pool.query(
      `SELECT id, session_id, user_id, title, message_count, duration_seconds,
              started_at, ended_at, scenario_types, tags
       FROM session_recordings
       ORDER BY started_at DESC
       LIMIT 50`,
    );
    res.json(result.rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/recordings/:id', apiRateLimit, async (req, res) => {
  try {
    const pool = getPgPool();
    const result = await pool.query(
      'SELECT * FROM session_recordings WHERE id = $1',
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.delete('/api/recordings/:id', apiRateLimit, async (req, res) => {
  try {
    const pool = getPgPool();
    await pool.query('DELETE FROM session_recordings WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── File Upload ────────────────────────────────────────────────────────────

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

// General API rate limiter (60 requests / IP / minute)
const apiRateMap = new Map<string, { count: number; resetAt: number }>();
function isApiRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = apiRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    apiRateMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  if (entry.count >= 60) return true;
  entry.count += 1;
  return false;
}

function apiRateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  if (isApiRateLimited(ip)) {
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
    return;
  }
  next();
}

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

// ── Save session recording on disconnect ──────────────────────────────────

async function saveSessionRecording(sessionId: string, startedAt: Date): Promise<void> {
  const conv = getConversation(sessionId);
  if (!conv || conv.history.length === 0) return;

  try {
    const enabled = await getSetting('session_recording_enabled', 'false');
    if (enabled !== 'true') return;

    const pool = getPgPool();
    const endedAt = new Date();
    const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    const title = `Session ${sessionId.slice(0, 8)} — ${endedAt.toLocaleString()}`;

    const messages = conv.history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    await pool.query(
      `INSERT INTO session_recordings
         (session_id, user_id, title, messages, message_count, duration_seconds, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        sessionId,
        conv.userId ?? null,
        title,
        JSON.stringify(messages),
        conv.history.length,
        durationSeconds,
        startedAt,
        endedAt,
      ],
    );

    logger.info(`Session recording saved: ${sessionId} (${conv.history.length} messages)`);
  } catch (err) {
    logger.warn('Failed to save session recording', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── WebSocket ──────────────────────────────────────────────────────────────

initOrchestrator(io, saveSessionRecording);

io.on('connection', (socket) => {
  // Track userId per socket for LINA session end
  let socketUserId: string | undefined;

  socket.on('chat:message', async (data: { sessionId: string; message: string; userId?: string }) => {
    const { sessionId, message, userId } = data;
    if (!sessionId || !message) {
      socket.emit('chat:error', { error: 'Missing sessionId or message' });
      return;
    }

    // Wire LINA on the first message of a session
    const effectiveUserId = userId ?? sessionId;
    if (!socketUserId) {
      socketUserId = effectiveUserId;
      // Fire-and-forget: init + session start (non-blocking)
      void linaInit(effectiveUserId).then(() =>
        linaSessionStart(effectiveUserId, sessionId)
      );
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

  socket.on('disconnect', () => {
    // Trigger LINA memory formation on disconnect
    if (socketUserId) {
      const sessionId = (socket as { sessionId?: string }).sessionId;
      if (sessionId) {
        void linaSessionEnd(socketUserId, sessionId);
      }
    }
  });
});

// ── Graceful shutdown ──────────────────────────────────────────────────────

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
