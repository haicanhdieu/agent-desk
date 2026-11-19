import { setupWorker } from 'msw/browser';
import { z } from 'zod';
import { lifecycleEventFixtures, lifecycleRunFixtures } from '../dto/lifecycleRuns';
import { AGENT_MODELS_SCENARIO_KEY, type AgentModelsScenario } from './agentModels';
import { mockDb } from './db';
import { handlers } from './handlers';
import { scenarios, setScenarioTarget } from './scenarios';
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

function saveAuth(): void {
  try {
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(mockDb.auth));
  } catch {
    // Storage blocked: auth state just won't survive a reload.
  }
}

let started: Promise<unknown> | undefined;

/** Starts the worker once; later calls reuse the first start. */
export function startMockWorker(opts: { quiet?: boolean } = {}): Promise<unknown> {
  started ??= (async () => {
    loadAuth();
    loadAgentModels();
    // Runs in the terminal lifecycle states (pausing, crashed, resume failed, resumed), for the mocked e2e specs.
    mockDb.addRuns(lifecycleRunFixtures, lifecycleEventFixtures);
    // A clean click-through shows a live run: open run 63 and watch it start (stream-handlers.ts).
    scenarios.runScript(DEFAULT_RUN_SCRIPT.runId, DEFAULT_RUN_SCRIPT.steps, { start: 'onStream' });
    worker.events.on('response:mocked', ({ request }) => {
      if (new URL(request.url).pathname.startsWith('/auth/')) saveAuth();
    });
    return worker.start({ onUnhandledRequest: 'bypass', quiet: opts.quiet ?? false });
  })();
  return started;
}
