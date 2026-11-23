import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type APIResponse, type Browser, type Page } from '@playwright/test';
import { PlatformOrgDto, RunLogResponse, pageOf } from '@agentdesk/contracts';
import {
  API,
  addFakeTicket,
  asPlatformAdmin,
  commentOn,
  commentOnNewTicket,
  inviteAndSignIn,
  ok,
  podLogLines,
  postedComments,
  runOf,
  setAutoResumeMax,
  signInAndCreateProject,
  waitForStatus,
} from './helpers';

/*
 * Local end-to-end for the project environment reaching runs (spec
 * docs/superpowers/specs/2026-11-23-workspace-env-secrets-design.md, "E2E requirements": BR-10 local, BR-18, BR-19,
 * BR-20 local and BR-21), real API, worker and the fake pod. The fake pod logs `agentdesk: env <NAME> <first 12 hex of
 * sha256(value)>` for every `E2E_*` env and prints a raw value only when the prompt has `--fake-echo-env=<NAME>`.
 * Every test signs in as a new owner and starts its own project; names carry a random suffix.
 *
 * Not e2e (spec): the setup-test side of BR-18, and the setup log and transcript of BR-19.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const rand = () => randomBytes(4).toString('hex');
/** The first 12 hex of sha256(value): what the fake pod logs instead of the value. */
const hash12 = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12);
const envLine = (name: string, value: string) => `agentdesk: env ${name} ${hash12(value)}`;
const envLinesOf = (lines: string[], name: string) => lines.filter((l) => l.startsWith(`agentdesk: env ${name} `));

const vars = (page: Page) => page.getByRole('region', { name: 'Environment variables' });
const secrets = (page: Page) => page.getByRole('region', { name: 'Secrets' });

type Kind = 'plain' | 'secret';
const route = (kind: Kind) => (kind === 'plain' ? 'env-vars' : 'env-secrets');

async function addEntry(page: Page, projectId: string, kind: Kind, name: string, value: string): Promise<void> {
  await ok(await page.request.post(`/api/projects/${projectId}/${route(kind)}`, { data: { name, value } }), 201, name);
}

async function openEnv(page: Page, handle: string, projectId: string): Promise<void> {
  await page.goto(`/o/${handle}/p/${projectId}/desk/setup?tab=environment`);
  await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeVisible();
}

/** Steps through the UI: "Edit <name>", the new value, "Save"; waits until the list shows the new value. */
async function editVariableInUi(page: Page, handle: string, projectId: string, name: string, value: string) {
  await openEnv(page, handle, projectId);
  await vars(page)
    .getByRole('button', { name: `Edit ${name}` })
    .click();
  await vars(page).getByRole('textbox', { name: 'Value' }).fill(value);
  await vars(page).getByRole('button', { name: 'Save' }).click();
  await expect(vars(page).getByText(value, { exact: true })).toBeVisible();
}

async function addVariableInUi(page: Page, name: string, value: string): Promise<void> {
  const form = vars(page).getByRole('group', { name: 'Add variable' });
  await vars(page).getByRole('button', { name: 'Add variable' }).click();
  await form.getByRole('textbox', { name: 'Name' }).fill(name);
  await form.getByRole('textbox', { name: 'Value' }).fill(value);
  await form.getByRole('button', { name: 'Add variable' }).click();
  await expect(vars(page).getByText(name, { exact: true })).toBeVisible();
}

async function addSecretInUi(page: Page, name: string, value: string): Promise<void> {
  const form = secrets(page).getByRole('group', { name: 'Add secret' });
  await secrets(page).getByRole('button', { name: 'Add secret' }).click();
  await form.getByRole('textbox', { name: 'Name' }).fill(name);
  await form.getByLabel('Value', { exact: true }).fill(value);
  await form.getByRole('button', { name: 'Add secret' }).click();
  await expect(secrets(page).getByText(name, { exact: true })).toBeVisible();
}

async function expect2xx(res: APIResponse, what: string): Promise<void> {
  expect(res.ok(), `${what}: ${res.status()} ${await res.text()}`).toBe(true);
}

/** Starts a run on a new ticket of the project and waits until it is idle (its pod is live). */
async function startIdleRun(page: Page, handle: string, projectId: string, body = '/code-review'): Promise<string> {
  const runId = await commentOnNewTicket(page, handle, projectId, body);
  await waitForStatus(page, runId, 'idle');
  return runId;
}

/** Reads the pod log through `expect.poll` until it holds `line`. */
async function expectPodLine(runId: string, line: string): Promise<void> {
  await expect.poll(async () => (await podLogLines(runId)).includes(line), { timeout: 60_000 }).toBe(true);
}

