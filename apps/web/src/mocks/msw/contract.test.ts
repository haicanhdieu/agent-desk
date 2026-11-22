import {
  AccessDto,
  AgentDto,
  AgentModelsDto,
  AssignmentDto,
  ConnectionDto,
  InvitationDto,
  MemberDto,
  MyInvitationDto,
  OrgChecklistDto,
  PlatformAdminDto,
  PlatformMemberDto,
  PlatformOrgDto,
  PlatformProjectDto,
  RoleDto,
  IgnoredEventDto,
  PluginsDto,
  PromptPreviewDto,
  PrStatesResponse,
  ProjectConnectionDto,
  ProjectDto,
  RepoDto,
  RuleDto,
  RunDto,
  RunEventDto,
  RunListItem,
  SetupScriptDto,
  SkillDto,
  canResume,
  flattenRoutes,
  routes,
} from '@agentdesk/contracts';
// The contracts package's own default instance is what these tests exercise, so the restriction does not apply.
// eslint-disable-next-line no-restricted-imports
import { ApiError, api as defaultApi, createApi } from '@agentdesk/contracts/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  accessFixture,
  assignmentFixtures,
  invitationFixtures,
  memberFixtures,
  platformAdminFixtures,
  platformMemberFixtures,
  platformOrgFixtures,
  platformProjectFixtures,
  roleFixtures,
} from '../dto/access';
import { checklistFixtures, myInvitationFixtures, orgInvitationFixtures } from '../dto/invitations';
import { agentFixtures } from '../dto/agents';
import { agentModelsFixtures } from '../dto/agentModels';
import { connectionFixtures, repoFixtures } from '../dto/connections';
import { runEventFixtures } from '../dto/events';
import { ids } from '../dto/ids';
import { ignoredFixtures, projectConnectionFixtures, projectFixtures } from '../dto/projects';
import { ruleFixtures } from '../dto/rules';
import { runFixtures, type MockRun } from '../dto/runs';
import { prStateFixtures } from '../dto/prStates';
import { pluginFixtures, setupScriptFixtures } from '../dto/setup';
import { skillFixtures } from '../dto/skills';
import { mockDb } from './db';
import { routeHandlers } from './handlers';
import { linkedTicketsFor } from './linkedTickets';
import { scenarios } from './scenarios';

const api = createApi({ baseUrl: 'http://localhost:3000', parse: true });
const P = ids.project.invoicerApi;

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected the call to fail');
}

