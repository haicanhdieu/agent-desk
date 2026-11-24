/**
 * Localhost end-to-end check against a stack started by `pnpm dev` (KUBE_MODE=fake, ENABLE_FAKE_PROVIDER=true,
 * AUTH_DEV_LOGIN=true). Three independent scenarios, each in a fresh org (created by the platform admin, its owner invited by a new dev-login handle):
 *   1. webhook: comment delivered as a webhook -> run idle -> terminal echo -> finish -> succeeded + start/finish comments
 *   2. polling: comment picked up by the poll Schedule (triggered via the Temporal client) -> same assertions
 *   3. crash: comment with `--fake-fail` -> agent exits 3 -> run paused (agent_crashed), volume kept, start + paused comments
 *   4. done: comment with `--fake-done` -> run done -> finish -> succeeded
 *   5. price-change, price-outage: the price catalog changes (or its source fails) between runs of `--fake-usage`
 *
 * Env: E2E_BASE_URL (default http://localhost:3000); PUBLIC_ORIGIN, TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE come from the
 * repo's .env when set there. Exit code 0 only when every scenario passes.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Connection } from '@temporalio/client';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import WebSocket from 'ws';
import { z } from 'zod';
import {
  AgentDto,
  ConnectionDto,
  CreateOrgResponse,
  FINAL_RUN_STATUSES,
  InstallResponse,
  PlatformInvitationDto,
  PlatformRoleDto,
  ProjectDto,
  PutSkillResponse,
  RuleDto,
  RunDto,
  RunListItem,
  RunListResponse,
  RunLogResponse,
  RunStatusEvent,
  SetupScriptDto,
  SetupTestDto,
  SkillDto,
  type RunStatus,
} from '@agentdesk/contracts';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const BASE = (process.env['E2E_BASE_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
const ORIGIN = new URL(process.env['PUBLIC_ORIGIN'] ?? 'http://localhost:5173').origin;
const TEMPORAL_ADDRESS = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env['TEMPORAL_NAMESPACE'] ?? 'agentdesk';
const REPO = 'dev/demo';
/** admin@dev.local: seeded by the local stack start. */
const PLATFORM_ADMIN_HANDLE = 'admin';
const OVERALL_TIMEOUT_MS = 600_000;
const PRICE_SYNC_TIMEOUT_MS = 90_000;
/** The fake cluster's state dir (the stack's FAKE_STATE_DIR); the fake price source reads `price-source.json` there. */
const FAKE_STATE_DIR =
  process.env['E2E_FAKE_STATE_DIR'] ?? fileURLToPath(new URL('../.agentdesk/fake', import.meta.url));
const IDLE_TIMEOUT_MS = 30_000;
const FINAL_TIMEOUT_MS = 30_000;

/** A fake credential: it must never be echoed back by any API response, SSE frame or terminal byte we can see. */
const CREDENTIAL = `sk-ant-e2e-test-${randomBytes(8).toString('hex')}`;

const rand = (): string => randomBytes(4).toString('hex');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const isFinal = (s: RunStatus): boolean => (FINAL_RUN_STATUSES as readonly string[]).includes(s);

class StepError extends Error {}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new StepError(msg);
}

function assertNoCredential(text: string, where: string): void {
  assert(!text.includes(CREDENTIAL), `credential value leaked in ${where}`);
}

function logStep(scenario: string, msg: string): void {
  console.log(`  [${scenario}] ${msg}`);
}

/** One dev-login session (cookie jar of the session cookies set by /auth/dev-login). */
class Session {
  private constructor(
    readonly handle: string,
    private readonly cookie: string,
  ) {}

  static async login(handle: string): Promise<Session> {
    const res = await fetch(`${BASE}/auth/dev-login?handle=${encodeURIComponent(handle)}&redirect=/`, {
      redirect: 'manual',
    });
    assert(res.status === 302, `dev-login: expected 302, got ${res.status}`);
    const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0] ?? '');
    assert(cookies.length > 0, 'dev-login: no Set-Cookie');
    return new Session(handle, cookies.join('; '));
  }

  get headers(): Record<string, string> {
    return { cookie: this.cookie };
  }

  /** JSON request; asserts the status, scans the body for the credential, parses with `schema` when given. */
  async call<T>(
    method: string,
    path: string,
    opts: { body?: unknown; expect?: number[]; schema?: z.ZodType<T> } = {},
  ): Promise<{ status: number; data: T | undefined; text: string; res: Response }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...this.headers,
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    assertNoCredential(text, `${method} ${path}`);
    const expect = opts.expect ?? [200];
    assert(expect.includes(res.status), `${method} ${path}: expected ${expect.join('|')}, got ${res.status} ${text}`);
    let data: T | undefined;
    if (opts.schema && res.ok && text.length > 0) {
      const parsed = opts.schema.safeParse(JSON.parse(text));
      assert(parsed.success, `${method} ${path}: response does not match contract: ${parsed.error?.message ?? ''}`);
      data = parsed.data;
    }
    return { status: res.status, data, text, res };
  }

  async json<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown, expect?: number[]): Promise<T> {
    const { data } = await this.call(method, path, { schema, body, ...(expect ? { expect } : {}) });
    assert(data !== undefined, `${method} ${path}: empty body`);
    return data;
  }
}

