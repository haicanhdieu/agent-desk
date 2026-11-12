import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestApp } from './app';

/** Listed by `wideFakeRepos` with default branch `develop` (every other repo uses `main`). */
export const DEVELOP_REPO = 'dev/on-develop';

/** A test app whose fake provider lists any repo (so projects can be created for arbitrary repoPaths). */
export const wideFakeRepos = (
  real: import('@agentdesk/core').AdapterRegistry,
): import('@agentdesk/core').AdapterRegistry => ({
  ...real,
  codeHost: (provider) => {
    const host = real.codeHost(provider);
    if (provider !== 'fake') return host;
    return Object.assign(Object.create(host), {
      listRepos: async () => [
        ...Array.from({ length: 50 }, (_, i) => ({ repoPath: `dev/p-${i}`, private: false, defaultBranch: 'main' })),
        { repoPath: DEVELOP_REPO, private: false, defaultBranch: 'develop' },
      ],
    });
  },
});

/** Installs the fake provider for the cookie's org and returns the connection id. */
export async function installFake(t: TestApp, cookie: string): Promise<string> {
  const inst = await t.app.inject({ method: 'POST', url: '/api/connections/fake/install', headers: { cookie } });
  const u = new URL((inst.json() as { url: string }).url);
  const cb = await t.app.inject({ method: 'GET', url: `${u.pathname}${u.search}`, headers: { cookie } });
  return new URL(String(cb.headers['location'])).searchParams.get('connection') ?? '';
}

let seq = 0;
/** Creates a project on a unique repo path and returns { projectId, repoPath }. */
export async function makeProject(
  t: TestApp,
  cookie: string,
  connectionId: string,
): Promise<{ projectId: string; repoPath: string }> {
  seq += 1;
  const repoPath = `dev/p-${seq}`;
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { cookie },
    payload: { connectionId, repoPath, triggerMode: 'webhook' },
  });
  if (res.statusCode !== 201) throw new Error(`project create failed: ${res.body}`);
  return { projectId: (res.json() as { id: string }).id, repoPath };
}

/** Fresh fake-provider state dir, so skill files never leak between test files or runs. */
export function freshStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'agentdesk-fake-'));
}
