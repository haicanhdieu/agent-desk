import type { HttpHandler } from 'msw';
import { http } from 'msw';
import { roleFixtures } from '../dto/access';
import { ids } from '../dto/ids';
import {
  INVITATIONS_MOCK_NOW,
  checklistFixtures,
  myInvitationFixtures,
  orgInvitationFixtures,
} from '../dto/invitations';
import { NO_ROLE, mockDb, type InvitationRow, type MockUser } from './db';
import { problemResponse, routeDef } from './http';

// The onboarding mock scenarios: one module for the route tests and the mocked e2e specs. A spec picks a scenario
// through sessionStorage (`ONBOARDING_SCENARIO_KEY`, written by e2e/mock/mock.ts `seedOnboarding`); browser.ts reads it
// once when the worker starts. Each scenario resets the store, then seeds it so the given of its e2e cases holds
// (docs/superpowers/specs/2026-11-21-org-onboarding-design.md, E2E requirements).

export const ONBOARDING_SCENARIOS = [
  'noOrgInvited',
  'noOrgInvitedStates',
  'noOrgUninvited',
  'platformAdminNoOrg',
  'platformAdminOneOrg',
  'platformAdminNoRole',
  'singleOrgTwoPending',
  'singleOrg',
  'twoOrgs',
  'twoOrgsSlowSwitch',
  'twoOrgsNoRoleInSecond',
  'owner',
  'orgAdmin',
  'projectAdmin',
  'member',
  'viewer',
  'invitationsPaged',
  'invitationsExpiry',
  'invitationChanged',
  'checklistNoProject',
  'checklistPartial',
  'checklistTwoProjects',
  'checklistComplete',
  'ownerInvitationFailsOnce',
] as const;

export type OnboardingScenario = (typeof ONBOARDING_SCENARIOS)[number];

export const ONBOARDING_SCENARIO_KEY = 'agentdesk.mock.onboarding';

export function parseOnboardingScenario(raw: string | null): OnboardingScenario | undefined {
  return ONBOARDING_SCENARIOS.find((s) => s === raw);
}

const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The org the invitee fixtures (dto/invitations.ts) invite to, and a seed org nobody in these scenarios belongs to. */
const ACME_ROBOTICS = { id: uuid('b5000000', 1), name: 'Acme Robotics', slug: 'acme-robotics' };
const OTHER_ORG = { id: uuid('b6000000', 3), name: 'Other', slug: 'other' };
const CREATED = '2026-09-01T09:00:00.000Z';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW_MS = Date.parse(INVITATIONS_MOCK_NOW);
const at = (offsetMs: number) => new Date(NOW_MS + offsetMs).toISOString();

const roleRef = (key: string): InvitationRow['role'] => {
  const role = roleFixtures.find((r) => r.key === key);
  if (!role) throw new Error(`role fixture ${key} missing`);
  return { id: role.id, key: role.key, name: role.name };
};

const state = () => mockDb.state;
const me = (): MockUser => {
  const user = state().users[0];
  if (!user) throw new Error('seed has no user');
  return user;
};

function addUser(user: Pick<MockUser, 'id' | 'name' | 'email' | 'handle'>): MockUser {
  const full: MockUser = {
    ...user,
    emailVerified: true,
    image: null,
    platformAdmin: false,
    createdAt: CREATED,
    updatedAt: CREATED,
  };
  state().users.push(full);
  return full;
}

/** Every scenario starts here: the seed, plus the orgs the cases name. */
function base(): void {
  mockDb.reset();
  state().orgs.push(
    { ...ACME_ROBOTICS, logo: null, metadata: null, createdAt: CREATED },
    { ...OTHER_ORG, logo: null, metadata: null, createdAt: CREATED },
  );
}

function signInAs(
  patch: Partial<Pick<MockUser, 'name' | 'email' | 'handle' | 'platformAdmin'>>,
  seats: { orgId: string; roleKey: string; projectIds?: string[] }[],
  active: string | null,
): void {
  Object.assign(me(), patch);
  state().memberships = seats.map((s) => ({ userId: me().id, ...s }));
  state().auth = { signedIn: true, activeOrganizationId: active };
}

/** Gives Acme these projects (taken from the org they are seeded in); `only` drops the ones Acme had. */
function acmeProjects(keep: readonly string[], only = false): void {
  state().projects = state().projects.filter((p) => !only || p.orgId !== ids.org.acme || keep.includes(p.id));
  for (const p of state().projects) if (keep.includes(p.id)) p.orgId = ids.org.acme;
}