interface Setup {
  session: Session;
  project: ProjectDto;
  ticketNumber: number;
}

/** Steps shared by every scenario: login, fake install, project, credential, skill, rule, ticket. */
async function setup(name: string, mode: 'webhook' | 'polling'): Promise<Setup> {
  // A platform admin creates the org (slug = the handle) and invites the handle as its owner; the handle's dev-login
  // accepts the invitation and links the fake identity that the comments below are written as.
  const handle = `e2e-${rand()}`;
  const admin = await Session.login(PLATFORM_ADMIN_HANDLE);
  const org = await admin.json(
    'POST',
    '/api/platform/orgs',
    CreateOrgResponse,
    { name: `E2E ${handle}`, slug: handle },
    [201],
  );
  const roles = await admin.json('GET', `/api/platform/orgs/${org.id}/roles`, z.array(PlatformRoleDto));
  const owner = roles.find((r) => r.key === 'owner');
  assert(owner, `org ${org.id} has no owner role`);
  const invitation = await admin.json(
    'POST',
    `/api/platform/orgs/${org.id}/invitations`,
    PlatformInvitationDto,
    { email: `${handle}@dev.local`, roleId: owner.id, scope: { type: 'org' } },
    [201],
  );
  let session = await Session.login(handle);
  await session.call('POST', `/api/me/invitations/${invitation.id}/accept`);
  // The session picks its active org when it is created: sign in again once the invitation is accepted.
  session = await Session.login(handle);
  logStep(name, `org ${org.slug}, owner invited, dev-login as ${session.handle}`);

  const install = await session.json('POST', '/api/connections/fake/install', InstallResponse, undefined, [200, 201]);
  const callback = new URL(install.url);
  await session.call('GET', `${callback.pathname}${callback.search}`, { expect: [302] });
  const connections = await session.json('GET', '/api/connections', z.array(ConnectionDto));
  const connection = connections.find((c) => c.provider === 'fake');
  assert(connection, 'fake connection missing after install');
  logStep(name, `fake connection ${connection.id}`);

  const project = await session.json(
    'POST',
    '/api/projects',
    ProjectDto,
    {
      connectionId: connection.id,
      repoPath: REPO,
      triggerMode: mode,
      ...(mode === 'polling' ? { pollIntervalSeconds: 300 } : {}),
    },
    [200, 201],
  );
  logStep(name, `project ${project.id} (${mode})`);

  const agent = await session.json('GET', `/api/projects/${project.id}/agent`, AgentDto);
  await session.call('PUT', `/api/agents/${agent.id}/credential`, {
    body: { type: 'api_key', value: CREDENTIAL },
  });
  const after = await session.json('GET', `/api/projects/${project.id}/agent`, AgentDto);
  assert(after.credential.set, 'agent credential not marked set');
  logStep(name, 'agent credential stored');

  // The fake board is shared by every org on this machine: update the skill on top of whatever is there.
  const existing = await session.call('GET', `/api/projects/${project.id}/skills/code-review`, {
    expect: [200, 404],
    schema: SkillDto,
  });
  await session.json(
    'PUT',
    `/api/projects/${project.id}/skills/code-review`,
    PutSkillResponse,
    {
      body: '---\ndescription: Review the change\n---\nReview the ticket and reply.\n',
      message: 'e2e: code-review skill',
      ...(existing.data ? { sha: existing.data.sha } : {}),
    },
    [200, 201],
  );
  logStep(name, 'skill code-review written');

  await session.json(
    'POST',
    `/api/projects/${project.id}/rules`,
    RuleDto,
    { command: 'code-review', labelFilter: [], target: 'any', kind: 'skill', skillName: 'code-review', enabled: true },
    [200, 201],
  );
  logStep(name, 'rule code-review created');

  const ticketNumber = 100_000 + Math.floor(Math.random() * 900_000_000);
  await session.call('POST', '/dev/fake/tickets', {
    body: { repoPath: REPO, number: ticketNumber, kind: 'issue', title: `e2e ${name} ${session.handle}` },
    expect: [201],
  });
  logStep(name, `fake ticket #${ticketNumber}`);
  return { session, project, ticketNumber };
}

const CommentResult = z.object({ commentId: z.string(), outcome: z.string(), runId: z.string().optional() });

async function comment(s: Setup, body: string, deliver: 'webhook' | 'poll'): Promise<z.infer<typeof CommentResult>> {
  return s.session.json(
    'POST',
    '/dev/fake/comments',
    CommentResult,
    { repoPath: REPO, ticketNumber: s.ticketNumber, body, deliver, projectId: s.project.id, author: s.session.handle },
    [201],
  );
}

async function getRun(s: Setup, runId: string): Promise<RunDto> {
  return s.session.json('GET', `/api/runs/${runId}`, RunDto);
}

