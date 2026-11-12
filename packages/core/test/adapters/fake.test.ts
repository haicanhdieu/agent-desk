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
    const board = new FakeBoardAdapter(new FakeStore(dir, clock), clock);
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
  });
});
