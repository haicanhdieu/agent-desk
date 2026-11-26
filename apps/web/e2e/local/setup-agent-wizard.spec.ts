import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { AgentDto, OrgChecklistDto, RuleDto, pageOf, type AgentKind } from '@agentdesk/contracts';
import {
  API,
  asPlatformAdmin,
  FAKE_STATE_DIR,
  cancelRun,
  commentOnNewTicket,
  continueAgentStep,
  fakeAuthJson,
  grant,
  inviteAndSignIn,
  ok,
  openAgent,
  openAgentStepOfNewProject,
  platformOrgIdBySlug,
  podLogLines,
  readAgent,
  signInAndStartProject,
  walkSetupSteps,
} from './helpers';
import { installFake } from './rbac-cast';
import { withScope } from './onboarding-scope';

/*
 * Local end-to-end for the wizard's Agent step on the real stack (spec 2026-11-24-multi-agent-configs-design.md, BR-50
 * swap part, BR-53, BR-63, BR-64, BR-65). Every case signs in as a new owner of its own e2e-<rand> org and creates its own
 * project, so the cases leave nothing shared behind. The stack runs with AGENT_MODELS_SOURCE=builtin. The offline stack
 * cannot make a credential test come out "Ready", so the step ends through "Continue anyway" when the test is rejected or
 * unreachable (`continueAgentStep`). A credential typed here is never printed. A partly failed swap cannot be forced on
 * the real stack; it is proved by the API integration and the mock cases. TC-64.2 and TC-64.3 already run in
 * checklist.spec.ts (the same Given, Steps and Expected), so they are not repeated here.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const agentHeading = (page: Page) => page.getByRole('heading', { name: 'Add your agent', level: 1 });
const pick = (page: Page, label: string) => page.getByRole('radio', { name: label, exact: true }).check();
const PROVIDER_LABELS = ['Claude Code', 'OpenAI Codex', 'OpenCode'] as const;

/** The secret files the fake store holds for one agent (names end with `-agent-<id>.json`). */
async function secretFiles(agentId: string): Promise<string[]> {
  const names = await readdir(`${FAKE_STATE_DIR}/secrets`).catch(() => [] as string[]);
  return names.filter((n) => n.endsWith(`-agent-${agentId}.json`));
}

/** The first line of the pod's log, once the pod has written it. */
async function firstLine(runId: string): Promise<string> {
  let line = '';
  await expect
    .poll(
      async () => {
        line = (await podLogLines(runId))[0] ?? '';
        return line;
      },
      { timeout: 90_000, message: `the first log line of the pod of run ${runId}` },
    )
    .toMatch(/^agentdesk: agent /);
  return line;
}

async function listAgents(page: Page, projectId: string): Promise<AgentDto[]> {
  return pageOf(AgentDto).parse(
    await ok(await page.request.get(`/api/projects/${projectId}/agents?pageSize=100`), 200, 'agents'),
  ).items;
}

// ---- BR-53: the step offers the same picker to an owner and an org admin ----

async function expectPickerUntouched(page: Page): Promise<void> {
  await expect(agentHeading(page)).toBeVisible();
  for (const label of PROVIDER_LABELS) {
    const radio = page.getByRole('radio', { name: label, exact: true });
    await expect(radio).toBeEnabled();
    await expect(radio).not.toBeChecked();
  }
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
}

test.describe('BR-53: the Agent step on the real stack', () => {
  test('TC-53.4: an owner opens step 2 of a new project with nothing preselected and three choosable providers', async ({
    page,
  }) => {
    await signInAndStartProject(page);
    await expectPickerUntouched(page);
  });

  test('TC-53.5: an org admin opens step 2 and sees the same picker', async ({ browser }) => {
    await withScope(async (scope) => {
      const org = await scope.org('o');
      const owner = await scope.person(browser);
      const ownerPage = await owner.newPage();
      await inviteAndSignIn(ownerPage, scope.pa, org.id, scope.handle('owner'), 'owner', { type: 'org' });
      const connectionId = await installFake({ api: owner.request });
      // The admin joins as a viewer, then is granted the org admin role over the whole org.
      const adminContext = await scope.person(browser);
      const page = await adminContext.newPage();
      const { userId } = await inviteAndSignIn(page, scope.pa, org.id, scope.handle('admin'), 'viewer', {
        type: 'org',
      });
      await grant(scope.pa, org.id, userId, 'admin', { type: 'org' });
      await openAgentStepOfNewProject(page, org.slug, connectionId);
      await expectPickerUntouched(page);
    });
  });
});

