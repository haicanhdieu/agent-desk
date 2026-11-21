import { describe, expect, it, vi } from 'vitest';
import { toAccess, type AccessRow } from '../../src';

const ROLE_A = '11111111-1111-4111-8111-111111111111';
const ROLE_B = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';

const row = (over: Partial<AccessRow> = {}): AccessRow => ({
  roleId: ROLE_A,
  roleKey: 'member',
  scopeType: 'org',
  projectId: null,
  permission: 'project:read',
  condition: 'any',
  ...over,
});

describe('toAccess', () => {
  it('turns two rows of one role and scope into one grant with two lines', () => {
    const access = toAccess('u1', [row(), row({ permission: 'run:create' })]);
    expect(access).toEqual({
      userId: 'u1',
      grants: [
        {
          roleId: ROLE_A,
          roleKey: 'member',
          scope: { type: 'org' },
          lines: [
            { permission: 'project:read', condition: 'any' },
            { permission: 'run:create', condition: 'any' },
          ],
        },
      ],
    });
  });

  it('keeps an org row and a project row of the same role as two grants', () => {
    const access = toAccess('u1', [row(), row({ scopeType: 'project', projectId: PROJECT })]);
    expect(access.grants.map((g) => g.scope)).toEqual([{ type: 'org' }, { type: 'project', projectId: PROJECT }]);
  });

  it('keeps two roles at the same scope as two grants', () => {
    const access = toAccess('u1', [row(), row({ roleId: ROLE_B, roleKey: 'viewer' })]);
    expect(access.grants.map((g) => g.roleKey)).toEqual(['member', 'viewer']);
  });

  it('skips an unknown permission name and warns once with the name', () => {
    const warn = vi.fn();
    const access = toAccess('u1', [row({ permission: 'project:explode' }), row()], { warn });
    expect(access.grants[0]?.lines).toEqual([{ permission: 'project:read', condition: 'any' }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ permission: 'project:explode' }, expect.any(String));
  });

  it('skips an unknown condition and warns once with the condition', () => {
    const warn = vi.fn();
    const access = toAccess('u1', [row({ condition: 'sometimes' })], { warn });
    expect(access).toEqual({ userId: 'u1', grants: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ condition: 'sometimes' }, expect.any(String));
  });

  it('skips a project row without a project id and an unknown scope type', () => {
    const access = toAccess('u1', [row({ scopeType: 'project', projectId: null }), row({ scopeType: 'galaxy' })]);
    expect(access.grants).toEqual([]);
  });

  it('gives no grants for no rows', () => {
    expect(toAccess('u1', [])).toEqual({ userId: 'u1', grants: [] });
  });

  it('skips a platform-* permission stored on a tenant role and warns once', () => {
    const warn = vi.fn();
    const access = toAccess('u1', [row({ permission: 'platform-org:create' }), row()], { warn });
    expect(access.grants).toHaveLength(1);
    expect(access.grants[0]?.lines).toEqual([{ permission: 'project:read', condition: 'any' }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({ permission: 'platform-org:create' });
  });
});
