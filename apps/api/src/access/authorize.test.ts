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
import { FORBIDDEN_DETAIL, preTargetDecision, type PreTarget } from './authorize';

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

describe('FORBIDDEN_DETAIL', () => {
  it('is the contract wording', () => {
    expect(FORBIDDEN_DETAIL).toBe('Not allowed for your role here');
  });
});
