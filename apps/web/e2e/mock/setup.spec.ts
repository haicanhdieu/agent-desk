import { expect, test, type Page } from '@playwright/test';
import { ORG, startSignedOut } from './mock';

test('sign in with GitHub, set up a project in five steps and land on its runs', async ({ page }) => {
  await startSignedOut(page);
  await page.goto(`/o/${ORG}/projects/new/repo`);

  // Signed out: the guard sends us to sign-in, keeping where we were going.
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByRole('link', { name: 'Sign in with GitHub' }).click();

  // Step 1: repository and trigger.
  await expect(page.getByRole('heading', { name: 'Connect a repository', level: 1 })).toBeVisible();
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  await page.getByRole('textbox', { name: 'Project name' }).fill('demo');
  await page.getByRole('radio', { name: 'dev/demo' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: the agent (nothing is picked on a first visit).
  await expect(page.getByRole('heading', { name: 'Add your agent', level: 1 })).toBeVisible();
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await page.getByRole('radio', { name: 'Claude Code' }).check();
  await page.getByRole('textbox', { name: 'Token' }).fill('sk-ant-oat01-e2e-not-a-real-token');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: prepare the workspace (optional). The starter script is saved as version 1.
  await expect(page.getByRole('heading', { name: 'Prepare the workspace', level: 1 })).toBeVisible();
  await expect(page.getByText('Step 3 of 5, optional')).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // Step 4: skill templates (both picked by default).
  await expect(page.getByRole('heading', { name: 'Start from skill templates', level: 1 })).toBeVisible();
  await expect(page.getByText('Step 4 of 5, optional')).toBeVisible();
  await page.getByRole('button', { name: 'Commit 2 skills and continue' }).click();

  // Step 5: the first rule (prefilled /code-build plus the /code-review follow-up).
  await expect(page.getByRole('heading', { name: 'Add your first rule', level: 1 })).toBeVisible();
  await expect(page.getByText('Step 5 of 5')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Command' })).toHaveValue('code-build');
  await page.getByRole('button', { name: 'Save rules and finish' }).click();

  // Ready: the summary of what was set up.
  await expect(page.getByRole('heading', { name: 'Trigger your first run from GitHub', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/new\/ready\?project=/);
  const summary = page.getByRole('main');
  await expect(summary.getByRole('definition').filter({ hasText: 'dev/demo' })).toBeVisible();
  await expect(summary.getByRole('definition').filter({ hasText: 'code-build, code-review' })).toBeVisible();

  // The saved script was never tested: a warning, not a block.
  await expect(page.getByText('The setup script has not passed a test yet')).toBeVisible();

  // The token never shows again.
  await expect(page.getByText('sk-ant-oat01-e2e-not-a-real-token')).toHaveCount(0);

  await page.getByRole('link', { name: 'Go to runs' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/[0-9a-f-]+/runs$`));
  await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch project, currently demo' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'All 0' })).toBeVisible();
});

test('a failing setup test warns on the Ready step and does not block going to runs', async ({ page }) => {
  await page.goto(`/o/${ORG}/projects/new/repo`);
  await page.getByRole('radio', { name: 'dev/demo' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: 'Claude Code' }).check();
  await page.getByRole('textbox', { name: 'Token' }).fill('sk-ant-oat01-e2e-not-a-real-token');
  await page.getByRole('button', { name: 'Continue' }).click();

  // The mock fails a script with a line `exit <non-zero>`.
  await expect(page.getByRole('heading', { name: 'Prepare the workspace', level: 1 })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'Setup script' });
  await editor.click();
  await editor.press('ControlOrMeta+A');
  await editor.pressSequentially('exit 1');
  await page.getByRole('button', { name: 'Test setup' }).click();
  await expect(page.getByText('Setup failed')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'Save rules and finish' }).click();

  await expect(page.getByRole('heading', { name: 'Trigger your first run from GitHub', level: 1 })).toBeVisible();
  await expect(page.getByText('The last workspace setup test failed')).toBeVisible();
  await page.getByRole('link', { name: 'Go to runs' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/[0-9a-f-]+/runs$`));
});

test('skipping the workspace, skills and first rule steps still finishes setup', async ({ page }) => {
  await page.goto(`/o/${ORG}/projects/new/repo`);
  await page.getByRole('radio', { name: 'dev/demo' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: 'Claude Code' }).check();
  await page.getByRole('textbox', { name: 'Token' }).fill('sk-ant-oat01-e2e-not-a-real-token');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Step 3 of 5, optional')).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByText('Step 4 of 5, optional')).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByText('Step 5 of 5, optional')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Add first rule' }).getByText('optional')).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();

  // Ready, with no rule: an empty state that points to adding one.
  await expect(page).toHaveURL(/\/new\/ready\?project=/);
  await expect(page.getByRole('heading', { name: 'Add a rule to trigger runs', level: 1 })).toBeVisible();
  await expect(page.getByText('Project ready')).toBeVisible();
  await expect(page.getByText('No rule yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a rule' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to runs' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/[0-9a-f-]+/runs$`));
});

const collapseMenu = (page: Page) => page.getByRole('button', { name: 'Collapse menu' });
const expandMenu = (page: Page) => page.getByRole('button', { name: 'Expand menu' });
const exitSetup = (page: Page) => page.getByRole('link', { name: 'Exit setup' });
const progress = (page: Page) => page.getByRole('complementary', { name: 'Setup progress' });

/** Wizard step 1 saved with project "demo": the agent step is open. Client-side navigation only (a reload reseeds). */
async function startWizard(page: Page) {
  await page.goto(`/o/${ORG}/projects`);
  await page.getByRole('link', { name: 'New project' }).click();
  await expect(page.getByRole('heading', { name: 'Connect a repository', level: 1 })).toBeVisible();
}

async function saveRepoAndAgent(page: Page) {
  await page.getByRole('textbox', { name: 'Project name' }).fill('demo');
  await page.getByRole('radio', { name: 'dev/demo' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Add your agent', level: 1 })).toBeVisible();
  await page.getByRole('radio', { name: 'Claude Code' }).check();
  await page.getByRole('textbox', { name: 'Token' }).fill('sk-ant-oat01-e2e-not-a-real-token');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Prepare the workspace', level: 1 })).toBeVisible();
}

test.describe('BR-36: the stepper replaces the side menu', () => {
  for (const width of [1024, 1440]) {
    test(`TC-36.1: at ${width} the stepper is open with no section menu, tabs or collapse control`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await startWizard(page);
      await expect(progress(page)).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Organization menu' })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Organization sections' })).toHaveCount(0);
      await expect(collapseMenu(page)).toHaveCount(0);
      await expect(expandMenu(page)).toHaveCount(0);
    });
  }

  test('TC-36.2 and TC-36.3: a menu collapsed on Projects does not collapse the stepper and is still collapsed after Exit setup', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto(`/o/${ORG}/projects`);
    await collapseMenu(page).click();
    await expect(expandMenu(page)).toBeVisible();
    await page.getByRole('link', { name: 'New project' }).click();
    await expect(page.getByRole('heading', { name: 'Connect a repository', level: 1 })).toBeVisible();
    await expect(progress(page)).toBeVisible();
    for (const label of ['Connect repository', 'Add agent', 'Prepare workspace', 'Add skills', 'Add first rule']) {
      await expect(progress(page).getByRole('listitem').filter({ hasText: label })).toBeVisible();
    }
    await expect(expandMenu(page)).toHaveCount(0);
    await exitSetup(page).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(expandMenu(page)).toBeVisible();
  });

  test('TC-36.4: an expanded menu is still expanded after the wizard and Exit setup', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto(`/o/${ORG}/projects`);
    await expect(collapseMenu(page)).toBeVisible();
    await page.getByRole('link', { name: 'New project' }).click();
    await expect(progress(page)).toBeVisible();
    await exitSetup(page).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(collapseMenu(page)).toBeVisible();
  });
});

