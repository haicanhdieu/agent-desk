import type { Locator, Page } from '@playwright/test';
import { AGENT_MODELS_SCENARIO_KEY, type AgentModelsScenario } from '../../src/mocks/msw/agentModels';
import { AGENT_SCENARIO_KEY, type AgentScenario } from '../../src/mocks/msw/agentScenarios';
import { SKILL_REVIEW_KEY } from '../../src/mocks/msw/skillReview';
import { GITHUB_SYNC_SCENARIO_KEY, type GithubSyncScenario } from '../../src/mocks/msw/githubSync';
import { PR_STATES_SCENARIO_KEY, type PrStatesScenario } from '../../src/mocks/msw/prStates';
import { ids } from '../../src/mocks/dto/ids';
import { HOLD_KEY, type HeldRead, type HoldConfig, type ReadMode } from '../../src/mocks/msw/holdScenarios';
import { MOCK_LISTS_KEY, type MockLists } from '../../src/mocks/msw/e2eLists';
import { ONBOARDING_SCENARIO_KEY, type OnboardingScenario } from '../../src/mocks/msw/onboardingScenarios';
import { PLATFORM_SCENARIO_KEY, type PlatformScenario } from '../../src/mocks/msw/platformScenarios';
import {
  PROJECT_SPACE_KEY,
  type ProjectSpaceRole,
  type ProjectSpaceScenario,
} from '../../src/mocks/msw/projectSpaceScenarios';
import { SHELL_KEY, type ShellScenario } from '../../src/mocks/msw/shellScenarios';
import { TENANT_ADMIN_SCENARIO_KEY, type TenantAdminScenario } from '../../src/mocks/msw/tenantAdminScenarios';

/*
 * Mock-mode controls for the e2e specs. There is no test hook in the app: these use what `vite --mode mock` already
 * does (src/main.tsx starts MSW only in mock mode; src/mocks/msw/browser.ts).
 *
 * - Fresh state per test: the mock store (src/mocks/msw/db.ts) lives in page memory and is seeded on every page load,
 *   and Playwright gives each test a new browser context. So every test starts from the seed: signed in as alice,
 *   active org alice, the fixture projects, rules and runs. Navigate with clicks after the first `page.goto`: a second
 *   `goto` reloads the page and reseeds the store.
 * - Signed-out start: browser.ts restores the auth state from sessionStorage (`agentdesk.mock.auth`) so the social
 *   sign-in redirect keeps it. `startSignedOut` writes "signed out" there before the first page load only, so the
 *   MSW sign-in survives the redirect that follows.
 * - Run script: browser.ts scripts run 63 of invoicer-api (DEFAULT_RUN_SCRIPT in stream-handlers.ts) to go
 *   queued → starting → running → idle once its event stream opens, about 16 s in all.
 */

const AUTH_KEY = 'agentdesk.mock.auth';
const SEEDED_KEY = 'agentdesk.e2e.seeded';

/** The seeded org slug and the project that holds the scripted run. */
export const ORG = 'alice';
export const INVOICER_API = 'a0000000-0000-4000-8000-000000000001';
/** The agent of INVOICER_API (the Desk → Agent screen's agent). */
export const INVOICER_API_AGENT: string = ids.agent.invoicerApi;
export const SCRIPTED_RUN = 63;
/** A paused run with a kept session (fixtures: dto/runs.ts). */
export const PAUSED_RUN = 64;
/** A run nobody resumed in time (fixtures: dto/runs.ts). */
export const EXPIRED_RUN = 66;
/** The runs in the terminal lifecycle states: ending, agent crashed, resume failed, resumed, pod killed (src/mocks/dto/lifecycleRuns.ts, browser mock only). */
export const ENDING_RUN = 67;
export const CRASHED_RUN = 68;
export const RESUME_FAILED_RUN = 69;
export const RESUMED_RUN = 70;
export const KILLED_RUN = 71;
/** The runs after an unexpected pod end with automatic resume (src/mocks/dto/autoResumeRuns.ts, browser mock only). */
export const GAVE_UP_RUN = 99;
export const GAVE_UP_ONCE_RUN = 100;
export const CRASHED_GAVE_UP_RUN = 101;
export const AUTO_WAITING_RUN = 102;
export const AUTO_FAILED_GAVE_UP_RUN = 103;
export const AUTO_RESUMED_RUNNING_RUN = 104;
/**
 * The runs for stop session and the saved Transcript (src/mocks/dto/sessionRuns.ts, browser mock only). The mocked
 * specs install a fixed clock at SESSION_MOCK_NOW so their relative times ("Stopped by you 2 min ago.") hold.
 * Run behaviours there: 72 and 73 answer cancel and finish after 3 s; 75, 76, 90 and 94 answer the transcript after
 * 3 s; 91 fails it with request id req-123, 92 without an id, 93 only the first time.
 */
