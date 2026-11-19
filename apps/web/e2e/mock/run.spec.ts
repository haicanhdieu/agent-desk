import { expect, test, type Page } from '@playwright/test';
import {
  CRASHED_RUN,
  ENDING_RUN,
  EXPIRED_RUN,
  IDLE_RUN,
  INVOICER_API,
  KILLED_RUN,
  ORG,
  PAUSED_RUN,
  RESUME_FAILED_RUN,
  RESUMED_RUN,
  SCRIPTED_RUN,
} from './mock';

// The scripted run takes about 16 s from queued to idle (mock.ts).
test.describe.configure({ timeout: 60_000 });

test('a live run starts, goes idle, echoes the terminal and finishes as succeeded', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs/${SCRIPTED_RUN}`);
  const header = page.getByRole('banner');
  const status = (label: string) => header.getByText(label, { exact: true });

  await expect(status('Starting')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Starting the agent' })).toBeVisible();
  await expect(status('Running')).toBeVisible({ timeout: 15_000 });
  await expect(status('Needs you')).toBeVisible({ timeout: 15_000 });

  const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
  await expect(terminal).toContainText('agent-desk fake terminal');
  await expect(terminal).toContainText(`run ${SCRIPTED_RUN}`);

  await terminal.click();
  await page.keyboard.type('hello e2e');
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText('> hello e2e');

  await page.getByRole('region', { name: 'Terminal' }).getByRole('button', { name: 'Finish run' }).click();
  await expect(status('Succeeded')).toBeVisible();
  // The session is kept as read-only scrollback.
  const view = page.getByRole('region', { name: 'Terminal' });
  await expect(view.getByRole('tab', { name: 'Final scrollback', selected: true })).toBeVisible();
  await expect(view.getByText(/^Ended, read-only/)).toBeVisible();
  await expect(terminal).toContainText('> hello e2e');
});

test('a paused run is resumed: Queued, then Running with the terminal', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs/${PAUSED_RUN}`);
  const header = page.getByRole('banner');
  await expect(header.getByText('Paused', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Paused: waiting for your answer\. Can be resumed for /)).toBeVisible();

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(header.getByText('Queued', { exact: true })).toBeVisible();
  await expect(header.getByText('Running', { exact: true })).toBeVisible({ timeout: 15_000 });
  const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
  await expect(terminal).toContainText('agent-desk fake terminal');
  await expect(terminal).toContainText(`run ${PAUSED_RUN}`);
});

/*
 * The run terminal lifecycle states (spec 2026-11-16 §5). Runs 67 to 70 are seeded into the browser mock only
 * (src/mocks/dto/lifecycleRuns.ts). The mock has no real socket, so "no terminal socket" is checked by counting the
 * WebSocket objects the page makes (a positive control, the idle run, makes one).
 */
const runUrl = (number: number) => `/o/${ORG}/p/${INVOICER_API}/runs/${number}`;

/** Counts `new WebSocket(...)` calls from the first script on, whatever replaces the constructor later (MSW does). */
async function countWebSockets(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __sockets: number };
    w.__sockets = 0;
    let impl: typeof WebSocket = window.WebSocket;
    const wrap = (ctor: typeof WebSocket): typeof WebSocket =>
      new Proxy(ctor, {
        construct(target, args, newTarget) {
          w.__sockets += 1;
          return Reflect.construct(target, args, newTarget);
        },
      });
    impl = wrap(impl);
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      get: () => impl,
      set: (v: typeof WebSocket) => {
        impl = wrap(v);
      },
    });
  });
  return () => page.evaluate(() => (window as unknown as { __sockets: number }).__sockets);
}

test('a live idle run opens a terminal socket (control for the pausing run)', async ({ page }) => {
  const sockets = await countWebSockets(page);
  await page.goto(runUrl(IDLE_RUN));
  await expect(page.getByRole('group', { name: 'Claude Code terminal' })).toBeVisible();
  await expect.poll(sockets).toBeGreaterThan(0);
});

