// The contracts package's own client is what these tests drive; the restriction is for app code.
import { createApi } from '@agentdesk/contracts/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toConnectionStatus } from '../../features/projects/map';
import { ids } from '../dto/ids';
import { AuthOrganization, GetSessionResponse } from './auth-handlers';
import { mockDb } from './db';
import {
  FOREIGN,
  MARKER,
  SHELL_KEY,
  SHELL_SCENARIOS,
  applyShellScenario,
  parseShellScenario,
  type ShellScenario,
} from './shellScenarios';

const BASE = 'http://localhost:3000';
const P1 = ids.project.invoicerApi;
const P2 = ids.project.invoicerWeb;
const api = createApi({ baseUrl: BASE, parse: true, orgId: () => mockDb.auth.activeOrganizationId ?? undefined });
const apply = (s: ShellScenario) => applyShellScenario(s);

const orgList = async () =>
  z.array(AuthOrganization).parse(await (await fetch(`${BASE}/auth/organization/list`)).json());
const session = async () => GetSessionResponse.parse(await (await fetch(`${BASE}/auth/get-session`)).json());
const grants = async () => (await api.me.access()).assignments;
const permissionsOf = async () => (await grants()).flatMap((a) => a.permissions.map((p) => p.permission));
const projects = async () => (await api.projects.list({ query: { page: 1, pageSize: 100 } })).items;
const projectById = async (id: string) => {
  const found = (await projects()).find((p) => p.id === id);
  if (!found) throw new Error(`project ${id} missing`);
  return found;
};

it('the key and every scenario name', () => {
  expect(SHELL_KEY).toBe('agentdesk.mock.shell');
  expect(SHELL_SCENARIOS).toEqual([
    'adminP1ViewerP2',
    'adminAMemberB',
    'suspendedOnly',
    'oneOrgNoPlatform',
    'unfinishedProjects',
    'connectionWarn',
    'connectionError',
    'noDefaultBranch',
    'longNames',
    'creatorNoAgentRead',
    'auditOnly',
    'orgUpdateOnly',
    'distinctProjects',
    'markerTicket',
    'foreignOrg',
    'foreignInvite',
  ]);
  expect(parseShellScenario('longNames')).toBe('longNames');
  expect(parseShellScenario('nope')).toBeUndefined();
  expect(parseShellScenario(null)).toBeUndefined();
});

describe.each(SHELL_SCENARIOS)('%s', (scenario) => {
  it('signs alice in with an org list, a session and a platform read that parse', async () => {
    apply(scenario);
    expect((await session())?.user.id).toBe(ids.user.alice);
    expect((await orgList()).length).toBeGreaterThan(0);
    expect(typeof (await api.me.platform()).platformAdmin).toBe('boolean');
  });
});

