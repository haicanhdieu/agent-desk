import { randomBytes } from 'node:crypto';
import { expect, test, type Page, type Response } from '@playwright/test';
import { ProjectDto } from '@agentdesk/contracts';
import { API, deskAgentUrl, ok, openAgent, readAgent } from './helpers';
import { buildCast, disposeCast, type Cast } from './rbac-cast';

/*
 * Local end-to-end for the project admin's Desk (spec "E2E requirements": BR-21, BR-22). A is the admin of P1 only
 * (`buildCast`); every case runs in a fresh org. A signs in through their own browser context, makes each change
 * through the Desk screens, and the case reloads the page to see it persisted. What a case adds to the shared fake
 * board (a skill) or switches (P1's trigger mode) the owner restores in a `finally`.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

let cast: Cast;
/** The cast to dispose: unset until a build succeeded, and again after its disposal, so a failed build never disposes a stale one. */
let built: Cast | undefined;

test.beforeEach(async ({ browser }) => {
  built = undefined;
  built = await buildCast(browser);
  cast = built;
});

test.afterEach(async () => {
  const done = built;
  built = undefined;
  if (done) await disposeCast(done);
});

/** Cleanup that never masks the failure of the test it runs after. */
async function quietly(action: () => Promise<unknown>): Promise<void> {
  await action().catch(() => null);
}

const desk = (page: string): string => `/o/${cast.slug}/p/${cast.p1}/desk/${page}`;

/** Starts waiting for the answer to the next request with `method` whose path matches `path`. */
function answerTo(page: Page, method: string, path: RegExp): Promise<Response> {
  return page.waitForResponse((r) => r.request().method() === method && path.test(new URL(r.url()).pathname));
}

const projectPath = /^\/api\/projects\/[^/]+$/;

test('TC-21.4 A opens P1 Agent & settings and finds no Delete project control', async () => {
  const { a, slug, p1 } = cast;
  await openAgent(a.page, slug, p1);
  // The page is loaded: its sections are there, so an absent control is not an unrendered page.
  await expect(a.page.getByRole('button', { name: 'Save agent' })).toBeVisible();
  await expect(a.page.getByRole('button', { name: 'Save limits' })).toBeVisible();
  await expect(a.page.getByRole('button', { name: 'Delete project' })).toHaveCount(0);
  await expect(a.page.getByText('Delete project')).toHaveCount(0);
});

