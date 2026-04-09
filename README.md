<div align="center">

# 🤝 CollabSmart

**A real-time AI pair-programming environment where humans and Claude work side-by-side in a shared containerized Linux desktop.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![Claude](https://img.shields.io/badge/Claude-Haiku%204.5-orange?logo=anthropic)](https://www.anthropic.com/)
[![Docker](https://img.shields.io/badge/Docker-Compose-blue?logo=docker)](https://docs.docker.com/compose/)

</div>

---

## ✨ What is CollabSmart?

CollabSmart creates a **shared containerized workspace** where you and an AI agent (powered by Claude) collaborate in real-time. You interact through a browser-based chat interface and can watch a live XFCE4 desktop — while the AI reads/writes files and runs shell commands in the same shared environment.

- 🖥️ **Live shared desktop** — Watch the AI work alongside you via an in-browser noVNC view
- 💬 **Streaming AI chat** — Real-time token-by-token responses from Claude
- 🧠 **Tiered memory system** — The AI remembers context across sessions using Dragonfly + PostgreSQL
- 🛠️ **AI tool use** — Claude can run bash commands, read/write files, tail logs, and monitor processes
- 🎯 **Adaptive collaboration modes** — AI dynamically shifts between pair-programming, teaching, debugging, and more

---

## 🏗️ Architecture

```
┌────────────────────┐    WebSocket/REST    ┌─────────────────────┐
│  frontend          │ ──────────────────→  │  backend            │
│  Next.js 16        │                      │  Express + Socket.IO│
│  React 18          │                      │  TypeScript         │
│  Tailwind CSS      │                      │  Claude API         │
│  port :3000        │                      │  port :3001         │
└────────────────────┘                      └──────────┬──────────┘
                                                        │ shared /workspace volume
┌─────────────────┐   ┌──────────────────┐             │
│  PostgreSQL 16  │   │  Dragonfly Cache  │             │
│  Long/short-    │   │  (Redis-compat)   │             │
│  term memory    │   │  Working memory   │             │
│  port :5432     │   │  port :6379       │             │
└─────────────────┘   └──────────────────┘             │
                                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  desktop container (Ubuntu 22.04)                                   │
│  XFCE4 + TigerVNC + noVNC                                           │
│  Users: `user` (human) + `ai-agent` (AI)                           │
│  VNC :5901  |  noVNC :6080                                          │
└─────────────────────────────────────────────────────────────────────┘
```

All five services share a Docker named volume `workspace` mounted at `/workspace`.

---

## 📋 Prerequisites

- [Docker](https://docs.docker.com/get-docker/) ≥ 24
- [Docker Compose](https://docs.docker.com/compose/) ≥ 2 (or `docker compose` plugin)
- An [Anthropic API key](https://console.anthropic.com/)

---

## 🚀 Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/smartscott-LLC/CollabSmart.git
cd CollabSmart

# 2. Run the start script — it creates .env on first run
./start.sh

# 3. Edit .env and add your Anthropic API key
nano .env   # set ANTHROPIC_API_KEY=sk-ant-...

# 4. Start the full stack
./start.sh
```

Once running, open your browser:

| Service        | URL                           |
|----------------|-------------------------------|
| **Chat UI**    | http://localhost:3000         |
| **Desktop**    | http://localhost:6080         |
| **Backend API**| http://localhost:3001/health  |

```bash
# View live logs from all services
docker compose logs -f

# Stop everything
docker compose down
```

---

## 🗂️ Repository Layout

```
CollabSmart/
├── .env.example              # Template — copy to .env and fill in values
├── docker-compose.yml        # Orchestrates all 5 services
├── start.sh                  # One-shot startup script
│
├── backend/                  # Node.js / TypeScript AI orchestration server
│   ├── src/
│   │   ├── index.ts          # Express + Socket.IO entry point (port 3001)
│   │   ├── api/anthropic.ts  # Claude Haiku 4.5 integration + tool-use loop
│   │   ├── db/               # PostgreSQL pool + schema initialisation
│   │   ├── memory/           # 4-tier memory system (see below)
│   │   ├── orchestrator/     # WebSocket session manager + broadcastLog()
│   │   ├── tools/index.ts    # Tool implementations + TOOL_DEFINITIONS
│   │   ├── scripts/          # CLI scripts (O*NET data ingestion)
│   │   └── logger/index.ts   # Winston logger
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                 # Next.js 16 App Router UI
│   ├── src/
│   │   ├── app/              # App Router (page.tsx, layout.tsx)
│   │   ├── components/
│   │   │   ├── CommandCenter.tsx      # Root layout: 3 resizable panes
│   │   │   ├── ChatPane/index.tsx     # Chat UI with message bubbles
│   │   │   ├── DesktopFrame/index.tsx # noVNC iframe wrapper
│   │   │   └── LogSidebar/index.tsx   # Live activity log stream
│   │   ├── hooks/useSocket.ts         # Zustand store + socket.io-client
│   │   └── utils/formatters.ts        # Log colour / actor-badge helpers
│   ├── Dockerfile
│   ├── tailwind.config.js    # Custom `sharp` dark colour palette
│   └── package.json
│
├── container/                # Shared Linux desktop container
│   ├── Dockerfile            # Ubuntu 22.04 + XFCE4 + TigerVNC + noVNC
│   ├── entrypoint.sh
│   ├── user-setup.sh         # Creates `user` (human) + `ai-agent` Linux users
│   └── configs/xstartup      # VNC startup config
│
└── memory/                   # Python reference implementation of the memory system
    ├── memory_system/        # Core memory tier implementations
    ├── agent_factory/        # Agent scaffolding utilities
    ├── council/              # Multi-agent council logic
    ├── onet_integration/     # O*NET occupation data helpers
    └── ...
```

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and populate before starting:

```bash
cp .env.example .env
```

| Variable | Default | Required | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | — | ✅ | Claude API key |
| `FRONTEND_URL` | `http://localhost:3000` | | CORS allowed origin for the backend |
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:3001` | | Socket.IO + REST endpoint (frontend) |
| `NEXT_PUBLIC_NOVNC_URL` | `http://localhost:6080` | | noVNC iframe URL (frontend) |
| `WORKSPACE_PATH` | `/workspace` | | Filesystem root for all AI tool operations |
| `POSTGRES_HOST` | `postgres` | | PostgreSQL hostname |
| `POSTGRES_PORT` | `5432` | | PostgreSQL port |
| `POSTGRES_DB` | `collabsmart` | | Database name |
| `POSTGRES_USER` | `collabsmart` | | Database user |
| `POSTGRES_PASSWORD` | `change_me_in_production` | ✅ | Database password |
| `DRAGONFLY_HOST` | `dragonfly` | | Dragonfly/Redis hostname |
| `DRAGONFLY_PORT` | `6379` | | Dragonfly/Redis port |
| `ONET_API_BASE` | `https://services.onetcenter.org/ws` | | O*NET Web Services base URL |
| `ONET_USERNAME` | — | | O*NET username (optional) |
| `ONET_PASSWORD` | — | | O*NET password (optional) |
| `MEMORY_PROMOTION_THRESHOLD` | `5.0` | | Importance score (0–10) to promote to long-term memory |
| `LOG_LEVEL` | `info` | | Winston log level (`debug`, `info`, `warn`, `error`) |
| `PORT` | `3001` | | Backend HTTP/WS listen port |

---

## 🧠 Memory System

CollabSmart uses a **four-tier memory architecture** so the AI retains context across sessions and adapts to your working style over time.

```
Message arrives
      │
      ▼
┌─────────────────────────────────────────────────┐
│  Tier 1 — Working Memory                        │
│  Backend: Dragonfly (Redis-compatible)          │
│  Duration: 0–48 hours                           │
│  Content: All in-flight messages                │
└────────────────────┬────────────────────────────┘
                     │ aged out at 48h
                     ▼
┌─────────────────────────────────────────────────┐
│  Tier 2 — Short-Term Memory                     │
│  Backend: PostgreSQL (short_term_memory table)  │
│  Duration: 48–96 hours                          │
│  Content: Importance-scored messages            │
└────────────────────┬────────────────────────────┘
                     │ aged out at 96h
                     ▼
┌─────────────────────────────────────────────────┐
│  Tier 3 — Recent Archive                        │
│  Backend: PostgreSQL (recent_archive table)     │
│  Duration: 96–144 hours                         │
│  Content: Final staging before LTM or deletion  │
└────────────────────┬────────────────────────────┘
                     │ importance_score >= 5.0
                     ▼
┌─────────────────────────────────────────────────┐
│  Long-Term Memory (LTM)                         │
│  Backend: PostgreSQL (long_term_memory table)   │
│  Duration: Permanent                            │
│  Content: Compressed semantic memories          │
└─────────────────────────────────────────────────┘
```

Maintenance runs automatically every **6 hours** to age messages between tiers and promote high-value memories to LTM.

### Supporting Subsystems

| Module | Description |
|---|---|
| `ContextAnalyzer` | Detects scenario type, urgency, emotion, languages, and tools from each message |
| `PersonalityLearning` | Tracks communication style, preferred languages, and collaboration preferences per user |
| `ModeSelector` | Picks the best collaboration mode per interaction |
| `OnetIntegration` | Enriches context with O*NET occupation and technology data |

### Collaboration Modes

| Mode | When Used |
|---|---|
| `collaborative` | Active pair-programming — building things together |
| `exploratory` | Brainstorming, architecture discussions |
| `structured` | Step-by-step debugging or systematic analysis |
| `quick_assist` | Fast answers with minimal back-and-forth |
| `teacher` | Patient explanations and learning-focused sessions |

---

## 🤖 AI Tool System

Claude operates in an agentic tool-use loop and has five built-in tools:

| Tool | Input | Description |
|---|---|---|
| `bash` | `{ command: string }` | Run a shell command in `/workspace` (30 s timeout) |
| `file_write` | `{ path, content }` | Write a file at a relative path within the workspace |
| `file_read` | `{ path }` | Read a file from the workspace |
| `process_monitor` | — | List running processes (`ps aux`) |
| `log_tail` | `{ path, lines? }` | Tail a log file (default 50 lines) |

> **Security:** All file paths are resolved against `WORKSPACE_PATH`. Path-traversal attempts (`../`, absolute paths) are blocked before touching the filesystem.

---

## 🔌 WebSocket Protocol (Socket.IO)

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `chat:message` | `{ sessionId, message, userId? }` | Send a message to Claude |
| `ping` | — | Keepalive; updates session `lastActivity` |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `session:init` | `{ sessionId }` | Assigned on connect |
| `chat:start` | `{ sessionId }` | Claude has started processing |
| `chat:typing` | `{ text }` | Streaming partial response text |
| `chat:response` | `{ sessionId, message }` | Final AI response |
| `chat:error` | `{ error }` | Processing error |
| `tool:start` | `{ name, input }` | Claude invoked a tool |
| `tool:result` | `{ name, success, output }` | Tool execution result |
| `log:entry` | `LogEntry` | Real-time log broadcast to all sessions |
| `pong` | `{ timestamp }` | Response to `ping` |

### REST Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{ status: "ok", timestamp }` |
| `DELETE` | `/api/conversation/:sessionId` | Clears in-memory history and all memory tiers for a session |

---

## 🖥️ Frontend

The UI is a dark-themed, three-pane layout built with Next.js 16 App Router and Tailwind CSS.

### Pane Layout

```
┌──────────────┬──────────────────────┬────────────────┐
│              │                      │                │
│  Chat Pane   │   Desktop (noVNC)    │  Log Sidebar   │
│  (25%)       │   (45%)              │  (30%)         │
│              │                      │                │
│  Message     │   Live shared        │  Real-time     │
│  bubbles +   │   XFCE4 desktop      │  activity log  │
│  input box   │   iframe             │  stream        │
│              │                      │                │
└──────────────┴──────────────────────┴────────────────┘
         ↕ drag handles resize panes ↕
```

### Design System

| Token | Value | Usage |
|---|---|---|
| `sharp-bg` | `#0a0a0f` | Page background |
| `sharp-surface` | `#12121a` | Card / panel background |
| `sharp-border` | `#1e1e2e` | Borders |
| `sharp-accent` | `#7c3aed` | Primary purple accent |
| `sharp-ai` | `#06b6d4` | AI actor badges & highlights |
| `sharp-user` | `#8b5cf6` | User actor badges |

Font: **JetBrains Mono** throughout.

State management: **Zustand** (`useSocketStore` in `hooks/useSocket.ts`).

---

## 🛠️ Development Setup

### Backend (standalone)

```bash
cd backend
npm install
npm run dev          # ts-node-dev with hot reload
npm run build        # tsc → dist/
npm start            # node dist/index.js
npm test             # jest (passWithNoTests)
```

### Frontend (standalone)

```bash
cd frontend
npm install
npm run dev          # next dev
npm run build        # next build
npm run lint         # ESLint via next lint
npm test             # jest (passWithNoTests)
```

### O*NET Data Ingestion (optional)

Populate the O*NET occupation database to enable occupation-aware AI context:

```bash
# Set ONET_USERNAME and ONET_PASSWORD in .env first
cd backend
npm run ingest:onet
```

Register for free O*NET Web Services credentials at https://services.onetcenter.org/

---

## 🐛 Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Backend won't start | `ANTHROPIC_API_KEY` not set | Copy `.env.example` → `.env` and add your key |
| Frontend can't connect | `NEXT_PUBLIC_BACKEND_URL` mismatch | Ensure the var matches the running backend URL |
| Desktop iframe blank | noVNC container not ready | Wait for `desktop` healthcheck; check `docker compose logs desktop` |
| `Path traversal attempt blocked` | Tool called with absolute or `../` path | Use relative paths inside `/workspace` |
| SSR error on socket/xterm import | Next.js hydration | Import affected components with `dynamic(..., { ssr: false })` |
| Memory degraded | PostgreSQL / Dragonfly not reachable | Check `docker compose logs postgres dragonfly`; system falls back to working-memory only |

---

## 📐 Where to Make Changes

| Goal | File(s) to edit |
|---|---|
| Add a new AI tool | `backend/src/tools/index.ts` — add function, add to `TOOL_DEFINITIONS`, add `case` in `dispatchTool()` |
| Change AI model or system prompt | `backend/src/api/anthropic.ts` |
| Add a WebSocket event | `backend/src/index.ts` (emit/on) + `frontend/src/hooks/useSocket.ts` (listener) |
| Add a REST endpoint | `backend/src/index.ts` |
| Add a new UI component | `frontend/src/components/` — new folder with `index.tsx` |
| Change the colour theme | `frontend/tailwind.config.js` (`sharp` palette) |
| Change desktop container packages | `container/Dockerfile` |
| Change workspace user permissions | `container/user-setup.sh` |
| Modify DB schema | `backend/db/schema.sql` (runs on next startup) |

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
