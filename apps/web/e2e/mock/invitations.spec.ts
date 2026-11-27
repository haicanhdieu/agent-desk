import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVITATIONS_MOCK_NOW, orgInvitationFixtures } from '../../src/mocks/dto/invitations';
import type { OnboardingScenario } from '../../src/mocks/msw/onboardingScenarios';
import { FOREIGN } from '../../src/mocks/msw/shellScenarios';
import { holdReads, seedOnboarding, seedShell } from './mock';

/*
 * The Invitations page: row actions, paging, copy link, the Expires column and the Invited by column (spec
 * 2026-11-21-org-onboarding-design.md "E2E requirements": TC-19.1 to TC-19.4, TC-20.3, TC-20.4, TC-30.2 to TC-30.4,
 * TC-33.1, TC-33.2, TC-51.1 to TC-51.5, TC-52.2).
 *
 * Every test seeds the case's mock scenario and fixes the date before its first goto. The date is always
 * INVITATIONS_MOCK_NOW (23 Nov 2026, 14:05 UTC), set with `setFixedTime` so it does not move while the test runs: the
 * BR-51 cases sit on exact thresholds (expired exactly 3 days ago) that a running clock would pass. The pending
 * fixtures expire at or after that instant (the `invitationsExpiry` row for the owner's own email is a minute past it),
 * the rows the cases name are at the offsets their text gives (2 days ahead, 5 hours ahead, expired 1 day ago, 2 days
 * 23 hours ago, exactly 3 days ago, 3 days 1 hour ago, 5 days ago).
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const ORG_SLUG = 'acme';
const INVITATIONS = `/o/${ORG_SLUG}/settings/invitations`;

async function open(page: Page, scenario: OnboardingScenario, path: string = INVITATIONS): Promise<void> {
  await seedOnboarding(page, scenario);
  await page.clock.setFixedTime(new Date(INVITATIONS_MOCK_NOW));
  await page.goto(path);
}

/** The loaded list: the page heading is there. */
const loaded = (page: Page) => expect(page.getByRole('heading', { name: 'Invitations', level: 1 })).toBeVisible();

const rowOf = (page: Page, email: string): Locator =>
  page.getByRole('row').filter({ has: page.getByText(email, { exact: true }) });
const dataRows = (page: Page): Locator => page.locator('tbody tr');
const menuButton = (page: Page, email: string): Locator => page.getByRole('button', { name: `Actions for ${email}` });
const chip = (page: Page, name: string): Locator =>
  page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: name, exact: true });

async function openMenu(page: Page, email: string): Promise<Locator> {
  await menuButton(page, email).click();
  const menu = page.getByRole('dialog', { name: `Actions for ${email}` });
  await expect(menu).toBeVisible();
  return menu;
}

async function choose(page: Page, name: string): Promise<void> {
  await chip(page, name).click();
  await expect(chip(page, name)).toHaveAttribute('aria-pressed', 'true');
}

const fixtureId = (email: string): string => {
  const row = orgInvitationFixtures.find((i) => i.email === email);
  if (!row) throw new Error(`no fixture ${email}`);
  return row.id;
};

/** Swaps `navigator.clipboard`: writes are kept for `readText`, or refused. Call before the first goto. */
async function stubClipboard(page: Page, mode: 'works' | 'fails'): Promise<void> {
  await page.addInitScript((m) => {
    const store = window as unknown as { __copied?: string };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          if (m === 'fails') return Promise.reject(new DOMException('denied', 'NotAllowedError'));
          store.__copied = text;
          return Promise.resolve();
        },
        readText: () => Promise.resolve(store.__copied ?? ''),
      },
    });
  }, mode);
}

