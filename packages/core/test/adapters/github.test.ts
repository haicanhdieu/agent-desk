import { createHmac, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockAgent, fetch as undiciFetch } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubBoardAdapter } from '../../src/adapters/github/board';
import { GithubCodeHostAdapter } from '../../src/adapters/github/codehost';
import { GithubClients } from '../../src/adapters/github/app';
import { verifyGithubSignature } from '../../src/adapters/github/webhook';
import type { AdapterProject } from '../../src/adapters/types';

const fixture = (name: string): string => readFileSync(join(__dirname, '../fixtures/github', name), 'utf8');

const project: AdapterProject = { repoPath: 'acme/widgets', connectionExternalId: '4242', defaultBranch: 'main' };
const SECRET = 's3cret';
const sign = (body: string, secret = SECRET): string =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const clock = { now: () => new Date('2026-11-12T10:30:00Z') };

let agent: MockAgent;
let clients: GithubClients;
const gh = () => agent.get('https://api.github.com');
const JSON_HEADERS = { 'content-type': 'application/json' };

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  const fetchFn: typeof fetch = (input, init) =>
    undiciFetch(input as never, { ...(init as object), dispatcher: agent }) as never;
  clients = new GithubClients({ appId: '1', privateKey, fetch: fetchFn });
});
afterEach(async () => {
  await agent.close();
});

/** Intercepts the installation-token exchange the app auth performs before repo calls. */
function mockInstallationToken(): void {
  gh()
    .intercept({ path: '/app/installations/4242/access_tokens', method: 'POST' })
    .reply(201, fixture('installation.token.json'), { headers: JSON_HEADERS })
    .persist();
}

describe('github webhook', () => {
  const board = new GithubBoardAdapter(clients, clock);
  const raw = fixture('issue_comment.created.json');
  const lookup = async () => SECRET;

  it('parses a correctly signed issue_comment on a PR', async () => {
    const ev = await board.verifyAndParseWebhook(
      { 'x-hub-signature-256': sign(raw), 'x-github-delivery': 'del-1', 'x-github-event': 'issue_comment' },
      raw,
      lookup,
    );
    expect(ev).toEqual({
      provider: 'github',
      deliveryId: 'del-1',
      commentId: '1234567890',
      externalId: '4242',
      repoPath: 'acme/widgets',
      ticketRef: '7',
      ticketKind: 'pr',
      body: '/fix please look at the retry logic',
      author: 'octocat',
      authorAssociation: 'MEMBER',
      createdAt: '2026-11-12T10:15:00Z',
    });
  });

  it('marks plain issues as kind issue', async () => {
    const payload = JSON.parse(raw) as { issue: Record<string, unknown> };
    delete payload.issue.pull_request;
    const body = JSON.stringify(payload);
    const ev = await board.verifyAndParseWebhook(
      { 'x-hub-signature-256': sign(body), 'x-github-delivery': 'd', 'x-github-event': 'issue_comment' },
      body,
      lookup,
    );
    expect(ev).toMatchObject({ ticketKind: 'issue' });
  });

  it('rejects a wrong or malformed signature', async () => {
    const h = { 'x-github-delivery': 'd', 'x-github-event': 'issue_comment' };
    expect(await board.verifyAndParseWebhook({ ...h, 'x-hub-signature-256': sign(raw, 'nope') }, raw, lookup)).toBe(
      'bad_signature',
    );
    expect(await board.verifyAndParseWebhook({ ...h, 'x-hub-signature-256': 'sha256=abc' }, raw, lookup)).toBe(
      'bad_signature',
    );
    expect(await board.verifyAndParseWebhook(h, raw, lookup)).toBe('bad_signature');
    expect(
      await board.verifyAndParseWebhook({ ...h, 'x-hub-signature-256': sign(raw) }, raw, async () => undefined),
    ).toBe('bad_signature');
  });

  it('verifies the signature before parsing the body', async () => {
    expect(await board.verifyAndParseWebhook({ 'x-hub-signature-256': 'sha256=00' }, '{not json', lookup)).toBe(
      'bad_signature',
    );
  });

  it('ignores non-created actions and other events', async () => {
    const edited = raw.replace('"action": "created"', '"action": "edited"');
    expect(
      await board.verifyAndParseWebhook(
        { 'x-hub-signature-256': sign(edited), 'x-github-delivery': 'd', 'x-github-event': 'issue_comment' },
        edited,
        lookup,
      ),
    ).toBeNull();
    expect(
      await board.verifyAndParseWebhook(
        { 'x-hub-signature-256': sign(raw), 'x-github-delivery': 'd', 'x-github-event': 'ping' },
        raw,
        lookup,
      ),
    ).toBeNull();
  });

  it('verifyGithubSignature is false on length mismatch without throwing', () => {
    expect(verifyGithubSignature('x', 'sha256=ab', SECRET)).toBe(false);
    expect(verifyGithubSignature('x', sign('x'), SECRET)).toBe(true);
  });
});

