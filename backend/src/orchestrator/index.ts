import { Server as SocketIOServer, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import logger from '../logger';

export interface Session {
  id: string;
  socket: Socket;
  createdAt: Date;
  lastActivity: Date;
}

export type OnSessionEndCallback = (sessionId: string, startedAt: Date) => void | Promise<void>;

const sessions = new Map<string, Session>();

export function initOrchestrator(
  io: SocketIOServer,
  onSessionEnd?: OnSessionEndCallback,
): void {
  io.on('connection', (socket: Socket) => {
    const sessionId = uuidv4();
    const session: Session = {
      id: sessionId,
      socket,
      createdAt: new Date(),
      lastActivity: new Date(),
    };
    sessions.set(sessionId, session);

    logger.info(`New session connected: ${sessionId}`);
    socket.emit('session:init', { sessionId });

    socket.on('disconnect', () => {
      const s = sessions.get(sessionId);
      const startedAt = s?.createdAt ?? new Date();
      sessions.delete(sessionId);
      logger.info(`Session disconnected: ${sessionId}`);
      if (onSessionEnd) {
        void Promise.resolve(onSessionEnd(sessionId, startedAt)).catch((err: unknown) => {
          logger.warn('onSessionEnd callback failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    });

    socket.on('ping', () => {
      const s = sessions.get(sessionId);
      if (s) s.lastActivity = new Date();
      socket.emit('pong', { timestamp: Date.now() });
    });
  });

  // Clean up stale sessions every 5 minutes
  setInterval(() => {
    const now = new Date();
    for (const [id, session] of sessions.entries()) {
      const idleMs = now.getTime() - session.lastActivity.getTime();
      if (idleMs > 30 * 60 * 1000) {
        session.socket.disconnect(true);
        sessions.delete(id);
        logger.info(`Cleaned up stale session: ${id}`);
      }
    }
  }, 5 * 60 * 1000);
}

export function getActiveSessions(): Session[] {
  return Array.from(sessions.values());
}

export function broadcastLog(entry: object): void {
  for (const session of sessions.values()) {
    session.socket.emit('log:entry', entry);
  }
}
