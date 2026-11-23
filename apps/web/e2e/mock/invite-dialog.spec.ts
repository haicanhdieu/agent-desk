import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVITATIONS_MOCK_NOW } from '../../src/mocks/dto/invitations';
import type { OnboardingScenario } from '../../src/mocks/msw/onboardingScenarios';
import { seedOnboarding } from './mock';

/*
 * The "Invite people" dialog: field validation and the options per inviter (spec 2026-11-21-org-onboarding-design.md
 * "E2E requirements": TC-28.1 to TC-28.6, TC-29.1 to TC-29.3).
 *
 * Every test seeds the case's mock scenario and fixes the date before its first goto (the mock store reseeds on every
 * page load, so each test stays in the app after it). "Nothing is created" is read through the Pending list: the rows
 * before the dialog opened are the rows after it closes, and the tried email has no row.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const INVITATIONS = '/o/acme/settings/invitations';

async function open(page: Page, scenario: OnboardingScenario): Promise<void> {
  await seedOnboarding(page, scenario);
  await page.clock.setFixedTime(new Date(INVITATIONS_MOCK_NOW));
  await page.goto(INVITATIONS);
}

const dialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Invite people' });
const roleSelect = (page: Page): Locator => dialog(page).getByLabel('Role');
const emailInput = (page: Page): Locator => dialog(page).getByLabel('Email');
const dataRows = (page: Page): Locator => page.locator('tbody tr');

/** The Role choices, without the "Choose a role" placeholder. */
const roleChoices = (page: Page): Promise<string[]> =>
  roleSelect(page)
    .locator('option:not([disabled])')
    .evaluateAll((os) => os.map((o) => o.textContent ?? ''));

/** The loaded Pending list: its heading and rows are there; returns how many rows it holds. */
async function loadedRows(page: Page): Promise<number> {
  await expect(page.getByRole('heading', { name: 'Invitations', level: 1 })).toBeVisible();
  await expect(dataRows(page).first()).toBeVisible();
  return dataRows(page).count();
}

/** Opens the dialog and waits for the roles to load into it. */
async function openDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Invite people' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(roleSelect(page).locator('option:not([disabled])').first()).toBeAttached();
}

async function chooseRole(page: Page, name: string): Promise<void> {
  await roleSelect(page).selectOption({ label: name });
  await expect(roleSelect(page)).toHaveValue(/.+/);
}

async function chooseWholeOrg(page: Page): Promise<void> {
  await dialog(page).getByRole('radio', { name: 'Whole organization' }).check();
  await expect(dialog(page).getByRole('radio', { name: 'Whole organization' })).toBeChecked();
}

const submit = (page: Page) => dialog(page).getByRole('button', { name: 'Create invitation' }).click();

/** A valid-shaped email of exactly `length` characters (local part 64, labels up to 63, ending in ".dev"). */
function emailOfLength(length: number): string {
  const local = 'a'.repeat(64);
  // The domain is "label." parts (each at most 63 characters and a dot) and a final "dev".
  let rest = length - local.length - 1 - 3;
  let domain = '';
  while (rest > 0) {
    // Never leave a lone dot for the last part.
    const part = rest <= 64 ? rest : rest - 64 === 1 ? 63 : 64;
    domain += `${'b'.repeat(part - 1)}.`;
    rest -= part;
  }
  const email = `${local}@${domain}dev`;
  if (email.length !== length) throw new Error(`built ${email.length} characters, wanted ${length}`);
  return email;
}

/** Closes the form without creating and checks the Pending list is as it was. */
async function expectNothingCreated(page: Page, rowsBefore: number, email: string): Promise<void> {
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(dataRows(page)).toHaveCount(rowsBefore);
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
}

