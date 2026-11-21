import { expect, test, type Locator, type Page } from '@playwright/test';
import type { OnboardingScenario } from '../../src/mocks/msw/onboardingScenarios';
import { seedOnboarding } from './mock';

/*
 * The create-org form (spec 2026-11-21-org-onboarding-design.md "E2E requirements": TC-36.1 to TC-36.10, TC-37.3,
 * TC-39.1, TC-39.2, TC-46.3).
 *
 * Every test seeds the case's mock scenario before its first goto and stays in the app after it (the mock store
 * reseeds on every page load). The request log is read on the wire: `page.on('request')` records every POST to the
 * org create and to the invitation create, so "no org is created" is a count of zero, taken after the page showed the
 * answer (the field error), and "exactly one org create and two invitation creates" is a count over the whole test.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const ORG_CREATE = /\/api\/platform\/orgs$/;
const INVITATION_CREATE = /\/api\/platform\/orgs\/[^/]+\/invitations$/;

interface Log {
  orgCreates: () => number;
  invitationCreates: () => number;
  /** The HTTP status of every org create the server answered. */
  orgCreateStatuses: () => number[];
  /** The problem title of every invitation create the server refused (status 4xx or 5xx). */
  invitationFailureTitles: () => Promise<string[]>;
}

/** Counts the create POSTs this page sends. Call before the first goto. */
function logRequests(page: Page): Log {
  let orgs = 0;
  let invitations = 0;
  const orgStatuses: number[] = [];
  const failureTitles: Promise<string>[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (ORG_CREATE.test(path)) orgs += 1;
    else if (INVITATION_CREATE.test(path)) invitations += 1;
  });
  page.on('response', (response) => {
    if (response.request().method() !== 'POST') return;
    const path = new URL(response.url()).pathname;
    if (ORG_CREATE.test(path)) orgStatuses.push(response.status());
    else if (INVITATION_CREATE.test(path) && response.status() >= 400) {
      failureTitles.push(response.json().then((body: { title?: string }) => body.title ?? ''));
    }
  });
  return {
    orgCreates: () => orgs,
    invitationCreates: () => invitations,
    orgCreateStatuses: () => orgStatuses,
    invitationFailureTitles: () => Promise.all(failureTitles),
  };
}

async function open(page: Page, scenario: OnboardingScenario): Promise<Log> {
  const log = logRequests(page);
  await seedOnboarding(page, scenario);
  await page.goto('/orgs/new');
  return log;
}

/** The form, loaded. */
async function openForm(page: Page, scenario: OnboardingScenario = 'platformAdminNoOrg'): Promise<Log> {
  const log = await open(page, scenario);
  await expect(page.getByRole('heading', { name: 'Create an organization', level: 1 })).toBeVisible();
  await expect(createButton(page)).toBeVisible();
  return log;
}

const nameInput = (page: Page): Locator => page.getByRole('textbox', { name: /^Name/ });
const slugInput = (page: Page): Locator => page.getByRole('textbox', { name: /^URL/ });
const emailInput = (page: Page): Locator => page.getByRole('textbox', { name: /^First owner email/ });
const createButton = (page: Page): Locator => page.getByRole('button', { name: 'Create organization' });

const VALID = { name: 'E2E Org', slug: 'e2e-org', email: 'owner@dev.local' };

async function fillForm(page: Page, v: Partial<typeof VALID>): Promise<void> {
  // The URL fills from the name until it is edited: always type the URL as the case gives it.
  if (v.name !== undefined) await nameInput(page).fill(v.name);
  if (v.slug !== undefined) await slugInput(page).fill(v.slug);
  if (v.email !== undefined) await emailInput(page).fill(v.email);
  if (v.name !== undefined) await expect(nameInput(page)).toHaveValue(v.name);
  if (v.slug !== undefined) await expect(slugInput(page)).toHaveValue(v.slug);
  if (v.email !== undefined) await expect(emailInput(page)).toHaveValue(v.email);
}

const createdHeading = (page: Page): Locator => page.getByRole('heading', { name: 'Organization created' });

