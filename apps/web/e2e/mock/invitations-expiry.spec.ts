import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVITATIONS_MOCK_NOW } from '../../src/mocks/dto/invitations';
import { seedOnboarding } from './mock';

/*
 * Expiry and resend of expired invitations (spec 2026-11-21-org-onboarding-design.md "E2E requirements": TC-48.1 to
 * TC-48.4, TC-49.1, TC-49.2, TC-50.1, TC-52.4), scenario `invitationsExpiry`.
 *
 * The clock is fixed with `setFixedTime` at INVITATIONS_MOCK_NOW (23 Nov 2026, 14:05 UTC) before the first goto, so it
 * does not drift while a test runs. TC-48.4 "advance the clock by 2 minutes" is a second `setFixedTime` 2 minutes later
 * followed by a reload (a fixed clock has no ticking timers to fast-forward, and a reload is a step of the case).
 *
 * The mock store lives in page memory and is reseeded on every page load, so a case that must keep its changes
 * between steps (TC-49.1 then TC-49.2) moves to the invitee's link with an in-app navigation, not a goto. The owner
 * of the scenario is also the invited person of the rows it names (their own email), so "the matching invitee" is
 * the same signed-in user: no session switch is needed.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const ORG_SLUG = 'acme';
const INVITATIONS = `/o/${ORG_SLUG}/invitations`;
const NOW = new Date(INVITATIONS_MOCK_NOW);
const OWN_EMAIL = 'alice@example.com';

/** The ids the scenario gives its Acme rows, in order (onboardingScenarios.ts `expiryInvitations`, `orgRow`). */
const rowId = (n: number) => `b3200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Created 2 days 1 minute before the clock, never answered (stored pending, expired a minute ago). */
const NEVER_ANSWERED = rowId(1);
/** The row that expires 1 minute after the clock. */
const SOON_EMAIL = 'soon@x.dev';
/** Expired one day before the clock, for the owner's own email. */
const EXPIRED_ID = rowId(5);
const EXPIRED_EXPIRES = '2026-11-22T14:05:00.000Z';
/** The owner's pending invitation with its inviter deleted (invitedBy null), 3 hours after the clock. */
const NO_INVITER_EXPIRES = '2026-11-23T17:05:00.000Z';

async function open(page: Page, path: string = INVITATIONS): Promise<void> {
  await seedOnboarding(page, 'invitationsExpiry');
  await page.clock.setFixedTime(NOW);
  await page.goto(path);
}

const loaded = (page: Page) => expect(page.getByRole('heading', { name: 'Invitations', level: 1 })).toBeVisible();
const dataRows = (page: Page): Locator => page.locator('tbody tr');
const rowByExpiry = (page: Page, email: string, expiresAt: string): Locator =>
  dataRows(page)
    .filter({ has: page.getByText(email, { exact: true }) })
    .filter({
      has: page.locator(`time[datetime="${expiresAt}"]`),
    });
const chip = (page: Page, name: string): Locator =>
  page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name, exact: true });
const statusOf = (row: Locator): Locator => row.locator('td:nth-child(4)');
const invitedByOf = (row: Locator): Locator => row.locator('td:nth-child(6)');

async function choose(page: Page, name: string): Promise<void> {
  await chip(page, name).click();
  await expect(chip(page, name)).toHaveAttribute('aria-pressed', 'true');
}

async function openMenu(page: Page, row: Locator, email: string): Promise<Locator> {
  await row.getByRole('button', { name: `Actions for ${email}` }).click();
  const menu = page.getByRole('dialog', { name: `Actions for ${email}` });
  await expect(menu).toBeVisible();
  return menu;
}

/** Moves to a path inside the running SPA without reloading it, so the in-memory mock store keeps its changes. */
async function navigateInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

test.describe('BR-48: an invitation expires 2 days after it was created or resent', () => {
  test('TC-48.1: an invitation created 2 days and 1 minute ago shows as Expired under "Expired"', async ({ page }) => {
    await open(page);
    await loaded(page);
    await choose(page, 'Expired');
    // Its own expiry is 1 minute before the clock (14:04 UTC).
    const row = rowByExpiry(page, OWN_EMAIL, '2026-11-23T14:04:00.000Z');
    await expect(row).toHaveCount(1);
    await expect(statusOf(row)).toHaveText('Expired');
  });

  test("TC-48.2: the expired invitation is not in the invitee's list", async ({ page }) => {
    await open(page, '/invitations');
    await expect(page.getByRole('heading', { name: 'Invitations', level: 1 })).toBeVisible();
    // Loaded: the invitee's one live invitation (expiring 23 Nov, 17:05) is listed; the expired ones are not.
    await expect(page.getByText('Expires 23 Nov, 17:05', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1);
    await expect(page.getByText('Expires 23 Nov, 14:04', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Expires 22 Nov, 14:05', { exact: true })).toHaveCount(0);
  });

  test('TC-48.3: the expired link says so and names the inviter, with no Accept or Decline', async ({ page }) => {
    await open(page, `/invitations/${NEVER_ANSWERED}`);
    await expect(page.getByText('This invitation has expired')).toBeVisible();
    await expect(page.getByText('Ask Ada Lovelace to resend it.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Decline' })).toHaveCount(0);
  });

  test('TC-48.4: a pending invitation 1 minute from expiry is Expired after the clock moves 2 minutes', async ({
    page,
  }) => {
    await open(page);
    await loaded(page);
    await expect(chip(page, 'Pending')).toHaveAttribute('aria-pressed', 'true');
    const soon = dataRows(page).filter({ has: page.getByText(SOON_EMAIL, { exact: true }) });
    await expect(soon).toHaveCount(1);
    await expect(statusOf(soon)).toHaveText('Pending');

    await page.clock.setFixedTime(new Date(NOW.getTime() + 2 * 60_000));
    await page.reload();
    await loaded(page);
    // Loaded: the invitations that are still pending are listed, this one is not.
    await expect(page.getByText('in2d@x.dev', { exact: true })).toBeVisible();
    await expect(page.getByText(SOON_EMAIL, { exact: true })).toHaveCount(0);

    await choose(page, 'Expired');
    await expect(statusOf(dataRows(page).filter({ has: page.getByText(SOON_EMAIL, { exact: true }) }))).toHaveText(
      'Expired',
    );
  });
});

test.describe('BR-49: resending an expired invitation revives the same link', () => {
  /** The case's Given and steps: the owner, on "Expired", opens the row menu of the expired invitation and presses Resend. */
  async function resendExpired(page: Page): Promise<void> {
    await open(page);
    await loaded(page);
    await choose(page, 'Expired');
    const row = rowByExpiry(page, OWN_EMAIL, EXPIRED_EXPIRES);
    await expect(row).toHaveCount(1);
    const menu = await openMenu(page, row, OWN_EMAIL);
    await menu.getByRole('button', { name: 'Resend' }).click();
  }

  test('TC-49.1: Resend shows the renewed Toast and the row is Pending with a later expiry', async ({ page }) => {
    await resendExpired(page);
    const toast = page.getByRole('status').filter({ hasText: 'Invitation renewed.' });
    await expect(toast).toHaveText('Invitation renewed. It now expires on 25 Nov, 14:05.');
    await expect(page.getByRole('alert')).toHaveCount(0);

    await choose(page, 'Pending');
    const renewed = rowByExpiry(page, OWN_EMAIL, '2026-11-25T14:05:00.000Z');
    await expect(renewed).toHaveCount(1);
    await expect(statusOf(renewed)).toHaveText('Pending');
    await expect(renewed.locator('time')).toHaveText('Expires in 2 days');
    // Gone from Expired (the older expired row of the same email is still there).
    await choose(page, 'Expired');
    await expect(rowByExpiry(page, OWN_EMAIL, EXPIRED_EXPIRES)).toHaveCount(0);
  });

  test('TC-49.2: after the resend the same link shows "Join Acme" with Accept and Decline', async ({ page }) => {
    await resendExpired(page);
    await expect(page.getByRole('status').filter({ hasText: 'Invitation renewed.' })).toBeVisible();
    // As the matching invitee (the owner's own email), in the same page so the store keeps the resend.
    await navigateInApp(page, `/invitations/${EXPIRED_ID}`);
    await expect(page.getByRole('heading', { name: 'Join Acme' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Decline' })).toBeVisible();
    await expect(page.getByText('This invitation has expired')).toHaveCount(0);
  });
});

test.describe('BR-50: resend is refused while the email has another pending invitation', () => {
  test('TC-50.1: "already invited" shows as an error and neither invitation changes', async ({ page }) => {
    await open(page);
    await loaded(page);
    await choose(page, 'Expired');
    const expired = dataRows(page).filter({ has: page.getByText('again@x.dev', { exact: true }) });
    await expect(expired).toHaveCount(1);
    await expect(statusOf(expired)).toHaveText('Expired');
    const menu = await openMenu(page, expired, 'again@x.dev');
    await menu.getByRole('button', { name: 'Resend' }).click();

    const error = page.getByRole('alert');
    await expect(error).toBeVisible();
    // The spec names an "already invited" error without fixing its words.
    await expect(error).toContainText(/already invited|already has a pending invitation/i);
    await expect(page.getByRole('status').filter({ hasText: 'Invitation renewed' })).toHaveCount(0);
    // The expired row stays Expired, with its own expiry.
    await expect(expired).toHaveCount(1);
    await expect(statusOf(expired)).toHaveText('Expired');
    // The pending one is unchanged: still pending, expiring in 1 day.
    await choose(page, 'Pending');
    const pending = dataRows(page).filter({ has: page.getByText('again@x.dev', { exact: true }) });
    await expect(pending).toHaveCount(1);
    await expect(statusOf(pending)).toHaveText('Pending');
    await expect(pending.locator('time')).toHaveText('Expires in 1 day');
    await expect(pending.locator('time')).toHaveAttribute('datetime', '2026-11-24T14:05:00.000Z');
  });
});

test.describe('BR-52: an invitation whose inviter was deleted names no inviter', () => {
  test('TC-52.4: the Invited by column shows a plain dash and the invitee card reads "Expires <date>"', async ({
    page,
  }) => {
    // The one invitation whose inviter is gone: the owner's own email, pending, expiring 23 Nov, 17:05, in Alice (the
    // other org the owner administers). Its Invitations page lists it under Pending.
    await open(page, '/o/alice/invitations');
    await loaded(page);
    const noInviter = rowByExpiry(page, OWN_EMAIL, NO_INVITER_EXPIRES);
    await expect(noInviter).toHaveCount(1);
    await expect(statusOf(noInviter)).toHaveText('Pending');
    await expect(invitedByOf(noInviter)).toHaveText('–');

    // The same invitation as its invitee: "Expires <date>" and no "Invited by" part.
    await navigateInApp(page, '/invitations');
    const card = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Alice' });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Expires 23 Nov, 17:05');
    await expect(card).not.toContainText(/Invited by/);
  });
});
