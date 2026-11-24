import { describe, expect, it } from 'vitest';
import type { AssignmentDto, MemberDto } from '@agentdesk/contracts';
import type { AccessChange } from '@/mocks/types';
import { diffAccess, orgRoleIdOf, projectGrantsOf } from './accessChange';

const org = { type: 'org' } as const;
const asg = (id: string, roleId: string, scope: AssignmentDto['scope']): AssignmentDto => ({
  id,
  userId: 'u',
  role: { id: roleId, key: roleId, name: roleId },
  scope,
  grantedBy: null,
  grantedAt: '2026-10-05T10:30:00.000Z',
});
const dto = (assignments: AssignmentDto[]): MemberDto => ({ userId: 'u', handle: 'u', name: 'U', assignments });
const names = new Map([
  ['p1', 'Alpha'],
  ['p2', 'Beta'],
]);
const on = (projectId: string) => ({ type: 'project', projectId }) as const;

describe('orgRoleIdOf', () => {
  it('is the org grant role id, or null without one', () => {
    expect(orgRoleIdOf(dto([asg('a', 'r-admin', org)]))).toBe('r-admin');
    expect(orgRoleIdOf(dto([asg('a', 'r-member', on('p1'))]))).toBeNull();
  });
});

describe('projectGrantsOf', () => {
  it('lists the project grants the caller can see, sorted by project name, with ids to edit them', () => {
    const grants = projectGrantsOf(
      dto([
        asg('a2', 'r-member', on('p2')),
        asg('a0', 'r-owner', org),
        asg('a1', 'r-admin', on('p1')),
        asg('a9', 'r-x', on('hidden')),
      ]),
      names,
    );
    expect(grants).toEqual([
      { assignmentId: 'a1', projectId: 'p1', projectName: 'Alpha', roleId: 'r-admin', roleName: 'r-admin' },
      { assignmentId: 'a2', projectId: 'p2', projectName: 'Beta', roleId: 'r-member', roleName: 'r-member' },
    ]);
  });
});

describe('diffAccess', () => {
  const current = [
    { assignmentId: 'a1', projectId: 'p1', projectName: 'Alpha', roleId: 'r-admin', roleName: 'Admin' },
    { assignmentId: 'a2', projectId: 'p2', projectName: 'Beta', roleId: 'r-member', roleName: 'Member' },
  ];
  const draft = (over: Partial<AccessChange> = {}): AccessChange => ({
    roleId: 'r-member',
    projects: [
      { assignmentId: 'a1', projectId: 'p1', roleId: 'r-admin' },
      { assignmentId: 'a2', projectId: 'p2', roleId: 'r-member' },
    ],
    ...over,
  });

  it('is empty when nothing changed', () => {
    expect(diffAccess('r-member', current, draft())).toEqual({ setOrgRole: false, create: [], remove: [] });
  });

  it('flags an org role change, including to No role', () => {
    expect(diffAccess('r-member', current, draft({ roleId: 'r-viewer' })).setOrgRole).toBe(true);
    expect(diffAccess('r-member', current, draft({ roleId: null })).setOrgRole).toBe(true);
    expect(diffAccess(null, current, draft({ roleId: null })).setOrgRole).toBe(false);
  });

  it('creates an added project grant', () => {
    const d = draft({ projects: [...draft().projects, { projectId: 'p3', roleId: 'r-viewer' }] });
    expect(diffAccess('r-member', current, d)).toEqual({
      setOrgRole: false,
      create: [{ projectId: 'p3', roleId: 'r-viewer' }],
      remove: [],
    });
  });

  it('removes a dropped project grant', () => {
    const d = draft({ projects: [{ assignmentId: 'a1', projectId: 'p1', roleId: 'r-admin' }] });
    expect(diffAccess('r-member', current, d)).toEqual({ setOrgRole: false, create: [], remove: ['a2'] });
  });

  it('treats a removed then re-added grant (same project and role, no assignment id) as unchanged', () => {
    const d = draft({
      projects: [
        { assignmentId: 'a1', projectId: 'p1', roleId: 'r-admin' },
        { projectId: 'p2', roleId: 'r-member' },
      ],
    });
    expect(diffAccess('r-member', current, d)).toEqual({ setOrgRole: false, create: [], remove: [] });
  });

  it('replaces a grant whose role changed: create the new one, remove the old one', () => {
    const d = draft({
      projects: [
        { assignmentId: 'a1', projectId: 'p1', roleId: 'r-viewer' },
        { assignmentId: 'a2', projectId: 'p2', roleId: 'r-member' },
      ],
    });
    expect(diffAccess('r-member', current, d)).toEqual({
      setOrgRole: false,
      create: [{ projectId: 'p1', roleId: 'r-viewer' }],
      remove: ['a1'],
    });
  });

  describe('a project held twice', () => {
    const twice = [
      { assignmentId: 'a1', projectId: 'p1', projectName: 'Alpha', roleId: 'r-admin', roleName: 'Admin' },
      { assignmentId: 'a2', projectId: 'p1', projectName: 'Alpha', roleId: 'r-member', roleName: 'Member' },
    ];

    it('creates one grant when both rows are set to the same new role, and removes both old ones', () => {
      const d = draft({
        projects: [
          { assignmentId: 'a1', projectId: 'p1', roleId: 'r-viewer' },
          { assignmentId: 'a2', projectId: 'p1', roleId: 'r-viewer' },
        ],
      });
      expect(diffAccess('r-member', twice, d)).toEqual({
        setOrgRole: false,
        create: [{ projectId: 'p1', roleId: 'r-viewer' }],
        remove: ['a1', 'a2'],
      });
    });

    it('plans nothing for an extra wanted row of a grant already held', () => {
      const d = draft({
        projects: [
          { assignmentId: 'a1', projectId: 'p1', roleId: 'r-admin' },
          { assignmentId: 'a2', projectId: 'p1', roleId: 'r-member' },
          { projectId: 'p1', roleId: 'r-admin' },
        ],
      });
      expect(diffAccess('r-member', twice, d)).toEqual({ setOrgRole: false, create: [], remove: [] });
    });

    it('removes the row switched to a role the project already holds', () => {
      const d = draft({
        projects: [
          { assignmentId: 'a1', projectId: 'p1', roleId: 'r-admin' },
          { assignmentId: 'a2', projectId: 'p1', roleId: 'r-admin' },
        ],
      });
      expect(diffAccess('r-member', twice, d)).toEqual({ setOrgRole: false, create: [], remove: ['a2'] });
    });
  });
});
