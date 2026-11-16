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

  it('copies the baked home into a skeleton folder owned by 10001, and ships the agent command file', async () => {
    const text = await readFile(dockerfile, 'utf8');
    expect(text).toContain('/usr/local/share/agentdesk/home-skel');
    expect(text).toMatch(/chown -R 10001:10001[^\n]*\/usr\/local\/share\/agentdesk\/home-skel/);
    expect(text).toContain('agents/claude/commands.sh');
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
