'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSocketStore, LogEntry } from '../../hooks/useSocket';
import { formatTimestamp, getLogColor, getActorBadge } from '../../utils/formatters';

function LogRow({ entry }: { entry: LogEntry }) {
  const color = getLogColor(entry.type);
  const badge = getActorBadge(entry.actor);

  return (
    <div className="flex items-start gap-2 px-3 py-0.5 hover:bg-sharp-surface/50 group text-xs font-mono">
      <span className="text-gray-600 shrink-0 pt-0.5">
        {formatTimestamp(entry.timestamp)}
      </span>
      <span
        className={`text-xs px-1 rounded shrink-0 pt-0.5 ${badge}`}
        title={entry.actor}
      >
        {entry.source.slice(0, 8)}
      </span>
      <span className={`break-all leading-relaxed ${color}`}>{entry.message}</span>
    </div>
  );
}

export default function LogSidebar() {
  const { logs, clearLogs } = useSocketStore();
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = filter
    ? logs.filter(
        (l) =>
          l.message.toLowerCase().includes(filter.toLowerCase()) ||
          l.source.toLowerCase().includes(filter.toLowerCase()) ||
          l.type.toLowerCase().includes(filter.toLowerCase())
      )
    : logs;

  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  return (
    <div className="flex flex-col h-full bg-sharp-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sharp-border bg-sharp-surface">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-sharp-ai animate-pulse" />
          <span className="text-sm font-semibold text-sharp-text">Live Logs</span>
          <span className="text-xs text-gray-500">— The Sharpness</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{logs.length} entries</span>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              autoScroll
                ? 'bg-sharp-accent text-white'
                : 'bg-sharp-surface border border-sharp-border text-gray-400'
            }`}
            title="Toggle auto-scroll"
          >
            ↓ Auto
          </button>
          <button
            onClick={clearLogs}
            className="text-xs text-gray-500 hover:text-sharp-error transition-colors"
            title="Clear logs"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="px-3 py-2 border-b border-sharp-border bg-sharp-surface/50">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter logs..."
          className="
            w-full bg-sharp-bg border border-sharp-border rounded px-2 py-1
            text-xs font-mono text-sharp-text placeholder-gray-600
            focus:outline-none focus:border-sharp-accent
          "
        />
      </div>

      {/* Log entries */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-1"
      >
        {filtered.length === 0 && (
          <div className="text-center text-gray-600 text-xs mt-8">
            {filter ? 'No matching logs' : 'Waiting for events...'}
          </div>
        )}
        {filtered.map((entry) => (
          <LogRow key={entry.id} entry={entry} />
        ))}
        <div ref={endRef} />
      </div>

      {/* Legend */}
      <div className="border-t border-sharp-border bg-sharp-surface/50 px-3 py-2 flex gap-3 flex-wrap">
        {[
          { label: 'AI', cls: 'text-cyan-400' },
          { label: 'Tool', cls: 'text-green-400' },
          { label: 'FS', cls: 'text-blue-400' },
          { label: 'Err', cls: 'text-red-400' },
        ].map(({ label, cls }) => (
          <span key={label} className={`text-xs font-mono ${cls}`}>
            ● {label}
          </span>
        ))}
      </div>
    </div>
  );
}