/** An email of exactly `length` characters in a valid shape (local 64, labels of at most 63). */
function emailOfLength(length: number): string {
  const tail = length - 64 - 1 - 63 - 1 - 63 - 1;
  const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(tail)}`;
  if (email.length !== length) throw new Error(`built ${email.length} characters, wanted ${length}`);
  return email;
}

const FORMAT = 'Use lowercase letters, numbers and dashes, with no dash at the start or end.';

/** Only this field is marked invalid: a field error shows on it and on no other. */
async function expectOnlyInvalid(page: Page, field: Locator): Promise<void> {
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  // A field error shows: the field is described by a visible, non-empty message.
  await expect(field).not.toHaveAccessibleDescription('');
  for (const other of [nameInput(page), slugInput(page), emailInput(page)]) {
    if ((await other.getAttribute('id')) !== (await field.getAttribute('id'))) {
      await expect(other).not.toHaveAttribute('aria-invalid', 'true');
    }
  }
}

/** Nothing is created: no org create was sent, the form still shows and no created card does. */
async function expectNothingCreated(page: Page, log: Log): Promise<void> {
  expect(log.orgCreates()).toBe(0);
  expect(log.invitationCreates()).toBe(0);
  await expect(createdHeading(page)).toHaveCount(0);
  await expect(createButton(page)).toBeVisible();
}

test.describe('BR-36: create-org field validation', () => {
  test('TC-36.1: an empty Name shows "Enter a name." and creates nothing', async ({ page }) => {
    const log = await openForm(page);
    await fillForm(page, { slug: VALID.slug, email: VALID.email });
    await createButton(page).click();
    await expect(page.getByText('Enter a name.', { exact: true })).toBeVisible();
    await expectOnlyInvalid(page, nameInput(page));
    await expectNothingCreated(page, log);
  });

  test('TC-36.2: a 100-character Name has no Name error and the org is created', async ({ page }) => {
    const log = await openForm(page);
    await fillForm(page, { name: 'n'.repeat(100), slug: VALID.slug, email: VALID.email });
    await createButton(page).click();
    await expect(createdHeading(page)).toBeVisible();
    // The created card has no fields left; no Name error text is on the page.
    await expect(page.getByText('Enter a name.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Use 100 characters or fewer.', { exact: true })).toHaveCount(0);
    expect(log.orgCreates()).toBe(1);
  });

  test('TC-36.3: a 101-character Name shows a Name field error and creates nothing', async ({ page }) => {
    const log = await openForm(page);
    await fillForm(page, { name: 'n'.repeat(101), slug: VALID.slug, email: VALID.email });
    await createButton(page).click();
    // The spec gives no wording for this error (Q1): it asserts the error is on the Name field.
    await expectOnlyInvalid(page, nameInput(page));
    await expectNothingCreated(page, log);
  });

  test('TC-36.4: the URL "Bad_Slug" shows the format error and creates nothing', async ({ page }) => {
    const log = await openForm(page);
    await fillForm(page, { name: VALID.name, slug: 'Bad_Slug', email: VALID.email });
    await createButton(page).click();
    await expect(page.getByText(FORMAT, { exact: true })).toBeVisible();
    await expectOnlyInvalid(page, slugInput(page));
    await expectNothingCreated(page, log);
  });

  test('TC-36.5: the URL "-abc" shows the same format error and creates nothing', async ({ page }) => {
    const log = await openForm(page);
    await fillForm(page, { name: VALID.name, slug: '-abc', email: VALID.email });
    await createButton(page).click();
    await expect(page.getByText(FORMAT, { exact: true })).toBeVisible();
    await expectOnlyInvalid(page, slugInput(page));
    await expectNothingCreated(page, log);
  });

  test('TC-36.6: a 63-character URL has no URL error and the org is created', async ({ page }) => {
    const log = await openForm(page);
    await fillForm(page, { name: VALID.name, slug: 'a'.repeat(63), email: VALID.email });
    await createButton(page).click();
    await expect(createdHeading(page)).toBeVisible();
    await expect(page.getByText(FORMAT, { exact: true })).toHaveCount(0);
    expect(log.orgCreates()).toBe(1);
  });

  test('TC-36.7: a 64-character URL shows the format error and creates nothing', async ({ page }) => {
    const log = await openForm(page);
    await fillForm(page, { name: VALID.name, slug: 'a'.repeat(64), email: VALID.email });
    await createButton(page).click();
    await expect(page.getByText(FORMAT, { exact: true })).toBeVisible();
    await expectOnlyInvalid(page, slugInput(page));
    await expectNothingCreated(page, log);
  });

  test('TC-36.8: the taken URL "acme" shows "This URL is taken. Try another." and keeps the input', async ({
    page,
  }) => {
    const log = await openForm(page);
    await fillForm(page, { name: VALID.name, slug: 'acme', email: VALID.email });
    await createButton(page).click();
    await expect(page.getByText('This URL is taken. Try another.', { exact: true })).toBeVisible();
    await expectOnlyInvalid(page, slugInput(page));
    // The server refused the create (409): no org was created, no invitation came of it, the form is still there.
    expect(log.orgCreateStatuses()).toEqual([409]);
    expect(log.invitationCreates()).toBe(0);
    await expect(createdHeading(page)).toHaveCount(0);
    await expect(createButton(page)).toBeVisible();
    await expect(nameInput(page)).toHaveValue(VALID.name);
    await expect(slugInput(page)).toHaveValue('acme');
    await expect(emailInput(page)).toHaveValue(VALID.email);
  });

  test('TC-36.9: the email "nope" shows "Enter a valid email address." and creates nothing', async ({ page }) => {
    const log = await openForm(page);
    await fillForm(page, { name: VALID.name, slug: VALID.slug, email: 'nope' });
    await createButton(page).click();
    await expect(page.getByText('Enter a valid email address.', { exact: true })).toBeVisible();
    await expectOnlyInvalid(page, emailInput(page));
    await expectNothingCreated(page, log);
  });

  test('TC-36.10: a 255-character email shows an email field error and creates nothing', async ({ page }) => {
    const log = await openForm(page);
    await fillForm(page, { name: VALID.name, slug: VALID.slug, email: emailOfLength(255) });
    await createButton(page).click();
    // The spec gives no wording for this error (Q1): it asserts the error is on the email field.
    await expectOnlyInvalid(page, emailInput(page));
    await expectNothingCreated(page, log);
  });
});

test.describe('BR-37: no org, no invitation, not a platform admin', () => {
  test('TC-37.3: /orgs/new shows "You don\'t have access" and no form', async ({ page }) => {
    const log = await open(page, 'noOrgUninvited');
    await expect(page.getByRole('heading', { name: "You don't have access", level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create an organization' })).toHaveCount(0);
    await expect(createButton(page)).toHaveCount(0);
    expect(log.orgCreates()).toBe(0);
    expect(log.invitationCreates()).toBe(0);
  });
});

test.describe('BR-39: the owner invitation fails after the org was created', () => {
  async function failedOnce(page: Page): Promise<Log> {
    const log = await openForm(page, 'ownerInvitationFailsOnce');
    await fillForm(page, VALID);
    await createButton(page).click();
    await expect(
      page.getByText('The organization was created. Retry to create the owner invitation.', { exact: true }),
    ).toBeVisible();
    return log;
  }

  test('TC-39.1: a Banner with Retry shows, Create is hidden, Name and URL are read-only, the email is editable', async ({
    page,
  }) => {
    const log = await failedOnce(page);
    // The Banner title is the problem title of the failed invitation create.
    const banner = page.getByRole('alert').filter({ hasText: 'The organization was created.' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Retry' })).toBeVisible();
    // The Banner shows the problem title of the invitation create the server refused.
    await expect.poll(async () => (await log.invitationFailureTitles()).length).toBe(1);
    const titles = await log.invitationFailureTitles();
    expect(titles).toHaveLength(1);
    expect(titles[0]).not.toBe('');
    await expect(banner).toContainText(titles[0] ?? '');
    await expect(createButton(page)).toHaveCount(0);
    await expect(nameInput(page)).toHaveAttribute('readonly', '');
    await expect(slugInput(page)).toHaveAttribute('readonly', '');
    await expect(emailInput(page)).not.toHaveAttribute('readonly', '');
    await expect(emailInput(page)).toBeEditable();
    await expect(nameInput(page)).toHaveValue(VALID.name);
    await expect(slugInput(page)).toHaveValue(VALID.slug);
    expect(log.orgCreates()).toBe(1);
    expect(log.invitationCreates()).toBe(1);
  });

  test('TC-39.2: Retry shows "Organization created" with the owner link: one org create and two invitation creates', async ({
    page,
  }) => {
    const log = await failedOnce(page);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(createdHeading(page)).toBeVisible();
    await expect(page.getByText(/\/invitations\/[0-9a-f-]+/).first()).toBeVisible();
    await expect(page.getByText(VALID.email, { exact: false }).first()).toBeVisible();
    expect(log.orgCreates()).toBe(1);
    expect(log.invitationCreates()).toBe(2);
  });
});

test.describe('BR-46: a non-admin cannot create an org', () => {
  test('TC-46.3: /orgs/new shows "You don\'t have access" and no create-org form', async ({ page }) => {
    const log = await open(page, 'singleOrg');
    await expect(page.getByRole('heading', { name: "You don't have access", level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create an organization' })).toHaveCount(0);
    await expect(createButton(page)).toHaveCount(0);
    await expect(nameInput(page)).toHaveCount(0);
    await expect(slugInput(page)).toHaveCount(0);
    await expect(emailInput(page)).toHaveCount(0);
    expect(log.orgCreates()).toBe(0);
    expect(log.invitationCreates()).toBe(0);
  });
});
