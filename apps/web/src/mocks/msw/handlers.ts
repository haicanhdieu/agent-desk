import {
  ACTIVE_RUN_STATUSES,
  type RouteDef,
  FINAL_RUN_STATUSES,
  type ProjectConnectionDto,
  type ProjectDto,
  type RunDto,
  type RunListFilter,
  type RunStatus,
  type SetupScriptDto,
  type SetupTestDto,
  type SkillDto,
} from '@agentdesk/contracts';
import { http, type HttpHandler } from 'msw';
import { authHandlers } from './auth-handlers';
import { defaultTriggerState, mockDb, type MockUser, type ProjectRow } from './db';
import {
  Problem,
  conflict,
  fieldErrors,
  flatRoutes,
  invalid,
  jsonResponse,
  notFound,
  problemResponse,
  routeDef,
  routeHandler,
  type ResponseOf,
  type RouteCtx,
  type RouteKey,
} from './http';
import { appendRunEvent, setRunStatus } from './live';

// One handler per contracts route, implementing list/get/create/update/delete over the in-memory store. Every
// handler requires a session (401 otherwise), scopes reads to the active org (another org's record is a 404, as
// RLS hides it), validates params/query/body with the route's schemas (400 with JSON Pointers) and parses its
// response through the route's response schema.

const now = () => new Date().toISOString();
const isFinal = (s: RunStatus) => FINAL_RUN_STATUSES.some((f) => f === s);
const isActive = (s: RunStatus) => ACTIVE_RUN_STATUSES.some((a) => a === s);

function session(): { user: MockUser; orgId: string } {
  const user = mockDb.currentUser();
  if (!user) throw new Problem({ status: 401, title: 'Unauthorized', type: 'unauthorized' });
  const orgId = mockDb.auth.activeOrganizationId;
  if (!orgId) throw new Problem({ status: 403, title: 'No active organization', type: 'forbidden' });
  return { user, orgId };
}

const db = () => mockDb.state;

function projectRow(projectId: string): ProjectRow {
  const { orgId } = session();
  const row = db().projects.find((p) => p.id === projectId && p.orgId === orgId);
  if (!row) throw notFound('Project');
  return row;
}

function toProjectDto(row: ProjectRow): ProjectDto {
  const runs = db().runs.filter((r) => r.projectId === row.id);
  const lastRunAt = runs.reduce<string | null>((max, r) => (max === null || r.queuedAt > max ? r.queuedAt : max), null);
  // `orgId` rides along; the response schema strips it.
  return {
    ...row,
    counts: {
      needsYou: runs.filter((r) => r.status === 'idle').length,
      // As the API counts them: live jobs, idle included (needsYou is a subset).
      running: runs.filter((r) => isActive(r.status)).length,
      queued: runs.filter((r) => r.status === 'queued').length,
    },
    lastRunAt,
  };
}

function connectionDto(row: ProjectRow): ProjectConnectionDto {
  const trig = db().triggers[row.id] ?? defaultTriggerState();
  return {
    mode: row.triggerMode,
    webhook: row.triggerMode === 'webhook' ? trig.webhook : null,
    polling: row.triggerMode === 'polling' ? { intervalSeconds: row.pollIntervalSeconds, ...trig.polling } : null,
  };
}

function agentOf(projectId: string) {
  const agent = db().agents.find((a) => a.projectId === projectId);
  if (!agent) throw notFound('Agent');
  return agent;
}

function skillsOf(projectId: string): SkillDto[] {
  const list = db().skills[projectId] ?? [];
  db().skills[projectId] = list;
  return list;
}

function skillOf(projectId: string, name: string): SkillDto {
  const skill = skillsOf(projectId).find((s) => s.name === name);
  if (!skill) throw notFound('Skill');
  return skill;
}

function ruleOf(ruleId: string) {
  const rule = db().rules.find((r) => r.id === ruleId);
  if (!rule) throw notFound('Rule');
  projectRow(rule.projectId);
  return rule;
}

function assertUniqueCommand(projectId: string, command: string, exceptId?: string) {
  if (db().rules.some((r) => r.projectId === projectId && r.command === command && r.id !== exceptId)) {
    throw conflict('Rule already exists', [
      { pointer: '/command', detail: `A rule for /${command} already exists in this project.` },
    ]);
  }
}

function runOf(runId: string): RunDto {
  const run = db().runs.find((r) => r.id === runId);
  if (!run) throw notFound('Run');
  projectRow(run.projectId);
  return run;
}

