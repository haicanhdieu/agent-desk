import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { API, FAKE_STATE_DIR, podInput, runOf, waitForStatus, runHeader } from './helpers';
import { buildCast, disposeCast, type Actor, type Cast } from './rbac-cast';

/*
 * The phone run terminal on the real localhost stack and the fake pod (spec 2026-11-25-sidebar-navigation-shell-design.md
 * "E2E requirements": BR-60, BR-67, BR-69; TC-60.1, TC-60.2, TC-67.2, TC-67.3, TC-67.4, TC-69.1, TC-69.2). The cast's
 * B is a member who owns RB (P1) and has no ownership of RC; V is the org viewer. Every case runs in a fresh org
 * (`buildCast`), at 390 wide. What the run's terminal receives is read from the fake pod's `input` file
 * (`<FAKE_STATE_DIR>/kube/run-<id>/input`, written by `attachSession` in packages/core/src/kube/fake-gateway.ts).
 *
 * The cast's browser contexts have no touch, so a key is pressed with `click()`: the same pointer and click events the
 * button handles on a tap. Touch-only layout is covered by the mock `phone-terminal.spec.ts`.
 */
test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

let cast: Cast;
let built: Cast | undefined;

test.beforeEach(async ({ browser }) => {
  built = undefined;
  built = await buildCast(browser);
  cast = built;
});

test.afterEach(async () => {
  const done = built;
  built = undefined;
  if (done) await disposeCast(done);
});

const PHONE = { width: 390, height: 844 };
const KEY_NAMES = ['Esc', 'Tab', 'Left arrow', 'Up arrow', 'Down arrow', 'Right arrow', 'Ctrl-C', 'Enter'];

async function openRun(who: Actor, runId: string): Promise<Page> {
  const run = await runOf(who.page, runId);
  await who.page.setViewportSize(PHONE);
  await who.page.goto(`/o/${cast.slug}/p/${cast.p1}/runs/${run.number}`);
  return who.page;
}

const terminal = (page: Page) => page.getByRole('group', { name: 'Claude Code terminal' });
const keyRow = (page: Page) => page.getByRole('group', { name: 'Terminal keys' });
const key = (page: Page, name: string) => keyRow(page).getByRole('button', { name, exact: true });

/** The terminal is attached: its row of keys shows only once the socket is open. */
async function attached(page: Page): Promise<Locator> {
  await expect(terminal(page)).toBeVisible();
  await expect(keyRow(page)).toBeVisible();
  return keyRow(page);
}

/** Whether the pod's screen last put the terminal in application cursor mode (DECCKM: `ESC [ ? 1 h`, off with `l`). */
async function applicationCursor(runId: string): Promise<boolean> {
  const pane = await readFile(`${FAKE_STATE_DIR}/kube/run-${runId}/pane`, 'latin1').catch(() => '');
  const on = pane.lastIndexOf('\x1b[?1h');
  const off = pane.lastIndexOf('\x1b[?1l');
  return on > off;
}

test('TC-60.1: a member types a line on their own live run at 390 and the pod receives it', async () => {
  const page = await openRun(cast.b, cast.rb);
  await attached(page);
  const before = await podInput(cast.rb);
  await terminal(page).click();
  await page.keyboard.type('hello phone');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await podInput(cast.rb)).slice(before.length)).toBe('hello phone\r');
});

test('TC-60.2: a member uses a header action at 390 and the run status changes as on desktop', async () => {
  const page = await openRun(cast.b, cast.rb);
  await attached(page);
  const phone = await runHeader(page)
    .getByRole('button')
    .evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ''));
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktop = await runHeader(page)
    .getByRole('button')
    .evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ''));
  expect(phone.filter(Boolean)).toEqual(desktop.filter(Boolean));
  await page.setViewportSize(PHONE);
  await runHeader(page).getByRole('button', { name: 'Finish run' }).click();
  await waitForStatus(page, cast.rb, 'succeeded');
  await expect(runHeader(page).getByText('Succeeded', { exact: true })).toBeVisible();
});

