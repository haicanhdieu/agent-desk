import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  IDLE_RUN,
  INVOICER_API,
  ORG,
  PAUSED_RUN,
  SCROLLBACK_ENDED_RUN,
  SESSION_MOCK_NOW,
  STOPPED_RUN,
  TRANSCRIPT_RICH_RUN,
  runHeader,
  seedOnboarding,
  seedShell,
} from './mock';

/*
 * The phone run terminal (spec 2026-11-25-sidebar-navigation-shell-design.md "E2E requirements": BR-60, BR-66, BR-67,
 * BR-69; TC-60.1 to TC-60.3, TC-66.1 to TC-66.3, TC-67.1, TC-69.1 to TC-69.6). 390 wide with touch.
 *
 * Not provable here, and where it is proved instead:
 * - TC-69.1 and TC-69.2 "nothing typed reaches the run's terminal": the mock's fake terminal echoes any viewer and has
 *   no 4403, so this spec asserts the missing key row only. The real server refusal and the pod's input file are in
 *   `e2e/local/phone-terminal.spec.ts`; the frames are in `src/features/runs/phoneRun.route.test.tsx`.
 * - TC-69.5 "lost (reconnecting, then gave up)": the mock terminal cannot close abnormally on demand. The key row in those
 *   states is asserted by the route test (retrying, gave up) in `phoneRun.route.test.tsx`; this spec covers connecting.
 * - The on-screen keyboard (BR-60) has no desktop emulation: the visualViewport sizing is in the route test and the PR
 *   records the manual real-phone check.
 */
test.describe.configure({ timeout: 90_000 });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, timezoneId: 'UTC', locale: 'en-US' });

const KEY_NAMES = ['Esc', 'Tab', 'Left arrow', 'Up arrow', 'Down arrow', 'Right arrow', 'Ctrl-C', 'Enter'];
const runUrl = (number: number, org = ORG) => `/o/${org}/p/${INVOICER_API}/runs/${number}`;
const terminal = (page: Page) => page.getByRole('group', { name: 'Claude Code terminal' });
const keyRow = (page: Page) => page.getByRole('group', { name: 'Terminal keys' });
const keyButton = (page: Page, name: string) => keyRow(page).getByRole('button', { name, exact: true });

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

/** Waits for the live terminal's banner. */
async function liveTerminal(page: Page): Promise<Locator> {
  const t = terminal(page);
  await expect(t).toContainText('agent-desk fake terminal');
  return t;
}

/** How many prompt lines ("> ...") the terminal shows. */
const prompts = async (t: Locator): Promise<number> =>
  (await t.innerText()).split('\n').filter((line) => line.trim().startsWith('>')).length;

/** The accessible names of the buttons in the page header. */
async function headerActions(page: Page): Promise<string[]> {
  const names = await runHeader(page)
    .getByRole('button')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''));
  // The context panel's collapse button is a desktop-only control.
  return names.filter((n) => !n.startsWith('Collapse context panel'));
}