/** Ends the run now; open event streams see the note and the status (live.ts). */
function endRun(run: RunDto, status: 'succeeded' | 'cancelled', note: string) {
  run.finishedAt = now();
  run.exitCode = status === 'succeeded' ? 0 : null;
  appendRunEvent(run, 'lifecycle', { text: note });
  setRunStatus(run, status);
}

const matchesFilter = (filter: RunListFilter | undefined, s: RunStatus): boolean => {
  switch (filter) {
    case 'needs_you':
      return s === 'idle';
    case 'active':
      return isActive(s);
    case 'queued':
      return s === 'queued';
    case 'ended':
      return isFinal(s);
    default:
      return true;
  }
};

/** First `description:` line of a SKILL.md frontmatter. */
const descriptionOf = (body: string) => /^description:\s*(.+)$/m.exec(body)?.[1]?.trim() ?? '';

let commits = 0;
const nextSha = () => {
  commits += 1;
  return `c0ffee${String(commits).padStart(34, '0')}`;
};

/** In-memory setup script history per project (oldest first); not part of the mock db seed. */
const setupScripts = new Map<string, SetupScriptDto[]>();
const setupVersionsOf = (projectId: string) => setupScripts.get(projectId) ?? [];

/** In-memory setup tests per project (newest last); never carry the script text, like the real DTO. */
const setupTests = new Map<string, SetupTestDto[]>();
const setupTestsOf = (projectId: string) => setupTests.get(projectId) ?? [];
const findSetupTest = (id: string): SetupTestDto | undefined =>
  [...setupTests.values()].flat().find((t) => t.id === id);

/** Routes that are not JSON: the SSE streams and the terminal WebSockets (see streamGuard below). */
const STREAM_KEYS = [
  'runs.events',
  'projects.events',
  'runs.terminal',
  'setupTests.events',
  'setupTests.terminal',
] as const;
type StreamKey = (typeof STREAM_KEYS)[number];
type JsonKey = Exclude<RouteKey, StreamKey>;

type Impl = { [K in JsonKey]: (ctx: RouteCtx<K>) => ResponseOf<K> };