// ---- BR-63 and BR-64: the picked provider replaces the placeholder, the walk reaches the last step, a run starts on it ----

interface WizardCase {
  title: string;
  kind: AgentKind;
  radio: string;
  fill: (page: Page) => Promise<void>;
  /** The agent has a credential (so one secret file for it, else none). */
  credential: boolean;
}

const CASES: WizardCase[] = [
  {
    title: 'Claude Code with a token',
    kind: 'claude',
    radio: 'Claude Code',
    credential: true,
    fill: async (page) => {
      await page.getByRole('textbox', { name: 'Token' }).fill(`sk-ant-e2e-${randomBytes(8).toString('hex')}`);
    },
  },
  {
    title: 'Codex with a sign-in file',
    kind: 'codex',
    radio: 'OpenAI Codex',
    credential: true,
    fill: async (page) => {
      await page.getByRole('textbox', { name: 'auth.json contents' }).fill(fakeAuthJson());
    },
  },
  {
    title: 'OpenCode with no credential',
    kind: 'opencode',
    radio: 'OpenCode',
    credential: false,
    fill: async () => undefined,
  },
  {
    title: 'OpenCode with a credentials file',
    kind: 'opencode',
    radio: 'OpenCode',
    credential: true,
    fill: async (page) => {
      await pick(page, 'Credentials file');
      await page
        .getByRole('textbox', { name: 'Credentials file' })
        .fill(JSON.stringify({ anthropic: { type: 'api', key: `e2e-${randomBytes(8).toString('hex')}` } }));
    },
  },
  {
    title: 'OpenCode with its own endpoint, a key and a typed model',
    kind: 'opencode',
    radio: 'OpenCode',
    credential: true,
    fill: async (page) => {
      await pick(page, 'API endpoint and key');
      await page.getByRole('textbox', { name: 'API endpoint' }).fill('https://llm.example.com');
      await page.getByRole('textbox', { name: 'API key' }).fill(`e2e-key-${randomBytes(8).toString('hex')}`);
      await page.getByLabel('Model name').fill('qwen3-coder');
    },
  },
];

test.describe('BR-63, BR-64: the wizard swap on the real stack', () => {
  for (const c of CASES) {
    test(`TC-63.4: ${c.title}: one Default agent of that provider, no Claude, the rule follows it and the run names the provider`, async ({
      page,
    }) => {
      const { handle, projectId } = await signInAndStartProject(page);
      const placeholder = await readAgent(page, projectId);
      await pick(page, c.radio);
      await c.fill(page);
      await continueAgentStep(page);

      // Step 4: the rule says "Project default (<name>)".
      const agent = await readAgent(page, projectId);
      expect(agent.provider).toBe(c.kind);
      await walkSetupSteps(page, async (p) => {
        await expect(p.getByLabel('With agent').locator('option:checked')).toHaveText(
          `Project default (${agent.name})`,
        );
      });

      // The project's agents: exactly one, of that provider, Default, no Claude.
      const agents = await listAgents(page, projectId);
      expect(agents).toHaveLength(1);
      expect(agents[0]?.provider).toBe(c.kind);
      expect(agents[0]?.isDefault).toBe(true);
      expect(agents[0]?.id).toBe(agent.id);
      if (c.kind === 'claude') {
        // The Claude Code wizard configures the existing placeholder in place.
        expect(agent.id).toBe(placeholder.id);
        expect(agent.name).toBe('Claude');
      } else {
        expect(
          agents.some((a) => a.id === placeholder.id),
          'the placeholder is gone',
        ).toBe(false);
      }
      await openAgent(page, handle, projectId);
      const rows = page.getByRole('region', { name: 'Agents list' }).getByRole('listitem');
      await expect(rows).toHaveCount(1);
      await expect(rows.first().getByText('Default', { exact: true })).toBeVisible();
      await expect(rows.first().getByText(agent.name, { exact: true }).first()).toBeVisible();
      if (c.kind !== 'claude')
        await expect(page.getByRole('region', { name: 'Agents list' }).getByText('Claude')).toHaveCount(0);

      // The fake secret store holds one file for this agent (none without a credential) and none for the placeholder.
      expect(await secretFiles(agent.id)).toHaveLength(c.credential ? 1 : 0);
      if (c.kind !== 'claude') expect(await secretFiles(placeholder.id)).toEqual([]);

      // The step 4 rule keeps `agentId: null` (the project default).
      const rules = pageOf(RuleDto).parse(
        await ok(await page.request.get(`/api/projects/${projectId}/rules?pageSize=100`), 200, 'rules'),
      ).items;
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) expect(rule.agentId).toBeNull();

      // BR-64: the checklist counts the agent as added.
      const pa = await asPlatformAdmin();
      const orgId = await platformOrgIdBySlug(pa, handle).finally(() => pa.dispose());
      const list = OrgChecklistDto.parse(
        await ok(await page.request.get(`/api/orgs/${orgId}/checklist`), 200, 'checklist'),
      );
      expect(list.steps.find((s) => s.key === 'add_agent')?.done).toBe(true);

      // A comment starts a run whose first pod line names the provider.
      const runId = await commentOnNewTicket(page, handle, projectId, '/code-review');
      try {
        expect(await firstLine(runId)).toMatch(new RegExp(`^agentdesk: agent ${c.kind} model \\S+ endpoint \\S+$`));
      } finally {
        await cancelRun(page, runId).catch(() => undefined);
      }
    });
  }
});

