import { LogEntry } from '../hooks/useSocket';

export function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function getLogColor(type: string): string {
  switch (type) {
    case 'error':
      return 'text-red-400';
    case 'warning':
      return 'text-yellow-400';
    case 'tool-call':
      return 'text-cyan-400';
    case 'tool-result':
      return 'text-green-400';
    case 'thinking':
      return 'text-purple-400 italic';
    case 'response':
      return 'text-sharp-ai';
    case 'system':
      return 'text-gray-400';
    case 'fs-watch':
      return 'text-blue-400';
    default:
      return 'text-sharp-text';
  }
}

export function getActorBadge(actor: LogEntry['actor']): string {
  switch (actor) {
    case 'ai':
      return 'bg-cyan-900 text-cyan-300';
    case 'user':
      return 'bg-purple-900 text-purple-300';
    default:
      return 'bg-gray-800 text-gray-400';
  }
}
