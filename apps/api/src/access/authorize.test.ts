import { describe, expect, it } from 'vitest';
import {
  Permission,
  routeAccess,
  type Access,
  type Grant,
  type GrantLine,
  type PermissionCondition,
  type RouteAccess,
  type RouteKey,
  type Scope,
} from '@agentdesk/contracts';
import { FORBIDDEN_DETAIL, preTargetDecision, targetDecision, type PreTarget } from './authorize';

const P1 = '11111111-1111-4111-8111-111111111111';
const ORG: Scope = { type: 'org' };
const AT_P1: Scope = { type: 'project', projectId: P1 };

const ALL = Permission.options.filter((p) => !p.startsWith('platform-'));
const line = (permission: GrantLine['permission'], condition: PermissionCondition = 'any'): GrantLine => ({
  permission,
  condition,
});
const READS = ['project:read', 'agent:read', 'skill:read', 'rule:read', 'setup:read', 'run:read'] as const;
const ownerLines = ALL.map((p) => line(p));
const adminLines = ALL.filter((p) => p !== 'org:delete').map((p) => line(p));
const memberLines = [
  ...READS.map((p) => line(p)),
  line('run:create'),
  line('run:update', 'own'),
  line('run:cancel', 'own'),
  line('terminal:attach', 'own'),
];
const viewerLines = READS.map((p) => line(p));
const grant = (roleKey: string, scope: Scope, lines: GrantLine[]): Grant => ({
  roleId: `role-${roleKey}`,
  roleKey,
  scope,
  lines,
});
const access = (...grants: Grant[]): Access => ({ userId: 'u', grants });

const cast: Record<string, Access> = {
  'viewer at org': access(grant('viewer', ORG, viewerLines)),
  'member on P1': access(grant('member', AT_P1, memberLines)),
  'project admin on P1': access(grant('admin', AT_P1, adminLines)),
  'org owner': access(grant('owner', ORG, ownerLines)),
  'no grants': access(),
};

type Entry = Exclude<RouteAccess, { scope: 'platform' }>;
const entryOf = (key: RouteKey): Entry => {
  const e = routeAccess[key];
  if (e.scope === 'platform') throw new Error(`${key} is a platform route`);
  return e;
};

const A: PreTarget = 'allow';
const F: PreTarget = 'forbidden';
const N: PreTarget = 'needs-target';

// [route key, kind, expected per cast member in the order of `cast`]
const table: [RouteKey, ...PreTarget[]][] = [
  // self: everyone who got this far
  ['me.access', A, A, A, A, A],
  // project-list: held somewhere
  ['projects.list', A, A, A, A, F],
  // org: held somewhere and can() at org scope
  ['connections.list', F, F, F, A, F],
  ['projects.create', F, F, F, A, F],
  // project: held somewhere then the target is looked up
  ['runs.get', N, N, N, N, F],
  ['runs.cancel', F, N, N, N, F],
  ['setupTests.create', F, F, N, N, F],
  // org-admin: any of anyOf held somewhere
  ['assignments.create', F, F, A, A, F],
  ['roles.list', A, A, A, A, F],
  ['invitations.list', F, F, A, A, F],
];

describe('preTargetDecision', () => {
  const names = Object.keys(cast);
  it.each(table.flatMap(([key, ...expected]) => names.map((name, i) => [key, name, expected[i]] as const)))(
    '%s for %s is %s',
    (key, name, expected) => {
      const who = cast[name];
      if (!who) throw new Error(`no cast member ${name}`);
      expect(preTargetDecision(entryOf(key), who)).toBe(expected);
    },
  );

  it('a project-scope grant does not satisfy an org-level permission', () => {
    expect(preTargetDecision(entryOf('connections.list'), cast['project admin on P1']!)).toBe('forbidden');
  });

  it('an own-only line counts as held somewhere for a project route', () => {
    expect(preTargetDecision(entryOf('runs.cancel'), cast['member on P1']!)).toBe('needs-target');
  });

  it('a grant whose lines are all unknown to the entry never allows', () => {
    const empty = access(grant('custom', ORG, []));
    for (const key of ['projects.list', 'connections.list', 'runs.get', 'assignments.create'] as const) {
      expect(preTargetDecision(entryOf(key), empty)).toBe('forbidden');
    }
  });
});

const P2 = '22222222-2222-4222-8222-222222222222';
const OTHER = 'someone-else';

describe('targetDecision', () => {
  const entry = (permission: GrantLine['permission']) => ({ permission });
  const viewerAdminOnP1 = access(grant('viewer', ORG, viewerLines), grant('admin', AT_P1, adminLines));

  it('is not-found when the target did not resolve', () => {
    expect(targetDecision(entry('run:read'), cast['org owner']!, null)).toBe('not-found');
  });

  it('is not-found for a project outside every grant of the caller', () => {
    expect(targetDecision(entry('run:read'), cast['member on P1']!, { projectId: P2 })).toBe('not-found');
  });

  it('is forbidden for a visible project where the caller lacks the permission', () => {
    expect(targetDecision(entry('rule:update'), viewerAdminOnP1, { projectId: P2 })).toBe('forbidden');
    expect(targetDecision(entry('rule:update'), viewerAdminOnP1, { projectId: P1 })).toBe('allow');
  });

  it('is forbidden for a member on a run someone else owns', () => {
    expect(targetDecision(entry('run:cancel'), cast['member on P1']!, { projectId: P1, ownerUserId: OTHER })).toBe(
      'forbidden',
    );
  });

  it('is forbidden for a member on an ownerless run', () => {
    expect(targetDecision(entry('run:cancel'), cast['member on P1']!, { projectId: P1, ownerUserId: null })).toBe(
      'forbidden',
    );
    expect(targetDecision(entry('run:cancel'), cast['member on P1']!, { projectId: P1 })).toBe('forbidden');
  });

  it('allows a member on their own run', () => {
    expect(targetDecision(entry('run:cancel'), cast['member on P1']!, { projectId: P1, ownerUserId: 'u' })).toBe(
      'allow',
    );
  });

  it('allows a project admin on any run in their project, owned, someone else, or ownerless', () => {
    const admin = cast['project admin on P1']!;
    for (const ownerUserId of ['u', OTHER, null]) {
      expect(targetDecision(entry('run:cancel'), admin, { projectId: P1, ownerUserId })).toBe('allow');
    }
  });

  it('is not-found for a caller with no grants', () => {
    expect(targetDecision(entry('run:read'), cast['no grants']!, { projectId: P1 })).toBe('not-found');
  });
});

describe('FORBIDDEN_DETAIL', () => {
  it('is the contract wording', () => {
    expect(FORBIDDEN_DETAIL).toBe('Not allowed for your role here');
  });
});
