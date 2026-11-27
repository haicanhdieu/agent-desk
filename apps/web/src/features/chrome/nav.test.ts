import type { AccessDto, PermissionLineDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import type { SubNavGroup } from '@/components';
import { tenantAccessFixtures } from '@/mocks/dto/access';
import { ids } from '@/mocks/dto/ids';
import { toAccess } from '../access/queries';
import { deskLinksFor, projectPaths } from '../desk/frame';
import {
  errorMenuScope,
  goToProjectsHref,
  orgMenu,
  platformMenu,
  platformOrgMenu,
  projectMenuModel,
  type MenuModel,
} from './nav';
import { ORG_SETTINGS_ORDER } from './appBar';

const P1 = ids.project.invoicerApi;
const P2 = ids.project.invoicerWeb;
const SLUG = 'acme';
const accessOf = (dto: AccessDto) => toAccess(dto);
const orgOnly = (...permissions: PermissionLineDto['permission'][]): AccessDto => ({
  userId: ids.user.alice,
  platformAdmin: false,
  assignments: [
    {
      roleKey: 'custom',
      scope: { type: 'org' },
      permissions: permissions.map((permission) => ({ permission, condition: 'any' as const })),
    },
  ],
});

const labels = (groups: SubNavGroup[]) => groups.flatMap((g) => g.items?.map((i) => i.label) ?? []);
const headings = (groups: SubNavGroup[]) => groups.map((g) => g.heading);
const itemsOf = (m: MenuModel) => m.groups.flatMap((g) => g.items ?? []);

describe('orgMenu', () => {
  const menu = (dto: AccessDto, extra: { manageHref?: string; item?: 'projects' | 'members' } = {}) =>
    orgMenu({ slug: SLUG, state: 'ready', access: accessOf(dto), ...extra });

  it('orders the Settings group with ORG_SETTINGS_ORDER', () => {
    expect(ORG_SETTINGS_ORDER).toEqual(['members', 'invitations', 'audit', 'general']);
  });

  it.each(['owner', 'admin'] as const)('gives the %s Projects then Settings with four items', (role) => {
    const m = menu(tenantAccessFixtures[role]);
    expect(m.label).toBe('Organization menu');
    expect(m.state).toBe('ready');
    expect(headings(m.groups)).toEqual([undefined, 'Settings']);
    expect(labels(m.groups)).toEqual(['Projects', 'Members', 'Invitations', 'Audit log', 'General']);
    expect(itemsOf(m).map((i) => i.href)).toEqual([
      `/o/${SLUG}/projects`,
      `/o/${SLUG}/settings/members`,
      `/o/${SLUG}/settings/invitations`,
      `/o/${SLUG}/settings/audit`,
      `/o/${SLUG}/settings/general`,
    ]);
  });

  it.each(['member', 'viewer', 'noRole'] as const)('gives a %s Projects only with no heading', (role) => {
    const m = menu(tenantAccessFixtures[role]);
    expect(labels(m.groups)).toEqual(['Projects']);
    expect(headings(m.groups)).toEqual([undefined]);
  });

  it('gives a project admin Projects and Invitations', () => {
    const m = menu(tenantAccessFixtures.projectAdmin);
    expect(labels(m.groups)).toEqual(['Projects', 'Invitations']);
    expect(headings(m.groups)).toEqual([undefined, 'Settings']);
  });

  it('gives an audit-only grant just Audit log', () => {
    expect(labels(menu(orgOnly('audit:read')).groups)).toEqual(['Projects', 'Audit log']);
  });

  it('gives an org-update-only grant just General', () => {
    expect(labels(menu(orgOnly('org:update')).groups)).toEqual(['Projects', 'General']);
  });

  it('puts manageHref in the footer', () => {
    const m = menu(tenantAccessFixtures.owner, { manageHref: '/platform/orgs/o1' });
    expect(m.footer).toEqual({ kind: 'managePlatform', href: '/platform/orgs/o1' });
    expect(menu(tenantAccessFixtures.owner).footer).toBeUndefined();
  });

  it('marks only the item named by `item` as current', () => {
    const m = menu(tenantAccessFixtures.owner, { item: 'members' });
    expect(
      itemsOf(m)
        .filter((i) => i.active)
        .map((i) => i.label),
    ).toEqual(['Members']);
  });

  it('has Projects only and no gated item while loading', () => {
    const m = orgMenu({ slug: SLUG, state: 'loading', manageHref: '/platform/orgs/o1' });
    expect(m.state).toBe('loading');
    expect(labels(m.groups)).toEqual(['Projects']);
    expect(m.footer).toBeUndefined();
  });

  it('keeps Projects only on error', () => {
    const m = orgMenu({ slug: SLUG, state: 'error' });
    expect(m.state).toBe('error');
    expect(labels(m.groups)).toEqual(['Projects']);
  });

  it('is ready with Projects only and no footer while the org list loads', () => {
    const m = orgMenu({
      slug: SLUG,
      state: 'orgListLoading',
      access: accessOf(tenantAccessFixtures.owner),
      manageHref: '/platform/orgs/o1',
    });
    expect(m.state).toBe('ready');
    expect(labels(m.groups)).toEqual(['Projects']);
    expect(m.footer).toBeUndefined();
  });

  it('is in error with Projects only when the org list failed', () => {
    const m = orgMenu({ slug: SLUG, state: 'orgListError', access: accessOf(tenantAccessFixtures.owner) });
    expect(m.state).toBe('error');
    expect(labels(m.groups)).toEqual(['Projects']);
    expect(m.footer).toBeUndefined();
  });

  it('gives org B member Projects only even beside an org A admin', () => {
    const a = menu(tenantAccessFixtures.admin);
    const b = menu(tenantAccessFixtures.member);
    expect(labels(a.groups)).toContain('Members');
    expect(labels(b.groups)).toEqual(['Projects']);
  });
});

describe('projectMenuModel', () => {
  const paths = (id: string) => `/o/${SLUG}/p/${id}`;
  const menu = (dto: AccessDto | undefined, projectId = P1, extra: Record<string, unknown> = {}) =>
    projectMenuModel({
      slug: SLUG,
      projectId,
      state: 'ready',
      ...(dto && { access: accessOf(dto) }),
      ...extra,
    });
  const repo = { owner: 'acme', name: 'api', branch: 'main', repoUrl: 'https://example.test/acme/api' };
  const allLinks = {
    Runs: `${paths(P1)}/runs`,
    'Routing rules': `${paths(P1)}/desk/rules`,
    Skills: `${paths(P1)}/desk/skills`,
    'Workspace setup': `${paths(P1)}/desk/setup`,
    'Agent & settings': `${paths(P1)}/desk/agent`,
    Members: `${paths(P1)}/desk/members`,
    'Audit log': `${paths(P1)}/desk/audit`,
  };
  const linksOf = (m: MenuModel) => Object.fromEntries(itemsOf(m).map((i) => [i.label, i.href]));

  it.each(['owner', 'admin', 'projectAdmin'] as const)('gives the %s every group on P1', (role) => {
    const m = menu(tenantAccessFixtures[role], P1, { repo });
    expect(m.label).toBe('Project menu');
    expect(m.back).toEqual({ label: 'All projects', href: `/o/${SLUG}/projects` });
    expect(headings(m.groups)).toEqual([undefined, 'Configure', 'Access']);
    expect(labels(m.groups)).toEqual([
      'Runs',
      'Routing rules',
      'Skills',
      'Workspace setup',
      'Agent & settings',
      'Members',
      'Audit log',
    ]);
    expect(linksOf(m)).toEqual(allLinks);
    expect(m.footer).toEqual({ kind: 'repo', repo });
  });

  it.each(['member', 'viewer', 'noRole'] as const)('gives a %s Runs only', (role) => {
    const m = menu(tenantAccessFixtures[role]);
    expect(linksOf(m)).toEqual({ Runs: allLinks.Runs });
    expect(headings(m.groups)).toEqual([undefined]);
  });

  const onP1 = (...permissions: PermissionLineDto['permission'][]): AccessDto => ({
    userId: ids.user.alice,
    platformAdmin: false,
    assignments: [
      {
        roleKey: 'custom',
        scope: { type: 'project', projectId: P1 },
        permissions: permissions.map((permission) => ({ permission, condition: 'any' as const })),
      },
    ],
  });

  it.each([
    ['rule:read', 'Routing rules', 'Configure'],
    ['skill:read', 'Skills', 'Configure'],
    ['setup:read', 'Workspace setup', 'Configure'],
    ['agent:read', 'Agent & settings', 'Configure'],
    ['assignment:read', 'Members', 'Access'],
    ['project-audit:read', 'Audit log', 'Access'],
  ] as const)('gives a P1 %s grant alone Runs plus %s, under the %s heading only', (permission, label, heading) => {
    const m = menu(onP1(permission));
    expect(labels(m.groups)).toEqual(['Runs', label]);
    expect(headings(m.groups)).toEqual([undefined, heading]);
    const p2 = menu(onP1(permission), P2);
    expect(labels(p2.groups)).toEqual(['Runs']);
    expect(headings(p2.groups)).toEqual([undefined]);
  });

  it('shows each heading only for its own group when grants span both', () => {
    const m = menu(onP1('assignment:read', 'project-audit:read', 'skill:read'));
    expect(headings(m.groups)).toEqual([undefined, 'Configure', 'Access']);
    expect(labels(m.groups)).toEqual(['Runs', 'Skills', 'Members', 'Audit log']);
  });

  it('gives nothing gated while the grants are not loaded', () => {
    expect(linksOf(menu(undefined))).toEqual({ Runs: allLinks.Runs });
  });

  it('gives an admin of P1 nothing gated on P2', () => {
    expect(linksOf(menu(tenantAccessFixtures.projectAdmin, P2))).toEqual({ Runs: `${paths(P2)}/runs` });
  });

  it('adds up an org viewer with an admin of P1: gated items on P1 only', () => {
    const viewer = tenantAccessFixtures.viewer;
    const admin = tenantAccessFixtures.projectAdmin;
    const dto: AccessDto = { ...viewer, assignments: [...viewer.assignments, ...admin.assignments] };
    expect(linksOf(menu(dto, P1))).toEqual(allLinks);
    expect(Object.keys(linksOf(menu(dto, P2)))).toEqual(['Runs']);
  });

  it('shows the badge only above zero', () => {
    const runs = (n?: number) => itemsOf(menu(tenantAccessFixtures.owner, P1, { needsYou: n }))[0];
    expect(runs(3)?.badge).toBe(3);
    expect(runs(0)?.badge).toBeUndefined();
    expect(runs()?.badge).toBeUndefined();
  });

  it('marks the parent item with active: parent', () => {
    const m = menu(tenantAccessFixtures.owner, P1, { item: 'runs', parent: true });
    expect(
      itemsOf(m)
        .filter((i) => i.active)
        .map((i) => [i.label, i.active]),
    ).toEqual([['Runs', 'parent']]);
  });

  it('marks a plain current item with active: true', () => {
    const m = menu(tenantAccessFixtures.owner, P1, { item: 'skills' });
    expect(
      itemsOf(m)
        .filter((i) => i.active)
        .map((i) => [i.label, i.active]),
    ).toEqual([['Skills', true]]);
  });

  it('keeps the back link and has no items while loading', () => {
    const m = projectMenuModel({ slug: SLUG, projectId: P1, state: 'loading', repo });
    expect(m.state).toBe('loading');
    expect(m.back?.label).toBe('All projects');
    expect(itemsOf(m)).toEqual([]);
  });

  it('keeps Runs only on error', () => {
    const m = projectMenuModel({ slug: SLUG, projectId: P1, state: 'error' });
    expect(m.state).toBe('error');
    expect(labels(m.groups)).toEqual(['Runs']);
  });

  it('is ready with Runs only and no repo footer while the org list loads', () => {
    const m = projectMenuModel({
      slug: SLUG,
      projectId: P1,
      state: 'orgListLoading',
      access: accessOf(tenantAccessFixtures.owner),
      repo,
    });
    expect(m.state).toBe('ready');
    expect(labels(m.groups)).toEqual(['Runs']);
    expect(m.footer).toBeUndefined();
  });

  it('is in error with Runs only and no repo footer when the org list failed', () => {
    const m = projectMenuModel({ slug: SLUG, projectId: P1, state: 'orgListError', repo });
    expect(m.state).toBe('error');
    expect(labels(m.groups)).toEqual(['Runs']);
    expect(m.footer).toBeUndefined();
  });

  // BR-7, BR-10: the current item comes only from `item`, never from the address or a search param.
  it('makes Agent & settings the only current item with a bare href, whatever the tab', () => {
    const m = menu(tenantAccessFixtures.owner, P1, { item: 'agent' });
    const agent = itemsOf(m).find((i) => i.label === 'Agent & settings');
    expect(agent?.href).toBe(`/o/${SLUG}/p/${P1}/desk/agent`);
    expect(agent?.href).not.toContain('?');
    expect(itemsOf(m).filter((i) => i.active)).toEqual([expect.objectContaining({ label: 'Agent & settings' })]);
  });

  it('marks nothing as current without an item', () => {
    expect(itemsOf(menu(tenantAccessFixtures.owner)).some((i) => i.active)).toBe(false);
  });
});

describe('deskLinksFor', () => {
  const paths = projectPaths(SLUG, P1);

  it('sets only the link of each right held', () => {
    const rights = { rules: false, skills: true, agent: false, setup: true, members: false, audit: true };
    expect(deskLinksFor(paths, rights)).toEqual({ skills: paths.skills, setup: paths.setup, audit: paths.audit });
  });
});

describe('platformMenu', () => {
  it('has the three platform items', () => {
    const m = platformMenu({});
    expect(m.label).toBe('Platform menu');
    expect(m.state).toBe('ready');
    expect(itemsOf(m).map((i) => [i.label, i.href])).toEqual([
      ['Organizations', '/platform/orgs'],
      ['Platform admins', '/platform/admins'],
      ['Audit log', '/platform/audit'],
    ]);
  });

  it('marks the item named by `item`', () => {
    const m = platformMenu({ item: 'platformAdmins' });
    expect(
      itemsOf(m)
        .filter((i) => i.active)
        .map((i) => i.label),
    ).toEqual(['Platform admins']);
  });
});

describe('platformOrgMenu', () => {
  const orgId = 'org-1';
  it('has the back link, header and four items for a ready org', () => {
    const m = platformOrgMenu({
      orgId,
      org: { status: 'ready', name: 'Harbor Labs', orgStatus: 'suspended' },
      item: 'orgMembers',
    });
    expect(m.label).toBe('Platform menu');
    expect(m.back).toEqual({ label: 'Organizations', href: '/platform/orgs' });
    expect(m.header).toEqual({ name: 'Harbor Labs', status: 'suspended' });
    expect(itemsOf(m).map((i) => [i.label, i.href])).toEqual([
      ['Overview', `/platform/orgs/${orgId}`],
      ['Projects', `/platform/orgs/${orgId}/projects`],
      ['Members', `/platform/orgs/${orgId}/members`],
      ['Invitations', `/platform/orgs/${orgId}/invitations`],
    ]);
    expect(
      itemsOf(m)
        .filter((i) => i.active)
        .map((i) => i.label),
    ).toEqual(['Members']);
  });

  it('shows a loading header and no items while the org loads', () => {
    const m = platformOrgMenu({ orgId, org: { status: 'loading' } });
    expect(m.state).toBe('loading');
    expect(m.header).toBe('loading');
    expect(itemsOf(m)).toEqual([]);
    expect(m.back?.label).toBe('Organizations');
  });

  it('names a failed org "Organization" with no status and keeps the links', () => {
    const m = platformOrgMenu({ orgId, org: { status: 'error' } });
    expect(m.header).toEqual({ name: 'Organization' });
    expect(itemsOf(m)).toHaveLength(4);
  });
});

describe('errorMenuScope', () => {
  const memberships = [
    { slug: 'acme', status: 'active' },
    { slug: 'gone', status: 'suspended' },
  ];
  const scope = (
    pathname: string,
    over: Partial<Parameters<typeof errorMenuScope>[0]> = {},
  ): ReturnType<typeof errorMenuScope> =>
    errorMenuScope({ pathname, memberships, project: 'accessible', platformAdmin: false, ...over });

  it('gives none for a slug the person is not a member of', () => {
    expect(scope('/o/other/projects')).toEqual({ scope: 'none' });
    expect(scope('/o/other/p/abc/runs')).toEqual({ scope: 'none' });
  });

  it('gives none for an unknown path', () => {
    expect(scope('/nowhere')).toEqual({ scope: 'none' });
    expect(scope('/')).toEqual({ scope: 'none' });
  });

  it('gives none to a non-admin on /platform', () => {
    expect(scope('/platform/orgs')).toEqual({ scope: 'none' });
  });

  it('gives none for a suspended org', () => {
    expect(scope('/o/gone/projects')).toEqual({ scope: 'none' });
  });

  it('gives the project menu for a 403 inside an accessible project', () => {
    expect(scope('/o/acme/p/p1/desk/members')).toEqual({ scope: 'project', slug: 'acme', projectId: 'p1' });
  });

  it('gives the org menu when the project is inaccessible in a member org', () => {
    expect(scope('/o/acme/p/p1/runs', { project: 'inaccessible' })).toEqual({ scope: 'org', slug: 'acme' });
  });

  it('keeps the project menu when access is unknown', () => {
    expect(scope('/o/acme/p/p1/runs', { project: 'unknown' })).toEqual({
      scope: 'project',
      slug: 'acme',
      projectId: 'p1',
    });
  });

  it('gives the org menu for an org page', () => {
    expect(scope('/o/acme/settings/members')).toEqual({ scope: 'org', slug: 'acme' });
  });

  it('gives the platform menu to an admin on a missing platform org', () => {
    expect(scope('/platform/orgs/missing', { platformAdmin: true })).toEqual({ scope: 'platform' });
  });

  it('never gives an org the path does not name', () => {
    expect(scope('/o/other/projects', { platformAdmin: true })).toEqual({ scope: 'none' });
    expect(scope('/invitations')).toEqual({ scope: 'none' });
  });

  it('decodes an encoded slug and project id', () => {
    const m = [{ slug: 'a b', status: 'active' }];
    expect(scope('/o/a%20b/p/p%201/runs', { memberships: m })).toEqual({
      scope: 'project',
      slug: 'a b',
      projectId: 'p 1',
    });
  });

  it('gives none for a malformed encoding and for no memberships', () => {
    expect(scope('/o/%E0%A4%A/projects')).toEqual({ scope: 'none' });
    expect(scope('/o/acme/projects', { memberships: undefined })).toEqual({ scope: 'none' });
  });
});

describe('goToProjectsHref', () => {
  it('opens the shown org projects page', () => {
    expect(goToProjectsHref({ scope: 'org', slug: 'a b' })).toBe('/o/a%20b/projects');
    expect(goToProjectsHref({ scope: 'project', slug: 'acme', projectId: 'p1' })).toBe('/o/acme/projects');
  });

  it('is / for platform, none and a non-member slug', () => {
    expect(goToProjectsHref({ scope: 'platform' })).toBe('/');
    expect(goToProjectsHref({ scope: 'none' })).toBe('/');
    expect(
      goToProjectsHref(
        errorMenuScope({ pathname: '/o/x/projects', memberships: [], project: 'unknown', platformAdmin: false }),
      ),
    ).toBe('/');
  });
});
