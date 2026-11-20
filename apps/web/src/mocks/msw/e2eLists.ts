import {
  FINAL_RUN_STATUSES,
  RunStatus,
  type IgnoredEventDto,
  type RuleDto,
  type RunDto,
  type SkillDto,
} from '@agentdesk/contracts';
import { http, type RequestHandler } from 'msw';
import { z } from 'zod';
import { ids } from '../dto/ids';
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
  /** Idle runs added on top of `runs`, newer than all of them. */
  needsYou: count.optional(),
  ignored: count.optional(),
  /** Alice's projects in all; invoicer-api always stays the first, so at least 1. */
  projects: z.number().int().min(1).optional(),
  rules: count.optional(),
  skills: count.optional(),
  versions: count.optional(),
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
    idleSince: status === 'idle' ? new Date(spec.queuedAt + 8 * minute).toISOString() : null,
    waitingOn: null,
    agentNote: null,
    pausedAt: null,
    sessionExpiresAt: null,
    sessionEndingAt: null,
    pauseReason: null,
  };
}

function generateRuns(lists: NonNullable<MockLists['runs']>, needsYou: number): RunDto[] {
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
      number: total + needsYou - j,
      status: 'idle',
      ticketNumber: 5000 + j,
      queuedAt: midnight - day - j * minute,
    });
  }
  for (let i = 0; i < total; i++) {
    specs.push({
      number: total - i,
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

function generateRules(total: number): RuleDto[] {
  return Array.from({ length: total }, (_, i): RuleDto => {
    const n = i + 1;
    return {
      id: `e1000000-0000-4000-8000-${pad12(n)}`,
      projectId: ids.project.invoicerApi,
      command: `code-task-${two(n)}`,
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

function generateSkills(total: number): SkillDto[] {
  return Array.from({ length: total }, (_, i): SkillDto => {
    const name = `skill-${two(i + 1)}`;
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

/** Replaces the invoicer-api lists (and alice's projects) with generated rows; deterministic. */
export function applyMockLists(lists: MockLists): void {
  const state = mockDb.state;
  const projectId = ids.project.invoicerApi;
  if (lists.runs !== undefined || lists.needsYou !== undefined) {
    const runs = generateRuns(lists.runs ?? { total: 0 }, lists.needsYou ?? 0);
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

/** Handlers placed before the route handlers: hold = await ms, then fall through; fail = problem response. */
export function mockListHandlers(lists: MockLists): RequestHandler[] {
  const handlers: RequestHandler[] = [];
  for (const h of lists.hold ?? []) {
    const def = flatRoutes[h.route];
    if (def?.method !== 'GET') continue;
    handlers.push(
      http.get(def.path, async ({ request }) => {
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