export const SESSION_MOCK_NOW = '2026-11-19T14:20:00.000Z';
export const STOP_RUNNING_RUN = 72;
export const STOP_IDLE_RUN = 73;
export const STOP_DONE_RUN = 74;
export const STOP_RUNNING_ENDING_RUN = 75;
export const STOP_DONE_ENDING_RUN = 76;
export const STOPPED_RUN = 77;
export const STOPPED_ISSUE_RUN = 78;
export const STOPPED_DAY_RUN = 79;
export const STOPPED_NOW_RUN = 80;
export const STOPPED_LATE_RUN = 81;
export const FINISHED_AFTER_PAUSE_RUN = 82;
export const EXPIRED_STOPPED_RUN = 83;
export const TRANSCRIPT_RICH_RUN = 84;
export const TRANSCRIPT_LONG_RUN = 85;
export const TRANSCRIPT_FAILED_RUN = 86;
export const TRANSCRIPT_TIMED_OUT_RUN = 87;
export const TRANSCRIPT_CANCELLED_RUN = 88;
export const TRANSCRIPT_RESUMING_RUN = 89;
export const TRANSCRIPT_SLOW_RUN = 90;
export const TRANSCRIPT_ERROR_RUN = 91;
export const TRANSCRIPT_ERROR_NO_ID_RUN = 92;
export const TRANSCRIPT_FLAKY_RUN = 93;
export const SCROLLBACK_PAUSED_RUN = 94;
export const SCROLLBACK_ENDED_RUN = 95;
export const NOTHING_ENDED_RUN = 96;
export const NOTHING_PAUSED_RUN = 97;
export const PAUSED_TRANSCRIPT_RUN = 98;
/** Failed at start because its agent had no credential: the end note offers Replace credential (dto/sessionRuns.ts). */
export const NO_CREDENTIAL_RUN = 121;
/** An idle run (Needs you) that has a live terminal. */
export const IDLE_RUN = 62;
/** The runs with recorded token usage and cost, by case: id to run number (src/mocks/dto/usageRuns.ts, browser mock only). */
export { USAGE_RUNS } from '../../src/mocks/dto/usageRuns';

/** The first page load of this test starts signed out (get-session null, API 401). */
export async function startSignedOut(page: Page): Promise<void> {
  await page.addInitScript(
    ([authKey, seededKey]) => {
      if (sessionStorage.getItem(seededKey) !== null) return;
      sessionStorage.setItem(seededKey, '1');
      sessionStorage.setItem(authKey, JSON.stringify({ signedIn: false, activeOrganizationId: null }));
    },
    [AUTH_KEY, SEEDED_KEY] as const,
  );
}

/**
 * Picks the model-list answer per agent id for this test (src/mocks/msw/agentModels.ts). Call before the first
 * `page.goto`: browser.ts reads the key once when the mock worker starts.
 */
export async function setAgentModels(page: Page, byAgent: Record<string, AgentModelsScenario>): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [AGENT_MODELS_SCENARIO_KEY, JSON.stringify(byAgent)] as const,
  );
}

/**
 * Puts invoicer-api's agents in a named state for this test (src/mocks/msw/agentScenarios.ts: `manyAgents`,
 * `agentsEmpty`, `listError`, ...). Call before the first `page.goto`: browser.ts reads the key once when the mock
 * worker starts.
 */
export async function seedAgents(page: Page, scenario: AgentScenario): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [AGENT_SCENARIO_KEY, scenario] as const,
  );
}

/** What `answerRequest` does with the matching requests of one test. */
export interface RequestAnswer {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Matched against the request path (a RegExp source). */
  path: string;
  /** Matching requests answered this way (the rest pass through to the mock API). */
  times: number;
  /** `hold`: the request waits until `window.__releaseHeldRequest()` is called, then goes on to the mock API. */
  hold?: boolean;
  /** Otherwise: the problem the request is answered with, as the API sends it. */
  problem?: { status: number; title: string; detail?: string };
}

