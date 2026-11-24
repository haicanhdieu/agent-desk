import type { RunStatsDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { ids } from '../dto/ids';
import { mockDb } from './db';
import { linkedTicketsFor } from './linkedTickets';
import { applyMockLists, MOCK_LISTS_KEY, mockListHandlers, parseMockLists, type MockLists } from './e2eLists';
import { server } from './node';

const projectId = ids.project.invoicerApi;
const api = (path: string) => `http://localhost:3000${path}`;
const runsPath = `/api/projects/${projectId}/runs`;
const invoicerRuns = () => mockDb.state.runs.filter((r) => r.projectId === projectId);

async function stats(): Promise<RunStatsDto> {
  const since = encodeURIComponent('2000-01-01T00:00:00.000Z');
  return (await fetch(api(`${runsPath}/stats?since=${since}`))).json() as Promise<RunStatsDto>;
}

describe('applyMockLists', () => {
  it('replaces the invoicer-api runs; the newest take the listed statuses and the stats add up', async () => {
    applyMockLists({ runs: { total: 63, statuses: { starting: 1, running: 1, paused: 1, queued: 1 } } });
    expect(invoicerRuns()).toHaveLength(63);
    expect(invoicerRuns().map((r) => r.number)).toContain(63);
    const s = await stats();
    expect(s.counts).toMatchObject({ needs_you: 1, active: 2, queued: 1, ended: 59, all: 63 });
  });

  it('keeps other projects and other orgs rows', () => {
    const before = mockDb.state.runs.filter((r) => r.projectId !== projectId).length;
    applyMockLists({ runs: { total: 5 } });
    expect(mockDb.state.runs.filter((r) => r.projectId !== projectId)).toHaveLength(before);
  });

  it('puts the newest N runs on today and the rest on earlier days', async () => {
    applyMockLists({ runs: { total: 30, today: 9, statuses: { failed: 1 } } });
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const res = (await (
      await fetch(api(`${runsPath}/stats?since=${encodeURIComponent(since.toISOString())}`))
    ).json()) as RunStatsDto;
    expect(res.today).toEqual({ total: 9, failed: 1 });
  });

  it('adds `needsYou` idle runs on top of the runs', async () => {
    applyMockLists({ runs: { total: 10 }, needsYou: 21 });
    const s = await stats();
    expect(s.counts.all).toBe(31);
    expect(s.counts.needs_you).toBe(21);
  });

  it('ticketSize 3 puts positions 19 to 21 (newest first) on one ticket', () => {
    applyMockLists({ runs: { total: 30, ticketSize: 3 } });
    const newestFirst = [...invoicerRuns()].sort((a, b) => b.number - a.number);
    const ref = (position: number) => newestFirst[position - 1]?.ticket.ref;
    expect(ref(19)).toBe(ref(20));
    expect(ref(20)).toBe(ref(21));
    expect(ref(18)).not.toBe(ref(19));
    expect(ref(22)).not.toBe(ref(21));
  });

  it('projects: 101 gives alice 101 projects and none for acme change', () => {
    const acme = mockDb.state.projects.filter((p) => p.orgId === ids.org.acme).length;
    applyMockLists({ projects: 101 });
    expect(mockDb.state.projects.filter((p) => p.orgId === ids.org.alice)).toHaveLength(101);
    expect(mockDb.state.projects.filter((p) => p.orgId === ids.org.acme)).toHaveLength(acme);
    expect(mockDb.state.projects.some((p) => p.id === projectId)).toBe(true);
  });

  it('generates ignored commands, rules, skills and setup versions for invoicer-api', () => {
    applyMockLists({ ignored: 27, rules: 24, skills: 22, versions: 23 });
    expect(mockDb.state.ignored[projectId]).toHaveLength(27);
    expect(mockDb.state.rules.filter((r) => r.projectId === projectId)).toHaveLength(24);
    expect(mockDb.state.skills[projectId]).toHaveLength(22);
    expect(mockDb.state.setupScripts[projectId]).toHaveLength(23);
    expect(mockDb.state.setupScripts[projectId]?.map((v) => v.version)).toEqual(
      Array.from({ length: 23 }, (_, i) => i + 1),
    );
  });

  it('skills and rules can be given by name: the lists hold exactly those names in that order', () => {
    applyMockLists({ skills: ['aa-1', 'code-build'], rules: ['code-task-a', 'code-build'] });
    expect(mockDb.state.skills[projectId]?.map((s) => s.name)).toEqual(['aa-1', 'code-build']);
    expect(mockDb.state.rules.filter((r) => r.projectId === projectId).map((r) => r.command)).toEqual([
      'code-task-a',
      'code-build',
    ]);
  });
});

describe('ticketRuns', () => {
  const byNumber = () => [...invoicerRuns()].sort((a, b) => a.number - b.number);
  const lead = (n: number) => {
    const run = byNumber().find((r) => r.ticket.kind === 'issue' && r.ticket.number === n);
    if (!run) throw new Error(`no issue ${n}`);
    return run;
  };
  const linksOf = (kind: 'issue' | 'pr', n: number) => {
    const run = [...byNumber()].reverse().find((r) => r.ticket.kind === kind && r.ticket.number === n);
    if (!run) throw new Error(`no ${kind} ${n}`);
    return linkedTicketsFor(run, invoicerRuns()).map((t) => `${t.kind}:${t.number}`);
  };

  it('ticketRuns are the oldest runs, numbered 1..n in order, and generated runs follow', () => {
    applyMockLists({
      runs: { total: 3 },
      ticketRuns: [
        { kind: 'issue', number: 7 },
        { kind: 'pr', number: 8, linked: [7] },
      ],
    });
    const runs = byNumber();
    expect(runs.map((r) => r.number)).toEqual([1, 2, 3, 4, 5]);
    expect(runs.slice(0, 2).map((r) => `${r.ticket.kind}:${r.ticket.number}`)).toEqual(['issue:7', 'pr:8']);
    const oldestGenerated = Math.min(...runs.slice(2).map((r) => Date.parse(r.queuedAt)));
    const newestTicketRun = Math.max(...runs.slice(0, 2).map((r) => Date.parse(r.queuedAt)));
    expect(newestTicketRun).toBeLessThan(oldestGenerated);
    expect(Date.parse(runs[0]?.queuedAt ?? '')).toBeLessThan(Date.parse(runs[1]?.queuedAt ?? ''));
  });

  it("a PR entry's linked becomes linkedIssueRefs; an issue entry never carries one", () => {
    applyMockLists({
      ticketRuns: [
        { kind: 'issue', number: 7 },
        { kind: 'pr', number: 8, linked: [7, 3] },
        { kind: 'pr', number: 9 },
      ],
    });
    const [issue, linked, plain] = byNumber();
    expect(issue).not.toHaveProperty('linkedIssueRefs');
    expect(linked?.linkedIssueRefs).toEqual(['7', '3']);
    expect(plain?.linkedIssueRefs ?? []).toEqual([]);
  });

  it('issue entries carry the user-story label and PR entries use ref pr-<n> and a pull url', () => {
    applyMockLists({
      ticketRuns: [
        { kind: 'issue', number: 7 },
        { kind: 'pr', number: 7, linked: [7] },
      ],
    });
    const [issue, pr] = byNumber();
    expect(issue?.ticket).toMatchObject({
      ref: '7',
      kind: 'issue',
      labels: [{ name: 'user-story', color: '0e8a16' }],
      url: expect.stringContaining('/issues/7'),
    });
    expect(pr?.ticket).toMatchObject({ ref: 'pr-7', kind: 'pr', number: 7, url: expect.stringContaining('/pull/7') });
  });

  it('ticketRuns alone replace the project runs, and a status can be set', () => {
    applyMockLists({ ticketRuns: [{ kind: 'issue', number: 7, status: 'failed' }] });
    expect(invoicerRuns()).toHaveLength(1);
    expect(invoicerRuns()[0]?.status).toBe('failed');
  });

  it('seeds the scenarios the e2e uses and they group as the API does', () => {
    const seed = (ticketRuns: NonNullable<MockLists['ticketRuns']>) => {
      const lists = { ticketRuns };
      expect(parseMockLists(JSON.stringify(lists))).toEqual(lists);
      applyMockLists(lists);
    };
    // A pair.
    seed([
      { kind: 'issue', number: 7 },
      { kind: 'pr', number: 8, linked: [7] },
    ]);
    expect(linksOf('issue', 7)).toEqual(['pr:8']);
    expect(linksOf('pr', 8)).toEqual(['issue:7']);
    // An issue with two PRs.
    seed([
      { kind: 'issue', number: 7 },
      { kind: 'pr', number: 9, linked: [7] },
      { kind: 'pr', number: 8, linked: [7] },
    ]);
    expect(linksOf('issue', 7)).toEqual(['pr:8', 'pr:9']);
    expect(linksOf('pr', 9)).toEqual(['issue:7', 'pr:8']);
    // A PR with two issues joins the lower one.
    seed([
      { kind: 'issue', number: 7 },
      { kind: 'issue', number: 3 },
      { kind: 'pr', number: 8, linked: [7, 3] },
    ]);
    expect(linksOf('pr', 8)).toEqual(['issue:3']);
    expect(linksOf('issue', 7)).toEqual([]);
    // A PR linked to an issue without runs.
    seed([{ kind: 'pr', number: 8, linked: [7] }]);
    expect(linksOf('pr', 8)).toEqual([]);
    // An issue with two PRs split across pages: 19 filler runs sit between PR 8 and PR 9 (20 runs per page).
    seed([
      { kind: 'issue', number: 7 },
      { kind: 'pr', number: 8, linked: [7] },
      ...Array.from({ length: 19 }, (_, i): { kind: 'issue'; number: number } => ({ kind: 'issue', number: 100 + i })),
      { kind: 'pr', number: 9, linked: [7] },
    ]);
    const pageOf = (kind: 'issue' | 'pr', n: number) => {
      const newestFirst = [...byNumber()].reverse();
      const at = newestFirst.findIndex((r) => r.ticket.kind === kind && r.ticket.number === n);
      return Math.floor(at / 20) + 1;
    };
    expect([pageOf('pr', 9), pageOf('pr', 8), pageOf('issue', 7)]).toEqual([1, 2, 2]);
    expect(linksOf('issue', 7)).toEqual(['pr:8', 'pr:9']);
    expect(linksOf('pr', 9)).toEqual(['issue:7', 'pr:8']);
    // A pair split across pages: the pair is the oldest, generated runs are newer.
    applyMockLists({
      runs: { total: 25 },
      ticketRuns: [
        { kind: 'issue', number: 7 },
        { kind: 'pr', number: 8, linked: [7] },
      ],
    });
    expect(lead(7).number).toBe(1);
    expect(linksOf('issue', 7)).toEqual(['pr:8']);
    // A PR with an old unlinked run and a new linked one.
    seed([
      { kind: 'issue', number: 7 },
      { kind: 'pr', number: 8 },
      { kind: 'pr', number: 8, linked: [7] },
    ]);
    const oldUnlinked = byNumber()[1];
    if (!oldUnlinked) throw new Error('no second run');
    expect(linkedTicketsFor(oldUnlinked, invoicerRuns())).toEqual([]);
    expect(linksOf('pr', 8)).toEqual(['issue:7']);
    expect(linksOf('issue', 7)).toEqual(['pr:8']);
  });
});

describe('mockListHandlers', () => {
  it('a hold for runs.list page 2 delays only page 2', async () => {
    const lists: MockLists = { runs: { total: 63 }, hold: [{ route: 'runs.list', page: 2, ms: 300 }] };
    applyMockLists(lists);
    server.use(...mockListHandlers(lists));
    const t1 = Date.now();
    await fetch(api(`${runsPath}?filter=all&page=1&pageSize=20`));
    expect(Date.now() - t1).toBeLessThan(250);
    const t2 = Date.now();
    const res = await fetch(api(`${runsPath}?filter=all&page=2&pageSize=20`));
    expect(Date.now() - t2).toBeGreaterThanOrEqual(290);
    expect(((await res.json()) as { page: number }).page).toBe(2);
  });

  it('a hold with pageSize matches only that size', async () => {
    const lists: MockLists = { runs: { total: 63 }, hold: [{ route: 'runs.list', pageSize: 50, ms: 300 }] };
    applyMockLists(lists);
    server.use(...mockListHandlers(lists));
    const t1 = Date.now();
    await fetch(api(`${runsPath}?filter=all&page=1&pageSize=20`));
    expect(Date.now() - t1).toBeLessThan(250);
    const t2 = Date.now();
    await fetch(api(`${runsPath}?filter=all&page=1&pageSize=50`));
    expect(Date.now() - t2).toBeGreaterThanOrEqual(290);
  });

  it('fail with times 3 answers 500 three times, then lets the handler answer', async () => {
    const lists: MockLists = { runs: { total: 5 }, fail: [{ route: 'runs.list', times: 3 }] };
    applyMockLists(lists);
    server.use(...mockListHandlers(lists));
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await fetch(api(`${runsPath}?filter=all&page=1&pageSize=20`))).status);
    expect(statuses).toEqual([500, 500, 500, 200]);
  });

  it('fail without times answers 500 every time with a request ID and the title', async () => {
    const lists: MockLists = { fail: [{ route: 'projects.list' }] };
    server.use(...mockListHandlers(lists));
    for (let i = 0; i < 2; i++) {
      const res = await fetch(api('/api/projects?page=1&pageSize=20'));
      expect(res.status).toBe(500);
      const body = (await res.json()) as { title: string; requestId: string };
      expect(body.title).toBe('Internal server error');
      expect(body.requestId).toMatch(/^req-mock-/);
    }
  });
});

