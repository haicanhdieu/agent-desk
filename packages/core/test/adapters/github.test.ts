import { createHmac, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockAgent, fetch as undiciFetch } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOSING_ISSUES_QUERY,
  GithubBoardAdapter,
  closingRefsInBody,
  prStateOf,
  prStatesQuery,
} from '../../src/adapters/github/board';
import { normalizeLinkedRefs } from '../../src/adapters/linked-refs';
import { ProviderReauthRequiredError, ProviderUnavailableError } from '../../src/adapters/types';
import { GithubCodeHostAdapter } from '../../src/adapters/github/codehost';
import { GithubClients, assertSafeRef } from '../../src/adapters/github/app';
import { verifyGithubSignature } from '../../src/adapters/github/webhook';
import {
  RepoFileError,
  SkillBranchExistsError,
  SkillChangeRequestError,
  SkillNotFoundError,
  SkillConflictError,
  type AdapterProject,
} from '../../src/adapters/types';

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

// Captured before any test fakes timers, so a test can still wait in real time.
const realSetTimeout = globalThis.setTimeout;

let agent: MockAgent;
let fetchFn: typeof fetch;
let clients: GithubClients;
const gh = () => agent.get('https://api.github.com');
const JSON_HEADERS = { 'content-type': 'application/json' };

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  fetchFn = (input, init) => undiciFetch(input as never, { ...(init as object), dispatcher: agent }) as never;
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

/** Intercepts the existence check that finds the folder an edited skill lives in. */
function mockSkillFile(folder: string, name = 'fix'): void {
  gh()
    .intercept({ path: `/repos/acme/widgets/contents/${folder}/${name}/SKILL.md`, method: 'GET' })
    .reply(200, fixture('contents.skill-file.json'), { headers: JSON_HEADERS });
}