describe('MSW handlers cover the contract', () => {
  it('has a handler for every route key', () => {
    expect(Object.keys(routeHandlers).sort()).toEqual(Object.keys(flattenRoutes(routes)).sort());
  });

  it('every DTO fixture parses with its contracts schema', () => {
    const lists: [z.ZodType, unknown[]][] = [
      [ProjectDto, projectFixtures],
      [ProjectConnectionDto, Object.values(projectConnectionFixtures)],
      [IgnoredEventDto, Object.values(ignoredFixtures).flat()],
      [ConnectionDto, connectionFixtures],
      [RepoDto, Object.values(repoFixtures).flat()],
      [AgentDto, agentFixtures],
      [AgentModelsDto, Object.values(agentModelsFixtures)],
      [SkillDto, Object.values(skillFixtures).flat()],
      [RuleDto, ruleFixtures],
      [RunDto, runFixtures],
      [RunEventDto, Object.values(runEventFixtures).flat()],
      [SetupScriptDto, Object.values(setupScriptFixtures).flat()],
      [PluginsDto, Object.values(pluginFixtures)],
      [RoleDto, roleFixtures],
      [AssignmentDto, assignmentFixtures],
      [InvitationDto, invitationFixtures],
      [MemberDto, memberFixtures],
      [AccessDto, [accessFixture]],
      [PlatformOrgDto, platformOrgFixtures],
      [PlatformProjectDto, platformProjectFixtures],
      [PlatformMemberDto, platformMemberFixtures],
      [PlatformAdminDto, platformAdminFixtures],
      [
        PrStatesResponse,
        Object.values(prStateFixtures).map((m) => ({
          items: Object.entries(m).map(([ref, prState]) => ({ ref, prState })),
        })),
      ],
      [MyInvitationDto, Object.values(myInvitationFixtures)],
      [InvitationDto, orgInvitationFixtures],
      [OrgChecklistDto, Object.values(checklistFixtures)],
    ];
    for (const [schema, items] of lists) {
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) expect(() => schema.parse(item)).not.toThrow();
    }
  });

  it('answers the default client, which calls relative /api paths', async () => {
    await expect(defaultApi.projects.list()).resolves.toMatchObject({ total: 4, page: 1, pageSize: 20 });
  });

  it('pages projects by creation order, then id, with the real total', async () => {
    const base = mockDb.state.projects.filter((p) => p.orgId === ids.org.alice);
    const [seed] = base;
    if (!seed) throw new Error('seed has no alice project');
    const extra = Array.from({ length: 22 }, (_, i) => ({
      ...seed,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      repoPath: `dev/paged-${i}`,
      name: `paged-${i}`,
    }));
    mockDb.state.projects = [...mockDb.state.projects, ...extra];
    const first = await api.projects.list({ query: { page: 1, pageSize: 20 } });
    const second = await api.projects.list({ query: { page: 2, pageSize: 20 } });
    expect(first).toMatchObject({ total: 26, page: 1, pageSize: 20 });
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(6);
    expect(new Set([...first.items, ...second.items].map((p) => p.id)).size).toBe(26);
    await expect(api.projects.list({ query: { page: 3 } })).resolves.toMatchObject({ items: [], total: 26 });
  });

  it('serves every GET route through its response schema', async () => {
    const run = runFixtures.find((r) => r.projectId === P && r.number === 62);
    if (!run) throw new Error('fixture run 62 missing');
    await expect(api.connections.list()).resolves.toHaveLength(3);
    await expect(api.connections.repos({ params: { connectionId: ids.connection.dev } })).resolves.toContainEqual(
      expect.objectContaining({ repoPath: 'dev/demo' }),
    );
    expect((await api.projects.list()).items.map((p) => p.name)).toEqual([
      'invoicer-api',
      'invoicer-web',
      'billing-jobs',
      'docs-site',
    ]);
    await expect(api.projects.get({ params: { projectId: P } })).resolves.toMatchObject({
      // Run 62 is idle and run 64 is paused: both need a person.
      counts: { needsYou: 2, running: 2, queued: 1 },
    });
    await expect(api.projects.connection({ params: { projectId: P } })).resolves.toMatchObject({ mode: 'webhook' });
    await expect(
      api.projects.ignored({ params: { projectId: P }, query: { page: 1, pageSize: 20 } }),
    ).resolves.toMatchObject({
      page: 1,
      pageSize: 20,
      total: 5,
      items: expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]),
    });
    await expect(api.agents.get({ params: { projectId: P } })).resolves.toMatchObject({ name: 'Claude' });
    await expect(api.skills.list({ params: { projectId: P } })).resolves.toMatchObject({ total: 4 });
    await expect(api.skills.get({ params: { projectId: P, name: 'code-build' } })).resolves.toMatchObject({
      path: '.claude/skills/code-build/SKILL.md',
    });
    await expect(api.rules.list({ params: { projectId: P } })).resolves.toMatchObject({ total: 6 });
    const list = await api.runs.list({ params: { projectId: P } });
    expect(list.items.map((r) => r.number)).toEqual([66, 65, 64, 63, 62, 61, 60, 57, 56, 55, 54, 52]);
    await expect(api.runs.byNumber({ params: { projectId: P, number: 62 } })).resolves.toMatchObject({
      status: 'idle',
    });
    await expect(api.runs.get({ params: { runId: run.id } })).resolves.toMatchObject({ number: 62 });
    await expect(api.runs.log({ params: { runId: run.id } })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ type: 'lifecycle' })]),
    });
  });

  it('filters and pages runs', async () => {
    const needsYou = await api.runs.list({ params: { projectId: P }, query: { filter: 'needs_you' } });
    // The list and the project's needsYou count hold idle and paused runs.
    expect(needsYou.items.map((r) => r.number)).toEqual([64, 62]);
    const ended = await api.runs.list({ params: { projectId: P }, query: { filter: 'ended' } });
    expect(ended.items.map((r) => r.number)).toEqual([66, 65, 60, 57, 56, 55, 54, 52]);
    const page1 = await api.runs.list({ params: { projectId: P }, query: { page: 1, pageSize: 4 } });
    expect(page1.items.map((r) => r.number)).toEqual([66, 65, 64, 63]);
    expect(page1).toMatchObject({ page: 1, pageSize: 4, total: 12 });
    const page2 = await api.runs.list({ params: { projectId: P }, query: { page: 2, pageSize: 4 } });
    expect(page2.items.map((r) => r.number)).toEqual([62, 61, 60, 57]);
    const past = await api.runs.list({ params: { projectId: P }, query: { page: 9, pageSize: 4 } });
    expect(past).toMatchObject({ items: [], total: 12 });
    const byTicket = await api.runs.list({
      params: { projectId: P },
      query: { ticket: '133' },
    });
    expect(byTicket.items.map((r) => r.number)).toEqual([57, 56]);
    expect(byTicket.total).toBe(2);
    // Every item carries how many runs its ticket has had, whatever the filter.
    expect(byTicket.items.map((r) => r.ticketRunCount)).toEqual([2, 2]);
  });

  it('serves the run list numbers from the store: counts, today, the idle run and the next queued run', async () => {
    const stats = await api.runs.stats({ params: { projectId: P }, query: { since: '2000-01-01T00:00:00.000Z' } });
    expect(stats.counts).toEqual({ needs_you: 2, active: 2, queued: 1, ended: 8, all: 12, ignored: 5 });
    expect(stats.today.total).toBe(12);
    expect(stats.idleRun).toMatchObject({ number: 62, ticketRunCount: expect.any(Number) });
    expect(stats.idleRun).not.toHaveProperty('prompt');
    expect(stats.nextQueuedNumber).toBe(63);
    const none = await api.runs.stats({ params: { projectId: P }, query: { since: '2999-01-01T00:00:00.000Z' } });
    expect(none.today).toEqual({ total: 0, failed: 0 });
    await expect(api.runs.byNumber({ params: { projectId: P, number: 62 } })).resolves.toMatchObject({ number: 62 });
  });
});