const impl: Impl = {
  'connections.list': () => {
    const { orgId } = session();
    return db().connections.filter((c) => c.orgId === orgId);
  },
  'connections.install': ({ params }) => {
    session();
    // The real API returns the provider's install page; the fake provider has none, so it gets a placeholder https URL
    // (the app only follows absolute https install URLs).
    return {
      url:
        params.provider === 'github'
          ? 'https://github.com/apps/agent-desk/installations/new'
          : 'https://fake-provider.invalid/install',
    };
  },
  'connections.repos': ({ params }) => {
    const { orgId } = session();
    if (!db().connections.some((c) => c.id === params.connectionId && c.orgId === orgId)) throw notFound('Connection');
    return db().repos[params.connectionId] ?? [];
  },

  'projects.list': () => {
    const { orgId } = session();
    return db()
      .projects.filter((p) => p.orgId === orgId)
      .map(toProjectDto);
  },
  'projects.create': ({ body }) => {
    const { orgId } = session();
    const conn = db().connections.find((c) => c.id === body.connectionId && c.orgId === orgId);
    if (!conn) throw invalid('/connectionId', 'Unknown connection.');
    if (!(db().repos[conn.id] ?? []).some((r) => r.repoPath === body.repoPath)) {
      throw invalid('/repoPath', 'The connection cannot see this repository.');
    }
    if (db().projects.some((p) => p.orgId === orgId && p.repoPath === body.repoPath)) {
      throw conflict('Project already exists', [{ pointer: '/repoPath', detail: 'A project already uses this repo.' }]);
    }
    const row: ProjectRow = {
      id: mockDb.nextId(),
      orgId,
      name: body.name ?? body.repoPath.split('/').at(-1) ?? body.repoPath,
      repoPath: body.repoPath,
      codeConnectionId: conn.id,
      boardConnectionId: conn.id,
      triggerMode: body.triggerMode,
      pollIntervalSeconds: body.pollIntervalSeconds ?? 300,
      maxConcurrentRuns: 2,
      maxRunsPerTicket: 10,
      setupStep: 'agent',
      createdAt: now(),
    };
    db().projects.push(row);
    // The mock server hears at once: a webhook ping, or the first polling check.
    db().triggers[row.id] = {
      webhook: { lastEventAt: row.triggerMode === 'webhook' ? now() : null, lastEventAction: 'ping' },
      polling: {
        lastCheckedAt: row.triggerMode === 'polling' ? now() : null,
        lastError: null,
        pausedReason: null,
        nextPollAt: null,
      },
    };
    // The API creates the project's agent with the project; setup step 2 fills it in.
    db().agents.push({
      id: mockDb.nextId(),
      projectId: row.id,
      name: 'Claude',
      provider: 'claude',
      model: 'opus',
      maxTurns: null,
      timeoutSeconds: 1800,
      credential: { set: false, type: null, updatedAt: null, setBy: null },
    });
    return toProjectDto(row);
  },
  'projects.get': ({ params }) => toProjectDto(projectRow(params.projectId)),
  'projects.update': ({ params, body }) => {
    const row = projectRow(params.projectId);
    Object.assign(row, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
    const trig = db().triggers[row.id] ?? defaultTriggerState();
    if (row.triggerMode === 'polling' && trig.polling.lastCheckedAt === null) {
      // Switching to polling runs a first check right away on the server.
      trig.polling.lastCheckedAt = now();
      trig.polling.nextPollAt = new Date(Date.now() + row.pollIntervalSeconds * 1000).toISOString();
    }
    db().triggers[row.id] = trig;
    return toProjectDto(row);
  },
  'projects.remove': ({ params }) => {
    const row = projectRow(params.projectId);
    const s = db();
    const runIds = new Set(s.runs.filter((r) => r.projectId === row.id).map((r) => r.id));
    s.projects = s.projects.filter((p) => p.id !== row.id);
    s.agents = s.agents.filter((a) => a.projectId !== row.id);
    s.rules = s.rules.filter((r) => r.projectId !== row.id);
    s.runs = s.runs.filter((r) => r.projectId !== row.id);
    for (const id of runIds) delete s.runEvents[id];
    delete s.skills[row.id];
    delete s.triggers[row.id];
    delete s.ignored[row.id];
    return null;
  },
  'projects.connection': ({ params }) => connectionDto(projectRow(params.projectId)),
  'projects.ignored': ({ params }) => db().ignored[projectRow(params.projectId).id] ?? [],

  'agents.get': ({ params }) => agentOf(projectRow(params.projectId).id),
  'agents.put': ({ params, body }) => {
    const agent = agentOf(projectRow(params.projectId).id);
    agent.model = body.model;
    agent.maxTurns = body.maxTurns ?? null;
    agent.timeoutSeconds = body.timeoutSeconds;
    return agent;
  },
  'agents.putCredential': ({ params, body }) => {
    const { user } = session();
    const agent = db().agents.find((a) => a.id === params.agentId);
    if (!agent) throw notFound('Agent');
    projectRow(agent.projectId);
    // Write-only: the value is dropped here, only the fact that one is set is kept.
    const updatedAt = now();
    agent.credential = { set: true, type: body.type, updatedAt, setBy: user.handle };
    return { updatedAt };
  },

  // Full skills; the SkillSummaryDto response schema strips `body` and `sha`.
  'skills.list': ({ params }) => skillsOf(projectRow(params.projectId).id),
  'skills.get': ({ params }) => skillOf(projectRow(params.projectId).id, params.name),
  'skills.put': ({ params, body }) => {
    const list = skillsOf(projectRow(params.projectId).id);
    const existing = list.find((s) => s.name === params.name);
    if (existing && body.sha !== existing.sha) {
      throw conflict('Skill changed', undefined, 'The skill was changed since you opened it. Reload and try again.');
    }
    if (!existing && body.sha !== undefined) throw conflict('Skill not found at that sha');
    const sha = nextSha();
    const next: SkillDto = {
      name: params.name,
      description: descriptionOf(body.body),
      path: `.claude/skills/${params.name}/SKILL.md`,
      lastCommit: { sha, message: body.message, at: now() },
      body: body.body,
      sha,
    };
    if (existing) Object.assign(existing, next);
    else list.push(next);
    return { commitSha: sha };
  },
  'skills.remove': ({ params }) => {
    const projectId = projectRow(params.projectId).id;
    skillOf(projectId, params.name);
    db().skills[projectId] = skillsOf(projectId).filter((s) => s.name !== params.name);
    return null;
  },

  'setupScript.get': ({ params }) => setupVersionsOf(projectRow(params.projectId).id).at(-1) ?? null,
  'setupScript.put': ({ params, body }) => {
    const projectId = projectRow(params.projectId).id;
    const list = setupVersionsOf(projectId);
    const current = list.at(-1)?.version ?? null;
    if (body.baseVersion !== current) {
      throw conflict('Setup script changed', undefined, 'The setup script was changed since you opened it.');
    }
    const next: SetupScriptDto = {
      version: (current ?? 0) + 1,
      body: body.body,
      note: body.note ?? null,
      createdBy: session().user.handle,
      createdAt: now(),
    };
    setupScripts.set(projectId, [...list, next]);
    return next;
  },
  'setupScript.versions': ({ params }) =>
    setupVersionsOf(projectRow(params.projectId).id)
      .map((v) => ({ version: v.version, note: v.note, createdBy: v.createdBy, createdAt: v.createdAt }))
      .reverse(),
  'setupScript.version': ({ params }) => {
    const found = setupVersionsOf(projectRow(params.projectId).id).find((v) => v.version === params.version);
    if (!found) throw notFound('Setup script version');
    return found;
  },
  'setup.plugins': ({ params }) => {
    projectRow(params.projectId);
    return {
      approvedStores: ['claude-plugins-official'],
      plugins: [
        {
          id: 'superpowers@claude-plugins-official',
          name: 'superpowers',
          store: 'claude-plugins-official',
          state: 'will_install' as const,
        },
        { id: 'unknown-tool@third-party', name: 'unknown-tool', store: 'third-party', state: 'blocked' as const },
      ],
      settingsError: null,
    };
  },
  'setupTests.create': ({ params, body }) => {
    const projectId = projectRow(params.projectId).id;
    const sha = [...body.script].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16);
    const list = setupTestsOf(projectId).map((t) =>
      t.endedAt === null ? { ...t, status: 'ended' as const, endedAt: now(), endsAt: null } : t,
    );
    const test: SetupTestDto = {
      id: mockDb.nextId(),
      projectId,
      status: 'queued',
      scriptSha256: sha,
      matchesCurrentScript: true,
      checkoutSha: null,
      plugins: { installed: [], skipped: [], failed: [] },
      exitCode: null,
      startedBy: session().user.handle,
      createdAt: now(),
      finishedAt: null,
      endedAt: null,
      endsAt: null,
    };
    setupTests.set(projectId, [...list, test]);
    return test;
  },
  'setupTests.latest': ({ params }) => setupTestsOf(projectRow(params.projectId).id).at(-1) ?? null,
  'setupTests.end': ({ params }) => {
    const found = findSetupTest(params.setupTestId);
    if (!found) throw notFound('Setup test');
    const list = setupTestsOf(found.projectId).map((t) =>
      t.id === found.id ? { ...t, status: 'ended' as const, endedAt: now(), endsAt: null } : t,
    );
    setupTests.set(found.projectId, list);
    return null;
  },
  'rules.list': ({ params }) => db().rules.filter((r) => r.projectId === projectRow(params.projectId).id),
  'rules.create': ({ params, body }) => {
    const projectId = projectRow(params.projectId).id;
    assertUniqueCommand(projectId, body.command);
    const rule = {
      ...body,
      id: mockDb.nextId(),
      projectId,
      agentId: agentOf(projectId).id,
      stats: { runs30d: 0, lastRunAt: null },
    };
    db().rules.push(rule);
    return rule;
  },
  'rules.update': ({ params, body }) => {
    const rule = ruleOf(params.ruleId);
    if (body.command !== undefined) assertUniqueCommand(rule.projectId, body.command, rule.id);
    Object.assign(rule, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
    return rule;
  },
  'rules.remove': ({ params }) => {
    const rule = ruleOf(params.ruleId);
    db().rules = db().rules.filter((r) => r.id !== rule.id);
    return null;
  },

  'runs.list': ({ params, query }) => {
    const projectId = projectRow(params.projectId).id;
    const cursor = query.cursor === undefined ? Infinity : Number(query.cursor);
    const matching = db()
      .runs.filter((r) => r.projectId === projectId)
      .filter((r) => matchesFilter(query.filter, r.status))
      .filter((r) => query.ticket === undefined || r.ticket.ref === query.ticket)
      .filter((r) => r.number < cursor)
      .sort((a, b) => b.number - a.number);
    const items = matching.slice(0, query.limit);
    const last = items.at(-1);
    return { items, nextCursor: matching.length > items.length && last ? String(last.number) : null };
  },
  'runs.byNumber': ({ params }) => {
    const projectId = projectRow(params.projectId).id;
    const run = db().runs.find((r) => r.projectId === projectId && r.number === params.number);
    if (!run) throw notFound('Run');
    return run;
  },
  'runs.get': ({ params }) => runOf(params.runId),
  'runs.log': ({ params }) => ({ items: db().runEvents[runOf(params.runId).id] ?? [] }),
  'runs.cancel': ({ params }) => {
    const { user } = session();
    const run = runOf(params.runId);
    if (isFinal(run.status)) throw conflict('Run already ended');
    endRun(run, 'cancelled', `Cancel requested by ${user.handle}`);
    return null;
  },
  'runs.finish': ({ params }) => {
    const { user } = session();
    const run = runOf(params.runId);
    if (isFinal(run.status)) throw conflict('Run already ended');
    if (run.status !== 'running' && run.status !== 'idle') throw conflict('Run is not attached yet');
    endRun(run, 'succeeded', `Finish clicked by ${user.handle}`);
    return null;
  },
};

// As the API answers (Nest: 201 for a POST without @HttpCode).
const STATUS: Partial<Record<RouteKey, number>> = {
  'connections.install': 201,
  'projects.create': 201,
  'rules.create': 201,
  'runs.cancel': 202,
  'runs.finish': 202,
};

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Problem({ status: 400, title: 'Invalid JSON body', type: 'validation' });
  }
}

