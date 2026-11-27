import type { SkillDto } from '@agentdesk/contracts';
import { roleFixtures } from '../dto/access';
import { agentsFixture } from '../dto/agents';
import { agentListId, ids } from '../dto/ids';
import { defaultTriggerState, mockDb, type InvitationRow, type MockState } from './db';
import { applyOnboardingScenario } from './onboardingScenarios';

// The mock scenarios of the side-menu shell (spec "E2E requirements"). A spec picks one through sessionStorage
// (`SHELL_KEY`, written by e2e/mock/mock.ts `seedShell`); browser.ts reads it once when the worker starts. Each scenario
// resets the store, then seeds it: it starts from an onboarding scenario that already gives the people and orgs.

export const SHELL_KEY = 'agentdesk.mock.shell';

export const SHELL_SCENARIOS = [
  'adminP1ViewerP2',
  'memberP1ViewerP2',
  'adminAMemberB',
  'suspendedOnly',
  'oneOrgNoPlatform',
  'unfinishedProjects',
  'unfinishedAtRules',
  'unfinishedCodex',
  'unfinishedAsMember',
  'unfinishedAsViewer',
  'unfinishedAsAdmin',
  'unfinishedProjectAdmin',
  'connectionWarn',
  'connectionError',
  'noDefaultBranch',
  'developBranch',
  'longNames',
  'auditOnly',
  'orgUpdateOnly',
  'distinctProjects',
  'markerTicket',
  'foreignOrg',
  'foreignInvite',
  'memberOwnsRuns',
  'memberOthersRuns',
] as const;
export type ShellScenario = (typeof SHELL_SCENARIOS)[number];

export function parseShellScenario(raw: string | null): ShellScenario | undefined {
  return SHELL_SCENARIOS.find((s) => s === raw);
}

const P1 = ids.project.invoicerApi;
const P2 = ids.project.invoicerWeb;
const DAY = 24 * 60 * 60 * 1000;
const CREATED = '2026-09-01T09:00:00.000Z';

/** The text `markerTicket` puts in run 62's ticket title and comment: unique, and HTML-like to show it is never rendered as markup. */
export const MARKER = 'shell-marker-7f3a91';
const MARKER_TEXT = `${MARKER} <b>bold</b> <img src=x onerror=alert(1)>`;

/** The org, project and invitation of `foreignOrg` and `foreignInvite`: distinctive names, so a leak is easy to spot. */
export const FOREIGN = {
  orgId: 'b6000000-0000-4000-8000-000000000004',
  orgName: 'Zephyr Foreign Holdings',
  orgSlug: 'zephyr-foreign',
  projectId: 'a0000000-0000-4000-8000-000000000006',
  projectName: 'zephyr-secret-ledger',
  invitationId: 'b4100000-0000-4000-8000-000000000001',
} as const;

const state = (): MockState => mockDb.state;

function seatOf(orgId: string) {
  const seat = state().memberships.find((m) => m.userId === ids.user.alice && m.orgId === orgId);
  if (!seat) throw new Error(`no seat in org ${orgId}`);
  return seat;
}

function projectOf(id: string) {
  const row = state().projects.find((p) => p.id === id);
  if (!row) throw new Error(`project fixture ${id} missing`);
  return row;
}

/** Alice alone in her org (the `singleOrg` onboarding scenario), with her seat's role replaced. */
function oneOrgAs(roleKey: string): void {
  applyOnboardingScenario('singleOrg');
  seatOf(ids.org.alice).roleKey = roleKey;
}

function addForeignOrg(): void {
  state().orgs.push({
    id: FOREIGN.orgId,
    name: FOREIGN.orgName,
    slug: FOREIGN.orgSlug,
    logo: null,
    metadata: null,
    createdAt: CREATED,
  });
  state().projects.push({
    ...structuredClone(projectOf(P1)),
    id: FOREIGN.projectId,
    orgId: FOREIGN.orgId,
    name: FOREIGN.projectName,
    repoPath: `zephyr/${FOREIGN.projectName}`,
  });
}

function roleRef(key: string): InvitationRow['role'] {
  const role = roleFixtures.find((r) => r.key === key);
  if (!role) throw new Error(`role fixture ${key} missing`);
  return { id: role.id, key: role.key, name: role.name };
}

function skill(name: string, body: string): SkillDto {
  return {
    name,
    description: `The ${name} skill.`,
    path: `.claude/skills/${name}/SKILL.md`,
    lastCommit: { sha: 'a91c3e2', message: 'Add agent skills', at: '2026-11-10T14:00:00.000Z' },
    body: `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`,
    sha: `a91c3e2-${name}-${body.length}`,
  };
}