describe('MSW handler semantics', () => {
  it('returns 404 problem+json with x-request-id for a missing record', async () => {
    const res = await fetch('http://localhost:3000/api/projects/' + ids.project.invoicerApi + '/runs/999');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(res.headers.get('x-request-id')).toMatch(/^req-mock-/);
    const e = await rejection(api.runs.byNumber({ params: { projectId: P, number: 999 } }));
    expect(e.status).toBe(404);
    expect(e.requestId).toMatch(/^req-mock-/);
  });

  it('putCredential sets, keeps and clears the address; models of another org agent is 404', async () => {
    const agentId = ids.agent.invoicerApi;
    const address = (): Promise<string | null> => api.agents.get({ params: { projectId: P } }).then((a) => a.baseUrl);
    await expect(address()).resolves.toBeNull();
    await api.agents.putCredential({
      params: { agentId },
      body: { type: 'api_key', value: 'sk-test', baseUrl: 'https://gw.example.com/anthropic' },
    });
    await expect(address()).resolves.toBe('https://gw.example.com/anthropic');
    await api.agents.putCredential({ params: { agentId }, body: { type: 'api_key', value: 'sk-test-2' } });
    await expect(address()).resolves.toBe('https://gw.example.com/anthropic');
    await api.agents.putCredential({
      params: { agentId },
      body: { type: 'api_key', value: 'sk-test-3', baseUrl: null },
    });
    await expect(address()).resolves.toBeNull();
    expect(JSON.stringify(mockDb.snapshot())).not.toContain('sk-test');
    const other = await rejection(api.agents.models({ params: { agentId: ids.agent.storefront } }));
    expect(other.status).toBe(404);
  });

  it('agents.models answers the scenario set for the agent and drops beforeCredentialSave after a save', async () => {
    const agentId = ids.agent.invoicerApi;
    scenarios.agentModels(agentId, {
      kind: 'live',
      ids: ['m-1'],
      beforeCredentialSave: { kind: 'fallback', reason: 'rejected' },
    });
    await expect(api.agents.models({ params: { agentId } })).resolves.toMatchObject({ reason: 'rejected' });
    await api.agents.putCredential({ params: { agentId }, body: { type: 'api_key', value: 'x' } });
    await expect(api.agents.models({ params: { agentId } })).resolves.toEqual({
      source: 'live',
      reason: null,
      models: [{ id: 'm-1', label: 'm-1' }],
    });
    scenarios.agentModels(agentId, { kind: 'error' });
    expect((await rejection(api.agents.models({ params: { agentId } }))).status).toBe(500);
  });

  it('agents.models drops the provider text of a fallback scenario: it is not part of the contract', async () => {
    const agentId = ids.agent.invoicerApi;
    scenarios.agentModels(agentId, { kind: 'fallback', reason: 'rejected', providerText: 'invalid x-api-key sk-test' });
    const answer = await api.agents.models({ params: { agentId } });
    expect(answer).toEqual({ source: 'builtin', reason: 'rejected', models: expect.any(Array) });
    expect(JSON.stringify(answer)).not.toContain('invalid x-api-key');
  });

  it('hides projects of other orgs (RLS) and switches with the active org', async () => {
    const e = await rejection(api.projects.get({ params: { projectId: ids.project.storefront } }));
    expect(e.status).toBe(404);
    mockDb.setActiveOrg(ids.org.acme);
    expect((await api.projects.list()).items.map((p) => p.name)).toEqual(['storefront']);
  });

  it('tickets.prStates answers the known refs in request order, 404 for another org, 400 for a bad ref', async () => {
    const ok = await api.tickets.prStates({ params: { projectId: P }, query: { ref: ['148', '133', '999'] } });
    expect(ok.items).toEqual([
      { ref: '148', prState: 'merged' },
      { ref: '133', prState: 'open' },
    ]);
    const other = await rejection(
      api.tickets.prStates({ params: { projectId: ids.project.storefront }, query: { ref: ['148'] } }),
    );
    expect(other.status).toBe(404);
    const res = await fetch(`http://localhost:3000/api/projects/${P}/tickets/pr-states?ref=0`);
    expect(res.status).toBe(400);
  });

  it('creates, updates and deletes rules with a 409 on a duplicate command', async () => {
    const created = await api.rules.create({
      params: { projectId: P },
      body: {
        kind: 'skill',
        command: 'docs-fix',
        labelFilter: [],
        target: 'any',
        skillName: 'code-build',
        enabled: true,
      },
    });
    expect(created.agentId).toBe(ids.agent.invoicerApi);
    const dup = await rejection(
      api.rules.create({
        params: { projectId: P },
        body: {
          kind: 'skill',
          command: 'code-build',
          labelFilter: [],
          target: 'issue',
          skillName: 'code-build',
          enabled: true,
        },
      }),
    );
    expect(dup.status).toBe(409);
    expect(dup.errors).toEqual([{ pointer: '/command', detail: expect.stringContaining('code-build') }]);
    const renamed = await rejection(
      api.rules.update({ params: { ruleId: created.id }, body: { command: 'code-review' } }),
    );
    expect(renamed.status).toBe(409);
    await expect(api.rules.update({ params: { ruleId: created.id }, body: { enabled: false } })).resolves.toMatchObject(
      {
        enabled: false,
      },
    );
    await expect(api.rules.remove({ params: { ruleId: created.id } })).resolves.toBeNull();
    expect((await rejection(api.rules.remove({ params: { ruleId: created.id } }))).status).toBe(404);
  });

  it('creates a prompt rule and serves the prompt preview', async () => {
    const created = await api.rules.create({
      params: { projectId: P },
      body: { kind: 'prompt', command: 'sweep', labelFilter: [], target: 'issue', prompt: 'Sweep it.', enabled: true },
    });
    expect(created).toMatchObject({ kind: 'prompt', prompt: 'Sweep it.', skillName: null });
    const switched = await api.rules.update({
      params: { ruleId: created.id },
      body: { kind: 'skill', skillName: 'code-build' },
    });
    expect(switched).toMatchObject({ kind: 'skill', skillName: 'code-build', prompt: null });
    const preview = await api.rules.promptPreview({ params: { projectId: P } });
    expect(() => PromptPreviewDto.parse(preview)).not.toThrow();
    expect(preview.systemLines).toHaveLength(5);
    expect(preview.systemLines[0]).toContain('harbor-labs/invoicer-api');
    expect(preview.systemLines[4]).toContain('agentdesk-status');
  });

  it('rejects an invalid body with field pointers', async () => {
    const res = await fetch(`http://localhost:3000/api/projects/${P}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'skill',
        command: 'Bad Command',
        labelFilter: [],
        target: 'any',
        skillName: 'x',
        enabled: true,
      }),
    });
    expect(res.status).toBe(400);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ errors: [expect.objectContaining({ pointer: '/command' })] });
  });

  it('mints the first created project id, then its agent id (e2e/mock/mock.ts FIRST_CREATED_AGENT relies on it)', async () => {
    const p = await api.projects.create({
      body: { connectionId: ids.connection.dev, repoPath: 'dev/demo', triggerMode: 'polling' },
    });
    expect(p.id).toBe(ids.created(1));
    const agent = await api.agents.get({ params: { projectId: p.id } });
    expect(agent.id).toBe(ids.created(2));
  });

  it('creates a project at setup step agent with an agent and a connection', async () => {
    const p = await api.projects.create({
      body: {
        connectionId: ids.connection.dev,
        repoPath: 'dev/demo',
        triggerMode: 'polling',
        pollIntervalSeconds: 600,
      },
    });
    expect(p).toMatchObject({ name: 'demo', setupStep: 'agent', pollIntervalSeconds: 600, counts: { needsYou: 0 } });
    await expect(api.projects.connection({ params: { projectId: p.id } })).resolves.toMatchObject({
      mode: 'polling',
      polling: { intervalSeconds: 600 },
    });
    const agent = await api.agents.get({ params: { projectId: p.id } });
    expect(agent.credential.set).toBe(false);
    const cred = await api.agents.putCredential({
      params: { agentId: agent.id },
      body: { type: 'api_key', value: 'sk-test' },
    });
    expect(JSON.stringify(mockDb.snapshot())).not.toContain('sk-test');
    await expect(api.agents.get({ params: { projectId: p.id } })).resolves.toMatchObject({
      credential: { set: true, type: 'api_key', updatedAt: cred.updatedAt, setBy: 'alice' },
    });
    await expect(
      api.projects.update({ params: { projectId: p.id }, body: { setupStep: 'skills', triggerMode: 'webhook' } }),
    ).resolves.toMatchObject({ setupStep: 'skills', triggerMode: 'webhook' });
    await expect(api.projects.remove({ params: { projectId: p.id } })).resolves.toBeNull();
    expect((await rejection(api.projects.get({ params: { projectId: p.id } }))).status).toBe(404);
  });

  it('commits skills with a sha check', async () => {
    const skill = await api.skills.get({ params: { projectId: P, name: 'code-review' } });
    const stale = await rejection(
      api.skills.put({
        params: { projectId: P, name: 'code-review' },
        body: { body: 'x', message: 'edit', sha: 'not-the-sha' },
      }),
    );
    expect(stale.status).toBe(409);
    const { commitSha } = await api.skills.put({
      params: { projectId: P, name: 'code-review' },
      body: { body: '---\nname: code-review\ndescription: New text\n---\n', message: 'edit', sha: skill.sha },
    });
    await expect(api.skills.get({ params: { projectId: P, name: 'code-review' } })).resolves.toMatchObject({
      sha: commitSha,
      description: 'New text',
      lastCommit: { sha: commitSha, message: 'edit' },
    });
    await expect(api.skills.remove({ params: { projectId: P, name: 'code-review' }, query: {} })).resolves.toBeNull();
    await expect(api.skills.list({ params: { projectId: P } })).resolves.toMatchObject({ total: 3 });
  });

  it('runs.transcript pages newest-first windows oldest first and runs.stop answers 202 on a live run', async () => {
    const live = await api.runs.byNumber({ params: { projectId: P, number: 61 } });
    const paused = await api.runs.byNumber({ params: { projectId: P, number: 64 } });
    const stored = mockDb.state.runs.find((r) => r.id === live.id);
    if (!stored) throw new Error('run 61 missing');
    stored.status = 'idle';
    stored.sessionEndingAt = null;
    mockDb.state.runTranscripts[live.id] = [1, 2, 3, 4, 5].map((seq) => ({
      seq,
      at: '2026-11-19T14:00:00.000Z',
      kind: 'agent',
      tool: null,
      text: `message ${seq}`,
      truncated: false,
    }));
    const page = async (query: { before?: number; limit?: number }) => {
      const r = await api.runs.transcript({ params: { runId: live.id }, query: { limit: 200, ...query } });
      return { seqs: r.items.map((i) => i.seq), nextBefore: r.nextBefore };
    };
    await expect(page({ limit: 2 })).resolves.toEqual({ seqs: [4, 5], nextBefore: 4 });
    await expect(page({ before: 4, limit: 2 })).resolves.toEqual({ seqs: [2, 3], nextBefore: 2 });
    await expect(page({ before: 2 })).resolves.toEqual({ seqs: [1], nextBefore: null });
    await expect(api.runs.stop({ params: { runId: live.id } })).resolves.toBeNull();
    const refused = await rejection(api.runs.stop({ params: { runId: paused.id } }));
    expect(refused).toMatchObject({ status: 409, title: 'Only a live session can be stopped' });
  });

  it('cancels and finishes runs with 202 and 409 when already ended', async () => {
    const run61 = await api.runs.byNumber({ params: { projectId: P, number: 61 } });
    const run62 = await api.runs.byNumber({ params: { projectId: P, number: 62 } });
    const res = await fetch(`http://localhost:3000/api/runs/${run61.id}/cancel`, { method: 'POST' });
    expect(res.status).toBe(202);
    await expect(api.runs.get({ params: { runId: run61.id } })).resolves.toMatchObject({ status: 'cancelled' });
    await expect(api.runs.finish({ params: { runId: run62.id } })).resolves.toBeNull();
    await expect(api.runs.get({ params: { runId: run62.id } })).resolves.toMatchObject({
      status: 'succeeded',
      exitCode: 0,
    });
    const again = await rejection(api.runs.cancel({ params: { runId: run62.id } }));
    expect(again).toMatchObject({ status: 409, title: 'Run already ended' });
    await expect(api.projects.get({ params: { projectId: P } })).resolves.toMatchObject({
      // Run 64 is still paused, so it still needs a person.
      counts: { needsYou: 1, running: 0, queued: 1 },
    });
  });

  it('answers 201 with the new org when a platform admin creates one', async () => {
    const admin = mockDb.state.users[0];
    if (admin) admin.platformAdmin = true;
    const res = await fetch('http://localhost:3000/api/platform/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Globex', slug: 'globex' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'Globex', slug: 'globex' });
  });

  it('grants and revokes platform admins: repeat 200, unknown 404, last-admin 409', async () => {
    const me = mockDb.state.users[0];
    if (me) me.platformAdmin = true;
    const base = 'http://localhost:3000/api/platform/admins';
    const post = (email: string) =>
      fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    const granted = platformAdminFixtures.find((a) => a.grantedBy !== null);
    if (!granted) throw new Error('no granted fixture');

    const repeat = await post(granted.email);
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({ id: granted.id });

    const unknown = await post('nobody@example.org');
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ errors: [{ pointer: '/email' }] });

    const created = await post('alice@example.com');
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ email: 'alice@example.com', userId: ids.user.alice });

    const listed = PlatformAdminDto.array().parse(((await (await fetch(base)).json()) as { items: unknown[] }).items);
    expect(listed).toHaveLength(platformAdminFixtures.length + 1);
    let remaining = listed;
    while (remaining.filter((a) => a.userId !== null).length > 1) {
      const target = remaining.find((a) => a.userId === null) ?? remaining.find((a) => a.userId !== null);
      if (!target) throw new Error('empty');
      expect((await fetch(`${base}/${target.id}`, { method: 'DELETE' })).status).toBe(204);
      remaining = remaining.filter((a) => a.id !== target.id);
    }
    const last = remaining.find((a) => a.userId !== null);
    if (!last) throw new Error('no working entry');
    expect((await fetch(`${base}/${last.id}`, { method: 'DELETE' })).status).toBe(409);
    const random = await fetch(`${base}/${crypto.randomUUID()}`, { method: 'DELETE' });
    expect(random.status).toBe(404);
  });

  it('answers 404 on /email when granting a seeded email that has no account, entry unchanged', async () => {
    const me = mockDb.state.users[0];
    if (me) me.platformAdmin = true;
    const base = 'http://localhost:3000/api/platform/admins';
    const seeded = platformAdminFixtures.find((a) => a.userId === null);
    if (!seeded) throw new Error('no accountless fixture');
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: seeded.email }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ errors: [{ pointer: '/email' }] });
    const listed = PlatformAdminDto.array().parse(((await (await fetch(base)).json()) as { items: unknown[] }).items);
    expect(listed.find((a) => a.id === seeded.id)).toMatchObject({ userId: null, email: seeded.email });
    expect(listed).toHaveLength(platformAdminFixtures.length);
  });

  it('finishes a done run, and answers 409 for a run that is only running', async () => {
    const run61 = await api.runs.byNumber({ params: { projectId: P, number: 61 } });
    const run62 = await api.runs.byNumber({ params: { projectId: P, number: 62 } });
    const row = mockDb.state.runs.find((r) => r.id === run62.id);
    if (!row) throw new Error('run 62 missing');
    row.status = 'done';
    row.agentNote = 'Export is ready';
    const done = await api.runs.get({ params: { runId: run62.id } });
    expect(done).toMatchObject({ status: 'done', agentNote: 'Export is ready', waitingOn: null });

    const notFinishable = await rejection(api.runs.finish({ params: { runId: run61.id } }));
    expect(notFinishable.status).toBe(409);
    await expect(api.runs.get({ params: { runId: run61.id } })).resolves.toMatchObject({ status: 'running' });

    await expect(api.runs.finish({ params: { runId: run62.id } })).resolves.toBeNull();
    await expect(api.runs.get({ params: { runId: run62.id } })).resolves.toMatchObject({ status: 'succeeded' });
  });

  describe('resume', () => {
    const runOf = (n: number) => api.runs.byNumber({ params: { projectId: P, number: n } });
    const resume = async (n: number) => api.runs.resume({ params: { runId: (await runOf(n)).id } });

    it('resumes a paused run: 204, queued again, pause and expiry cleared', async () => {
      const run = await runOf(64);
      expect(run).toMatchObject({ status: 'paused' });
      const res = await fetch(`http://localhost:3000/api/runs/${run.id}/resume`, { method: 'POST' });
      expect(res.status).toBe(204);
      await expect(api.runs.get({ params: { runId: run.id } })).resolves.toMatchObject({
        status: 'queued',
        pausedAt: null,
        sessionExpiresAt: null,
        finishedAt: null,
      });
      await expect(api.projects.get({ params: { projectId: P } })).resolves.toMatchObject({
        counts: { queued: 2 },
      });
    });

    it('re-opens a succeeded run whose session is still kept', async () => {
      await expect(resume(65)).resolves.toBeNull();
      await expect(runOf(65)).resolves.toMatchObject({ status: 'queued', finishedAt: null });
    });

    it('a reopened session is a flag on a succeeded run: Cancel, Stop and Finish are 409, Close session saves it with a fresh keep time', async () => {
      const before = await runOf(65);
      await resume(65);
      const row = mockDb.state.runs.find((r) => r.id === before.id);
      if (!row) throw new Error('run 65 missing');
      row.status = 'done';
      await expect(api.runs.get({ params: { runId: before.id } })).resolves.toMatchObject({
        status: 'done',
        reopenedAt: expect.any(String),
      });
      for (const call of [api.runs.cancel, api.runs.stop, api.runs.finish]) {
        expect(await rejection(call({ params: { runId: before.id } }))).toMatchObject({ status: 409 });
      }
      await expect(api.runs.closeSession({ params: { runId: before.id } })).resolves.toBeNull();
      const after = await api.runs.get({ params: { runId: before.id } });
      expect(before.sessionExpiresAt).not.toBeNull();
      expect(after).toMatchObject({ status: 'succeeded', reopenedAt: null });
      expect(Date.parse(after.sessionExpiresAt ?? '')).toBeGreaterThan(Date.parse(before.sessionExpiresAt ?? ''));
      expect(canResume(after, new Date())).toBe(true);
      // And it can be reopened and closed again.
      await expect(resume(65)).resolves.toBeNull();
    });

    it('Close session is a 409 on a run that is not reopened', async () => {
      const run = await runOf(65);
      expect(await rejection(api.runs.closeSession({ params: { runId: run.id } }))).toMatchObject({ status: 409 });
    });

    it('Finish on a fresh Done run keeps the disk for the normal keep time', async () => {
      const row = mockDb.state.runs.find((r) => r.number === 61);
      if (!row) throw new Error('run 61 missing');
      row.status = 'done';
      await expect(api.runs.finish({ params: { runId: row.id } })).resolves.toBeNull();
      const after = await api.runs.get({ params: { runId: row.id } });
      expect(after.status).toBe('succeeded');
      expect(canResume(after, new Date())).toBe(true);
    });

    it('finishing a paused run that was resumed ends it for good, with no kept session', async () => {
      const before = await runOf(64);
      await resume(64);
      const row = mockDb.state.runs.find((r) => r.id === before.id);
      if (!row) throw new Error('run 64 missing');
      row.status = 'done';
      await expect(api.runs.finish({ params: { runId: before.id } })).resolves.toBeNull();
      const after = await api.runs.get({ params: { runId: before.id } });
      expect(after).toMatchObject({ status: 'succeeded', sessionExpiresAt: null });
      expect(canResume(after, new Date())).toBe(false);
    });

    it('a second resume is a 409 saying it is already being resumed', async () => {
      await resume(64);
      expect(await rejection(resume(64))).toMatchObject({ status: 409, title: 'This run is already being resumed' });
    });

    it('409 for an expired run, a succeeded run without a kept session and a running run', async () => {
      const message = 'Only a paused run, or a finished run whose session is still kept, can be resumed';
      expect(await rejection(resume(66))).toMatchObject({ status: 409, title: message });
      expect(await rejection(resume(60))).toMatchObject({ status: 409, title: message });
      expect(await rejection(resume(61))).toMatchObject({ status: 409, title: message });
      const kept = mockDb.state.runs.find((r) => r.number === 65);
      if (!kept) throw new Error('run 65 missing');
      kept.sessionExpiresAt = new Date(Date.now() - 1000).toISOString();
      expect(await rejection(resume(65))).toMatchObject({ status: 409, title: message });
    });

    it('409 when the project has no agent credential', async () => {
      const agent = mockDb.state.agents.find((a) => a.projectId === P);
      if (!agent) throw new Error('agent missing');
      agent.credential = { set: false, type: null, updatedAt: null, setBy: null };
      expect(await rejection(resume(64))).toMatchObject({
        status: 409,
        title: 'This project has no agent credential, so the run cannot be resumed',
      });
      await expect(runOf(64)).resolves.toMatchObject({ status: 'paused' });
    });

    it('a run of another org is not found', async () => {
      const res = await fetch('http://localhost:3000/api/runs/00000000-0000-4000-8000-00000000dead/resume', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });
  });

  it('serves waitingOn on a running run', async () => {
    const run61 = await api.runs.byNumber({ params: { projectId: P, number: 61 } });
    const row = mockDb.state.runs.find((r) => r.id === run61.id);
    if (!row) throw new Error('run 61 missing');
    row.waitingOn = 'background';
    await expect(api.runs.get({ params: { runId: run61.id } })).resolves.toMatchObject({ waitingOn: 'background' });
  });

  describe('workspace setup', () => {
    const EMPTY = ids.project.docsSite;
    const sha256 = async (text: string) =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    it('serves the saved script, its versions (newest first) and the plugins; a project without a script gets null', async () => {
      await expect(api.setupScript.get({ params: { projectId: P } })).resolves.toMatchObject({ version: 1 });
      await expect(api.setupScript.get({ params: { projectId: EMPTY } })).resolves.toBeNull();
      await expect(
        api.setupScript.versions({ params: { projectId: P }, query: { page: 1, pageSize: 20 } }),
      ).resolves.toMatchObject({
        total: 1,
        items: [expect.objectContaining({ version: 1, createdBy: 'kim-hale' })],
      });
      await expect(api.setupScript.version({ params: { projectId: P, version: 1 } })).resolves.toMatchObject({
        version: 1,
        body: expect.stringContaining('set -euo pipefail'),
      });
      expect((await rejection(api.setupScript.version({ params: { projectId: P, version: 9 } }))).status).toBe(404);
      await expect(api.setup.plugins({ params: { projectId: P } })).resolves.toMatchObject({
        plugins: [{ state: 'will_install' }, { state: 'will_install' }, { state: 'blocked' }],
      });
      await expect(api.setup.plugins({ params: { projectId: EMPTY } })).resolves.toMatchObject({ plugins: [] });
      await expect(api.setupTests.latest({ params: { projectId: P } })).resolves.toBeNull();
    });

    it('puts a new version against baseVersion; a stale or wrong base is a 409; the body limit is in bytes', async () => {
      const first = await api.setupScript.put({ params: { projectId: EMPTY }, body: { body: 'a', baseVersion: null } });
      expect(first).toMatchObject({ version: 1, note: null, createdBy: 'alice' });
      const second = await api.setupScript.put({
        params: { projectId: EMPTY },
        body: { body: 'b', note: 'Second', baseVersion: 1 },
      });
      expect(second).toMatchObject({ version: 2, note: 'Second' });
      expect(
        (await rejection(api.setupScript.put({ params: { projectId: EMPTY }, body: { body: 'c', baseVersion: 1 } })))
          .status,
      ).toBe(409);
      expect(
        (await rejection(api.setupScript.put({ params: { projectId: EMPTY }, body: { body: 'c', baseVersion: null } })))
          .status,
      ).toBe(409);
      const tooBig = await rejection(
        api.setupScript.put({ params: { projectId: EMPTY }, body: { body: 'é'.repeat(32768) + 'a', baseVersion: 2 } }),
      );
      expect(tooBig).toMatchObject({
        status: 400,
        errors: [{ pointer: '/body', detail: 'Setup script is larger than 64 KiB' }],
      });
      await expect(
        api.setupScript.versions({ params: { projectId: EMPTY }, query: { page: 1, pageSize: 20 } }),
      ).resolves.toMatchObject({
        total: 2,
        items: [expect.objectContaining({ version: 2 }), expect.objectContaining({ version: 1 })],
      });
      // Page 2 of size 1 is version 1; past the end is empty with the real total.
      await expect(
        api.setupScript.versions({ params: { projectId: EMPTY }, query: { page: 2, pageSize: 1 } }),
      ).resolves.toMatchObject({ total: 2, items: [expect.objectContaining({ version: 1 })] });
      await expect(
        api.setupScript.versions({ params: { projectId: EMPTY }, query: { page: 3, pageSize: 1 } }),
      ).resolves.toMatchObject({ total: 2, items: [] });
    });

    it('state is part of the store: it does not survive a reset (no leak between tests)', async () => {
      await expect(api.setupScript.get({ params: { projectId: EMPTY } })).resolves.toBeNull();
      await expect(api.setupTests.latest({ params: { projectId: P } })).resolves.toBeNull();
      expect(mockDb.snapshot().setupScripts[EMPTY]).toBeUndefined();
    });

    it('a test carries the real sha-256 of the script and matches the current script by hash, never the text', async () => {
      const current = await api.setupScript.get({ params: { projectId: P } });
      if (!current) throw new Error('fixture script missing');
      const same = await api.setupTests.create({ params: { projectId: P }, body: { script: current.body } });
      expect(same).toMatchObject({ status: 'queued', matchesCurrentScript: true, startedBy: 'alice', exitCode: null });
      expect(same.scriptSha256).toBe(await sha256(current.body));
      expect(JSON.stringify(same)).not.toContain('set -euo');
      const draft = await api.setupTests.create({ params: { projectId: P }, body: { script: 'echo draft' } });
      expect(draft).toMatchObject({ matchesCurrentScript: false, scriptSha256: await sha256('echo draft') });
      // Creating a test ends the previous one; latest is the newest.
      expect(mockDb.state.setupTests.find((t) => t.id === same.id)?.status).toBe('ended');
      await expect(api.setupTests.latest({ params: { projectId: P } })).resolves.toMatchObject({ id: draft.id });
      // Saving the draft makes the test match the current script.
      await api.setupScript.put({ params: { projectId: P }, body: { body: 'echo draft', baseVersion: 1 } });
      await expect(api.setupTests.latest({ params: { projectId: P } })).resolves.toMatchObject({
        matchesCurrentScript: true,
      });
    });

    it('end answers 202 and marks the test ended; a missing test is a 404', async () => {
      const t = await api.setupTests.create({ params: { projectId: P }, body: { script: 'x' } });
      const res = await fetch(`http://localhost:3000/api/setup-tests/${t.id}/end`, { method: 'POST' });
      expect(res.status).toBe(202);
      await expect(api.setupTests.latest({ params: { projectId: P } })).resolves.toMatchObject({
        status: 'ended',
        endedAt: expect.any(String),
      });
      const missing = await rejection(api.setupTests.end({ params: { setupTestId: ids.created(999) } }));
      expect(missing.status).toBe(404);
    });

    it("hides other orgs' projects", async () => {
      const e = await rejection(api.setupScript.get({ params: { projectId: ids.project.storefront } }));
      expect(e.status).toBe(404);
    });
  });

  it('records requests for assertions', async () => {
    await api.projects.list();
    expect(mockDb.requests('GET', '/api/projects')).toBe(1);
  });
});