test('TC-67.2: each key in the BR-66 order reaches the pod once, as its bytes', async () => {
  const page = await openRun(cast.b, cast.rb);
  await attached(page);
  const names = await keyRow(page)
    .getByRole('button')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''));
  expect(names).toEqual(KEY_NAMES);
  const before = await podInput(cast.rb);
  const app = await applicationCursor(cast.rb);
  const arrows = app ? ['\x1bOD', '\x1bOA', '\x1bOB', '\x1bOC'] : ['\x1b[D', '\x1b[A', '\x1b[B', '\x1b[C'];
  const expected = ['\x1b', '\t', ...arrows, '\x03', '\r'].join('');
  for (const name of KEY_NAMES) await key(page, name).click();
  await expect.poll(async () => (await podInput(cast.rb)).slice(before.length)).toBe(expected);
  // Nothing more arrives afterwards (each key once).
  await page.waitForTimeout(1_000);
  expect((await podInput(cast.rb)).slice(before.length)).toBe(expected);
});

test('TC-67.3: two taps on Tab are two tab characters', async () => {
  const page = await openRun(cast.b, cast.rb);
  await attached(page);
  const before = await podInput(cast.rb);
  await key(page, 'Tab').click();
  await expect.poll(async () => (await podInput(cast.rb)).slice(before.length)).toBe('\t');
  await key(page, 'Tab').click();
  await expect.poll(async () => (await podInput(cast.rb)).slice(before.length)).toBe('\t\t');
  await page.waitForTimeout(1_000);
  expect((await podInput(cast.rb)).slice(before.length)).toBe('\t\t');
});

test('TC-67.4: Ctrl-C with text selected is one interrupt, with no confirm', async () => {
  const page = await openRun(cast.b, cast.rb);
  await attached(page);
  const screen = terminal(page);
  const box = await screen.boundingBox();
  if (!box) throw new Error('the terminal has no box');
  // Select a stretch of the screen by dragging across it.
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + 40, { steps: 8 });
  await page.mouse.up();
  // The Given: text is selected in the terminal.
  // Read it through xterm's own copy handling: the WebGL renderer draws the selection on a canvas, so there is no DOM
  // layer to look for, and a copy event leaves the selection as it is.
  await expect
    .poll(() =>
      screen.locator('.xterm-helper-textarea').evaluate((el) => {
        const data = new DataTransfer();
        el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        return data.getData('text/plain');
      }),
    )
    .not.toBe('');
  const before = await podInput(cast.rb);
  await key(page, 'Ctrl-C').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await podInput(cast.rb)).slice(before.length)).toBe('\x03');
  await page.waitForTimeout(1_000);
  expect((await podInput(cast.rb)).slice(before.length)).toBe('\x03');
});

test('TC-69.1: a viewer on a live run at 390 has no key row and nothing typed reaches the pod', async () => {
  const page = await openRun(cast.v, cast.rb);
  await expect(runHeader(page)).toBeVisible();
  await expect(page.getByText("You can't open this terminal")).toBeVisible();
  await expect(keyRow(page)).toHaveCount(0);
  const before = await podInput(cast.rb);
  await page.getByRole('main').click({ position: { x: 100, y: 400 } });
  await page.keyboard.type('qzxv');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_500);
  expect(await podInput(cast.rb)).toBe(before);
});

test("TC-69.2: a member on another user's live run at 390 has no key row and nothing typed reaches the pod", async () => {
  const page = await openRun(cast.b, cast.rc);
  await expect(runHeader(page)).toBeVisible();
  await expect(page.getByText("You can't open this terminal")).toBeVisible();
  await expect(keyRow(page)).toHaveCount(0);
  const before = await podInput(cast.rc);
  await page.getByRole('main').click({ position: { x: 100, y: 400 } });
  await page.keyboard.type('qzxv');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_500);
  expect(await podInput(cast.rc)).toBe(before);
});
