import { describe, expect, it } from 'vitest';
import type { ProjectMemberDto } from '@agentdesk/contracts';
import { toProjectMemberRow } from './map';

const role = (key: 'admin' | 'member' | 'viewer', name: string, n: number) => ({
  assignmentId: `a${n}`,
  role: { id: `r-${key}`, key, name },
});
const dto = (over: Partial<ProjectMemberDto> = {}): ProjectMemberDto => ({
  userId: 'u1',
  name: 'Ben Okafor',
  handle: 'ben',
  projectRoles: [role('member', 'Member', 1)],
  ...over,
});

describe('toProjectMemberRow (BR-4)', () => {
  it('joins the role names with ", "', () => {
    const row = toProjectMemberRow(
      dto({ projectRoles: [role('member', 'Member', 1), role('viewer', 'Viewer', 2)] }),
      'x',
    );
    expect(row.roles).toBe('Member, Viewer');
  });

  it('marks the signed-in user as you', () => {
    expect(toProjectMemberRow(dto(), 'u1').you).toBe(true);
    expect(toProjectMemberRow(dto(), 'u2').you).toBe(false);
  });

  it('keeps a null handle null (Review Focus 4)', () => {
    expect(toProjectMemberRow(dto({ handle: null }), 'x').handle).toBeNull();
  });

  it('keeps the id and name', () => {
    expect(toProjectMemberRow(dto(), 'x')).toMatchObject({ userId: 'u1', name: 'Ben Okafor', handle: 'ben' });
  });
});
