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
  USAGE_RUNS,
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
  // The earlier start's steps do not show as done: the resumed run is still waiting for a slot.
  const steps = page.getByRole('list').filter({ hasText: 'Terminal attaches' });
  await expect(steps.getByText('Waiting for a slot')).toBeVisible();
  await expect(steps.getByRole('img', { name: 'succeeded' })).toHaveCount(0);
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
    const w = window as unknown as { __frames: string[]; __sockets: WebSocket[] };
    w.__frames = [];
    w.__sockets = [];
    let impl: typeof WebSocket = window.WebSocket;
    const wrap = (ctor: typeof WebSocket): typeof WebSocket =>
      new Proxy(ctor, {
        construct(target, args, newTarget) {
          const socket: WebSocket = Reflect.construct(target, args, newTarget);
          w.__sockets.push(socket);
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

test('a run whose session is ending says so, shows the loading Transcript and opens no socket', async ({ page }) => {
  const sockets = await countWebSockets(page);
  await page.goto(runUrl(ENDING_RUN));

  // BR-30: the ending session shows the Transcript area (the end flush lands with the park), not the greyed scrollback.
  const area = page.getByRole('region', { name: 'Transcript' });
  await expect(area.getByText('Session ending…')).toBeVisible();
  await expect(
    area.getByText('The session is being saved. This page updates by itself when the session has ended.'),
  ).toBeVisible();
  await expect(area.getByText('Ending…', { exact: true })).toBeVisible();
  // The old copy promised a pause, which a Finish never does.
  await expect(page.getByText(/Pausing the run/)).toHaveCount(0);

  // There is no live terminal and no live-run actions.
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
  // Nothing is kept, so Reopen session is disabled.
  await expect(page.getByRole('button', { name: 'Reopen session' })).toBeDisabled();
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

/** Makes the page's newest terminal socket deliver `text` as terminal output (needs recordTerminalFrames first). */
async function printInTerminal(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const sockets = (window as unknown as { __sockets: WebSocket[] }).__sockets;
    const socket = sockets.at(-1);
    if (!socket) throw new Error('no terminal socket');
    const data = new TextEncoder().encode(t).buffer;
    socket.dispatchEvent(new MessageEvent('message', { data }));
  }, text);
}

// Claude Code turns on mouse reporting and copies a mouse selection itself by printing OSC 52 (set clipboard), which
// xterm ignores unless handled. The sequence is the one tmux forwards: ESC ] 52 ; <selection> ; <base64> BEL. Pod output is
// untrusted, so it only writes the clipboard within a moment of a mouse release that ended a press inside the terminal.
test('in a live run terminal an OSC 52 sequence sets the clipboard, decoded as UTF-8; the read query changes nothing', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await recordTerminalFrames(page);
  await page.goto(runUrl(IDLE_RUN));
  const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
  await expect(terminal).toContainText('agent-desk fake terminal');
  await page.evaluate(() => navigator.clipboard.writeText('stale'));

  const osc52 = (selection: string, payload: string) => `\x1b]52;${selection};${payload}\x07`;
  const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
  const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());

  // The query is not answered and does not touch the clipboard.
  await printInTerminal(page, osc52('c', '?'));
  await printInTerminal(page, 'after the query');
  await expect(terminal).toContainText('after the query');
  expect(await readClipboard()).toBe('stale');

  // A real mouse press and release over the terminal (the end of a selection) is the gesture.
  const box = await terminal.boundingBox();
  if (!box) throw new Error('terminal has no box');
  await page.mouse.move(box.x + 30, box.y + 20);
  await page.mouse.down();
  await page.mouse.up();
  await printInTerminal(page, osc52('c', base64('copied by claude ✻ héllo')));
  await expect.poll(readClipboard).toBe('copied by claude ✻ héllo');
  // The sequence is consumed: it is not drawn on the screen.
  await expect(terminal).not.toContainText(']52');
});

test('in a live run terminal an OSC 52 sequence with no user gesture leaves the clipboard unchanged', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await recordTerminalFrames(page);
  await page.goto(runUrl(IDLE_RUN));
  const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
  await expect(terminal).toContainText('agent-desk fake terminal');
  await page.evaluate(() => navigator.clipboard.writeText('stale'));

  const payload = Buffer.from('injected by the pod', 'utf8').toString('base64');
  await printInTerminal(page, `\x1b]52;c;${payload}\x07`);
  await printInTerminal(page, 'after the sequence');
  await expect(terminal).toContainText('after the sequence');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('stale');
});

/** The run detail Usage section (spec 2026-11-24-run-token-usage-cost, BR-2 to BR-6, BR-11, BR-15, BR-17). */
const panel = (page: Page) => page.getByRole('complementary', { name: 'Run context' });

