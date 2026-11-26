import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeBoardAdapter } from '../../src/adapters/fake/board';
import { FakeCodeHostAdapter } from '../../src/adapters/fake/codehost';
import { FakeStore } from '../../src/adapters/fake/store';
import { RepoFileError, SkillConflictError, SkillNotFoundError } from '../../src/adapters/types';
import type { AdapterProject } from '../../src/adapters/types';

const project: AdapterProject = { repoPath: 'dev/demo', connectionExternalId: 'fake' };
let t = Date.parse('2026-11-12T10:00:00Z');
const clock = { now: () => new Date((t += 1000)) };
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fake-store-'));
});

describe('fake board', () => {
  it('prStates returns the stored state for PR tickets; unset, issues and unknown refs are left out', async () => {
    const store = new FakeStore(dir, clock);
    const board = new FakeBoardAdapter(store, clock);
    await store.addTicket({ repoPath: 'dev/demo', number: 1, kind: 'pr', title: 'A', labels: [], prState: 'merged' });
    await store.addTicket({ repoPath: 'dev/demo', number: 2, kind: 'pr', title: 'B', labels: [] });
    await store.addTicket({ repoPath: 'dev/demo', number: 3, kind: 'issue', title: 'C', labels: [], prState: 'open' });
    await store.addTicket({ repoPath: 'other/repo', number: 4, kind: 'pr', title: 'D', labels: [], prState: 'open' });
    const out = (await board.prStates(project, ['1', '2', '3', '4', '99'])).states;
    expect(Object.fromEntries(out)).toEqual({ 1: 'merged' });
    expect([...(await board.prStates(project, ['1', '2', '99'])).unresolved].sort()).toEqual(['2', '99']);
  });

  it('a comment appended by one store is polled through a second store on the same dir', async () => {
    const a = new FakeStore(dir, clock);
    const b = new FakeBoardAdapter(new FakeStore(dir, clock), clock);
    await a.addTicket({ repoPath: 'dev/demo', number: 1, kind: 'issue', title: 'T', labels: [] });
    const since = new Date(t).toISOString();
    await a.addComment({
      repoPath: 'dev/demo',
      ticketRef: '1',
      body: '/fix',
      author: 'me',
      authorAssociation: 'OWNER',
    });
    const res = await b.pollEvents(project, { since, etag: null });
    expect(res.kind).toBe('events');
    if (res.kind !== 'events') return;
    expect(res.events).toHaveLength(1);
    expect(res.events[0]).toMatchObject({
      provider: 'fake',
      body: '/fix',
      ticketRef: '1',
      repoPath: 'dev/demo',
      authorId: 'me',
    });
    const again = await b.pollEvents(project, res.cursor);
    expect(again.kind).toBe('events');
    if (again.kind === 'events') expect(again.events).toHaveLength(0);
  });

  it('comment() appends to posted.jsonl and returns an id', async () => {
    const store = new FakeStore(dir, clock);
    const board = new FakeBoardAdapter(store, clock);
    const id = await board.comment(project, '1', 'started');
    const lines = (await readFile(join(dir, 'posted.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ id, ticketRef: '1', body: 'started' });
  });

  it('getTicket returns the stored ticket', async () => {
    const store = new FakeStore(dir, clock);
    await store.addTicket({
      repoPath: 'dev/demo',
      number: 2,
      kind: 'pr',
      title: 'P',
      labels: [{ name: 'x', color: 'fff' }],
    });
    const tk = await new FakeBoardAdapter(new FakeStore(dir, clock), clock).getTicket(project, '2');
    expect(tk).toMatchObject({
      ref: '2',
      kind: 'pr',
      number: 2,
      title: 'P',
      labels: [{ name: 'x', color: 'fff' }],
      linkedRefs: [],
    });
  });

  describe('linkedRefs', () => {
    const base = { repoPath: 'dev/demo', title: 'T', labels: [] };
    const board = () => new FakeBoardAdapter(new FakeStore(dir, clock), clock);

    it("a fake PR's linkedRefs is its own linked ∪ the issues whose linked lists it", async () => {
      const store = new FakeStore(dir, clock);
      await store.addTicket({ ...base, number: 10, kind: 'pr', linked: [3] });
      await store.addTicket({ ...base, number: 4, kind: 'issue', linked: [10] });
      await store.addTicket({ ...base, number: 5, kind: 'issue', linked: [99] });
      expect((await board().getTicket(project, '10')).linkedRefs).toEqual(['3', '4']);
    });

    it("a fake issue's linkedRefs is [] even with linked", async () => {
      const store = new FakeStore(dir, clock);
      await store.addTicket({ ...base, number: 4, kind: 'issue', linked: [10] });
      await store.addTicket({ ...base, number: 10, kind: 'pr', linked: [4] });
      expect((await board().getTicket(project, '4')).linkedRefs).toEqual([]);
    });

    it('an issue in another repo never links', async () => {
      const store = new FakeStore(dir, clock);
      await store.addTicket({ ...base, number: 10, kind: 'pr' });
      await store.addTicket({ ...base, repoPath: 'other/repo', number: 4, kind: 'issue', linked: [10] });
      expect((await board().getTicket(project, '10')).linkedRefs).toEqual([]);
    });

    it('a tickets.json without linked still parses', async () => {
      await writeFile(
        join(dir, 'tickets.json'),
        JSON.stringify({ tickets: [{ ...base, number: 2, kind: 'pr' }] }),
        'utf8',
      );
      expect((await board().getTicket(project, '2')).linkedRefs).toEqual([]);
    });
  });

  it('webhook: valid HMAC parses, bad HMAC is rejected before parsing', async () => {
    const board = new FakeBoardAdapter(new FakeStore(dir, clock), clock, 'dev');
    const body = JSON.stringify({
      deliveryId: 'd1',
      commentId: 'c1',
      repoPath: 'dev/demo',
      ticketRef: '1',
      body: '/fix',
      author: 'me',
      authorAssociation: 'OWNER',
    });
    const sig = createHmac('sha256', 'dev').update(body).digest('hex');
    const ok = await board.verifyAndParseWebhook({ 'x-fake-signature': sig }, body, async () => undefined);
    expect(ok).toMatchObject({ provider: 'fake', deliveryId: 'd1', commentId: 'c1', authorId: 'me' });
    expect(await board.verifyAndParseWebhook({ 'x-fake-signature': 'zz' }, body, async () => undefined)).toBe(
      'bad_signature',
    );
    expect(await board.verifyAndParseWebhook({}, 'not json', async () => undefined)).toBe('bad_signature');
    // non-hex / wrong-length signatures are rejected without throwing
    for (const bad of ['', 'zz'.repeat(32), sig.slice(0, 62), `${sig}00`]) {
      expect(await board.verifyAndParseWebhook({ 'x-fake-signature': bad }, body, async () => undefined)).toBe(
        'bad_signature',
      );
    }
    // correctly signed but not JSON: authentic, just not an event
    const junk = 'not json';
    const junkSig = createHmac('sha256', 'dev').update(junk).digest('hex');
    expect(await board.verifyAndParseWebhook({ 'x-fake-signature': junkSig }, junk, async () => undefined)).toBeNull();
  });
});

describe('fake code host', () => {
  it('names the commit identity of a person with a fake noreply address', () => {
    const host = new FakeCodeHostAdapter(new FakeStore(dir, clock), clock, 'http://localhost:3000');
    expect(host.commitIdentity({ login: 'alice', externalId: '1' })).toEqual({
      name: 'alice',
      email: 'alice@users.noreply.fake.invalid',
    });
  });

  it('refuses a commit identity for an unsafe login', () => {
    const host = new FakeCodeHostAdapter(new FakeStore(dir, clock), clock, 'http://localhost:3000');
    expect(host.commitIdentity({ login: 'a;b', externalId: '1' })).toBeNull();
  });

  it('writeSkill then readSkill round-trips with a new sha; conflicts are detected', async () => {
    const host = new FakeCodeHostAdapter(new FakeStore(dir, clock), clock, 'http://localhost:3000');
    const w1 = await host.writeSkill(project, 'fix', '---\ndescription: Fixes\n---\nv1', 'add');
    const r1 = await host.readSkill(project, 'fix');
    expect(r1.body).toContain('v1');
    expect(r1.sha).toBe(w1.kind === 'commit' ? w1.commitSha : '');
    expect(r1.description).toBe('Fixes');
    const w2 = await host.writeSkill(project, 'fix', 'v2', 'edit', r1.sha);
    expect(w2).not.toEqual(w1);
    await expect(host.writeSkill(project, 'fix', 'v3', 'edit', r1.sha)).rejects.toBeInstanceOf(SkillConflictError);
    expect((await host.listSkills(project)).map((s) => s.name)).toEqual(['fix']);
    const del = await host.deleteSkill(project, 'fix', 'rm');
    expect(del).toEqual({ kind: 'commit', commitSha: expect.any(String), targetBranch: 'main' });
    expect(await host.listSkills(project)).toEqual([]);
  });

  it('writeSkill returns a commit result targeting the default branch', async () => {
    const host = new FakeCodeHostAdapter(new FakeStore(dir, clock), clock, 'http://localhost:3000');
    const w = await host.writeSkill(project, 'fix', 'v1', 'add');
    expect(w).toEqual({ kind: 'commit', commitSha: expect.any(String), targetBranch: 'main' });
    const other = await host.writeSkill({ ...project, defaultBranch: 'trunk' }, 'two', 'v1', 'add');
    expect(other).toMatchObject({ kind: 'commit', targetBranch: 'trunk' });
  });

  it('mirrors GitHub write semantics: sha required to update, stale sha conflicts, create needs no sha', async () => {
    const host = new FakeCodeHostAdapter(new FakeStore(dir, clock), clock, 'http://localhost:3000');
    const created = await host.writeSkill(project, 'fix', 'v1', 'add');
    await expect(host.writeSkill(project, 'fix', 'v2', 'edit')).rejects.toBeInstanceOf(SkillConflictError);
    await expect(host.writeSkill(project, 'fix', 'v2', 'edit', 'stale')).rejects.toBeInstanceOf(SkillConflictError);
    await expect(
      host.writeSkill(project, 'other', 'v2', 'edit', created.kind === 'commit' ? created.commitSha : ''),
    ).rejects.toBeInstanceOf(SkillConflictError);
    await expect(host.writeSkill(project, 'fix', 'v2', 'edit', '')).rejects.toBeInstanceOf(SkillConflictError);
    expect((await host.writeSkill(project, 'fresh', 'v1', 'add', '')).kind).toBe('commit');
    const updated = await host.writeSkill(
      project,
      'fix',
      'v2',
      'edit',
      created.kind === 'commit' ? created.commitSha : '',
    );
    expect(updated).not.toEqual(created);
    expect((await host.readSkill(project, 'fix')).body).toBe('v2');
  });

  describe('skill folders', () => {
    const codex: AdapterProject = { ...project, skillFolders: ['.agents/skills'] };
    const opencode: AdapterProject = { ...project, skillFolders: ['.opencode/skills', '.agents/skills'] };
    const make = () => {
      const store = new FakeStore(dir, clock);
      return { store, host: new FakeCodeHostAdapter(store, clock, 'http://localhost:3000') };
    };

    it('a new skill goes to the default agent folder, and its path names that folder', async () => {
      const { host } = make();
      await host.writeSkill(project, 'fix', 'v1', 'add');
      await host.writeSkill(opencode, 'two', 'v1', 'add');
      await host.writeSkill(codex, 'three', 'v1', 'add');
      expect((await host.readSkill(project, 'fix')).path).toBe('.claude/skills/fix/SKILL.md');
      expect((await host.readSkill(opencode, 'two')).path).toBe('.opencode/skills/two/SKILL.md');
      expect((await host.readSkill(codex, 'three')).path).toBe('.agents/skills/three/SKILL.md');
    });

    it('lists every folder in order; a duplicate name keeps the agent folder', async () => {
      const { store, host } = make();
      await store.writeSkillFile(project.repoPath, '.agents/skills', 'fix', 'generic fix');
      await store.writeSkillFile(project.repoPath, '.agents/skills', 'deploy', 'generic deploy');
      await store.writeSkillFile(project.repoPath, '.claude/skills', 'fix', 'claude fix');
      await store.writeSkillFile(project.repoPath, '.claude/skills', 'review', 'claude review');
      const list = await host.listSkills(project);
      expect(list.map((s) => [s.name, s.path])).toEqual([
        ['fix', '.claude/skills/fix/SKILL.md'],
        ['review', '.claude/skills/review/SKILL.md'],
        ['deploy', '.agents/skills/deploy/SKILL.md'],
      ]);
      expect((await host.readSkill(project, 'fix')).body).toBe('claude fix');
    });

    it('a Codex project does not see the Claude folder', async () => {
      const { store, host } = make();
      await store.writeSkillFile(project.repoPath, '.claude/skills', 'fix', 'v1');
      expect(await host.listSkills(codex)).toEqual([]);
      await expect(host.readSkill(codex, 'fix')).rejects.toBeInstanceOf(SkillNotFoundError);
    });

    it('edits and deletes a skill in the folder it lives in', async () => {
      const { store, host } = make();
      const sha = await store.writeSkillFile(project.repoPath, '.agents/skills', 'fix', 'v1');
      await host.writeSkill(project, 'fix', 'v2', 'edit', sha);
      expect(await store.readSkillFile(project.repoPath, '.claude/skills', 'fix')).toBeNull();
      expect((await store.readSkillFile(project.repoPath, '.agents/skills', 'fix'))?.body).toBe('v2');
      await host.deleteSkill(project, 'fix', 'rm');
      expect(await store.readSkillFile(project.repoPath, '.agents/skills', 'fix')).toBeNull();
    });

    it('creating over a skill that is already in the default agent folder conflicts', async () => {
      const { store, host } = make();
      await store.writeSkillFile(project.repoPath, '.claude/skills', 'fix', 'v1');
      await expect(host.writeSkill(project, 'fix', 'v2', 'add')).rejects.toBeInstanceOf(SkillConflictError);
    });
  });

  describe('protected default branch', () => {
    const setup = async () => {
      const store = new FakeStore(dir, clock);
      await store.setBranchProtected(project.repoPath, true);
      return { store, host: new FakeCodeHostAdapter(store, clock, 'http://localhost:3000') };
    };

    it('create returns a change request and leaves the live skill untouched', async () => {
      const { store, host } = await setup();
      const r = await host.writeSkill(project, 'fix', 'v1', 'add fix');
      expect(r).toEqual({
        kind: 'change_request',
        sourceBranch: expect.stringMatching(/^agent-desk\/skill-create-fix-/),
        targetBranch: 'main',
        url: expect.stringContaining('http://localhost:3000/'),
        id: expect.any(String),
      });
      expect(await store.readSkillFile(project.repoPath, '.claude/skills', 'fix')).toBeNull();
    });

    it('update keeps stale-sha protection and does not change the live body', async () => {
      const { store, host } = await setup();
      const live = await store.writeSkillFile(project.repoPath, '.claude/skills', 'fix', 'v1');
      await expect(host.writeSkill(project, 'fix', 'v2', 'edit', 'stale')).rejects.toBeInstanceOf(SkillConflictError);
      const r = await host.writeSkill({ ...project, defaultBranch: 'trunk' }, 'fix', 'v2', 'edit', live);
      expect(r).toMatchObject({ kind: 'change_request', targetBranch: 'trunk' });
      expect(r.kind === 'change_request' && r.sourceBranch).toMatch(/^agent-desk\/skill-update-fix-/);
      expect((await host.readSkill(project, 'fix')).body).toBe('v1');
    });

    it('delete returns a change request, keeps the skill, and still 404s a missing skill', async () => {
      const { store, host } = await setup();
      await store.writeSkillFile(project.repoPath, '.claude/skills', 'fix', 'v1');
      const r = await host.deleteSkill(project, 'fix', 'rm');
      expect(r.kind === 'change_request' && r.sourceBranch).toMatch(/^agent-desk\/skill-delete-fix-/);
      expect((await host.readSkill(project, 'fix')).body).toBe('v1');
      await expect(host.deleteSkill(project, 'nope', 'rm')).rejects.toBeInstanceOf(SkillNotFoundError);
    });

    it('gives each submission its own branch and id', async () => {
      const { host } = await setup();
      const a = await host.writeSkill(project, 'fix', 'v1', 'a');
      const b = await host.writeSkill(project, 'fix', 'v1', 'b');
      expect(a).not.toEqual(b);
    });

    it('other repos stay direct-commit', async () => {
      const { host } = await setup();
      expect((await host.writeSkill({ ...project, repoPath: 'dev/demo-2' }, 'fix', 'v1', 'a')).kind).toBe('commit');
    });
  });

  it('rejects path traversal in skill names', async () => {
    const host = new FakeCodeHostAdapter(new FakeStore(dir, clock), clock, 'http://localhost:3000');
    await expect(host.writeSkill(project, '../evil', 'x', 'm')).rejects.toThrow();
  });

  it('lists the demo repos and mints a short-lived token', async () => {
    const host = new FakeCodeHostAdapter(new FakeStore(dir, clock), clock, 'http://localhost:3000');
    expect(await host.listRepos({ externalId: 'fake' })).toEqual([
      { repoPath: 'dev/demo', private: false, defaultBranch: 'main' },
      { repoPath: 'dev/demo-2', private: false, defaultBranch: 'main' },
      { repoPath: 'dev/demo-3', private: false, defaultBranch: 'main' },
    ]);
    const tok = await host.mintWorkspaceToken(project);
    expect(tok.expiresAt.getTime()).toBeGreaterThan(clock.now().getTime());
    expect(host.repoUrl(project)).toBe('https://fake.invalid/dev/demo.git');
    expect(host.gitCredentialUsername()).toBe('x-access-token');
    expect(host.cliTokenEnvName()).toBe('GH_TOKEN');
    expect(host.checkoutRef({ kind: 'pr', number: 7 })).toBe('refs/pull/7/head');
    expect(host.checkoutRef({ kind: 'issue', number: 7 })).toBe('main');
  });
});

describe('fake repo files', () => {
  it('reads a seeded repo file and returns null for a missing one', async () => {
    const store = new FakeStore(dir, clock);
    const host = new FakeCodeHostAdapter(store, clock, 'http://localhost:3000');
    expect(await host.readRepoFile(project, '.claude/settings.json')).toBeNull();
    await store.writeRepoFile('dev/demo', '.claude/settings.json', '{"a":1}');
    expect(await host.readRepoFile(project, '.claude/settings.json')).toBe('{"a":1}');
    // a second store on the same dir (the worker process) sees it
    expect(await new FakeStore(dir, clock).readRepoFile('dev/demo', '.claude/settings.json')).toBe('{"a":1}');
  });

  it('throws a typed error when the path is a directory', async () => {
    const store = new FakeStore(dir, clock);
    const host = new FakeCodeHostAdapter(store, clock, 'http://localhost:3000');
    await store.writeRepoFile('dev/demo', '.claude/settings.json', '{}');
    await expect(host.readRepoFile(project, '.claude')).rejects.toBeInstanceOf(RepoFileError);
  });

  it('rejects traversal in repo or file paths', async () => {
    const store = new FakeStore(dir, clock);
    await expect(store.writeRepoFile('dev/demo', '../x', 'x')).rejects.toThrow(/invalid path segment/);
    await expect(store.readRepoFile('../evil', 'x')).rejects.toThrow(/invalid path segment/);
  });
});

describe('fake store paths', () => {
  it('rejects repoPath traversal segments', async () => {
    const store = new FakeStore(dir, clock);
    await expect(store.writeSkillFile('../evil', '.claude/skills', 'fix', 'x')).rejects.toThrow(/invalid path segment/);
    await expect(store.writeSkillFile('dev/../../evil', '.claude/skills', 'fix', 'x')).rejects.toThrow(
      /invalid path segment/,
    );
    await expect(store.readSkillFile('dev/..', '.claude/skills', 'fix')).rejects.toThrow(/invalid path segment/);
    await expect(store.readSkillFile('dev/demo', '../skills', 'fix')).rejects.toThrow(/invalid path segment/);
  });
});

describe('registry', () => {
  it('registers fake only when enabled, github only with full config', async () => {
    const { createAdapterRegistry } = await import('../../src/adapters/registry');
    const { parseConfig } = await import('../../src/config');
    const base = {
      PUBLIC_ORIGIN: 'http://localhost:3000',
      DATABASE_APP_URL: 'x',
      DATABASE_OWNER_URL: 'x',
      DATABASE_ADMIN_URL: 'x',
      TEMPORAL_ADDRESS: 'x',
      TEMPORAL_NAMESPACE: 'x',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      RUNNER_IMAGE: 'x',
      FAKE_STATE_DIR: dir,
    };
    const none = createAdapterRegistry(parseConfig(base), clock);
    expect(none.providers()).toEqual([]);
    expect(() => none.board('github')).toThrow();
    const fake = createAdapterRegistry(parseConfig({ ...base, ENABLE_FAKE_PROVIDER: 'true' }), clock);
    expect(fake.providers()).toEqual(['fake']);
    expect(fake.board('fake')).toBeDefined();
    expect(fake.codeHost('fake')).toBeDefined();
    const gh = createAdapterRegistry(
      parseConfig({
        ...base,
        GITHUB_APP_ID: '1',
        GITHUB_APP_SLUG: 'agent-desk',
        GITHUB_PRIVATE_KEY: 'pem',
        GITHUB_WEBHOOK_SECRET: 'w',
        GITHUB_CLIENT_ID: 'c',
        GITHUB_CLIENT_SECRET: 's',
      }),
      clock,
    );
    expect(gh.providers()).toEqual(['github']);
    expect(gh.board('github')).toBeDefined();
    expect(gh.codeHost('github').installUrl('o', 's')).toContain('/apps/agent-desk/');
  });

  it('passes the configured fake webhook secret to the fake board', async () => {
    const { createAdapterRegistry } = await import('../../src/adapters/registry');
    const { parseConfig } = await import('../../src/config');
    const cfg = parseConfig({
      PUBLIC_ORIGIN: 'http://localhost:3000',
      DATABASE_APP_URL: 'x',
      DATABASE_OWNER_URL: 'x',
      DATABASE_ADMIN_URL: 'x',
      TEMPORAL_ADDRESS: 'x',
      TEMPORAL_NAMESPACE: 'x',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      RUNNER_IMAGE: 'x',
      FAKE_STATE_DIR: dir,
      ENABLE_FAKE_PROVIDER: 'true',
      FAKE_WEBHOOK_SECRET: 'cfg-secret',
    });
    const board = createAdapterRegistry(cfg, clock).board('fake');
    const body = JSON.stringify({
      deliveryId: 'd',
      commentId: 'c',
      repoPath: 'dev/demo',
      ticketRef: '1',
      body: 'x',
      author: 'a',
      authorAssociation: 'OWNER',
    });
    const sig = createHmac('sha256', 'cfg-secret').update(body).digest('hex');
    expect(await board.verifyAndParseWebhook({ 'x-fake-signature': sig }, body, async () => undefined)).toMatchObject({
      deliveryId: 'd',
    });
  });
});

describe('fake install external id', () => {
  it('is org-specific so two orgs can both install', async () => {
    const { FakeCodeHostAdapter } = await import('../../src/adapters/fake/codehost');
    const { FakeStore } = await import('../../src/adapters/fake/store');
    const { systemClock } = await import('../../src/clock');
    const host = new FakeCodeHostAdapter(new FakeStore('/tmp/unused-fake-state', systemClock), systemClock, 'http://x');
    const a = await host.completeInstall({}, { userId: 'u', orgId: 'org-a', linkedAccountToken: null });
    const b = await host.completeInstall({}, { userId: 'u', orgId: 'org-b', linkedAccountToken: null });
    expect(a.externalId).toBe('fake-org-a');
    expect(b.externalId).toBe('fake-org-b');
    expect(await host.listInstallations({ userId: 'u', orgId: 'org-a', linkedAccountToken: null })).toEqual([]);
  });
});
