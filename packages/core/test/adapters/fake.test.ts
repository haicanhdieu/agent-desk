import { createHmac } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeBoardAdapter } from '../../src/adapters/fake/board';
import { FakeCodeHostAdapter } from '../../src/adapters/fake/codehost';
import { FakeStore } from '../../src/adapters/fake/store';
import { SkillConflictError } from '../../src/adapters/types';
import type { AdapterProject } from '../../src/adapters/types';

const project: AdapterProject = { repoPath: 'dev/demo', connectionExternalId: 'fake' };
let t = Date.parse('2026-11-12T10:00:00Z');
const clock = { now: () => new Date((t += 1000)) };
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fake-store-'));
});

describe('fake board', () => {
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
    expect(res.events[0]).toMatchObject({ provider: 'fake', body: '/fix', ticketRef: '1', repoPath: 'dev/demo' });
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
    expect(tk).toMatchObject({ ref: '2', kind: 'pr', number: 2, title: 'P', labels: [{ name: 'x', color: 'fff' }] });
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
    expect(ok).toMatchObject({ provider: 'fake', deliveryId: 'd1', commentId: 'c1' });
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
  it('writeSkill then readSkill round-trips with a new sha; conflicts are detected', async () => {
    const host = new FakeCodeHostAdapter(new FakeStore(dir, clock), clock, 'http://localhost:3000');
    const w1 = await host.writeSkill(project, 'fix', '---\ndescription: Fixes\n---\nv1', 'add');
    const r1 = await host.readSkill(project, 'fix');
    expect(r1.body).toContain('v1');
    expect(r1.sha).toBe(w1.commitSha);
    expect(r1.description).toBe('Fixes');
    const w2 = await host.writeSkill(project, 'fix', 'v2', 'edit', r1.sha);
    expect(w2.commitSha).not.toBe(w1.commitSha);
    await expect(host.writeSkill(project, 'fix', 'v3', 'edit', r1.sha)).rejects.toBeInstanceOf(SkillConflictError);
    expect((await host.listSkills(project)).map((s) => s.name)).toEqual(['fix']);
    await host.deleteSkill(project, 'fix', 'rm');
    expect(await host.listSkills(project)).toEqual([]);
  });

  it('mirrors GitHub write semantics: sha required to update, stale sha conflicts, create needs no sha', async () => {
    const host = new FakeCodeHostAdapter(new FakeStore(dir, clock), clock, 'http://localhost:3000');
    const created = await host.writeSkill(project, 'fix', 'v1', 'add');
    await expect(host.writeSkill(project, 'fix', 'v2', 'edit')).rejects.toBeInstanceOf(SkillConflictError);
    await expect(host.writeSkill(project, 'fix', 'v2', 'edit', 'stale')).rejects.toBeInstanceOf(SkillConflictError);
    await expect(host.writeSkill(project, 'other', 'v2', 'edit', created.commitSha)).rejects.toBeInstanceOf(
      SkillConflictError,
    );
    await expect(host.writeSkill(project, 'fix', 'v2', 'edit', '')).rejects.toBeInstanceOf(SkillConflictError);
    expect((await host.writeSkill(project, 'fresh', 'v1', 'add', '')).commitSha).toBeTruthy();
    const updated = await host.writeSkill(project, 'fix', 'v2', 'edit', created.commitSha);
    expect(updated.commitSha).not.toBe(created.commitSha);
    expect((await host.readSkill(project, 'fix')).body).toBe('v2');
  });

  it('rejects path traversal in skill names', async () => {
    const host = new FakeCodeHostAdapter(new FakeStore(dir, clock), clock, 'http://localhost:3000');
    await expect(host.writeSkill(project, '../evil', 'x', 'm')).rejects.toThrow();
  });

  it('lists the default demo repo and mints a short-lived token', async () => {
    const host = new FakeCodeHostAdapter(new FakeStore(dir, clock), clock, 'http://localhost:3000');
    expect(await host.listRepos({ externalId: 'fake' })).toEqual([
      { repoPath: 'dev/demo', private: false, defaultBranch: 'main' },
    ]);
    const tok = await host.mintWorkspaceToken(project);
    expect(tok.expiresAt.getTime()).toBeGreaterThan(clock.now().getTime());
    expect(host.checkoutRef({ kind: 'pr', number: 7 })).toBe('refs/pull/7/head');
    expect(host.checkoutRef({ kind: 'issue', number: 7 })).toBe('main');
  });
});

describe('fake store paths', () => {
  it('rejects repoPath traversal segments', async () => {
    const store = new FakeStore(dir, clock);
    await expect(store.writeSkillFile('../evil', 'fix', 'x')).rejects.toThrow(/invalid path segment/);
    await expect(store.writeSkillFile('dev/../../evil', 'fix', 'x')).rejects.toThrow(/invalid path segment/);
    await expect(store.readSkillFile('dev/..', 'fix')).rejects.toThrow(/invalid path segment/);
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
  });
});