/** Puts the projects back to a fresh one: the agent without a credential (as a new project has), and no rule. */
function clearSetup(projectIds: readonly string[], opts: { keepAgent?: boolean } = {}): void {
  for (const a of state().agents) {
    if (projectIds.includes(a.projectId) && !opts.keepAgent) {
      a.credential = { set: false, type: null, updatedAt: null, setBy: null };
    }
  }
  state().rules = state().rules.filter((r) => !projectIds.includes(r.projectId));
}

const inAcme = (roleKey: string, projectIds?: string[]) =>
  signInAs({}, [{ orgId: ids.org.acme, roleKey, ...(projectIds && { projectIds }) }], ids.org.acme);

const P1 = ids.project.invoicerApi;
const P2 = ids.project.invoicerWeb;

let rowCounter = 0;
function orgRow(patch: Partial<InvitationRow> & Pick<InvitationRow, 'email'>): InvitationRow {
  rowCounter += 1;
  return {
    id: uuid('b3200000', rowCounter),
    orgId: ids.org.acme,
    role: roleRef('member'),
    scope: { type: 'org' },
    status: 'pending',
    expiresAt: at(2 * DAY),
    invitedBy: { name: 'Ada Lovelace', handle: 'ada' },
    createdAt: at(-DAY),
    acceptedAt: null,
    ...patch,
  };
}

/** Acme's invitations in every status, plus the inviter variants the Invited by column shows. */
function acmeInvitations(): InvitationRow[] {
  const pendingRow = orgInvitationFixtures.find((i) => i.email === 'p@x.dev');
  if (!pendingRow) throw new Error('invitation fixture p@x.dev missing');
  return [
    ...orgInvitationFixtures.map((i) => ({ ...i, orgId: ids.org.acme })),
    {
      ...pendingRow,
      id: uuid('b3100000', 7),
      email: 'b@x.dev',
      orgId: ids.org.acme,
      invitedBy: { name: 'bob', handle: 'bob' },
    },
    {
      ...pendingRow,
      id: uuid('b3100000', 8),
      email: 'n@x.dev',
      orgId: ids.org.acme,
      invitedBy: null,
    },
  ];
}

function seedMember(): void {
  const member = addUser({ id: 'user-member', name: 'Member', email: 'member@x.dev', handle: 'member' });
  state().memberships.push({ userId: member.id, orgId: ids.org.acme, roleKey: 'member' });
}

/** The invitee's own invitations: each status, the pending ones expiring 23 Nov 14:05 (a clock before that keeps them pending), each created 2 days (the validity window) before it expires. */
function inviteeInvitations(
  email: string,
  pick: (f: typeof myInvitationFixtures) => (typeof myInvitationFixtures)[keyof typeof myInvitationFixtures][] = (
    f,
  ) => [
    f.pending,
    f.pendingProjects,
    f.pendingInviterHandle,
    f.pendingInviterDeleted,
    f.expired,
    // Expired and the inviter deleted: the matching invitee's link names no inviter to ask.
    { ...f.expired, id: uuid('b4000000', 9), invitedBy: null },
    f.revoked,
    f.declined,
    f.accepted,
  ],
): InvitationRow[] {
  const f = myInvitationFixtures;
  const ofFixture = (m: (typeof f)[keyof typeof f], n: number): InvitationRow => {
    const expiresAt = m.status === 'pending' ? '2026-11-23T14:05:00.000Z' : m.expiresAt;
    return {
      id: m.id,
      orgId: m.org.id,
      email,
      role: roleRef(m.role.key),
      scope: m.scope,
      status: m.status,
      expiresAt,
      invitedBy: m.invitedBy,
      // Newest first by n, as the list orders them.
      createdAt: new Date(Date.parse(expiresAt) - 2 * DAY - n * MIN).toISOString(),
      acceptedAt: m.status === 'accepted' ? at(-HOUR) : null,
    };
  };
  return pick(f).map(ofFixture);
}

