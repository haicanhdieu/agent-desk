import { expect, test, type Page } from '@playwright/test';
import { INVITATIONS_MOCK_NOW } from '../../src/mocks/dto/invitations';
import { seedOnboarding, startSignedOut } from './mock';

/*
 * Sign-in message, welcome page and invitee states (spec 2026-11-21-org-onboarding-design.md "E2E requirements":
 * TC-1.3 to TC-1.5, TC-4.1 to TC-4.3, TC-25.3, TC-25.4, TC-26.4, TC-26.5, TC-37.1, TC-37.2, TC-46.2, TC-52.3, TC-52.5).
 * Each test seeds the case's mock scenario and pins the clock (CLOCK, an hour before INVITATIONS_MOCK_NOW) before its first goto, so the
 * pending invitations (expiring 23 Nov 2026, 14:05) are still pending and the dates are the same on every machine.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

/** The invitation ids of the invitee fixtures (src/mocks/dto/invitations.ts), in the `noOrgInvited*` scenarios. */
const uuid = (n: number) => `b4000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PENDING = uuid(1);
const PENDING_INVITER_HANDLE = uuid(3);
const REVOKED = uuid(7);
const EXPIRED = uuid(8);
const DECLINED = uuid(6);
/** Expired, and the inviter was deleted (scenario `noOrgInvited`). */
const EXPIRED_INVITER_DELETED = uuid(9);

/**
 * The fixed clock. INVITATIONS_MOCK_NOW is the very minute the invitee's pending invitations expire (23 Nov 14:05), so
 * a clock set exactly there already counts them as expired; the specs start the clock one hour earlier, at 13:05, so
 * they are pending, and the expired and revoked fixtures (10 Nov and earlier) are unaffected.
 */
const CLOCK = new Date(Date.parse(INVITATIONS_MOCK_NOW) - 60 * 60_000);

async function open(page: Page, path: string): Promise<void> {
  await page.clock.install({ time: CLOCK });
  await page.goto(path);
}

const acceptButton = (page: Page) => page.getByRole('button', { name: 'Accept' });
const declineButton = (page: Page) => page.getByRole('button', { name: 'Decline' });

test.describe('BR-1: uninvited person refused at sign-in', () => {
  test('TC-1.3: the no-invitation banner shows and sign-in is still offered', async ({ page }) => {
    await startSignedOut(page);
    await open(page, '/sign-in?error=no_invitation');
    await expect(page.getByText('No invitation found for your email', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Ask an owner or admin of your organization to invite you, then sign in again.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
  });

  test('TC-1.4: another error shows "Sign-in failed" and not the no-invitation banner', async ({ page }) => {
    await startSignedOut(page);
    await open(page, '/sign-in?error=other');
    await expect(page.getByText('Sign-in failed')).toBeVisible();
    await expect(page.getByText('No invitation found for your email')).toHaveCount(0);
    await expect(page.getByText('Ask an owner or admin of your organization to invite you')).toHaveCount(0);
  });

  test('TC-1.5: HTML in the error value is not rendered anywhere', async ({ page }) => {
    await startSignedOut(page);
    await open(page, '/sign-in?error=<b>x</b>');
    await expect(page.getByText('Sign-in failed')).toBeVisible();
    await expect(page.getByText('No invitation found for your email')).toHaveCount(0);
    await expect(page.locator('b', { hasText: /^x$/ })).toHaveCount(0);
    await expect(page.getByText('<b>x</b>')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('<b>');
    const html = await page.content();
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('&lt;b&gt;x');
  });
});

test.describe('BR-4: expired or revoked invitation is not listed or acceptable', () => {
  test('TC-4.1: only the pending invitation is listed', async ({ page }) => {
    await seedOnboarding(page, 'noOrgInvitedStates');
    await open(page, '/invitations');
    await expect(page.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();
    await expect(acceptButton(page)).toHaveCount(1);
    await expect(declineButton(page)).toHaveCount(1);
    await expect(page.getByText('Acme Robotics invited you as Member')).toHaveCount(1);
    await expect(page.getByText(/expired/i)).toHaveCount(0);
    await expect(page.getByText(/revoked/i)).toHaveCount(0);
  });

  test('TC-4.2: the revoked invitation link says it was revoked, with no Accept', async ({ page }) => {
    await seedOnboarding(page, 'noOrgInvitedStates');
    await open(page, `/invitations/${REVOKED}`);
    await expect(page.getByText('This invitation was revoked')).toBeVisible();
    await expect(acceptButton(page)).toHaveCount(0);
  });

  test('TC-4.3: the expired invitation link says it has expired, with no Accept', async ({ page }) => {
    await seedOnboarding(page, 'noOrgInvitedStates');
    await open(page, `/invitations/${EXPIRED}`);
    await expect(page.getByText('This invitation has expired')).toBeVisible();
    await expect(acceptButton(page)).toHaveCount(0);
  });
});

/** The value (dd) next to a term (dt) of the invitation details list. */
const valueOf = (page: Page, term: string) =>
  page.locator('dt', { hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');

test.describe('BR-25: matching person sees the invitation details', () => {
  test('TC-25.3: the inviter name and the expiry date with its full date on hover', async ({ page }) => {
    await seedOnboarding(page, 'noOrgInvited');
    await open(page, `/invitations/${PENDING}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Join Acme Robotics' })).toBeVisible();
    await expect(valueOf(page, 'Invited by')).toHaveText('Ada Lovelace');
    const expiry = valueOf(page, 'Expires').getByTitle('23 Nov 2026, 14:05');
    await expect(expiry).toBeVisible();
    await expect(expiry).toHaveText('23 Nov, 14:05');
  });

  test('TC-25.4: an inviter whose name equals the handle shows the handle', async ({ page }) => {
    await seedOnboarding(page, 'noOrgInvited');
    await open(page, `/invitations/${PENDING_INVITER_HANDLE}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Join Acme Robotics' })).toBeVisible();
    await expect(valueOf(page, 'Invited by')).toHaveText('ada');
    await expect(page.getByText('Ada Lovelace')).toHaveCount(0);
  });
});

test.describe('BR-26: resolved invitation link shows its state', () => {
  test('TC-26.4: an expired invitation says so and names who to ask, with no Accept or Decline', async ({ page }) => {
    await seedOnboarding(page, 'noOrgInvited');
    await open(page, `/invitations/${EXPIRED}`);
    await expect(page.getByText('This invitation has expired')).toBeVisible();
    await expect(page.getByText('Ask Ada Lovelace to resend it.')).toBeVisible();
    await expect(acceptButton(page)).toHaveCount(0);
    await expect(declineButton(page)).toHaveCount(0);
  });

  test('TC-26.5: a declined invitation says so, with no Accept or Decline', async ({ page }) => {
    await seedOnboarding(page, 'noOrgInvited');
    await open(page, `/invitations/${DECLINED}`);
    await expect(page.getByText('You declined this invitation')).toBeVisible();
    await expect(acceptButton(page)).toHaveCount(0);
    await expect(declineButton(page)).toHaveCount(0);
  });
});

test.describe('BR-37: non-admin with no org and no invitation', () => {
  test('TC-37.1: the welcome page tells them they are not a member and offers only Sign out', async ({ page }) => {
    await seedOnboarding(page, 'noOrgUninvited');
    await open(page, '/');
    await expect(page).toHaveURL(/\/invitations$/);
    await expect(page.getByRole('heading', { name: "You're not a member of any organization" })).toBeVisible();
    await expect(
      page.getByText('No invitations for uninvited@x.dev. Ask an owner or admin to invite you.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByText('Create organization')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create organization' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Create organization' })).toHaveCount(0);
  });

  test('TC-37.2: Sign out goes to the sign-in page', async ({ page }) => {
    await seedOnboarding(page, 'noOrgUninvited');
    await open(page, '/');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in(\?.*)?$/);
  });
});

test.describe('BR-46: non-admin has no create-org control', () => {
  test('TC-46.2: the welcome page of a non-admin without an org has no Create organization button', async ({
    page,
  }) => {
    await seedOnboarding(page, 'noOrgUninvited');
    await open(page, '/');
    await expect(page.getByRole('heading', { name: "You're not a member of any organization" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create organization' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Create organization' })).toHaveCount(0);
    await expect(page.getByText('Create organization')).toHaveCount(0);
  });
});

test.describe('BR-52: inviter display name or handle', () => {
  test('TC-52.3: the invitee card reads "Invited by Ada Lovelace, expires <date>"', async ({ page }) => {
    await seedOnboarding(page, 'noOrgInvited');
    await open(page, '/invitations');
    await expect(page.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();
    // The two pending invitations whose inviter is Ada Lovelace (the fixtures `pending` and `pendingProjects`).
    await expect(page.getByText('Invited by Ada Lovelace, expires 23 Nov, 14:05', { exact: true })).toHaveCount(2);
  });

  test('TC-52.5: an expired invitation whose inviter was deleted names the org owners and admins', async ({ page }) => {
    await seedOnboarding(page, 'noOrgInvited');
    await open(page, `/invitations/${EXPIRED_INVITER_DELETED}`);
    await expect(page.getByText('This invitation has expired')).toBeVisible();
    await expect(page.getByText('Ask an owner or admin of Acme Robotics to resend it.')).toBeVisible();
  });
});
