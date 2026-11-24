import type { Access, ProjectDto } from '@agentdesk/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { roleFixtures } from '@/mocks/dto/access';
import { ids } from '@/mocks/dto/ids';
import {
  INVITE_FIELD_POINTERS,
  projectOptions,
  projectRoleOptions,
  projectsOnly,
  roleOptions,
  useInviteForm,
} from './inviteForm';

// What the roles list answers: the setup-reader test fixture is not a built-in role and is not offered.
const builtInRoles = roleFixtures.filter((r) => r.builtIn);

const P1 = ids.project.invoicerApi;
const P2 = ids.project.invoicerWeb;

const role = (key: string) => {
  const found = roleFixtures.find((r) => r.key === key);
  if (!found) throw new Error(`role ${key} missing`);
  return found;
};
const grant = (roleKey: string, projectId?: string): Access['grants'][number] => ({
  roleId: role(roleKey).id,
  roleKey,
  scope: projectId === undefined ? { type: 'org' } : { type: 'project', projectId },
  lines: role(roleKey).permissions,
});
const access = (...grants: Access['grants']): Access => ({ userId: 'u1', grants });

const owner = access(grant('owner'));
const orgAdmin = access(grant('admin'));
const projectAdmin = access(grant('admin', P1));
const member = access(grant('member'));

const project = (id: string, name: string) => ({ id, name }) as ProjectDto;
const projects = [project(P1, 'invoicer-api'), project(P2, 'invoicer-web')];

describe('BR-29 roleOptions', () => {
  it('offers owner, admin, member and viewer to an owner', () => {
    expect(roleOptions(builtInRoles, owner).map((o) => o.label)).toEqual(['Owner', 'Admin', 'Member', 'Viewer']);
  });

  it('never offers owner to an org admin', () => {
    expect(roleOptions(builtInRoles, orgAdmin).map((o) => o.label)).toEqual(['Admin', 'Member', 'Viewer']);
  });

  it('offers admin, member and viewer to a project admin', () => {
    expect(roleOptions(builtInRoles, projectAdmin).map((o) => o.label)).toEqual(['Admin', 'Member', 'Viewer']);
  });

  it('uses the role id as the option id', () => {
    expect(roleOptions(builtInRoles, owner)[0]).toEqual({ id: role('owner').id, label: 'Owner' });
  });
});

describe('BR-29 projectOptions and projectsOnly', () => {
  it('lists every project for an org-wide inviter', () => {
    expect(projectOptions(projects, owner)).toEqual([
      { id: P1, label: 'invoicer-api' },
      { id: P2, label: 'invoicer-web' },
    ]);
  });

  it('lists only the projects a project admin can invite to', () => {
    expect(projectOptions(projects, projectAdmin)).toEqual([{ id: P1, label: 'invoicer-api' }]);
  });

  it('is projects-only without an org-scope assignment:create', () => {
    expect(projectsOnly(owner)).toBe(false);
    expect(projectsOnly(orgAdmin)).toBe(false);
    expect(projectsOnly(projectAdmin)).toBe(true);
    expect(projectsOnly(member)).toBe(true);
  });
});

describe('INVITE_FIELD_POINTERS', () => {
  it('names the form field of each request pointer', () => {
    expect(INVITE_FIELD_POINTERS).toEqual({
      '/email': 'email',
      '/roleId': 'roleId',
      '/scope/projectIds': 'projectIds',
      '/projectIds': 'projectIds',
    });
  });
});

describe('BR-13 projectRoleOptions', () => {
  it('offers exactly Admin, Member and Viewer, in that order', () => {
    expect(projectRoleOptions([...roleFixtures].reverse()).map((o) => o.label)).toEqual(['Admin', 'Member', 'Viewer']);
  });

  it('uses the role id as the option id', () => {
    expect(projectRoleOptions(roleFixtures)[0]).toEqual({ id: role('admin').id, label: 'Admin' });
  });
});

describe('BR-13 useInviteForm fixedProjectId', () => {
  const values = (fixedProjectId?: string) => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    return renderHook(
      () =>
        useInviteForm({
          org: 'acme',
          projectsOnly: true,
          onOrgSwitched: () => {},
          ...(fixedProjectId !== undefined && { fixedProjectId }),
        }),
      { wrapper },
    ).result.current.values;
  };

  it('starts on some projects with that one project', () => {
    expect(values(P1)).toEqual({ email: '', roleId: '', scope: 'projects', projectIds: [P1] });
  });

  it('starts with no project without it', () => {
    expect(values().projectIds).toEqual([]);
  });
});
