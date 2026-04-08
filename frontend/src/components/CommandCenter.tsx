'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSocketStore } from '../hooks/useSocket';
import ChatPane from './ChatPane';
import LogSidebar from './LogSidebar';
import DesktopFrame from './DesktopFrame';

const NOVNC_URL = process.env.NEXT_PUBLIC_NOVNC_URL || 'http://localhost:6080/vnc.html';

const STATUS_COLORS: Record<string, string> = {
  connected: 'bg-sharp-success',
  connecting: 'bg-yellow-500 animate-pulse',
  disconnected: 'bg-gray-600',
  error: 'bg-sharp-error',
};

export default function CommandCenter() {
  const { connect, disconnect, status, sessionId } = useSocketStore();

  // Pane sizing state (% widths for left/center/right)
  const [panes, setPanes] = useState({ chat: 25, desktop: 45, logs: 30 });
  const [desktopVisible, setDesktopVisible] = useState(true);

  // Drag state for resize handles
  const dragRef = useRef<{
    active: boolean;
    which: 'chat-desktop' | 'desktop-logs';
    startX: number;
    startPanes: typeof panes;
  } | null>(null);

  useEffect(() => {
    connect();
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current?.active) return;
    const { which, startX, startPanes } = dragRef.current;
    const containerWidth = window.innerWidth;
    const delta = ((e.clientX - startX) / containerWidth) * 100;

    if (which === 'chat-desktop') {
      const newChat = Math.max(15, Math.min(50, startPanes.chat + delta));
      const newDesktop = Math.max(20, startPanes.desktop - delta);
      setPanes((p) => ({ ...p, chat: newChat, desktop: newDesktop }));
    } else {
      const newDesktop = Math.max(20, Math.min(60, startPanes.desktop + delta));
      const newLogs = Math.max(15, startPanes.logs - delta);
      setPanes((p) => ({ ...p, desktop: newDesktop, logs: newLogs }));
    }
  };

  const handleMouseUp = () => {
    if (dragRef.current) dragRef.current.active = false;
  };

  const startDrag = (which: 'chat-desktop' | 'desktop-logs', e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { active: true, which, startX: e.clientX, startPanes: { ...panes } };
  };

  return (
    <div
      className="flex flex-col h-screen bg-sharp-bg overflow-hidden select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-2 bg-sharp-surface border-b border-sharp-border shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sharp-accent-light font-bold text-base tracking-tight">
            ◈ CollabSmart
          </span>
          <span className="text-gray-600 text-xs hidden md:inline">
            Sovereign AI-OS
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Desktop toggle */}
          <button
            onClick={() => setDesktopVisible((v) => !v)}
            className="text-xs px-3 py-1 rounded border border-sharp-border text-gray-400 hover:text-sharp-text hover:border-sharp-accent transition-colors"
          >
            {desktopVisible ? 'Hide Desktop' : 'Show Desktop'}
          </button>

          {/* Session ID */}
          {sessionId && (
            <span className="text-xs text-gray-600 font-mono hidden md:inline">
              {sessionId.slice(0, 8)}
            </span>
          )}

          {/* Connection status */}
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[status] || 'bg-gray-600'}`} />
            <span className="text-xs text-gray-400 capitalize">{status}</span>
          </div>
        </div>
      </header>

      {/* Main pane area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat pane */}
        <div
          style={{ width: `${panes.chat}%` }}
          className="h-full border-r border-sharp-border overflow-hidden"
        >
          <ChatPane />
        </div>

        {/* Resize handle: chat ↔ desktop */}
        <div
          className="resize-handle w-1 bg-sharp-border hover:bg-sharp-accent transition-colors shrink-0"
          onMouseDown={(e) => startDrag('chat-desktop', e)}
          title="Drag to resize"
        />

        {/* Desktop frame */}
        {desktopVisible && (
          <>
            <div
              style={{ width: `${panes.desktop}%` }}
              className="h-full border-r border-sharp-border overflow-hidden"
            >
              <DesktopFrame url={`${NOVNC_URL}?autoconnect=1&resize=scale`} />
            </div>

            {/* Resize handle: desktop ↔ logs */}
            <div
              className="resize-handle w-1 bg-sharp-border hover:bg-sharp-accent transition-colors shrink-0"
              onMouseDown={(e) => startDrag('desktop-logs', e)}
              title="Drag to resize"
            />
          </>
        )}

        {/* Log sidebar */}
        <div className="flex-1 h-full overflow-hidden">
          <LogSidebar />
        </div>
      </div>
    </div>
  );
}