test.describe('BR-37: Exit setup', () => {
  test('TC-37.1: Exit setup on step 3 asks no confirm, opens Projects, and resuming shows the saved steps', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await startWizard(page);
    await saveRepoAndAgent(page);
    let dialogs = 0;
    page.on('dialog', (d) => {
      dialogs += 1;
      void d.dismiss();
    });
    await exitSetup(page).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    expect(dialogs).toBe(0);
    await page.getByRole('link', { name: 'Resume setup for demo' }).click();
    await expect(page.getByRole('heading', { name: 'Prepare the workspace', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Add your agent', level: 1 })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Claude Code' })).toBeChecked();
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Connect a repository', level: 1 })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('demo');
    await expect(page.getByRole('radio', { name: 'dev/demo' })).toBeChecked();
  });

  test('TC-37.2: at 1024 Exit setup is in the stepper column once, the label is above the title, and there is no header row', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await startWizard(page);
    await expect(exitSetup(page)).toHaveCount(1);
    await expect(progress(page).getByRole('link', { name: 'Exit setup' })).toBeVisible();
    const label = page.getByText('Step 1 of 5');
    await expect(label).toHaveCount(1);
    const labelBox = await label.boundingBox();
    const titleBox = await page.getByRole('heading', { name: 'Connect a repository', level: 1 }).boundingBox();
    expect(labelBox && titleBox && labelBox.y < titleBox.y).toBe(true);
    // The label is not on the same line as Exit setup: there is no header row.
    const exitBox = await exitSetup(page).boundingBox();
    expect(labelBox && exitBox && Math.abs(labelBox.y - exitBox.y) > 8).toBe(true);
  });

  for (const width of [1023, 390]) {
    test(`TC-37.3: at ${width} a header row holds Step N of M and Exit setup, neither repeated, and Exit setup opens Projects`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await startWizard(page);
      await saveRepoAndAgent(page);
      const label = page.getByText('Step 3 of 5, optional');
      await expect(label).toHaveCount(1);
      await expect(exitSetup(page)).toHaveCount(1);
      const labelBox = await label.boundingBox();
      const exitBox = await exitSetup(page).boundingBox();
      expect(labelBox && exitBox && Math.abs(labelBox.y - exitBox.y) < 20).toBe(true);
      await page.getByRole('button', { name: 'Open menu' }).click();
      const drawer = progress(page);
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('link', { name: 'Exit setup' })).toHaveCount(0);
      await expect(drawer.getByText(/^Step \d of 5/)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(exitSetup(page)).toHaveCount(1);
      await exitSetup(page).click();
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    });
  }

  test('TC-37.4: at the final Project ready step at 390 the row holds only Exit setup and it opens Projects', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await startWizard(page);
    await saveRepoAndAgent(page);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.getByRole('button', { name: 'Commit 2 skills and continue' }).click();
    await page.getByRole('button', { name: 'Save rules and finish' }).click();
    await expect(page.getByText('Project ready')).toBeVisible();
    await expect(page.getByText(/^Step \d of 5/)).toHaveCount(0);
    await expect(exitSetup(page)).toHaveCount(1);
    // The row above the content holds only Exit setup: nothing else is on its line.
    const row = await exitSetup(page).boundingBox();
    const heading = await page.getByText('Project ready').boundingBox();
    expect(row && heading && row.y + row.height <= heading.y).toBe(true);
    const inRow = await page
      .getByRole('main')
      .locator('a, button, span, b')
      .evaluateAll(
        (els, y) => els.filter((e) => Math.abs(e.getBoundingClientRect().y - y) < 6).map((e) => e.textContent),
        row?.y ?? 0,
      );
    expect(inRow.filter((t) => t && t.trim() !== '' && t.trim() !== 'Exit setup')).toEqual([]);
    await exitSetup(page).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
  });
});
