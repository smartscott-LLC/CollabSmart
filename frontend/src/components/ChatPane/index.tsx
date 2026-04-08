'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useSocketStore, ChatMessage } from '../../hooks/useSocket';

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  if (isSystem) {
    return (
      <div className="text-center text-gray-500 text-xs py-1 font-mono">
        {msg.content}
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`
          max-w-[80%] px-4 py-2 rounded-lg text-sm font-mono whitespace-pre-wrap break-words
          ${isUser
            ? 'bg-sharp-user text-white rounded-br-none'
            : 'bg-sharp-surface border border-sharp-border text-sharp-text rounded-bl-none'
          }
        `}
      >
        {!isUser && (
          <span className="text-sharp-ai text-xs font-semibold block mb-1">
            ◈ Claude
          </span>
        )}
        {msg.content}
        <div className="text-xs opacity-40 mt-1 text-right">
          {msg.timestamp.toLocaleTimeString('en-US', { hour12: false })}
        </div>
      </div>
    </div>
  );
}

export default function ChatPane() {
  const { messages, isAIThinking, sendMessage, clearMessages, status } =
    useSocketStore();
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAIThinking]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || status !== 'connected') return;
    sendMessage(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-sharp-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sharp-border bg-sharp-surface">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-sharp-user" />
          <span className="text-sm font-semibold text-sharp-text">Chat</span>
          <span className="text-xs text-gray-500">— The Softness</span>
        </div>
        <button
          onClick={clearMessages}
          className="text-xs text-gray-500 hover:text-sharp-error transition-colors"
          title="Clear conversation"
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-600 text-sm mt-8">
            <div className="text-3xl mb-3">◈</div>
            <div className="text-sharp-accent-light font-semibold mb-1">
              CollabSmart
            </div>
            <div className="text-xs">
              AI pair programmer in your shared workspace.
              <br />
              Ask me to build, debug, or explore together.
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {isAIThinking && (
          <div className="flex justify-start mb-3">
            <div className="bg-sharp-surface border border-sharp-border px-4 py-2 rounded-lg rounded-bl-none text-sm">
              <span className="text-sharp-ai text-xs font-semibold block mb-1">
                ◈ Claude
              </span>
              <span className="text-gray-400 animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="border-t border-sharp-border bg-sharp-surface px-4 py-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={status !== 'connected'}
            placeholder={
              status === 'connected'
                ? 'Message Claude... (Enter to send, Shift+Enter for newline)'
                : 'Connecting...'
            }
            rows={2}
            className="
              flex-1 bg-sharp-bg border border-sharp-border rounded-lg
              px-3 py-2 text-sm font-mono text-sharp-text
              placeholder-gray-600 resize-none
              focus:outline-none focus:border-sharp-accent
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          />
          <button
            onClick={handleSend}
            disabled={status !== 'connected' || !input.trim()}
            className="
              px-4 py-2 bg-sharp-accent hover:bg-purple-700
              text-white rounded-lg text-sm font-semibold
              transition-colors disabled:opacity-40 disabled:cursor-not-allowed
              self-end
            "
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
