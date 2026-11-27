import { setupWorker } from 'msw/browser';
import { z } from 'zod';
import { autoResumeEventFixtures, autoResumeRunFixtures } from '../dto/autoResumeRuns';
import { lifecycleEventFixtures, lifecycleRunFixtures } from '../dto/lifecycleRuns';
import { AGENT_MODELS_SCENARIO_KEY, type AgentModelsScenario } from './agentModels';
import { AGENT_SCENARIO_KEY, parseAgentScenario } from './agentScenarios';
import { usageRunFixtures } from '../dto/usageRuns';
import { sessionEventFixtures, sessionRunFixtures, sessionTranscriptFixtures } from '../dto/sessionRuns';
import { mockDb } from './db';
import { applyMockLists, MOCK_LISTS_KEY, mockListHandlers, parseMockLists } from './e2eLists';
import { handlers } from './handlers';
import { HOLD_KEY, holdHandlers, parseHoldConfig, type HeldRead, type ReadMode } from './holdScenarios';
import { GITHUB_SYNC_SCENARIO_KEY, GithubSyncScenario } from './githubSync';
import { PR_STATES_SCENARIO_KEY } from './prStates';
import { SKILL_REVIEW_KEY } from './skillReview';
import { ONBOARDING_SCENARIO_KEY, parseOnboardingScenario } from './onboardingScenarios';
import { PLATFORM_SCENARIO_KEY, parsePlatformScenario } from './platformScenarios';
import { scenarios, setScenarioTarget } from './scenarios';
import { SHELL_KEY, applyShellScenario, parseShellScenario } from './shellScenarios';
import { PROJECT_SPACE_KEY, applyProjectSpace, parseProjectSpace } from './projectSpaceScenarios';
import { TENANT_ADMIN_SCENARIO_KEY, applyTenantAdminScenario, parseTenantAdminScenario } from './tenantAdminScenarios';
import { DEFAULT_RUN_SCRIPT, streamHandlers } from './stream-handlers';

/** MSW service worker for `dev:mock` and Storybook (the API plus the SSE streams). */
export const worker = setupWorker(...streamHandlers, ...handlers);
setScenarioTarget(worker);

// Sign-in and sign-out reload the page (the social sign-in redirects), so the auth state survives reloads in
// sessionStorage. The rest of the store starts from the seed on every page load. The mocked e2e specs seed this key to
// start signed out (e2e/mock/mock.ts).
const AUTH_KEY = 'agentdesk.mock.auth';
const StoredAuth = z.object({ signedIn: z.boolean(), activeOrganizationId: z.string().nullable() });

function loadAuth(): void {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    if (raw === null) return;
    const parsed = StoredAuth.safeParse(JSON.parse(raw));
    if (parsed.success) mockDb.restoreAuth(parsed.data);
  } catch {
    // Storage blocked or corrupt: keep the seed (signed in as alice).
  }
}

// The mocked e2e specs seed per-agent model-list scenarios here before the first load (e2e/mock/mock.ts). The shape is
// the typed AgentModelsScenario; the keys are agent ids. Anything unparsable is ignored.
const ModelsReason = z.enum(['no_credential', 'unreachable', 'rejected', 'empty', 'disabled']);
const before = { beforeCredentialSave: z.lazy(() => StoredModelsScenario).optional() };
const StoredModelsScenario: z.ZodType<AgentModelsScenario> = z.union([
  z.object({
    kind: z.literal('live'),
    ids: z.array(z.string()),
    idsByBaseUrl: z.record(z.string(), z.array(z.string())).optional(),
    ...before,
  }),
  z.object({ kind: z.literal('fallback'), reason: ModelsReason, providerText: z.string().optional(), ...before }),
  z.object({ kind: z.literal('error'), ...before }),
  z.object({ kind: z.literal('pending'), ...before }),
]);
const StoredModelsScenarios = z.record(z.string(), StoredModelsScenario);