/** Rows relative to the fixed clock for the expiry labels and boundaries. */
function expiryInvitations(ownEmail: string): InvitationRow[] {
  const expired = (email: string, ago: number, patch: Partial<InvitationRow> = {}) =>
    orgRow({ email, status: 'expired', expiresAt: at(-ago), createdAt: at(-ago - 2 * DAY), ...patch });
  return [
    // Created 2 days 1 minute ago and never answered: stored pending, a minute past its expiry. For the owner's own
    // email, so the owner can also open it as its invitee.
    orgRow({ email: ownEmail, status: 'pending', expiresAt: at(-MIN), createdAt: at(-2 * DAY - MIN) }),
    orgRow({ email: 'soon@x.dev', expiresAt: at(MIN), createdAt: at(-2 * DAY + MIN) }),
    orgRow({ email: 'in2d@x.dev', expiresAt: at(2 * DAY), createdAt: at(0) }),
    orgRow({ email: 'in5h@x.dev', expiresAt: at(5 * HOUR), createdAt: at(-2 * DAY + 5 * HOUR) }),
    expired(ownEmail, DAY),
    expired('expired-2d23h@x.dev', 2 * DAY + 23 * HOUR),
    expired('expired-3d@x.dev', 3 * DAY),
    expired('expired-3d1h@x.dev', 3 * DAY + HOUR),
    expired('expired-5d@x.dev', 5 * DAY),
    // An expired row and a newer pending one for the same email.
    expired('again@x.dev', 2 * DAY + 12 * HOUR),
    orgRow({ email: 'again@x.dev', expiresAt: at(DAY), createdAt: at(-DAY) }),
    expired('gone@x.dev', 4 * DAY + 12 * HOUR, { invitedBy: null }),
    // The owner's own email, pending with its inviter deleted and its own expiry (3 hours out, so no other row shares
    // its label), in the other org the owner administers: TC-52.4 reads it as a row of that org's Invitations page and
    // as the invitee card. Not in Acme: resend refuses an email with another pending invitation in the same org
    // (BR-50), which would break the Acme rows of TC-49.
    orgRow({
      email: ownEmail,
      orgId: ids.org.alice,
      expiresAt: at(3 * HOUR),
      createdAt: at(-2 * DAY + 3 * HOUR),
      invitedBy: null,
    }),
  ];
}

function pagedInvitations(): InvitationRow[] {
  const pending = Array.from({ length: 25 }, (_, i) =>
    orgRow({ email: `bulk${String(i + 1).padStart(2, '0')}@x.dev`, createdAt: at(-(i + 1) * MIN) }),
  );
  const accepted = Array.from({ length: 3 }, (_, i) =>
    orgRow({ email: `done${i + 1}@x.dev`, status: 'accepted', acceptedAt: at(-HOUR), createdAt: at(-DAY - i * MIN) }),
  );
  return [...pending, ...accepted];
}

/** The pending row of `invitationChanged` that resend and revoke find already accepted. */
const CHANGED_ID = uuid('b3300000', 1);

