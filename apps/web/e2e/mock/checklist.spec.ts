import { expect, test, type Locator, type Page } from '@playwright/test';
import { ids } from '../../src/mocks/dto/ids';
import type { OnboardingScenario } from '../../src/mocks/msw/onboardingScenarios';
import { seedOnboarding } from './mock';

/*
 * The first-run checklist and the Projects page controls (spec 2026-11-21-org-onboarding-design.md "E2E requirements":
 * TC-15.1 to TC-15.5, TC-17.1 to TC-17.3, TC-20.1, TC-20.2).
 *
 * Every test seeds the case's mock scenario before its first goto; the mock store reseeds on every page load, so each
 * test stays in the app after it (a click, no second goto). The org is Acme (`acme`); its projects are invoicer-api
 * (P1) and invoicer-web (P2). The spec names no URL or heading for the setup screens (open question Q2), so "the setup
 * step opens" is read as: the URL of that step, its page heading, and the project the top bar names.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const P1 = { id: ids.project.invoicerApi, name: 'invoicer-api' };
const P2 = { id: ids.project.invoicerWeb, name: 'invoicer-web' };

async function open(page: Page, scenario: OnboardingScenario): Promise<void> {
  await seedOnboarding(page, scenario);
  await page.goto('/o/acme/projects');
}

const card = (page: Page): Locator => page.getByRole('heading', { level: 2, name: 'Get started' });
const rowOf = (page: Page, label: string): Locator =>
  card(page)
    .locator('..')
    .getByRole('listitem')
    .filter({ has: page.getByText(label, { exact: true }) });
const startOf = (page: Page, label: string): Locator => rowOf(page, label).getByRole('link', { name: 'Start' });

/** The card is loaded: its heading and four rows are there. */
async function cardLoaded(page: Page): Promise<void> {
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('..').getByRole('listitem')).toHaveCount(4);
}

const wizardHeading = (page: Page): Locator => page.getByRole('heading', { level: 1, name: 'Connect a repository' });
const currentProject = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: `Switch project, currently ${name}` });

/** The Projects page of a signed-in non-owner has loaded: both projects are listed. */
async function projectsLoaded(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  await expect(page.getByText(P1.name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(P2.name, { exact: true }).first()).toBeVisible();
}

async function expectWizardOpen(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/o\/acme\/projects\/new\/[a-z]+(\?.*)?$/);
  await expect(wizardHeading(page)).toBeVisible();
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
}

async function expectAgentStepOf(page: Page, project: { id: string; name: string }): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/o/acme/p/${project.id}/desk/agent$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Agent & settings' })).toBeVisible();
  await expect(currentProject(page, project.name)).toBeVisible();
}

async function expectRuleStepOf(page: Page, project: { id: string; name: string }): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/o/acme/p/${project.id}/desk/rules$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Routing rules' })).toBeVisible();
  await expect(currentProject(page, project.name)).toBeVisible();
}

test.describe('BR-15: a checklist item opens the matching setup step', () => {
  test('TC-15.1: "Create a project" with no project opens the new-project wizard', async ({ page }) => {
    await open(page, 'checklistNoProject');
    await cardLoaded(page);
    await startOf(page, 'Create a project').click();
    await expectWizardOpen(page);
  });

  test('TC-15.2: "Connect a code host" with no project opens the new-project wizard', async ({ page }) => {
    await open(page, 'checklistNoProject');
    await cardLoaded(page);
    await startOf(page, 'Connect a code host').click();
    await expectWizardOpen(page);
  });

  test('TC-15.3: "Add an agent" opens the agent setup step of the one project', async ({ page }) => {
    await open(page, 'checklistPartial');
    await cardLoaded(page);
    await startOf(page, 'Add an agent').click();
    await expectAgentStepOf(page, P1);
  });

  test('TC-15.4: "Add a rule" opens the rule setup step of the one project', async ({ page }) => {
    await open(page, 'checklistPartial');
    await cardLoaded(page);
    await startOf(page, 'Add a rule').click();
    await expectRuleStepOf(page, P1);
  });

  test('TC-15.5: "Add a rule" with two projects opens the rule step of P1, the furthest along, not P2', async ({
    page,
  }) => {
    await open(page, 'checklistTwoProjects');
    await cardLoaded(page);
    // P1 has its agent credential, so "Add an agent" is Done and only the rule is still to do.
    await expect(rowOf(page, 'Add an agent').getByText('Done', { exact: true })).toBeVisible();
    await expect(startOf(page, 'Add a rule')).toBeVisible();
    await startOf(page, 'Add a rule').click();
    await expectRuleStepOf(page, P1);
    await expect(page).not.toHaveURL(new RegExp(P2.id));
    await expect(currentProject(page, P2.name)).toHaveCount(0);
  });
});

test.describe('BR-17: no checklist for project admin, member, viewer', () => {
  const cases: [string, OnboardingScenario][] = [
    ['TC-17.1: a project admin sees no "Get started" card', 'projectAdmin'],
    ['TC-17.2: a member sees no "Get started" card', 'member'],
    ['TC-17.3: a viewer sees no "Get started" card', 'viewer'],
  ];
  for (const [title, scenario] of cases) {
    test(title, async ({ page }) => {
      await open(page, scenario);
      await projectsLoaded(page);
      await expect(card(page)).toHaveCount(0);
      await expect(page.getByText('Get started')).toHaveCount(0);
    });
  }
});

test.describe('BR-20: member or viewer has no invite controls', () => {
  const noInviteControls = async (page: Page): Promise<void> => {
    for (const role of ['link', 'button'] as const) {
      await expect(page.getByRole(role, { name: 'Invitations' })).toHaveCount(0);
      await expect(page.getByRole(role, { name: /invite/i })).toHaveCount(0);
    }
    await expect(page.getByText(/invite people/i)).toHaveCount(0);
  };

  test('TC-20.1: a member sees no Invitations, no Invite people and no New project control', async ({ page }) => {
    await open(page, 'member');
    await projectsLoaded(page);
    await noInviteControls(page);
    await expect(page.getByRole('link', { name: 'New project' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);
  });

  test('TC-20.2: a viewer sees no Invitations and no Invite people control', async ({ page }) => {
    await open(page, 'viewer');
    await projectsLoaded(page);
    await noInviteControls(page);
  });

  // Positive control: the absence checks above mean something only if the same controls show for an owner.
  test('BR-20 control: an owner sees the Invitations and New project controls the member and viewer lack', async ({
    page,
  }) => {
    await open(page, 'owner');
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Invitations' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New project' })).toBeVisible();
  });
});