function parsePart(schema: RouteDef['body'], value: unknown, where: string): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Problem({
    status: 400,
    title: 'Validation failed',
    type: 'validation',
    detail: `Invalid ${where}`,
    errors: fieldErrors(result.error),
  });
}

function contractHandler<K extends JsonKey>(key: K, run: Impl[K]): HttpHandler {
  const def = routeDef(key);
  return routeHandler(key, async (request, rawParams) => {
    try {
      session();
      const url = new URL(request.url);
      const parts = {
        params: parsePart(def.params, rawParams, 'path parameters'),
        query: parsePart(def.query, Object.fromEntries(url.searchParams), 'query'),
        body: parsePart(def.body, def.body ? await readBody(request) : undefined, 'body'),
        request,
      };
      // Each part was parsed by this route's own schema above, so it has the shape RouteCtx<K> names.
      const ctx = parts as RouteCtx<K>;
      return jsonResponse(def.response.parse(run(ctx)), STATUS[key]);
    } catch (e) {
      if (e instanceof Problem) return problemResponse(e.init);
      throw e;
    }
  });
}

const isJsonKey = (k: string): k is JsonKey => k in flatRoutes && !STREAM_KEYS.some((s) => s === k);
const build = <K extends JsonKey>(key: K) => contractHandler(key, impl[key]);

