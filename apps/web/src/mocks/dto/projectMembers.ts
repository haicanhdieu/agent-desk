import type { MemberDto, ProjectMemberDto } from '@agentdesk/contracts';
import { roleFixtures } from './access';
import { ids } from './ids';

// Project space fixtures: who holds a role on a project, and the org members the Add picker can offer.
const uuid = (n: number) => `b7000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const roleRef = (key: 'admin' | 'member' | 'viewer') => {
  const r = roleFixtures.find((x) => x.key === key);
  if (!r) throw new Error(`no ${key} role fixture`);
  return { id: r.id, key: r.key, name: r.name };
};

let seq = 0;
const person = (
  userId: string,
  name: string,
  handle: string | null,
  roles: ('admin' | 'member' | 'viewer')[],
): ProjectMemberDto => ({
  userId,
  name,
  handle,
  projectRoles: roles.map((key) => ({ assignmentId: uuid(++seq), role: roleRef(key) })),
});

/** The people with a project role, by project id: invoicer-api (P) and invoicer-web. */
export const projectMemberFixtures: Record<string, ProjectMemberDto[]> = {
  [ids.project.invoicerApi]: [
    person(ids.user.alice, 'Lee Park', 'lee', ['admin']),
    person('user-tenant-4', 'Cleo Martin', 'cleo', ['member']),
    person('user-tenant-5', 'Dana Wu', 'dana', ['viewer']),
    person('user-tenant-3', 'Ben Okafor', 'ben', ['member', 'viewer']),
    person('user-tenant-7', 'Noor Haddad', null, ['viewer']),
    person('user-tenant-8', `Alexandria ${'Montgomery-Featherstonehaugh '.repeat(3)}`.trim(), 'alexandria', ['member']),
  ],
  [ids.project.invoicerWeb]: [
    person(ids.user.alice, 'Lee Park', 'lee', ['member']),
    person('user-tenant-6', 'Eli Ford', 'eli', ['admin']),
  ],
};

/** 45 org members with no role on P: names carry LIKE wildcards, one has no handle. */
export const pickerCandidateFixtures: MemberDto[] = Array.from({ length: 45 }, (_, i) => {
  const n = i + 1;
  const name = n === 1 ? '100% Reliable Rae' : n === 2 ? 'Under_score Uma' : `Person ${String(n).padStart(2, '0')}`;
  return {
    userId: `user-candidate-${n}`,
    handle: n === 3 ? null : `person${n}`,
    name,
    assignments: [],
  };
});
