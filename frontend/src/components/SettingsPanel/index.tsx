'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppSetting {
  key: string;
  value: string;
  description: string;
}

interface ResourceMetrics {
  memory: { total: number; free: number; used: number; usedPct: number };
  disk: { total: number; used: number; available: number; usedPct: number; path: string };
  uptime: number;
  nodeVersion: string;
}

interface Recording {
  id: string;
  session_id: string;
  user_id: string | null;
  title: string;
  message_count: number;
  duration_seconds: number;
  started_at: string;
  ended_at: string;
  scenario_types: string[];
  tags: string[];
}

interface RecordingDetail extends Recording {
  messages: { role: string; content: string }[];
}

type Tab = 'ai' | 'memory' | 'session' | 'resources';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function fmtUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function UsageBar({ pct, color = 'bg-sharp-accent' }: { pct: number; color?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const barColor =
    clamped > 85 ? 'bg-sharp-error' : clamped > 65 ? 'bg-sharp-warning' : color;
  return (
    <div className="w-full bg-sharp-border rounded-full h-2 overflow-hidden">
      <div
        className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-3 border-b border-sharp-border last:border-0">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-sharp-text font-mono">{label}</span>
        <div className="shrink-0">{children}</div>
      </div>
      {description && (
        <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
      )}
    </div>
  );
}

function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
        focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed
        ${value ? 'bg-sharp-accent' : 'bg-sharp-border'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
          ${value ? 'translate-x-4' : 'translate-x-1'}`}
      />
    </button>
  );
}

function TextInput({
  value,
  onChange,
  type = 'text',
  min,
  max,
  step,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(e.target.value)}
      className="
        w-36 bg-sharp-bg border border-sharp-border rounded px-2 py-1
        text-xs font-mono text-sharp-text text-right
        focus:outline-none focus:border-sharp-accent
      "
    />
  );
}

function SelectInput({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="
        w-52 bg-sharp-bg border border-sharp-border rounded px-2 py-1
        text-xs font-mono text-sharp-text
        focus:outline-none focus:border-sharp-accent
      "
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

/** Per-provider suggested model IDs shown as quick-select hints. */
const PROVIDER_MODEL_SUGGESTIONS: Record<string, Array<{ value: string; label: string }>> = {
  anthropic: [
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fast)' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (Balanced-Fast)' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Powerful)' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus (Most Capable)' },
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast, Affordable)' },
    { value: 'gpt-4o', label: 'GPT-4o (Powerful)' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Economy)' },
  ],
  ollama: [
    { value: 'llama3.2', label: 'Llama 3.2 (Free, Local)' },
    { value: 'llama3.1', label: 'Llama 3.1 (Free, Local)' },
    { value: 'mistral', label: 'Mistral 7B (Free, Local)' },
    { value: 'gemma2', label: 'Gemma 2 (Free, Local)' },
    { value: 'qwen2.5-coder', label: 'Qwen 2.5 Coder (Free, Local)' },
    { value: 'phi4', label: 'Phi-4 (Free, Local)' },
    { value: 'deepseek-r1', label: 'DeepSeek R1 (Free, Local)' },
  ],
  groq: [
    { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (Free tier)' },
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile (Free tier)' },
    { value: 'gemma2-9b-it', label: 'Gemma 2 9B (Free tier)' },
    { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B (Free tier)' },
  ],
  openrouter: [
    { value: 'meta-llama/llama-4-maverick:free', label: 'Llama 4 Maverick (FREE)' },
    { value: 'meta-llama/llama-4-scout:free', label: 'Llama 4 Scout (FREE)' },
    { value: 'google/gemma-3-27b-it:free', label: 'Gemma 3 27B (FREE)' },
    { value: 'mistralai/mistral-7b-instruct:free', label: 'Mistral 7B (FREE)' },
    { value: 'qwen/qwen3-30b-a3b:free', label: 'Qwen3 30B (FREE)' },
    { value: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1 (FREE)' },
  ],
  together_ai: [
    { value: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo', label: 'Llama 3.2 90B (Free tier)' },
    { value: 'mistralai/Mistral-7B-Instruct-v0.3', label: 'Mistral 7B (Free tier)' },
    { value: 'Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen 2.5 Coder 32B (Free tier)' },
  ],
};

const PROVIDER_OPTIONS = [
  { value: 'anthropic', label: '🤖 Anthropic (Claude)' },
  { value: 'openai', label: '🟢 OpenAI (GPT)' },
  { value: 'ollama', label: '🦙 Ollama (FREE — local)' },
  { value: 'groq', label: '⚡ Groq (FREE tier)' },
  { value: 'openrouter', label: '🌐 OpenRouter (FREE models)' },
  { value: 'together_ai', label: '🤝 Together AI (FREE tier)' },
];

function AITab({
  settings,
  saving,
  onSave,
}: {
  settings: Record<string, string>;
  saving: Record<string, boolean>;
  onSave: (key: string, value: string) => void;
}) {
  const LOG_LEVEL_OPTIONS = [
    { value: 'debug', label: 'debug' },
    { value: 'info', label: 'info' },
    { value: 'warn', label: 'warn' },
    { value: 'error', label: 'error' },
  ];

  const currentProvider = settings['ai_provider'] ?? 'anthropic';
  const modelSuggestions = PROVIDER_MODEL_SUGGESTIONS[currentProvider] ?? [];

  const [maxTokens, setMaxTokens] = useState(settings['ai_max_tokens'] ?? '4096');
  const [modelInput, setModelInput] = useState(settings['ai_model'] ?? 'claude-haiku-4-5-20251001');
  const [baseUrlInput, setBaseUrlInput] = useState(settings['ai_base_url'] ?? '');

  useEffect(() => {
    setMaxTokens(settings['ai_max_tokens'] ?? '4096');
    setModelInput(settings['ai_model'] ?? 'claude-haiku-4-5-20251001');
    setBaseUrlInput(settings['ai_base_url'] ?? '');
  }, [settings]);

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Changes take effect on the next message — no restart required.
      </p>

      <SettingRow
        label="Provider"
        description="AI backend to use. Ollama, Groq, and OpenRouter all have free options."
      >
        <div className="flex items-center gap-2">
          <SelectInput
            value={currentProvider}
            options={PROVIDER_OPTIONS}
            onChange={(v) => onSave('ai_provider', v)}
          />
          {saving['ai_provider'] && (
            <span className="text-xs text-sharp-ai animate-pulse">saving…</span>
          )}
        </div>
      </SettingRow>

      <SettingRow
        label="Model"
        description="Model ID for the selected provider. Type any valid model ID or pick a suggestion below."
      >
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              placeholder="e.g. llama3.2"
              className="
                w-52 bg-sharp-bg border border-sharp-border rounded px-2 py-1
                text-xs font-mono text-sharp-text
                focus:outline-none focus:border-sharp-accent
              "
            />
            <button
              type="button"
              onClick={() => onSave('ai_model', modelInput)}
              disabled={saving['ai_model']}
              className="text-xs px-2 py-1 bg-sharp-accent hover:bg-purple-700 text-white rounded
                transition-colors disabled:opacity-40"
            >
              {saving['ai_model'] ? '…' : 'Save'}
            </button>
          </div>
          {modelSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-end max-w-xs">
              {modelSuggestions.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => {
                    setModelInput(s.value);
                    onSave('ai_model', s.value);
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-sharp-border
                    text-gray-400 hover:text-sharp-text hover:border-sharp-accent
                    transition-colors font-mono truncate max-w-[160px]"
                  title={s.label}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </SettingRow>

      <SettingRow
        label="Base URL"
        description="Optional endpoint override. Required for Ollama (http://localhost:11434/v1). Leave blank to use the provider default."
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={baseUrlInput}
            onChange={(e) => setBaseUrlInput(e.target.value)}
            placeholder="http://localhost:11434/v1"
            className="
              w-52 bg-sharp-bg border border-sharp-border rounded px-2 py-1
              text-xs font-mono text-sharp-text
              focus:outline-none focus:border-sharp-accent
            "
          />
          <button
            type="button"
            onClick={() => onSave('ai_base_url', baseUrlInput)}
            disabled={saving['ai_base_url']}
            className="text-xs px-2 py-1 bg-sharp-accent hover:bg-purple-700 text-white rounded
              transition-colors disabled:opacity-40"
          >
            {saving['ai_base_url'] ? '…' : 'Save'}
          </button>
        </div>
      </SettingRow>

      <SettingRow
        label="Max tokens"
        description="Maximum tokens the AI may generate per response (256–8192)."
      >
        <div className="flex items-center gap-2">
          <TextInput
            type="number"
            min="256"
            max="8192"
            step="256"
            value={maxTokens}
            onChange={setMaxTokens}
          />
          <button
            type="button"
            onClick={() => onSave('ai_max_tokens', maxTokens)}
            disabled={saving['ai_max_tokens']}
            className="text-xs px-2 py-1 bg-sharp-accent hover:bg-purple-700 text-white rounded
              transition-colors disabled:opacity-40"
          >
            {saving['ai_max_tokens'] ? '…' : 'Save'}
          </button>
        </div>
      </SettingRow>

      <SettingRow
        label="Log level"
        description="Backend logging verbosity. Requires backend restart to take full effect."
      >
        <div className="flex items-center gap-2">
          <SelectInput
            value={settings['log_level'] ?? 'info'}
            options={LOG_LEVEL_OPTIONS}
            onChange={(v) => onSave('log_level', v)}
          />
          {saving['log_level'] && (
            <span className="text-xs text-sharp-ai animate-pulse">saving…</span>
          )}
        </div>
      </SettingRow>
    </div>
  );
}

function MemoryTab({
  settings,
  saving,
  onSave,
}: {
  settings: Record<string, string>;
  saving: Record<string, boolean>;
  onSave: (key: string, value: string) => void;
}) {
  const [threshold, setThreshold] = useState(settings['memory_promotion_threshold'] ?? '5.0');
  const [ttlHours, setTtlHours] = useState(settings['working_memory_ttl_hours'] ?? '48');
  const [dfMemory, setDfMemory] = useState(settings['dragonfly_max_memory'] ?? '512mb');

  useEffect(() => {
    setThreshold(settings['memory_promotion_threshold'] ?? '5.0');
    setTtlHours(settings['working_memory_ttl_hours'] ?? '48');
    setDfMemory(settings['dragonfly_max_memory'] ?? '512mb');
  }, [settings]);

  const ttlDisplay = settings['working_memory_ttl_hours'] ?? '48';
  const t2Start = parseInt(ttlDisplay, 10);
  const t3Start = t2Start * 2;
  const ltmStart = Math.round(t3Start * 1.5);

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Memory architecture: Dragonfly (0–{ttlDisplay} h) → PostgreSQL short-term ({ttlDisplay}–{t2Start * 2} h) → archive ({t3Start}–{ltmStart} h) → long-term (permanent).
      </p>

      <SettingRow
        label="Promotion threshold"
        description="Importance score (0.0–10.0) a message must reach to be promoted to long-term memory."
      >
        <div className="flex items-center gap-2">
          <TextInput
            type="number"
            min="0"
            max="10"
            step="0.5"
            value={threshold}
            onChange={setThreshold}
          />
          <button
            type="button"
            onClick={() => onSave('memory_promotion_threshold', threshold)}
            disabled={saving['memory_promotion_threshold']}
            className="text-xs px-2 py-1 bg-sharp-accent hover:bg-purple-700 text-white rounded
              transition-colors disabled:opacity-40"
          >
            {saving['memory_promotion_threshold'] ? '…' : 'Save'}
          </button>
        </div>
      </SettingRow>

      <SettingRow
        label="Working memory TTL (hours)"
        description="How long Dragonfly keeps Tier-1 conversation data before expiry."
      >
        <div className="flex items-center gap-2">
          <TextInput
            type="number"
            min="1"
            max="168"
            step="1"
            value={ttlHours}
            onChange={setTtlHours}
          />
          <button
            type="button"
            onClick={() => onSave('working_memory_ttl_hours', ttlHours)}
            disabled={saving['working_memory_ttl_hours']}
            className="text-xs px-2 py-1 bg-sharp-accent hover:bg-purple-700 text-white rounded
              transition-colors disabled:opacity-40"
          >
            {saving['working_memory_ttl_hours'] ? '…' : 'Save'}
          </button>
        </div>
      </SettingRow>

      <SettingRow
        label="Dragonfly max memory"
        description="Soft memory ceiling for the Dragonfly cache container (e.g. 256mb, 1gb). Requires container restart."
      >
        <div className="flex items-center gap-2">
          <TextInput value={dfMemory} onChange={setDfMemory} />
          <button
            type="button"
            onClick={() => onSave('dragonfly_max_memory', dfMemory)}
            disabled={saving['dragonfly_max_memory']}
            className="text-xs px-2 py-1 bg-sharp-accent hover:bg-purple-700 text-white rounded
              transition-colors disabled:opacity-40"
          >
            {saving['dragonfly_max_memory'] ? '…' : 'Save'}
          </button>
        </div>
      </SettingRow>
    </div>
  );
}

function SessionTab({
  settings,
  saving,
  onSave,
}: {
  settings: Record<string, string>;
  saving: Record<string, boolean>;
  onSave: (key: string, value: string) => void;
}) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loadingRec, setLoadingRec] = useState(false);
  const [replayRec, setReplayRec] = useState<RecordingDetail | null>(null);
  const [timeoutMin, setTimeoutMin] = useState(settings['session_timeout_minutes'] ?? '30');
  const [maxHistory, setMaxHistory] = useState(settings['max_conversation_history'] ?? '100');

  useEffect(() => {
    setTimeoutMin(settings['session_timeout_minutes'] ?? '30');
    setMaxHistory(settings['max_conversation_history'] ?? '100');
  }, [settings]);

  const fetchRecordings = useCallback(async () => {
    setLoadingRec(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/recordings`);
      const data = (await res.json()) as Recording[];
      setRecordings(Array.isArray(data) ? data : []);
    } catch {
      setRecordings([]);
    } finally {
      setLoadingRec(false);
    }
  }, []);

  useEffect(() => {
    void fetchRecordings();
  }, [fetchRecordings]);

  const openRecording = async (id: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/recordings/${id}`);
      const data = (await res.json()) as RecordingDetail;
      setReplayRec(data);
    } catch {
      /* ignore */
    }
  };

  const deleteRecording = async (id: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/recordings/${id}`, { method: 'DELETE' });
      setRecordings((r) => r.filter((rec) => rec.id !== id));
    } catch {
      /* ignore */
    }
  };

  const recordingEnabled = settings['session_recording_enabled'] === 'true';

  return (
    <div>
      {replayRec ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-sharp-text font-mono">
              {replayRec.title}
            </span>
            <button
              type="button"
              onClick={() => setReplayRec(null)}
              className="text-xs text-gray-500 hover:text-sharp-text transition-colors"
            >
              ← Back
            </button>
          </div>
          <div className="flex-1 overflow-y-auto max-h-72 border border-sharp-border rounded p-2 space-y-2">
            {replayRec.messages.map((m, i) => (
              <div
                key={i}
                className={`text-xs font-mono whitespace-pre-wrap break-words p-2 rounded ${
                  m.role === 'user'
                    ? 'bg-sharp-user/10 border border-sharp-user/20 text-sharp-text'
                    : 'bg-sharp-ai/10 border border-sharp-ai/20 text-sharp-text'
                }`}
              >
                <span
                  className={`block text-[10px] font-semibold mb-1 ${
                    m.role === 'user' ? 'text-sharp-user' : 'text-sharp-ai'
                  }`}
                >
                  {m.role === 'user' ? 'You' : '◈ AI'}
                </span>
                {m.content}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <SettingRow
            label="Session recording"
            description="Record full conversation transcripts when sessions end. Stored in PostgreSQL."
          >
            <Toggle
              value={recordingEnabled}
              disabled={saving['session_recording_enabled']}
              onChange={(v) => onSave('session_recording_enabled', v ? 'true' : 'false')}
            />
          </SettingRow>

          <SettingRow
            label="Session timeout (minutes)"
            description="Minutes of inactivity before a session is automatically disconnected."
          >
            <div className="flex items-center gap-2">
              <TextInput
                type="number"
                min="5"
                max="480"
                step="5"
                value={timeoutMin}
                onChange={setTimeoutMin}
              />
              <button
                type="button"
                onClick={() => onSave('session_timeout_minutes', timeoutMin)}
                disabled={saving['session_timeout_minutes']}
                className="text-xs px-2 py-1 bg-sharp-accent hover:bg-purple-700 text-white rounded
                  transition-colors disabled:opacity-40"
              >
                {saving['session_timeout_minutes'] ? '…' : 'Save'}
              </button>
            </div>
          </SettingRow>

          <SettingRow
            label="Max conversation history"
            description="Maximum message turns kept in memory per session. Older messages are still in Dragonfly/DB."
          >
            <div className="flex items-center gap-2">
              <TextInput
                type="number"
                min="10"
                max="500"
                step="10"
                value={maxHistory}
                onChange={setMaxHistory}
              />
              <button
                type="button"
                onClick={() => onSave('max_conversation_history', maxHistory)}
                disabled={saving['max_conversation_history']}
                className="text-xs px-2 py-1 bg-sharp-accent hover:bg-purple-700 text-white rounded
                  transition-colors disabled:opacity-40"
              >
                {saving['max_conversation_history'] ? '…' : 'Save'}
              </button>
            </div>
          </SettingRow>

          {/* Recordings list */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-400 font-mono uppercase tracking-wide">
                Recorded Sessions
              </span>
              <button
                type="button"
                onClick={() => void fetchRecordings()}
                className="text-xs text-gray-500 hover:text-sharp-text transition-colors"
              >
                Refresh
              </button>
            </div>

            {loadingRec ? (
              <p className="text-xs text-gray-500 animate-pulse">Loading…</p>
            ) : recordings.length === 0 ? (
              <p className="text-xs text-gray-600">
                {recordingEnabled
                  ? 'No recordings yet — sessions will be saved when they end.'
                  : 'Enable session recording above to start capturing sessions.'}
              </p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {recordings.map((rec) => (
                  <div
                    key={rec.id}
                    className="flex items-center justify-between gap-2 px-3 py-2
                      bg-sharp-surface border border-sharp-border rounded hover:border-sharp-accent
                      transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-mono text-sharp-text truncate">{rec.title}</div>
                      <div className="text-[10px] text-gray-600 mt-0.5">
                        {rec.message_count} messages · {Math.round(rec.duration_seconds / 60)} min ·{' '}
                        {new Date(rec.started_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void openRecording(rec.id)}
                        className="text-xs text-sharp-ai hover:underline"
                      >
                        Rewind
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteRecording(rec.id)}
                        className="text-xs text-gray-600 hover:text-sharp-error transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ResourcesTab() {
  const [metrics, setMetrics] = useState<ResourceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/health/resources`);
      const data = (await res.json()) as ResourceMetrics;
      setMetrics(data);
    } catch {
      setError('Unable to fetch resource metrics from backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMetrics();
    const id = setInterval(() => void fetchMetrics(), 15_000);
    return () => clearInterval(id);
  }, [fetchMetrics]);

  if (loading && !metrics) {
    return <p className="text-xs text-gray-500 animate-pulse mt-2">Loading metrics…</p>;
  }

  if (error) {
    return <p className="text-xs text-sharp-error mt-2">{error}</p>;
  }

  if (!metrics) return null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Backend server metrics — refreshes every 15 s.
        Disk usage reflects the <code className="text-gray-400">/workspace</code> mount.
      </p>

      {/* Memory */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-gray-400">RAM</span>
          <span className="text-sharp-text">
            {fmtBytes(metrics.memory.used)} / {fmtBytes(metrics.memory.total)} ({metrics.memory.usedPct}%)
          </span>
        </div>
        <UsageBar pct={metrics.memory.usedPct} color="bg-sharp-ai" />
        <div className="text-[10px] text-gray-600">
          Free: {fmtBytes(metrics.memory.free)}
        </div>
      </div>

      {/* Disk */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-gray-400">Disk ({metrics.disk.path})</span>
          <span className="text-sharp-text">
            {metrics.disk.total > 0
              ? `${fmtBytes(metrics.disk.used)} / ${fmtBytes(metrics.disk.total)} (${metrics.disk.usedPct}%)`
              : 'N/A'}
          </span>
        </div>
        {metrics.disk.total > 0 && <UsageBar pct={metrics.disk.usedPct} />}
        {metrics.disk.total > 0 && (
          <div className="text-[10px] text-gray-600">
            Available: {fmtBytes(metrics.disk.available)}
          </div>
        )}
      </div>

      {/* Info rows */}
      <div className="space-y-1 pt-2 border-t border-sharp-border">
        {[
          { label: 'Uptime', value: fmtUptime(metrics.uptime) },
          { label: 'Node.js', value: metrics.nodeVersion },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between text-xs font-mono">
            <span className="text-gray-500">{label}</span>
            <span className="text-sharp-text">{value}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void fetchMetrics()}
        className="text-xs text-gray-500 hover:text-sharp-text transition-colors"
      >
        ↻ Refresh now
      </button>
    </div>
  );
}

// ─── Main SettingsPanel ───────────────────────────────────────────────────────

interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('ai');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [loadError, setLoadError] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);

  const fetchSettings = useCallback(async () => {
    setLoadError('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings`);
      const rows = (await res.json()) as AppSetting[];
      if (!Array.isArray(rows)) {
        setLoadError('Unexpected response from settings API.');
        return;
      }
      const map: Record<string, string> = {};
      for (const r of rows) {
        map[r.key] = r.value;
      }
      setSettings(map);
    } catch {
      setLoadError('Could not reach backend. Settings shown may reflect env-var defaults.');
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = async (key: string, value: string) => {
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Save failed');
      }
      setSettings((prev) => ({ ...prev, [key]: value }));
    } catch (err) {
      alert(`Failed to save ${key}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'ai', label: 'AI & Model' },
    { id: 'memory', label: 'Memory' },
    { id: 'session', label: 'Session' },
    { id: 'resources', label: 'Resources' },
  ];

  return (
    /* Overlay */
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      {/* Panel */}
      <div className="flex flex-col w-full max-w-xl max-h-[85vh] bg-sharp-surface border border-sharp-border rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-sharp-border bg-sharp-bg shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sharp-accent text-base">⚙</span>
            <span className="text-sm font-semibold text-sharp-text font-mono">Settings</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-sharp-text transition-colors text-lg leading-none"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-sharp-border shrink-0 bg-sharp-bg">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-xs font-mono transition-colors whitespace-nowrap
                ${activeTab === tab.id
                  ? 'border-b-2 border-sharp-accent text-sharp-accent'
                  : 'text-gray-500 hover:text-sharp-text'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loadError && (
            <div className="mb-3 px-3 py-2 bg-sharp-warning/10 border border-sharp-warning/30 rounded text-xs text-sharp-warning">
              {loadError}
            </div>
          )}

          {activeTab === 'ai' && (
            <AITab settings={settings} saving={saving} onSave={(k, v) => void handleSave(k, v)} />
          )}
          {activeTab === 'memory' && (
            <MemoryTab settings={settings} saving={saving} onSave={(k, v) => void handleSave(k, v)} />
          )}
          {activeTab === 'session' && (
            <SessionTab settings={settings} saving={saving} onSave={(k, v) => void handleSave(k, v)} />
          )}
          {activeTab === 'resources' && <ResourcesTab />}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-sharp-border bg-sharp-bg shrink-0 text-xs text-gray-600 font-mono">
          Changes persist in the database and take effect immediately (AI settings) or on next
          container restart (infrastructure settings).
        </div>
      </div>
    </div>
  );
}
