import { expect, test, type Locator, type Page } from '@playwright/test';
import { agentListId, ids } from '../../src/mocks/dto/ids';
import { INVITATIONS_MOCK_NOW } from '../../src/mocks/dto/invitations';
import { FOREIGN } from '../../src/mocks/msw/shellScenarios';
import {
  IDLE_RUN,
  INVOICER_API,
  NO_CREDENTIAL_RUN,
  ORG,
  PAUSED_RUN,
  SESSION_MOCK_NOW,
  TRANSCRIPT_TIMED_OUT_RUN,
  holdReads,
  seedAgents,
  seedOnboarding,
  seedPlatform,
  seedProjectSpace,
  seedShell,
  seedTenantAdmin,
  startSignedOut,
} from './mock';

/*
 * Phone and narrow-window layout (spec 2026-11-25-sidebar-navigation-shell-design.md "E2E requirements": TC-63.1,
 * TC-63.2, TC-64.1 to TC-64.3, TC-65.1, TC-65.23 to TC-65.27). Layout only: sizes and boxes, never the content of a page.
 *
 * `phoneLongNames` (shellScenarios.ts) is a platform admin with a long email, two orgs with long names and many
 * projects with long names.
 */
test.describe.configure({ timeout: 90_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US', hasTouch: true });

const ACME = 'b8000000-0000-4000-8000-000000000001';
const bar = (page: Page): Locator => page.getByRole('banner').first();

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error('an element has no box');
  return b;
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

/** Every visible control of the top bar lies inside the window and no two of them overlap. */
async function expectBarFits(page: Page, width: number): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const controls = bar(page).locator('a:visible, button:visible');
  const boxes: Box[] = [];
  for (let i = 0; i < (await controls.count()); i += 1) boxes.push(await boxOf(controls.nth(i)));
  expect(boxes.length).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.width).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.width).toBeLessThanOrEqual(width + 1);
  }
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
}

/** The switcher shows a readable name: some text, and a box wider than its padding. */
async function expectNamed(button: Locator): Promise<void> {
  await expect(button).toBeVisible();
  expect(((await button.innerText()).trim() || '').length).toBeGreaterThan(0);
  expect((await boxOf(button)).width).toBeGreaterThan(40);
}

/** Each switcher present in the bar, or the scope's plain name when it is not a button, is readable and non-empty. */
async function expectBarNamed(page: Page): Promise<void> {
  const switchers = bar(page).getByRole('button', { name: /^Switch (scope|project)/ });
  const count = await switchers.count();
  for (let i = 0; i < count; i += 1) await expectNamed(switchers.nth(i));
  if (count === 0) {
    const plain = bar(page).locator('[class*="plain"]').first();
    await expect(plain).toBeVisible();
    expect((await plain.innerText()).trim().length).toBeGreaterThan(0);
    expect((await boxOf(plain)).width).toBeGreaterThan(40);
  }
}

const inside = (b: Box, width: number, height: number): void => {
  expect(b.x).toBeGreaterThanOrEqual(16 - 1);
  expect(width - (b.x + b.width)).toBeGreaterThanOrEqual(16 - 1);
  expect(b.y).toBeGreaterThanOrEqual(-1);
  expect(b.y + b.height).toBeLessThanOrEqual(height + 1);
};

test.describe('BR-63: top bar from 390 to 1023', () => {
  test('TC-63.1: no overlap and a readable name at 390, 639, 640 and 1023', async ({ page }) => {
    await seedShell(page, 'phoneLongNames');
    const pages = [
      `/o/${ORG}/p/${INVOICER_API}/runs/${IDLE_RUN}`,
      `/o/${ORG}/p/${INVOICER_API}/runs`,
      `/o/${ORG}/settings/members`,
    ];
    for (const path of pages) {
      await page.goto(path);
      for (const width of [390, 639, 640, 1023]) {
        await page.setViewportSize({ width, height: 844 });
        await expectBarFits(page, width);
        await expectNamed(bar(page).getByRole('button', { name: /^Switch scope/ }));
        if (path.includes('/p/')) await expectNamed(bar(page).getByRole('button', { name: /^Switch project/ }));
      }
    }
  });

  test('TC-63.2: the platform org page and /invitations with no org fit at 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedPlatform(page, 'platformAdminOrgs');
    await page.goto(`/platform/orgs/${ACME}`);
    await expectBarFits(page, 390);
    await expectBarNamed(page);
  });

  test('TC-63.2: /invitations for a person with no org fits at 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedOnboarding(page, 'noOrgInvited');
    await page.goto('/invitations');
    await expectBarFits(page, 390);
    await expectBarNamed(page);
  });
});

test.describe('BR-64: popovers stay on screen at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('TC-64.1: the org switcher is inside the window and scrolls inside when long', async ({ page }) => {
    await seedShell(page, 'phoneLongNames');
    await page.goto(`/o/${ORG}/projects`);
    await page.evaluate(() => document.fonts.ready);
    await bar(page)
      .getByRole('button', { name: /^Switch scope/ })
      .click();
    const popover = page.getByRole('dialog', { name: 'Scope' });
    await expect(popover).toBeVisible();
    inside(await boxOf(popover), 390, 844);
    const links = popover.getByRole('link');
    const total = await links.count();
    expect(total).toBeGreaterThan(0);
    for (let i = 0; i < total; i += 1) {
      await links.nth(i).scrollIntoViewIfNeeded();
      await expect(links.nth(i)).toBeVisible();
      inside(await boxOf(popover), 390, 844);
    }
  });

  test('TC-64.2: the project switcher is inside the window and reaches All projects and New project', async ({
    page,
  }) => {
    await seedShell(page, 'phoneLongNames');
    await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
    await page.evaluate(() => document.fonts.ready);
    await bar(page)
      .getByRole('button', { name: /^Switch project/ })
      .click();
    const popover = page.getByRole('dialog', { name: 'Projects' });
    await expect(popover).toBeVisible();
    for (const name of ['All projects', 'New project']) {
      const link = popover.getByRole('link', { name });
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
    }
    inside(await boxOf(popover), 390, 844);
  });

  test('TC-64.3: the account menu is inside the window with a long email', async ({ page }) => {
    await seedShell(page, 'phoneLongNames');
    await page.goto(`/o/${ORG}/projects`);
    await page.evaluate(() => document.fonts.ready);
    await bar(page)
      .getByRole('button', { name: /^Account menu for / })
      .click();
    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu).toBeVisible();
    inside(await boxOf(menu), 390, 844);
  });
});

test.describe('BR-65: card tables', () => {
  test('TC-65.27: Members is a table at 640 and cards at 639 that keep each label and every row action', async ({
    page,
  }) => {
    await seedTenantAdmin(page, 'twoOwners');
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(`/o/${ORG}/settings/members`);
    const row = page.locator('tbody tr').first();
    await expect(row).toBeVisible();
    expect(await row.evaluate((el) => getComputedStyle(el).display)).toBe('table-row');
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();

    await page.setViewportSize({ width: 639, height: 900 });
    expect(await row.evaluate((el) => getComputedStyle(el).display)).toBe('block');
    // The header is only visually hidden: still there for a screen reader.
    await expect(page.getByRole('columnheader', { name: 'Name' })).toHaveCount(1);
    const labels = await row
      .locator('td[data-label]')
      .evaluateAll((cells) => cells.map((c) => getComputedStyle(c, '::before').content));
    expect(labels).toEqual(['"Name"', '"Access"']);
    await expect(row.getByRole('button', { name: /^Actions for / })).toBeVisible();
    const box = await boxOf(row);
    expect(box.x + box.width).toBeLessThanOrEqual(639 + 1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(1);
  });
});

/**
 * The page fits at `width`: the document and the page's main do not scroll sideways, and the main's content keeps a
 * 16px gutter on each side (the content, not the main's own box, which may run edge to edge).
 */
async function expectPageFits(page: Page, width: number): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(1);
  const main = page.getByRole('main').first();
  expect(await main.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  const content = main.locator('h1, h2, form, dl, input, a:visible, button:visible, [role="alert"]');
  const count = await content.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const b = await content.nth(i).boundingBox();
    if (!b) continue;
    expect(b.width).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThanOrEqual(16 - 1);
    expect(width - (b.x + b.width)).toBeGreaterThanOrEqual(16 - 1);
  }
}

