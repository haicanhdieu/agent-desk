import type {
  AgentDto,
  ConnectionDto,
  IgnoredEventDto,
  ProjectConnectionDto,
  ProjectDto,
  RepoDto,
  RuleDto,
  RunDto,
  RunEventDto,
  SkillDto,
} from '@agentdesk/contracts';
import { agentFixtures } from '../dto/agents';
import { connectionFixtures, connectionOrg, repoFixtures } from '../dto/connections';
import { runEventFixtures } from '../dto/events';
import { ids } from '../dto/ids';
import { ignoredFixtures, projectConnectionFixtures, projectFixtures, projectOrg } from '../dto/projects';
import { ruleFixtures } from '../dto/rules';
import { runFixtures } from '../dto/runs';
import { skillFixtures } from '../dto/skills';

// In-memory store behind every MSW handler (Vitest, Storybook and `dev:mock`). Rows carry their org so handlers can
// scope by the session's active org the way RLS does on the server. Responses are parsed through the contract
// schemas, which strip the extra row fields.

export interface MockUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  /** Additional user field (GitHub login) the API adds to the better-auth user. */
  handle: string;
  createdAt: string;
  updatedAt: string;
}

export interface MockOrg {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  metadata: string | null;
  createdAt: string;
}

export interface MockAuth {
  signedIn: boolean;
  activeOrganizationId: string | null;
}

export type ProjectRow = Omit<ProjectDto, 'counts' | 'lastRunAt'> & { orgId: string };
export type ConnectionRow = ConnectionDto & { orgId: string };
/** Per-project trigger state; `projects.connection` shows the half that matches the project's trigger mode. */
export interface TriggerState {
  webhook: NonNullable<ProjectConnectionDto['webhook']>;
  polling: Omit<NonNullable<ProjectConnectionDto['polling']>, 'intervalSeconds'>;
}

export interface MockState {
  auth: MockAuth;
  users: MockUser[];
  orgs: MockOrg[];
  members: { userId: string; orgId: string }[];
  connections: ConnectionRow[];
  repos: Record<string, RepoDto[]>;
  projects: ProjectRow[];
  triggers: Record<string, TriggerState>;
  ignored: Record<string, IgnoredEventDto[]>;
  agents: AgentDto[];
  skills: Record<string, SkillDto[]>;
  rules: RuleDto[];
  runs: RunDto[];
  runEvents: Record<string, RunEventDto[]>;
}

const emptyPolling: TriggerState['polling'] = {
  lastCheckedAt: null,
  lastError: null,
  pausedReason: null,
  nextPollAt: null,
};

function triggerStateOf(dto: ProjectConnectionDto): TriggerState {
  const p = dto.polling ?? emptyPolling;
  return {
    webhook: dto.webhook ?? { lastEventAt: null, lastEventAction: null },
    polling: {
      lastCheckedAt: p.lastCheckedAt,
      lastError: p.lastError,
      pausedReason: p.pausedReason,
      nextPollAt: p.nextPollAt,
    },
  };
}

function orgOf(map: Record<string, string>, id: string): string {
  const org = map[id];
  if (!org) throw new Error(`fixture ${id} has no org`);
  return org;
}

export function seedState(): MockState {
  const created = '2026-09-01T09:00:00.000Z';
  const state: MockState = {
    auth: { signedIn: true, activeOrganizationId: ids.org.alice },
    users: [
      {
        id: ids.user.alice,
        name: 'Alice',
        email: 'alice@example.com',
        emailVerified: true,
        image: null,
        handle: 'alice',
        createdAt: created,
        updatedAt: created,
      },
    ],
    orgs: [
      { id: ids.org.alice, name: 'Alice', slug: 'alice', logo: null, metadata: null, createdAt: created },
      { id: ids.org.acme, name: 'Acme', slug: 'acme', logo: null, metadata: null, createdAt: created },
    ],
    members: [
      { userId: ids.user.alice, orgId: ids.org.alice },
      { userId: ids.user.alice, orgId: ids.org.acme },
    ],
    connections: connectionFixtures.map((c) => ({ ...c, orgId: orgOf(connectionOrg, c.id) })),
    repos: repoFixtures,
    // counts and lastRunAt ride along unused: handlers recompute them from the runs.
    projects: projectFixtures.map((p) => ({ ...p, orgId: orgOf(projectOrg, p.id) })),
    triggers: Object.fromEntries(
      Object.entries(projectConnectionFixtures).map(([id, dto]) => [id, triggerStateOf(dto)]),
    ),
    ignored: ignoredFixtures,
    agents: agentFixtures,
    skills: skillFixtures,
    rules: ruleFixtures,
    runs: runFixtures,
    runEvents: runEventFixtures,
  };
  // Every test and page load mutates its own copy, never the fixtures.
  return structuredClone(state);
}

export const defaultTriggerState = (): TriggerState => ({
  webhook: { lastEventAt: null, lastEventAction: null },
  polling: { ...emptyPolling },
});

let state = seedState();
let log: { method: string; path: string }[] = [];
let counter = 0;
let requestCounter = 0;

export const mockDb = {
  get state(): MockState {
    return state;
  },
  /** Back to the seed: signed in as alice, active org alice, every fixture present, request log empty. */
  reset(): void {
    state = seedState();
    log = [];
    counter = 0;
  },
  /** A deep copy of the whole store (tests assert secrets never land in it). */
  snapshot(): MockState {
    return structuredClone(state);
  },
  get auth(): MockAuth {
    return state.auth;
  },
  restoreAuth(auth: MockAuth): void {
    state.auth = { ...auth };
  },
  signIn(): void {
    state.auth.signedIn = true;
    state.auth.activeOrganizationId ??= ids.org.alice;
  },
  signOut(): void {
    state.auth.signedIn = false;
  },
  setActiveOrg(orgId: string | null): void {
    state.auth.activeOrganizationId = orgId;
  },
  /** The signed-in user, or null when signed out. */
  currentUser(): MockUser | null {
    return state.auth.signedIn ? state.users[0] ?? null : null;
  },
  orgsOf(userId: string): MockOrg[] {
    const mine = new Set(state.members.filter((m) => m.userId === userId).map((m) => m.orgId));
    return state.orgs.filter((o) => mine.has(o.id));
  },
  logRequest(method: string, path: string): void {
    log.push({ method, path });
  },
  /** How many requests hit `method path` (pathname, no query) since the last reset. */
  requests(method: string, path: string): number {
    return log.filter((r) => r.method === method && r.path === path).length;
  },
  /** A fresh UUID for created records. */
  nextId(): string {
    counter += 1;
    return ids.created(counter);
  },
  /** Opaque `x-request-id` values; unique across resets so ids in a test run never repeat. */
  nextRequestId(): string {
    requestCounter += 1;
    return `req-mock-${String(requestCounter).padStart(6, '0')}`;
  },
};