/**
 * Holds or fails matching requests of this test at the page's `fetch`, before the mock API sees them (the service
 * worker answers requests Playwright's `page.route` never sees). Call before the first `page.goto`.
 */
export async function answerRequest(page: Page, answer: RequestAnswer): Promise<void> {
  await page.addInitScript((a) => {
    const original = window.fetch.bind(window);
    let used = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { __releaseHeldRequest: release });
    const pattern = new RegExp(a.path);
    window.fetch = async (input, init) => {
      const req = input instanceof Request ? input : undefined;
      const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
      const url = new URL(req ? req.url : String(input), window.location.href);
      if (method !== a.method || !pattern.test(url.pathname) || used >= a.times) return original(input, init);
      used += 1;
      if (a.hold) {
        await gate;
        return original(input, init);
      }
      const p = a.problem ?? { status: 500, title: 'Internal server error' };
      return new Response(
        JSON.stringify({
          type: 'about:blank',
          title: p.title,
          status: p.status,
          ...(p.detail !== undefined && { detail: p.detail }),
        }),
        { status: p.status, headers: { 'content-type': 'application/problem+json' } },
      );
    };
  }, answer);
}

/**
 * How `tickets.prStates` answers for this test: slow, failing, never answering, or without draft and closed refs. Call
 * before the first `page.goto`: browser.ts reads the key once when the mock worker starts.
 */
export async function setPrStates(page: Page, scenario: PrStatesScenario): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [PR_STATES_SCENARIO_KEY, scenario] as const,
  );
}

/**
 * Makes `connections.sync` fail for this test until the page signs in with GitHub again (`reauth`: the stored GitHub
 * token is dead; `unavailable`: GitHub is down). Call before the first `page.goto`. The key is seeded once per tab,
 * so the reload that follows the GitHub sign-in does not bring the failure back.
 */
export async function setGithubSync(page: Page, scenario: GithubSyncScenario): Promise<void> {
  await page.addInitScript(
    ([key, seededKey, value]) => {
      if (sessionStorage.getItem(seededKey) !== null) return;
      sessionStorage.setItem(seededKey, '1');
      sessionStorage.setItem(key, value);
    },
    [GITHUB_SYNC_SCENARIO_KEY, 'agentdesk.e2e.githubSyncSeeded', scenario] as const,
  );
}

/**
 * The default branch needs review for this test: skill saves and deletes answer with a pending change request. Call
 * before the first `page.goto`: browser.ts reads the key once when the mock worker starts.
 */
export async function setSkillReviewRequired(page: Page): Promise<void> {
  await page.addInitScript(
    ([key]) => {
      sessionStorage.setItem(key, '1');
    },
    [SKILL_REVIEW_KEY] as const,
  );
}

/**
 * The agent of the first project created in a test (the setup wizard's step 1). The mock store hands out ids from a
 * counter that restarts on every seed: the project gets the first and its agent, which has no credential, the second
 * (handlers.ts `projects.create`). Use it as the key for `setAgentModels` before the first `page.goto`.
 */
export const FIRST_CREATED_AGENT: string = ids.created(2);

/** The "Other model…" option of a model dropdown, and the built-in names the fallback list shows, in order. */
export const OTHER = 'Other model…';
export const BUILTIN = ['opus', 'sonnet', 'haiku'];
/** The `<option>` elements of a select; `toHaveText([...])` on it checks the options in order. */
export const options = (select: Locator): Locator => select.locator('option');

/**
 * Replaces the invoicer-api lists (and alice's projects) with generated rows for this test, and can hold back or fail
 * list requests (src/mocks/msw/e2eLists.ts). Call before the first `page.goto`: browser.ts reads the key once when the
 * mock worker starts. It lives in sessionStorage, so a reload in the same tab keeps it.
 */
export async function seedLists(page: Page, lists: MockLists): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [MOCK_LISTS_KEY, JSON.stringify(lists)] as const,
  );
}

/**
 * Starts this test in an onboarding scenario (src/mocks/msw/onboardingScenarios.ts): who is signed in, their orgs and
 * role, and the invitations and checklist they see. Call before the first `page.goto`: browser.ts reads the key once
 * when the mock worker starts. It lives in sessionStorage, so a reload in the same tab keeps it.
 */
export async function seedOnboarding(page: Page, name: OnboardingScenario): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [ONBOARDING_SCENARIO_KEY, name] as const,
  );
}

