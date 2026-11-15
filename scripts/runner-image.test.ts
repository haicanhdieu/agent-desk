import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Drives scripts/runner-image.sh against a throwaway git repo and a stub `podman` that only logs its calls.
const script = resolve(__dirname, 'runner-image.sh');

let dir: string;
let calls: string;

function git(...args: string[]): void {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}

function run(env: Record<string, string> = {}): { status: number | null; out: string } {
  const r = spawnSync('bash', [script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: dir,
      KUBE_MODE: 'kubeconfig',
      PODMAN: join(dir, 'podman'),
      RUNNER_IMAGE_REPO_ROOT: dir,
      ...env,
    },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const built = (): boolean => readFileSync(calls, 'utf8').includes('build ');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runner-image-'));
  calls = join(dir, 'calls.log');
  writeFileSync(calls, '');
  // Stub: `ps` reports the k3s container, `exec ... images ls` reports the image present once imported.
  writeFileSync(
    join(dir, 'podman'),
    `#!/bin/sh
echo "$@" >> "${calls}"
case "$1" in
  ps) echo agentdesk-k3s ;;
  save) echo "$2" > "${dir}/saved"; echo image-bytes ;;
  exec) case "$*" in
    *"images ls"*) [ -f "${dir}/imported" ] && { ref="$(cat "${dir}/saved")"; case "\${ref##*/}" in *:*) echo "$ref" ;; *) echo "$ref:latest" ;; esac; } ;;
    *import*) cat >/dev/null; touch "${dir}/imported" ;;
  esac ;;
esac
exit 0
`,
  );
  chmodSync(join(dir, 'podman'), 0o755);
  mkdirSync(join(dir, 'images/runner/test'), { recursive: true });
  writeFileSync(join(dir, 'images/runner/Dockerfile'), 'FROM scratch\n');
  writeFileSync(join(dir, 'images/runner/entrypoint.sh'), '#!/bin/sh\n');
  writeFileSync(join(dir, 'images/runner/test/a.test.ts'), '// test\n');
  git('init', '-q');
  git('add', '-A');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('scripts/runner-image.sh', () => {
  it('builds and imports on the first run, then skips while nothing changed', () => {
    expect(run().status).toBe(0);
    expect(built()).toBe(true);

    writeFileSync(calls, '');
    const second = run();
    expect(second.status).toBe(0);
    expect(built()).toBe(false);
    expect(second.out).toContain('up to date');
  });

  it('rebuilds when a file that goes into the image changes', () => {
    run();
    writeFileSync(join(dir, 'images/runner/entrypoint.sh'), '#!/bin/sh\necho changed\n');
    writeFileSync(calls, '');
    run();
    expect(built()).toBe(true);
  });

  it('does not rebuild when only the runner tests change', () => {
    run();
    writeFileSync(join(dir, 'images/runner/test/a.test.ts'), '// edited\n');
    writeFileSync(calls, '');
    run();
    expect(built()).toBe(false);
  });

  it('rebuilds when the image is missing from k3s even though the files did not change', () => {
    run();
    rmSync(join(dir, 'imported'));
    writeFileSync(calls, '');
    run();
    expect(built()).toBe(true);
  });

  it('does not abort when a tracked file under images/runner was deleted from the working tree', () => {
    rmSync(join(dir, 'images/runner/entrypoint.sh'));
    const r = run();
    expect(r.status).toBe(0);
    expect(built()).toBe(true);
  });

  it('uses RUNNER_IMAGE for the build, tag and import', () => {
    const r = run({ RUNNER_IMAGE: 'agentdesk-runner:mine' });
    expect(r.status).toBe(0);
    const log = readFileSync(calls, 'utf8');
    expect(log).toContain('build -q -t localhost/agentdesk-runner:mine');
    expect(log).toContain('tag localhost/agentdesk-runner:mine docker.io/library/agentdesk-runner:mine');
    expect(log).toContain('save docker.io/library/agentdesk-runner:mine');
    expect(log).not.toContain('agentdesk-runner:dev');
    writeFileSync(calls, '');
    expect(run({ RUNNER_IMAGE: 'agentdesk-runner:mine' }).out).toContain('up to date');
  });

  it('treats a tagless RUNNER_IMAGE as :latest so the second run is up to date', () => {
    expect(run({ RUNNER_IMAGE: 'agentdesk-runner' }).status).toBe(0);
    expect(readFileSync(calls, 'utf8')).toContain('save docker.io/library/agentdesk-runner:latest');
    writeFileSync(calls, '');
    const second = run({ RUNNER_IMAGE: 'agentdesk-runner' });
    expect(second.out).toContain('up to date');
    expect(built()).toBe(false);
  });

  it.each([
    ['ghcr.io/acme/runner:dev', 'ghcr.io/acme/runner:dev'],
    ['localhost:5000/runner', 'localhost:5000/runner:latest'],
    ['myorg/runner:dev', 'docker.io/myorg/runner:dev'],
  ])('tags and saves %s as %s', (image, ref) => {
    expect(run({ RUNNER_IMAGE: image }).status).toBe(0);
    const log = readFileSync(calls, 'utf8');
    expect(log).toContain(` ${ref}\n`);
    expect(log).toContain(`save ${ref}\n`);
    expect(log).not.toContain('docker.io/library/');
    writeFileSync(calls, '');
    expect(run({ RUNNER_IMAGE: image }).out).toContain('up to date');
  });

  it.each(['-bad', 'a b:dev', 'x;rm -rf:dev', '$(id)'])(
    'skips an invalid RUNNER_IMAGE %j without building',
    (image) => {
      const r = run({ RUNNER_IMAGE: image });
      expect(r.status).toBe(0);
      expect(r.out).toContain('runner-image: skipped (invalid RUNNER_IMAGE');
      expect(built()).toBe(false);
    },
  );

  it('does nothing outside KUBE_MODE=kubeconfig', () => {
    const r = run({ KUBE_MODE: 'fake' });
    expect(r.status).toBe(0);
    expect(readFileSync(calls, 'utf8')).toBe('');
  });
});