describe('parseMockLists', () => {
  it('parses a valid value', () => {
    expect(parseMockLists(JSON.stringify({ projects: 26 }))).toEqual({ projects: 26 });
  });

  it('ignores invalid JSON, a wrong shape and a missing value', () => {
    expect(parseMockLists('{not json')).toBeUndefined();
    expect(parseMockLists(JSON.stringify({ projects: 'many' }))).toBeUndefined();
    expect(parseMockLists(null)).toBeUndefined();
  });

  it('uses a stable storage key', () => {
    expect(MOCK_LISTS_KEY).toBe('agentdesk.mock.lists');
  });
});

describe('applyMockLists env', () => {
  const entries = () => mockDb.state.environment[projectId] ?? [];
  const names = (kind: 'plain' | 'secret') =>
    entries()
      .filter((e) => e.kind === kind)
      .map((e) => e.name);

  it('seeds 23 variables and 22 secrets, deterministically, ordered by name', () => {
    applyMockLists({ env: { variables: 23, secrets: 22 } });
    expect(names('plain')).toHaveLength(23);
    expect(names('secret')).toHaveLength(22);
    expect(names('plain').slice(0, 2)).toEqual(['VAR_001', 'VAR_002']);
    expect(names('plain').at(-1)).toBe('VAR_023');
    expect(names('secret').at(-1)).toBe('SEC_022');
    expect(names('plain')).toEqual([...names('plain')].sort());
    const first = JSON.stringify(entries());
    applyMockLists({ env: { variables: 23, secrets: 22 } });
    expect(JSON.stringify(entries())).toBe(first);
  });

  it('seeded secrets carry no value and other projects keep their entries', () => {
    const other = structuredClone(mockDb.state.environment[ids.project.invoicerWeb]);
    applyMockLists({ env: { variables: 1, secrets: 2 } });
    expect(
      entries()
        .filter((e) => e.kind === 'secret')
        .every((e) => e.value === null),
    ).toBe(true);
    expect(mockDb.state.environment[ids.project.invoicerWeb]).toEqual(other);
  });

  it('serves the seeded rows through the list route in pages by name', async () => {
    applyMockLists({ env: { variables: 23, secrets: 22 } });
    const res = await fetch(api(`/api/projects/${projectId}/env?kind=plain&page=2&pageSize=20`));
    const body = (await res.json()) as { total: number; items: { name: string }[] };
    expect(body.total).toBe(23);
    expect(body.items.map((i) => i.name)).toEqual(['VAR_021', 'VAR_022', 'VAR_023']);
  });

  it('parses the env key', () => {
    expect(parseMockLists(JSON.stringify({ env: { variables: 23, secrets: 22 } }))).toEqual({
      env: { variables: 23, secrets: 22 },
    });
  });
});