/** The project a stream route's path parameters point at, when the signed-in user's active org can see it (RLS). */
function streamProblem(key: StreamKey, params: Record<string, unknown>): Response | undefined {
  if (!mockDb.currentUser()) return problemResponse({ status: 401, title: 'Unauthorized', type: 'unauthorized' });
  const orgId = mockDb.auth.activeOrganizationId;
  const projectId =
    key === 'projects.events'
      ? params['projectId']
      : key === 'setupTests.events' || key === 'setupTests.terminal'
        ? findSetupTest(String(params['setupTestId']))?.projectId
        : db().runs.find((r) => r.id === params['runId'])?.projectId;
  const ok = db().projects.some((p) => p.id === projectId && p.orgId === orgId);
  return ok ? undefined : problemResponse({ status: 404, title: 'Not found', type: 'not-found' });
}

/**
 * A stream route's auth and scope check (401, or 404 for a record the active org cannot see). When the request may go
 * on it answers nothing, so the next handler takes it: in the browser the SSE handlers (stream-handlers.ts, listed
 * after these guards) stream; the terminal route only exists as a WebSocket, played by fakeTerminal.ts. Vitest uses
 * FakeEventSource and FakeWebSocket instead, so no request gets past a guard there.
 */
function streamGuard(key: StreamKey): HttpHandler {
  const def = routeDef(key);
  return http.get(def.path, ({ request, params }) => {
    mockDb.logRequest(def.method, new URL(request.url).pathname);
    return streamProblem(key, params);
  });
}

export const streamGuards: Record<StreamKey, HttpHandler> = {
  'runs.events': streamGuard('runs.events'),
  'projects.events': streamGuard('projects.events'),
  'runs.terminal': streamGuard('runs.terminal'),
  'setupTests.events': streamGuard('setupTests.events'),
  'setupTests.terminal': streamGuard('setupTests.terminal'),
};

/** The handler for each contracts route key (the stream routes get their guard). */
export const routeHandlers: Record<RouteKey, HttpHandler> = {
  ...(Object.fromEntries(
    Object.keys(impl)
      .filter(isJsonKey)
      .map((key) => [key, build(key)]),
  ) as Record<JsonKey, HttpHandler>), // `impl` is typed `Impl`, so its keys are exactly JsonKey.
  ...streamGuards,
};

export { problemResponse };

export const handlers: HttpHandler[] = [...authHandlers, ...Object.values(routeHandlers)];
