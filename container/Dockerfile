FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:1
ENV VNC_PORT=5901
ENV NOVNC_PORT=6080
ENV USER=user
ENV AI_USER=ai-agent

# Install base packages
RUN apt-get update && apt-get install -y \
    # Desktop environment
    xfce4 xfce4-terminal \
    # VNC server
    tigervnc-standalone-server tigervnc-common \
    # noVNC dependencies
    novnc websockify python3 python3-pip \
    # Dev tools
    git curl wget build-essential \
    nodejs npm \
    python3-dev \
    # Monitoring tools
    inotify-tools procps htop \
    # Utilities
    sudo bash vim nano \
    # Browser for web-based dev
    chromium-browser \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create dual-user setup
COPY user-setup.sh /user-setup.sh
RUN chmod +x /user-setup.sh && /user-setup.sh

# Configure VNC
RUN mkdir -p /home/${USER}/.vnc && \
    echo "password" | vncpasswd -f > /home/${USER}/.vnc/passwd && \
    chmod 600 /home/${USER}/.vnc/passwd && \
    chown -R ${USER}:${USER} /home/${USER}/.vnc

# VNC xstartup
COPY configs/xstartup /home/${USER}/.vnc/xstartup
RUN chmod +x /home/${USER}/.vnc/xstartup && \
    chown ${USER}:${USER} /home/${USER}/.vnc/xstartup

# Workspace setup
RUN mkdir -p /workspace && \
    chown -R ${USER}:${USER} /workspace && \
    chmod 775 /workspace && \
    # Give ai-agent read/write to workspace
    chown -R ${USER}:${AI_USER} /workspace

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE ${VNC_PORT} ${NOVNC_PORT}

ENTRYPOINT ["/entrypoint.sh"]
