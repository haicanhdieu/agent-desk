import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeStore, type AdapterProject, type AdapterRegistry } from '@agentdesk/core';
import type { PluginsDto } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

const SETTINGS_PATH = '.claude/settings.json';
const SECRET_TEXT = 'SECRET_REPO_TEXT_DO_NOT_LOG';

let t: TestApp;
let alice: string;
let bob: string;
let connectionId: string;
let store: FakeStore;
/** Repo paths whose settings read fails, with the error to throw. */
const failing = new Map<string, Error>();

/** The wide fake provider, with `readRepoFile` failing for the repos listed in `failing`. */
const failingReads = (real: AdapterRegistry): AdapterRegistry => {
  const wide = wideFakeRepos(real);
  return {
    ...wide,
    codeHost: (provider) => {
      const host = wide.codeHost(provider);
      return Object.assign(Object.create(host), {
        readRepoFile: async (project: AdapterProject, path: string) => {
          const err = failing.get(project.repoPath);
          if (err) throw err;
          return host.readRepoFile(project, path);
        },
      });
    },
  };
};

beforeAll(async () => {
  const dir = freshStateDir();
  store = new FakeStore(dir);
  t = await createTestApp({ env: { FAKE_STATE_DIR: dir }, wrapAdapters: failingReads });
  alice = await loginAs(t, 'alice');
  bob = await loginAs(t, 'bob');
  connectionId = await installFake(t, alice);
});
afterAll(async () => {
  await t.close();
});

const plugins = (projectId: string, cookie = alice) =>
  t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/plugins`, headers: cookie ? { cookie } : {} });

async function projectWith(settings: string | null): Promise<{ projectId: string; repoPath: string }> {
  const p = await makeProject(t, alice, connectionId);
  if (settings !== null) await store.writeRepoFile(p.repoPath, SETTINGS_PATH, settings);
  return p;
}

describe('plugins panel', () => {
  it('lists will_install and blocked plugins from the repo settings, sorted by store then plugin', async () => {
    const { projectId } = await projectWith(
      JSON.stringify({
        enabledPlugins: {
          'superpowers@claude-plugins-official': true,
          'off@claude-plugins-official': false,
          'foo@evil-store': true,
          'Bad Id@claude-plugins-official': true,
        },
      }),
    );
    const res = await plugins(projectId);
    expect(res.statusCode).toBe(200);
    expect(expectContract('setup.plugins', res) as PluginsDto).toEqual({
      approvedStores: ['claude-plugins-official'],
      plugins: [
        {
          id: 'superpowers@claude-plugins-official',
          name: 'superpowers',
          store: 'claude-plugins-official',
          state: 'will_install',
        },
        { id: 'foo@evil-store', name: 'foo', store: 'evil-store', state: 'blocked' },
      ],
      settingsError: null,
    });
  });

  it('a repo without a settings file is an empty list, not an error', async () => {
    const { projectId } = await projectWith(null);
    expect(expectContract('setup.plugins', await plugins(projectId))).toEqual({
      approvedStores: ['claude-plugins-official'],
      plugins: [],
      settingsError: null,
    });
  });

  it('invalid JSON settings is an empty list with no error (the runner ignores it too)', async () => {
    const { projectId } = await projectWith('{ not json');
    expect(expectContract('setup.plugins', await plugins(projectId))).toMatchObject({
      plugins: [],
      settingsError: null,
    });
  });

  it('an adapter error is settingsError "unreadable" with 200, logged by name only', async () => {
    const { projectId, repoPath } = await projectWith(null);
    failing.set(repoPath, Object.assign(new Error(`boom ${SECRET_TEXT}`), { name: 'RepoFileError' }));
    const logged: string[] = [];
    const spies = (['error', 'warn', 'log'] as const).map((m) =>
      vi
        .spyOn(Logger.prototype, m)
        .mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' '))),
    );
    try {
      const res = await plugins(projectId);
      expect(res.statusCode).toBe(200);
      expect(expectContract('setup.plugins', res)).toEqual({
        approvedStores: ['claude-plugins-official'],
        plugins: [],
        settingsError: 'unreadable',
      });
    } finally {
      spies.forEach((s) => s.mockRestore());
      failing.delete(repoPath);
    }
    expect(logged.join('\n')).toContain('RepoFileError');
    expect(logged.join('\n')).not.toContain(SECRET_TEXT);
  });

  it('any member of the org can read; another org gets 404; no session gets 401', async () => {
    const { projectId } = await projectWith('{"enabledPlugins":{"a@claude-plugins-official":true}}');
    expect((await plugins(projectId, bob)).statusCode).toBe(404);
    expect((await plugins(randomUUID())).statusCode).toBe(404);
    const anon = await plugins(projectId, '');
    expect(anon.statusCode).toBe(401);
    expect(anon.headers['content-type']).toContain('application/problem+json');
  });
});