/** `POST /api/runs/:id/stop` then waits for the stopped state (paused, reason `stopped`). */
async function stopRun(who: Page, runId: string): Promise<void> {
  await expect2xx(await who.request.post(`/api/runs/${runId}/stop`), 'runs.stop');
  await waitForStatus(who, runId, 'paused', 60_000);
  expect((await runOf(who, runId)).pauseReason).toBe('stopped');
}

/** `POST /api/runs/:id/resume`; the run is active again (not paused) once the new pod is up. */
async function resumeRun(who: Page, runId: string): Promise<void> {
  await expect2xx(await who.request.post(`/api/runs/${runId}/resume`), 'runs.resume');
  await expect
    .poll(async () => (await runOf(who, runId)).status, { timeout: 90_000, intervals: [200, 500, 1000] })
    .not.toBe('paused');
}

async function cancel(page: Page, runId: string) {
  await page.request.post(`/api/runs/${runId}/cancel`).catch(() => null);
}

test.describe('BR-10: a replaced secret reaches the next run', () => {
  test('BR-10: TC-10.4: after "Replace" and "Save" a new run has the hash line of the new secret value, not the old one', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const name = `E2E_SECRET_${rand()}`;
    const oldValue = `old-secret-${rand()}`;
    const newValue = `new-secret-${rand()}`;
    await addEntry(page, projectId, 'secret', name, oldValue);
    await openEnv(page, handle, projectId);
    await secrets(page)
      .getByRole('button', { name: `Replace ${name}` })
      .click();
    await secrets(page).getByLabel('New value', { exact: true }).fill(newValue);
    await secrets(page).getByRole('button', { name: 'Save' }).click();
    await expect(secrets(page).getByLabel('New value', { exact: true })).toHaveCount(0);

    const runId = await startIdleRun(page, handle, projectId);
    try {
      await expectPodLine(runId, envLine(name, newValue));
      expect(await podLogLines(runId)).not.toContain(envLine(name, oldValue));
    } finally {
      await cancel(page, runId);
    }
  });

  test('BR-10: TC-10.5: saving a replace with no new value changes nothing, so a new run has the hash line of the old secret value', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const name = `E2E_SECRET_${rand()}`;
    const oldValue = `old-secret-${rand()}`;
    await addEntry(page, projectId, 'secret', name, oldValue);
    await openEnv(page, handle, projectId);
    await secrets(page)
      .getByRole('button', { name: `Replace ${name}` })
      .click();
    await expect(secrets(page).getByLabel('New value', { exact: true })).toHaveValue('');
    // "Save" cannot be pressed while "New value" is empty (TC-10.3): nothing can be sent.
    await expect(secrets(page).getByRole('button', { name: 'Save' })).toBeDisabled();

    const runId = await startIdleRun(page, handle, projectId);
    try {
      await expectPodLine(runId, envLine(name, oldValue));
    } finally {
      await cancel(page, runId);
    }
  });
});

test.describe('BR-18: a run sees the saved variables and secrets', () => {
  test('BR-18: TC-18.1: a new run logs the hash lines of the saved variable and secret', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const plainName = `E2E_PLAIN_${rand()}`;
    const secretName = `E2E_SECRET_${rand()}`;
    const plain = `plain-${rand()}`;
    const secret = `secret-${rand()}`;
    await openEnv(page, handle, projectId);
    await addVariableInUi(page, plainName, plain);
    await addSecretInUi(page, secretName, secret);

    const runId = await startIdleRun(page, handle, projectId);
    try {
      await expectPodLine(runId, `agentdesk: env ${plainName} ${hash12(plain)}`);
      await expectPodLine(runId, `agentdesk: env ${secretName} ${hash12(secret)}`);
    } finally {
      await cancel(page, runId);
    }
  });

  test('BR-18: TC-18.2: a variable saved with an empty value is logged with the hash of the empty string', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const name = `E2E_EMPTY_${rand()}`;
    await addEntry(page, projectId, 'plain', name, '');

    const runId = await startIdleRun(page, handle, projectId);
    try {
      await expectPodLine(runId, `agentdesk: env ${name} ${hash12('')}`);
    } finally {
      await cancel(page, runId);
    }
  });

  test('BR-18: TC-18.3: a variable that was saved and then removed has no hash line in a new run', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    const keepName = `E2E_KEEP_${rand()}`;
    const keep = `keep-${rand()}`;
    await addEntry(page, projectId, 'plain', name, `plain-${rand()}`);
    await addEntry(page, projectId, 'plain', keepName, keep);
    await ok(await page.request.delete(`/api/projects/${projectId}/env-vars/${name}`), 204, 'remove variable');

    const runId = await startIdleRun(page, handle, projectId);
    try {
      // The control variable proves the env lines were already written when the log is read.
      await expectPodLine(runId, envLine(keepName, keep));
      expect(envLinesOf(await podLogLines(runId), name)).toEqual([]);
    } finally {
      await cancel(page, runId);
    }
  });
});

