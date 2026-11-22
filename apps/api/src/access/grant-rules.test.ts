import { describe, expect, it } from 'vitest';
import {
  Permission,
  type Access,
  type Grant,
  type GrantLine,
  type Scope,
  type PermissionCondition,
} from '@agentdesk/contracts';
import { checkTenantAssign, isOrgOwner, type GrantCheck, type RoleForGrant } from './grant-rules';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const ORG: Scope = { type: 'org' };
const AT_P1: Scope = { type: 'project', projectId: P1 };
const AT_P2: Scope = { type: 'project', projectId: P2 };

const ALL = Permission.options.filter((p) => !p.startsWith('platform-'));
const line = (permission: GrantLine['permission'], condition: PermissionCondition = 'any'): GrantLine => ({
  permission,
  condition,
});
const OWN: GrantLine['permission'][] = ['run:update', 'run:cancel', 'terminal:attach'];
const READS = ['project:read', 'run:read'] as const; // the seeded member and viewer reads (no Desk config, issue 216)

const ownerLines = ALL.map((p) => line(p));
const adminLines = ALL.filter((p) => p !== 'org:delete').map((p) => line(p));
const memberLines = [...READS.map((p) => line(p)), line('run:create'), ...OWN.map((p) => line(p, 'own'))];
const viewerLines = READS.map((p) => line(p));

const role = (key: string, lines: GrantLine[], builtIn = true): RoleForGrant => ({
  id: `role-${key}`,
  key,
  name: key,
  builtIn,
  assignableScopes: ['org', 'project'],
  lines,
});
const OWNER = role('owner', ownerLines);
const ADMIN = role('admin', adminLines);
const MEMBER = role('member', memberLines);
const VIEWER = role('viewer', viewerLines);

const grant = (roleKey: string, scope: Scope, lines: GrantLine[]): Grant => ({
  roleId: `role-${roleKey}`,
  roleKey,
  scope,
  lines,
});
const access = (...grants: Grant[]): Access => ({ userId: 'actor', grants });

const orgOwner = access(grant('owner', ORG, ownerLines));
const orgAdmin = access(grant('admin', ORG, adminLines));
const projAdmin = access(grant('admin', AT_P1, adminLines));
const projMember = access(grant('member', AT_P1, memberLines));

const OK: GrantCheck = { ok: true };
const no = (reason: 'no-right' | 'escalation' | 'owner-only'): GrantCheck => ({ ok: false, reason });
const SETUP_TEST_ONLY = role('custom', [line('setup:test')], false);
const PLATFORM_LINE_ROLE = role('custom', [line('platform-assignment:create')], false);
const projLackingSetupTest = access(
  grant('custom-admin', AT_P1, [line('assignment:create'), line('assignment:delete'), line('project:read')]),
);

describe('checkTenantAssign', () => {
  describe.each(['assignment:create', 'assignment:delete'] as const)('%s', (permission) => {
    it.each<[string, Access, RoleForGrant, Scope, GrantCheck]>([
      ['org owner grants owner at org', orgOwner, OWNER, ORG, OK],
      ['org admin grants owner at org', orgAdmin, OWNER, ORG, no('owner-only')],
      ['org admin grants admin at org', orgAdmin, ADMIN, ORG, OK],
      ['org admin grants member at P2', orgAdmin, MEMBER, AT_P2, OK],
      ['project admin grants admin on P1', projAdmin, ADMIN, AT_P1, OK],
      ['project admin grants member on P1', projAdmin, MEMBER, AT_P1, OK],
      ['project admin grants viewer on P1', projAdmin, VIEWER, AT_P1, OK],
      ['project admin grants admin on P2', projAdmin, ADMIN, AT_P2, no('no-right')],
      ['project admin grants viewer at org', projAdmin, VIEWER, ORG, no('no-right')],
      ['project admin grants owner on P1', projAdmin, OWNER, AT_P1, no('owner-only')],
      ['member grants viewer on P1', projMember, VIEWER, AT_P1, no('no-right')],
      ['member grants member on P1', projMember, MEMBER, AT_P1, no('no-right')],
      ['actor without grants', access(), VIEWER, AT_P1, no('no-right')],
      ['role with a line the actor lacks', projLackingSetupTest, SETUP_TEST_ONLY, AT_P1, no('escalation')],
      ['role with a platform line at project scope', projAdmin, PLATFORM_LINE_ROLE, AT_P1, no('escalation')],
      [
        'own lines covered by the actor any lines',
        access(grant('custom', AT_P1, [line('assignment:create'), line('assignment:delete'), line('run:update')])),
        role('c', [line('run:update', 'own')], false),
        AT_P1,
        OK,
      ],
      [
        'any line not covered by an own line',
        access(
          grant('custom', AT_P1, [line('assignment:create'), line('assignment:delete'), line('run:update', 'own')]),
        ),
        role('c', [line('run:update')], false),
        AT_P1,
        no('escalation'),
      ],
      [
        'org-level lines of a role do not take effect at project scope',
        projAdmin,
        role('c', [line('org:delete'), line('member:read')], false),
        AT_P1,
        OK,
      ],
      ['org-level lines count at org scope', orgAdmin, role('c', [line('org:delete')], false), ORG, no('escalation')],
    ])('%s', (_name, actor, target, scope, expected) => {
      expect(checkTenantAssign(actor, permission, target, scope)).toEqual(expected);
    });
  });

  it('checks the named permission: create right does not allow delete', () => {
    const onlyCreate = access(grant('c', AT_P1, [line('assignment:create'), line('project:read')]));
    expect(checkTenantAssign(onlyCreate, 'assignment:create', VIEWER, AT_P1)).toEqual({
      ok: false,
      reason: 'escalation',
    });
    expect(checkTenantAssign(onlyCreate, 'assignment:delete', VIEWER, AT_P1)).toEqual(no('no-right'));
  });
});

describe('isOrgOwner', () => {
  it('is true only for an org-scope owner grant', () => {
    expect(isOrgOwner(orgOwner)).toBe(true);
    expect(isOrgOwner(orgAdmin)).toBe(false);
    expect(isOrgOwner(access(grant('owner', AT_P1, ownerLines)))).toBe(false);
  });
});