/** Records the binary frames the page sends on its terminal socket, as strings, whatever replaces the constructor later. */
async function recordTerminalFrames(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: string[] };
    w.__frames = [];
    let impl: typeof WebSocket = window.WebSocket;
    const wrap = (ctor: typeof WebSocket): typeof WebSocket =>
      new Proxy(ctor, {
        construct(target, args, newTarget) {
          const socket: WebSocket = Reflect.construct(target, args, newTarget);
          const send = socket.send.bind(socket);
          socket.send = (data) => {
            if (typeof data !== 'string' && !(data instanceof Blob)) {
              const bytes = ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : new Uint8Array(data);
              w.__frames.push(new TextDecoder().decode(bytes));
            }
            send(data);
          };
          return socket;
        },
      });
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      get: () => impl,
      set: (v: typeof WebSocket) => {
        impl = wrap(v);
      },
    });
  });
  return () => page.evaluate(() => (window as unknown as { __frames: string[] }).__frames);
}

test('in a live run terminal Enter sends a CR and Shift+Enter sends ESC CR (a newline), not a CR', async ({ page }) => {
  const frames = await recordTerminalFrames(page);
  await page.goto(runUrl(IDLE_RUN));
  const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
  await expect(terminal).toContainText('agent-desk fake terminal');
  await terminal.click();

  await page.keyboard.press('Enter');
  await expect.poll(frames).toEqual(['\r']);

  await page.keyboard.press('Shift+Enter');
  // Exactly one more frame, and it is ESC CR: xterm's own CR for the same key is swallowed.
  await expect.poll(frames).toEqual(['\r', '\x1b\r']);

  // The frame stream stays in step with typing afterwards.
  await page.keyboard.type('a');
  await expect.poll(frames).toEqual(['\r', '\x1b\r', 'a']);
});

test('the run terminal prints Claude Code glyphs and uses a font stack that covers them, apart from the UI font', async ({
  page,
}) => {
  await page.goto(runUrl(IDLE_RUN));
  const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
  await expect(terminal).toContainText('agent-desk fake terminal');

  // Smoke check only: screen reader mode puts the text in the page whatever the renderer draws, so this does not
  // prove the pixels. The stack check below is what fails without the fix.
  const glyphs = '● ⎿ ▐▛███▜▌ ╭─╮';
  await terminal.click();
  await page.keyboard.insertText(glyphs);
  await expect(terminal).toContainText(glyphs);

  // The terminal gets its own stack (--term-mono, with glyph-covering fallbacks); the UI's --mono is unchanged.
  const stacks = await terminal.evaluate((el) => {
    const styles = getComputedStyle(el);
    return { term: styles.getPropertyValue('--term-mono'), ui: styles.getPropertyValue('--mono') };
  });
  expect(stacks.term).toContain('DejaVu Sans Mono');
  expect(stacks.term).toContain('Apple Symbols');
  expect(stacks.ui).not.toContain('DejaVu Sans Mono');
});

test('a run whose session is ending says so, greys its last scrollback and opens no socket', async ({ page }) => {
  const sockets = await countWebSockets(page);
  await page.goto(runUrl(ENDING_RUN));

  const area = page.getByRole('region', { name: 'Terminal' });
  await expect(area.getByText('Session ending…')).toBeVisible();
  await expect(
    area.getByText('The session is being saved. This page updates by itself when the session has ended.'),
  ).toBeVisible();
  await expect(area.getByText('Ending…', { exact: true })).toBeVisible();
  // The old copy promised a pause, which a Finish never does.
  await expect(page.getByText(/Pausing the run/)).toHaveCount(0);

  // The last scrollback is shown greyed and read-only; there is no live terminal and no live-run actions.
  const log = area.getByRole('log');
  await expect(log).toContainText('Wrote 142 rows to export.csv');
  await expect(log).toHaveClass(/dimmed/);
  await expect(page.getByRole('group', { name: 'Claude Code terminal' })).toHaveCount(0);
  await expect(area.getByRole('button', { name: 'Resume' })).toHaveCount(0);
  await expect(area.getByRole('button', { name: 'Finish run' })).toHaveCount(0);
  expect(await sockets()).toBe(0);
});

