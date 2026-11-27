import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerRequest, INVOICER_API, ORG, seedAgents } from './mock';

/*
 * BR-61: Agent & settings fits the window and only the active tab's panel scrolls. Layout is asserted from boxes and
 * scroll positions only (model: rules-layout.spec.ts). The window is 1280x420, so every tab overflows; the scenario
 * `manyAgents` lists more agents than one page.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const AGENT = `/o/${ORG}/p/${INVOICER_API}/desk/agent`;

const pageScroll = (page: Page) =>
  page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));

const box = async (loc: Locator) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error('the element has no box');
  return b;
};

const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Agent and project settings' }).getByRole('tab', { name, exact: true });
const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Agent & settings' });
const pager = (page: Page) => page.getByRole('navigation', { name: 'Pagination' });
const panel = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function open(page: Page, height: number, search = ''): Promise<void> {
  await seedAgents(page, 'manyAgents');
  await page.setViewportSize({ width: 1280, height });
  await page.goto(`${AGENT}${search}`);
  await expect(heading(page)).toBeVisible();
}

/** The page does not scroll and the top bar sits at the top of the window. */
async function expectPageFits(page: Page): Promise<void> {
  const o = await pageScroll(page);
  expect(o.scroll).toBe(o.inner);
  expect((await box(page.getByRole('banner'))).y).toBe(0);
}

/** The column itself does not scroll at this height: only the open tab's panel does. */
async function expectColumnFits(page: Page): Promise<void> {
  const main = page.locator('main').filter({ has: heading(page) });
  const o = await main.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, top: el.scrollTop }));
  expect(o.scroll).toBe(o.client);
  expect(o.top).toBe(0);
}

/** Scrolls the panel; returns how far it went. The page and the window stay where they are. */
async function scrollPanel(page: Page, scroller: Locator): Promise<number> {
  await scroller.evaluate((el) => el.scrollTo(0, 300));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  return scroller.evaluate((el) => el.scrollTop);
}