const openDetail = async (page: Page, run: number): Promise<void> => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs/${run}`);
  await expect(panel(page)).toBeVisible();
};

const usageSection = (page: Page) =>
  panel(page)
    .locator('section')
    .filter({ has: page.getByText('Usage', { exact: true }) });
/** The Usage header's own toggle (first button in DOM order) and the Models sub-header's (last). */
const usageToggle = (page: Page, name: 'Hide' | 'Show') =>
  usageSection(page).getByRole('button', { name, exact: true }).first();
const modelsToggle = (page: Page, name: 'Hide' | 'Show') =>
  usageSection(page).getByRole('button', { name, exact: true }).last();
const modelsTable = (page: Page) => usageSection(page).getByRole('table', { name: 'Usage by model' });

/** The value shown next to a label in the split list. */
async function rowValue(page: Page, label: string): Promise<string> {
  const row = usageSection(page)
    .locator('dl > div')
    .filter({ has: page.getByText(label, { exact: true }) });
  return ((await row.locator('dd').first().textContent()) ?? '').trim();
}
const count = (text: string): number => Number(text.replace(/,/g, ''));
const SPLIT = ['Input (uncached)', 'Cache read', 'Cache write', 'Output'];

async function expectSplitAddsUp(page: Page): Promise<void> {
  const parts = await Promise.all(SPLIT.map((l) => rowValue(page, l)));
  for (const p of parts) expect(p).toMatch(/^\d{1,3}(,\d{3})*$/);
  const head = usageSection(page).locator('dl > div').first();
  const total = count(((await head.locator('dd').first().textContent()) ?? '').trim());
  expect(parts.map(count).reduce((a, b) => a + b, 0)).toBe(total);
}

const NOTE =
  'Estimate at public API rates, whatever credential the run used. Costs are fixed when recorded, so later price changes do not change them.';
const PARTIAL = 'Some usage is missing or had no price when recorded, so tokens or cost may be low.';

test.describe('run detail Usage section', () => {
  test('TC-2.1: the Usage section shows the headline, four exact split rows adding up to the total, and Est. cost', async ({
    page,
  }) => {
    await openDetail(page, USAGE_RUNS.oneModel);
    const section = usageSection(page);
    await expect(section.getByText('Total tokens')).toBeVisible();
    await expect(section.getByText('all tokens processed')).toBeVisible();
    for (const label of [...SPLIT, 'Est. cost'])
      await expect(section.getByText(label, { exact: true }).first()).toBeVisible();
    expect(await rowValue(page, 'Input (uncached)')).toBe('12,000');
    expect(await rowValue(page, 'Cache read')).toBe('30,000');
    expect(await rowValue(page, 'Cache write')).toBe('1,213');
    expect(await rowValue(page, 'Output')).toBe('5,000');
    await expectSplitAddsUp(page);
    expect(await rowValue(page, 'Est. cost')).toBe('~$0.42');
  });

  test('TC-2.2: of which reasoning shows under Output only when reported and is not added to the split', async ({
    page,
  }) => {
    await openDetail(page, USAGE_RUNS.reasoning);
    const output = usageSection(page)
      .locator('dl > div')
      .filter({ has: page.getByText('Output', { exact: true }) });
    await expect(output.getByText('of which reasoning')).toBeVisible();
    await expect(output.getByText('300', { exact: true })).toBeVisible();
    await expectSplitAddsUp(page);
    await openDetail(page, USAGE_RUNS.oneModel);
    await expect(usageSection(page).getByText('Total tokens')).toBeVisible();
    await expect(usageSection(page).getByText('of which reasoning')).toHaveCount(0);
  });

  test('TC-2.3: Hide and Show collapse the Usage section, and a reload starts open', async ({ page }) => {
    await openDetail(page, USAGE_RUNS.oneModel);
    const section = usageSection(page);
    await expect(usageToggle(page, 'Hide')).toHaveAttribute('aria-expanded', 'true');
    await expect(section.getByText('Total tokens')).toBeVisible();

    await usageToggle(page, 'Hide').click();
    const show = usageToggle(page, 'Show');
    await expect(show).toHaveAttribute('aria-expanded', 'false');
    await expect(section.getByText('Usage', { exact: true })).toBeVisible();
    for (const text of ['Total tokens', 'Est. cost', 'Models', 'Estimate at public API rates']) {
      await expect(section.getByText(text).first()).toBeHidden();
    }
    await expect(modelsTable(page)).toBeHidden();

    await show.click();
    await expect(usageToggle(page, 'Hide')).toHaveAttribute('aria-expanded', 'true');
    await expect(section.getByText('Total tokens')).toBeVisible();

    await usageToggle(page, 'Hide').click();
    await expect(usageToggle(page, 'Show')).toBeVisible();
    await page.reload();
    await expect(usageToggle(page, 'Hide')).toHaveAttribute('aria-expanded', 'true');
    await expect(usageSection(page).getByText('Total tokens')).toBeVisible();
  });

  test('TC-2.4: a run with no usage shows no Hide or Show control on the Usage header', async ({ page }) => {
    await openDetail(page, USAGE_RUNS.noUsage);
    await expect(usageSection(page).getByText('Usage', { exact: true })).toBeVisible();
    await expect(usageSection(page).getByRole('button', { name: /^(Hide|Show)$/ })).toHaveCount(0);
  });

  test('TC-3.1: a one-model run has a Models table with one row of name, tokens and cost', async ({ page }) => {
    await openDetail(page, USAGE_RUNS.oneModel);
    const table = modelsTable(page);
    await expect(table.getByRole('columnheader')).toHaveText(['Model', 'Tokens', 'Est. cost']);
    await expect(usageSection(page).getByText('Models', { exact: true })).toBeVisible();
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('th, td')).toHaveText(['model-a', '48,213', '~$0.42']);
  });

  test('TC-3.2: a two-model run has two rows, the one with more tokens first', async ({ page }) => {
    await openDetail(page, USAGE_RUNS.twoModel);
    const rows = modelsTable(page).locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('th, td')).toHaveText(['model-a', '40,000', '~$0.30']);
    await expect(rows.nth(1).locator('th, td')).toHaveText(['model-b', '14,500', '~$0.10']);
  });

  test('TC-3.3: Hide and Show on the Models sub-header only touch the table, and a reload shows it', async ({
    page,
  }) => {
    await openDetail(page, USAGE_RUNS.twoModel);
    const section = usageSection(page);
    await modelsToggle(page, 'Hide').click();
    await expect(modelsTable(page)).toBeHidden();
    await expect(modelsToggle(page, 'Show')).toHaveAttribute('aria-expanded', 'false');
    await expect(modelsToggle(page, 'Show')).toHaveText('Show');
    for (const text of ['Total tokens', 'Input (uncached)', 'Est. cost', 'Estimate at public API rates']) {
      await expect(section.getByText(text).first()).toBeVisible();
    }

    await modelsToggle(page, 'Show').click();
    await expect(modelsTable(page)).toBeVisible();
    await expect(modelsToggle(page, 'Hide')).toHaveAttribute('aria-expanded', 'true');

    await modelsToggle(page, 'Hide').click();
    await expect(modelsTable(page)).toBeHidden();
    await page.reload();
    await expect(modelsTable(page)).toBeVisible();
  });

  test('TC-4.2: costs start with ~ and one note shows once, ending with the provider bill sentence', async ({
    page,
  }) => {
    await openDetail(page, USAGE_RUNS.twoModel);
    const section = usageSection(page);
    expect(await rowValue(page, 'Est. cost')).toBe('~$0.40');
    await expect(modelsTable(page).locator('tbody tr td:last-child')).toHaveText(['~$0.30', '~$0.10']);
    const full = `${NOTE} Prices as of 21 Nov 2026. Your provider bill may differ.`;
    await expect(section.getByText(full, { exact: true })).toHaveCount(1);
    await expect(section.getByText('Your provider bill may differ.')).toHaveCount(1);
    await expect(section.getByText(/Prices as of/)).toHaveCount(1);
  });

  test('TC-5.2: a run with no recorded usage reads No usage data and shows no numbers, cost, note or Models', async ({
    page,
  }) => {
    await openDetail(page, USAGE_RUNS.noUsage);
    const section = usageSection(page);
    await expect(section.getByText('No usage data for this run.')).toBeVisible();
    await expect(section).not.toContainText(/\$|\b0\b|Models|Estimate at public API|Total tokens/);
    await expect(section.getByRole('table')).toHaveCount(0);
  });

  test('TC-5.3: an all-zero priced run shows 0 with ~$0.00 in the list and zeros with the price date in the detail', async ({
    page,
  }) => {
    await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
    const link = page.getByRole('link', { name: new RegExp(`^Run ${USAGE_RUNS.zeroUsage}\\b`) });
    await expect(link).toBeVisible();
    const heads = await page.getByRole('columnheader').allTextContents();
    const col = heads.findIndex((h) => h.trim() === 'Usage');
    expect(col).toBeGreaterThanOrEqual(0);
    const row = page.getByRole('row').filter({ has: link });
    const cell = row.getByRole('cell').nth(col);
    await expect(cell).toBeVisible();
    expect(await cell.evaluate((el) => el.firstChild?.textContent ?? '')).toBe('0 · ~$0.00');

    await link.click();
    await expect(panel(page)).toBeVisible();
    for (const l of SPLIT) expect(await rowValue(page, l)).toBe('0');
    expect(await rowValue(page, 'Est. cost')).toBe('~$0.00');
    await expect(usageSection(page).getByText(/Prices as of 21 Nov 2026\./)).toBeVisible();
  });

  test('TC-6.1: an unpriced model shows a dash and a hover title, the total reads at least, and the partial note shows', async ({
    page,
  }) => {
    await openDetail(page, USAGE_RUNS.unpriced);
    const section = usageSection(page);
    const rows = modelsTable(page).locator('tbody tr');
    await expect(rows).toHaveCount(2);
    const unpriced = rows.filter({ hasText: 'model-b' });
    await expect(unpriced.locator('td').first()).toHaveText('12,960');
    const cost = unpriced.locator('td').last();
    await expect(cost).toHaveText('—');
    await cost.getByText('—').hover();
    await expect(cost.getByTitle('No price when this was recorded')).toBeVisible();
    expect(await rowValue(page, 'Est. cost')).toMatch(/^at least\s*~\$0\.42$/);
    await expect(section.getByText(PARTIAL)).toBeVisible();
    const text = await section.innerText();
    expect(text.indexOf('Estimate at public API rates')).toBeGreaterThan(-1);
    expect(text.indexOf('Estimate at public API rates')).toBeLessThan(text.indexOf(PARTIAL));
  });

  test('TC-6.2: when no model is priced the cost is a dash, tokens still show, the partial note shows and no price date', async ({
    page,
  }) => {
    await openDetail(page, USAGE_RUNS.nonePriced);
    const section = usageSection(page);
    expect(await rowValue(page, 'Est. cost')).toBe('—');
    await expectSplitAddsUp(page);
    const modelRows = modelsTable(page).locator('tbody tr');
    const modelCount = await modelRows.count();
    expect(modelCount).toBeGreaterThan(0);
    for (let i = 0; i < modelCount; i++) {
      await expect(modelRows.nth(i).locator('td').last()).toHaveText('—');
    }
    await expect(modelRows.first().locator('td').first()).toHaveText('12,840');
    await expect(section.getByText(PARTIAL)).toBeVisible();
    await expect(section.getByText(/Prices as of/)).toHaveCount(0);
  });

  test('TC-11.1: a run with no cache tokens shows 0 for Cache read and Cache write and a ~ cost', async ({ page }) => {
    await openDetail(page, USAGE_RUNS.noCache);
    expect(await rowValue(page, 'Cache read')).toBe('0');
    expect(await rowValue(page, 'Cache write')).toBe('0');
    expect(await rowValue(page, 'Est. cost')).toBe('~$0.06');
  });

  test('TC-11.2: with tokens in all four buckets the split rows add up to the total', async ({ page }) => {
    await openDetail(page, USAGE_RUNS.oneModel);
    for (const l of SPLIT) expect(count(await rowValue(page, l))).toBeGreaterThan(0);
    await expectSplitAddsUp(page);
  });

  test('TC-15.1: a run that hit the call cap reads at least with the cost and shows the partial note', async ({
    page,
  }) => {
    await openDetail(page, USAGE_RUNS.capPartial);
    expect(await rowValue(page, 'Est. cost')).toMatch(/^at least\s*~\$0\.42$/);
    await expect(usageSection(page).getByText(PARTIAL)).toBeVisible();
  });

  test('TC-17.1: a 128-character model name is one ellipsised line with the full name in its title', async ({
    page,
  }) => {
    await openDetail(page, USAGE_RUNS.longModelName);
    const name = 'Ab0._:/@-'.repeat(15).slice(0, 128);
    expect(name).toHaveLength(128);
    const head = modelsTable(page).locator('tbody th').first();
    await head.hover();
    await expect(head).toHaveAttribute('title', name);
    await expect(head).toHaveText(name);
    await expect(head).toHaveCSS('text-overflow', 'ellipsis');
    expect(await head.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await head.evaluate((el) => el.clientHeight < 40)).toBe(true);
  });

  test('TC-17.2: the side panel has no horizontal overflow with the long name, and the toggles work', async ({
    page,
  }) => {
    await openDetail(page, USAGE_RUNS.longModelName);
    const noOverflow = () => panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(await noOverflow()).toBe(true);
    const cells = modelsTable(page).locator('tbody tr').first().locator('td');
    await expect(cells).toHaveText(['48,213', '~$0.42']);
    await modelsToggle(page, 'Hide').click();
    await expect(modelsTable(page)).toBeHidden();
    await modelsToggle(page, 'Show').click();
    await expect(modelsTable(page)).toBeVisible();
    await expect(cells).toHaveText(['48,213', '~$0.42']);
    expect(await noOverflow()).toBe(true);
  });
});
