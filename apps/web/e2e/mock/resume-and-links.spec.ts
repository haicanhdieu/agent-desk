import { expect, test, type Page } from '@playwright/test';
import { INVOICER_API, ORG, seedShell } from './mock';

/*
 * Wizard rule links, the Ignored filter and "Resume setup" of the sidebar navigation shell (spec
 * 2026-11-25-sidebar-navigation-shell-design.md "E2E requirements": TC-72.1, TC-72.2, TC-73.1, TC-73.2, TC-77.1 to
 * TC-77.4, TC-78.1 to TC-78.4). TC-72.3 (a creator who may not read agent settings sees no "Change") is not here: the
 * rules step cannot load for that person (its agent read answers 403), so the case's Given cannot be built.
 *
 * Every test seeds its scenario before the first goto (the mock store reseeds on each page load).
 */
test.describe.configure({ timeout: 60_000 });

const P2 = 'a0000000-0000-4000-8000-000000000002';
const main = (page: Page) => page.getByRole('main');
const ignoredChip = (page: Page) => main(page).getByRole('link', { name: /^Ignored/ });
const resume = (page: Page, project: string) => page.getByRole('link', { name: `Resume setup for ${project}` });
const anyResume = (page: Page) => page.getByRole('link', { name: /^Resume setup for / });
/** The top bar's Projects section link: leaves the wizard inside the app, with no reload. */
const topProjects = (page: Page) =>
  page.getByRole('navigation', { name: 'Organization sections' }).getByRole('link', { name: 'Projects', exact: true });
/** One step of the wizard's progress list. */
const stepItem = (page: Page, label: string) =>
  page.getByRole('complementary', { name: 'Setup progress' }).getByRole('listitem').filter({ hasText: label });
/** A done step carries the check mark and is not the current step. */
const expectStepDone = async (page: Page, label: string) => {
  await expect(stepItem(page, label)).not.toHaveAttribute('aria-current', /.+/);
  await expect(stepItem(page, label).locator('svg')).toHaveCount(1);
};
const expectStepCurrent = (page: Page, label: string) =>
  expect(stepItem(page, label)).toHaveAttribute('aria-current', 'step');
const agentHeading = (page: Page) => page.getByRole('heading', { name: 'Add your agent', level: 1 });

test.describe('BR-72: the wizard rule guards', () => {
  test('TC-72.1: Change opens Agent & settings on the Limits tab in the same tab', async ({ page }) => {
    await seedShell(page, 'unfinishedAtRules');
    await page.goto(`/o/${ORG}/projects/new/rules?project=${INVOICER_API}`);
    const change = page.getByRole('link', { name: 'Change', exact: true });
    await expect(change).toBeVisible();
    await change.click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${INVOICER_API}/desk/agent\\?tab=limits$`));
    await expect(
      page.getByRole('tablist', { name: 'Agent and project settings' }).getByRole('tab', { selected: true }),
    ).toHaveText('Limits');
  });

  test('TC-72.2: Runs, Ignored opens the project Runs with the Ignored filter selected', async ({ page }) => {
    await seedShell(page, 'unfinishedAtRules');
    await page.goto(`/o/${ORG}/projects/new/rules?project=${INVOICER_API}`);
    await page.getByRole('link', { name: 'Runs, Ignored' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${INVOICER_API}/runs\\?filter=ignored$`));
    await expect(ignoredChip(page)).toHaveAttribute('aria-current', /.+/);
  });
});

test.describe('BR-73: Routing rules Runs, Ignored', () => {
  test('TC-73.1: opens the Runs with the Ignored filter in the address', async ({ page }) => {
    await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/rules`);
    await page.getByRole('link', { name: 'Runs, Ignored' }).click();
    await expect(page).toHaveURL(/[?&]filter=ignored/);
    await expect(ignoredChip(page)).toHaveAttribute('aria-current', /.+/);
  });

  test('TC-73.2: Ignored is selected, not the remembered filter', async ({ page }) => {
    await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
    await main(page)
      .getByRole('link', { name: /^Ended/ })
      .click();
    await expect(page).toHaveURL(/[?&]filter=ended/);
    // The last view is kept in the browser, so it survives opening the rules page by its address.
    await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/rules`);
    await page.getByRole('link', { name: 'Runs, Ignored' }).click();
    await expect(page).toHaveURL(/[?&]filter=ignored/);
    await expect(ignoredChip(page)).toHaveAttribute('aria-current', /.+/);
    await expect(main(page).getByRole('link', { name: /^Ended/ })).not.toHaveAttribute('aria-current', /.+/);
  });
});

