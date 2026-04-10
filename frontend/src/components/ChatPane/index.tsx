'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useSocketStore, ChatMessage } from '../../hooks/useSocket';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const MAX_TEXT_FILE_BYTES = 1024 * 1024; // 1 MB — read as utf-8 text
const BINARY_EXTENSIONS = new Set([
  'png','jpg','jpeg','gif','bmp','webp','ico','svg',
  'pdf','zip','gz','tar','rar','7z','whl','exe','bin','so','dylib','dll',
  'mp3','mp4','mov','avi','mkv','wav',
]);

function isBinaryPath(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

async function readFileEntry(file: File): Promise<{ relativePath: string; content: string; encoding: 'utf8' | 'base64' }> {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const binary = isBinaryPath(file.name) || file.size > MAX_TEXT_FILE_BYTES;
    reader.onload = () => {
      if (binary) {
        // result is a data URL — strip the prefix
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1] ?? '';
        resolve({ relativePath, content: base64, encoding: 'base64' });
      } else {
        resolve({ relativePath, content: reader.result as string, encoding: 'utf8' });
      }
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    if (binary) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  });
}

const AI_DISPLAY_NAME = '◈ CollabSmart AI';

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
            {AI_DISPLAY_NAME}
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
  const [uploading, setUploading] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAIThinking]);

  // Close upload menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target as Node)) {
        setUploadMenuOpen(false);
      }
    }
    if (uploadMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [uploadMenuOpen]);

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

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploadMenuOpen(false);
    setUploading(true);

    try {
      const files = Array.from(fileList);
      const entries = await Promise.all(files.map(readFileEntry));

      const response = await fetch(`${BACKEND_URL}/api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: entries }),
      });

      const result = (await response.json()) as { uploadedPaths: string[]; errors: string[] };

      if (result.uploadedPaths.length > 0) {
        const pathList = result.uploadedPaths.map((p) => `  • /workspace/${p}`).join('\n');
        const errorNote =
          result.errors.length > 0
            ? `\n\n⚠️ ${result.errors.length} file(s) failed to upload.`
            : '';
        sendMessage(
          `I've uploaded ${result.uploadedPaths.length} file(s) to the workspace:\n${pathList}${errorNote}\n\nPlease acknowledge these files and help me work with them.`
        );
      } else {
        const errText = result.errors.join('; ');
        sendMessage(`Upload failed: ${errText}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendMessage(`Upload error: ${msg}`);
    } finally {
      setUploading(false);
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  }

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
                {AI_DISPLAY_NAME}
              </span>
              <span className="text-gray-400 animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="border-t border-sharp-border bg-sharp-surface px-4 py-3">
        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFilesSelected}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error -- webkitdirectory is not in React's type defs but is widely supported
          webkitdirectory="true"
          multiple
          className="hidden"
          onChange={handleFilesSelected}
        />

        <div className="flex gap-2">
          {/* Upload button with dropdown */}
          <div className="relative self-end" ref={uploadMenuRef}>
            <button
              type="button"
              onClick={() => setUploadMenuOpen((o) => !o)}
              disabled={status !== 'connected' || uploading}
              title="Upload files or folder to workspace"
              className="
                flex items-center justify-center w-9 h-9
                bg-sharp-bg border border-sharp-border rounded-lg
                text-gray-400 hover:text-sharp-accent hover:border-sharp-accent
                transition-colors disabled:opacity-40 disabled:cursor-not-allowed
              "
            >
              {uploading ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.41 17.41a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            {uploadMenuOpen && (
              <div className="
                absolute bottom-full left-0 mb-1 z-10
                bg-sharp-surface border border-sharp-border rounded-lg
                shadow-lg overflow-hidden min-w-[140px]
              ">
                <button
                  type="button"
                  onClick={() => { setUploadMenuOpen(false); fileInputRef.current?.click(); }}
                  className="
                    w-full text-left px-4 py-2 text-sm font-mono text-sharp-text
                    hover:bg-sharp-accent hover:text-white transition-colors flex items-center gap-2
                  "
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  Files
                </button>
                <button
                  type="button"
                  onClick={() => { setUploadMenuOpen(false); folderInputRef.current?.click(); }}
                  className="
                    w-full text-left px-4 py-2 text-sm font-mono text-sharp-text
                    hover:bg-sharp-accent hover:text-white transition-colors flex items-center gap-2
                    border-t border-sharp-border
                  "
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                  </svg>
                  Folder
                </button>
              </div>
            )}
          </div>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={status !== 'connected'}
            placeholder={
              status === 'connected'
                ? 'Message CollabSmart AI... (Enter to send, Shift+Enter for newline)'
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
