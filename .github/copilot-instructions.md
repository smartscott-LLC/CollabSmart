# CollabSmart — Copilot Cloud Agent Instructions

## Project Overview

CollabSmart is a **real-time collaborative AI pair-programming environment**. It creates a shared containerized Linux desktop where a human user and an AI agent (Claude) work side-by-side. The human interacts through a browser-based chat and can see a live view of a shared XFCE4 desktop. The AI can read/write files and run shell commands in that shared workspace.

---

## Architecture: Three Docker Services

```
┌────────────────────┐    WebSocket/REST    ┌─────────────────────┐
│  frontend          │ ──────────────────→  │  backend            │
│  Next.js 14        │                      │  Express + Socket.IO│
│  React 18          │                      │  TypeScript         │
│  Tailwind CSS      │                      │  Claude API         │
│  port :3000        │                      │  port :3001         │
└────────────────────┘                      └──────────┬──────────┘
                                                        │ shared /workspace volume
┌────────────────────────────────────────────────────── ▼ ───────────┐
│  desktop container (Ubuntu 22.04)                                   │
│  XFCE4 + TigerVNC + noVNC                                           │
│  Users: `user` (human) + `ai-agent` (AI)                           │
│  VNC :5901  |  noVNC :6080                                          │
└─────────────────────────────────────────────────────────────────────┘
```

All three services share a Docker named volume `workspace` mounted at `/workspace`.

---

## Repository Layout

```
CollabSmart/
├── .env.example              # Copy to .env; set ANTHROPIC_API_KEY
├── docker-compose.yml        # Orchestrates all 3 services
├── start.sh                  # One-shot startup script (requires Docker)
├── backend/                  # Node.js/TypeScript AI orchestration server
│   ├── src/
│   │   ├── index.ts          # Express + Socket.IO entry point (port 3001)
│   │   ├── api/anthropic.ts  # Claude 3.5 Sonnet integration + tool-use loop
│   │   ├── orchestrator/     # WebSocket session manager + broadcastLog()
│   │   ├── tools/index.ts    # Tool implementations + TOOL_DEFINITIONS
│   │   └── logger/index.ts   # Winston logger (LOG_LEVEL env var)
│   ├── package.json
│   └── tsconfig.json
├── frontend/                 # Next.js 14 App Router UI
│   ├── src/
│   │   ├── app/              # Next.js App Router (page.tsx, layout.tsx)
│   │   ├── components/
│   │   │   ├── CommandCenter.tsx     # Root layout: 3 resizable panes
│   │   │   ├── ChatPane/index.tsx    # Chat UI (message bubbles)
│   │   │   ├── DesktopFrame/index.tsx# noVNC iframe wrapper
│   │   │   └── LogSidebar/index.tsx  # Live activity log stream
│   │   ├── hooks/useSocket.ts        # Zustand store + socket.io-client
│   │   └── utils/formatters.ts       # Log color/actor-badge helpers
│   ├── tailwind.config.js    # Custom `sharp` color palette
│   └── package.json
└── container/                # Desktop container
    ├── Dockerfile            # Ubuntu 22.04 + XFCE4 + VNC + noVNC
    ├── entrypoint.sh
    ├── user-setup.sh         # Creates `user` and `ai-agent` Linux users
    └── configs/xstartup      # VNC startup config
```

---

## Build & Run Commands

### Full Stack (Docker required)

```bash
# First run: creates .env from template
./start.sh

# Edit .env to set ANTHROPIC_API_KEY, then re-run
./start.sh

# Services available at:
#   Frontend:  http://localhost:3000
#   Backend:   http://localhost:3001
#   Desktop:   http://localhost:6080

# View logs
docker compose logs -f

# Stop
docker compose down
```

### Backend (standalone development)

```bash
cd backend
npm install
npm run dev          # ts-node-dev with hot reload
npm run build        # tsc → dist/
npm start            # node dist/index.js
npm test             # jest (passWithNoTests; no tests yet)
```

### Frontend (standalone development)

```bash
cd frontend
npm install
npm run dev          # next dev
npm run build        # next build
npm run lint         # next lint (ESLint)
npm test             # jest (passWithNoTests; no tests yet)
```

---

## Environment Variables

| Variable | Default | Where Used | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | — | backend | **Required.** Claude API key |
| `FRONTEND_URL` | `http://localhost:3000` | backend | CORS allowed origin |
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:3001` | frontend | Socket.IO + REST endpoint |
| `NEXT_PUBLIC_NOVNC_URL` | `http://localhost:6080` | frontend | noVNC iframe URL |
| `WORKSPACE_PATH` | `/workspace` | backend | Filesystem root for tools |
| `LOG_LEVEL` | `info` | backend | Winston log level |
| `PORT` | `3001` | backend | HTTP/WS listen port |

Copy `.env.example` to `.env` and populate `ANTHROPIC_API_KEY` before starting.

---

## WebSocket Protocol (Socket.IO)

**Client → Server:**
| Event | Payload | Description |
|---|---|---|
| `chat:message` | `{ sessionId: string, message: string }` | Send chat to Claude |
| `ping` | — | Keepalive; updates `lastActivity` |

