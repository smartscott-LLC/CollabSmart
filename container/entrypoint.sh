#!/usr/bin/env bash
set -e

USER=${USER:-user}
AI_USER=${AI_USER:-ai-agent}
VNC_PORT=${VNC_PORT:-5901}
NOVNC_PORT=${NOVNC_PORT:-6080}
VNC_PASSWORD=${VNC_PASSWORD:-collabsmart_vnc}

echo "[entrypoint] Starting CollabSmart container..."

# Set VNC password from environment variable
mkdir -p /home/${USER}/.vnc
printf '%s' "${VNC_PASSWORD}" | vncpasswd -f > /home/${USER}/.vnc/passwd
chmod 600 /home/${USER}/.vnc/passwd
chown "${USER}:${USER}" /home/${USER}/.vnc/passwd
echo "[entrypoint] VNC password configured"

# Start VNC server as the main user
su -c "vncserver :1 -geometry 1280x800 -depth 24 -localhost no" ${USER}

echo "[entrypoint] VNC server started on :${VNC_PORT}"

# Start noVNC websockify proxy
websockify --web=/usr/share/novnc/ --wrap-mode=ignore \
    0.0.0.0:${NOVNC_PORT} localhost:${VNC_PORT} &

echo "[entrypoint] noVNC proxy started on port ${NOVNC_PORT}"

# Start inotify watcher for workspace changes - output to log
inotifywait -m -r --format '%T %e %w%f' --timefmt '%H:%M:%S' \
    /workspace 2>/dev/null | while read line; do
    echo "[fs-watch] ${line}"
done &

echo "[entrypoint] File system watcher started"

# Keep container alive - tail logs to stdout
tail -f /dev/null