/** Polls GET /api/runs/:id until `done(status)` or the deadline. */
async function waitForRun(s: Setup, runId: string, done: (st: RunStatus) => boolean, ms: number): Promise<RunDto> {
  const deadline = Date.now() + ms;
  let run = await getRun(s, runId);
  while (!done(run.status)) {
    assert(Date.now() < deadline, `run ${runId}: still ${run.status} after ${ms} ms`);
    await sleep(500);
    run = await getRun(s, runId);
  }
  return run;
}

/** Polls the project's run list for the ticket until a run appears. */
async function waitForFirstRun(s: Setup, ms: number): Promise<RunListItem> {
  const deadline = Date.now() + ms;
  for (;;) {
    const list = await s.session.json(
      'GET',
      `/api/projects/${s.project.id}/runs?filter=all&ticket=${s.ticketNumber}`,
      RunListResponse,
    );
    const run = list.items[0];
    if (run) return run;
    assert(Date.now() < deadline, `no run for ticket #${s.ticketNumber} after ${ms} ms`);
    await sleep(500);
  }
}

/** Opens the terminal, types `line\r` and waits until the line is echoed back. */
async function terminalEcho(s: Setup, runId: string, line: string): Promise<void> {
  const url = `${BASE.replace(/^http/, 'ws')}/api/runs/${runId}/terminal`;
  const ws = new WebSocket(url, { headers: { ...s.session.headers, origin: ORIGIN } });
  let seen = '';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new StepError(`terminal: no echo of "${line}" within 10 s`)), 10_000);
      ws.on('open', () => ws.send(Buffer.from(`${line}\r`, 'utf8'), { binary: true }));
      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (!isBinary) return; // text frames are control messages
        const chunk = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
        seen += chunk.toString('utf8');
        if (seen.includes(CREDENTIAL)) {
          clearTimeout(timer);
          reject(new StepError('credential value leaked in terminal output'));
        } else if (seen.includes(line)) {
          clearTimeout(timer);
          resolve();
        }
      });
      ws.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timer);
        reject(new StepError(`terminal closed early: ${code} ${reason.toString()}`));
      });
      ws.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(new StepError(`terminal error: ${err.message}`));
      });
    });
  } finally {
    ws.removeAllListeners('close');
    ws.on('error', () => undefined);
    ws.close();
  }
}

/** Reads the run's SSE stream until the server ends it; returns the statuses seen, in order. */
async function readRunStream(s: Setup, runId: string, ms: number): Promise<RunStatus[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const statuses: RunStatus[] = [];
  try {
    const res = await fetch(`${BASE}/api/runs/${runId}/events`, {
      headers: { ...s.session.headers, accept: 'text/event-stream' },
      signal: ac.signal,
    });
    assert(res.status === 200 && res.body, `SSE: expected 200, got ${res.status}`);
    const parser = createParser({
      onEvent: (msg: EventSourceMessage) => {
        assertNoCredential(msg.data, 'run SSE');
        if (msg.event !== 'status') return;
        statuses.push(RunStatusEvent.parse(JSON.parse(msg.data)).status);
      },
    });
    const decoder = new TextDecoder();
    for await (const chunk of res.body) parser.feed(decoder.decode(chunk, { stream: true }));
  } catch (err) {
    if (ac.signal.aborted) throw new StepError(`SSE: stream did not end within ${ms} ms (saw ${statuses.join(',')})`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  return statuses;
}

/** Both outbox comments are recorded in the run log and present on the fake board for the ticket. */
async function assertComments(s: Setup, runId: string, lastKind: 'finish' | 'paused' = 'finish'): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const log = await s.session.json('GET', `/api/runs/${runId}/log`, RunLogResponse);
    const ids = new Map<string, string>();
    for (const e of log.items) {
      if (e.type !== 'comment') continue;
      const kind = e.payload['kind'];
      const id = e.payload['commentId'];
      if (typeof kind === 'string' && typeof id === 'string') ids.set(kind, id);
    }
    const posted = await s.session.json(
      'GET',
      `/dev/fake/posted?repoPath=${encodeURIComponent(REPO)}`,
      z.array(z.object({ id: z.string(), ticketRef: z.string(), body: z.string() })),
    );
    const onTicket = new Set(posted.filter((c) => c.ticketRef === String(s.ticketNumber)).map((c) => c.id));
    const start = ids.get('start');
    const last = ids.get(lastKind);
    if (start && last && onTicket.has(start) && onTicket.has(last)) return;
    assert(
      Date.now() < deadline,
      `comments: expected start+${lastKind} on #${s.ticketNumber}, log has ${[...ids.keys()].join(',') || 'none'}, ` +
        `board has ${onTicket.size}`,
    );
    await sleep(500);
  }
}