/**
 * Starts this test in a tenant-admin scenario (src/mocks/msw/tenantAdminScenarios.ts): who is signed in, their role in
 * the first org, its members and audit log, and any change, delay or failure the Members and Audit pages meet. Call
 * before the first `page.goto`: browser.ts reads the key once when the mock worker starts. It lives in sessionStorage,
 * so a reload in the same tab keeps it.
 */
export async function seedTenantAdmin(page: Page, scenario: TenantAdminScenario): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [TENANT_ADMIN_SCENARIO_KEY, scenario] as const,
  );
}

/**
 * Picks a platform-admin mock scenario (platformScenarios.ts) before the first `page.goto`: browser.ts reads the key once
 * when the mock worker starts. It lives in sessionStorage, so a reload in the same tab keeps it.
 */
export async function seedPlatform(page: Page, scenario: PlatformScenario): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [PLATFORM_SCENARIO_KEY, scenario] as const,
  );
}

/** A second project the `projectAdmin` role does not administer (the first is INVOICER_API). */
export const OTHER_PROJECT: string = ids.project.invoicerWeb;

/**
 * Starts this test in a project-space scenario (src/mocks/msw/projectSpaceScenarios.ts): who is signed in (`role`:
 * owner, admin, projectAdmin of INVOICER_API, member or viewer), the people with a project role, P's audit log, and any
 * change, delay or failure the Members and Audit log pages meet. Call before the first `page.goto`: browser.ts reads
 * the key once when the mock worker starts. It lives in sessionStorage, so a reload in the same tab keeps it.
 */
export async function seedProjectSpace(
  page: Page,
  opts: { role: ProjectSpaceRole; scenario?: ProjectSpaceScenario },
): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [PROJECT_SPACE_KEY, JSON.stringify(opts)] as const,
  );
}

/**
 * Starts this test in a shell scenario (src/mocks/msw/shellScenarios.ts): who is signed in, their orgs and roles, and
 * the projects, runs and invitations the side-menu shell meets. Call before the first `page.goto`: browser.ts reads the
 * key once when the mock worker starts. It lives in sessionStorage, so a reload in the same tab keeps it.
 */
export async function seedShell(page: Page, scenario: ShellScenario): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [SHELL_KEY, scenario] as const,
  );
}

/**
 * Holds, fails or hides single reads of the app shell for this test (src/mocks/msw/holdScenarios.ts: `hold`, `fail`,
 * `failOnce`, `pending`, `notFound`, `crash`). Call before the first `page.goto`: browser.ts reads the key once when
 * the mock worker starts. It lives in sessionStorage, so a reload in the same tab keeps it.
 */
export async function holdReads(page: Page, config: HoldConfig): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [HOLD_KEY, JSON.stringify(config)] as const,
  );
}

/** Lets a read held with `hold` go on (`ok`, the default) or answer 500 (`fail`), after the page has loaded. */
export async function release(page: Page, read: HeldRead, outcome: 'ok' | 'fail' = 'ok'): Promise<void> {
  await page.evaluate(
    ([r, o]) => {
      window.__mockRelease?.(r, o);
    },
    [read, outcome] as const,
  );
}

/** Changes how a read answers from now on, while the app runs (no mode: the mock API answers). For "access removed" cases. */
export async function setRead(page: Page, read: HeldRead, mode?: ReadMode): Promise<void> {
  await page.evaluate(
    ([r, m]) => {
      window.__mockRead?.(r, m);
    },
    [read, mode] as const,
  );
}

/** The side menu by its landmark name: the organization, project and platform menus and the wizard's stepper. */
export const SIDE_MENU_NAME = /^(Organization menu|Project menu|Platform menu|Setup progress)$/;

/**
 * Opens the side menu and returns it: presses "Open menu" below 1024 px, or "Expand menu" when the menu is collapsed,
 * and gives back the visible side `navigation`.
 */
export async function openSideMenu(page: Page): Promise<Locator> {
  const open = page.getByRole('button', { name: 'Open menu' });
  const expand = page.getByRole('button', { name: 'Expand menu' });
  if (await open.isVisible()) await open.click();
  else if (await expand.isVisible()) await expand.click();
  return page.getByRole('navigation', { name: SIDE_MENU_NAME });
}

/** Opens the "More actions" menu of a platform org header and picks the item (status action or link). */
export async function chooseAction(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name }).click();
}
