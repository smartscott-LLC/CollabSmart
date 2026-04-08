#!/usr/bin/env bash
set -e

USER=${USER:-user}
AI_USER=${AI_USER:-ai-agent}

echo "[user-setup] Creating users..."

# Create main user
useradd -m -s /bin/bash -G sudo ${USER}
echo "${USER}:password" | chpasswd
echo "${USER} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Create AI agent user
useradd -m -s /bin/bash ${AI_USER}
echo "${AI_USER}:ai-password" | chpasswd

# Add ai-agent to user's group for workspace access
usermod -aG ${USER} ${AI_USER}

echo "[user-setup] Users created: ${USER} (sudo), ${AI_USER} (workspace)"