/** Shared tail of the success scenarios: idle -> terminal echo -> finish -> SSE ends succeeded -> comments. */
async function driveToSuccess(name: string, s: Setup, runId: string): Promise<void> {
  const idle = await waitForRun(s, runId, (st) => st === 'idle' || isFinal(st), IDLE_TIMEOUT_MS);
  assert(idle.status === 'idle', `run ${runId}: expected idle, got ${idle.status} (${idle.failureReason ?? ''})`);
  logStep(name, `run #${idle.number} idle`);

  const line = `ok ${rand()}`;
  await terminalEcho(s, runId, line);
  logStep(name, `terminal echoed "${line}"`);

  const stream = readRunStream(s, runId, FINAL_TIMEOUT_MS + IDLE_TIMEOUT_MS);
  // Typing resumes the session (running); finish is accepted only once that turn ends and the run is idle again. The
  // status flip is asynchronous, so a finish sent too early gets 409 and is retried after the next idle.
  const deadline = Date.now() + IDLE_TIMEOUT_MS;
  for (;;) {
    const again = await waitForRun(s, runId, (st) => st === 'idle' || isFinal(st), IDLE_TIMEOUT_MS);
    assert(again.status === 'idle', `run ${runId}: expected idle after input, got ${again.status}`);
    const { status } = await s.session.call('POST', `/api/runs/${runId}/finish`, { expect: [202, 409] });
    if (status === 202) break;
    assert(Date.now() < deadline, `run ${runId}: finish still refused after ${IDLE_TIMEOUT_MS} ms`);
    await sleep(500);
  }
  logStep(name, 'finish accepted (202)');
  const statuses = await stream;
  assert(statuses.at(-1) === 'succeeded', `SSE: expected final status succeeded, saw ${statuses.join(',')}`);
  logStep(name, `SSE ended with succeeded (${statuses.join(' -> ')})`);

  await assertComments(s, runId);
  logStep(name, 'start and finish comments posted');
}

