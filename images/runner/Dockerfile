# Agent Desk runner image (control-plane spec §8, infra spec §5). Local/dev build:
#   podman build -t agentdesk-runner:dev images/runner
FROM node:22-slim

ARG CLAUDE_CODE_VERSION=2.1.323
# Pinned like Claude Code (security.md). The keyring checksum guards the apt repo's signing key.
ARG GH_VERSION=2.106.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends git tmux ca-certificates curl openssh-client \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "6084d5d7bd8e288441e0e94fc6275570895da18e6751f70f057485dc2d1a811b  /etc/apt/keyrings/githubcli-archive-keyring.gpg" | sha256sum -c - \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends "gh=${GH_VERSION}" \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force

# uid 10001 matches the Job's securityContext.
RUN groupadd -g 10001 runner \
 && useradd -u 10001 -g 10001 -m -d /home/runner -s /bin/bash runner \
 && mkdir -p /workspace /home/runner/.claude \
 && chown -R 10001:10001 /workspace /home/runner

COPY --chown=10001:10001 settings.json /home/runner/.claude/settings.json
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY select-plugins.mjs /usr/local/lib/agentdesk/select-plugins.mjs
# Rotating workspace token: git credential helper + `gh` wrapper (first on PATH) read $AGENTDESK_TOKEN_FILE per call.
COPY git-credential-agentdesk /usr/local/lib/agentdesk/git-credential-agentdesk
COPY bin/gh /usr/local/lib/agentdesk/bin/gh
# git hook: adds the bot as a Co-Authored-By trailer (the run's commits are authored by the person who triggered it).
COPY hooks/prepare-commit-msg /usr/local/lib/agentdesk/hooks/prepare-commit-msg
# One named tmux attach client per terminal (pid file under /run/agentdesk, an in-memory volume in the pod).
COPY bin/agentdesk-attach /usr/local/lib/agentdesk/bin/agentdesk-attach
COPY bin/agentdesk-detach /usr/local/lib/agentdesk/bin/agentdesk-detach
# The tmux pane command (writes the agent's exit code) and the worker's stop request (both use /run/agentdesk too).
COPY bin/agentdesk-session /usr/local/lib/agentdesk/bin/agentdesk-session
COPY bin/agentdesk-end /usr/local/lib/agentdesk/bin/agentdesk-end
# Status protocol: agent-neutral declare command + the Claude Code adapter (hooks via managed settings,
# which a repo's .claude/settings.json cannot override).
COPY agentdesk-status.mjs /usr/local/lib/agentdesk/agentdesk-status.mjs
COPY agents/claude/hook.mjs /usr/local/lib/agentdesk/agents/claude/hook.mjs
COPY agents/claude/transcript.mjs /usr/local/lib/agentdesk/agents/claude/transcript.mjs
COPY agents/claude/managed-settings.json /etc/claude-code/managed-settings.json
COPY agents/claude/commands.sh /usr/local/lib/agentdesk/agents/claude/commands.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh /usr/local/lib/agentdesk/git-credential-agentdesk \
    /usr/local/lib/agentdesk/bin/gh /usr/local/lib/agentdesk/hooks/prepare-commit-msg \
    /usr/local/lib/agentdesk/bin/agentdesk-attach \
    /usr/local/lib/agentdesk/bin/agentdesk-detach /usr/local/lib/agentdesk/bin/agentdesk-session \
    /usr/local/lib/agentdesk/bin/agentdesk-end \
 && chmod 0644 /usr/local/lib/agentdesk/select-plugins.mjs /usr/local/lib/agentdesk/agentdesk-status.mjs \
    /usr/local/lib/agentdesk/agents/claude/hook.mjs /usr/local/lib/agentdesk/agents/claude/commands.sh \
    /usr/local/lib/agentdesk/agents/claude/transcript.mjs \
    /etc/claude-code/managed-settings.json \
 && printf '#!/bin/sh\nexec node /usr/local/lib/agentdesk/agentdesk-status.mjs "$@"\n' > /usr/local/bin/agentdesk-status \
 && chmod 0755 /usr/local/bin/agentdesk-status \
 && mkdir -p /home/runner/.agentdesk && chown 10001:10001 /home/runner/.agentdesk \
 && mkdir -p /run/agentdesk && chown 10001:10001 /run/agentdesk
# Run pods keep HOME on the per-run volume; the entrypoint copies this skeleton into it without overwriting.
# /home/runner itself stays as is for setup-test pods.
RUN mkdir -p /usr/local/share/agentdesk \
 && cp -a /home/runner /usr/local/share/agentdesk/home-skel \
 && chown -R 10001:10001 /usr/local/share/agentdesk/home-skel

USER 10001:10001
ENV HOME=/home/runner
ENV PATH=/usr/local/lib/agentdesk/bin:$PATH
ENV DISABLE_AUTOUPDATER=1
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
