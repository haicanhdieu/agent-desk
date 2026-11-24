import {
  FINAL_RUN_STATUSES,
  type EnvEntryDto,
  RunStatus,
  type IgnoredEventDto,
  type RuleDto,
  type RunDto,
  type SkillDto,
} from '@agentdesk/contracts';
import { http, type RequestHandler } from 'msw';
import { z } from 'zod';
import { ids } from '../dto/ids';
import type { MockRun } from '../dto/runs';
import { mockDb, type ProjectRow } from './db';
import { flatRoutes, problemResponse } from './http';

// Mock mode only: the mocked e2e specs seed the list sizes they need (e2e/mock/mock.ts `seedLists`) under this key
// before the first load, and browser.ts applies them when the worker starts. Every row is generated from its position,
// so the same value always gives the same lists.

export const MOCK_LISTS_KEY = 'agentdesk.mock.lists';

const count = z.number().int().min(0);

export const MockLists = z.object({
  runs: z
    .object({
      total: count,
      /** The newest runs take these statuses, in this key order; the rest succeeded. */
      statuses: z.partialRecord(RunStatus, count).optional(),
      /** The newest N runs were queued today (local time); the rest on earlier days. */
      today: count.optional(),
      /** Runs per ticket, in consecutive chunks from the newest (default 1). */
      ticketSize: z.number().int().min(1).optional(),
    })
    .optional(),
  /**
   * Explicit runs, oldest first, numbered 1..n and queued before every generated run (which shift to n+1..).
   * Issues carry label user-story; PR refs are `pr-<n>`; `linked` (PR entries only) becomes linkedIssueRefs.
   */
  ticketRuns: z
    .array(
      z.object({
        kind: z.enum(['issue', 'pr']),
        number: z.number().int().min(1),
        linked: z.array(z.number().int().min(1)).max(10).optional(),
        status: RunStatus.optional(),
      }),
    )
    .optional(),
  /** Idle runs added on top of `runs`, newer than all of them. */
  needsYou: count.optional(),
  ignored: count.optional(),
  /** Alice's projects in all; invoicer-api always stays the first, so at least 1. */
  projects: z.number().int().min(1).optional(),
  /** A count (generated commands), or the exact commands in creation order. */
  rules: z.union([count, z.array(z.string().min(1))]).optional(),
  /** A count (generated names), or the exact names. */
  skills: z.union([count, z.array(z.string().min(1))]).optional(),
  versions: count.optional(),
  /** Replaces invoicer-api's environment entries with generated ones: VAR_001.. variables and SEC_001.. secrets. */
  env: z.object({ variables: count, secrets: count }).optional(),
  /** Holds the answer of a route back for `ms` (then the route answers as usual). `page`/`pageSize` narrow it. */
  hold: z
    .array(
      z.object({
        route: z.string(),
        page: z.number().int().optional(),
        pageSize: z.number().int().optional(),
        ms: z.number().int(),
      }),
    )
    .optional(),
  /** The route answers 500 "Internal server error" with a request ID, `times` requests (omitted = always). */
  fail: z.array(z.object({ route: z.string(), times: z.number().int().optional() })).optional(),
});
export type MockLists = z.infer<typeof MockLists>;

