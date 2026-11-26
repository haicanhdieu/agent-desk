import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dockerfile = join(import.meta.dirname, '..', 'Dockerfile');

describe('runner Dockerfile', () => {
  it('installs gh from the official GitHub CLI apt repo, not Debian (Debian ships 2.23, which has no `gh project`)', async () => {
    const text = await readFile(dockerfile, 'utf8');
    const baseInstall = text.split('\n').find((l) => l.includes('apt-get install') && l.includes('git'));
    expect(baseInstall).toBeDefined();
    expect(baseInstall).not.toMatch(/\bgh\b/);
    expect(text).toContain('cli.github.com/packages');
    expect(text).toMatch(/apt-get install -y --no-install-recommends "?gh=/);
  });

  it('pins gh to an exact version and verifies the apt keyring against a committed sha256', async () => {
    const text = await readFile(dockerfile, 'utf8');
    expect(text).toMatch(/^ARG GH_VERSION=\d+\.\d+\.\d+$/m);
    expect(text).toContain('gh=${GH_VERSION}');
    const keyring = /echo "([0-9a-f]{64}) {2}\/etc\/apt\/keyrings\/githubcli-archive-keyring\.gpg" \| sha256sum -c -/;
    expect(text).toMatch(keyring);
    // the check must run after the download and before the apt source trusts the keyring
    expect(text.indexOf('sha256sum -c -')).toBeGreaterThan(text.indexOf('githubcli-archive-keyring.gpg -o'));
    expect(text.indexOf('sha256sum -c -')).toBeLessThan(text.indexOf('github-cli.list'));
  });

  it('copies the baked home into a skeleton folder owned by 10001, and ships the agent files', async () => {
    const text = await readFile(dockerfile, 'utf8');
    expect(text).toContain('/usr/local/share/agentdesk/home-skel');
    expect(text).toMatch(/chown -R 10001:10001[^\n]*\/usr\/local\/share\/agentdesk\/home-skel/);
    expect(text).toContain('COPY agents/ /usr/local/lib/agentdesk/agents/');
  });

  it('ships agentdesk-attach, -detach, -end and -session executable on PATH, with a /run/agentdesk fallback owned by 10001', async () => {
    const text = await readFile(dockerfile, 'utf8');
    // Join the shell line continuations so each RUN is one line.
    const joined = text.replace(/\\\n/g, ' ');
    const chmod = joined.split('\n').find((l) => l.includes('chmod 0755')) ?? '';
    for (const name of ['agentdesk-attach', 'agentdesk-detach', 'agentdesk-end', 'agentdesk-session']) {
      expect(text).toContain(`COPY bin/${name} /usr/local/lib/agentdesk/bin/${name}`);
      expect(chmod).toContain(`/usr/local/lib/agentdesk/bin/${name}`);
    }
    expect(joined).toMatch(/mkdir -p [^\n]*\/run\/agentdesk[^\n]*chown[^\n]*10001:10001[^\n]*\/run\/agentdesk/);
  });
});

describe('runner Dockerfile agent CLIs (BR-52)', () => {
  const read = async () => readFile(dockerfile, 'utf8');
  const joined = async () => (await read()).replace(/\\\n/g, ' ');

  it('pins @anthropic-ai/claude-code to the current release', async () => {
    const text = await read();
    // Runs must get the release npm's `latest` tag points at, not an older one (#309).
    // Bump this together with the ARG when updating the pin.
    expect(text).toMatch(/^ARG CLAUDE_CODE_VERSION=2\.1\.332$/m);
    expect(text).toContain('"@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"');
  });

  it('pins @openai/codex to an exact version', async () => {
    const text = await read();
    expect(text).toMatch(/^ARG CODEX_VERSION=\d+\.\d+\.\d+$/m);
    expect(text).toContain('"@openai/codex@${CODEX_VERSION}"');
  });

  it('pins @opencode/cli to an exact version with a sha256 checked at build time', async () => {
    const text = await read();
    expect(text).toMatch(/^ARG OPENCODE_VERSION=\d+\.\d+\.\d+$/m);
    expect(text).toMatch(/^ARG OPENCODE_SHA256=[0-9a-f]{64}$/m);
    expect(text).toContain('"@opencode/cli@${OPENCODE_VERSION}"');
    const line =
      (await joined()).split('\n').find((l) => l.includes('OPENCODE_SHA256') && l.includes('sha256sum')) ?? '';
    expect(line).toContain('sha256sum -c -');
  });

  it('uses no latest, tag or range for the agent CLIs, no opencode-ai and nothing of Antigravity', async () => {
    const text = await read();
    for (const m of text.matchAll(/npm install[^\n]*/g)) {
      expect(m[0]).not.toMatch(/@latest|@next|@\^|@~|@\*/);
    }
    expect(text).not.toMatch(/opencode-ai/);
    expect(text).not.toMatch(/antigravity/i);
  });

  it('copies the whole agents/ directory and sets modes in one loop', async () => {
    const text = await read();
    expect(text).toContain('COPY agents/ /usr/local/lib/agentdesk/agents/');
    expect(text).not.toMatch(/^COPY agents\/claude\/(hook|transcript|commands)/m);
    const j = await joined();
    expect(j).toMatch(/find \/usr\/local\/lib\/agentdesk\/agents[^\n]*chmod/);
    expect(j).toMatch(/agents\/claude\/managed-settings\.json|\/etc\/claude-code\/managed-settings\.json/);
  });

  it('installs the Codex managed hook config as /etc/codex/requirements.toml', async () => {
    const text = await read();
    expect(text).toContain('COPY agents/codex/managed-config.toml /etc/codex/requirements.toml');
    expect(await joined()).toContain('/etc/codex/requirements.toml');
  });
});