test.describe('BR-60: watch, type and run actions at 390', () => {
  test('TC-60.1: an org owner reads the live terminal and types a line with the phone keyboard', async ({ page }) => {
    await page.goto(runUrl(IDLE_RUN));
    const t = await liveTerminal(page);
    expect((await boxOf(t)).width).toBeGreaterThan(200);
    await t.tap();
    await page.keyboard.type('hello phone');
    await page.keyboard.press('Enter');
    await expect(t).toContainText('> hello phone');
    await expect.poll(() => prompts(t)).toBeGreaterThanOrEqual(2);
  });

  test('TC-60.1: a member on their own live run does the same', async ({ page }) => {
    await seedShell(page, 'memberOwnsRuns');
    await page.goto(runUrl(IDLE_RUN));
    const t = await liveTerminal(page);
    expect((await boxOf(t)).width).toBeGreaterThan(200);
    await t.tap();
    await page.keyboard.type('hello member');
    await page.keyboard.press('Enter');
    await expect(t).toContainText('> hello member');
  });

  test('TC-60.2: a member on their own live run has the desktop actions in the header, and Finish works', async ({
    page,
  }) => {
    await seedShell(page, 'memberOwnsRuns');
    await page.goto(runUrl(IDLE_RUN));
    await liveTerminal(page);
    const phone = await headerActions(page);
    expect(phone).toEqual(expect.arrayContaining(['Finish run', 'Stop session', 'Cancel run']));
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await headerActions(page)).toEqual(phone);
    await page.setViewportSize({ width: 390, height: 844 });
    await runHeader(page).getByRole('button', { name: 'Finish run' }).tap();
    await expect(runHeader(page).getByText('Succeeded', { exact: true })).toBeVisible();
  });

  test('TC-60.3: a viewer, then a member on another run, have no run actions at 390 or at 1440', async ({ page }) => {
    await seedShell(page, 'memberOthersRuns');
    await page.goto(runUrl(IDLE_RUN));
    await expect(runHeader(page).getByText('Needs you', { exact: true })).toBeVisible();
    const phone = await headerActions(page);
    expect(phone).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await headerActions(page)).toEqual(phone);
  });

  test('TC-60.3: a viewer has no run actions at 390 or at 1440', async ({ page }) => {
    await seedOnboarding(page, 'viewer');
    await page.goto(runUrl(IDLE_RUN, 'acme'));
    await expect(runHeader(page).getByText('Needs you', { exact: true })).toBeVisible();
    const phone = await headerActions(page);
    expect(phone).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await headerActions(page)).toEqual(phone);
  });
});

test.describe('BR-66: the extra keys row', () => {
  test('TC-66.1: the row sits under the terminal in order and wraps inside the window', async ({ page }) => {
    await page.goto(runUrl(IDLE_RUN));
    const t = await liveTerminal(page);
    const row = keyRow(page);
    await expect(row).toBeVisible();
    const buttons = row.getByRole('button');
    await expect(buttons).toHaveCount(KEY_NAMES.length);
    const names = await buttons.evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''),
    );
    expect(names).toEqual(KEY_NAMES);

    // Order on screen: reading order (top to bottom, then left to right) is the same as the order of the list.
    const boxes: Box[] = [];
    for (let i = 0; i < KEY_NAMES.length; i += 1) boxes.push(await boxOf(buttons.nth(i)));
    for (let i = 1; i < boxes.length; i += 1) {
      const [a, b] = [boxes[i - 1]!, boxes[i]!];
      expect(b.y > a.y + 1 || (Math.abs(b.y - a.y) <= 1 && b.x > a.x)).toBe(true);
    }
    // Inside the window, and under the terminal.
    for (const b of boxes) {
      expect(b.width).toBeGreaterThan(0);
      expect(b.x).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.width).toBeLessThanOrEqual(390 + 1);
    }
    expect((await boxOf(row)).y).toBeGreaterThanOrEqual((await boxOf(t)).y + (await boxOf(t)).height - 2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  });

  for (const width of [639, 640, 1023]) {
    test(`TC-66.2: the row shows at ${width} wide in the same order`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(runUrl(IDLE_RUN));
      await liveTerminal(page);
      const names = await keyRow(page)
        .getByRole('button')
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''));
      expect(names).toEqual(KEY_NAMES);
    });
  }

  test('TC-66.3: no row at 1024 wide', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 844 });
    await page.goto(runUrl(IDLE_RUN));
    await liveTerminal(page);
    await expect(keyRow(page)).toHaveCount(0);
  });
});

test.describe('BR-67: each key reaches the terminal once', () => {
  test('TC-67.1: typing a line then tapping Enter once shows exactly one new prompt, and focus stays in the terminal', async ({
    page,
  }) => {
    await page.goto(runUrl(IDLE_RUN));
    const t = await liveTerminal(page);
    await t.tap();
    await page.keyboard.type('one line');
    await expect(t).toContainText('> one line');
    const before = await prompts(t);
    await keyButton(page, 'Enter').tap();
    await expect.poll(() => prompts(t)).toBe(before + 1);
    // Still one more only: a double send would show a second prompt a moment later.
    await page.waitForTimeout(500);
    expect(await prompts(t)).toBe(before + 1);
    await expect(t.locator(':focus')).toHaveCount(1);
  });
});