async function cleanup(name: string, s: Setup | undefined, runId: string | undefined): Promise<void> {
  if (!s) return;
  try {
    if (runId) {
      const run = await getRun(s, runId);
      if (!isFinal(run.status)) {
        await s.session.call('POST', `/api/runs/${runId}/cancel`, { expect: [202, 409] });
        await waitForRun(s, runId, isFinal, FINAL_TIMEOUT_MS).catch(() => undefined);
      }
    }
    await s.session.call('DELETE', `/api/projects/${s.project.id}`, { expect: [204, 404] });
    logStep(name, 'cleanup: project deleted');
  } catch (err) {
    logStep(name, `cleanup failed (ignored): ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function webhookScenario(name: string): Promise<void> {
  let s: Setup | undefined;
  let runId: string | undefined;
  try {
    s = await setup(name, 'webhook');
    const result = await comment(s, '/code-review please', 'webhook');
    assert(result.outcome === 'run_created' || result.runId, `webhook: no run (outcome ${result.outcome})`);
    runId = result.runId;
    assert(runId, `webhook: no runId (outcome ${result.outcome})`);
    logStep(name, `webhook delivered, run ${runId}`);
    await driveToSuccess(name, s, runId);
  } finally {
    await cleanup(name, s, runId);
  }
}

async function pollingScenario(name: string): Promise<void> {
  let s: Setup | undefined;
  let runId: string | undefined;
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  try {
    s = await setup(name, 'polling');
    const result = await comment(s, '/code-review please', 'poll');
    assert(result.outcome === 'queued_for_poll', `poll: unexpected outcome ${result.outcome}`);
    const client = new Client({ connection, namespace: TEMPORAL_NAMESPACE });
    await client.schedule.getHandle(`poll-${s.project.id}`).trigger();
    logStep(name, `schedule poll-${s.project.id} triggered`);
    const run = await waitForFirstRun(s, IDLE_TIMEOUT_MS);
    runId = run.id;
    assert(run.triggerSource === 'polling', `poll: run trigger source is ${run.triggerSource}`);
    logStep(name, `poller created run ${runId}`);
    await driveToSuccess(name, s, runId);
  } finally {
    await cleanup(name, s, runId);
    await connection.close();
  }
}

async function failureScenario(name: string): Promise<void> {
  let s: Setup | undefined;
  let runId: string | undefined;
  try {
    s = await setup(name, 'webhook');
    // The crash must park the run, not resume it by itself (spec 2026-11-20): turn automatic resume off.
    const agent = await s.session.json('GET', `/api/projects/${s.project.id}/agent`, AgentDto);
    await s.session.call('PUT', `/api/projects/${s.project.id}/agent`, {
      body: { model: agent.model, timeoutSeconds: agent.timeoutSeconds, autoResumeMax: 0 },
    });
    const result = await comment(s, '/code-review --fake-fail', 'webhook');
    runId = result.runId;
    assert(runId, `webhook: no runId (outcome ${result.outcome})`);
    logStep(name, `webhook delivered, run ${runId}`);
    const run = await waitForRun(s, runId, (st) => st === 'paused' || isFinal(st), IDLE_TIMEOUT_MS + FINAL_TIMEOUT_MS);
    assert(run.status === 'paused', `run ${runId}: expected paused, got ${run.status} (${run.failureReason ?? ''})`);
    assert(
      run.pauseReason === 'agent_crashed',
      `run ${runId}: expected agent_crashed, got ${run.pauseReason ?? 'null'}`,
    );
    logStep(name, `run #${run.number} paused: the agent crashed, its work is kept`);
    await assertComments(s, runId, 'paused');
    logStep(name, 'start and paused comments posted');
  } finally {
    await cleanup(name, s, runId);
  }
}

async function doneScenario(name: string): Promise<void> {
  let s: Setup | undefined;
  let runId: string | undefined;
  try {
    s = await setup(name, 'webhook');
    const result = await comment(s, '/code-review --fake-done', 'webhook');
    runId = result.runId;
    assert(runId, `webhook: no runId (outcome ${result.outcome})`);
    logStep(name, `webhook delivered, run ${runId}`);
    const done = await waitForRun(s, runId, (st) => st === 'done' || isFinal(st), IDLE_TIMEOUT_MS);
    assert(done.status === 'done', `run ${runId}: expected done, got ${done.status} (${done.failureReason ?? ''})`);
    logStep(name, `run #${done.number} done`);

    const stream = readRunStream(s, runId, FINAL_TIMEOUT_MS);
    await s.session.call('POST', `/api/runs/${runId}/finish`, { expect: [202] });
    logStep(name, 'finish accepted (202)');
    const statuses = await stream;
    assert(statuses.at(-1) === 'succeeded', `SSE: expected final status succeeded, saw ${statuses.join(',')}`);
    logStep(name, `SSE ended with succeeded (${statuses.join(' -> ')})`);
  } finally {
    await cleanup(name, s, runId);
  }
}

/** Saves the project's setup script as its next version (`baseVersion` null for the first). */
async function putScript(s: Setup, body: string, baseVersion: number | null): Promise<SetupScriptDto> {
  return s.session.json(
    'PUT',
    `/api/projects/${s.project.id}/setup-script`,
    SetupScriptDto,
    { body, baseVersion },
    [200, 201],
  );
}

/**
 * A saved script is tested in a throwaway workspace (passes with the fake pod; the pod is deleted once the result is
 * recorded), then a real run records its version.
 */
async function setupScenario(name: string): Promise<void> {
  let s: Setup | undefined;
  let runId: string | undefined;
  try {
    s = await setup(name, 'webhook');
    const script = await putScript(s, 'echo prepare workspace\n', null);
    assert(script.version === 1, `setup script: expected version 1, got ${script.version}`);
    logStep(name, 'setup script saved as version 1');

    const created = await s.session.json(
      'POST',
      `/api/projects/${s.project.id}/setup-tests`,
      SetupTestDto,
      { script: script.body },
      [200, 201],
    );
    const deadline = Date.now() + IDLE_TIMEOUT_MS;
    let test = created;
    while (test.status !== 'passed' && test.status !== 'failed') {
      assert(Date.now() < deadline, `setup test ${created.id}: still ${test.status} after ${IDLE_TIMEOUT_MS} ms`);
      await sleep(500);
      const latest = await s.session.json(
        'GET',
        `/api/projects/${s.project.id}/setup-tests/latest`,
        SetupTestDto.nullable(),
      );
      if (latest) test = latest;
    }
    assert(test.status === 'passed', `setup test: expected passed, got ${test.status}`);
    assert(test.matchesCurrentScript, 'setup test: does not match the saved script');
    logStep(name, 'setup test passed on the saved script');
    // The worker deletes the test pod as soon as the result is recorded: the test ends by itself (no End test call)
    // and keeps its result.
    while (test.endedAt === null) {
      assert(Date.now() < deadline, `setup test ${created.id}: not ended after ${IDLE_TIMEOUT_MS} ms`);
      await sleep(500);
      const latest = await s.session.json(
        'GET',
        `/api/projects/${s.project.id}/setup-tests/latest`,
        SetupTestDto.nullable(),
      );
      if (latest) test = latest;
    }
    assert(test.status === 'passed', `setup test: expected the result to stay passed once ended, got ${test.status}`);
    logStep(name, 'setup test ended on its own after the result, result kept');

    const result = await comment(s, '/code-review please', 'webhook');
    runId = result.runId;
    assert(runId, `webhook: no runId (outcome ${result.outcome})`);
    const idle = await waitForRun(s, runId, (st) => st === 'idle' || isFinal(st), IDLE_TIMEOUT_MS);
    assert(idle.setupScriptVersion === 1, `run ${runId}: expected setup version 1, got ${idle.setupScriptVersion}`);
    logStep(name, `run #${idle.number} used setup version 1`);
  } finally {
    await cleanup(name, s, runId);
  }
}

/** A setup script that fails in the fake pod stops the run as failed at the setup stage; the agent never starts. */
async function setupFailureScenario(name: string): Promise<void> {
  let s: Setup | undefined;
  let runId: string | undefined;
  try {
    s = await setup(name, 'webhook');
    await putScript(s, 'echo prepare --fake-setup-fail\n', null);
    const result = await comment(s, '/code-review please', 'webhook');
    runId = result.runId;
    assert(runId, `webhook: no runId (outcome ${result.outcome})`);
    const run = await waitForRun(s, runId, isFinal, IDLE_TIMEOUT_MS + FINAL_TIMEOUT_MS);
    assert(run.status === 'failed', `run ${runId}: expected failed, got ${run.status}`);
    assert(run.failureStage === 'setup', `run ${runId}: expected failure stage setup, got ${run.failureStage}`);
    assert(run.setupScriptVersion === 1, `run ${runId}: expected setup version 1, got ${run.setupScriptVersion}`);
    logStep(name, `run #${run.number} failed at setup (${run.failureReason ?? ''})`);
  } finally {
    await cleanup(name, s, runId);
  }
}

/** A fresh ticket on the scenario's project, so one scenario can start several runs. */
async function newTicket(s: Setup): Promise<Setup> {
  const ticketNumber = 100_000 + Math.floor(Math.random() * 900_000_000);
  await s.session.call('POST', '/dev/fake/tickets', {
    body: { repoPath: REPO, number: ticketNumber, kind: 'issue', title: `e2e usage ${s.session.handle}` },
    expect: [201],
  });
  return { ...s, ticketNumber };
}

async function waitForUsageTotal(s: Setup, runId: string, total: number): Promise<RunDto> {
  const deadline = Date.now() + IDLE_TIMEOUT_MS * 2;
  for (;;) {
    const run = await getRun(s, runId);
    if (run.usage?.totalTokens === total) return run;
    assert(
      Date.now() < deadline,
      `run ${runId}: usage total is ${run.usage?.totalTokens ?? 'none'}, expected ${total} (status ${run.status})`,
    );
    await sleep(500);
  }
}

/** Starts a `--fake-usage` run and waits until its first turn is recorded (3050 tokens) and the run is idle. */
async function startUsageRun(s: Setup): Promise<string> {
  const result = await comment(await newTicket(s), '/code-review --fake-usage', 'webhook');
  assert(result.runId, `usage run: no runId (outcome ${result.outcome})`);
  await waitForUsageTotal(s, result.runId, 3050);
  await waitForRun(s, result.runId, (st) => st === 'idle' || isFinal(st), IDLE_TIMEOUT_MS);
  return result.runId;
}

/** What the API shows for a run's cost: the detail (per-model costs and price dates) and the project list's summary. */
async function costView(s: Setup, runId: string) {
  const run = await getRun(s, runId);
  const usage = run.usage;
  assert(usage, `run ${runId}: no usage`);
  const list = await s.session.json('GET', `/api/projects/${s.project.id}/runs?filter=all`, RunListResponse);
  const item = list.items.find((i) => i.id === runId);
  assert(item, `run ${runId}: not in the project's run list`);
  return {
    cost: usage.estimatedCostUsd,
    modelCosts: usage.models.map((m) => [m.model, m.estimatedCostUsd] as const),
    earliest: usage.priceAsOfEarliest,
    latest: usage.priceAsOfLatest,
    listCost: item.usage?.estimatedCostUsd ?? null,
    total: usage.totalTokens,
  };
}
type CostView = Awaited<ReturnType<typeof costView>>;

function assertSameCost(what: string, before: CostView, after: CostView): void {
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    `${what}: cost view changed from ${JSON.stringify(before)} to ${JSON.stringify(after)}`,
  );
}