function loadAgentModels(): void {
  try {
    const raw = sessionStorage.getItem(AGENT_MODELS_SCENARIO_KEY);
    if (raw === null) return;
    const parsed = StoredModelsScenarios.safeParse(JSON.parse(raw));
    if (!parsed.success) return;
    for (const [agentId, scenario] of Object.entries(parsed.data)) scenarios.agentModels(agentId, scenario);
  } catch {
    // Storage blocked or corrupt: the default answers apply.
  }
}

// The mocked e2e specs pick an agent scenario here before the first load (e2e/mock/mock.ts `seedAgents`,
// agentScenarios.ts). An unknown name is ignored.
function loadAgents(): void {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(AGENT_SCENARIO_KEY);
  } catch {
    // Storage blocked: the seed stays.
  }
  const name = parseAgentScenario(raw);
  if (name !== undefined) scenarios.agents(name);
}

function loadSkillReview(): void {
  try {
    if (sessionStorage.getItem(SKILL_REVIEW_KEY) === '1') scenarios.skillReviewRequired();
  } catch {
    // Storage blocked: skill changes commit directly.
  }
}

const StoredPrStatesScenario = z.enum(['slow', 'error', 'pending', 'partial']);

function loadPrStates(): void {
  try {
    const raw = sessionStorage.getItem(PR_STATES_SCENARIO_KEY);
    if (raw === null) return;
    const parsed = StoredPrStatesScenario.safeParse(raw);
    if (parsed.success) scenarios.prStates(parsed.data);
  } catch {
    // Storage blocked: the normal answer applies.
  }
}

// The mocked e2e specs seed list sizes and held or failing list requests here before the first load (e2e/mock/mock.ts
// `seedLists`, e2eLists.ts). Anything unparsable is ignored and the seed stays.
function loadLists(): void {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(MOCK_LISTS_KEY);
  } catch {
    // Storage blocked: the seed stays.
  }
  const lists = parseMockLists(raw);
  if (lists === undefined) return;
  // Not inside the try: a seed that cannot be applied (a missing fixture) must fail loudly, not leave the default data.
  applyMockLists(lists);
  worker.use(...mockListHandlers(lists));
}

// The mocked e2e specs pick an onboarding scenario here before the first load (e2e/mock/mock.ts `seedOnboarding`,
// onboardingScenarios.ts). It resets the store, so it runs before everything else that seeds. An unknown name is ignored.
function loadOnboarding(): void {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(ONBOARDING_SCENARIO_KEY);
  } catch {
    // Storage blocked: the seed stays.
  }
  const name = parseOnboardingScenario(raw);
  if (name !== undefined) scenarios.onboarding(name);
}

// The mocked e2e specs pick a tenant-admin scenario here before the first load (e2e/mock/mock.ts `seedTenantAdmin`,
// tenantAdminScenarios.ts). It resets the store like an onboarding scenario does. An unknown name is ignored.
function loadTenantAdmin(): void {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(TENANT_ADMIN_SCENARIO_KEY);
  } catch {
    // Storage blocked: the seed stays.
  }
  const name = parseTenantAdminScenario(raw);
  if (name !== undefined) applyTenantAdminScenario(mockDb, name);
}

// The mocked e2e specs pick a platform scenario here before the first load (e2e/mock/mock.ts `seedPlatform`,
// platformScenarios.ts). It resets the store like an onboarding scenario does. An unknown name is ignored.
function loadPlatform(): void {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PLATFORM_SCENARIO_KEY);
  } catch {
    // Storage blocked: the seed stays.
  }
  const name = parsePlatformScenario(raw);
  if (name !== undefined) scenarios.platform(name);
}

// The mocked e2e specs pick a project-space role and scenario here before the first load (e2e/mock/mock.ts
// `seedProjectSpace`, projectSpaceScenarios.ts). It resets the store like the scenarios above. Unparsable values are ignored.
function loadProjectSpace(): void {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PROJECT_SPACE_KEY);
  } catch {
    // Storage blocked: the seed stays.
  }
  const picked = parseProjectSpace(raw);
  if (picked !== undefined) applyProjectSpace(mockDb, picked);
}