describe('scenarios', () => {
  it('signedOut makes API calls 401 and get-session null', async () => {
    scenarios.signedOut();
    expect((await rejection(api.projects.list())).status).toBe(401);
    const res = await fetch('http://localhost:3000/auth/get-session');
    expect(await res.json()).toBeNull();
  });

  it('serverError returns a 500 problem for one route only', async () => {
    scenarios.serverError('rules.update');
    const e = await rejection(api.rules.update({ params: { ruleId: ids.rule.r1 }, body: { enabled: false } }));
    expect(e.status).toBe(500);
    expect(e.requestId).toMatch(/^req-mock-/);
    await expect(api.rules.list({ params: { projectId: P } })).resolves.toMatchObject({ total: 6 });
  });

  it('problem returns the given problem', async () => {
    scenarios.problem('runs.cancel', { status: 409, title: 'Run already ended' });
    const run = await api.runs.byNumber({ params: { projectId: P, number: 61 } });
    await expect(rejection(api.runs.cancel({ params: { runId: run.id } }))).resolves.toMatchObject({
      status: 409,
      title: 'Run already ended',
    });
  });

  it('overrides and db changes reset between tests', async () => {
    await expect(api.rules.list({ params: { projectId: P } })).resolves.toMatchObject({ total: 6 });
    await expect(api.projects.list()).resolves.toMatchObject({ total: 4 });
  });
});