function costOf(v: CostView): number {
  assert(v.cost !== null, 'a priced run has a cost');
  return v.cost;
}

function assertClose(what: string, actual: number, expected: number): void {
  assert(Math.abs(actual - expected) < 1e-9, `${what}: expected ${expected}, got ${actual}`);
}

/** Starts the price sync workflow on the task queue and awaits its result (rejects when the sync fails). */
async function runPriceSync(client: Client, input?: { maxAttempts: number }): Promise<unknown> {
  const handle = await client.workflow.start(PRICE_SYNC_WORKFLOW, {
    taskQueue: TASK_QUEUE,
    workflowId: `price-sync-e2e-${randomUUID()}`,
    ...(input ? { args: [input] } : {}),
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      handle.result(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StepError('price sync: no result within 90 s')), PRICE_SYNC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Every message and detail along a failure's cause chain, to look for the failure kind in. */
function failureText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur instanceof Error; i += 1) {
    parts.push(cur.message);
    if ('details' in cur) parts.push(JSON.stringify(cur.details));
    cur = cur.cause;
  }
  return parts.join(' | ');
}

async function assertSyncFails(client: Client, kind: string): Promise<void> {
  let failure: unknown;
  try {
    await runPriceSync(client, { maxAttempts: 1 });
  } catch (err) {
    failure = err;
  }
  assert(failure !== undefined, `price sync: expected a ${kind} failure, it succeeded`);
  assert(!(failure instanceof StepError), `price sync: ${failure instanceof Error ? failure.message : ''}`);
  const text = failureText(failure);
  assert(text.includes(kind), `price sync: failure does not carry "${kind}": ${text}`);
}

/** Writes the fake price source's state file; null deletes it (the fake source's own rates). */
function writeFakePrices(body: unknown): void {
  const file = join(FAKE_STATE_DIR, FAKE_PRICE_STATE_FILE);
  if (body === null) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(FAKE_STATE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(body));
}

// Local copies: root scripts must not import package sources by relative path (architecture.md section 1).
// Each value names its source; keep them in step with it.
/** packages/core/src/temporal-names.ts: TASK_QUEUE */
const TASK_QUEUE = 'agentdesk';
/** packages/core/src/temporal-names.ts: WORKFLOW.priceSync */
const PRICE_SYNC_WORKFLOW = 'PriceSyncWorkflow';
/** packages/core/src/adapters/price-source/fake.ts: FAKE_PRICE_STATE_FILE */
const FAKE_PRICE_STATE_FILE = 'price-source.json';

interface PriceRecord {
  provider: string;
  modelId: string;
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  cacheReadPerMTokUsd: number;
  cacheWritePerMTokUsd: number;
  cacheWriteLongPerMTokUsd: number;
}
/** packages/core/src/adapters/price-source/fake.ts: FAKE_PRICE_RECORDS */
const FAKE_PRICE_RECORDS: readonly PriceRecord[] = [
  {
    provider: 'anthropic',
    modelId: 'fake-model-a',
    inputPerMTokUsd: 3,
    outputPerMTokUsd: 15,
    cacheReadPerMTokUsd: 0.3,
    cacheWritePerMTokUsd: 3.75,
    cacheWriteLongPerMTokUsd: 6,
  },
  {
    provider: 'anthropic',
    modelId: 'fake-model-b',
    inputPerMTokUsd: 1,
    outputPerMTokUsd: 5,
    cacheReadPerMTokUsd: 0.1,
    cacheWritePerMTokUsd: 1.25,
    cacheWriteLongPerMTokUsd: 2,
  },
];
function doubled(r: PriceRecord): PriceRecord {
  return {
    ...r,
    inputPerMTokUsd: r.inputPerMTokUsd * 2,
    outputPerMTokUsd: r.outputPerMTokUsd * 2,
    cacheReadPerMTokUsd: r.cacheReadPerMTokUsd * 2,
    cacheWritePerMTokUsd: r.cacheWritePerMTokUsd * 2,
    cacheWriteLongPerMTokUsd: r.cacheWriteLongPerMTokUsd * 2,
  };
}

/** Restores the fake source's own rates and syncs them; ends the scenario's runs and project. */
async function priceCleanup(name: string, client: Client, s: Setup | undefined, runs: string[]): Promise<void> {
  writeFakePrices(null);
  await runPriceSync(client).catch((err: unknown) => logStep(name, `restore sync failed: ${failureText(err)}`));
  if (!s) return;
  // Every run must be final before the project can go: cancel them all, then cleanup deletes the project.
  for (const id of runs) {
    const run = await getRun(s, id).catch(() => undefined);
    if (!run || isFinal(run.status)) continue;
    await s.session.call('POST', `/api/runs/${id}/cancel`, { expect: [202, 409] }).catch(() => undefined);
    await waitForRun(s, id, isFinal, FINAL_TIMEOUT_MS).catch(() => undefined);
  }
  await cleanup(name, s, undefined);
}

/** TC-18.2, TC-18.3, TC-19.2: a price change leaves a recorded run alone and prices new calls at the new rates. */
async function priceChangeScenario(name: string): Promise<void> {
  let s: Setup | undefined;
  const runs: string[] = [];
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: TEMPORAL_NAMESPACE });
  try {
    s = await setup(name, 'webhook');
    writeFakePrices(null);
    await runPriceSync(client);
    const runA = await startUsageRun(s);
    runs.push(runA);
    const a1 = await costView(s, runA);
    assert(a1.cost !== null && a1.earliest !== null, 'run A: no cost or price date');
    logStep(name, `run A at the fake rates: ${a1.cost}`);

    writeFakePrices({ records: FAKE_PRICE_RECORDS.map(doubled) });
    await runPriceSync(client);
    assertSameCost('TC-18.2: run A after the price change', a1, await costView(s, runA));
    logStep(name, 'TC-18.2: run A unchanged after the rates doubled');

    const runB = await startUsageRun(s);
    runs.push(runB);
    const b = await costView(s, runB);
    assertClose('TC-18.3: run B costs twice run A', costOf(b), 2 * costOf(a1));
    logStep(name, `TC-18.3: run B at the new rates: ${b.cost}`);

    // Resume A (stop it, then resume) and send a line: one more 240-token call, at the doubled rates.
    await s.session.call('POST', `/api/runs/${runA}/stop`, { expect: [200, 202, 204] });
    await waitForRun(s, runA, (st) => st === 'paused' || isFinal(st), FINAL_TIMEOUT_MS);
    await s.session.call('POST', `/api/runs/${runA}/resume`, { expect: [200, 202, 204] });
    await waitForRun(s, runA, (st) => st === 'idle' || isFinal(st), IDLE_TIMEOUT_MS * 2);
    await terminalEcho(s, runA, `ok ${rand()}`);
    await waitForUsageTotal(s, runA, 3050 + 240);
    await waitForRun(s, runA, (st) => st === 'idle' || isFinal(st), IDLE_TIMEOUT_MS);
    const a2 = await costView(s, runA);
    assertClose(
      'TC-19.2: run A = its old cost + the new call at the new rates',
      costOf(a2),
      costOf(a1) + (200 * 6 + 40 * 30) / 1e6,
    );
    assert(
      a2.earliest !== null && a2.latest !== null && a2.earliest !== a2.latest,
      `TC-19.2: expected two different price instants, got ${a2.earliest} and ${a2.latest}`,
    );
    logStep(name, `TC-19.2: run A spans the change: ${a2.cost}, ${a2.earliest} to ${a2.latest}`);
  } finally {
    await priceCleanup(name, client, s, runs);
    await connection.close();
  }
}