// The mocked e2e specs pick a shell scenario here before the first load (e2e/mock/mock.ts `seedShell`, shellScenarios.ts).
// It resets the store like the scenarios above. An unknown name is ignored.
function loadShell(): void {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(SHELL_KEY);
  } catch {
    // Storage blocked: the seed stays.
  }
  const name = parseShellScenario(raw);
  if (name !== undefined) applyShellScenario(name);
}

declare global {
  interface Window {
    /** Mock mode only: lets a held read go on (`ok`) or fail (e2e/mock/mock.ts `release`). */
    __mockRelease?: (read: HeldRead, outcome?: 'ok' | 'fail') => void;
    /** Mock mode only: changes how a read answers while the app runs; no mode lets it through (e2e/mock/mock.ts `setRead`). */
    __mockRead?: (read: HeldRead, mode?: ReadMode) => void;
  }
}

// The mocked e2e specs hold, fail or hide single reads of the shell (e2e/mock/mock.ts `holdReads`, holdScenarios.ts). The
// handlers are always in place so `window.__mockRead` can change a read while the app runs; with no config they let
// every request through. Anything unparsable is ignored.
function loadHold(): void {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(HOLD_KEY);
  } catch {
    // Storage blocked: nothing is held.
  }
  const hold = holdHandlers(parseHoldConfig(raw) ?? {});
  worker.use(...hold.handlers);
  window.__mockRelease = hold.release;
  window.__mockRead = hold.setRead;
}

function loadGithubSync(): void {
  try {
    const raw = sessionStorage.getItem(GITHUB_SYNC_SCENARIO_KEY);
    if (raw === null) return;
    const parsed = GithubSyncScenario.safeParse(raw);
    if (parsed.success) scenarios.githubSync(parsed.data);
  } catch {
    // Storage blocked: sync answers normally.
  }
}

function saveAuth(): void {
  try {
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(mockDb.auth));
    // The GitHub sign-in reloads the page; once it has cleared the sync failure, the reload must not bring it back.
    if (mockDb.state.githubSyncScenario === undefined) sessionStorage.removeItem(GITHUB_SYNC_SCENARIO_KEY);
  } catch {
    // Storage blocked: auth state just won't survive a reload.
  }
}

let started: Promise<unknown> | undefined;

/** Starts the worker once; later calls reuse the first start. */
export function startMockWorker(opts: { quiet?: boolean } = {}): Promise<unknown> {
  started ??= (async () => {
    loadOnboarding();
    loadTenantAdmin();
    loadPlatform();
    loadProjectSpace();
    loadShell();
    loadAuth();
    loadAgentModels();
    loadAgents();
    loadPrStates();
    loadGithubSync();
    loadSkillReview();
    // Runs in the terminal lifecycle states (pausing, crashed, resume failed, resumed), for the mocked e2e specs.
    mockDb.addRuns(lifecycleRunFixtures, lifecycleEventFixtures);
    // Runs after an unexpected pod end with automatic resume (gave up, waiting between tries, resumed), for the mocked e2e specs.
    mockDb.addRuns(autoResumeRunFixtures, autoResumeEventFixtures);
    // Stopped runs and runs with a saved transcript, for the mocked e2e specs (dto/sessionRuns.ts).
    mockDb.addRuns(sessionRunFixtures, sessionEventFixtures);
    mockDb.addTranscripts(sessionTranscriptFixtures);
    // Runs with recorded token usage and cost, for the mocked e2e specs (dto/usageRuns.ts).
    mockDb.addRuns(usageRunFixtures, {});
    // After the extra fixtures: a seeded run count replaces every invoicer-api run, these included.
    loadLists();
    // Last, so these handlers answer before the ones above.
    loadHold();
    // A clean click-through shows a live run: open run 63 and watch it start (stream-handlers.ts).
    scenarios.runScript(DEFAULT_RUN_SCRIPT.runId, DEFAULT_RUN_SCRIPT.steps, { start: 'onStream' });
    worker.events.on('response:mocked', ({ request }) => {
      if (new URL(request.url).pathname.startsWith('/auth/')) saveAuth();
    });
    return worker.start({ onUnhandledRequest: 'bypass', quiet: opts.quiet ?? false });
  })();
  return started;
}