test.describe('BR-19: row actions follow the status', () => {
  test('TC-19.1: accepted, declined and revoked rows offer no Resend or Revoke', async ({ page }) => {
    await open(page, 'owner');
    await loaded(page);
    await choose(page, 'All');
    for (const [email, status] of [
      ['a@x.dev', 'Accepted'],
      ['d@x.dev', 'Declined'],
      ['r@x.dev', 'Revoked'],
    ] as const) {
      await expect(rowOf(page, email)).toContainText(status);
      // The row menu is disabled: there is nothing to open. Try to open it anyway: no menu appears.
      await expect(menuButton(page, email)).toBeDisabled();
      await menuButton(page, email).click({ force: true });
      await expect(page.getByRole('dialog', { name: `Actions for ${email}` })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Resend', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Revoke', exact: true })).toHaveCount(0);
    }
  });

  test('TC-19.2: an expired row offers Resend and not Revoke', async ({ page }) => {
    await open(page, 'owner');
    await loaded(page);
    await choose(page, 'Expired');
    await expect(rowOf(page, 'e@x.dev')).toContainText('Expired');
    const menu = await openMenu(page, 'e@x.dev');
    await expect(menu.getByRole('button', { name: 'Resend' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
  });

  test('TC-19.3: Resend on an invitation accepted meanwhile shows a red Toast, refreshes the list and changes nothing', async ({
    page,
  }) => {
    await open(page, 'invitationChanged');
    await loaded(page);
    await expect(rowOf(page, 'p@x.dev')).toContainText('Pending');
    const menu = await openMenu(page, 'p@x.dev');
    await menu.getByRole('button', { name: 'Resend' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invitation is no longer pending' })).toBeVisible();
    // The list refreshed: the row is not pending any more, so the Pending filter no longer holds it.
    await expect(rowOf(page, 'p@x.dev')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No pending invitations' })).toBeVisible();
    await choose(page, 'All');
    await expect(dataRows(page)).toHaveCount(1);
    await expect(rowOf(page, 'p@x.dev')).toContainText('Accepted');
    // Nothing was renewed.
    await expect(page.getByText('Invitation renewed', { exact: false })).toHaveCount(0);
  });

  test('TC-19.4: Revoke on an invitation changed meanwhile shows an error Toast, refreshes the list and changes nothing', async ({
    page,
  }) => {
    await open(page, 'invitationChanged');
    await loaded(page);
    await expect(rowOf(page, 'p@x.dev')).toContainText('Pending');
    const menu = await openMenu(page, 'p@x.dev');
    await menu.getByRole('button', { name: 'Revoke' }).click();
    const confirm = page.getByRole('dialog', { name: 'Revoke invitation for p@x.dev?' });
    await confirm.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(confirm).toHaveCount(0);
    await expect(rowOf(page, 'p@x.dev')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No pending invitations' })).toBeVisible();
    await choose(page, 'All');
    await expect(dataRows(page)).toHaveCount(1);
    await expect(rowOf(page, 'p@x.dev')).toContainText('Accepted');
    // Not revoked.
    await expect(page.getByText('Invitation revoked')).toHaveCount(0);
  });
});

test.describe('BR-20: members and viewers cannot open the Invitations page', () => {
  for (const [tc, scenario] of [
    ['TC-20.3', 'member'],
    ['TC-20.4', 'viewer'],
  ] as const) {
    test(`${tc}: the ${scenario} sees the no-access state and no invitation rows`, async ({ page }) => {
      await open(page, scenario);
      await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible();
      await expect(dataRows(page)).toHaveCount(0);
      await expect(page.getByText('p@x.dev')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Invitations' })).toHaveCount(0);
    });
  }
});

test.describe('BR-30: the status filter starts on Pending and the list is paged', () => {
  const statusCells = (page: Page) => dataRows(page).locator('td:nth-child(4)');

  test('TC-30.2: page 1 shows only pending rows and page 2 shows the next pending rows', async ({ page }) => {
    await open(page, 'invitationsPaged');
    await loaded(page);
    await expect(chip(page, 'Pending')).toHaveAttribute('aria-pressed', 'true');
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pager).toBeVisible();
    await expect(pager).toContainText('Showing 1–');
    await expect(pager).toContainText('of 25');
    const first = await dataRows(page).locator('td:nth-child(1)').allTextContents();
    expect(first.length).toBeGreaterThan(0);
    const count = await statusCells(page).count();
    for (let i = 0; i < count; i++) await expect(statusCells(page).nth(i)).toHaveText('Pending');
    for (const done of ['done1@x.dev', 'done2@x.dev', 'done3@x.dev']) await expect(page.getByText(done)).toHaveCount(0);

    await pager.getByRole('button', { name: 'Page 2' }).first().click();
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await expect(pager.getByRole('button', { name: 'Page 2' }).first()).toHaveAttribute('aria-current', 'page');
    await expect(pager).toContainText(`Showing ${first.length + 1}–25 of 25`);
    const second = await dataRows(page).locator('td:nth-child(1)').allTextContents();
    expect(second.length).toBeGreaterThan(0);
    expect(second.filter((email) => first.includes(email))).toEqual([]);
    const count2 = await statusCells(page).count();
    expect(count2).toBe(second.length);
    for (let i = 0; i < count2; i++) await expect(statusCells(page).nth(i)).toHaveText('Pending');
    for (const done of ['done1@x.dev', 'done2@x.dev', 'done3@x.dev']) await expect(page.getByText(done)).toHaveCount(0);
  });

  test('TC-30.3: an unknown ?status= reads as Pending', async ({ page }) => {
    await open(page, 'invitationsPaged', `${INVITATIONS}?status=bogus`);
    await loaded(page);
    await expect(chip(page, 'Pending')).toHaveAttribute('aria-pressed', 'true');
    for (const other of ['Accepted', 'Declined', 'Revoked', 'Expired', 'All'])
      await expect(chip(page, other)).toHaveAttribute('aria-pressed', 'false');
    await expect(dataRows(page).first()).toBeVisible();
    const count = await statusCells(page).count();
    for (let i = 0; i < count; i++) await expect(statusCells(page).nth(i)).toHaveText('Pending');
  });

  test('TC-30.4: choosing the Accepted chip on page 2 returns to page 1', async ({ page }) => {
    await open(page, 'invitationsPaged');
    await loaded(page);
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await pager.getByRole('button', { name: 'Page 2' }).first().click();
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await choose(page, 'Accepted');
    await expect(page).toHaveURL(/[?&]status=accepted(&|$)/);
    await expect(page).not.toHaveURL(/page=/);
    await expect(rowOf(page, 'done1@x.dev')).toContainText('Accepted');
    await expect(dataRows(page)).toHaveCount(3);
  });
});

test.describe('BR-33: Copy link', () => {
  test('TC-33.1: the link is on the clipboard and a green Toast says "Link copied"', async ({ page }) => {
    await stubClipboard(page, 'works');
    await open(page, 'owner');
    await loaded(page);
    const menu = await openMenu(page, 'p@x.dev');
    await menu.getByRole('button', { name: 'Copy link' }).click();
    const toast = page.getByRole('status').filter({ hasText: 'Link copied' });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveText(/^Link copied/);
    const origin = new URL(page.url()).origin;
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(`${origin}/invitations/${fixtureId('p@x.dev')}`);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('TC-33.2: a refused clipboard shows a red Toast and a popover with the link', async ({ page }) => {
    await stubClipboard(page, 'fails');
    await open(page, 'owner');
    await loaded(page);
    const menu = await openMenu(page, 'p@x.dev');
    await menu.getByRole('button', { name: 'Copy link' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Could not copy. Select the link and copy it.' }),
    ).toBeVisible();
    const popover = page.getByRole('dialog', { name: 'Invitation link' });
    await expect(popover).toBeVisible();
    const link = `${new URL(page.url()).origin}/invitations/${fixtureId('p@x.dev')}`;
    await expect(popover.getByText(link, { exact: true })).toBeVisible();
    await expect(page.getByText('Link copied')).toHaveCount(0);
  });
});

test.describe('BR-51: the Expires column', () => {
  /** The Expires cell of a row and its hover text (the exact date). */
  const expiresOf = (page: Page, email: string): Locator => rowOf(page, email).locator('td:nth-child(5)');
  const timeOf = (page: Page, email: string): Locator => expiresOf(page, email).locator('time');

  test('TC-51.1: expiring in 2 days reads "Expires in 2 days" with the exact date on hover', async ({ page }) => {
    await open(page, 'invitationsExpiry');
    await loaded(page);
    const cell = timeOf(page, 'in2d@x.dev');
    await expect(cell).toHaveText('Expires in 2 days');
    await cell.hover();
    await expect(cell).toHaveAttribute('title', '25 Nov 2026, 14:05');
  });

  test('TC-51.2: expiring in 5 hours reads "Expires in 5 hours" with the exact date on hover', async ({ page }) => {
    await open(page, 'invitationsExpiry');
    await loaded(page);
    const cell = timeOf(page, 'in5h@x.dev');
    await expect(cell).toHaveText('Expires in 5 hours');
    await cell.hover();
    await expect(cell).toHaveAttribute('title', '23 Nov 2026, 19:05');
  });

  test('TC-51.3: expired 1 day ago reads relative with the exact date on hover', async ({ page }) => {
    await open(page, 'invitationsExpiry');
    await loaded(page);
    await choose(page, 'Expired');
    // The expired row 1 day ago: 22 Nov 2026, 14:05.
    const cell = page.locator('tbody time[datetime="2026-11-22T14:05:00.000Z"]');
    await expect(cell).toHaveCount(1);
    await expect(cell).toHaveText(/^Expired 1 days? ago$/);
    await cell.hover();
    await expect(cell).toHaveAttribute('title', '22 Nov 2026, 14:05');
  });

  test('TC-51.4: expired 2 days 23 hours ago and exactly 3 days ago both read relative with the date on hover', async ({
    page,
  }) => {
    await open(page, 'invitationsExpiry');
    await loaded(page);
    await choose(page, 'Expired');
    for (const [email, title] of [
      ['expired-2d23h@x.dev', '20 Nov 2026, 15:05'],
      ['expired-3d@x.dev', '20 Nov 2026, 14:05'],
    ] as const) {
      const cell = timeOf(page, email);
      await expect(cell).toHaveText(/^Expired .+ ago$/);
      await cell.hover();
      await expect(cell).toHaveAttribute('title', title);
    }
  });

  test('TC-51.5: expired 3 days 1 hour ago and 5 days ago show the exact date and no relative label', async ({
    page,
  }) => {
    await open(page, 'invitationsExpiry');
    await loaded(page);
    await choose(page, 'Expired');
    for (const [email, text, title] of [
      ['expired-3d1h@x.dev', '20 Nov, 13:05', '20 Nov 2026, 13:05'],
      ['expired-5d@x.dev', '18 Nov, 14:05', '18 Nov 2026, 14:05'],
    ] as const) {
      await expect(expiresOf(page, email)).toHaveText(text);
      await expect(expiresOf(page, email)).not.toContainText(/Expire[sd] (in )?.*(ago|hour|day)/);
      await timeOf(page, email).hover();
      await expect(timeOf(page, email)).toHaveAttribute('title', title);
    }
  });
});

test.describe('BR-52: Invited by shows the display name or the handle', () => {
  test('TC-52.2: "Ada Lovelace" for the named inviter and "bob" for the inviter without a display name', async ({
    page,
  }) => {
    await open(page, 'owner');
    await loaded(page);
    await expect(rowOf(page, 'p@x.dev').locator('td:nth-child(6)')).toHaveText('Ada Lovelace');
    await expect(rowOf(page, 'b@x.dev').locator('td:nth-child(6)')).toHaveText('bob');
  });
});

test.describe('BR-57: /invitations for a person who belongs to an org', () => {
  const NOT_MEMBER = "You're not a member of any organization";

  test('TC-57.1: an org member with no pending invitation is not told they are no member', async ({ page }) => {
    await open(page, 'memberNoInvites', '/invitations');
    await expect(page.getByText('No pending invitations', { exact: true })).toBeVisible();
    await expect(page.getByText('No invitations for mira.chen@harborlabs.dev.', { exact: true })).toBeVisible();
    await expect(page.getByText(NOT_MEMBER)).toHaveCount(0);
  });

  test('TC-57.2: a person with no org keeps the current welcome text', async ({ page }) => {
    await open(page, 'noOrgUninvited', '/invitations');
    await expect(page.getByText(NOT_MEMBER, { exact: true })).toBeVisible();
    await expect(
      page.getByText('No invitations for uninvited@x.dev. Ask an owner or admin to invite you.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  // Agent call: the scenario `singleOrgTwoPending` holds two pending invitations; the case only needs the list to
  // show and the empty text not to. It does not use open(): that helper's clock is the instant these rows expire, so
  // the clock is set to a day before they do.
  test('TC-57.3: an org member with a pending invitation sees it listed, not "No pending invitations"', async ({
    page,
  }) => {
    await seedOnboarding(page, 'singleOrgTwoPending');
    await page.clock.setFixedTime(new Date('2026-11-21T12:00:00.000Z'));
    await page.goto('/invitations');
    await expect(page.getByRole('heading', { level: 1, name: 'My invitations' })).toBeVisible();
    const cards = page.getByRole('heading', { level: 2, name: 'Acme Robotics invited you as Member' });
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(2);
    await expect(page.getByText('No pending invitations')).toHaveCount(0);
  });
});

// BR-70: the invitation card on `/invitations/:id`. jsdom has no layout, so the inset is measured here. The card is
// the figure that holds the details list; Accept and Decline sit under it, outside the card. The 1px slack is for
// the card's own border and sub-pixel rounding.
test.describe('BR-70: invitation card padding', () => {
  const PENDING_LINK = `/invitations/b4000000-0000-4000-8000-${String(1).padStart(12, '0')}`;

  async function expectInset(page: Page): Promise<void> {
    await seedOnboarding(page, 'noOrgInvited');
    await page.clock.setFixedTime(new Date(Date.parse(INVITATIONS_MOCK_NOW) - 60 * 60_000));
    await page.goto(PENDING_LINK);
    await expect(page.getByRole('heading', { level: 1, name: 'Join Acme Robotics' })).toBeVisible();
    const card = page.locator('figure').filter({ has: page.locator('dl') });
    const box = await card.boundingBox();
    if (!box) throw new Error('no card box');
    const parts = card.locator('dt, dd');
    expect(await parts.count()).toBeGreaterThan(0);
    for (const part of await parts.all()) {
      const b = await part.boundingBox();
      if (!b) throw new Error('no part box');
      expect(b.x - box.x).toBeGreaterThanOrEqual(15);
      expect(b.y - box.y).toBeGreaterThanOrEqual(15);
      expect(box.x + box.width - (b.x + b.width)).toBeGreaterThanOrEqual(15);
      expect(box.y + box.height - (b.y + b.height)).toBeGreaterThanOrEqual(15);
    }
  }

  test('TC-70.1: at 1440 the card content is at least 16px inside every card edge', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectInset(page);
  });

  test('TC-70.2: at 390 the card content is still at least 16px inside every card edge', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectInset(page);
  });
});

// BR-56 and TC-7.4: the invitation pages sit in the app shell, with the active org's menu and no current item.
test.describe('BR-56: the menu on invitation pages', () => {
  const orgMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Organization menu' });
  const anyMenu = (page: Page): Locator => page.getByRole('navigation', { name: /menu$/ });
  const bar = (page: Page): Locator => page.getByRole('banner').first();
  const markedItems = (menu: Locator): Locator => menu.locator('[aria-current]');
  const LINK = `/invitations/${FOREIGN.invitationId}`;
  const UNAVAILABLE = '/invitations/not-an-invitation';
  const afterNow = async (page: Page): Promise<void> => page.clock.setFixedTime(new Date('2026-11-21T12:00:00.000Z'));

  /** Org A's menu is shown, no item is marked, and org B (the invitation's) is named in neither the menu nor the bar. */
  async function expectActiveOrgMenu(page: Page): Promise<void> {
    const menu = orgMenu(page);
    await expect(menu.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(markedItems(menu)).toHaveCount(0);
    await expect(menu).not.toContainText(FOREIGN.orgName);
    await expect(bar(page)).not.toContainText(FOREIGN.orgName);
  }

  test('TC-7.4: an org owner on /invitations has no menu item marked current', async ({ page }) => {
    await seedOnboarding(page, 'singleOrgTwoPending');
    await afterNow(page);
    await page.goto('/invitations');
    await expect(page.getByRole('heading', { level: 1, name: 'My invitations' })).toBeVisible();
    const menu = orgMenu(page);
    await expect(menu.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(markedItems(menu)).toHaveCount(0);
  });

  test("TC-56.1: org A's menu shows on /invitations and on the link page, with no current item and no org B name", async ({
    page,
  }) => {
    await seedShell(page, 'foreignInvite');
    await page.goto('/invitations');
    await expect(page.getByRole('heading', { level: 1, name: 'My invitations' })).toBeVisible();
    await expectActiveOrgMenu(page);
    await page.goto(LINK);
    await expect(page.getByRole('heading', { level: 1, name: `Join ${FOREIGN.orgName}` })).toBeVisible();
    await expectActiveOrgMenu(page);
  });

  test('TC-56.2: a failing read shows the error with Retry in the content and keeps the menu', async ({ page }) => {
    await seedShell(page, 'foreignInvite');
    await holdReads(page, { invitation: 'fail', myInvitations: 'fail' });
    for (const path of [LINK, '/invitations']) {
      await page.goto(path);
      const main = page.getByRole('main');
      await expect(main.getByText('Internal server error')).toBeVisible();
      await expect(main.getByRole('button', { name: 'Retry' })).toBeVisible();
      await expectActiveOrgMenu(page);
    }
  });

  test("TC-56.3: an unavailable link shows the message with org A's menu and no current item", async ({ page }) => {
    await seedShell(page, 'foreignInvite');
    await page.goto(UNAVAILABLE);
    await expect(page.getByRole('heading', { name: 'This invitation is not available' })).toBeVisible();
    await expectActiveOrgMenu(page);
  });

  test('TC-56.4: a person with no active org has no side menu on /invitations or an unavailable link', async ({
    page,
  }) => {
    await seedOnboarding(page, 'noOrgInvited');
    await afterNow(page);
    await page.goto('/invitations');
    await expect(page.getByRole('heading', { level: 1, name: 'My invitations' })).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
    await page.goto(UNAVAILABLE);
    await expect(page.getByRole('heading', { name: 'This invitation is not available' })).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
  });

  test('TC-56.5: a person whose active org is suspended has no side menu on any invitation page', async ({ page }) => {
    await seedShell(page, 'suspendedOnly');
    await holdReads(page, { invitation: 'fail' });
    await page.goto('/invitations');
    await expect(page.getByRole('heading', { level: 1, name: 'My invitations' })).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
    await page.goto(LINK);
    await expect(page.getByRole('main').getByText('Internal server error')).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
  });

  test('TC-56.6: a member of both orgs sees the active org menu with no current item on the link page', async ({
    page,
  }) => {
    await seedShell(page, 'memberInvite');
    await page.goto(LINK);
    await expect(page.getByRole('heading', { level: 1, name: 'Join Acme' })).toBeVisible();
    const menu = orgMenu(page);
    await expect(menu.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(markedItems(menu)).toHaveCount(0);
  });
});
