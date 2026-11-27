import type { AccessDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { tenantAccessFixtures } from '@/mocks/dto/access';
import { toAccess } from '../access/queries';
import { deskLinksFor, deskRightsOf, projectPaths } from './frame';

const P1 = ids.project.invoicerApi;
const P2 = ids.project.invoicerWeb;
const rights = (dto: AccessDto | undefined, projectId: string) => deskRightsOf(dto && toAccess(dto), projectId);
const both = { members: true, audit: true };
const neither = { members: false, audit: false };
const pick = (r: ReturnType<typeof deskRightsOf>) => ({ members: r.members, audit: r.audit });

describe('deskRightsOf (BR-1, BR-26)', () => {
  it.each(['owner', 'admin', 'projectAdmin'] as const)('gives the %s Members and Audit log on P1', (role) => {
    expect(pick(rights(tenantAccessFixtures[role], P1))).toEqual(both);
  });

  it.each(['member', 'viewer', 'noRole'] as const)('gives a %s neither', (role) => {
    expect(pick(rights(tenantAccessFixtures[role], P1))).toEqual(neither);
  });

  it('gives nothing while the grants are not loaded', () => {
    expect(pick(rights(undefined, P1))).toEqual(neither);
  });

  it('gives an admin of P1 nothing on P2', () => {
    expect(pick(rights(tenantAccessFixtures.projectAdmin, P2))).toEqual(neither);
  });

  it('adds up an org viewer with an admin of P1: Members and Audit log on P1 only', () => {
    const viewer = tenantAccessFixtures.viewer;
    const admin = tenantAccessFixtures.projectAdmin;
    const dto: AccessDto = { ...viewer, assignments: [...viewer.assignments, ...admin.assignments] };
    expect(pick(rights(dto, P1))).toEqual(both);
    expect(pick(rights(dto, P2))).toEqual(neither);
  });
});

describe('projectPaths', () => {
  it('has the Members and Audit log pages under desk', () => {
    const paths = projectPaths('acme', P1);
    expect(paths.members).toBe(`/o/acme/p/${P1}/desk/members`);
    expect(paths.audit).toBe(`/o/acme/p/${P1}/desk/audit`);
  });
});

describe('deskLinksFor (Step 0)', () => {
  const paths = projectPaths('acme', P1);
  const linksOf = (dto: AccessDto | undefined) => deskLinksFor(paths, deskRightsOf(dto && toAccess(dto), P1));
  const all = {
    desk: paths.rules,
    skills: paths.skills,
    rules: paths.rules,
    agent: paths.agent,
    setup: paths.setup,
    members: paths.members,
    audit: paths.audit,
  };

  it('gives a caller without rule, skill, setup or agent read no Configure link', () => {
    expect(linksOf(tenantAccessFixtures.member)).toEqual({});
  });

  it.each([
    ['owner', all],
    ['admin', all],
    ['projectAdmin', all],
    ['member', {}],
    ['viewer', {}],
    ['noRole', {}],
  ] as const)('gives a %s exactly its links on P1', (role, expected) => {
    expect(linksOf(tenantAccessFixtures[role])).toEqual(expected);
  });

  it('gives nothing while the grants are not loaded', () => {
    expect(linksOf(undefined)).toEqual({});
  });

  it('sets only the link of each right held', () => {
    const rights = { rules: false, skills: true, agent: false, setup: true, members: false, audit: true };
    expect(deskLinksFor(paths, rights)).toEqual({ skills: paths.skills, setup: paths.setup, audit: paths.audit });
  });
});