test.describe('BR-28: invite dialog validation', () => {
  test('TC-28.1: an invalid email shows a field error on Email and creates nothing', async ({ page }) => {
    await open(page, 'owner');
    const before = await loadedRows(page);
    await openDialog(page);
    await emailInput(page).fill('not-an-email');
    await submit(page);
    // Agent call: the spec leaves the wording open (Q1); the text is the one the dialog shows.
    await expect(dialog(page).getByText('Enter a valid email address.')).toBeVisible();
    await expect(emailInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog(page).getByText('Invitation created')).toHaveCount(0);
    await expectNothingCreated(page, before, 'not-an-email');
  });

  test('TC-28.2: a 255-character email shows a field error on Email and creates nothing', async ({ page }) => {
    const email = emailOfLength(255);
    await open(page, 'owner');
    const before = await loadedRows(page);
    await openDialog(page);
    await emailInput(page).fill(email);
    await expect(emailInput(page)).toHaveValue(email);
    await submit(page);
    // Agent call: wording left open by the spec (Q1); the text is the one the dialog shows.
    await expect(dialog(page).getByText('Use 254 characters or fewer.')).toBeVisible();
    await expect(emailInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog', { name: 'Invitation created' })).toHaveCount(0);
    await expectNothingCreated(page, before, email);
  });

  test('TC-28.3: a 254-character email is accepted and "Invitation created" shows', async ({ page }) => {
    const email = emailOfLength(254);
    await open(page, 'owner');
    const before = await loadedRows(page);
    await openDialog(page);
    await emailInput(page).fill(email);
    await expect(emailInput(page)).toHaveValue(email);
    await chooseRole(page, 'Member');
    await chooseWholeOrg(page);
    await submit(page);
    const created = page.getByRole('dialog', { name: 'Invitation created' });
    await expect(created).toBeVisible();
    await expect(created.getByText(`Send this link to ${email}.`, { exact: false })).toBeVisible();
    await expect(created.getByText('Invitation link')).toBeVisible();
    await expect(created.getByRole('button', { name: 'Copy link' })).toBeVisible();
    // No field error was shown anywhere in the dialog.
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
    await created.getByRole('button', { name: 'Done' }).click();
    await expect(created).toHaveCount(0);
    await expect(dataRows(page)).toHaveCount(before + 1);
  });

  test('TC-28.4: "Some projects" with none ticked shows a field error on the project choice and creates nothing', async ({
    page,
  }) => {
    const email = 'new@x.dev';
    await open(page, 'owner');
    const before = await loadedRows(page);
    await openDialog(page);
    await emailInput(page).fill(email);
    await chooseRole(page, 'Member');
    await dialog(page).getByRole('radio', { name: 'Some projects' }).check();
    await expect(dialog(page).getByRole('checkbox').first()).toBeVisible();
    await expect(dialog(page).getByRole('checkbox', { checked: true })).toHaveCount(0);
    await submit(page);
    // Agent call: wording left open by the spec (Q1); the text is the one the dialog shows.
    const access = dialog(page).getByRole('group', { name: 'Access' });
    await expect(access).toHaveAccessibleDescription('Choose at least one project.');
    await expect(dialog(page).getByText('Choose at least one project.')).toBeVisible();
    await expect(emailInput(page)).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog', { name: 'Invitation created' })).toHaveCount(0);
    await expectNothingCreated(page, before, email);
  });

  test('TC-28.5: an email that is already a member shows a field error on Email and creates nothing', async ({
    page,
  }) => {
    const email = 'member@x.dev';
    await open(page, 'owner');
    const before = await loadedRows(page);
    await openDialog(page);
    await emailInput(page).fill(email);
    await chooseRole(page, 'Member');
    await chooseWholeOrg(page);
    await submit(page);
    // Agent call: wording left open by the spec (Q1); the text is the one the dialog shows.
    await expect(dialog(page).getByText('This email is already a member.')).toBeVisible();
    await expect(emailInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog', { name: 'Invitation created' })).toHaveCount(0);
    await expectNothingCreated(page, before, email);
  });

  test('TC-28.6: an email with a pending invitation, in another case, shows the pending message and creates nothing', async ({
    page,
  }) => {
    await open(page, 'owner');
    const before = await loadedRows(page);
    // The Given: a pending invitation for p@x.dev.
    await expect(page.getByRole('row').filter({ hasText: 'p@x.dev' })).toHaveCount(1);
    await openDialog(page);
    await emailInput(page).fill('P@X.dev');
    await chooseRole(page, 'Member');
    await chooseWholeOrg(page);
    await submit(page);
    await expect(dialog(page).getByText('This email already has a pending invitation.')).toBeVisible();
    await expect(emailInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog', { name: 'Invitation created' })).toHaveCount(0);
    await expectNothingCreated(page, before, 'P@X.dev');
    // Still one invitation for p@x.dev, not two.
    await expect(page.getByRole('row').filter({ hasText: 'p@x.dev' })).toHaveCount(1);
  });
});

test.describe('BR-29: role and scope options per inviter', () => {
  test('TC-29.1: an owner is offered owner, admin, member and viewer, and both Access choices', async ({ page }) => {
    await open(page, 'owner');
    await loadedRows(page);
    await openDialog(page);
    expect(await roleChoices(page)).toEqual(['Owner', 'Admin', 'Member', 'Viewer']);
    await expect(dialog(page).getByRole('radio')).toHaveCount(2);
    await expect(dialog(page).getByRole('radio', { name: 'Whole organization' })).toBeVisible();
    await expect(dialog(page).getByRole('radio', { name: 'Some projects' })).toBeVisible();
  });

  test('TC-29.2: an org admin is not offered owner, and has both Access choices', async ({ page }) => {
    await open(page, 'orgAdmin');
    await loadedRows(page);
    await openDialog(page);
    expect(await roleChoices(page)).toEqual(['Admin', 'Member', 'Viewer']);
    await expect(dialog(page).getByRole('radio')).toHaveCount(2);
    await expect(dialog(page).getByRole('radio', { name: 'Whole organization' })).toBeVisible();
    await expect(dialog(page).getByRole('radio', { name: 'Some projects' })).toBeVisible();
  });

  test('TC-29.3: a project admin of P1 gets admin, member and viewer, no whole-org choice, and only P1', async ({
    page,
  }) => {
    await open(page, 'projectAdmin');
    await expect(page.getByRole('heading', { name: 'Invitations', level: 1 })).toBeVisible();
    await openDialog(page);
    expect(await roleChoices(page)).toEqual(['Admin', 'Member', 'Viewer']);
    await expect(dialog(page).getByRole('radio')).toHaveCount(0);
    await expect(dialog(page).getByText('Whole organization')).toHaveCount(0);
    await expect(dialog(page).getByText('Some projects', { exact: true })).toBeVisible();
    // Only P1 (invoicer-api); P2 (invoicer-web) is not listed. Wait for the projects to load first.
    const boxes = dialog(page).getByRole('checkbox');
    await expect(boxes.first()).toBeVisible();
    await expect(boxes).toHaveCount(1);
    await expect(dialog(page).getByRole('checkbox', { name: 'invoicer-api' })).toBeVisible();
    await expect(dialog(page).getByRole('checkbox', { name: 'invoicer-web' })).toHaveCount(0);
  });
});
