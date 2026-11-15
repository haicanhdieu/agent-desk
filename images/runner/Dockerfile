# Agent Desk runner image (control-plane spec §8, infra spec §5). Local/dev build:
#   podman build -t agentdesk-runner:dev images/runner
FROM node:22-slim

ARG CLAUDE_CODE_VERSION=2.1.323

RUN apt-get update \
 && apt-get install -y --no-install-recommends git tmux ca-certificates curl openssh-client \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
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
# Status protocol: agent-neutral declare command + the Claude Code adapter (hooks via managed settings,
# which a repo's .claude/settings.json cannot override).
COPY agentdesk-status.mjs /usr/local/lib/agentdesk/agentdesk-status.mjs
COPY agents/claude/hook.mjs /usr/local/lib/agentdesk/agents/claude/hook.mjs
COPY agents/claude/managed-settings.json /etc/claude-code/managed-settings.json
RUN chmod 0755 /usr/local/bin/entrypoint.sh /usr/local/lib/agentdesk/git-credential-agentdesk \
    /usr/local/lib/agentdesk/bin/gh \
 && chmod 0644 /usr/local/lib/agentdesk/select-plugins.mjs /usr/local/lib/agentdesk/agentdesk-status.mjs \
    /usr/local/lib/agentdesk/agents/claude/hook.mjs /etc/claude-code/managed-settings.json \
 && printf '#!/bin/sh\nexec node /usr/local/lib/agentdesk/agentdesk-status.mjs "$@"\n' > /usr/local/bin/agentdesk-status \
 && chmod 0755 /usr/local/bin/agentdesk-status \
 && mkdir -p /home/runner/.agentdesk && chown 10001:10001 /home/runner/.agentdesk

USER 10001:10001
ENV HOME=/home/runner
ENV PATH=/usr/local/lib/agentdesk/bin:$PATH
ENV DISABLE_AUTOUPDATER=1
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