test.describe('BR-77: who sees Resume setup', () => {
  for (const [name, scenario] of [
    ['owner', 'unfinishedProjects'],
    ['org admin', 'unfinishedAsAdmin'],
  ] as const) {
    test(`TC-77.1: an ${name} sees it beside More on each unfinished project, named for the project`, async ({
      page,
    }) => {
      await seedShell(page, scenario);
      await page.goto(`/o/${ORG}/projects`);
      const link = resume(page, 'invoicer-api');
      await expect(link).toBeVisible();
      await expect(resume(page, 'invoicer-web')).toBeVisible();
      const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'invoicer-api', exact: true }) });
      await expect(row.getByRole('button', { name: 'More for invoicer-api' })).toBeVisible();
      const [linkBox, moreBox] = await Promise.all([
        link.boundingBox(),
        row.getByRole('button', { name: 'More for invoicer-api' }).boundingBox(),
      ]);
      expect(linkBox && moreBox && linkBox.x < moreBox.x).toBe(true);
    });
  }

  test('TC-77.2: finished projects show no Resume setup', async ({ page }) => {
    await page.goto(`/o/${ORG}/projects`);
    await expect(page.getByRole('link', { name: 'invoicer-api', exact: true })).toBeVisible();
    await expect(anyResume(page)).toHaveCount(0);
  });

  for (const [name, scenario] of [
    ['member', 'unfinishedAsMember'],
    ['viewer', 'unfinishedAsViewer'],
  ] as const) {
    test(`TC-77.3: a ${name} sees the unfinished project without Resume setup`, async ({ page }) => {
      await seedShell(page, scenario);
      await page.goto(`/o/${ORG}/projects`);
      await expect(page.getByRole('link', { name: 'invoicer-api', exact: true })).toBeVisible();
      await expect(anyResume(page)).toHaveCount(0);
    });
  }

  test('TC-77.4: an admin of only the unfinished project sees no Resume setup', async ({ page }) => {
    await seedShell(page, 'unfinishedProjectAdmin');
    await page.goto(`/o/${ORG}/projects`);
    await expect(page.getByRole('link', { name: 'invoicer-api', exact: true })).toBeVisible();
    await expect(anyResume(page)).toHaveCount(0);
  });
});

test.describe('BR-78: Resume setup opens the first unfinished step', () => {
  test('TC-78.1: leaving the wizard in the app and resuming opens the first unfinished step with earlier steps done', async ({
    page,
  }) => {
    await seedShell(page, 'unfinishedProjects');
    await page.goto(`/o/${ORG}/projects`);
    await resume(page, 'invoicer-web').click();
    await expect(page).toHaveURL(new RegExp(`/projects/new/skills\\?project=${P2}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectStepCurrent(page, 'Add skills');
    for (const label of ['Connect repository', 'Add agent', 'Prepare workspace']) await expectStepDone(page, label);
    // Leave inside the app (no reload) through the top bar, then resume again.
    await topProjects(page).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await resume(page, 'invoicer-web').click();
    await expect(page).toHaveURL(new RegExp(`/projects/new/skills\\?project=${P2}$`));
    await expectStepCurrent(page, 'Add skills');
    for (const label of ['Connect repository', 'Add agent', 'Prepare workspace']) await expectStepDone(page, label);
  });

  test('TC-78.2: two unfinished projects each open at their own step', async ({ page }) => {
    await seedShell(page, 'unfinishedProjects');
    await page.goto(`/o/${ORG}/projects`);
    await resume(page, 'invoicer-api').click();
    await expect(page).toHaveURL(new RegExp(`/projects/new/agent\\?project=${INVOICER_API}$`));
    await topProjects(page).click();
    await resume(page, 'invoicer-web').click();
    await expect(page).toHaveURL(new RegExp(`/projects/new/skills\\?project=${P2}$`));
  });

  test('TC-78.3: a saved Codex agent shows read-only on the Agent step and Agent & settings lists one agent', async ({
    page,
  }) => {
    await seedShell(page, 'unfinishedCodex');
    await page.goto(`/o/${ORG}/projects`);
    await resume(page, 'invoicer-api').click();
    await expect(page).toHaveURL(new RegExp(`/projects/new/setup\\?project=${INVOICER_API}$`));
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(agentHeading(page)).toBeVisible();
    await expect(page.getByRole('radio', { name: 'OpenAI Codex' })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'OpenAI Codex' })).toBeChecked();
    // The saved agent as set: its name, its model and its credential (set by kim-hale).
    await expect(main(page).getByText('Agent name: Codex')).toBeVisible();
    // The mock's Codex model list does not list gpt-5-codex, so the picker shows it typed under Other model.
    await expect(page.getByRole('textbox', { name: 'Model name' })).toHaveValue('gpt-5-codex');
    await expect(page.getByText(/^Set .* by kim-hale\. Hidden for good after saving\./)).toBeVisible();
    for (const provider of ['Claude Code', 'OpenCode']) {
      await expect(page.getByRole('radio', { name: provider })).toBeDisabled();
    }
    await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
    await expect(page.getByRole('button', { name: 'Edit Codex', exact: true })).toHaveCount(1);
    await expect(main(page).getByRole('button', { name: /^Edit / })).toHaveCount(1);
  });

  test('TC-78.4: a project left on the Agent step opens on "Add your agent"', async ({ page }) => {
    await seedShell(page, 'unfinishedProjects');
    await page.goto(`/o/${ORG}/projects`);
    await resume(page, 'invoicer-api').click();
    await expect(agentHeading(page)).toBeVisible();
  });
});
