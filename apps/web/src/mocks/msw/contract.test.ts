import {
  AgentDto,
  ConnectionDto,
  IgnoredEventDto,
  ProjectConnectionDto,
  ProjectDto,
  RepoDto,
  RuleDto,
  RunDto,
  RunEventDto,
  SkillDto,
  flattenRoutes,
  routes,
} from '@agentdesk/contracts';
import { ApiError, api as defaultApi, createApi } from '@agentdesk/contracts/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { agentFixtures } from '../dto/agents';
import { connectionFixtures, repoFixtures } from '../dto/connections';
import { runEventFixtures } from '../dto/events';
import { ids } from '../dto/ids';
import { ignoredFixtures, projectConnectionFixtures, projectFixtures } from '../dto/projects';
import { ruleFixtures } from '../dto/rules';
import { runFixtures } from '../dto/runs';
import { skillFixtures } from '../dto/skills';
import { mockDb } from './db';
import { routeHandlers } from './handlers';
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
      [SkillDto, Object.values(skillFixtures).flat()],
      [RuleDto, ruleFixtures],
      [RunDto, runFixtures],
      [RunEventDto, Object.values(runEventFixtures).flat()],
    ];
    for (const [schema, items] of lists) {
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) expect(() => schema.parse(item)).not.toThrow();
    }
  });

  it('answers the default client, which calls relative /api paths', async () => {
    await expect(defaultApi.projects.list()).resolves.toHaveLength(4);
  });

  it('serves every GET route through its response schema', async () => {
    const run = runFixtures.find((r) => r.projectId === P && r.number === 62);
    if (!run) throw new Error('fixture run 62 missing');
    await expect(api.connections.list()).resolves.toHaveLength(3);
    await expect(api.connections.repos({ params: { connectionId: ids.connection.dev } })).resolves.toContainEqual(
      expect.objectContaining({ repoPath: 'dev/demo' }),
    );
    expect((await api.projects.list()).map((p) => p.name)).toEqual([
      'invoicer-api',
      'invoicer-web',
      'docs-site',
      'billing-jobs',
    ]);
    await expect(api.projects.get({ params: { projectId: P } })).resolves.toMatchObject({
      counts: { needsYou: 1, running: 1, queued: 1 },
    });
    await expect(api.projects.connection({ params: { projectId: P } })).resolves.toMatchObject({ mode: 'webhook' });
    await expect(api.projects.ignored({ params: { projectId: P } })).resolves.toHaveLength(5);
    await expect(api.agents.get({ params: { projectId: P } })).resolves.toMatchObject({ name: 'Claude' });
    await expect(api.skills.list({ params: { projectId: P } })).resolves.toHaveLength(4);
    await expect(api.skills.get({ params: { projectId: P, name: 'code-build' } })).resolves.toMatchObject({
      path: '.claude/skills/code-build/SKILL.md',
    });
    await expect(api.rules.list({ params: { projectId: P } })).resolves.toHaveLength(5);
    const list = await api.runs.list({ params: { projectId: P } });
    expect(list.items.map((r) => r.number)).toEqual([63, 62, 61, 60, 57, 56, 55, 54, 52]);
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
    expect(needsYou.items.map((r) => r.number)).toEqual([62]);
    const ended = await api.runs.list({ params: { projectId: P }, query: { filter: 'ended' } });
    expect(ended.items.map((r) => r.number)).toEqual([60, 57, 56, 55, 54, 52]);
    const page1 = await api.runs.list({ params: { projectId: P }, query: { limit: 4 } });
    expect(page1.items.map((r) => r.number)).toEqual([63, 62, 61, 60]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await api.runs.list({
      params: { projectId: P },
      query: { limit: 4, cursor: page1.nextCursor ?? undefined },
    });
    expect(page2.items.map((r) => r.number)).toEqual([57, 56, 55, 54]);
    const byTicket = await api.runs.list({
      params: { projectId: P },
      query: { ticket: 'harbor-labs/invoicer-api#133' },
    });
    expect(byTicket.items.map((r) => r.number)).toEqual([57, 56]);
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

  it('hides projects of other orgs (RLS) and switches with the active org', async () => {
    const e = await rejection(api.projects.get({ params: { projectId: ids.project.storefront } }));
    expect(e.status).toBe(404);
    mockDb.setActiveOrg(ids.org.acme);
    expect((await api.projects.list()).map((p) => p.name)).toEqual(['storefront']);
  });

  it('creates, updates and deletes rules with a 409 on a duplicate command', async () => {
    const created = await api.rules.create({
      params: { projectId: P },
      body: { command: 'docs-fix', labelFilter: [], target: 'any', skillName: 'code-build', enabled: true },
    });
    expect(created.agentId).toBe(ids.agent.invoicerApi);
    const dup = await rejection(
      api.rules.create({
        params: { projectId: P },
        body: { command: 'code-build', labelFilter: [], target: 'issue', skillName: 'code-build', enabled: true },
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

  it('rejects an invalid body with field pointers', async () => {
    const res = await fetch(`http://localhost:3000/api/projects/${P}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'Bad Command', labelFilter: [], target: 'any', skillName: 'x', enabled: true }),
    });
    expect(res.status).toBe(400);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ errors: [expect.objectContaining({ pointer: '/command' })] });
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
    await expect(api.skills.list({ params: { projectId: P } })).resolves.toHaveLength(3);
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
      counts: { needsYou: 0, running: 0, queued: 1 },
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
    await expect(api.rules.list({ params: { projectId: P } })).resolves.toHaveLength(5);
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
    await expect(api.rules.list({ params: { projectId: P } })).resolves.toHaveLength(5);
    await expect(api.projects.list()).resolves.toHaveLength(4);
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