/** TC-21.1 to TC-21.3: a failing price source changes no recorded run; new runs keep the last good rates. */
async function priceOutageScenario(name: string): Promise<void> {
  let s: Setup | undefined;
  const runs: string[] = [];
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: TEMPORAL_NAMESPACE });
  try {
    s = await setup(name, 'webhook');
    writeFakePrices(null);
    await runPriceSync(client);
    const runA = await startUsageRun(s);
    runs.push(runA);
    const a = await costView(s, runA);
    assert(a.cost !== null && a.latest !== null, 'run A: no cost or price date');

    writeFakePrices({ mode: 'outage' });
    await assertSyncFails(client, 'unreachable');
    assertSameCost('TC-21.1: run A after the outage', a, await costView(s, runA));
    const runB = await startUsageRun(s);
    runs.push(runB);
    const b = await costView(s, runB);
    assertClose('TC-21.1: run B is priced at the last good rates', costOf(b), costOf(a));
    assert(b.latest === a.latest, `TC-21.1: run B's price date ${b.latest} is not the last good ${a.latest}`);
    logStep(name, 'TC-21.1: the outage fails the sync, A unchanged, B at the last good rates and date');

    writeFakePrices({ mode: 'bad_shape' });
    await assertSyncFails(client, 'bad_shape');
    assertSameCost('TC-21.2: run A after a bad-shape source', a, await costView(s, runA));
    assertSameCost('TC-21.2: run B after a bad-shape source', b, await costView(s, runB));
    logStep(name, 'TC-21.2: bad_shape fails the sync, A and B unchanged');

    // The project runs two sessions at a time: end B (its cost is read already) to free a slot for run C.
    await s.session.call('POST', `/api/runs/${runB}/cancel`, { expect: [202] });
    await waitForRun(s, runB, isFinal, FINAL_TIMEOUT_MS);
    writeFakePrices({ mode: 'ok' });
    await runPriceSync(client);
    const runC = await startUsageRun(s);
    runs.push(runC);
    const c = await costView(s, runC);
    assert(
      c.latest !== null && b.latest !== null && Date.parse(c.latest) > Date.parse(b.latest),
      `TC-21.3: run C's price date ${c.latest} is not later than B's ${b.latest}`,
    );
    assertSameCost('TC-21.3: run A after the source recovered', a, await costView(s, runA));
    logStep(name, 'TC-21.3: the source recovered, C has a later price date, A unchanged');
  } finally {
    await priceCleanup(name, client, s, runs);
    await connection.close();
  }
}