test.describe('BR-69: no keys, no typing when not allowed or not live', () => {
  test('TC-69.1: a viewer on a live run has no key row', async ({ page }) => {
    await seedOnboarding(page, 'viewer');
    await page.goto(runUrl(IDLE_RUN, 'acme'));
    await expect(runHeader(page).getByText('Needs you', { exact: true })).toBeVisible();
    await liveTerminal(page);
    await expect(keyRow(page)).toHaveCount(0);
  });

  test("TC-69.2: a member on another user's live run has no key row", async ({ page }) => {
    await seedShell(page, 'memberOthersRuns');
    await page.goto(runUrl(IDLE_RUN));
    await expect(runHeader(page).getByText('Needs you', { exact: true })).toBeVisible();
    await liveTerminal(page);
    await expect(keyRow(page)).toHaveCount(0);
  });

  test('TC-69.3: a paused run shows its read-only notice, no key row, and typing does nothing', async ({ page }) => {
    await page.goto(runUrl(PAUSED_RUN));
    await expect(runHeader(page).getByText('Paused', { exact: true })).toBeVisible();
    await expect(page.getByRole('log', { name: 'Transcript of the agent conversation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    await expect(keyRow(page)).toHaveCount(0);
    await page.getByRole('main').click({ position: { x: 100, y: 400 } });
    await page.keyboard.type('qzxv');
    await expect(page.getByRole('main')).not.toContainText('qzxv');
  });

  test('TC-69.4: an ended run with final scrollback, and one with a transcript, have no key row', async ({ page }) => {
    await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
    await page.goto(runUrl(SCROLLBACK_ENDED_RUN));
    await expect(runHeader(page)).toBeVisible();
    await expect(page.getByRole('region', { name: /^(Terminal|Transcript)$/ })).toBeVisible();
    await expect(keyRow(page)).toHaveCount(0);
    await page.getByRole('main').click({ position: { x: 100, y: 400 } });
    await page.keyboard.type('qzxv');
    await expect(page.getByRole('main')).not.toContainText('qzxv');

    for (const run of [TRANSCRIPT_RICH_RUN, STOPPED_RUN]) {
      await page.goto(runUrl(run));
      await expect(page.getByRole('log', { name: 'Transcript of the agent conversation' })).toBeVisible();
      await expect(keyRow(page)).toHaveCount(0);
      await page.keyboard.type('qzxv');
      await expect(page.getByRole('main')).not.toContainText('qzxv');
    }
  });

  test('TC-69.5: no key row while the terminal is still connecting', async ({ page }) => {
    // Watches every DOM change: the row must never exist before the terminal has printed its banner.
    await page.addInitScript(() => {
      const w = window as unknown as { __keysEarly?: boolean };
      new MutationObserver(() => {
        const keys = document.querySelector('[aria-label="Terminal keys"]') !== null;
        const banner = document.body.innerText.includes('agent-desk fake terminal');
        if (keys && !banner) w.__keysEarly = true;
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await page.goto(runUrl(IDLE_RUN));
    await liveTerminal(page);
    await expect(keyRow(page)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __keysEarly?: boolean }).__keysEarly === true)).toBe(
      false,
    );
  });

  test('TC-69.6: no key row once the terminal was closed for inactivity', async ({ page }) => {
    await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
    await page.goto(runUrl(IDLE_RUN));
    await liveTerminal(page);
    await expect(keyRow(page)).toBeVisible();
    await page.clock.fastForward('04:00:05');
    await expect(page.getByText('Terminal closed for inactivity')).toBeVisible();
    await expect(keyRow(page)).toHaveCount(0);
    await page.keyboard.type('qzxv');
    await expect(page.getByRole('main')).not.toContainText('qzxv');
  });
});