test('TC-61.1: the Agents rows scroll under a fixed top bar, heading, tab strip and pager', async ({ page }) => {
  await open(page, 420);
  const list = panel(page, 'Agents list');
  const first = list.getByRole('listitem').first();
  await expect(first).toBeVisible();
  await expectPageFits(page);

  // Both help lines stay in the window (visible, not hidden to make room).
  await expect(
    page.getByText('Configure the agent runtimes and accounts available to this project.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('The default agent runs a command when its routing rule does not pick an agent.', { exact: true }),
  ).toBeVisible();

  const h0 = await box(heading(page));
  const t0 = await box(tab(page, 'Agents'));
  const p0 = await box(pager(page));
  const row0 = await box(first);
  const area = await box(list);
  // The pager sits under the scroll area.
  expect(p0.y).toBeGreaterThanOrEqual(area.y + area.height - 1);
  // ...and inside the window.
  expect(p0.y + p0.height).toBeLessThanOrEqual(420);
  await expectColumnFits(page);

  expect(await scrollPanel(page, list)).toBeGreaterThan(0);
  expect((await box(first)).y).toBeLessThan(row0.y);
  expect((await box(heading(page))).y).toBe(h0.y);
  expect((await box(tab(page, 'Agents'))).y).toBe(t0.y);
  expect((await box(pager(page))).y).toBe(p0.y);
  await expectPageFits(page);
  await expectColumnFits(page);
});

test('TC-61.2: the Add agent pane keeps its title and Save agent while its body scrolls', async ({ page }) => {
  await open(page, 420);
  await page.getByRole('button', { name: 'Add agent' }).click();
  const pane = page.getByRole('complementary', { name: 'Add agent' });
  await pane.getByRole('radio', { name: 'Claude Code' }).click();
  const title = pane.getByRole('heading', { level: 2, name: 'Add agent' });
  const save = pane.getByRole('button', { name: 'Save agent' });
  await expect(save).toBeVisible();
  await expectPageFits(page);

  const title0 = await box(title);
  const save0 = await box(save);
  expect(title0.y).toBeGreaterThanOrEqual(0);
  expect(save0.y + save0.height).toBeLessThanOrEqual(420);

  const scroller = await pane.evaluateHandle((el) => {
    const found = Array.from(el.querySelectorAll<HTMLElement>('*')).find(
      (n) => getComputedStyle(n).overflowY === 'auto' && n.scrollHeight > n.clientHeight,
    );
    return found ?? null;
  });
  const scrollerEl = scroller.asElement();
  if (!scrollerEl) throw new Error('the pane has no scrolling body');
  await scrollerEl.evaluate((el) => el.scrollTo(0, 300));
  expect(await scrollerEl.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect((await box(title)).y).toBe(title0.y);
  expect((await box(save)).y).toBe(save0.y);
});

test('TC-61.3: Save limits stays pinned while the Limits panel scrolls', async ({ page }) => {
  await open(page, 420);
  await tab(page, 'Limits').click();
  const area = panel(page, 'Limits');
  const save = page.getByRole('button', { name: 'Save limits' });
  await expect(save).toBeVisible();
  await expectPageFits(page);

  const save0 = await box(save);
  const areaBox = await box(area);
  expect(save0.y).toBeGreaterThanOrEqual(areaBox.y + areaBox.height - 1);
  expect(save0.y + save0.height).toBeLessThanOrEqual(420);
  expect(await scrollPanel(page, area)).toBeGreaterThan(0);
  expect((await box(save)).y).toBe(save0.y);
  await expectPageFits(page);
  await expectColumnFits(page);

  // A field the form refuses: its message sits in the scrolling panel, "Save limits" stays.
  await area.evaluate((el) => el.scrollTo(0, 0));
  await page.getByLabel('End idle runs after').fill('2');
  await save.click();
  await expect(page.getByText('Idle runs must end after between 5 minutes and 7 days').first()).toBeVisible();
  await expectColumnFits(page);
  const save1 = await box(save);
  expect(save1.y + save1.height).toBeLessThanOrEqual(420);
  expect(await scrollPanel(page, area)).toBeGreaterThan(0);
  expect((await box(save)).y).toBe(save1.y);
  await expectPageFits(page);
  await expectColumnFits(page);
});

test('TC-314: Save limits aligns with the settings grid, not the page edge', async ({ page }) => {
  await open(page, 900);
  await tab(page, 'Limits').click();
  const label = box(page.getByText('Run time limit', { exact: true }));
  const save = box(page.getByRole('button', { name: 'Save limits' }));
  const area = box(panel(page, 'Limits'));
  expect((await save).x).toBeCloseTo((await label).x, 0);
  expect((await save).y).toBeGreaterThanOrEqual((await area).y + (await area).height - 1);
  await expectPageFits(page);
});

test('TC-314: at a narrow width the intro stacks and Save limits aligns with the form', async ({ page }) => {
  await seedAgents(page, 'manyAgents');
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto(AGENT);
  await expect(heading(page)).toBeVisible();
  await tab(page, 'Limits').click();
  const intro = box(page.getByRole('heading', { level: 2, name: 'Limits' }));
  const label = box(page.getByText('Run time limit', { exact: true }));
  const save = box(page.getByRole('button', { name: 'Save limits' }));
  expect((await intro).y + (await intro).height).toBeLessThanOrEqual((await label).y);
  expect((await save).x).toBeCloseTo((await label).x, 0);
  await expectPageFits(page);
});

test('TC-61.3: the error banner of a refused save stays pinned with Save limits while the panel scrolls', async ({
  page,
}) => {
  // The save is refused by the server (500): the form shows its error banner.
  await answerRequest(page, {
    method: 'PATCH',
    path: '/api/projects/',
    times: 1,
    problem: { status: 409, title: 'Conflict', detail: 'Limits cannot be saved right now. Try again.' },
  });
  await open(page, 420);
  await tab(page, 'Limits').click();
  const area = panel(page, 'Limits');
  const save = page.getByRole('button', { name: 'Save limits' });
  await page.getByLabel('End idle runs after').fill('45');
  await save.click();
  const banner = page.getByRole('alert').filter({ hasText: 'Limits cannot be saved right now. Try again.' });
  await expect(banner).toBeVisible();
  await expectColumnFits(page);
  // Web fonts change text metrics when they finish loading: take the baseline boxes only after that.
  await expect.poll(() => page.evaluate(async () => (await document.fonts.ready).status)).toBe('loaded');
  // Let the layout settle after the banner appears (the Save button's box stops moving).
  let last = -1;
  await expect
    .poll(async () => {
      const y = (await box(save)).y;
      const same = y === last;
      last = y;
      return same;
    })
    .toBe(true);

  const save0 = await box(save);
  const banner0 = await box(banner);
  expect(save0.y + save0.height).toBeLessThanOrEqual(420);
  // The banner is pinned: it sits outside the scrolling panel, next to "Save limits".
  const areaBox = await box(area);
  expect(banner0.y).toBeGreaterThanOrEqual(areaBox.y + areaBox.height - 1);
  expect(await scrollPanel(page, area)).toBeGreaterThan(0);
  expect((await box(save)).y).toBe(save0.y);
  expect((await box(banner)).y).toBe(banner0.y);
  await expectPageFits(page);
  await expectColumnFits(page);
});

// At 420 px the GitHub connection panel always overflows. The Danger zone panel holds one short card and fits, so it
// has no scroll range to prove: it must stay at 0 (an unscrollable panel moves nothing) while the rest stays put.
for (const [name, overflows] of [
  ['GitHub connection', true],
  ['Danger zone', false],
] as const) {
  test(`TC-61.4: only the ${name} panel scrolls`, async ({ page }) => {
    await open(page, 420);
    await tab(page, name).click();
    const area = panel(page, name);
    await expect(area).toBeVisible();
    await expectPageFits(page);
    const h0 = await box(heading(page));
    const t0 = await box(tab(page, name));
    await expectColumnFits(page);
    // Whatever the panel scrolls, it scrolls inside itself: the heading, the tab strip, the column and the page stay.
    const range = await area.evaluate((el) => el.scrollHeight - el.clientHeight);
    const moved = await scrollPanel(page, area);
    if (overflows) {
      expect(range).toBeGreaterThan(0);
      expect(moved).toBeGreaterThan(0);
    } else {
      expect({ range, moved }).toEqual({ range: 0, moved: 0 });
    }
    expect((await box(heading(page))).y).toBe(h0.y);
    expect((await box(tab(page, name))).y).toBe(t0.y);
    await expectPageFits(page);
    await expectColumnFits(page);
  });
}

for (const name of ['Agents list', 'Limits', 'GitHub connection']) {
  test(`TC-61.5: Tab reaches the ${name} panel and PageDown scrolls it`, async ({ page }) => {
    await open(page, 420);
    if (name !== 'Agents list') await tab(page, name).click();
    const area = panel(page, name);
    await expect(area).toBeVisible();
    await expect(area).toHaveAttribute('tabindex', '0');
    await tab(page, name === 'Agents list' ? 'Agents' : name).focus();
    for (let presses = 0; presses < 12; presses += 1) {
      if (await area.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(area).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect.poll(() => area.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  });
}

test.describe('TC-61.6: a 240 px window keeps a scroll area of at least 120 px and reaches the last control', () => {
  const cases: { tab: string; area: string; last: (page: Page) => Locator }[] = [
    { tab: 'Agents', area: 'Agents list', last: (page) => pager(page) },
    { tab: 'Limits', area: 'Limits', last: (page) => page.getByRole('button', { name: 'Save limits' }) },
    {
      tab: 'GitHub connection',
      area: 'GitHub connection',
      last: (page) => page.getByRole('region', { name: 'GitHub connection' }).locator('dd').last(),
    },
    { tab: 'Danger zone', area: 'Danger zone', last: (page) => page.getByRole('button', { name: 'Delete project' }) },
  ];
  for (const c of cases) {
    test(c.tab, async ({ page }) => {
      await open(page, 240);
      if (c.tab !== 'Agents') await tab(page, c.tab).click();
      const area = panel(page, c.area);
      await expect(area).toBeVisible();
      expect((await box(area)).height).toBeGreaterThanOrEqual(120);
      // Scroll the way a person does: the wheel over a part of the page that is in the window. At 240 px the area's
      // centre is below the window, so first the column (over the tab strip), then the area (now in view).
      const strip = await box(page.getByRole('tablist', { name: 'Agent and project settings' }));
      await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
      for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 400);
      const a = await box(area);
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 400);
      await expect(c.last(page).first()).toBeInViewport();
    });
  }
});
