import { expect, test } from '@playwright/test';
import { IDLE_RUN, INVOICER_API, ORG, PAUSED_RUN, runHeader } from './mock';

// One viewport shorter than the old fixed 900 px shell and one taller, so neither a cut-off nor a gap passes.
const viewports = [
  { name: 'short', width: 1280, height: 600 },
  { name: 'tall', width: 1280, height: 1100 },
];

for (const vp of viewports) {
  test(`the run detail page fits the ${vp.name} viewport: no page scroll, terminal and side panel reach the bottom`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs/${PAUSED_RUN}`);

    const header = page.getByRole('banner');
    const runBar = runHeader(page);
    // A paused run with nothing saved shows the Transcript area (BR-49), so the pane is named Transcript.
    const terminal = page.getByRole('region', { name: /^(Terminal|Transcript)$/ });
    const side = page.getByRole('complementary', { name: 'Run context' });
    await expect(header).toBeVisible();
    await expect(terminal).toBeVisible();
    await expect(side).toBeVisible();

    const box = async (loc: typeof terminal) => {
      const b = await loc.boundingBox();
      if (!b) throw new Error('the element has no box');
      return b;
    };
    const bar = await box(header);
    const runBarBox = await box(runBar);
    const term = await box(terminal);
    const panel = await box(side);

    // The page itself does not scroll: the shell is exactly the viewport.
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollHeight,
      inner: window.innerHeight,
    }));
    expect(overflow.scroll).toBe(overflow.inner);

    // The top bar stays at the top; the terminal and the side panel sit under it and end at the viewport's bottom.
    expect(bar.y).toBe(0);
    expect(runBarBox.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    expect(term.y).toBeGreaterThanOrEqual(runBarBox.y + runBarBox.height);
    expect(Math.round(term.y + term.height)).toBe(vp.height);
    expect(Math.round(panel.y + panel.height)).toBe(vp.height);
    expect(panel.y).toBeGreaterThanOrEqual(runBarBox.y + runBarBox.height);
  });
}

test('the side panel scrolls on its own when its content is taller than the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs/${PAUSED_RUN}`);
  const side = page.getByRole('complementary', { name: 'Run context' });
  await expect(side).toBeVisible();

  const before = await side.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  expect(before.overflowY).toBe('auto');

  await side.evaluate((el) => el.scrollTo(0, 120));
  expect(await side.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  // Only the panel moved: the page did not scroll and the top bar stays put.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect((await page.getByRole('banner').boundingBox())?.y).toBe(0);
});

test('a live terminal is not cut off at the bottom of a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs/${IDLE_RUN}`);
  const live = page.getByRole('group', { name: 'Claude Code terminal' });
  await expect(live).toBeVisible();

  const box = await live.boundingBox();
  if (!box) throw new Error('the terminal has no box');
  expect(box.height).toBeGreaterThan(0);
  expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(500);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(500);
});
