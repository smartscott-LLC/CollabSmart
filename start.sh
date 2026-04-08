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
  echo "[setup] Please edit .env and set your ANTHROPIC_API_KEY, then re-run this script."
  exit 0
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
echo ""
echo "  Logs:  docker compose logs -f"
echo "  Stop:  docker compose down"
echo ""