describe('github pollEvents', () => {
  const board = () => new GithubBoardAdapter(clients, clock);
  /** Query-order-insensitive matcher for the comments poll request. */
  const path = (since: string) => (p: string) => {
    const u = new URL(p, 'https://api.github.com');
    return (
      u.pathname === '/repos/acme/widgets/issues/comments' &&
      u.searchParams.get('since') === since &&
      u.searchParams.get('sort') === 'updated' &&
      u.searchParams.get('per_page') === '100'
    );
  };
  const SINCE = '2026-11-12T10:00:00Z';

  it('sends If-None-Match and maps 304 to not_modified', async () => {
    mockInstallationToken();
    gh()
      .intercept({
        path: (p) => p.startsWith('/repos/acme/widgets/issues/comments'),
        method: 'GET',
        headers: { 'if-none-match': '"abc"' },
      })
      .reply(304, '');
    expect(await board().pollEvents(project, { since: SINCE, etag: '"abc"' })).toEqual({ kind: 'not_modified' });
  });

  it('skips comments created before since, advances since to max updated_at, clears the etag', async () => {
    mockInstallationToken();
    gh()
      .intercept({ path: path(SINCE), method: 'GET' })
      .reply(200, fixture('comments.list.json'), { headers: { ...JSON_HEADERS, etag: '"new"' } });
    const res = await board().pollEvents(project, { since: SINCE, etag: null });
    expect(res.kind).toBe('events');
    if (res.kind !== 'events') return;
    expect(res.events.map((e) => e.commentId)).toEqual(['1002', '1003']);
    expect(res.events[0]).toMatchObject({
      provider: 'github',
      externalId: '4242',
      ticketRef: '5',
      repoPath: 'acme/widgets',
      author: 'bob',
      authorAssociation: 'COLLABORATOR',
      createdAt: '2026-11-12T10:05:00Z',
    });
    expect(res.cursor).toEqual({ since: '2026-11-12T10:20:00Z', etag: null });
  });

  it('does not follow pagination links to other hosts', async () => {
    mockInstallationToken();
    gh()
      .intercept({ path: path(SINCE), method: 'GET' })
      .reply(200, fixture('comments.list.json'), {
        headers: { ...JSON_HEADERS, link: '<https://evil.example/steal?page=2>; rel="next"' },
      });
    const res = await board().pollEvents(project, { since: SINCE, etag: null });
    expect(res.kind).toBe('events'); // MockAgent has netConnect disabled: a follow would throw
  });

  it('keeps the response etag when no comments are new', async () => {
    mockInstallationToken();
    gh()
      .intercept({ path: path(SINCE), method: 'GET' })
      .reply(200, '[]', { headers: { ...JSON_HEADERS, etag: '"same"' } });
    expect(await board().pollEvents(project, { since: SINCE, etag: null })).toEqual({
      kind: 'events',
      events: [],
      cursor: { since: SINCE, etag: '"same"' },
    });
  });

  it('maps 401 to revoked (after the app auth layer exhausts its replication-delay retries)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      mockInstallationToken();
      gh()
        .intercept({ path: path(SINCE), method: 'GET' })
        .reply(401, '{"message":"Bad credentials"}', { headers: JSON_HEADERS })
        .persist();
      let result: unknown;
      const pending = board()
        .pollEvents(project, { since: SINCE, etag: null })
        .then((r) => (result = r));
      // Real I/O happens between the faked retry timers, so alternate: let I/O run, then move the clock.
      for (let i = 0; i < 100 && result === undefined; i++) {
        await new Promise((r) => setImmediate(r));
        await vi.advanceTimersByTimeAsync(1000);
      }
      await pending;
      expect(result).toEqual({ kind: 'revoked' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps rate limiting and 404', async () => {
    mockInstallationToken();
    const reset = Math.floor(Date.parse('2026-11-12T11:00:00Z') / 1000);
    gh()
      .intercept({ path: path(SINCE), method: 'GET' })
      .reply(403, '{"message":"rate limit"}', {
        headers: { ...JSON_HEADERS, 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      });
    expect(await board().pollEvents(project, { since: SINCE, etag: null })).toEqual({
      kind: 'rate_limited',
      resetAt: new Date('2026-11-12T11:00:00Z'),
    });
    gh()
      .intercept({ path: path(SINCE), method: 'GET' })
      .reply(404, '{"message":"Not Found"}', { headers: JSON_HEADERS });
    expect(await board().pollEvents(project, { since: SINCE, etag: null })).toEqual({ kind: 'revoked' });
  });
});

describe('github board tickets', () => {
  it('getTicket maps issues and PRs', async () => {
    mockInstallationToken();
    gh()
      .intercept({ path: '/repos/acme/widgets/issues/5', method: 'GET' })
      .reply(200, fixture('issue.json'), { headers: JSON_HEADERS });
    gh()
      .intercept({ path: '/repos/acme/widgets/issues/7', method: 'GET' })
      .reply(200, fixture('pull.json'), { headers: JSON_HEADERS });
    const board = new GithubBoardAdapter(clients, clock);
    expect(await board.getTicket(project, '5')).toEqual({
      ref: '5',
      kind: 'issue',
      number: 5,
      title: 'Build is red',
      url: 'https://github.com/acme/widgets/issues/5',
      labels: [
        { name: 'bug', color: 'd73a4a' },
        { name: 'ci', color: '0e8a16' },
      ],
    });
    expect((await board.getTicket(project, '7')).kind).toBe('pr');
  });

  it('comment posts and returns the comment id', async () => {
    mockInstallationToken();
    gh()
      .intercept({
        path: '/repos/acme/widgets/issues/5/comments',
        method: 'POST',
        body: (b) => JSON.parse(b).body === 'hello',
      })
      .reply(201, '{"id": 555}', { headers: JSON_HEADERS });
    expect(await new GithubBoardAdapter(clients, clock).comment(project, '5', 'hello')).toBe('555');
  });
});

describe('github code host', () => {
  const host = () =>
    new GithubCodeHostAdapter(clients, clock, {
      appSlug: 'agent-desk',
      botName: 'agentdesk[bot]',
      botEmail: 'bot@example.test',
    });

  it('checkoutRef and cloneUrl', () => {
    expect(host().checkoutRef({ kind: 'pr', number: 7 })).toBe('refs/pull/7/head');
    expect(host().checkoutRef({ kind: 'issue', number: 7, defaultBranch: 'trunk' })).toBe('trunk');
    expect(host().checkoutRef({ kind: 'issue', number: 7 })).toBe('main');
    expect(host().cloneUrl(project, 'tok')).toBe('https://x-access-token:tok@github.com/acme/widgets.git');
    expect(host().installUrl('org', 'st')).toBe('https://github.com/apps/agent-desk/installations/new?state=st');
  });

  it('refuses to interpolate unsafe repo paths or branch names', () => {
    expect(() => host().cloneUrl({ ...project, repoPath: 'acme/widgets@evil.com/x' }, 't')).toThrow();
    expect(() => host().cloneUrl({ ...project, repoPath: 'acme/../x' }, 't')).toThrow();
    expect(() => host().cloneUrl({ ...project, repoPath: 'a b/c' }, 't')).toThrow();
    expect(() => host().checkoutRef({ kind: 'issue', number: 1, defaultBranch: 'main; rm -rf /' })).toThrow();
    expect(() => host().checkoutRef({ kind: 'issue', number: 1, defaultBranch: '--upload-pack=x' })).toThrow();
    expect(() => host().checkoutRef({ kind: 'issue', number: 1, defaultBranch: 'a..b' })).toThrow();
    expect(host().checkoutRef({ kind: 'issue', number: 1, defaultBranch: 'release/1.2_x' })).toBe('release/1.2_x');
  });

  it('mints a repo-scoped installation token', async () => {
    gh()
      .intercept({
        path: '/app/installations/4242/access_tokens',
        method: 'POST',
        body: (b) => {
          const o = JSON.parse(b) as { repositories?: string[] };
          return JSON.stringify(o.repositories) === '["widgets"]';
        },
      })
      .reply(201, fixture('installation.token.json'), { headers: JSON_HEADERS });
    const tok = await host().mintWorkspaceToken(project);
    expect(tok.token).toMatch(/^ghs_/);
    expect(tok.expiresAt).toEqual(new Date('2026-11-12T11:00:00Z'));
  });

  it('lists repos of an installation', async () => {
    mockInstallationToken();
    gh()
      .intercept({ path: '/installation/repositories?per_page=100', method: 'GET' })
      .reply(200, fixture('installation.repos.json'), { headers: JSON_HEADERS });
    expect(await host().listRepos({ externalId: '4242' })).toEqual([
      { repoPath: 'acme/widgets', private: true, defaultBranch: 'main' },
      { repoPath: 'acme/docs', private: false, defaultBranch: 'trunk' },
    ]);
  });

  it('lists and reads skills from .claude/skills', async () => {
    mockInstallationToken();
    const base = '/repos/acme/widgets';
    gh()
      .intercept({ path: `${base}/contents/.claude/skills`, method: 'GET' })
      .reply(200, fixture('contents.skills-dir.json'), { headers: JSON_HEADERS });
    gh()
      .intercept({ path: `${base}/contents/.claude/skills/fix/SKILL.md`, method: 'GET' })
      .reply(200, fixture('contents.skill-file.json'), { headers: JSON_HEADERS })
      .persist();
    gh()
      .intercept({ path: (p) => p.startsWith(`${base}/commits`), method: 'GET' })
      .reply(200, fixture('commits.skill.json'), { headers: JSON_HEADERS })
      .persist();
    const list = await host().listSkills(project);
    expect(list).toEqual([
      {
        name: 'fix',
        description: 'Fix things',
        path: '.claude/skills/fix/SKILL.md',
        lastCommit: {
          sha: 'c0ffee0000000000000000000000000000000001',
          message: 'Add fix skill',
          at: '2026-11-10T08:00:00Z',
        },
      },
    ]);
    const skill = await host().readSkill(project, 'fix');
    expect(skill.body).toBe('---\nname: fix\ndescription: Fix things\n---\nBody\n');
    expect(skill.sha).toBe('3d21ec53a331a6f037a91c368710b99387d012c1');
  });

  it('writes a skill with sha and committer identity', async () => {
    mockInstallationToken();
    gh()
      .intercept({
        path: '/repos/acme/widgets/contents/.claude/skills/fix/SKILL.md',
        method: 'PUT',
        body: (b) => {
          const o = JSON.parse(b) as { sha?: string; message: string; content: string; committer?: { name: string } };
          return (
            o.sha === 'old' &&
            o.message === 'edit' &&
            Buffer.from(o.content, 'base64').toString() === 'v2' &&
            o.committer?.name === 'agentdesk[bot]'
          );
        },
      })
      .reply(200, '{"content":{"sha":"new"},"commit":{"sha":"abc123"}}', { headers: JSON_HEADERS });
    expect(await host().writeSkill(project, 'fix', 'v2', 'edit', 'old')).toEqual({ commitSha: 'abc123' });
  });

  it('completeInstall requires the installation to be visible to the user linked account', async () => {
    gh()
      .intercept({
        path: (p) => p.startsWith('/user/installations'),
        method: 'GET',
        headers: { authorization: 'token utok' },
      })
      .reply(200, '{"total_count":1,"installations":[{"id":4242}]}', { headers: JSON_HEADERS })
      .persist();
    gh()
      .intercept({ path: '/app/installations/4242', method: 'GET' })
      .reply(200, '{"id":4242,"account":{"login":"acme"}}', { headers: JSON_HEADERS });
    expect(
      await host().completeInstall({ installation_id: '4242' }, { userId: 'u', linkedAccountToken: 'utok' }),
    ).toEqual({
      provider: 'github',
      externalId: '4242',
      accountName: 'acme',
      capabilities: { code: true, board: true },
    });
    await expect(
      host().completeInstall({ installation_id: '999' }, { userId: 'u', linkedAccountToken: 'utok' }),
    ).rejects.toThrow(/not accessible/);
    await expect(
      host().completeInstall({ installation_id: '4242' }, { userId: 'u', linkedAccountToken: null }),
    ).rejects.toThrow(/linked account/);
  });

  it('rejects invalid skill names before any request', async () => {
    await expect(host().readSkill(project, '../x')).rejects.toThrow();
  });
});