const seeders: Record<OnboardingScenario, () => void> = {
  noOrgInvited() {
    signInAs({ name: 'Invitee', email: 'invitee@x.dev', handle: 'invitee' }, [], null);
    state().invitations = inviteeInvitations('invitee@x.dev');
  },
  // Exactly one pending, one expired and one revoked invitation and nothing else (TC-4.1 to TC-4.3).
  noOrgInvitedStates() {
    signInAs({ name: 'Invitee', email: 'invitee@x.dev', handle: 'invitee' }, [], null);
    state().invitations = inviteeInvitations('invitee@x.dev', (f) => [f.pending, f.expired, f.revoked]);
  },
  noOrgUninvited() {
    signInAs({ name: 'Uninvited', email: 'uninvited@x.dev', handle: 'uninvited' }, [], null);
    state().invitations = [];
  },
  platformAdminNoOrg() {
    signInAs({ platformAdmin: true }, [], null);
  },
  platformAdminOneOrg() {
    signInAs({ platformAdmin: true }, [{ orgId: ids.org.alice, roleKey: 'owner' }], ids.org.alice);
  },
  // A platform admin whose seat in the one org holds no role: the org is listed, its routes answer 403.
  platformAdminNoRole() {
    signInAs({ platformAdmin: true }, [{ orgId: ids.org.alice, roleKey: NO_ROLE }], ids.org.alice);
  },
  // The owner of the one org with exactly two pending invitations of their own (a clock at INVITATIONS_MOCK_NOW keeps them pending).
  singleOrgTwoPending() {
    seeders.singleOrg();
    state().invitations = inviteeInvitations(me().email.toLowerCase(), (f) => [f.pending, f.pendingProjects]);
  },
  singleOrg() {
    signInAs({}, [{ orgId: ids.org.alice, roleKey: 'owner' }], ids.org.alice);
  },
  twoOrgs() {
    signInAs(
      {},
      [
        { orgId: ids.org.alice, roleKey: 'owner' },
        { orgId: ids.org.acme, roleKey: 'owner' },
      ],
      ids.org.alice,
    );
  },
  twoOrgsSlowSwitch() {
    seeders.twoOrgs();
    state().setActiveDelayMs = 1500;
  },
  twoOrgsNoRoleInSecond() {
    signInAs(
      {},
      [
        { orgId: ids.org.alice, roleKey: 'owner' },
        // A seat that holds no role: the org is listed, its routes answer 403.
        { orgId: ids.org.acme, roleKey: NO_ROLE },
      ],
      ids.org.alice,
    );
  },
  owner() {
    acmeProjects([P1, P2]);
    inAcme('owner');
    seedMember();
    state().invitations = acmeInvitations();
  },
  orgAdmin() {
    acmeProjects([P1, P2]);
    inAcme('admin');
    state().invitations = acmeInvitations();
  },
  projectAdmin() {
    acmeProjects([P1, P2]);
    inAcme('admin', [P1]);
    state().checklists[ids.org.acme] = checklistFixtures.none;
    // As the API lists them to a project admin: only invitations whose every project they administer.
    state().invitations = acmeInvitations().filter(
      (i) => i.scope.type === 'project' && i.scope.projects.every((p) => p.id === P1),
    );
  },
  member() {
    acmeProjects([P1, P2]);
    inAcme('member');
    state().checklists[ids.org.acme] = checklistFixtures.none;
    state().invitations = acmeInvitations();
  },
  viewer() {
    acmeProjects([P1, P2]);
    inAcme('viewer');
    state().checklists[ids.org.acme] = checklistFixtures.none;
    state().invitations = acmeInvitations();
  },
  invitationsPaged() {
    acmeProjects([P1, P2]);
    inAcme('owner');
    state().invitations = pagedInvitations();
  },
  invitationsExpiry() {
    acmeProjects([P1, P2]);
    inAcme('owner');
    // Also an owner of the first org, whose Invitations page holds the row of TC-52.4.
    state().memberships.push({ userId: me().id, orgId: ids.org.alice, roleKey: 'owner' });
    state().invitations = expiryInvitations(me().email.toLowerCase());
  },
  invitationChanged() {
    acmeProjects([P1, P2]);
    inAcme('owner');
    state().invitations = [orgRow({ id: CHANGED_ID, email: 'p@x.dev', createdAt: at(-5 * MIN) })];
  },
  checklistNoProject() {
    acmeProjects([], true);
    inAcme('owner');
    state().checklists[ids.org.acme] = checklistFixtures.none;
  },
  checklistPartial() {
    acmeProjects([P1], true);
    inAcme('owner');
    // One project with no agent credential and no rule.
    clearSetup([P1]);
    state().checklists[ids.org.acme] = checklistFixtures.partial;
  },
  checklistTwoProjects() {
    acmeProjects([P1, P2], true);
    inAcme('owner');
    // P1 is furthest along (an agent credential, no rule), P2 has nothing done: the checklist names P1.
    clearSetup([P1], { keepAgent: true });
    clearSetup([P2]);
    state().checklists[ids.org.acme] = {
      complete: false,
      projectId: P1,
      steps: [
        { key: 'connect_code_host', done: true },
        { key: 'create_project', done: true },
        { key: 'add_agent', done: true },
        { key: 'add_rule', done: false },
      ],
    };
  },
  checklistComplete() {
    acmeProjects([P1], true);
    inAcme('owner');
    state().checklists[ids.org.acme] = checklistFixtures.complete;
  },
  ownerInvitationFailsOnce() {
    seeders.platformAdminOneOrg();
    state().failNextOrgInvitationCreate = true;
  },
};

/** Resets the store and seeds it for `name`. Handler overrides come with `scenarios.onboarding`. */
export function applyOnboardingScenario(name: OnboardingScenario): void {
  base();
  rowCounter = 0;
  seeders[name]();
}

/** Handlers a scenario puts in front of the defaults. Anything they do not answer falls through to the default. */
export function onboardingOverrides(name: OnboardingScenario): HttpHandler[] {
  if (name !== 'invitationChanged') return [];
  // The invitation was accepted meanwhile: resend and revoke find it so, and the next list shows it.
  const flip = (id: unknown): boolean => {
    const row = state().invitations.find((i) => i.id === id);
    if (!row || row.id !== CHANGED_ID) return false;
    row.status = 'accepted';
    row.acceptedAt = INVITATIONS_MOCK_NOW;
    return true;
  };
  const resend = routeDef('invitations.resend');
  const revoke = routeDef('invitations.remove');
  return [
    http.post(resend.path, ({ request, params }) => {
      if (!flip(params['invitationId'])) return undefined;
      mockDb.logRequest(resend.method, new URL(request.url).pathname);
      return problemResponse({ status: 409, title: 'Invitation is no longer pending', type: 'conflict' });
    }),
    http.delete(revoke.path, ({ request, params }) => {
      if (!flip(params['invitationId'])) return undefined;
      mockDb.logRequest(revoke.method, new URL(request.url).pathname);
      return problemResponse({ status: 409, title: 'Invitation is not pending', type: 'conflict' });
    }),
  ];
}