/** The lists in a stored value; undefined for a missing, unparsable or wrongly shaped one. */
export function parseMockLists(raw: string | null): MockLists | undefined {
  if (raw === null) return undefined;
  try {
    const parsed = MockLists.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const pad12 = (n: number) => String(n).padStart(12, '0');
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

interface RunSpec {
  number: number;
  status: RunStatus;
  ticketNumber: number;
  queuedAt: number;
}

function runOf(spec: RunSpec): RunDto {
  const { number, status, ticketNumber } = spec;
  const queuedAt = new Date(spec.queuedAt).toISOString();
  const queued = status === 'queued';
  const final = (FINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);
  return {
    id: `d1000000-0000-4000-8000-${pad12(number)}`,
    number,
    projectId: ids.project.invoicerApi,
    ruleId: null,
    command: 'code-build',
    ruleKind: 'skill',
    skillName: 'code-build',
    prompt: null,
    finalPrompt: null,
    agent: { name: 'Claude', model: 'opus' },
    ticket: {
      ref: String(ticketNumber),
      kind: 'issue',
      number: ticketNumber,
      title: `Ticket ${ticketNumber}: add a health check endpoint`,
      url: `https://github.com/harbor-labs/invoicer-api/issues/${ticketNumber}`,
      labels: [],
    },
    args: null,
    status,
    triggerSource: 'webhook',
    triggeredBy: 'kim-hale',
    ownerUserId: null,
    queuedAt,
    startedAt: queued ? null : queuedAt,
    finishedAt: final ? new Date(spec.queuedAt + 6 * minute).toISOString() : null,
    exitCode: final ? (status === 'succeeded' ? 0 : 1) : null,
    failureReason: status === 'failed' ? 'API authentication failed (401)' : null,
    failureStage: null,
    setupScriptVersion: null,
    costUsd: final ? 1.2 : null,
    timeoutSeconds: 1800,
    idleEndSeconds: 1800,
    pausedKeepSeconds: 604800,
    idleSince: status === 'idle' ? new Date(spec.queuedAt + 8 * minute).toISOString() : null,
    waitingOn: null,
    agentNote: null,
    pausedAt: null,
    sessionExpiresAt: null,
    sessionEndingAt: null,
    pauseReason: null,
    reopenedAt: null,
  };
}

function generateRuns(lists: NonNullable<MockLists['runs']>, needsYou: number, offset: number): RunDto[] {
  const { total, ticketSize = 1, today = 0 } = lists;
  const taken = Object.entries(lists.statuses ?? {}).flatMap(([status, n]) => {
    const parsed = RunStatus.safeParse(status);
    return parsed.success ? Array<RunStatus>(n).fill(parsed.data) : [];
  });
  const midnight = startOfToday();
  const specs: RunSpec[] = [];
  for (let j = 0; j < needsYou; j++) {
    // Idle runs sit on earlier days so they never count towards "today".
    specs.push({
      number: offset + total + needsYou - j,
      status: 'idle',
      ticketNumber: 5000 + j,
      queuedAt: midnight - day - j * minute,
    });
  }
  for (let i = 0; i < total; i++) {
    specs.push({
      number: offset + total - i,
      status: taken[i] ?? 'succeeded',
      ticketNumber: 100 + Math.floor(i / ticketSize),
      queuedAt: i < today ? midnight + (today - i) * 1000 : midnight - (i - today + 1) * hour,
    });
  }
  return specs.map(runOf);
}

function generateProjects(total: number, base: ProjectRow): ProjectRow[] {
  return Array.from({ length: total - 1 }, (_, i): ProjectRow => {
    const n = i + 2;
    const name = `project-${String(n).padStart(2, '0')}`;
    return {
      ...base,
      id: `a1000000-0000-4000-8000-${pad12(n)}`,
      name,
      repoPath: `harbor-labs/${name}`,
      createdAt: new Date(Date.parse(base.createdAt) + n * minute).toISOString(),
    };
  });
}

function generateIgnored(total: number): IgnoredEventDto[] {
  // Newest first, as the list shows them.
  return Array.from({ length: total }, (_, i): IgnoredEventDto => {
    const n = total - i;
    return {
      id: ids.ignored(n),
      receivedAt: new Date(Date.parse('2026-11-12T14:16:00.000Z') - i * minute).toISOString(),
      ticketRef: String(100 + n),
      ticketKind: n % 2 === 0 ? 'pr' : 'issue',
      command: 'code-build',
      author: 'octo-visitor',
      outcome: 'ignored_unauthorized',
      detail: 'octo-visitor is not a collaborator on the repo.',
    };
  });
}

const two = (n: number) => String(n).padStart(2, '0');

function generateRules(spec: number | string[]): RuleDto[] {
  const total = typeof spec === 'number' ? spec : spec.length;
  return Array.from({ length: total }, (_, i): RuleDto => {
    const n = i + 1;
    return {
      id: `e1000000-0000-4000-8000-${pad12(n)}`,
      projectId: ids.project.invoicerApi,
      command: Array.isArray(spec) ? (spec[i] ?? `code-task-${two(n)}`) : `code-task-${two(n)}`,
      labelFilter: [],
      target: n % 2 === 0 ? 'pr' : 'issue',
      agentId: ids.agent.invoicerApi,
      model: null,
      kind: 'skill',
      skillName: `skill-${two(n)}`,
      prompt: null,
      enabled: n % 3 !== 0,
      stats: { runs30d: n, lastRunAt: null },
    };
  });
}

function generateSkills(spec: number | string[]): SkillDto[] {
  const total = typeof spec === 'number' ? spec : spec.length;
  return Array.from({ length: total }, (_, i): SkillDto => {
    const name = (Array.isArray(spec) ? spec[i] : undefined) ?? `skill-${two(i + 1)}`;
    return {
      name,
      description: `Does task ${i + 1} end to end.`,
      path: `.claude/skills/${name}/SKILL.md`,
      lastCommit: { sha: 'a91c3e2', message: 'Add agent skills', at: '2026-11-10T14:00:00.000Z' },
      body: `---\nname: ${name}\ndescription: Does task ${i + 1} end to end.\n---\n\n# Task ${i + 1}\n`,
      sha: `a91c3e2-${name}`,
    };
  });
}

type TicketRunEntry = NonNullable<MockLists['ticketRuns']>[number];

/** The explicit runs, oldest first, numbered 1..n and queued before `generated`. */
function ticketRunsOf(entries: readonly TicketRunEntry[], generated: readonly RunDto[]): MockRun[] {
  const first = Math.min(startOfToday(), ...generated.map((r) => Date.parse(r.queuedAt))) - hour;
  return entries.map((entry, i): MockRun => {
    const { kind, number } = entry;
    const run = runOf({
      number: i + 1,
      status: entry.status ?? 'succeeded',
      ticketNumber: number,
      queuedAt: first - (entries.length - i) * minute,
    });
    const isPr = kind === 'pr';
    return {
      ...run,
      ticket: {
        ref: isPr ? `pr-${number}` : String(number),
        kind,
        number,
        title: `${isPr ? 'PR' : 'Issue'} ${number}: add a health check endpoint`,
        url: `https://github.com/harbor-labs/invoicer-api/${isPr ? 'pull' : 'issues'}/${number}`,
        labels: isPr ? [] : [{ name: 'user-story', color: '0e8a16' }],
      },
      ...(isPr && entry.linked ? { linkedIssueRefs: entry.linked.map(String) } : {}),
    };
  });
}

/** `variables` plain and `secrets` secret entries named VAR_001.., SEC_001.., ascending (the byte order of the list). */
function generateEnv(counts: { variables: number; secrets: number }): EnvEntryDto[] {
  const entry = (kind: EnvEntryDto['kind'], i: number): EnvEntryDto => {
    const n = String(i + 1).padStart(3, '0');
    return {
      name: `${kind === 'plain' ? 'VAR' : 'SEC'}_${n}`,
      kind,
      value: kind === 'plain' ? `value-${n}` : null,
      updatedAt: new Date(Date.parse('2026-11-12T10:00:00.000Z') + i * minute).toISOString(),
      updatedBy: 'kim-hale',
    };
  };
  return [
    ...Array.from({ length: counts.variables }, (_, i) => entry('plain', i)),
    ...Array.from({ length: counts.secrets }, (_, i) => entry('secret', i)),
  ];
}

/** Replaces the invoicer-api lists (and alice's projects) with generated rows; deterministic. */
export function applyMockLists(lists: MockLists): void {
  const state = mockDb.state;
  const projectId = ids.project.invoicerApi;
  if (lists.runs !== undefined || lists.needsYou !== undefined || lists.ticketRuns !== undefined) {
    const entries = lists.ticketRuns ?? [];
    const generated = generateRuns(lists.runs ?? { total: 0 }, lists.needsYou ?? 0, entries.length);
    const runs = [...ticketRunsOf(entries, generated), ...generated];
    const old = new Set(state.runs.filter((r) => r.projectId === projectId).map((r) => r.id));
    for (const id of old) delete state.runEvents[id];
    state.runs = [...state.runs.filter((r) => r.projectId !== projectId), ...runs];
  }
  if (lists.projects !== undefined) {
    const base = state.projects.find((p) => p.id === projectId);
    if (!base) throw new Error('invoicer-api fixture missing');
    state.projects = [
      ...state.projects.filter((p) => p.orgId !== ids.org.alice),
      base,
      ...generateProjects(lists.projects, base),
    ];
  }
  if (lists.ignored !== undefined) state.ignored[projectId] = generateIgnored(lists.ignored);
  if (lists.rules !== undefined) {
    state.rules = [...state.rules.filter((r) => r.projectId !== projectId), ...generateRules(lists.rules)];
  }
  if (lists.skills !== undefined) state.skills[projectId] = generateSkills(lists.skills);
  if (lists.env !== undefined) state.environment[projectId] = generateEnv(lists.env);
  if (lists.versions !== undefined) {
    const total = lists.versions;
    state.setupScripts[projectId] = Array.from({ length: total }, (_, i) => ({
      version: i + 1,
      body: `echo "setup version ${i + 1}"`,
      note: i === 0 ? null : `Change ${i + 1}`,
      createdBy: i % 2 === 0 ? 'kim-hale' : 'dana-ortiz',
      createdAt: new Date(Date.parse('2026-11-01T09:00:00.000Z') + i * hour).toISOString(),
    }));
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The query number, or the route's default when the request leaves it out. */
const queryNumber = (url: URL, name: string, fallback: number) => {
  const raw = url.searchParams.get(name);
  return raw === null ? fallback : Number(raw);
};

const holdMethod = { GET: 'get', POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete' } as const;

/** Handlers placed before the route handlers: hold = await ms, then fall through; fail = problem response. */
export function mockListHandlers(lists: MockLists): RequestHandler[] {
  const handlers: RequestHandler[] = [];
  for (const h of lists.hold ?? []) {
    const def = flatRoutes[h.route];
    if (def === undefined) continue;
    handlers.push(
      http[holdMethod[def.method]](def.path, async ({ request }) => {
        const url = new URL(request.url);
        if (h.page !== undefined && queryNumber(url, 'page', 1) !== h.page) return undefined;
        if (h.pageSize !== undefined && queryNumber(url, 'pageSize', 20) !== h.pageSize) return undefined;
        await wait(h.ms);
        return undefined;
      }),
    );
  }
  for (const f of lists.fail ?? []) {
    const def = flatRoutes[f.route];
    if (def?.method !== 'GET') continue;
    let failed = 0;
    handlers.push(
      http.get(def.path, () => {
        if (f.times !== undefined && failed >= f.times) return undefined;
        failed += 1;
        return problemResponse({ status: 500, title: 'Internal server error', type: 'internal' });
      }),
    );
  }
  return handlers;
}