test.describe('BR-65: entry, invitation and error pages at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('TC-65.1: sign-in is one column with "One ticket, two runs" below the block and no top bar', async ({
    page,
  }) => {
    await startSignedOut(page);
    await page.goto('/sign-in');
    const signIn = page.getByRole('link', { name: 'Sign in with GitHub' });
    await expect(signIn).toBeVisible();
    await signIn.scrollIntoViewIfNeeded();
    await expect(signIn).toBeEnabled();
    await expect(page.getByRole('banner')).toHaveCount(0);
    const kicker = page.getByText('One ticket, two runs', { exact: true });
    await kicker.scrollIntoViewIfNeeded();
    await expect(kicker).toBeVisible();
    expect((await boxOf(kicker)).y).toBeGreaterThan((await boxOf(signIn)).y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(1);
    for (const l of [signIn, kicker]) {
      const b = await boxOf(l);
      expect(b.x).toBeGreaterThanOrEqual(15);
      expect(b.x + b.width).toBeLessThanOrEqual(390 + 1);
    }
  });

  test('TC-65.23: create organization is one column with 16px gutters and the form submits', async ({ page }) => {
    await seedOnboarding(page, 'platformAdminNoOrg');
    await page.goto('/platform/orgs/new');
    await expect(page.getByRole('heading', { name: 'Create an organization', level: 1 })).toBeVisible();
    await expectPageFits(page, 390);
    const fieldBoxes: Box[] = [];
    for (const name of [/^Name/, /^URL/, /^First owner email/])
      fieldBoxes.push(await boxOf(page.getByRole('textbox', { name })));
    fieldBoxes.forEach((b, i) => {
      expect(Math.abs(b.x - fieldBoxes[0].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.width - fieldBoxes[0].width)).toBeLessThanOrEqual(1);
      if (i > 0) expect(b.y).toBeGreaterThanOrEqual(fieldBoxes[i - 1].y + fieldBoxes[i - 1].height - 1);
    });
    await page.getByRole('textbox', { name: /^Name/ }).fill('Phone Org');
    await page.getByRole('textbox', { name: /^URL/ }).fill('phone-org');
    await page.getByRole('textbox', { name: /^First owner email/ }).fill('owner@dev.local');
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByRole('heading', { name: 'Organization created' })).toBeVisible();
    await expectPageFits(page, 390);
  });

  test('TC-65.24: My invitations and the link page are one column and Accept and Decline are usable', async ({
    page,
  }) => {
    await seedOnboarding(page, 'noOrgInvited');
    await page.clock.setFixedTime(new Date(Date.parse(INVITATIONS_MOCK_NOW) - 60 * 60_000));
    await page.goto('/invitations');
    await expect(page.getByRole('heading', { level: 1, name: 'My invitations' })).toBeVisible();
    await expectPageFits(page, 390);
    await page.goto(`/invitations/b4000000-0000-4000-8000-${String(1).padStart(12, '0')}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Join Acme Robotics' })).toBeVisible();
    await expectPageFits(page, 390);
    const decline = page.getByRole('button', { name: 'Decline' });
    await expect(decline).toBeVisible();
    await expect(decline).toBeEnabled();
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page).not.toHaveURL(/\/invitations\//);
  });

  test('TC-65.25: forbidden, not-found, 500 and crash pages are one column with a usable control', async ({
    browser,
  }) => {
    const fresh = async (setup: (p: Page) => Promise<void>, path: string): Promise<Page> => {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        timezoneId: 'UTC',
        locale: 'en-US',
      });
      const p = await ctx.newPage();
      await setup(p);
      await p.goto(path);
      return p;
    };

    const forbidden = await fresh((p) => seedPlatform(p, 'ownerNoPlatform'), '/platform/orgs');
    await expect(forbidden.getByRole('heading', { name: "You don't have access", level: 1 })).toBeVisible();
    await expectPageFits(forbidden, 390);
    await forbidden.getByRole('link', { name: 'Go to projects' }).click();
    await expect(forbidden.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await forbidden.context().close();

    const missing = await fresh((p) => seedShell(p, 'foreignOrg'), `/o/${FOREIGN.orgSlug}/projects`);
    await expect(missing.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expectPageFits(missing, 390);
    await missing.getByRole('link', { name: 'Go to projects' }).click();
    await expect(missing.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await missing.context().close();

    const rules = `/o/${ORG}/p/${INVOICER_API}/desk/rules`;
    const failed = await fresh(async (p) => {
      await holdReads(p, { rules: 'fail' });
      await seedProjectSpace(p, { role: 'owner' });
    }, rules);
    const retry = failed.getByRole('main').getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    await expectPageFits(failed, 390);
    await retry.click();
    await expect(retry).toBeVisible();
    await failed.context().close();

    const crashed = await fresh(async (p) => {
      await holdReads(p, { rules: 'crash' });
      await seedProjectSpace(p, { role: 'owner' });
    }, rules);
    await expect(crashed.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    await expectPageFits(crashed, 390);
    const reload = crashed.getByRole('main').getByRole('button', { name: 'Reload' });
    await expect(reload).toBeEnabled();
    const rb = await boxOf(reload);
    // Not covered by anything: the element at its centre is the button itself.
    expect(
      await reload.evaluate((el, pt) => el.contains(document.elementFromPoint(pt.x, pt.y)), {
        x: rb.x + rb.width / 2,
        y: rb.y + rb.height / 2,
      }),
    ).toBe(true);
    await reload.click();
    await expect(crashed.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    await crashed.context().close();
  });

  test('TC-65.26: a suspended org page shows the message and the account menu, its way out, inside the window', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
    await seedShell(page, 'suspendedOnly');
    await page.goto(`/o/${ORG}/projects`);
    await expect(page.getByRole('heading', { name: 'This organization is suspended', level: 1 })).toBeVisible();
    await expectPageFits(page, 390);
    await bar(page)
      .getByRole('button', { name: /^Account menu for / })
      .click();
    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu).toBeVisible();
    inside(await boxOf(menu), 390, 844);
    await expect(menu.getByRole('menuitem', { name: 'Logout' })).toBeVisible();
  });
});

const TOKEN = 'sk-ant-oat01-e2e-not-a-real-token';
const CODEX_FILE = '{"tokens":{"access_token":"e2e-not-a-real-token"}}';
const ENDPOINT = 'https://llm.harbor-labs.com/v1';
const pickAgent = (page: Page, label: string) => page.getByRole('radio', { name: label, exact: true }).check();
const cont = (page: Page) => page.getByRole('button', { name: 'Continue', exact: true });
const heading = (page: Page, name: string) => page.getByRole('heading', { name, level: 1 });
const selectedTab = (page: Page) =>
  page.getByRole('tablist', { name: 'Agent and project settings' }).getByRole('tab', { selected: true });

/** The wizard's one column fits the window and each named control is inside it, enabled and not covered. */
async function expectUsable(page: Page, controls: Locator[]): Promise<void> {
  await expectPageFits(page, 390);
  for (const c of controls) {
    await c.scrollIntoViewIfNeeded();
    await expect(c).toBeVisible();
    await expect(c).toBeEnabled();
    const b = await boxOf(c);
    expect(b.x).toBeGreaterThanOrEqual(15);
    expect(390 - (b.x + b.width)).toBeGreaterThanOrEqual(15);
  }
}

/** Wizard step 1 (a new project) through the projects list, then Continue to the Agent step. */
async function toAgentStep(page: Page): Promise<void> {
  await page.goto(`/o/${ORG}/projects`);
  await page.getByRole('link', { name: 'New project' }).click();
  await expect(heading(page, 'Connect a repository')).toBeVisible();
  await expectPageFits(page, 390);
  await page.getByRole('radio', { name: 'dev/demo' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(heading(page, 'Add your agent')).toBeVisible();
}

test.describe('BR-65: Projects and the wizard at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('TC-65.2: project rows are cards with Resume setup before More, and New project is usable', async ({ page }) => {
    await seedShell(page, 'unfinishedProjects');
    await page.goto(`/o/${ORG}/projects`);
    await expect(page.getByRole('link', { name: 'invoicer-api', exact: true })).toBeVisible();
    await expectPageFits(page, 390);
    await expectUsable(page, [page.getByRole('link', { name: 'New project' })]);
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'invoicer-api', exact: true }) });
    expect(await row.evaluate((el) => getComputedStyle(el).display)).toBe('block');
    // name, repository, connection, counts and last run, in that order, each cell with its label.
    await expect(row.getByRole('link', { name: 'invoicer-api', exact: true })).toBeVisible();
    await expect(row.getByText('harbor-labs/invoicer-api', { exact: true })).toBeVisible();
    const labels = await row
      .locator('td[data-label]')
      .evaluateAll((cells) => cells.map((c) => getComputedStyle(c, '::before').content));
    expect(labels).toEqual(['"GitHub"', '"Needs you"', '"Running"', '"Queued"', '"Last run"']);
    const resume = row.getByRole('link', { name: 'Resume setup for invoicer-api' });
    const more = row.getByRole('button', { name: 'More for invoicer-api' });
    await expect(resume).toBeVisible();
    await expect(more).toBeVisible();
    const [rb, mb] = [await boxOf(resume), await boxOf(more)];
    expect(rb.x < mb.x || rb.y < mb.y).toBe(true);
    expect(overlaps(rb, mb)).toBe(false);
    await more.click();
    inside(await boxOf(page.getByRole('dialog', { name: 'Actions for invoicer-api' })), 390, 844);
  });

  test('TC-28.4: More, Agent & settings opens the Agents tab with no tab in the address', async ({ page }) => {
    await page.goto(`/o/${ORG}/projects`);
    await page.getByRole('button', { name: 'More for invoicer-api' }).click();
    await page
      .getByRole('dialog', { name: 'Actions for invoicer-api' })
      .getByRole('link', { name: 'Agent & settings' })
      .click();
    await expect(selectedTab(page)).toHaveText('Agents');
    await expect(page).toHaveURL(/\/desk\/agent$/);
  });

  test('TC-65.38: the card switch-to-polling link opens the GitHub connection tab', async ({ page }) => {
    await page.goto(`/o/${ORG}/projects`);
    const link = page.getByRole('link', { name: 'Switch to polling for docs-site' });
    await expectUsable(page, [link]);
    await link.click();
    await expect(selectedTab(page)).toHaveText('GitHub connection');
  });

  test('TC-65.3: the Agent step stacks its cards, wraps ten chips and every pick can be filled', async ({ page }) => {
    await toAgentStep(page);
    await page.evaluate(() => document.fonts.ready);
    const cards = ['Claude Code', 'OpenAI Codex', 'OpenCode'].map((n) =>
      page.getByRole('radio', { name: n, exact: true }),
    );
    const boxes = [];
    for (const c of cards) boxes.push(await boxOf(c.locator('xpath=ancestor::label[1]')));
    // Stacked: each card below the one before it, all the same left edge.
    expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
    expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height - 1);
    expect(Math.abs(boxes[0]!.x - boxes[2]!.x)).toBeLessThanOrEqual(1);
    const chips = page.getByRole('img', { name: /, coming soon$/ });
    await expect(chips).toHaveCount(10);
    // Wrapped: every chip lies inside the 16px gutters, and they take more than one line.
    const chipBoxes: Box[] = [];
    for (let i = 0; i < 10; i += 1) chipBoxes.push(await boxOf(chips.nth(i)));
    for (const b of chipBoxes) {
      expect(b.x).toBeGreaterThanOrEqual(16 - 1);
      expect(390 - (b.x + b.width)).toBeGreaterThanOrEqual(16 - 1);
    }
    expect(new Set(chipBoxes.map((b) => Math.round(b.y))).size).toBeGreaterThan(1);
    await expectPageFits(page, 390);

    await pickAgent(page, 'Claude Code');
    await page.getByRole('textbox', { name: 'Token' }).fill(TOKEN);
    await expectUsable(page, [page.getByRole('textbox', { name: 'Token' }), page.getByLabel('Default model')]);

    await pickAgent(page, 'OpenAI Codex');
    await expectPageFits(page, 390);
    await page.getByRole('textbox', { name: 'auth.json contents' }).fill(CODEX_FILE);
    await expectUsable(page, [page.getByRole('textbox', { name: 'auth.json contents' })]);

    await pickAgent(page, 'OpenCode');
    // The credential-type cards stack too: one left edge, each below the one before.
    const typeBoxes: Box[] = [];
    const typeRadios = page.getByRole('radiogroup', { name: 'Credential type' }).getByRole('radio');
    for (let i = 0; i < (await typeRadios.count()); i += 1)
      typeBoxes.push(await boxOf(typeRadios.nth(i).locator('xpath=ancestor::label[1]')));
    expect(typeBoxes.length).toBeGreaterThan(1);
    typeBoxes.forEach((b, i) => {
      expect(Math.abs(b.x - typeBoxes[0]!.x)).toBeLessThanOrEqual(1);
      if (i > 0) expect(b.y).toBeGreaterThan(typeBoxes[i - 1]!.y + typeBoxes[i - 1]!.height - 1);
    });
    await pickAgent(page, 'API endpoint and key');
    await page.getByRole('textbox', { name: 'API endpoint' }).fill(ENDPOINT);
    await page.getByRole('textbox', { name: 'API key' }).fill('e2e-not-a-real-key');
    await page.getByLabel('Model name').fill('qwen3-coder');
    await expectUsable(page, [
      page.getByRole('textbox', { name: 'API endpoint' }),
      page.getByRole('textbox', { name: 'API key' }),
      page.getByLabel('Model name'),
      page.getByRole('link', { name: 'Back' }),
      cont(page),
    ]);
    await cont(page).click();
    await expect(heading(page, 'Prepare the workspace')).toBeVisible();
  });

  test('TC-65.4: skill templates, Preview, Back, Skip and the commit button are usable', async ({ page }) => {
    await toAgentStep(page);
    await pickAgent(page, 'Claude Code');
    await page.getByRole('textbox', { name: 'Token' }).fill(TOKEN);
    await cont(page).click();
    await expect(heading(page, 'Prepare the workspace')).toBeVisible();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(heading(page, 'Start from skill templates')).toBeVisible();
    // Pick a template (a card to tick), then continue.
    const template = page.getByRole('checkbox').first();
    await template.check();
    await expectUsable(page, [
      template.locator('xpath=ancestor::label[1]'),
      page.getByRole('button', { name: /^Preview/ }).first(),
      page.getByRole('link', { name: 'Back' }),
      page.getByRole('button', { name: 'Skip' }),
      page.getByRole('button', { name: 'Commit 2 skills and continue' }),
    ]);
    await page.getByRole('button', { name: 'Commit 2 skills and continue' }).click();
    await expect(heading(page, 'Add your first rule')).toBeVisible();
  });

  test('TC-65.5: the rule step and the Ready step fit and Go to runs opens Runs', async ({ page }) => {
    await toAgentStep(page);
    await pickAgent(page, 'Claude Code');
    await page.getByRole('textbox', { name: 'Token' }).fill(TOKEN);
    await cont(page).click();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.getByRole('button', { name: 'Commit 2 skills and continue' }).click();
    await expect(heading(page, 'Add your first rule')).toBeVisible();
    const finish = page.getByRole('button', { name: 'Save rules and finish' });
    await expectUsable(page, [finish]);
    await finish.click();
    await expect(heading(page, 'Trigger your first run from GitHub')).toBeVisible();
    const goToRuns = page.getByRole('link', { name: 'Go to runs' });
    await expectUsable(page, [goToRuns]);
    await goToRuns.click();
    await expect(heading(page, 'Runs')).toBeVisible();
  });

  test('TC-65.33: the rejected banner and the wrapped footer fit, and Continue anyway opens step 3', async ({
    page,
  }) => {
    await seedAgents(page, 'testRejected');
    await toAgentStep(page);
    await pickAgent(page, 'OpenAI Codex');
    await page.getByRole('textbox', { name: 'auth.json contents' }).fill(CODEX_FILE);
    await cont(page).click();
    await expect(page.getByText('Credential rejected', { exact: true })).toBeVisible();
    await expect(heading(page, 'Add your agent')).toBeVisible();
    await expectUsable(page, [
      page.getByRole('link', { name: 'Back' }),
      cont(page),
      page.getByRole('button', { name: 'Continue anyway' }),
    ]);
    await page.getByRole('button', { name: 'Continue anyway' }).click();
    await expect(heading(page, 'Prepare the workspace')).toBeVisible();
  });
});

test.describe('BR-65: Runs at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('TC-65.6: the header wraps, search is full width, chips scroll in their own row and rows are cards', async ({
    page,
  }) => {
    await seedShell(page, 'memberOwnsRuns');
    await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
    await expect(heading(page, 'Runs')).toBeVisible();
    await expect(page.getByRole('table').first()).toBeVisible();
    await expectPageFits(page, 390);

    // Search is full width: the box spans the page's content width, on its own line above the grouping button.
    const search = page.getByRole('searchbox', { name: 'Search runs' });
    const grouped = page.getByRole('button', { name: 'Grouped by ticket' });
    const [sb, gb] = [await boxOf(search), await boxOf(grouped)];
    expect(sb.width).toBeGreaterThanOrEqual(390 - 2 * 16 - 1);
    expect(gb.y).toBeGreaterThanOrEqual(sb.y + sb.height - 1);
    await search.fill('a');
    await search.fill('');

    // Chips: one row that scrolls inside itself; the page does not widen.
    const chips = page.getByRole('group', { name: 'Filter by status' });
    const row = chips.locator('xpath=..');
    const chipBoxes = [];
    const chipButtons = row.getByRole('button');
    for (let i = 0; i < (await chipButtons.count()); i += 1) chipBoxes.push(await boxOf(chipButtons.nth(i)));
    expect(chipBoxes.length).toBeGreaterThan(4);
    for (const b of chipBoxes) expect(Math.abs(b.y - chipBoxes[0]!.y)).toBeLessThanOrEqual(1);
    expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await row.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
    await row.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    const last = row.getByRole('button', { name: /^Ignored/ });
    await expect(last).toBeVisible();
    inside(await boxOf(last), 390, 844);
    const needsYou = chips.getByRole('button', { name: /^Needs you/ });
    await needsYou.scrollIntoViewIfNeeded();
    await needsYou.click();
    await expect(needsYou).toHaveAttribute('aria-pressed', 'true');
    await chips.getByRole('button', { name: /^All/ }).scrollIntoViewIfNeeded();
    await chips.getByRole('button', { name: /^All/ }).click();
    await expectPageFits(page, 390);

    // Rows are cards: each run row is a block with labelled cells, and the run opens from its card.
    const card = page
      .locator('tbody tr')
      .filter({ has: page.getByRole('link', { name: /^Run \d+$/ }) })
      .first();
    expect(await card.evaluate((el) => getComputedStyle(el).display)).toBe('block');
    const labels = await card
      .locator('td[data-label]')
      .evaluateAll((cells) => cells.map((c) => getComputedStyle(c, '::before').content));
    expect(labels).toEqual(['"Status"', '"Ticket"', '"Rule"', '"Triggered by"', '"Started"', '"Duration"', '"Usage"']);
    const cb = await boxOf(card);
    expect(cb.x).toBeGreaterThanOrEqual(15);
    expect(390 - (cb.x + cb.width)).toBeGreaterThanOrEqual(15);
    await card.getByRole('link', { name: /^Run \d+$/ }).click();
    await expect(page).toHaveURL(/\/runs\/\d+$/);
  });
});

/**
 * The run page fits at 390: the document and the main do not scroll sideways, and every visible control of the page
 * (header, bar, key row, panel) lies inside the window with a real width. (The terminal bar and the key row run closer
 * to the edge than the 16px gutter of the other pages, so only the window is the bound here.)
 */
async function expectRunPageFits(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(1);
  const main = page.getByRole('main').first();
  expect(await main.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  const controls = main.locator('a:visible, button:visible');
  for (let i = 0; i < (await controls.count()); i += 1) {
    const b = await controls.nth(i).boundingBox();
    if (!b) continue;
    expect(b.width).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.width).toBeLessThanOrEqual(390 + 1);
  }
}

const runPath = (n: number) => `/o/${ORG}/p/${INVOICER_API}/runs/${n}`;
const runHeaderOf = (page: Page): Locator =>
  page.getByRole('main').getByRole('heading', { level: 1 }).locator('xpath=ancestor::header[1]');

test.describe('BR-65: the run page at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('TC-65.7: Details and back keep the same connected terminal; Find and a header action work', async ({
    page,
  }) => {
    await page.goto(runPath(IDLE_RUN));
    const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
    await expect(terminal).toContainText('agent-desk fake terminal');
    await terminal.tap();
    await page.keyboard.type('before details');
    await page.keyboard.press('Enter');
    await expect(terminal).toContainText('> before details');
    await expectRunPageFits(page);
    // The bar keeps its tools and its size; the page does not widen.
    await expect(page.getByRole('button', { name: 'Find' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy all' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Run view' })).toBeVisible();
    await expect(page.getByRole('main').getByText(/^\d+×\d+$/)).toBeVisible();

    const switcher = page.getByRole('radiogroup', { name: 'Run view switch' });
    await switcher.getByRole('radio', { name: 'Details' }).tap();
    const panel = page.getByRole('complementary', { name: 'Run context' });
    await expect(panel).toBeVisible();
    await expect(terminal).toBeHidden();
    await expectRunPageFits(page);
    await switcher.getByRole('radio', { name: 'Terminal' }).tap();
    await expect(terminal).toBeVisible();
    expect((await boxOf(terminal)).width).toBeGreaterThan(0);
    await expect(terminal).toContainText('> before details');
    await expect(page.getByText('Connection to the terminal lost')).toHaveCount(0);
    await expectRunPageFits(page);

    await page.getByRole('button', { name: 'Find' }).tap();
    await runHeaderOf(page).getByRole('button', { name: 'Stop session' }).tap();
    await expect(page.getByText('Session ending…')).toBeVisible();
    await expectRunPageFits(page);
  });

  test('TC-65.8: the Cancel run confirm is full width and its buttons work', async ({ page }) => {
    await page.goto(runPath(IDLE_RUN));
    await expect(page.getByRole('group', { name: 'Claude Code terminal' })).toContainText('agent-desk fake terminal');
    await runHeaderOf(page).getByRole('button', { name: 'Cancel run' }).tap();
    const confirm = page.getByRole('dialog', { name: /^Cancel run \d+\?$/ });
    await expect(confirm).toBeVisible();
    const b = await boxOf(confirm);
    expect(b.x).toBeGreaterThanOrEqual(16 - 1);
    expect(390 - (b.x + b.width)).toBeGreaterThanOrEqual(16 - 1);
    expect(b.width).toBeGreaterThanOrEqual(390 - 2 * 16 - 1);
    await expectRunPageFits(page);
    await confirm.getByRole('button', { name: 'Keep running' }).tap();
    await expect(confirm).toBeHidden();
    await runHeaderOf(page).getByRole('button', { name: 'Cancel run' }).tap();
    await confirm.getByRole('button', { name: 'Cancel run' }).tap();
    await expect(runHeaderOf(page).getByText('Cancelled', { exact: true })).toBeVisible();
  });

  test('TC-65.9: a paused run shows the read-only transcript and its notice actions; View PR is usable', async ({
    page,
  }) => {
    await page.goto(runPath(PAUSED_RUN));
    await expect(runHeaderOf(page).getByText('Paused', { exact: true })).toBeVisible();
    await expectRunPageFits(page);
    const area = page.getByRole('region', { name: /^(Terminal|Transcript)$/ });
    await expect(area.getByRole('button', { name: 'Resume' })).toBeEnabled();
    await expect(area.getByRole('button', { name: 'Finish' })).toBeEnabled();
    const view = runHeaderOf(page).getByRole('link', { name: /^View (PR|issue)$/ });
    await expect(view).toBeVisible();
    await expect(view).toHaveAttribute('href', /.+/);
    await expect(page.getByRole('radiogroup', { name: 'Run view switch' })).toBeVisible();
  });

  test('TC-65.37: the run agent name and the run links keep their targets from the Details view', async ({ page }) => {
    const settings = (p: Page) =>
      p.getByRole('tablist', { name: 'Agent and project settings' }).getByRole('tab', { selected: true });
    // "Change time limit" on a timed-out run, and the agent name in Details.
    await page.goto(runPath(TRANSCRIPT_TIMED_OUT_RUN));
    await page.getByRole('radiogroup', { name: 'Run view switch' }).getByRole('radio', { name: 'Details' }).tap();
    const panel = page.getByRole('complementary', { name: 'Run context' });
    await expect(panel.getByText('Agent', { exact: true })).toBeVisible();
    await expect(panel.getByText('Claude')).toBeVisible();
    await expectRunPageFits(page);
    await page.getByRole('radiogroup', { name: 'Run view switch' }).getByRole('radio', { name: 'Terminal' }).tap();
    await page.getByRole('link', { name: 'Change time limit' }).tap();
    await expect(page).toHaveURL(/\/desk\/agent\?tab=limits$/);
    await expect(settings(page)).toHaveText('Limits');
    await expectPageFits(page, 390);

    // "Replace credential" on a run that failed for a missing credential.
    await seedAgents(page, 'perAgentModels');
    await page.goto(runPath(NO_CREDENTIAL_RUN));
    await page.getByRole('radiogroup', { name: 'Run view switch' }).getByRole('radio', { name: 'Details' }).tap();
    await expect(page.getByRole('complementary', { name: 'Run context' }).getByText('Claude')).toBeVisible();
    await page.getByRole('radiogroup', { name: 'Run view switch' }).getByRole('radio', { name: 'Terminal' }).tap();
    await page.getByRole('link', { name: 'Replace credential' }).tap();
    await expect(page).toHaveURL(new RegExp(`/desk/agent\\?agent=${agentListId(1)}$`));
    await expect(page.getByRole('complementary', { name: 'Edit agent' })).toBeVisible();

    // "Connection details" and "Switch to polling" on a project's Runs, Ignored.
    const docsRuns = `/o/${ORG}/p/${ids.project.docsSite}/runs?filter=ignored`;
    for (const name of ['Connection details', 'Switch to polling']) {
      await page.goto(docsRuns);
      await page.getByRole('link', { name }).tap();
      await expect(page).toHaveURL(/\/desk\/agent\?tab=github$/);
      await expect(settings(page)).toHaveText('GitHub connection');
    }
  });
});

/*
 * Routing rules and Skills at 390 (TC-65.10, TC-65.11, TC-65.36, TC-83.1 to TC-83.3). Both pages fill the window: the
 * page itself never scrolls, the list, the pane body or the editor column does, so the fit also reads the scroll areas.
 */
const rulesPath = `/o/${ORG}/p/${INVOICER_API}/desk/rules`;
const skillsPath = `/o/${ORG}/p/${INVOICER_API}/desk/skills`;
/** Fixed clock of the run lines: the rules' last runs are on 12 Nov 2026. */
const RULES_NOW = new Date('2026-11-13T09:00:00.000Z');

const ruleButton = (page: Page, command: string): Locator =>
  page.getByRole('button', { name: `Edit rule /${command}` });
const ruleRowOf = (page: Page, command: string): Locator =>
  ruleButton(page, command).locator('xpath=ancestor::div[contains(@class, "ruleRow")][1]');
const runLineOf = (row: Locator): Locator => row.locator('[class*="stats"]');

/** The window does not scroll and nothing the page shows is wider than its scroll area. */
async function expectFillPageFits(page: Page, areas: Locator[]): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const doc = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  expect(doc.x).toBeLessThanOrEqual(1);
  expect(doc.y).toBeLessThanOrEqual(1);
  for (const area of areas) {
    await expect(area).toBeVisible();
    expect(await area.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
}

const paneOf = (page: Page, name: 'New rule' | 'Edit rule'): Locator => page.getByRole('complementary', { name });
const paneBodyOf = (pane: Locator): Locator => pane.locator('[class*="paneBody"]');

/** The pane is open in place of the list: full content width, footer reachable, the list hidden. */
async function expectPaneInPlaceOfList(page: Page, pane: Locator, width: number): Promise<void> {
  await expect(pane).toBeVisible();
  const box = await boxOf(pane);
  expect(box.x).toBeLessThanOrEqual(1);
  expect(box.width).toBeGreaterThanOrEqual(width - 1);
  await expect(page.getByRole('region', { name: 'Rules list' })).toBeHidden();
  for (const name of ['Close', 'Cancel', 'Save rule']) {
    const control = pane.getByRole('button', { name, exact: true });
    await control.scrollIntoViewIfNeeded();
    const b = await boxOf(control);
    expect(b.width).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.width).toBeLessThanOrEqual(width + 1);
    expect(b.y + b.height).toBeLessThanOrEqual(844 + 1);
  }
  await expectFillPageFits(page, [paneBodyOf(pane)]);
}

test.describe('BR-65: Routing rules at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('TC-65.10: the rule pane takes the place of the list; "With agent" and every footer button work', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await page.goto(rulesPath);
    await expect(heading(page, 'Routing rules')).toBeVisible();
    await expectFillPageFits(page, [page.getByRole('region', { name: 'Rules list' })]);

    await page.getByRole('button', { name: 'New rule' }).click();
    const created = paneOf(page, 'New rule');
    await expectPaneInPlaceOfList(page, created, 390);
    const agent = created.getByLabel('With agent');
    await agent.scrollIntoViewIfNeeded();
    await agent.selectOption({ label: 'Codex' });
    await expect(agent.locator('option:checked')).toHaveText('Codex');
    await created.getByRole('button', { name: 'Close' }).click();
    await expect(created).toBeHidden();
    await expect(page.getByRole('region', { name: 'Rules list' })).toBeVisible();

    await ruleButton(page, 'code-review').click();
    await expectPaneInPlaceOfList(page, paneOf(page, 'Edit rule'), 390);
    await expect(paneOf(page, 'Edit rule').getByRole('button', { name: 'Delete rule' })).toBeVisible();
  });

  test('TC-65.36: at 390 and 1023 the pane replaces the list and focus returns; at 1024 the list keeps a width', async ({
    page,
  }) => {
    await page.goto(rulesPath);
    await expect(heading(page, 'Routing rules')).toBeVisible();
    for (const width of [390, 1023]) {
      await page.setViewportSize({ width, height: 844 });
      await ruleButton(page, 'code-build').click();
      await expectPaneInPlaceOfList(page, paneOf(page, 'Edit rule'), width);
      await paneOf(page, 'Edit rule').getByRole('button', { name: 'Close' }).click();
      await expect(paneOf(page, 'Edit rule')).toBeHidden();
      await expect(ruleButton(page, 'code-build')).toBeFocused();
    }

    // 1024 with the side menu expanded: list and pane sit side by side, and the rows do not overlap.
    await page.setViewportSize({ width: 1024, height: 844 });
    const expand = page.getByRole('button', { name: 'Expand menu' });
    if (await expand.isVisible()) await expand.click();
    await expect(page.getByRole('button', { name: 'Collapse menu' })).toBeVisible();
    await ruleButton(page, 'code-build').click();
    await expect(paneOf(page, 'Edit rule')).toBeVisible();
    const list = page.getByRole('region', { name: 'Rules list' });
    await expect(list).toBeVisible();
    expect((await boxOf(list)).width).toBeGreaterThan(0);
    const commands = ['code-build', 'code-review', 'code-e2e'];
    const rows: Box[] = [];
    for (const command of commands) rows.push(await boxOf(ruleRowOf(page, command)));
    rows.forEach((a, i) => rows.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
    for (const command of commands) {
      const row = ruleRowOf(page, command);
      const parts = [
        row.getByRole('switch'),
        ruleButton(page, command),
        runLineOf(row),
        row.getByRole('button', { name: /^More actions/ }),
      ];
      const boxes: Box[] = [];
      for (const part of parts) boxes.push(await boxOf(part));
      boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
    }
    await paneOf(page, 'Edit rule').getByRole('button', { name: 'Close' }).click();
    await expect(paneOf(page, 'Edit rule')).toBeHidden();
  });
});

test.describe('BR-83: the run line on phone Routing rules', () => {
  /** Run lines of the rules of the first page, by command, read at the current width. */
  async function runLines(page: Page, commands: string[]): Promise<string[]> {
    const lines: string[] = [];
    for (const command of commands) lines.push((await runLineOf(ruleRowOf(page, command)).innerText()).trim());
    return lines;
  }
  const COMMANDS = ['code-build', 'code-review', 'code-e2e', 'docs-update', 'qa-e2e', 'triage'];

  test('TC-83.1: every rule shows at 390 the run line it shows at 1440, with runs and "Never ran"', async ({
    page,
  }) => {
    await page.clock.setFixedTime(RULES_NOW);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(rulesPath);
    await expect(heading(page, 'Routing rules')).toBeVisible();
    const wide = await runLines(page, COMMANDS);
    expect(wide.some((l) => /^\d+ runs? in 30 days/.test(l))).toBe(true);
    expect(wide).toContain('Never ran');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await runLines(page, COMMANDS)).toEqual(wide);
  });

  test('TC-83.2: each run line is inside the window, not cut off and clear of the rule text and controls', async ({
    page,
  }) => {
    await page.clock.setFixedTime(RULES_NOW);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(rulesPath);
    await expect(heading(page, 'Routing rules')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const command of COMMANDS) {
      const row = ruleRowOf(page, command);
      const line = runLineOf(row);
      await line.scrollIntoViewIfNeeded();
      const lineBox = await boxOf(line);
      expect(lineBox.width).toBeGreaterThan(0);
      expect(lineBox.x).toBeGreaterThanOrEqual(0);
      expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(390 + 1);
      expect(await line.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      expect(await line.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
      const rowBox = await boxOf(row);
      expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
      for (const other of [
        row.getByRole('switch'),
        ruleButton(page, command),
        row.getByRole('button', { name: /^More actions/ }),
      ])
        expect(overlaps(lineBox, await boxOf(other))).toBe(false);
    }
  });

  test('TC-83.3: "with <agent>", "with the project default agent" and the no-credential warning stay readable', async ({
    page,
  }) => {
    await page.clock.setFixedTime(RULES_NOW);
    await seedAgents(page, 'perAgentModels');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
    await expect(heading(page, 'Agent & settings')).toBeVisible();
    // The Given goes through the mock API route, as the rule form does; the link then reads the list fresh.
    await page.evaluate(
      async ({ projectId }) => {
        const base = `/api/projects/${projectId}`;
        const listed: { items: Array<{ id: string; name: string }> } = await (await fetch(`${base}/agents`)).json();
        for (const [command, name] of [
          ['with-work', 'Claude - Work'],
          ['with-new', 'Claude - New'],
        ] as const) {
          const agent = listed.items.find((a) => a.name === name);
          if (!agent) throw new Error(`agent ${name} not listed`);
          const res = await fetch(`${base}/rules`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              kind: 'skill',
              command,
              skillName: 'code-build',
              labelFilter: [],
              target: 'issue',
              enabled: true,
              agentId: agent.id,
            }),
          });
          if (!res.ok) throw new Error(`rule ${command}: ${res.status}`);
        }
      },
      { projectId: INVOICER_API },
    );
    await page.getByRole('link', { name: 'Routing rules' }).first().click();
    await expect(heading(page, 'Routing rules')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    await expect(ruleButton(page, 'with-work')).toContainText('with Claude - Work');
    await expect(ruleButton(page, 'qa-e2e')).toContainText('with the project default agent');
    const warned = ruleRowOf(page, 'with-new');
    await expect(warned).toContainText('Claude - New has no working credential. Runs from this rule will fail.');
    for (const command of ['with-work', 'qa-e2e', 'with-new']) {
      const row = ruleRowOf(page, command);
      await row.scrollIntoViewIfNeeded();
      const text = await boxOf(ruleButton(page, command));
      const line = await boxOf(runLineOf(row));
      for (const b of [text, line]) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(390 + 1);
      }
      expect(overlaps(text, line)).toBe(false);
    }
    const warning = warned.getByText('has no working credential');
    const warnBox = await boxOf(warning);
    expect(warnBox.x).toBeGreaterThanOrEqual(0);
    expect(warnBox.x + warnBox.width).toBeLessThanOrEqual(390 + 1);
    expect(overlaps(warnBox, await boxOf(runLineOf(warned)))).toBe(false);
    expect(overlaps(warnBox, await boxOf(ruleButton(page, 'with-new')))).toBe(false);
  });
});

test.describe('BR-65: Skills at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('TC-65.11: the list sits above a full-width editor; Edit, Preview, Diff and New skill are usable', async ({
    page,
  }) => {
    await page.goto(skillsPath);
    await expect(heading(page, 'Skills')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const list = page.getByRole('navigation', { name: 'Skills' });
    const editor = page.getByLabel('SKILL.md source');
    await expect(editor).toBeVisible();
    // The scroll areas of the page: the row holding list and editor, the list, the editor column and the commit bar.
    const skillsAreas = [
      page.locator('[class*="skillsRow"]'),
      list.locator('ul'),
      page.locator('[class*="skillsMain"]'),
      page.locator('[class*="commitBar"]'),
    ];
    const [listBox, editorBox] = [await boxOf(list), await boxOf(editor)];
    expect(editorBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height - 1);
    expect(editorBox.width).toBeGreaterThanOrEqual(390 - 2 * 16 - 1);
    // The list has a capped height and scrolls on its own.
    expect(listBox.height).toBeLessThanOrEqual(260);
    expect(await list.locator('ul').evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');

    const second = list.getByRole('link').nth(1);
    await second.scrollIntoViewIfNeeded();
    await second.click();
    await expect(second).toHaveAttribute('aria-current', 'page');
    const views = page.getByRole('radiogroup', { name: 'Editor view' });
    for (const view of ['Preview', 'Diff', 'Edit']) {
      await views.getByRole('radio', { name: view }).click();
      if (view === 'Edit') await expect(editor).toBeVisible();
      else {
        await expect(editor).toBeHidden();
        const shown = page.locator(view === 'Diff' ? '[class*="_diff_"]' : '[class*="_preview_"]').first();
        await expect(shown).toBeVisible();
        expect((await boxOf(shown)).width).toBeGreaterThanOrEqual(390 - 2 * 16 - 1);
      }
      await expectFillPageFits(page, skillsAreas);
    }
    const commit = page.getByRole('button', { name: 'Submit changes' });
    await commit.scrollIntoViewIfNeeded();
    const commitBox = await boxOf(commit);
    expect(commitBox.width).toBeGreaterThan(0);
    expect(commitBox.x).toBeGreaterThanOrEqual(-1);
    expect(commitBox.x + commitBox.width).toBeLessThanOrEqual(390 + 1);
    const message = page.getByRole('textbox', { name: 'Commit message' });
    expect((await boxOf(message)).width).toBeGreaterThanOrEqual(390 - 2 * 16 - 1);

    const create = page.getByRole('button', { name: 'New skill' });
    await create.scrollIntoViewIfNeeded();
    const createBox = await boxOf(create);
    expect(createBox.width).toBeGreaterThan(0);
    expect(createBox.x + createBox.width).toBeLessThanOrEqual(390 + 1);
    await create.click();
    await expect(editor).toBeVisible();
    expect((await boxOf(editor)).width).toBeGreaterThanOrEqual(390 - 2 * 16 - 1);
    await message.fill('Add a skill');
    await expect(message).toHaveValue('Add a skill');
    await expectFillPageFits(page, skillsAreas);
  });
});

/*
 * Agent & settings at 390 (TC-65.13, TC-65.28 to TC-65.32, TC-65.34, TC-65.35). The page fills the window: the page itself
 * never scrolls, the open tab's panel or the pane body does, so every fit check also reads the scroll areas. The scenario
 * `manyAgents` lists 30 agents; the shell scenario `phoneLongAgentName` lists 30 with the third named with 256 characters.
 */
const agentPath = `/o/${ORG}/p/${INVOICER_API}/desk/agent`;
const AGENT_TABS = ['Agents', 'GitHub connection', 'Limits', 'Danger zone'] as const;

const tabStrip = (page: Page): Locator => page.getByRole('tablist', { name: 'Agent and project settings' });
const agentTab = (page: Page, name: string): Locator => tabStrip(page).getByRole('tab', { name, exact: true });
const agentsList = (page: Page): Locator => page.getByRole('region', { name: 'Agents list' });
const agentRows = (page: Page): Locator => agentsList(page).getByRole('listitem');
const agentPaneOf = (page: Page, name: 'Add agent' | 'Edit agent'): Locator =>
  page.getByRole('complementary', { name });
const longNamed = (page: Page): Locator => agentRows(page).filter({ has: page.locator('[title^="Long agent-name-"]') });
const agentHeading = (page: Page): Locator => page.getByRole('heading', { level: 1, name: 'Agent & settings' });

async function openAgentPage(page: Page, search = ''): Promise<void> {
  await page.goto(`${agentPath}${search}`);
  await expect(agentHeading(page)).toBeVisible();
}

/** The scroll areas of a tab: the panel and the region inside it that holds the content. */
const tabAreas = (page: Page, name: string): Locator[] => [
  page.getByRole('tabpanel'),
  page.getByRole('region', { name: name === 'Agents' ? 'Agents list' : name, exact: true }),
];

/** The strip is one row: its tabs share a line, and the strip stays inside the window (it scrolls inside itself). */
async function expectStripOneRow(page: Page, width: number): Promise<void> {
  const strip = await boxOf(tabStrip(page));
  expect(strip.x).toBeGreaterThanOrEqual(-1);
  expect(strip.x + strip.width).toBeLessThanOrEqual(width + 1);
  const tabs = tabStrip(page).getByRole('tab');
  const ys: number[] = [];
  for (let i = 0; i < (await tabs.count()); i += 1) ys.push((await boxOf(tabs.nth(i))).y);
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(1);
}

/** Opens a tab from the strip, scrolling the strip sideways as a person would, and checks the fit. */
async function openTabFromStrip(page: Page, name: string): Promise<void> {
  const tab = agentTab(page, name);
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expectStripOneRow(page, 390);
  await expectFillPageFits(page, tabAreas(page, name));
}

/** "Save limits" stays pinned under the scrolling panel and inside the window; the save works. */
async function saveLimits(page: Page): Promise<void> {
  const idle = page.getByLabel('End idle runs after');
  await idle.scrollIntoViewIfNeeded();
  await idle.fill('90');
  const save = page.getByRole('button', { name: 'Save limits' });
  const [panel, button] = [await boxOf(page.getByRole('region', { name: 'Limits', exact: true })), await boxOf(save)];
  expect(button.y).toBeGreaterThanOrEqual(panel.y + panel.height - 1);
  expect(button.y + button.height).toBeLessThanOrEqual(844 + 1);
  expect(button.x + button.width).toBeLessThanOrEqual(390 + 1);
  await save.click();
  await expect(page.getByText('Limits saved')).toBeVisible();
}

/** The names of the controls a part of the page shows: boxed, not hidden (scroll areas still count). */
async function shownControls(roots: Locator[]): Promise<string[]> {
  const names = new Set<string>();
  for (const root of roots) {
    const found = await root.evaluate((el) => {
      const sel = 'button, a[href], [role="tab"], [role="radio"], input, select, textarea';
      const out: string[] = [];
      for (const node of Array.from(el.querySelectorAll(sel))) {
        const r = node.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || getComputedStyle(node).visibility === 'hidden') continue;
        const label = node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.textContent : null;
        const text =
          node.getAttribute('aria-label') ||
          (node as HTMLElement).innerText ||
          label ||
          node.getAttribute('placeholder') ||
          node.getAttribute('title') ||
          node.getAttribute('name') ||
          node.tagName.toLowerCase();
        out.push(text.trim().replace(/\s+/g, ' '));
      }
      return out;
    });
    for (const name of found) names.add(name);
  }
  return [...names].sort();
}

/** Fit rule: every control the same part shows at 1440 is also shown at 390, in the same state. */
async function expectPhoneKeepsControls(page: Page, roots: () => Locator[]): Promise<void> {
  const phone = await shownControls(roots());
  expect(phone.length).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(roots()[0]).toBeVisible();
  const desktop = await shownControls(roots());
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(roots()[0]).toBeVisible();
  expect(phone).toEqual(expect.arrayContaining(desktop));
}

/** Every visible part of a pane is reachable by scrolling its body and lies inside the window's width. */
async function expectPaneControlsReachable(pane: Locator, width: number): Promise<void> {
  const controls = pane.locator('input:visible, select:visible, textarea:visible, button:visible');
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    await control.scrollIntoViewIfNeeded();
    const b = await boxOf(control);
    expect(b.width).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.width).toBeLessThanOrEqual(width + 1);
    expect(b.y + b.height).toBeLessThanOrEqual(844 + 1);
  }
}

/** The pane is open in place of the list, under the heading and the strip, at the full content width. */
async function expectAgentPaneInPlaceOfList(page: Page, pane: Locator, width: number): Promise<void> {
  await expect(pane).toBeVisible();
  const [box, strip] = [await boxOf(pane), await boxOf(tabStrip(page))];
  expect(box.x).toBeLessThanOrEqual(1);
  expect(box.width).toBeGreaterThanOrEqual(width - 1);
  expect(box.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1);
  await expect(agentsList(page)).toBeHidden();
  await expect(agentHeading(page)).toBeVisible();
  await expectFillPageFits(page, [paneBodyOf(pane)]);
}

test.describe('BR-65: Agent & settings at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('TC-65.13: the four tabs open from a strip that scrolls inside itself; Save limits is pinned and Delete project is reachable', async ({
    page,
  }) => {
    await openAgentPage(page);
    await expect(tabStrip(page).getByRole('tab')).toHaveText([...AGENT_TABS]);
    await expectStripOneRow(page, 390);
    await expectFillPageFits(page, tabAreas(page, 'Agents'));
    for (const name of AGENT_TABS) {
      await openTabFromStrip(page, name);
      await expectPhoneKeepsControls(page, () => [tabStrip(page), page.getByRole('tabpanel')]);
    }

    await openTabFromStrip(page, 'Limits');
    const field = await boxOf(page.getByLabel('Run time limit', { exact: true }));
    const other = await boxOf(page.getByLabel('End idle runs after'));
    expect(other.y).toBeGreaterThan(field.y);
    expect(Math.abs(other.x - field.x)).toBeLessThanOrEqual(1);
    await saveLimits(page);

    await openTabFromStrip(page, 'Danger zone');
    const remove = page.getByRole('tabpanel').getByRole('button', { name: 'Delete project', exact: true });
    await remove.scrollIntoViewIfNeeded();
    const removeBox = await boxOf(remove);
    expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(390 + 1);
    await remove.click();
    const confirm = page.getByRole('dialog', { name: 'Delete project' });
    await expect(confirm).toBeVisible();
    expect((await boxOf(confirm)).width).toBeGreaterThanOrEqual(390 - 1);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
  });

  test('TC-65.28: a project admin reaches three tabs, no Danger zone, and the Limits save works', async ({ page }) => {
    await seedShell(page, 'adminP1ViewerP2');
    await openAgentPage(page);
    await expect(tabStrip(page).getByRole('tab')).toHaveText(['Agents', 'GitHub connection', 'Limits']);
    await expect(agentTab(page, 'Danger zone')).toHaveCount(0);
    for (const name of ['Agents', 'GitHub connection', 'Limits']) {
      await openTabFromStrip(page, name);
      await expectPhoneKeepsControls(page, () => [tabStrip(page), page.getByRole('tabpanel')]);
    }
    await saveLimits(page);
  });

  test('TC-65.29: stacked rows keep everything the 1440 rows show; the 256-character name, pager and row menu fit', async ({
    page,
  }) => {
    await seedShell(page, 'phoneLongAgentName');
    await openAgentPage(page);
    await expect(longNamed(page)).toHaveCount(1);
    await expectFillPageFits(page, tabAreas(page, 'Agents'));

    // "Add agent" is usable: enabled and inside the 16px gutters.
    const add = page.getByRole('button', { name: 'Add agent' });
    await add.scrollIntoViewIfNeeded();
    await expect(add).toBeEnabled();
    const addBox = await boxOf(add);
    expect(addBox.x).toBeGreaterThanOrEqual(16 - 1);
    expect(addBox.x + addBox.width).toBeLessThanOrEqual(390 - 16 + 1);
    expect(addBox.y).toBeGreaterThanOrEqual(-1);
    expect(addBox.y + addBox.height).toBeLessThanOrEqual(844 + 1);

    // Rows are stacked: the name, then the model, then the actions, one under the other and inside the window.
    const long = longNamed(page);
    await long.scrollIntoViewIfNeeded();
    const parts = [
      long.locator('[title^="Long agent-name-"]'),
      long.locator('.model'),
      long.getByRole('button', { name: /^Edit Long agent-name-/ }),
    ];
    const boxes: Box[] = [];
    for (const part of parts) boxes.push(await boxOf(part));
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height - 1);
    expect(boxes[2].y).toBeGreaterThan(boxes[1].y + boxes[1].height - 1);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.width).toBeLessThanOrEqual(390 + 1);
    }

    // Everything the rows show at 390 is what they show at 1440.
    await agentsList(page).evaluate((el) => el.scrollTo(0, 0));
    const phoneText = await agentRows(page).allInnerTexts();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(agentRows(page).first()).toBeVisible();
    expect(await agentRows(page).allInnerTexts()).toEqual(phoneText);
    await page.setViewportSize({ width: 390, height: 844 });

    // Next page and back.
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await pager.scrollIntoViewIfNeeded();
    const next = pager.getByRole('button', { name: 'Next' });
    const nextBox = await boxOf(next);
    expect(nextBox.x + nextBox.width).toBeLessThanOrEqual(390 + 1);
    expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(844 + 1);
    await next.click();
    await expect(agentRows(page)).toHaveCount(10);
    await expectFillPageFits(page, tabAreas(page, 'Agents'));
    await pager.getByRole('button', { name: 'Previous' }).click();
    await expect(agentRows(page)).toHaveCount(20);

    // The long-named agent's row menu: all three entries, inside the window.
    await long.scrollIntoViewIfNeeded();
    await long.getByRole('button', { name: /^Actions for Long agent-name-/ }).click();
    const menu = page.getByRole('dialog', { name: /^Actions for Long agent-name-/ });
    await expect(menu).toBeVisible();
    const menuBox = await boxOf(menu);
    expect(menuBox.x).toBeGreaterThanOrEqual(-1);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390 + 1);
    expect(menuBox.y).toBeGreaterThanOrEqual(-1);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(844 + 1);
    for (const entry of ['Test connection', 'Set as default', 'Delete']) {
      await expect(menu.getByRole('button', { name: entry, exact: true })).toBeVisible();
    }
  });

  test('TC-65.30: the delete dialog is full width with both buttons reachable and the agent leaves the list', async ({
    page,
  }) => {
    await seedAgents(page, 'manyAgents');
    await openAgentPage(page);
    await agentsList(page).getByRole('button', { name: 'Actions for Agent 02', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete agent Agent 02?' });
    await expect(dialog).toBeVisible();
    const box = await boxOf(dialog);
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(390 - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(844 + 1);
    for (const name of ['Keep agent', 'Delete agent']) {
      const b = await boxOf(dialog.getByRole('button', { name, exact: true }));
      expect(b.width).toBeGreaterThan(0);
      expect(b.x).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.width).toBeLessThanOrEqual(390 + 1);
    }
    await expectFillPageFits(page, tabAreas(page, 'Agents'));
    await expectPhoneKeepsControls(page, () => [dialog]);
    await dialog.getByRole('button', { name: 'Delete agent', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(agentsList(page).getByText('Agent 02', { exact: true })).toHaveCount(0);
  });

  test('TC-65.31: the OpenCode add pane takes the list place, keeps its title and footer, and saves the agent', async ({
    page,
  }) => {
    await openAgentPage(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = agentPaneOf(page, 'Add agent');
    await expectAgentPaneInPlaceOfList(page, pane, 390);
    await pane.getByRole('radio', { name: 'OpenCode', exact: true }).check();
    await pane.getByRole('radio', { name: 'API endpoint and key', exact: true }).click();
    await pane.getByLabel('Name', { exact: true }).fill('OpenCode - Phone');
    await pane.getByLabel('API endpoint', { exact: true }).fill('https://llm.harbor-labs.example/v1');
    await pane.getByLabel('API key', { exact: true }).fill('e2e-not-a-real-key');
    await expectPaneControlsReachable(pane, 390);
    await expectPhoneKeepsControls(page, () => [pane]);

    // The title and the footer stay put while the body scrolls.
    const title = pane.getByRole('heading', { level: 2, name: 'Add agent' });
    const save = pane.getByRole('button', { name: 'Save agent' });
    const [title0, save0] = [await boxOf(title), await boxOf(save)];
    await paneBodyOf(pane).evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect((await boxOf(title)).y).toBe(title0.y);
    expect((await boxOf(save)).y).toBe(save0.y);
    await expectFillPageFits(page, [paneBodyOf(pane)]);

    await save.click();
    await expect(pane).toBeHidden();
    await expect(agentsList(page).getByText('OpenCode - Phone', { exact: true })).toBeVisible();
  });

  test('TC-65.32: the edit pane takes the list place, every control is reachable, and the new name shows in the list', async ({
    page,
  }) => {
    await openAgentPage(page);
    await page.getByRole('button', { name: 'Edit Claude - Personal', exact: true }).click();
    const pane = agentPaneOf(page, 'Edit agent');
    await expectAgentPaneInPlaceOfList(page, pane, 390);
    await expectPaneControlsReachable(pane, 390);
    await expectPhoneKeepsControls(page, () => [pane]);
    const testButton = pane.getByRole('button', { name: 'Test connection', exact: true });
    await testButton.scrollIntoViewIfNeeded();
    expect((await boxOf(testButton)).width).toBeGreaterThan(0);
    await pane.getByLabel('Name', { exact: true }).fill('Claude - Phone');
    await pane.getByRole('button', { name: 'Save agent' }).click();
    await expect(pane).toBeHidden();
    await expect(agentsList(page).getByText('Claude - Phone', { exact: true })).toBeVisible();
  });

  test('TC-65.34: ?tab=danger opens with the Danger zone tab in view and the page not wider than the window', async ({
    page,
  }) => {
    await openAgentPage(page, '?tab=danger');
    const tab = agentTab(page, 'Danger zone');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    // In view without the person scrolling the strip: the tab lies inside the strip's visible box.
    await expect
      .poll(async () => {
        const [t, strip] = [await boxOf(tab), await boxOf(tabStrip(page))];
        return t.x >= strip.x - 1 && t.x + t.width <= strip.x + strip.width + 1;
      })
      .toBe(true);
    await expectFillPageFits(page, tabAreas(page, 'Danger zone'));
  });
});

test.describe('BR-65: the Agent & settings pane at 390, 1023 and 1024', () => {
  test('TC-65.35: below 1024 the pane replaces the list and Cancel returns focus; at 1024 the list and pane sit together', async ({
    page,
  }) => {
    await seedAgents(page, 'manyAgents');
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentPage(page);
    const edit = page.getByRole('button', { name: 'Edit Agent 02', exact: true });
    for (const width of [390, 1023]) {
      await page.setViewportSize({ width, height: 844 });
      await edit.scrollIntoViewIfNeeded();
      await edit.click();
      const pane = agentPaneOf(page, 'Edit agent');
      await expectAgentPaneInPlaceOfList(page, pane, width);
      const footer = pane.getByRole('button', { name: 'Save agent' });
      await footer.scrollIntoViewIfNeeded();
      expect((await boxOf(footer)).y + (await boxOf(footer)).height).toBeLessThanOrEqual(844 + 1);
      await pane.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(pane).toBeHidden();
      await expect(edit).toBeFocused();
    }

    // 1024 with the side menu expanded: menu, list and pane show together, the rows do not overlap.
    await page.setViewportSize({ width: 1024, height: 844 });
    const expand = page.getByRole('button', { name: 'Expand menu' });
    if (await expand.isVisible()) await expand.click();
    await expect(page.getByRole('button', { name: 'Collapse menu' })).toBeVisible();
    await edit.click();
    const pane = agentPaneOf(page, 'Edit agent');
    await expect(pane).toBeVisible();
    await expect(agentsList(page)).toBeVisible();
    expect((await boxOf(agentsList(page))).width).toBeGreaterThan(0);
    const rows: Box[] = [];
    for (let i = 0; i < 3; i += 1) rows.push(await boxOf(agentRows(page).nth(i)));
    rows.forEach((a, i) => rows.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
    const row = agentRows(page).nth(1);
    const rowParts: Box[] = [];
    for (const part of [
      row.getByRole('button', { name: /^Edit / }),
      row.getByRole('button', { name: /^Actions for / }),
    ]) {
      rowParts.push(await boxOf(part));
    }
    expect(overlaps(rowParts[0], rowParts[1])).toBe(false);
    await pane.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(pane).toBeHidden();
  });
});