test('a run whose agent crashed is paused with the reason and its exit code, and can be resumed', async ({ page }) => {
  await page.goto(runUrl(CRASHED_RUN));
  const header = page.getByRole('banner');
  await expect(header.getByText('Paused', { exact: true })).toBeVisible();
  await expect(page.getByText('Paused: agent crashed (exit code 3)')).toBeVisible();
  await expect(page.getByText(/^Paused .*, the agent crashed\. Can be resumed for /)).toBeVisible();
  // The saved scrollback of the crashed session is shown read-only.
  await expect(page.getByRole('group', { name: 'Claude Code terminal' })).toContainText('Wrote 142 rows to export.csv');
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(header.getByText('Queued', { exact: true })).toBeVisible();
  await expect(header.getByText('Running', { exact: true })).toBeVisible({ timeout: 15_000 });
});

test('a run whose pod was killed for memory is paused with that reason, not "waiting for your answer", and can be resumed', async ({
  page,
}) => {
  await page.goto(runUrl(KILLED_RUN));
  const header = page.getByRole('banner');
  await expect(header.getByText('Paused', { exact: true })).toBeVisible();
  await expect(page.getByText('Paused: the pod was killed, most likely out of memory (exit code 137)')).toBeVisible();
  await expect(page.getByText(/^Paused .*, the pod stopped unexpectedly .*\. Can be resumed for /)).toBeVisible();
  await expect(page.getByText(/waiting for your answer/)).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Claude Code terminal' })).toContainText('Wrote 142 rows to export.csv');

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(header.getByText('Queued', { exact: true })).toBeVisible();
  await expect(header.getByText('Running', { exact: true })).toBeVisible({ timeout: 15_000 });
});

test('a Resume that found nothing kept shows why and leaves the run succeeded', async ({ page }) => {
  await page.goto(runUrl(RESUME_FAILED_RUN));
  await expect(page.getByRole('banner').getByText('Succeeded', { exact: true })).toBeVisible();
  await expect(page.getByText('Resume failed: nothing was kept to resume from')).toBeVisible();
  // Nothing is kept, so there is nothing to re-open.
  await expect(page.getByRole('button', { name: 'Re-open session' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);
});

test('a resumed run shows what the agent asked and what was lost, above a live terminal', async ({ page }) => {
  await page.goto(runUrl(RESUMED_RUN));
  await expect(
    page.getByText(
      'Resumed. The agent asked: Should quotes inside a field be doubled?. Background tasks and sub-agents that were running when it paused were stopped.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: 'Claude Code terminal' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Terminal' }).getByRole('button', { name: 'Finish run' }),
  ).toBeVisible();
});

test('a paused run says it pauses after 30 min with nobody attached; a live idle run warns of it', async ({ page }) => {
  await page.goto(runUrl(PAUSED_RUN));
  await expect(page.getByText(/^Paused .*, after 30 min with nobody attached/)).toBeVisible();
  await page.goto(runUrl(IDLE_RUN));
  await expect(page.getByText(/Pauses after 30 min with nobody attached\./)).toBeVisible();
});

test('a run nobody resumed in time shows that its saved session was deleted, with no actions', async ({ page }) => {
  await page.goto(runUrl(EXPIRED_RUN));
  await expect(
    page.getByText(/^Nobody resumed this run within \d+ days?\. The saved session was deleted\./),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);
});

test('in a live run terminal Ctrl+C copies the selected text and sends nothing; with no selection it sends ETX', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const frames = await recordTerminalFrames(page);
  await page.goto(runUrl(IDLE_RUN));
  const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
  await expect(terminal).toContainText('agent-desk fake terminal');
  await terminal.click();

  // No selection: Ctrl+C is the interrupt, as before.
  await page.keyboard.press('Control+C');
  await expect.poll(frames).toEqual(['\x03']);

  // With a selection it copies and does not interrupt.
  await page.evaluate(() => navigator.clipboard.writeText('stale'));
  await terminal.locator('.xterm-screen').dblclick({ position: { x: 20, y: 8 } });
  await page.keyboard.press('Control+C');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe('stale');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.trim()).not.toBe('');
  await expect(terminal).toContainText(copied.trim());
  expect(await frames()).toEqual(['\x03']);
});