/** Intercepts the default-branch metadata read that decides between a direct commit and a change request. */
function mockBranch(isProtected: boolean, branch = 'main'): void {
  gh()
    .intercept({ path: `/repos/acme/widgets/branches/${branch}`, method: 'GET' })
    .reply(200, JSON.stringify({ name: branch, protected: isProtected, commit: { sha: 'basesha' } }), {
      headers: JSON_HEADERS,
    });
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
      authorId: '583231',
      authorAssociation: 'MEMBER',
      createdAt: '2026-11-12T10:15:00Z',
    });
  });

  it('a deleted comment author becomes ghost with no author id', async () => {
    const payload = JSON.parse(raw) as { comment: Record<string, unknown> };
    payload.comment.user = null;
    const body = JSON.stringify(payload);
    const ev = await board.verifyAndParseWebhook(
      { 'x-hub-signature-256': sign(body), 'x-github-delivery': 'd', 'x-github-event': 'issue_comment' },
      body,
      lookup,
    );
    expect(ev).toMatchObject({ author: 'ghost' });
    expect(ev).not.toHaveProperty('authorId');
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
      authorId: '12',
      authorAssociation: 'COLLABORATOR',
      createdAt: '2026-11-12T10:05:00Z',
    });
    expect(res.cursor).toEqual({ since: '2026-11-12T10:20:00Z', etag: null });
  });

  it('a polled comment from a deleted user is ghost with no author id', async () => {
    mockInstallationToken();
    const list = JSON.parse(fixture('comments.list.json')) as { user: unknown }[];
    for (const c of list) c.user = null;
    gh()
      .intercept({ path: path(SINCE), method: 'GET' })
      .reply(200, JSON.stringify(list), { headers: JSON_HEADERS });
    const res = await board().pollEvents(project, { since: SINCE, etag: null });
    if (res.kind !== 'events') throw new Error('expected events');
    expect(res.events[0]).toMatchObject({ author: 'ghost' });
    expect(res.events[0]).not.toHaveProperty('authorId');
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
      // A slow runner: every request takes real time, longer than a handful of event-loop turns.
      const slowClients = new GithubClients({
        appId: '1',
        privateKey,
        fetch: (input, init) => new Promise<void>((r) => realSetTimeout(r, 25)).then(() => fetchFn(input, init)),
      });
      let result: unknown;
      const pending = new GithubBoardAdapter(slowClients, clock)
        .pollEvents(project, { since: SINCE, etag: null })
        .then((r) => (result = r));
      // Real I/O happens between the faked retry timers: let it run, and move the clock only when a retry timer is
      // waiting. Bounded by real time, not by a loop count, so a slow runner cannot end the loop early.
      const deadline = performance.now() + 20_000;
      while (result === undefined) {
        if (performance.now() > deadline) throw new Error('pollEvents did not settle within 20 s of real time');
        await new Promise((r) => setImmediate(r));
        if (vi.getTimerCount() > 0) await vi.advanceTimersByTimeAsync(1000);
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
    gh().intercept({ path: '/graphql', method: 'POST' }).reply(200, gqlNodes([]), { headers: JSON_HEADERS });
    const graphql = vi.spyOn(clients.installation('4242'), 'graphql');
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
      linkedRefs: [],
    });
    expect(graphql).not.toHaveBeenCalled();
    expect((await board.getTicket(project, '7')).kind).toBe('pr');
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  const gqlNodes = (numbers: number[]): string =>
    JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              nodes: numbers.map((number) => ({ number, repository: { nameWithOwner: 'acme/widgets' } })),
            },
          },
        },
      },
    });

  function mockPull(file: string, body?: string, status = 200): void {
    mockInstallationToken();
    gh()
      .intercept({ path: '/repos/acme/widgets/issues/7', method: 'GET' })
      .reply(200, fixture(file), { headers: JSON_HEADERS });
    if (body !== undefined)
      gh().intercept({ path: '/graphql', method: 'POST' }).reply(status, body, { headers: JSON_HEADERS });
  }

  it("a PR's linkedRefs is the union of description keywords and closingIssuesReferences, same repo only", async () => {
    mockPull('pull.closes.json', fixture('graphql.pr-closing-issues.json'));
    const t = await new GithubBoardAdapter(clients, clock).getTicket(project, '7');
    expect(t.linkedRefs).toEqual(['5', '12', '21']);
  });

  it('the GraphQL request carries the PR number only in variables', async () => {
    mockInstallationToken();
    gh()
      .intercept({ path: '/repos/acme/widgets/issues/7', method: 'GET' })
      .reply(200, fixture('pull.json'), { headers: JSON_HEADERS });
    let captured: unknown;
    gh()
      .intercept({
        path: '/graphql',
        method: 'POST',
        body: (b) => {
          captured = JSON.parse(b);
          return true;
        },
      })
      .reply(200, gqlNodes([]), { headers: JSON_HEADERS });
    await new GithubBoardAdapter(clients, clock).getTicket(project, '7');
    expect(captured).toEqual({
      query: CLOSING_ISSUES_QUERY,
      variables: { owner: 'acme', repo: 'widgets', number: 7 },
    });
  });

  it('refs from closingIssuesReferences alone link a PR whose description names nothing', async () => {
    mockPull('pull.json', gqlNodes([5]));
    expect((await new GithubBoardAdapter(clients, clock).getTicket(project, '7')).linkedRefs).toEqual(['5']);
  });

  it('a GraphQL failure keeps the description refs, resolves, and logs the error name only', async () => {
    mockPull('pull.closes.json', '{"message":"Closes #77 bad gateway"}', 502);
    const log = { warn: vi.fn() };
    const t = await new GithubBoardAdapter(clients, clock, undefined, log).getTicket(project, '7');
    expect(t.linkedRefs).toEqual(['5', '12']);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith({ err: expect.any(String) }, 'ticket links unavailable');
    const logged = JSON.stringify(log.warn.mock.calls);
    expect(logged).not.toContain('Closes');
    expect(logged).not.toContain('flaky');
  });

  it('a GraphQL errors payload keeps the description refs and logs the error name', async () => {
    mockPull('pull.closes.json', '{"data":null,"errors":[{"type":"NOT_FOUND","message":"Closes #77"}]}');
    const log = { warn: vi.fn() };
    const t = await new GithubBoardAdapter(clients, clock, undefined, log).getTicket(project, '7');
    expect(t.linkedRefs).toEqual(['5', '12']);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith({ err: expect.any(String) }, 'ticket links unavailable');
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('Closes');
  });

  it('more than ten refs are capped at ten, lowest first', async () => {
    mockPull('pull.json', gqlNodes([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]));
    expect((await new GithubBoardAdapter(clients, clock).getTicket(project, '7')).linkedRefs).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
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

describe('github prStates', () => {
  const fixtures = JSON.parse(fixture('graphql.pr-states.json')) as { full: unknown; partial: unknown };
  const refs7 = ['1', '2', '3', '4', '5', '6', '7'];

  /** Intercepts one GraphQL call and captures its JSON body. */
  function mockGraphql(reply: unknown, status = 200, headers: Record<string, string> = {}) {
    const captured: { query?: string; variables?: Record<string, unknown> }[] = [];
    mockInstallationToken();
    gh()
      .intercept({ path: '/graphql', method: 'POST' })
      .reply(
        status,
        (opts) => {
          captured.push(JSON.parse(String(opts.body)));
          return JSON.stringify(reply);
        },
        { headers: { ...JSON_HEADERS, ...headers } },
      );
    return captured;
  }

  it('maps a merged PR to merged', async () => {
    mockGraphql({ data: { repository: { p0: { number: 148, state: 'MERGED', isDraft: false, merged: true } } } });
    const board = new GithubBoardAdapter(clients, clock);
    expect((await board.prStates(project, ['148'])).states).toEqual(new Map([['148', 'merged']]));
  });

  it.each([
    ['OPEN', false, false, 'open'],
    ['OPEN', true, false, 'draft'],
    ['MERGED', false, true, 'merged'],
    ['CLOSED', false, true, 'merged'],
    ['CLOSED', false, false, 'closed'],
    ['CLOSED', true, false, 'closed'],
    ['LOCKED', false, false, undefined],
  ])('prStateOf %s draft=%s merged=%s is %s', (state, isDraft, merged, expected) => {
    expect(prStateOf({ state, isDraft, merged })).toBe(expected);
  });

  it('one batched call maps the answer by number, whatever its order', async () => {
    const sent = mockGraphql(fixtures.full);
    const board = new GithubBoardAdapter(clients, clock);
    const out = (await board.prStates(project, refs7)).states;
    expect(Object.fromEntries(out)).toEqual({ 1: 'open', 2: 'draft', 3: 'merged', 4: 'closed', 5: 'closed' });
    expect(sent).toHaveLength(1);
  });

  it('the query text is the same for any numbers; owner, repo and numbers are variables only', async () => {
    const sentA = mockGraphql({ data: { repository: {} } });
    const board = new GithubBoardAdapter(clients, clock);
    await board.prStates(project, ['12', '15']);
    const sentB = mockGraphql({ data: { repository: {} } });
    await board.prStates(project, ['99', '100']);
    expect(sentA[0]?.query).toBe(sentB[0]?.query);
    expect(sentA[0]?.query).toBe(prStatesQuery(2));
    expect(sentA[0]?.variables).toEqual({ owner: 'acme', repo: 'widgets', n0: 12, n1: 15 });
    expect(sentB[0]?.variables).toEqual({ owner: 'acme', repo: 'widgets', n0: 99, n1: 100 });
    expect(sentA[0]?.query).not.toContain('acme');
    expect(sentA[0]?.query).not.toContain('12');
  });

  it('drops refs above the GraphQL Int max before building the query', async () => {
    const sent = mockGraphql({
      data: { repository: { p0: { number: 148, state: 'OPEN', isDraft: false, merged: false } } },
    });
    const board = new GithubBoardAdapter(clients, clock);
    const out = (await board.prStates(project, ['148', '3000000000', '2147483647'])).states;
    expect(Object.fromEntries(out)).toEqual({ 148: 'open' });
    expect(sent[0]?.variables).toEqual({ owner: 'acme', repo: 'widgets', n0: 148, n1: 2147483647 });
  });

  it('GraphQL errors with partial data colour what came back and warn with the error name only', async () => {
    mockGraphql(fixtures.partial);
    const warn = vi.fn();
    const board = new GithubBoardAdapter(clients, clock, undefined, { warn });
    const out = (await board.prStates(project, ['1', '2'])).states;
    expect(Object.fromEntries(out)).toEqual({ 1: 'open' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ err: expect.any(String) }, 'pr states partial');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Could not resolve');
  });

  it('lists as unresolved only the asked refs GitHub authoritatively does not have', async () => {
    mockGraphql(fixtures.full);
    const board = new GithubBoardAdapter(clients, clock);
    const res = await board.prStates(project, [...refs7, '3000000000']);
    expect([...res.unresolved].sort()).toEqual(['3000000000', '6', '7']);
  });

  it('a NOT_FOUND error in partial data makes that ref unresolved; any other error leaves it undecided', async () => {
    mockGraphql({
      data: { repository: { p0: { number: 1, state: 'OPEN', isDraft: false, merged: false }, p1: null, p2: null } },
      errors: [
        { type: 'NOT_FOUND', path: ['repository', 'p1'], message: 'x' },
        { type: 'RESOURCE_LIMITS_EXCEEDED', path: ['repository', 'p2'], message: 'y' },
      ],
    });
    const board = new GithubBoardAdapter(clients, clock);
    const res = await board.prStates(project, ['1', '2', '3']);
    expect(Object.fromEntries(res.states)).toEqual({ 1: 'open' });
    expect([...res.unresolved]).toEqual(['2']);
  });

  it('a partial answer whose errors cannot be attributed to a node leaves every missing ref undecided', async () => {
    mockGraphql({
      data: { repository: { p0: null } },
      errors: [{ type: 'NOT_FOUND', path: ['repository', 'p0'], message: 'x' }, { message: 'secondary rate limit' }],
    });
    const board = new GithubBoardAdapter(clients, clock);
    expect([...(await board.prStates(project, ['1'])).unresolved]).toEqual([]);
  });

  it('GraphQL errors without usable data reject', async () => {
    mockGraphql({ data: null, errors: [{ message: 'boom' }] });
    const board = new GithubBoardAdapter(clients, clock);
    await expect(board.prStates(project, ['1'])).rejects.toThrow();
  });

  it('an HTTP failure, a rate limit and a network error reject', async () => {
    const board = new GithubBoardAdapter(clients, clock);
    mockGraphql({ message: 'bad gateway' }, 502);
    await expect(board.prStates(project, ['1'])).rejects.toThrow();
    mockGraphql({ message: 'rate limited' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' });
    await expect(board.prStates(project, ['1'])).rejects.toThrow();
    gh().intercept({ path: '/graphql', method: 'POST' }).replyWithError(new Error('socket hang up'));
    await expect(board.prStates(project, ['1'])).rejects.toThrow();
  });

  it('no refs means no request', async () => {
    const board = new GithubBoardAdapter(clients, clock);
    // disableNetConnect makes any request throw, so an empty map proves none was made.
    expect((await board.prStates(project, [])).states).toEqual(new Map());
    expect((await board.prStates(project, ['0', '-1', '1.5', 'abc', '12345678901', '07'])).states).toEqual(new Map());
  });

  it('a node whose number was not asked is left out', async () => {
    mockGraphql({ data: { repository: { p0: { number: 9, state: 'OPEN', isDraft: false, merged: false } } } });
    const board = new GithubBoardAdapter(clients, clock);
    expect((await board.prStates(project, ['1'])).states).toEqual(new Map());
  });
});

describe('assertSafeRef', () => {
  it.each(['main', 'release+1', 'user@feature', 'release/1.2_x', 'a.b', 'feat/x-y'])('accepts %s', (ref) => {
    expect(assertSafeRef(ref)).toBe(ref);
  });
  it.each([
    '',
    '-x',
    '--upload-pack=x',
    '/x',
    'x/',
    'a//b',
    'a..b',
    'a@{1}',
    '@',
    'x.lock',
    'a b',
    'a\tb',
    'a\nb',
    'a;b',
    'a$(x)',
    'a`b`',
    'a|b',
    'a&b',
    "a'b",
    'a\\b',
    'a:b',
    'a~1',
    'a^b',
    'a?b',
    'a*b',
    'a[b',
  ])('rejects %j', (ref) => {
    expect(() => assertSafeRef(ref)).toThrow();
  });
});

describe('github code host', () => {
  const host = () =>
    new GithubCodeHostAdapter(clients, clock, {
      appSlug: 'agent-desk',
      botName: 'agentdesk[bot]',
      botEmail: 'bot@example.test',
    });

  it('checkoutRef and repoUrl', () => {
    expect(host().checkoutRef({ kind: 'pr', number: 7 })).toBe('refs/pull/7/head');
    expect(host().checkoutRef({ kind: 'issue', number: 7, defaultBranch: 'trunk' })).toBe('trunk');
    expect(host().checkoutRef({ kind: 'issue', number: 7 })).toBe('main');
    expect(host().repoUrl(project)).toBe('https://github.com/acme/widgets.git');
    expect(host().installUrl('org', 'st')).toBe('https://github.com/apps/agent-desk/installations/new?state=st');
  });

  it('repoUrl carries no credential; git sends the workspace token as the x-access-token user', () => {
    expect(host().repoUrl(project)).not.toMatch(/@/);
    expect(host().gitCredentialUsername()).toBe('x-access-token');
  });

  it('names GH_TOKEN as the env var the gh CLI reads its token from', () => {
    expect(host().cliTokenEnvName()).toBe('GH_TOKEN');
  });

  it('names the commit identity of a person with the GitHub noreply address', () => {
    expect(host().commitIdentity({ login: 'alice', externalId: '42' })).toEqual({
      name: 'alice',
      email: '42+alice@users.noreply.github.com',
    });
  });

  it.each([
    ['a shell separator', 'a;b', '42'],
    ['a flag-like login', '--x y', '42'],
    ['command substitution', '$(touch x)', '42'],
    ['a newline', 'alice\nmallory', '42'],
    ['a leading dash', '-alice', '42'],
    ['a non-numeric id', 'alice', '4 2;x'],
  ])('refuses a commit identity for %s', (_label, login, externalId) => {
    expect(host().commitIdentity({ login, externalId })).toBeNull();
  });

  it('accepts a bot login with the [bot] suffix', () => {
    expect(host().commitIdentity({ login: 'dependabot[bot]', externalId: '7' })).toEqual({
      name: 'dependabot[bot]',
      email: '7+dependabot[bot]@users.noreply.github.com',
    });
  });

  it('refuses to interpolate unsafe repo paths or branch names', () => {
    expect(() => host().repoUrl({ ...project, repoPath: 'acme/widgets@evil.com/x' })).toThrow();
    expect(() => host().repoUrl({ ...project, repoPath: 'acme/../x' })).toThrow();
    expect(() => host().repoUrl({ ...project, repoPath: 'a b/c' })).toThrow();
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

  it('lists and reads skills from .claude/skills (the default Claude project searches no other folder)', async () => {
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
    mockBranch(false);
    mockSkillFile('.claude/skills');
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
    expect(await host().writeSkill(project, 'fix', 'v2', 'edit', 'old')).toEqual({
      kind: 'commit',
      commitSha: 'abc123',
      targetBranch: 'main',
    });
  });

  it('deletes a skill and returns a commit result', async () => {
    mockInstallationToken();
    mockBranch(false);
    const path = '/repos/acme/widgets/contents/.claude/skills/fix/SKILL.md';
    gh().intercept({ path, method: 'GET' }).reply(200, fixture('contents.skill-file.json'), { headers: JSON_HEADERS });
    gh()
      .intercept({ path: (p) => p.startsWith('/repos/acme/widgets/commits'), method: 'GET' })
      .reply(200, fixture('commits.skill.json'), { headers: JSON_HEADERS });
    gh()
      .intercept({ path, method: 'DELETE' })
      .reply(200, '{"content":null,"commit":{"sha":"del456"}}', { headers: JSON_HEADERS });
    expect(await host().deleteSkill(project, 'fix', 'rm')).toEqual({
      kind: 'commit',
      commitSha: 'del456',
      targetBranch: 'main',
    });
  });

  describe('skill changes on a protected default branch', () => {
    const SKILL = '/repos/acme/widgets/contents/.claude/skills/fix/SKILL.md';
    const REFS = '/repos/acme/widgets/git/refs';
    const bodyOf = (b: unknown): Record<string, unknown> => JSON.parse(String(b)) as Record<string, unknown>;
    const BRANCH_RE = /^agent-desk\/skill-(create|update|delete)-fix-[a-z0-9]+$/;
    const mockRefCreate = (status = 201, message = 'Reference already exists') =>
      gh()
        .intercept({
          path: REFS,
          method: 'POST',
          body: (b) => {
            const o = bodyOf(b);
            return BRANCH_RE.test(String(o.ref).replace('refs/heads/', '')) && o.sha === 'basesha';
          },
        })
        .reply(status, status === 201 ? '{}' : JSON.stringify({ message }), { headers: JSON_HEADERS });
    const mockRefDelete = () =>
      gh()
        .intercept({ path: (p) => p.startsWith(REFS + '/heads/agent-desk/skill-'), method: 'DELETE' })
        .reply(204, '');
    const mockPr = (check: (o: Record<string, unknown>) => boolean, status = 201) =>
      gh()
        .intercept({ path: '/repos/acme/widgets/pulls', method: 'POST', body: (b) => check(bodyOf(b)) })
        .reply(
          status,
          status === 201 ? '{"number":12,"html_url":"https://github.com/acme/widgets/pull/12"}' : '{"message":"x"}',
          {
            headers: JSON_HEADERS,
          },
        );
    const mockExisting = () => {
      gh()
        .intercept({ path: SKILL, method: 'GET' })
        .reply(200, fixture('contents.skill-file.json'), { headers: JSON_HEADERS });
      gh()
        .intercept({ path: (p) => p.startsWith('/repos/acme/widgets/commits'), method: 'GET' })
        .reply(200, fixture('commits.skill.json'), { headers: JSON_HEADERS });
    };

    it('creates a branch from the default head, commits to it there, and opens a PR', async () => {
      mockInstallationToken();
      mockBranch(true);
      mockRefCreate();
      let branch = '';
      gh()
        .intercept({
          path: SKILL,
          method: 'PUT',
          body: (b) => {
            const o = bodyOf(b);
            branch = String(o.branch);
            return BRANCH_RE.test(branch) && o.message === 'add fix' && o.sha === undefined;
          },
        })
        .reply(201, '{"commit":{"sha":"c1"}}', { headers: JSON_HEADERS });
      mockPr(
        (o) =>
          o.title === 'Create skill: fix' &&
          o.head === branch &&
          o.base === 'main' &&
          String(o.body).includes('.claude/skills/fix/SKILL.md') &&
          String(o.body).includes('add fix'),
      );
      const r = await host().writeSkill(project, 'fix', 'v1', 'add fix');
      expect(r).toEqual({
        kind: 'change_request',
        sourceBranch: branch,
        targetBranch: 'main',
        url: 'https://github.com/acme/widgets/pull/12',
        id: '12',
      });
    });

    it('edits through a PR and passes the sha so a stale edit still conflicts', async () => {
      mockInstallationToken();
      mockBranch(true);
      mockRefCreate();
      mockSkillFile('.claude/skills');
      gh()
        .intercept({ path: SKILL, method: 'PUT', body: (b) => bodyOf(b).sha === 'old' })
        .reply(200, '{"commit":{"sha":"c1"}}', { headers: JSON_HEADERS });
      mockPr((o) => o.title === 'Update skill: fix');
      expect(await host().writeSkill(project, 'fix', 'v2', 'edit', 'old')).toMatchObject({ kind: 'change_request' });
    });

    it('deletes through a PR', async () => {
      mockInstallationToken();
      mockBranch(true);
      mockExisting();
      mockRefCreate();
      gh()
        .intercept({ path: SKILL, method: 'DELETE', body: (b) => BRANCH_RE.test(String(bodyOf(b).branch)) })
        .reply(200, '{"commit":{"sha":"c1"}}', { headers: JSON_HEADERS });
      mockPr((o) => o.title === 'Delete skill: fix');
      expect(await host().deleteSkill(project, 'fix', 'rm')).toMatchObject({ kind: 'change_request', id: '12' });
    });

    it('targets the configured default branch, not main', async () => {
      mockInstallationToken();
      mockBranch(true, 'trunk');
      mockRefCreate();
      gh().intercept({ path: SKILL, method: 'PUT' }).reply(201, '{"commit":{"sha":"c1"}}', { headers: JSON_HEADERS });
      mockPr((o) => o.base === 'trunk');
      expect(await host().writeSkill({ ...project, defaultBranch: 'trunk' }, 'fix', 'v1', 'm')).toMatchObject({
        targetBranch: 'trunk',
      });
    });

    it('a branch name collision is its own error, not a stale edit', async () => {
      mockInstallationToken();
      mockBranch(true);
      mockRefCreate(422);
      const err = await host()
        .writeSkill(project, 'fix', 'v1', 'm')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SkillBranchExistsError);
      expect(err).not.toBeInstanceOf(SkillConflictError);
    });

    it('another 422 on branch creation is a branch-creation error, not a stale edit', async () => {
      mockInstallationToken();
      mockBranch(true);
      mockRefCreate(422, 'Object does not exist');
      const err = await host()
        .writeSkill(project, 'fix', 'v1', 'm')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SkillChangeRequestError);
      expect(err).toMatchObject({ stage: 'branch' });
      expect(err).not.toBeInstanceOf(SkillConflictError);
    });

    it('a failed branch creation is a branch-creation error and writes nothing', async () => {
      mockInstallationToken();
      mockBranch(true);
      mockRefCreate(500);
      await expect(host().writeSkill(project, 'fix', 'v1', 'm')).rejects.toMatchObject({
        name: 'SkillChangeRequestError',
        stage: 'branch',
      });
    });

    it('a forbidden branch creation is reported as a permission failure', async () => {
      mockInstallationToken();
      mockBranch(true);
      mockRefCreate(403, 'Resource not accessible by integration');
      await expect(host().writeSkill(project, 'fix', 'v1', 'm')).rejects.toMatchObject({
        name: 'SkillChangeRequestError',
        stage: 'permission',
      });
    });

    it('a stale sha on the branch commit conflicts, deletes the new branch, and opens no PR', async () => {
      mockInstallationToken();
      mockBranch(true);
      mockRefCreate();
      mockSkillFile('.claude/skills');
      gh().intercept({ path: SKILL, method: 'PUT' }).reply(409, '{"message":"sha"}', { headers: JSON_HEADERS });
      mockRefDelete();
      await expect(host().writeSkill(project, 'fix', 'v2', 'm', 'old')).rejects.toBeInstanceOf(SkillConflictError);
      agent.assertNoPendingInterceptors();
    });

    it('a failed commit of another kind surfaces its error and cleans up the branch', async () => {
      mockInstallationToken();
      mockBranch(true);
      mockRefCreate();
      gh().intercept({ path: SKILL, method: 'PUT' }).reply(403, '{"message":"no"}', { headers: JSON_HEADERS });
      mockRefDelete();
      await expect(host().writeSkill(project, 'fix', 'v1', 'm')).rejects.toMatchObject({
        name: 'SkillChangeRequestError',
        stage: 'permission',
      });
      agent.assertNoPendingInterceptors();
    });

    it('a failed commit to the new branch is reported as a commit failure, not a change request one', async () => {
      mockInstallationToken();
      mockBranch(true);
      mockRefCreate();
      gh().intercept({ path: SKILL, method: 'PUT' }).reply(404, '{"message":"nope"}', { headers: JSON_HEADERS });
      mockRefDelete();
      await expect(host().writeSkill(project, 'fix', 'v1', 'm')).rejects.toMatchObject({
        name: 'SkillChangeRequestError',
        stage: 'commit',
      });
      agent.assertNoPendingInterceptors();
    });

    it('a failed PR creation surfaces and deletes the orphan branch', async () => {
      mockInstallationToken();
      mockBranch(true);
      mockRefCreate();
      gh().intercept({ path: SKILL, method: 'PUT' }).reply(201, '{"commit":{"sha":"c1"}}', { headers: JSON_HEADERS });
      mockPr(() => true, 500);
      mockRefDelete();
      await expect(host().writeSkill(project, 'fix', 'v1', 'm')).rejects.toMatchObject({
        name: 'SkillChangeRequestError',
        stage: 'change_request',
      });
      agent.assertNoPendingInterceptors();
    });

    it('an unrelated failure reading the branch is not turned into a PR', async () => {
      mockInstallationToken();
      gh()
        .intercept({ path: '/repos/acme/widgets/branches/main', method: 'GET' })
        .reply(403, '{"message":"forbidden"}', { headers: JSON_HEADERS });
      await expect(host().writeSkill(project, 'fix', 'v1', 'm')).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('completeInstall', () => {
    const user = { userId: 'u', linkedAccountToken: 'utok' };
    const AUTH = { authorization: 'token utok' };
    const reply = (path: (p: string) => boolean, status: number, body: string) =>
      gh().intercept({ path, method: 'GET', headers: AUTH }).reply(status, body, { headers: JSON_HEADERS });
    const mockAppInfo = (id: number, login: string) =>
      gh()
        .intercept({ path: `/app/installations/${id}`, method: 'GET' })
        .reply(200, `{"id":${id},"account":{"login":"${login}"}}`, { headers: JSON_HEADERS });
    const installs = (body: string) => {
      reply((p) => p === '/user', 200, '{"id":100,"login":"me"}');
      reply((p) => p.startsWith('/user/installations'), 200, `{"installations":[${body}]}`);
    };
    const inst = (id: number, login: string, type: string, accountId: number) =>
      `{"id":${id},"account":{"login":"${login}","type":"${type}","id":${accountId}}}`;
    const connection = (id: string, name: string) => ({
      provider: 'github',
      externalId: id,
      accountName: name,
      capabilities: { code: true, board: true },
      manageUrl: null,
    });

    it('links the user own account install', async () => {
      installs(inst(4242, 'me', 'User', 100));
      mockAppInfo(4242, 'me');
      expect(await host().completeInstall({ installation_id: '4242' }, user)).toEqual(connection('4242', 'me'));
    });

    it('rejects an id that is not in the user installations, and a missing linked account', async () => {
      installs(inst(4242, 'me', 'User', 100));
      await expect(host().completeInstall({ installation_id: '999' }, user)).rejects.toThrow(/not accessible/);
      await expect(
        host().completeInstall({ installation_id: '4242' }, { userId: 'u', linkedAccountToken: null }),
      ).rejects.toThrow(/linked account/);
    });

    it('rejects another user personal install that is only visible to the user', async () => {
      installs(inst(7, 'other', 'User', 200));
      await expect(host().completeInstall({ installation_id: '7' }, user)).rejects.toThrow(/not accessible/);
    });

    it('rejects an organization install where the user is only a member', async () => {
      installs(inst(8, 'victim', 'Organization', 400));
      reply(
        (p) => p.startsWith('/user/memberships/orgs'),
        200,
        '[{"role":"member","organization":{"login":"victim"}}]',
      );
      await expect(host().completeInstall({ installation_id: '8' }, user)).rejects.toThrow(/not accessible/);
    });

    it('links an organization install where the user is an admin', async () => {
      installs(inst(9, 'acme', 'Organization', 300));
      reply((p) => p.startsWith('/user/memberships/orgs'), 200, '[{"role":"admin","organization":{"login":"acme"}}]');
      mockAppInfo(9, 'acme');
      expect(await host().completeInstall({ installation_id: '9' }, user)).toEqual(connection('9', 'acme'));
    });

    it('finds the installation on a later page', async () => {
      reply((p) => p === '/user', 200, '{"id":100,"login":"me"}');
      const full = Array.from({ length: 100 }, (_, i) => inst(1000 + i, `x${i}`, 'User', 9000 + i)).join(',');
      reply((p) => p.startsWith('/user/installations') && p.includes('page=1'), 200, `{"installations":[${full}]}`);
      reply(
        (p) => p.startsWith('/user/installations') && p.includes('page=2'),
        200,
        `{"installations":[${inst(1, 'me', 'User', 100)}]}`,
      );
      mockAppInfo(1, 'me');
      expect(await host().completeInstall({ installation_id: '1' }, user)).toEqual(connection('1', 'me'));
    });
  });

  describe('listInstallations', () => {
    const user = { userId: 'u', linkedAccountToken: 'utok' };
    const AUTH = { authorization: 'token utok' };
    const reply = (path: (p: string) => boolean, status: number, body: string) =>
      gh().intercept({ path, method: 'GET', headers: AUTH }).reply(status, body, { headers: JSON_HEADERS });
    const conn = (id: string, name: string, manageUrl: string | null = null) => ({
      provider: 'github',
      externalId: id,
      accountName: name,
      capabilities: { code: true, board: true },
      manageUrl,
    });
    const inst = (id: number, login: string, type: string, accountId: number, htmlUrl?: string) =>
      `{"id":${id},${htmlUrl ? `"html_url":"${htmlUrl}",` : ''}"account":{"login":"${login}","type":"${type}","id":${accountId}}}`;

    it('carries the installation settings page of a personal and an organization install, and drops a non-https one', async () => {
      reply((p) => p === '/user', 200, '{"id":100,"login":"me"}');
      reply(
        (p) => p.startsWith('/user/installations'),
        200,
        `{"installations":[${inst(1, 'me', 'User', 100, 'https://github.com/settings/installations/1')},${inst(3, 'acme', 'Organization', 300, 'https://github.com/organizations/acme/settings/installations/3')},${inst(6, 'me', 'User', 100, 'javascript:alert(1)')}]}`,
      );
      reply((p) => p.startsWith('/user/memberships/orgs'), 200, '[{"role":"admin","organization":{"login":"acme"}}]');
      expect(await host().listInstallations(user)).toEqual([
        conn('1', 'me', 'https://github.com/settings/installations/1'),
        conn('3', 'acme', 'https://github.com/organizations/acme/settings/installations/3'),
        conn('6', 'me'),
      ]);
    });

    it('returns the own-account install and org installs the user administers, skipping the rest', async () => {
      reply((p) => p === '/user', 200, '{"id":100,"login":"me"}');
      reply(
        (p) => p.startsWith('/user/installations'),
        200,
        `{"total_count":5,"installations":[${inst(1, 'me', 'User', 100)},${inst(2, 'other', 'User', 200)},${inst(3, 'acme', 'Organization', 300)},${inst(4, 'victim', 'Organization', 400)},${inst(5, 'pending', 'Organization', 500)}]}`,
      );
      // One memberships call (a single interceptor) serves all org installs.
      reply(
        (p) => p.startsWith('/user/memberships/orgs'),
        200,
        '[{"role":"admin","organization":{"login":"acme"}},{"role":"member","organization":{"login":"victim"}}]',
      );
      expect(await host().listInstallations(user)).toEqual([conn('1', 'me'), conn('3', 'acme')]);
    });

    it('skips org installs when the membership list is forbidden', async () => {
      reply((p) => p === '/user', 200, '{"id":100,"login":"me"}');
      reply(
        (p) => p.startsWith('/user/installations'),
        200,
        `{"total_count":2,"installations":[${inst(3, 'acme', 'Organization', 300)},${inst(4, 'victim', 'Organization', 400)}]}`,
      );
      reply((p) => p.startsWith('/user/memberships/orgs'), 403, '{"message":"Forbidden"}');
      expect(await host().listInstallations(user)).toEqual([]);
    });

    it('reads a second page of installations', async () => {
      reply((p) => p === '/user', 200, '{"id":100,"login":"me"}');
      const full = Array.from({ length: 100 }, (_, i) => inst(1000 + i, `x${i}`, 'User', 9000 + i)).join(',');
      reply((p) => p.startsWith('/user/installations') && p.includes('page=1'), 200, `{"installations":[${full}]}`);
      reply(
        (p) => p.startsWith('/user/installations') && p.includes('page=2'),
        200,
        `{"installations":[${inst(1, 'me', 'User', 100)}]}`,
      );
      expect(await host().listInstallations(user)).toEqual([conn('1', 'me')]);
    });

    it('returns nothing without a linked account', async () => {
      expect(await host().listInstallations({ userId: 'u', linkedAccountToken: null })).toEqual([]);
    });
  });

  describe('a failing user token request becomes a provider-neutral error', () => {
    const user = { userId: 'u', linkedAccountToken: 'utok' };
    const AUTH = { authorization: 'token utok' };
    const fail = (path: (p: string) => boolean, status: number, headers: Record<string, string> = {}) =>
      gh()
        .intercept({ path, method: 'GET', headers: AUTH })
        .reply(status, '{"message":"upstream detail that must not leak"}', {
          headers: { ...JSON_HEADERS, ...headers },
        });
    const ok = (path: (p: string) => boolean, body: string) =>
      gh().intercept({ path, method: 'GET', headers: AUTH }).reply(200, body, { headers: JSON_HEADERS });
    const isUser = (p: string) => p === '/user';
    const isInstalls = (p: string) => p.startsWith('/user/installations');
    const RATE = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' };

    type Call = (u: typeof user) => Promise<unknown>;
    const calls: [string, Call][] = [
      ['listInstallations', (u) => host().listInstallations(u)],
      ['completeInstall', (u) => host().completeInstall({ installation_id: '1' }, u)],
    ];

    describe.each(calls)('%s', (_name, call) => {
      it('401 from GET /user is reauthorization required', async () => {
        fail(isUser, 401);
        await expect(call(user)).rejects.toBeInstanceOf(ProviderReauthRequiredError);
      });

      it('401 from GET /user/installations is reauthorization required', async () => {
        ok(isUser, '{"id":100}');
        fail(isInstalls, 401);
        await expect(call(user)).rejects.toBeInstanceOf(ProviderReauthRequiredError);
      });

      it('403 with rate limit headers, and 429, are a rate limited provider', async () => {
        fail(isUser, 403, RATE);
        await expect(call(user)).rejects.toMatchObject({ name: 'ProviderUnavailableError', rateLimited: true });
        ok(isUser, '{"id":100}');
        fail(isInstalls, 429);
        await expect(call(user)).rejects.toMatchObject({ name: 'ProviderUnavailableError', rateLimited: true });
      });

      it('a secondary rate limit (403 with retry-after) is a rate limited provider', async () => {
        fail(isUser, 403, { 'retry-after': '30' });
        await expect(call(user)).rejects.toMatchObject({ name: 'ProviderUnavailableError', rateLimited: true });
      });

      it('5xx is an unavailable provider and keeps only the upstream status', async () => {
        ok(isUser, '{"id":100}');
        fail(isInstalls, 502);
        const err: unknown = await call(user).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        expect(err).toMatchObject({ rateLimited: false, upstreamStatus: 502 });
        expect(JSON.stringify(err)).not.toContain('upstream detail');
        expect(String((err as Error).message)).not.toContain('upstream detail');
      });

      it('a network failure is an unavailable provider', async () => {
        gh().intercept({ path: isUser, method: 'GET', headers: AUTH }).replyWithError(new Error('socket hang up'));
        await expect(call(user)).rejects.toBeInstanceOf(ProviderUnavailableError);
      });

      it('any other status (a plain 403, 404) is left as it is', async () => {
        fail(isUser, 403);
        await expect(call(user)).rejects.toMatchObject({ status: 403 });
      });
    });
  });

  describe('readRepoFile', () => {
    const settingsPath = '/repos/acme/widgets/contents/.claude/settings.json';
    const onRef = (ref: string) => (p: string) => {
      const u = new URL(p, 'https://api.github.com');
      return u.pathname === settingsPath && u.searchParams.get('ref') === ref;
    };

    it('decodes base64 contents, reading at the default branch', async () => {
      mockInstallationToken();
      gh()
        .intercept({ path: onRef('main'), method: 'GET' })
        .reply(200, fixture('contents.settings-file.json'), { headers: JSON_HEADERS });
      expect(await host().readRepoFile(project, '.claude/settings.json')).toBe(
        '{\n  "enabledPlugins": {\n    "superpowers@claude-plugins-official": true\n  }\n}\n',
      );
    });

    it('reads at the project default branch when it is not main', async () => {
      mockInstallationToken();
      gh()
        .intercept({ path: onRef('develop'), method: 'GET' })
        .reply(200, fixture('contents.settings-file.json'), { headers: JSON_HEADERS });
      expect(await host().readRepoFile({ ...project, defaultBranch: 'develop' }, '.claude/settings.json')).toContain(
        'enabledPlugins',
      );
    });

    it('returns null on 404', async () => {
      mockInstallationToken();
      gh()
        .intercept({ path: onRef('main'), method: 'GET' })
        .reply(404, '{"message":"Not Found"}', { headers: JSON_HEADERS });
      expect(await host().readRepoFile(project, '.claude/settings.json')).toBeNull();
    });

    it('throws a typed error when the path is a directory', async () => {
      mockInstallationToken();
      gh()
        .intercept({ path: onRef('main'), method: 'GET' })
        .reply(200, fixture('contents.skills-dir.json'), { headers: JSON_HEADERS });
      await expect(host().readRepoFile(project, '.claude/settings.json')).rejects.toBeInstanceOf(RepoFileError);
    });

    it('throws a typed error when the content is not base64 (too large)', async () => {
      mockInstallationToken();
      const big = { ...(JSON.parse(fixture('contents.settings-file.json')) as object), content: '', encoding: 'none' };
      gh()
        .intercept({ path: onRef('main'), method: 'GET' })
        .reply(200, JSON.stringify(big), { headers: JSON_HEADERS });
      await expect(host().readRepoFile(project, '.claude/settings.json')).rejects.toBeInstanceOf(RepoFileError);
    });

    it('propagates other provider errors', async () => {
      mockInstallationToken();
      gh()
        .intercept({ path: onRef('main'), method: 'GET' })
        .reply(500, '{"message":"boom"}', { headers: JSON_HEADERS });
      await expect(host().readRepoFile(project, '.claude/settings.json')).rejects.toThrow();
    });

    it('rejects unsafe paths before any request', async () => {
      await expect(host().readRepoFile(project, '../etc/passwd')).rejects.toThrow();
      await expect(host().readRepoFile(project, '/abs')).rejects.toThrow();
    });
  });

  describe('skill folders', () => {
    const base = '/repos/acme/widgets/contents';
    const asCodex: AdapterProject = { ...project, skillFolders: ['.agents/skills'] };
    const asOpencode: AdapterProject = { ...project, skillFolders: ['.opencode/skills', '.agents/skills'] };
    // The adapter takes the folders it searches; this project has two, as OpenCode does with its own folder first.
    const twoFolders: AdapterProject = { ...project, skillFolders: ['.claude/skills', '.agents/skills'] };
    const bodyIn = (folder: string, name: string) => `---\ndescription: from ${folder}\n---\n${name}\n`;
    const file = (folder: string, name: string) =>
      JSON.stringify({
        name: 'SKILL.md',
        path: `${folder}/${name}/SKILL.md`,
        sha: `sha-${folder}`,
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(bodyIn(folder, name)).toString('base64'),
      });
    const dir = (folder: string, names: string[], type = 'dir') =>
      gh()
        .intercept({ path: `${base}/${folder}`, method: 'GET' })
        .reply(200, JSON.stringify(names.map((name) => ({ name, path: `${folder}/${name}`, type, sha: 'x' }))), {
          headers: JSON_HEADERS,
        });
    const missing = (path: string) =>
      gh()
        .intercept({ path: `${base}/${path}`, method: 'GET' })
        .reply(404, '{"message":"Not Found"}', { headers: JSON_HEADERS });
    const skillFile = (folder: string, name: string) =>
      gh()
        .intercept({ path: `${base}/${folder}/${name}/SKILL.md`, method: 'GET' })
        .reply(200, file(folder, name), { headers: JSON_HEADERS });
    const commits = () =>
      gh()
        .intercept({ path: (p) => p.startsWith('/repos/acme/widgets/commits'), method: 'GET' })
        .reply(200, fixture('commits.skill.json'), { headers: JSON_HEADERS })
        .persist();

    it('lists the default agent folder, then .agents/skills; a duplicate name keeps the agent folder and its path', async () => {
      mockInstallationToken();
      commits();
      dir('.claude/skills', ['fix', 'review']);
      dir('.agents/skills', ['fix', 'deploy']);
      skillFile('.claude/skills', 'fix');
      skillFile('.claude/skills', 'review');
      skillFile('.agents/skills', 'deploy');
      const list = await host().listSkills(twoFolders);
      expect(list.map((s) => [s.name, s.path, s.description])).toEqual([
        ['fix', '.claude/skills/fix/SKILL.md', 'from .claude/skills'],
        ['review', '.claude/skills/review/SKILL.md', 'from .claude/skills'],
        ['deploy', '.agents/skills/deploy/SKILL.md', 'from .agents/skills'],
      ]);
      agent.assertNoPendingInterceptors();
    });

    it('lists skills of a repo that only has .agents/skills (Codex, OpenCode, Cursor repos)', async () => {
      mockInstallationToken();
      commits();
      missing('.opencode/skills');
      dir('.agents/skills', ['fix']);
      skillFile('.agents/skills', 'fix');
      expect((await host().listSkills(asOpencode)).map((s) => s.path)).toEqual(['.agents/skills/fix/SKILL.md']);
    });

    it('searches only .agents/skills for a Codex project', async () => {
      mockInstallationToken();
      commits();
      dir('.agents/skills', ['fix']);
      skillFile('.agents/skills', 'fix');
      expect((await host().listSkills(asCodex)).map((s) => s.name)).toEqual(['fix']);
      agent.assertNoPendingInterceptors();
    });

    it('a repo with no skill folder lists nothing', async () => {
      mockInstallationToken();
      missing('.claude/skills');
      missing('.agents/skills');
      expect(await host().listSkills(twoFolders)).toEqual([]);
    });

    it('a folder that is a symlink (an object, not a list) is skipped instead of failing', async () => {
      mockInstallationToken();
      commits();
      gh()
        .intercept({ path: `${base}/.claude/skills`, method: 'GET' })
        .reply(
          200,
          JSON.stringify({ type: 'symlink', name: 'skills', path: '.claude/skills', target: '../.agent/skills' }),
          {
            headers: JSON_HEADERS,
          },
        );
      dir('.agents/skills', ['fix']);
      skillFile('.agents/skills', 'fix');
      expect((await host().listSkills(twoFolders)).map((s) => s.path)).toEqual(['.agents/skills/fix/SKILL.md']);
    });

    it('a directory without SKILL.md is not a skill, and does not hide the same name in the next folder', async () => {
      mockInstallationToken();
      commits();
      dir('.claude/skills', ['fix']);
      dir('.agents/skills', ['fix']);
      missing('.claude/skills/fix/SKILL.md');
      skillFile('.agents/skills', 'fix');
      expect((await host().listSkills(twoFolders)).map((s) => s.path)).toEqual(['.agents/skills/fix/SKILL.md']);
    });

    it('a SKILL.md that is itself a symlink is not a skill: skipped in the list, not found on read', async () => {
      mockInstallationToken();
      commits();
      dir('.claude/skills', ['fix']);
      dir('.agents/skills', ['fix']);
      gh()
        .intercept({ path: `${base}/.claude/skills/fix/SKILL.md`, method: 'GET' })
        .reply(
          200,
          JSON.stringify({ type: 'symlink', name: 'SKILL.md', path: '.claude/skills/fix/SKILL.md', target: 'x.md' }),
          { headers: JSON_HEADERS },
        );
      skillFile('.agents/skills', 'fix');
      expect((await host().listSkills(twoFolders)).map((s) => s.path)).toEqual(['.agents/skills/fix/SKILL.md']);

      mockInstallationToken();
      gh()
        .intercept({ path: `${base}/.claude/skills/fix/SKILL.md`, method: 'GET' })
        .reply(200, JSON.stringify({ type: 'symlink', name: 'SKILL.md', target: 'x.md' }), { headers: JSON_HEADERS });
      missing('.agents/skills/fix/SKILL.md');
      await expect(host().readSkill(twoFolders, 'fix')).rejects.toBeInstanceOf(SkillNotFoundError);
    });

    it('an edit writes to the folder the skill is listed from when the agent folder holds a symlinked SKILL.md', async () => {
      mockInstallationToken();
      mockBranch(false);
      gh()
        .intercept({ path: `${base}/.claude/skills/fix/SKILL.md`, method: 'GET' })
        .reply(
          200,
          JSON.stringify({ type: 'symlink', name: 'SKILL.md', target: '../../.agents/skills/fix/SKILL.md' }),
          { headers: JSON_HEADERS },
        );
      skillFile('.agents/skills', 'fix');
      gh()
        .intercept({
          path: `${base}/.agents/skills/fix/SKILL.md`,
          method: 'PUT',
          body: (b) => (JSON.parse(b) as { sha?: string }).sha === 'sha-.agents/skills',
        })
        .reply(200, '{"content":{"sha":"new"},"commit":{"sha":"e1"}}', { headers: JSON_HEADERS });
      expect(await host().writeSkill(twoFolders, 'fix', 'v2', 'edit', 'sha-.agents/skills')).toMatchObject({
        kind: 'commit',
        commitSha: 'e1',
      });
    });

    it('reads a skill from the first folder that has it', async () => {
      mockInstallationToken();
      commits();
      missing('.claude/skills/fix/SKILL.md');
      skillFile('.agents/skills', 'fix');
      const s = await host().readSkill(twoFolders, 'fix');
      expect(s.path).toBe('.agents/skills/fix/SKILL.md');
      expect(s.sha).toBe('sha-.agents/skills');
    });

    it('a skill in no folder is not found', async () => {
      mockInstallationToken();
      missing('.claude/skills/fix/SKILL.md');
      missing('.agents/skills/fix/SKILL.md');
      await expect(host().readSkill(twoFolders, 'fix')).rejects.toBeInstanceOf(SkillNotFoundError);
    });

    it('creates a new skill in the default agent folder', async () => {
      mockInstallationToken();
      mockBranch(false);
      gh()
        .intercept({ path: `${base}/.opencode/skills/fix/SKILL.md`, method: 'PUT' })
        .reply(201, '{"commit":{"sha":"c1"}}', { headers: JSON_HEADERS });
      expect(await host().writeSkill(asOpencode, 'fix', 'v1', 'add')).toMatchObject({
        kind: 'commit',
        commitSha: 'c1',
      });
    });

    it('edits a skill in the folder it lives in, not the default agent folder', async () => {
      mockInstallationToken();
      mockBranch(false);
      missing('.claude/skills/fix/SKILL.md');
      skillFile('.agents/skills', 'fix');
      gh()
        .intercept({
          path: `${base}/.agents/skills/fix/SKILL.md`,
          method: 'PUT',
          body: (b) => JSON.parse(b).sha === 'old',
        })
        .reply(200, '{"commit":{"sha":"c2"}}', { headers: JSON_HEADERS });
      expect(await host().writeSkill(twoFolders, 'fix', 'v2', 'edit', 'old')).toMatchObject({ commitSha: 'c2' });
    });

    it('deletes a skill from the folder it lives in', async () => {
      mockInstallationToken();
      mockBranch(false);
      commits();
      missing('.claude/skills/fix/SKILL.md');
      skillFile('.agents/skills', 'fix');
      gh()
        .intercept({ path: `${base}/.agents/skills/fix/SKILL.md`, method: 'DELETE' })
        .reply(200, '{"commit":{"sha":"d1"}}', { headers: JSON_HEADERS });
      expect(await host().deleteSkill(twoFolders, 'fix', 'rm')).toMatchObject({ commitSha: 'd1' });
    });
  });

  it('rejects invalid skill names before any request', async () => {
    await expect(host().readSkill(project, '../x')).rejects.toThrow();
  });
});

describe('closingRefsInBody', () => {
  it('reads case, colon and punctuation variants and needs a keyword per number', () => {
    expect(closingRefsInBody('CLOSES #142.\nfixes: #150, Resolved #9')).toEqual(['142', '150', '9']);
    expect(closingRefsInBody('Closes #142, #150')).toEqual(['142']);
    expect(closingRefsInBody('closes owner/repo#5 and see #7 and https://github.com/acme/widgets/issues/8')).toEqual(
      [],
    );
    expect(closingRefsInBody('<b>Fixes</b> #3 `closes #4` **resolves #5**')).toEqual(['4', '5']);
    expect(normalizeLinkedRefs(closingRefsInBody('Closes #0 fixes #-1 closes #00012'))).toEqual([]);
    expect(closingRefsInBody('x'.repeat(70_000) + ' Closes #1')).toEqual([]);
    expect(closingRefsInBody('Closes #142 '.repeat(5_000)).length).toBeGreaterThan(0);
  });
});
