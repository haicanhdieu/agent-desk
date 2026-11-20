import type { RunStatsDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { ids } from '../dto/ids';
import { mockDb } from './db';
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