// ---- BR-65 and BR-50: leave after step 2 and resume; the compat route answers the new agent ----

test.describe('BR-65, BR-50: a Codex project left after the Agent step', () => {
  test('TC-65.2: resuming the step shows the saved provider read-only, the credential set, and the project still has one agent', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    await pick(page, 'OpenAI Codex');
    await page.getByRole('textbox', { name: 'auth.json contents' }).fill(fakeAuthJson());
    await continueAgentStep(page);
    const saved = await readAgent(page, projectId);

    // Leave: the projects list, then resume the project's setup step.
    await page.goto(`/o/${handle}/projects`);
    await expect(page.getByRole('heading', { level: 1, name: /^(Projects|Create your first project)$/ })).toBeVisible();
    await page.goto(`/o/${handle}/projects/new/agent?project=${projectId}`);
    await expect(agentHeading(page)).toBeVisible();
    await expect(page.getByRole('radio', { name: 'OpenAI Codex', exact: true })).toBeChecked();
    for (const label of PROVIDER_LABELS)
      await expect(page.getByRole('radio', { name: label, exact: true })).toBeDisabled();
    await expect(page.getByText('Agent name:')).toContainText(saved.name);
    await expect(page.getByText(/^Set .* by .*Hidden for good after saving\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replace' })).toBeVisible();

    // Agent & settings: still one agent.
    expect(await listAgents(page, projectId)).toHaveLength(1);
    await openAgent(page, handle, projectId);
    await expect(page.getByRole('region', { name: 'Agents list' }).getByRole('listitem')).toHaveCount(1);
  });

  test('TC-50.4: after a Codex swap the project agent route answers the Codex agent and the placeholder id is gone', async ({
    page,
  }) => {
    const { projectId } = await signInAndStartProject(page);
    const placeholder = await readAgent(page, projectId);
    await pick(page, 'OpenAI Codex');
    await page.getByRole('textbox', { name: 'auth.json contents' }).fill(fakeAuthJson());
    await continueAgentStep(page);

    const compat = await readAgent(page, projectId);
    expect(compat.provider).toBe('codex');
    expect(compat.id).not.toBe(placeholder.id);
    expect((await page.request.get(`/api/agents/${placeholder.id}`)).status()).toBe(404);
    // `GET agents/:id` has no route of its own; the id is also gone from the list and refused by the id routes.
    expect((await listAgents(page, projectId)).map((a) => a.id)).not.toContain(placeholder.id);
    expect((await page.request.delete(`/api/agents/${placeholder.id}`)).status()).toBe(404);
  });
});
