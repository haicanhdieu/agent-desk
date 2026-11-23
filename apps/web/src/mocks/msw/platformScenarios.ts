import type { HttpHandler } from 'msw';
import { PAGE_SIZE_DEFAULT, type PlatformAdminDto } from '@agentdesk/contracts';
import { platformAdminFixtures } from '../dto/access';
import { mockDb } from './db';
import { problemResponse, routeHandler } from './http';
import { applyOnboardingScenario } from './onboardingScenarios';
import { seedPlatformAdmins } from './platformAdmins';
import { seedPlatformOrgs } from './platformOrgs';

// The platform-admin mock scenarios: one module for the route tests and the mocked e2e specs. A spec picks a scenario
// through sessionStorage (`PLATFORM_SCENARIO_KEY`, written by e2e/mock/mock.ts `seedPlatform`); browser.ts reads it once
// when the worker starts. Each scenario resets the store (through an onboarding scenario), then seeds the admin list.

export const PLATFORM_SCENARIO_KEY = 'agentdesk.mock.platform';

// `lastAdminPage1` is `lastAdmin` with the working admin on page 1 (a spec can pass only a name). Later tasks append scenarios.
export const PLATFORM_SCENARIOS = [
  'platformAdminOrgs',
  'platformAdminNoOrg',
  'ownerNoPlatform',
  'lastAdmin',
  'revoke409',
  'platformEmpty',
  'lastAdminPage1',
  'ownAdminRow',
  'unverifiedAccount',
] as const;

export type PlatformScenario = (typeof PLATFORM_SCENARIOS)[number];

export function parsePlatformScenario(raw: string | null): PlatformScenario | undefined {
  return PLATFORM_SCENARIOS.find((s) => s === raw);
}

const SEEDED_AT = '2026-10-05T10:30:00.000Z';
const uuid = (n: number) => `b7000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Three pages at the default page size: two full ones and a part page. */
const LAST_ADMIN_ENTRIES = PAGE_SIZE_DEFAULT * 2 + 5;

/** The working admin (the signed-in user) among seeded entries that have no account yet. */
function lastAdminEntries(workingOnFirstPage: boolean): PlatformAdminDto[] {
  const user = mockDb.state.users[0];
  if (!user) throw new Error('seed has no user');
  const working: PlatformAdminDto = {
    id: uuid(1),
    email: user.email.toLowerCase(),
    userId: user.id,
    name: user.name,
    handle: user.handle,
    grantedAt: SEEDED_AT,
    grantedBy: null,
    lastWorkingAdmin: false,
  };
  const pending = Array.from({ length: LAST_ADMIN_ENTRIES - 1 }, (_, i): PlatformAdminDto => ({
    id: uuid(i + 2),
    email: `pending${String(i + 1).padStart(2, '0')}@example.com`,
    userId: null,
    name: null,
    handle: null,
    grantedAt: SEEDED_AT,
    grantedBy: null,
    lastWorkingAdmin: false,
  }));
  // The list is served in store order: index 0 is page 1, index PAGE_SIZE_DEFAULT is the first of page 2.
  const at = workingOnFirstPage ? 0 : PAGE_SIZE_DEFAULT;
  return [...pending.slice(0, at), working, ...pending.slice(at)];
}

const seeders: Record<PlatformScenario, () => void> = {
  platformAdminOrgs: () => applyOnboardingScenario('platformAdminOneOrg'),
  platformAdminNoOrg: () => applyOnboardingScenario('platformAdminNoOrg'),
  ownerNoPlatform: () => applyOnboardingScenario('singleOrg'),
  lastAdmin() {
    applyOnboardingScenario('platformAdminOneOrg');
    seedPlatformAdmins(lastAdminEntries(false));
  },
  lastAdminPage1() {
    applyOnboardingScenario('platformAdminOneOrg');
    seedPlatformAdmins(lastAdminEntries(true));
  },
  ownAdminRow() {
    applyOnboardingScenario('platformAdminOneOrg');
    const user = mockDb.state.users[0];
    if (!user) throw new Error('seed has no user');
    const other = platformAdminFixtures.find((a) => a.userId !== null);
    if (!other) throw new Error('no working admin fixture');
    seedPlatformAdmins([
      {
        id: uuid(1),
        email: user.email.toLowerCase(),
        userId: user.id,
        name: user.name,
        handle: user.handle,
        grantedAt: SEEDED_AT,
        grantedBy: null,
        lastWorkingAdmin: false,
      },
      other,
    ]);
  },
  unverifiedAccount() {
    applyOnboardingScenario('platformAdminOneOrg');
    const user = mockDb.state.users[0];
    if (!user) throw new Error('seed has no user');
    mockDb.state.users.push({
      ...user,
      id: 'user-unverified',
      name: 'Unverified',
      email: 'unverified@example.test',
      emailVerified: false,
      handle: 'unverified',
      platformAdmin: false,
    });
  },
  revoke409: () => applyOnboardingScenario('platformAdminOneOrg'),
  platformEmpty() {
    applyOnboardingScenario('platformAdminOneOrg');
    seedPlatformAdmins([]);
    seedPlatformOrgs([]);
  },
};

/** Resets the store and seeds it for `name`. Handler overrides come with `scenarios.platform`. */
export function applyPlatformScenario(name: PlatformScenario): void {
  seeders[name]();
}

/** Handlers a scenario puts in front of the defaults. */
export function platformOverrides(name: PlatformScenario): HttpHandler[] {
  if (name !== 'revoke409') return [];
  return [
    routeHandler('platform.revokeAdmin', async () =>
      problemResponse({
        status: 409,
        title: 'Last working platform admin',
        type: 'conflict',
        detail: 'Grant the role to another account before revoking this one.',
      }),
    ),
  ];
}