**Server → Client:**
| Event | Payload | Description |
|---|---|---|
| `session:init` | `{ sessionId: string }` | Assigned on connect |
| `chat:start` | `{ sessionId }` | Claude started processing |
| `chat:typing` | `{ text: string }` | Streaming partial text |
| `chat:response` | `{ sessionId, message: string }` | Final AI response |
| `chat:error` | `{ error: string }` | Processing error |
| `tool:start` | `{ name, input }` | Claude invoked a tool |
| `tool:result` | `{ name, success, output }` | Tool execution result |
| `log:entry` | `LogEntry` | Broadcast to all sessions |
| `pong` | `{ timestamp }` | Response to ping |

**REST:**
- `GET /health` → `{ status: "ok", timestamp }`
- `DELETE /api/conversation/:sessionId` → clears in-memory history

---

## AI Tool System (backend/src/tools/index.ts)

The AI runs in an agentic loop via `processChat()`. It has five tools:

| Tool | Input | Description |
|---|---|---|
| `bash` | `{ command: string }` | Run shell command in `WORKSPACE_PATH` (30s timeout) |
| `file_write` | `{ path, content }` | Write file at relative path within workspace |
| `file_read` | `{ path }` | Read file from workspace |
| `process_monitor` | — | `ps aux` in workspace |
| `log_tail` | `{ path, lines? }` | Tail a log file (default 50 lines) |

**Security**: All file paths are resolved against `WORKSPACE_PATH` and path-traversal attempts are blocked. Commands run with `cwd: WORKSPACE_PATH`.

**AI Model**: `claude-3-5-sonnet-20241022`, `max_tokens: 4096`.

---

## Frontend Design System

- **Theme**: Dark (`sharp` Tailwind palette defined in `tailwind.config.js`)
  - `sharp-bg` `#0a0a0f`, `sharp-surface` `#12121a`, `sharp-border` `#1e1e2e`
  - `sharp-accent` `#7c3aed` (purple), `sharp-ai` `#06b6d4` (cyan), `sharp-user` `#8b5cf6`
- **Font**: JetBrains Mono throughout (`font-mono` class)
- **UI layout**: Three resizable panes — Chat (left) | Desktop iframe (center) | Log sidebar (right)
- **State management**: Zustand (`useSocketStore` in `hooks/useSocket.ts`)
- **SSR**: `CommandCenter` is loaded with `dynamic(..., { ssr: false })` to avoid socket.io/xterm hydration issues

---

## Key Patterns & Conventions

- **TypeScript everywhere**: Both backend and frontend are strict TypeScript (no `any` in new code where avoidable).
- **Winston for logging**: Use `logger.info/error/warn` in backend; do not use `console.log`.
- **broadcastLog()**: Use this (in `orchestrator/index.ts`) to push structured `LogEntry` objects to all connected frontend sessions in real time.
- **Tool results emit Socket.IO events**: `tool:start` before execution, `tool:result` after — the frontend displays both.
- **Conversation history is in-memory**: `conversations` Map in `api/anthropic.ts`, keyed by `sessionId`. No persistence across backend restarts.
- **Session cleanup**: Sessions idle >30 minutes are automatically disconnected and removed.
- **Path safety**: Always validate tool file paths resolve inside `WORKSPACE_PATH` before touching the filesystem.
- **No tests yet**: `jest --passWithNoTests` — adding tests is encouraged but not required to build.

---

## Common Errors & Workarounds

| Error | Cause | Fix |
|---|---|---|
| `ANTHROPIC_API_KEY` not set | Missing .env | Copy `.env.example` to `.env` and fill in key |
| Frontend can't connect to backend | `NEXT_PUBLIC_BACKEND_URL` mismatch | Ensure env var matches running backend URL |
| Desktop iframe blank / "Connecting..." | noVNC container not ready | Wait for `desktop` healthcheck; check `docker compose logs desktop` |
| `Path traversal attempt blocked` | Tool called with absolute or `../` path | Use relative paths within `/workspace` for all tool operations |
| SSR error on socket/xterm imports | Next.js server-side rendering | Import affected components with `dynamic(..., { ssr: false })` |
| Backend TypeScript compile error | Missing `@types` package | Add correct `@types/*` devDependency in `backend/package.json` |

---

## Where to Make Changes

| Goal | File(s) to edit |
|---|---|
| Add a new AI tool | `backend/src/tools/index.ts` — add function, add to `TOOL_DEFINITIONS`, add `case` in `dispatchTool()` |
| Change AI model or system prompt | `backend/src/api/anthropic.ts` |
| Add a WebSocket event | `backend/src/index.ts` (emit/on) + `frontend/src/hooks/useSocket.ts` (listener) |
| Add a new REST endpoint | `backend/src/index.ts` |
| Add a new UI component | `frontend/src/components/` — new folder with `index.tsx` |
| Change color theme | `frontend/tailwind.config.js` (`sharp` palette) |
| Change desktop container packages | `container/Dockerfile` |
| Change workspace user permissions | `container/user-setup.sh` |
