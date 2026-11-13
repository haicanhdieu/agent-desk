# Agent Desk runner image (control-plane spec §8, infra spec §5). Local/dev build:
#   podman build -t agentdesk-runner:dev images/runner
FROM node:22-slim

ARG CLAUDE_CODE_VERSION=2.1.323

RUN apt-get update \
 && apt-get install -y --no-install-recommends git gh tmux ca-certificates curl openssh-client \
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
RUN chmod 0755 /usr/local/bin/entrypoint.sh \
 && chmod 0644 /usr/local/lib/agentdesk/select-plugins.mjs

USER 10001:10001
ENV HOME=/home/runner
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