test.describe('BR-19: printed secrets are stored as ***', () => {
  const logText = async (page: Page, runId: string): Promise<string> =>
    JSON.stringify(RunLogResponse.parse(await ok(await page.request.get(`/api/runs/${runId}/log`), 200, 'run log')));

  test('BR-19: TC-19.1: a printed secret value shows as *** in the run log, and no posted comment contains the value', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const name = `E2E_SECRET_${rand()}`;
    const secret = `secret-${rand()}`;
    await addEntry(page, projectId, 'secret', name, secret);
    const ticketNumber = await addFakeTicket(page, 'pr');
    const comment = await commentOn(page, projectId, ticketNumber, `/code-review --fake-echo-env=${name}`, handle);
    const runId = comment.runId ?? '';
    expect(runId, `comment outcome ${comment.outcome}`).toBeTruthy();
    try {
      await waitForStatus(page, runId, 'idle');
      await expect2xx(await page.request.post(`/api/runs/${runId}/finish`), 'runs.finish');
      await waitForStatus(page, runId, 'succeeded');

      const text = await logText(page, runId);
      expect(text).not.toContain(secret);
      // The fake pod echoes the value as a line of its own; in the stored scrollback that line reads exactly ***.
      const { items } = RunLogResponse.parse(
        await ok(await page.request.get(`/api/runs/${runId}/log`), 200, 'run log'),
      );
      const echoed = items
        .filter((e) => e.type === 'scrollback')
        .flatMap((e) => (typeof e.payload.text === 'string' ? e.payload.text.split(/\r?\n/u) : []));
      expect(echoed, 'the printed value is stored as a line of ***').toContain('***');

      const comments = (await postedComments(page)).filter((c) => c.ticketNumber === ticketNumber);
      // Not vacuous: at least the started and finished comments were posted.
      expect(comments.length, 'the app posted the started and finished comments').toBeGreaterThanOrEqual(2);
      for (const c of comments) expect(c.body).not.toContain(secret);
    } finally {
      await cancel(page, runId);
    }
  });

  test('BR-19: TC-19.2: a printed plain value shows as it is in the run log', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    const plain = `plain-${rand()}`;
    await addEntry(page, projectId, 'plain', name, plain);
    const runId = await commentOnNewTicket(page, handle, projectId, `/code-review --fake-echo-env=${name}`);
    try {
      // The raw pod output reaches the stored log as scrollback when the session ends.
      await waitForStatus(page, runId, 'idle');
      await expect2xx(await page.request.post(`/api/runs/${runId}/finish`), 'runs.finish');
      await waitForStatus(page, runId, 'succeeded');
      await expect.poll(async () => logText(page, runId), { timeout: 30_000 }).toContain(plain);
    } finally {
      await cancel(page, runId);
    }
  });
});

test.describe('BR-20: running runs keep their values', () => {
  test('BR-20: TC-20.3: after the value is edited in the UI, run A keeps the hash line of the old value only', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    const v1 = `v1-${rand()}`;
    const v2 = `v2-${rand()}`;
    await addEntry(page, projectId, 'plain', name, v1);
    const runA = await startIdleRun(page, handle, projectId);
    try {
      await expectPodLine(runA, envLine(name, v1));
      await editVariableInUi(page, handle, projectId, name, v2);
      const lines = await podLogLines(runA);
      expect(envLinesOf(lines, name)).toEqual([envLine(name, v1)]);
      expect(lines).not.toContain(envLine(name, v2));
    } finally {
      await cancel(page, runA);
    }
  });

  test('BR-20: TC-20.4: after the edit, a new run B has the hash line of the new value', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    const v1 = `v1-${rand()}`;
    const v2 = `v2-${rand()}`;
    await addEntry(page, projectId, 'plain', name, v1);
    const runA = await startIdleRun(page, handle, projectId);
    let runB = '';
    try {
      await editVariableInUi(page, handle, projectId, name, v2);
      runB = await startIdleRun(page, handle, projectId);
      await expectPodLine(runB, envLine(name, v2));
    } finally {
      await cancel(page, runA);
      if (runB !== '') await cancel(page, runB);
    }
  });

  test('BR-20: TC-20.5: run A stopped and resumed after the edit gets the hash line of the new value', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    const v1 = `v1-${rand()}`;
    const v2 = `v2-${rand()}`;
    await addEntry(page, projectId, 'plain', name, v1);
    const runA = await startIdleRun(page, handle, projectId);
    try {
      await expectPodLine(runA, envLine(name, v1));
      await editVariableInUi(page, handle, projectId, name, v2);
      await stopRun(page, runA);
      await resumeRun(page, runA);
      await expectPodLine(runA, envLine(name, v2));
    } finally {
      await cancel(page, runA);
    }
  });
});