describe('better-auth endpoints', () => {
  const base = 'http://localhost:3000/auth';
  const json = (path: string, body?: unknown) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });

  it('returns the session with the active org and the user handle', async () => {
    const res = await json('/get-session');
    expect(await res.json()).toMatchObject({
      session: { userId: ids.user.alice, activeOrganizationId: ids.org.alice },
      user: { id: ids.user.alice, handle: 'alice' },
    });
  });

  it('lists orgs and sets the active one by id or slug', async () => {
    const orgs: unknown = await (await json('/organization/list')).json();
    expect(orgs).toEqual([
      expect.objectContaining({ slug: 'alice' }),
      expect.objectContaining({ id: ids.org.acme, slug: 'acme' }),
    ]);
    const set = await json('/organization/set-active', { organizationSlug: 'acme' });
    expect(await set.json()).toMatchObject({ id: ids.org.acme });
    expect(mockDb.requests('POST', '/auth/organization/set-active')).toBe(1);
    expect(await (await json('/get-session')).json()).toMatchObject({
      session: { activeOrganizationId: ids.org.acme },
    });
    const denied = await json('/organization/set-active', { organizationId: 'org-stranger' });
    expect(denied.status).toBe(403);
  });

  it('signs out and back in through the social endpoint', async () => {
    expect(await (await json('/sign-out', {})).json()).toEqual({ success: true });
    expect(await (await json('/get-session')).json()).toBeNull();
    expect((await json('/organization/list')).status).toBe(401);
    const signIn = await json('/sign-in/social', { provider: 'github', callbackURL: '/o/alice/projects' });
    expect(await signIn.json()).toEqual({ url: '/o/alice/projects', redirect: true });
    expect(await (await json('/get-session')).json()).toMatchObject({ user: { handle: 'alice' } });
  });
});