async function main(): Promise<number> {
  console.log(`e2e-local: ${BASE} (origin ${ORIGIN}, temporal ${TEMPORAL_ADDRESS}/${TEMPORAL_NAMESPACE})`);
  const ready = await fetch(`${BASE}/readyz`).catch(() => null);
  if (!ready?.ok) {
    console.error(`e2e-local: ${BASE}/readyz is not ready; start the stack with \`pnpm dev\` first`);
    return 1;
  }

  const scenarios: [string, (name: string) => Promise<void>][] = [
    ['webhook', webhookScenario],
    ['polling', pollingScenario],
    ['failure', failureScenario],
    ['done', doneScenario],
    ['setup', setupScenario],
    ['setup-failure', setupFailureScenario],
    ['price-change', priceChangeScenario],
    ['price-outage', priceOutageScenario],
  ];
  const results: [string, boolean][] = [];
  // E2E_LOCAL_ONLY=name[,name]: run just those scenarios (a small stack cannot hold a long run of them).
  const only = (process.env['E2E_LOCAL_ONLY'] ?? '').split(',').filter(Boolean);
  for (const [name, fn] of scenarios) {
    if (only.length > 0 && !only.includes(name)) continue;
    console.log(`scenario ${name}:`);
    const started = Date.now();
    try {
      await fn(name);
      results.push([name, true]);
      console.log(`PASS ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    } catch (err) {
      results.push([name, false]);
      console.log(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
      if (!(err instanceof StepError) && err instanceof Error && err.stack) console.log(err.stack);
    }
  }
  const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
  console.log(failed.length === 0 ? 'e2e-local: all scenarios passed' : `e2e-local: FAILED: ${failed.join(', ')}`);
  return failed.length === 0 ? 0 : 1;
}

const hardStop = setTimeout(() => {
  console.error(`e2e-local: FAILED: overall timeout of ${OVERALL_TIMEOUT_MS / 1000} s exceeded`);
  process.exit(1);
}, OVERALL_TIMEOUT_MS);

main()
  .then((code) => {
    clearTimeout(hardStop);
    process.exit(code);
  })
  .catch((err: unknown) => {
    console.error('e2e-local: crashed', err);
    process.exit(1);
  });