test('TC-22.1 A edits a routing rule on P1, saves it, and the change shows after a reload', async () => {
  const { a } = cast;
  const prompt = `Answer in ${randomBytes(3).toString('hex')} words.`;
  const row = (): ReturnType<Page['getByRole']> => a.page.getByRole('button', { name: 'Edit rule /rbac-run' });
  const promptBox = (): ReturnType<Page['getByRole']> => a.page.getByRole('textbox', { name: 'Prompt', exact: true });

  await a.page.goto(desk('rules'));
  await expect(a.page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();
  await row().click();
  await expect(a.page.getByRole('heading', { name: 'Edit rule' })).toBeVisible();
  await expect(promptBox()).toBeVisible();
  await expect(promptBox()).not.toHaveValue(prompt);
  await promptBox().fill(prompt);
  const saved = answerTo(a.page, 'PATCH', /^\/api\/rules\/[^/]+$/);
  await a.page.getByRole('button', { name: 'Save rule' }).click();
  expect((await saved).status(), 'the rule save is accepted').toBe(200);
  await expect(a.page.getByRole('heading', { name: 'Edit rule' })).toHaveCount(0);

  await a.page.goto(desk('rules'));
  await expect(a.page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();
  await row().click();
  await expect(a.page.getByRole('heading', { name: 'Edit rule' })).toBeVisible();
  await expect(promptBox()).toHaveValue(prompt);
});

test('TC-22.2 A changes a skill on P1, commits it, and the change shows after a reload', async () => {
  const { a, o, p1 } = cast;
  const skill = `rbac-d-${randomBytes(3).toString('hex')}`;
  const original = `---\nname: ${skill}\ndescription: Project admin Desk check.\n---\n\n# ${skill}\n`;
  const changed = `${original}\nChanged by the project admin.\n`;
  const editor = (): ReturnType<Page['getByRole']> => a.page.getByRole('textbox', { name: 'SKILL.md source' });
  try {
    // Given: a skill on the shared fake board, put by the owner.
    await ok(
      await o.api.put(`/api/projects/${p1}/skills/${skill}`, { data: { body: original, message: `add ${skill}` } }),
      200,
      'skills.put as owner',
    );
    await a.page.goto(`${desk('skills')}?skill=${skill}`);
    await expect(a.page.getByRole('heading', { name: skill, level: 2 })).toBeVisible();
    await expect(editor()).toHaveValue(original);
    await editor().fill(changed);
    const saved = answerTo(a.page, 'PUT', /^\/api\/projects\/[^/]+\/skills\/[^/]+$/);
    await a.page.getByRole('button', { name: 'Commit to main' }).click();
    expect((await saved).status(), 'the skill commit is accepted').toBe(200);

    await a.page.goto(`${desk('skills')}?skill=${skill}`);
    await expect(a.page.getByRole('heading', { name: skill, level: 2 })).toBeVisible();
    await expect(editor()).toHaveValue(changed);
  } finally {
    await quietly(() => o.api.delete(`/api/projects/${p1}/skills/${skill}?message=cleanup`));
  }
});

test('TC-22.3 A changes the Workspace setup of P1, saves it, and the change shows after a reload', async () => {
  const { a } = cast;
  const script = `#!/usr/bin/env bash\necho project-admin-${randomBytes(3).toString('hex')}`;
  const editor = (): ReturnType<Page['getByRole']> => a.page.getByRole('textbox', { name: 'Setup script' });

  await a.page.goto(desk('setup'));
  await expect(editor()).toBeVisible();
  await expect(editor()).not.toHaveValue(script);
  await editor().fill(script);
  const saved = answerTo(a.page, 'PUT', /^\/api\/projects\/[^/]+\/setup-script$/);
  await a.page.getByRole('button', { name: /^Save version \d+$/ }).click();
  expect((await saved).status(), 'the setup script save is accepted').toBe(200);

  await a.page.goto(desk('setup'));
  await expect(editor()).toBeVisible();
  await expect(editor()).toHaveValue(script);
});

test('TC-22.4 A changes the trigger mode of P1 to Polling, and Polling shows after a reload', async () => {
  const { a, o, p1, slug } = cast;
  const mode = (): ReturnType<Page['getByRole']> =>
    a.page.getByRole('radiogroup', { name: 'Trigger mode' }).getByRole('radio', { name: 'Polling' });
  try {
    await openAgent(a.page, slug, p1);
    await expect(mode()).toHaveAttribute('aria-checked', 'false');
    const saved = answerTo(a.page, 'PATCH', projectPath);
    await mode().click();
    expect((await saved).status(), 'the trigger mode save is accepted').toBe(200);

    await openAgent(a.page, slug, p1);
    await expect(mode()).toHaveAttribute('aria-checked', 'true');
  } finally {
    await quietly(() => o.api.patch(`/api/projects/${p1}`, { data: { triggerMode: 'webhook' } }));
  }
});

test('TC-22.5 A changes the concurrency of P1, saves it, and the new value shows after a reload', async () => {
  const { a, slug, p1 } = cast;
  const field = (): ReturnType<Page['getByLabel']> => a.page.getByLabel('Concurrent runs', { exact: true });
  await openAgent(a.page, slug, p1);
  await expect(field()).toHaveValue('3');
  await field().fill('5');
  const saved = answerTo(a.page, 'PATCH', projectPath);
  await a.page.getByRole('button', { name: 'Save limits' }).click();
  expect((await saved).status(), 'the limits save is accepted').toBe(200);
  await expect(a.page.getByText('Limits saved')).toBeVisible();

  await openAgent(a.page, slug, p1);
  await expect(field()).toHaveValue('5');
});

test('TC-22.6 A changes the per-ticket limit of P1, saves it, and the new value shows after a reload', async () => {
  const { a, slug, p1 } = cast;
  const field = (): ReturnType<Page['getByLabel']> => a.page.getByLabel('Runs per ticket', { exact: true });
  const before = ProjectDto.parse(await ok(await a.api.get(`/api/projects/${p1}`), 200, 'project')).maxRunsPerTicket;
  const next = String(before === 7 ? 8 : 7);
  await openAgent(a.page, slug, p1);
  await expect(field()).toHaveValue(String(before));
  await field().fill(next);
  const saved = answerTo(a.page, 'PATCH', projectPath);
  await a.page.getByRole('button', { name: 'Save limits' }).click();
  expect((await saved).status(), 'the limits save is accepted').toBe(200);
  await expect(a.page.getByText('Limits saved')).toBeVisible();

  await openAgent(a.page, slug, p1);
  await expect(field()).toHaveValue(next);
});

test('TC-22.7 A changes the agent of P1, saves it, and the change shows after a reload', async () => {
  const { a, slug, p1 } = cast;
  const models = ['opus', 'sonnet', 'haiku'];
  const before = (await readAgent(a.page, p1)).model;
  const next = models.find((m) => m !== before) ?? 'haiku';
  await openAgent(a.page, slug, p1);
  await expect(a.page.getByRole('combobox', { name: 'Default model' })).toHaveValue(before);
  await a.page.getByRole('combobox', { name: 'Default model' }).selectOption({ label: next });
  const saved = answerTo(a.page, 'PUT', /^\/api\/projects\/[^/]+\/agent$/);
  await a.page.getByRole('button', { name: 'Save agent' }).click();
  expect((await saved).status(), 'the agent save is accepted').toBe(200);

  await a.page.goto(deskAgentUrl(slug, p1));
  await expect(a.page.getByRole('combobox', { name: 'Default model' })).toHaveValue(next);
});