describe('runs.list linkedTickets follow the API rules', () => {
  const base = runFixtures[0];
  if (!base) throw new Error('no run fixtures');
  let seq = 0;
  /** A run of a ticket; `at` orders queuedAt (higher = newer). */
  const mk = (kind: 'issue' | 'pr', number: number, at: number, linked?: number[]): MockRun => {
    seq += 1;
    return {
      ...base,
      id: `f0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
      number: seq,
      queuedAt: new Date(Date.UTC(2026, 10, 12, 10, at)).toISOString(),
      ticket: {
        ref: String(number),
        kind,
        number,
        title: `${kind} ${number}`,
        url: `https://github.com/o/r/${kind === 'pr' ? 'pull' : 'issues'}/${number}`,
        labels: [],
      },
      ...(linked ? { linkedIssueRefs: linked.map(String) } : {}),
    };
  };
  const refs = (run: MockRun, all: MockRun[]) => linkedTicketsFor(run, all).map((t) => `${t.kind}:${t.number}`);

  it('with the default fixtures, run 62 (PR #148) lists issue 142 and run 60 lists PR 148', async () => {
    const list = await api.runs.list({ params: { projectId: P } });
    const of = (n: number) => list.items.find((r) => r.number === n)?.linkedTickets;
    expect(of(62)).toMatchObject([{ kind: 'issue', number: 142, ticketRunCount: 1 }]);
    expect(of(60)).toMatchObject([{ kind: 'pr', number: 148, ticketRunCount: 1 }]);
  });

  it('a PR whose linked issue has no runs gives []', () => {
    const pr = mk('pr', 10, 1, [5]);
    expect(refs(pr, [pr])).toEqual([]);
  });

  it('a PR run with an empty snapshot gives [] when a newer run of the PR is linked', () => {
    const issue = mk('issue', 5, 0);
    const old = mk('pr', 10, 1);
    const fresh = mk('pr', 10, 2, [5]);
    expect(refs(old, [issue, old, fresh])).toEqual([]);
    expect(refs(fresh, [issue, old, fresh])).toEqual(['issue:5']);
  });

  it('the newest linked run decides the lead', () => {
    const i5 = mk('issue', 5, 0);
    const i6 = mk('issue', 6, 0);
    const a = mk('pr', 10, 1, [5]);
    const b = mk('pr', 10, 2, [6]);
    expect(refs(b, [i5, i6, a, b])).toEqual(['issue:6']);
    expect(refs(i5, [i5, i6, a, b])).toEqual([]);
    expect(refs(i6, [i5, i6, a, b])).toEqual(['pr:10']);
  });

  it('a PR linked to two issues joins the lower one', () => {
    const i5 = mk('issue', 5, 0);
    const i6 = mk('issue', 6, 0);
    const pr = mk('pr', 10, 1, [6, 5]);
    expect(refs(pr, [i5, i6, pr])).toEqual(['issue:5']);
    expect(refs(i6, [i5, i6, pr])).toEqual([]);
  });

  it('an issue with two PRs lists them by number, and a PR lists the issue then the other PRs', () => {
    const issue = mk('issue', 5, 0);
    const p12 = mk('pr', 12, 1, [5]);
    const p10 = mk('pr', 10, 2, [5]);
    const all = [issue, p12, p10];
    expect(refs(issue, all)).toEqual(['pr:10', 'pr:12']);
    expect(refs(p12, all)).toEqual(['issue:5', 'pr:10']);
    expect(refs(p10, all)).toEqual(['issue:5', 'pr:12']);
  });

  it('a ref whose newest run is a PR is never a lead', () => {
    const asIssue = mk('issue', 5, 0);
    const asPr = mk('pr', 5, 1);
    const pr = mk('pr', 10, 2, [5]);
    expect(refs(pr, [asIssue, asPr, pr])).toEqual([]);
  });

  it('counts the runs of each linked ticket and takes title and url from its newest run', () => {
    const i1 = mk('issue', 5, 0);
    const i2 = mk('issue', 5, 1);
    const pr = mk('pr', 10, 2, [5]);
    expect(linkedTicketsFor(pr, [i1, i2, pr])).toEqual([
      { ref: '5', kind: 'issue', number: 5, title: 'issue 5', url: i2.ticket.url, labels: [], ticketRunCount: 2 },
    ]);
  });

  it('every runs.list and runs.stats response parses against the contract and leaks no mock field', async () => {
    const list = await api.runs.list({ params: { projectId: P } });
    expect(() => list.items.forEach((r) => RunListItem.parse(r))).not.toThrow();
    const raw = await (await fetch(`http://localhost:3000/api/projects/${P}/runs`)).json();
    const items = z.object({ items: z.array(z.record(z.string(), z.unknown())) }).parse(raw).items;
    expect(items.some((r) => 'linkedIssueRefs' in r)).toBe(false);
    const stats = await api.runs.stats({ params: { projectId: P }, query: { since: '2000-01-01T00:00:00.000Z' } });
    expect(stats.idleRun === null || RunListItem.safeParse(stats.idleRun).success).toBe(true);
  });
});