/** The id of the org whose slug is `slug` (the platform admin lists orgs; a new owner's org slug is its handle). */
async function orgIdOfSlug(pa: APIRequestContext, slug: string): Promise<string> {
  for (let p = 1; p <= 50; p++) {
    const body = pageOf(PlatformOrgDto).parse(
      await ok(await pa.get(`/api/platform/orgs?pageSize=100&page=${p}`), 200, 'platform orgs'),
    );
    const org = body.items.find((o) => o.slug === slug);
    if (org) return org.id;
    if (body.items.length === 0 || p * 100 >= body.total) break;
  }
  throw new Error(`no org with slug ${slug}`);
}

/** Runs `body` with an admin of the owner's org signed in in its own context. */
async function withAdmin(
  browser: Browser,
  orgHandle: string,
  body: (admin: Page, adminHandle: string) => Promise<void>,
): Promise<void> {
  const pa = await asPlatformAdmin();
  const ctx = await browser.newContext();
  try {
    const orgId = await orgIdOfSlug(pa, orgHandle);
    const adminPage = await ctx.newPage();
    const adminHandle = `e2e-adm-${rand()}`;
    await inviteAndSignIn(adminPage, pa, orgId, adminHandle, 'admin', { type: 'org' });
    await body(adminPage, adminHandle);
  } finally {
    await ctx.close().catch(() => null);
    await pa.dispose();
  }
}

test.describe('BR-21: a resume gets the current values', () => {
  test('BR-21: TC-21.1: a paused --fake-fail run resumed by hand after the edit has the hash line of the new value', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await setAutoResumeMax(page, projectId, 0);
    const name = `E2E_PLAIN_${rand()}`;
    const v1 = `v1-${rand()}`;
    const v2 = `v2-${rand()}`;
    await addEntry(page, projectId, 'plain', name, v1);
    const runId = await commentOnNewTicket(page, handle, projectId, '/code-review --fake-fail');
    try {
      await waitForStatus(page, runId, 'paused', 90_000);
      expect((await runOf(page, runId)).pauseReason).toBe('agent_crashed');
      await editVariableInUi(page, handle, projectId, name, v2);
      await resumeRun(page, runId);
      await expectPodLine(runId, envLine(name, v2));
    } finally {
      await cancel(page, runId);
    }
  });

  test('BR-21: TC-21.2: a run started by an admin, stopped, edited and resumed by the admin has the hash line of the new value', async ({
    page,
    browser,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    const v1 = `v1-${rand()}`;
    const v2 = `v2-${rand()}`;
    await addEntry(page, projectId, 'plain', name, v1);
    await withAdmin(browser, handle, async (admin, adminHandle) => {
      const runId = await commentOnNewTicket(page, handle, projectId, '/code-review', adminHandle);
      try {
        await waitForStatus(admin, runId, 'idle');
        await expectPodLine(runId, envLine(name, v1));
        await stopRun(admin, runId);
        await ok(
          await admin.request.put(`/api/projects/${projectId}/env-vars/${name}`, { data: { value: v2 } }),
          200,
          'admin changes the variable',
        );
        await resumeRun(admin, runId);
        await expectPodLine(runId, envLine(name, v2));
      } finally {
        await cancel(admin, runId);
      }
    });
  });

  test('BR-21: TC-21.3: a stopped run resumed with no value change has the same hash line as before', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    const v1 = `v1-${rand()}`;
    await addEntry(page, projectId, 'plain', name, v1);
    const runId = await startIdleRun(page, handle, projectId);
    try {
      await expectPodLine(runId, envLine(name, v1));
      const before = envLinesOf(await podLogLines(runId), name);
      expect(before).toEqual([envLine(name, v1)]);
      await stopRun(page, runId);
      await resumeRun(page, runId);
      // Only the resumed pod logs `session resumed`, right after its own env lines (and after its launch line). Read
      // the block between that pod's launch line and the marker, so the first pod's lines cannot satisfy this.
      const resumedBlock = async (): Promise<string[] | null> => {
        const lines = await podLogLines(runId);
        const marker = lines.lastIndexOf('agentdesk: session resumed');
        if (marker < 0) return null;
        const head = lines.slice(0, marker);
        const launch = head.map((l) => l.startsWith('agentdesk: agent claude model ')).lastIndexOf(true);
        return head.slice(Math.max(launch, 0));
      };
      await expect.poll(async () => (await resumedBlock()) !== null, { timeout: 60_000 }).toBe(true);
      expect(envLinesOf((await resumedBlock()) ?? [], name)).toEqual(before);
    } finally {
      await cancel(page, runId);
    }
  });
});
