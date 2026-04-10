#!/usr/bin/env bash
# CollabSmart - Quick start script
set -e

echo "============================================="
echo "  CollabSmart - Sovereign AI-OS Setup"
echo "============================================="

# Check for Docker
if ! command -v docker &>/dev/null; then
  echo "[ERROR] Docker is required. Install from https://docs.docker.com/get-docker/"
  exit 1
fi

if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null 2>&1; then
  echo "[ERROR] Docker Compose is required."
  exit 1
fi

# Check for .env file
if [ ! -f ".env" ]; then
  echo "[setup] Creating .env from .env.example..."
  cp .env.example .env
  echo ""
  echo "  ⚠  .env created with default passwords."
  echo "     Open .env and:"
  echo "       1. Set ANTHROPIC_API_KEY"
  echo "       2. Change POSTGRES_PASSWORD, DRAGONFLY_PASSWORD, and VNC_PASSWORD"
  echo "          to strong, unique values before running in production."
  echo ""
  echo "  ℹ  After changing POSTGRES_PASSWORD for the first time you MUST also"
  echo "     reset the postgres volume so the new password takes effect:"
  echo "       docker compose down -v"
  echo "     (This removes all stored memory data — only needed on first setup.)"
  echo ""
  echo "  Re-run ./start.sh once you have set ANTHROPIC_API_KEY."
  exit 0
fi

# Warn if ANTHROPIC_API_KEY is still the placeholder
if grep -q 'your_anthropic_api_key_here' .env 2>/dev/null; then
  echo "[ERROR] ANTHROPIC_API_KEY is not set in .env."
  echo "        Edit .env and replace 'your_anthropic_api_key_here' with your real key."
  exit 1
fi

echo "[setup] Building and starting services..."
docker compose up --build -d

echo ""
echo "============================================="
echo "  CollabSmart is starting!"
echo "============================================="
echo ""
echo "  Frontend:  http://localhost:3000"
echo "  Backend:   http://localhost:3001"
echo "  Desktop:   http://localhost:6080"
echo "             (VNC password: see VNC_PASSWORD in .env)"
echo ""
echo "  Settings panel: click the ⚙ gear icon in the top-right of the UI"
echo ""
echo "  Logs:  docker compose logs -f"
echo "  Stop:  docker compose down"
echo ""
echo "  ℹ  If postgres auth fails after a password change, reset the volume:"
echo "       docker compose down -v && ./start.sh"
echo ""