const script = (version: number, body: string) => ({
  version,
  body,
  note: null,
  createdBy: 'kim-hale',
  createdAt: '2026-11-01T09:00:00.000Z',
});

const seeders: Record<ShellScenario, () => void> = {
  // Alice administers invoicer-api only and can read invoicer-web: one grant per project, nothing org-wide.
  adminP1ViewerP2() {
    applyOnboardingScenario('singleOrg');
    const seat = seatOf(ids.org.alice);
    seat.roleKey = 'admin';
    seat.projectIds = [P1, P2];
    seat.projectRoles = [
      { projectId: P1, roleKey: 'admin' },
      { projectId: P2, roleKey: 'viewer' },
    ];
  },
  // Alice is a member of invoicer-api and a viewer of invoicer-web: one grant per project, nothing org-wide.
  memberP1ViewerP2() {
    applyOnboardingScenario('singleOrg');
    const seat = seatOf(ids.org.alice);
    seat.roleKey = 'member';
    seat.projectIds = [P1, P2];
    seat.projectRoles = [
      { projectId: P1, roleKey: 'member' },
      { projectId: P2, roleKey: 'viewer' },
    ];
  },
  // Admin of the first org and a plain member of the second.
  adminAMemberB() {
    applyOnboardingScenario('twoOrgs');
    seatOf(ids.org.alice).roleKey = 'admin';
    seatOf(ids.org.acme).roleKey = 'member';
  },
  // The only org is suspended: its pages answer 403 org-suspended, and alice is no platform admin.
  suspendedOnly() {
    applyOnboardingScenario('singleOrg');
    const org = state().orgs.find((o) => o.id === ids.org.alice);
    if (!org) throw new Error('alice org missing');
    org.status = 'suspended';
  },
  oneOrgNoPlatform() {
    applyOnboardingScenario('singleOrg');
  },
  // Two projects whose setup stopped at different steps: the project list offers "Resume setup" for each.
  unfinishedProjects() {
    applyOnboardingScenario('singleOrg');
    projectOf(P1).setupStep = 'agent';
    projectOf(P2).setupStep = 'skills';
  },
  // invoicer-api stopped on the rules step: the wizard shows the rule guards.
  unfinishedAtRules() {
    applyOnboardingScenario('singleOrg');
    projectOf(P1).setupStep = 'rules';
  },
  // invoicer-api has one saved Codex agent and its setup stopped after the Agent step.
  unfinishedCodex() {
    applyOnboardingScenario('singleOrg');
    projectOf(P1).setupStep = 'setup';
    const codex = agentsFixture.find((a) => a.name === 'Codex');
    if (!codex) throw new Error('Codex agent fixture missing');
    state().agents = [
      ...state().agents.filter((a) => a.projectId !== P1),
      { ...structuredClone(codex), projectId: P1, isDefault: true },
    ];
  },
  // The unfinished projects of `unfinishedProjects`, seen by people who must not resume them.
  unfinishedAsMember() {
    seeders.unfinishedProjects();
    seatOf(ids.org.alice).roleKey = 'member';
  },
  unfinishedAsViewer() {
    seeders.unfinishedProjects();
    seatOf(ids.org.alice).roleKey = 'viewer';
  },
  unfinishedAsAdmin() {
    seeders.unfinishedProjects();
    seatOf(ids.org.alice).roleKey = 'admin';
  },
  // Alice administers only invoicer-api (stopped on the Agent step) and has no org-wide role.
  unfinishedProjectAdmin() {
    seeders.unfinishedProjects();
    const seat = seatOf(ids.org.alice);
    seat.roleKey = 'member';
    seat.projectIds = [P1];
    seat.projectRoles = [{ projectId: P1, roleKey: 'admin' }];
  },
  // Webhooks silent for three days.
  connectionWarn() {
    applyOnboardingScenario('singleOrg');
    const trigger = defaultTriggerState();
    trigger.webhook = {
      lastEventAt: new Date(Date.now() - 3 * DAY).toISOString(),
      lastEventAction: 'issue_comment.created',
    };
    state().triggers[P1] = trigger;
  },
  // Polling stopped because the token was revoked.
  connectionError() {
    applyOnboardingScenario('singleOrg');
    projectOf(P1).triggerMode = 'polling';
    const trigger = defaultTriggerState();
    trigger.polling = {
      lastCheckedAt: new Date(Date.now() - DAY).toISOString(),
      lastError: null,
      pausedReason: 'token_revoked',
      nextPollAt: null,
    };
    state().triggers[P1] = trigger;
  },
  noDefaultBranch() {
    applyOnboardingScenario('singleOrg');
    projectOf(P1).defaultBranch = null;
  },
  // The default branch is develop and the connection is OK (a webhook arrived a minute ago).
  developBranch() {
    applyOnboardingScenario('singleOrg');
    projectOf(P1).defaultBranch = 'develop';
    const trigger = defaultTriggerState();
    trigger.webhook = {
      lastEventAt: new Date(Date.now() - 60_000).toISOString(),
      lastEventAction: 'issue_comment.created',
    };
    state().triggers[P1] = trigger;
  },
  longNames() {
    applyOnboardingScenario('singleOrg');
    const org = state().orgs.find((o) => o.id === ids.org.alice);
    if (!org) throw new Error('alice org missing');
    org.name = 'Harbor Labs Platform Engineering and Infrastructure Reliability Organization';
    projectOf(P1).name = 'invoicer-api-with-a-very-long-name-that-keeps-going-until-it-has-to-be-cut-short';
  },
  auditOnly() {
    oneOrgAs('audit-reader');
  },
  orgUpdateOnly() {
    oneOrgAs('org-updater');
  },
  // Two projects that differ in what the project switcher must not carry across: saved setup scripts and a skill of the same name.
  distinctProjects() {
    applyOnboardingScenario('singleOrg');
    state().setupScripts[P1] = [script(1, 'echo "setup of invoicer-api"')];
    state().setupScripts[P2] = [script(1, 'echo "setup of invoicer-web"')];
    state().skills[P1] = [skill('shared-skill', 'Text of the skill in invoicer-api.')];
    state().skills[P2] = [skill('shared-skill', 'Different text of the skill in invoicer-web.')];
    // Different agents and limits, and a different trigger mode, so a value that crosses the switcher shows.
    const agentOf = (projectId: string) => {
      const found = state().agents.find((a) => a.projectId === projectId);
      if (!found) throw new Error(`agent fixture of ${projectId} missing`);
      return found;
    };
    Object.assign(agentOf(P1), { name: 'Claude - invoicer-api' });
    Object.assign(agentOf(P2), { name: 'Claude - invoicer-web' });
    // P1 also has a second agent that nothing uses, so it can be deleted (a project's only agent cannot).
    state().agents.push({
      ...structuredClone(agentOf(P1)),
      id: agentListId(900),
      name: 'Codex - invoicer-api',
      isDefault: false,
    });
    // The limits are the project's own.
    Object.assign(projectOf(P1), { timeoutSeconds: 86400, autoResumeMax: 5 });
    Object.assign(projectOf(P2), { timeoutSeconds: 7200, autoResumeMax: 2 });
    projectOf(P1).triggerMode = 'webhook';
    projectOf(P2).triggerMode = 'polling';
    projectOf(P1).pollIntervalSeconds = 300;
    projectOf(P2).pollIntervalSeconds = 1800;
  },
  // Run 62's ticket title and its comment (the run's arguments) hold the marker and HTML-like text.
  markerTicket() {
    applyOnboardingScenario('singleOrg');
    const run = state().runs.find((r) => r.projectId === P1 && r.number === 62);
    if (!run) throw new Error('run 62 fixture missing');
    run.ticket.title = MARKER_TEXT;
    run.args = MARKER_TEXT;
  },
  // Alice is a member of invoicer-api (nothing org-wide) and owns its runs: a member keeps the run actions on own runs.
  memberOwnsRuns() {
    seeders.memberP1ViewerP2();
    for (const run of state().runs.filter((r) => r.projectId === P1)) run.ownerUserId = ids.user.alice;
  },
  // The same seat, with the runs owned by someone else: a member has no run action there.
  memberOthersRuns() {
    seeders.memberP1ViewerP2();
    for (const run of state().runs.filter((r) => r.projectId === P1)) run.ownerUserId = 'user-someone-else';
  },
  // An org and a project alice is not in: they must show nowhere.
  foreignOrg() {
    applyOnboardingScenario('singleOrg');
    addForeignOrg();
  },
  // A pending invitation from such an org, for alice's own email.
  foreignInvite() {
    applyOnboardingScenario('singleOrg');
    addForeignOrg();
    const email = state().users[0]?.email.toLowerCase();
    if (email === undefined) throw new Error('seed has no user');
    state().invitations.push({
      id: FOREIGN.invitationId,
      orgId: FOREIGN.orgId,
      email,
      role: roleRef('member'),
      scope: { type: 'org' },
      status: 'pending',
      expiresAt: new Date(Date.now() + 2 * DAY).toISOString(),
      invitedBy: { name: 'Zed Zephyr', handle: 'zed' },
      createdAt: new Date().toISOString(),
      acceptedAt: null,
    });
  },
};

/** Resets the store and seeds `scenario`. */
export function applyShellScenario(scenario: ShellScenario): void {
  seeders[scenario]();
}