describe('the defining facts', () => {
  it('adminP1ViewerP2: admin on invoicer-api and viewer on invoicer-web, with no org-wide role', async () => {
    apply('adminP1ViewerP2');
    const all = await grants();
    expect(all).toHaveLength(2);
    expect(all.find((a) => a.roleKey === 'admin')?.scope).toEqual({ type: 'project', projectId: P1 });
    expect(all.find((a) => a.roleKey === 'viewer')?.scope).toEqual({ type: 'project', projectId: P2 });
    expect(all.some((a) => a.scope.type === 'org')).toBe(false);
  });

  it('adminP1ViewerP2: the viewer seat cannot write on invoicer-web while the admin seat can', async () => {
    apply('adminP1ViewerP2');
    const all = await grants();
    const lines = (key: string) => all.find((a) => a.roleKey === key)?.permissions.map((p) => p.permission) ?? [];
    expect(lines('admin')).toContain('project:update');
    expect(lines('viewer')).not.toContain('project:update');
  });

  it('adminAMemberB: admin of the active org and a plain member of the second', async () => {
    apply('adminAMemberB');
    expect((await orgList()).map((o) => o.id)).toEqual(expect.arrayContaining([ids.org.alice, ids.org.acme]));
    const seat = (orgId: string) => mockDb.state.memberships.find((m) => m.orgId === orgId)?.roleKey;
    expect(seat(ids.org.alice)).toBe('admin');
    expect(seat(ids.org.acme)).toBe('member');
    expect(mockDb.auth.activeOrganizationId).toBe(ids.org.alice);
    expect((await grants()).map((a) => a.roleKey)).toEqual(['admin']);
  });

  it('suspendedOnly: one membership, its org suspended, not a platform admin', async () => {
    apply('suspendedOnly');
    const orgs = await orgList();
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.status).toBe('suspended');
    expect(mockDb.state.memberships.filter((m) => m.userId === ids.user.alice)).toHaveLength(1);
    expect((await api.me.platform()).platformAdmin).toBe(false);
  });

  it('oneOrgNoPlatform: one org and not a platform admin', async () => {
    apply('oneOrgNoPlatform');
    expect(await orgList()).toHaveLength(1);
    expect((await api.me.platform()).platformAdmin).toBe(false);
  });

  it('unfinishedProjects: two projects stopped at different setup steps', async () => {
    apply('unfinishedProjects');
    const [a, b] = [await projectById(P1), await projectById(P2)];
    expect(a.setupStep).not.toBe('ready');
    expect(b.setupStep).not.toBe('ready');
    expect(a.setupStep).not.toBe(b.setupStep);
  });

  it('connectionWarn: invoicer-api shows the silent-webhook warning', async () => {
    apply('connectionWarn');
    const project = await projectById(P1);
    const status = toConnectionStatus(
      await api.projects.connection({ params: { projectId: P1 } }),
      project,
      new Date(),
    );
    expect(status).toMatchObject({ mode: 'webhook', tone: 'warn' });
  });

  it('connectionError: invoicer-api shows a failed poll', async () => {
    apply('connectionError');
    const project = await projectById(P1);
    const status = toConnectionStatus(
      await api.projects.connection({ params: { projectId: P1 } }),
      project,
      new Date(),
    );
    expect(status).toMatchObject({ mode: 'polling', tone: 'err' });
  });

  it('noDefaultBranch: invoicer-api has no recorded default branch', async () => {
    apply('noDefaultBranch');
    expect((await projectById(P1)).defaultBranch).toBeNull();
    expect((await projectById(P2)).defaultBranch).toBe('main');
  });

  it('longNames: the org and the project have names that need truncating', async () => {
    apply('longNames');
    expect((await orgList())[0]?.name.length).toBeGreaterThanOrEqual(60);
    expect((await projectById(P1)).name.length).toBeGreaterThanOrEqual(60);
  });

  it('creatorNoAgentRead: project:create without agent:read', async () => {
    apply('creatorNoAgentRead');
    const held = await permissionsOf();
    expect(held).toContain('project:create');
    expect(held).not.toContain('agent:read');
  });

  it('auditOnly: audit:read is the only right', async () => {
    apply('auditOnly');
    expect(await permissionsOf()).toEqual(['audit:read']);
  });

  it('orgUpdateOnly: org:update is the only right', async () => {
    apply('orgUpdateOnly');
    expect(await permissionsOf()).toEqual(['org:update']);
  });

  it('distinctProjects: two projects with different setup scripts and a same-named skill with different text', async () => {
    apply('distinctProjects');
    const one = await api.setupScript.get({ params: { projectId: P1 } });
    const two = await api.setupScript.get({ params: { projectId: P2 } });
    expect(one?.body).toBeTruthy();
    expect(two?.body).toBeTruthy();
    expect(one?.body).not.toBe(two?.body);
    const skill = (projectId: string) => api.skills.get({ params: { projectId, name: 'shared-skill' } });
    const [s1, s2] = [await skill(P1), await skill(P2)];
    expect(s1.name).toBe(s2.name);
    expect(s1.body).not.toBe(s2.body);
  });

  it('markerTicket: run 62 carries a unique marker and HTML-like text in its ticket title and its comment', async () => {
    apply('markerTicket');
    const run = await api.runs.byNumber({ params: { projectId: P1, number: 62 } });
    expect(run.ticket.title).toContain(MARKER);
    expect(run.ticket.title).toMatch(/<[a-z]+/);
    expect(run.args).toContain(MARKER);
    expect(run.args).toMatch(/<[a-z]+/);
    // No other run carries it.
    const others = (await api.runs.list({ params: { projectId: P1 }, query: {} })).items.filter((r) => r.number !== 62);
    expect(others.some((r) => r.ticket.title.includes(MARKER))).toBe(false);
  });

  it('foreignOrg: an org and a project the user is not in, hidden from every list they can read', async () => {
    apply('foreignOrg');
    expect(mockDb.state.orgs.find((o) => o.id === FOREIGN.orgId)?.name).toBe(FOREIGN.orgName);
    expect(mockDb.state.projects.find((p) => p.id === FOREIGN.projectId)?.name).toBe(FOREIGN.projectName);
    expect(mockDb.state.memberships.some((m) => m.orgId === FOREIGN.orgId)).toBe(false);
    expect((await orgList()).some((o) => o.id === FOREIGN.orgId)).toBe(false);
    expect((await projects()).some((p) => p.id === FOREIGN.projectId)).toBe(false);
  });

  it('foreignInvite: a pending invitation from an org the user is not in', async () => {
    apply('foreignInvite');
    const mine = (await api.me.listInvitations({ query: { page: 1, pageSize: 50 } })).items;
    const foreign = mine.find((i) => i.org.id === FOREIGN.orgId);
    expect(foreign?.org.name).toBe(FOREIGN.orgName);
    expect(foreign?.status).toBe('pending');
    expect((await orgList()).some((o) => o.id === FOREIGN.orgId)).toBe(false);
  });
});
