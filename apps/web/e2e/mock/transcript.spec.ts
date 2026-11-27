import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ENDING_RUN,
  EXPIRED_STOPPED_RUN,
  FINISHED_AFTER_PAUSE_RUN,
  IDLE_RUN,
  INVOICER_API,
  NOTHING_ENDED_RUN,
  NOTHING_PAUSED_RUN,
  ORG,
  PAUSED_TRANSCRIPT_RUN,
  SCRIPTED_RUN,
  SCROLLBACK_ENDED_RUN,
  SCROLLBACK_PAUSED_RUN,
  SESSION_MOCK_NOW,
  STOPPED_RUN,
  STOP_DONE_RUN,
  STOP_RUNNING_ENDING_RUN,
  STOP_RUNNING_RUN,
  TRANSCRIPT_CANCELLED_RUN,
  TRANSCRIPT_ERROR_NO_ID_RUN,
  TRANSCRIPT_ERROR_RUN,
  TRANSCRIPT_FAILED_RUN,
  TRANSCRIPT_FLAKY_RUN,
  TRANSCRIPT_LONG_RUN,
  TRANSCRIPT_RESUMING_RUN,
  TRANSCRIPT_RICH_RUN,
  TRANSCRIPT_SLOW_RUN,
  TRANSCRIPT_TIMED_OUT_RUN,
  runHeader,
} from './mock';

/*
 * The read-only Transcript view (spec 2026-11-19 "E2E requirements", BR-28 to BR-49 and BR-56). Runs 72 to 97 are
 * seeded into the browser mock only (src/mocks/dto/sessionRuns.ts). Every test installs the fixed clock before its
 * first goto, and the browser timezone is UTC so a time like "14:13" is the same everywhere.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC' });

// A message's Markdown paragraph sits two wrappers (the text box, Streamdown's own div) below the message block.
const TEXT_BOX = 'xpath=../..';
const MESSAGE = 'xpath=../../..';

const runUrl = (number: number) => `/o/${ORG}/p/${INVOICER_API}/runs/${number}`;

async function open(page: Page, number: number): Promise<void> {
  await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
  await page.goto(runUrl(number));
}

const pill = (page: Page, label: string) => runHeader(page).getByText(label, { exact: true });
const area = (page: Page) => page.getByRole('region', { name: /^(Terminal|Transcript)$/ });
const log = (page: Page) => page.getByRole('log', { name: 'Transcript of the agent conversation' });
const liveTerminal = (page: Page) => page.getByRole('group', { name: 'Claude Code terminal' });
const transcriptTab = (page: Page) => page.getByRole('tab', { name: 'Transcript', selected: true });
const skeleton = (page: Page) => page.getByRole('status', { name: 'Loading the transcript' });
const errorBanner = (page: Page) => page.getByText("Couldn't load the transcript");

/** Clicks into the terminal area and types, as a person would into a live terminal. */
async function typeIntoArea(page: Page): Promise<void> {
  await area(page).click({ position: { x: 40, y: 200 } });
  await page.keyboard.type('hello');
}

async function expectNoLiveTerminal(page: Page): Promise<void> {
  await typeIntoArea(page);
  await expect(liveTerminal(page)).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('hello')).toHaveCount(0);
}

/** Saved terminal text takes no input: what a person types into it appears nowhere. */
async function expectReadOnly(page: Page): Promise<void> {
  await page.getByRole('group', { name: 'Claude Code terminal' }).click();
  await page.keyboard.type('hello');
  await expect(page.getByText('hello')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Claude Code terminal' })).not.toContainText('hello');
}

test.describe('BR-28: a live session shows the live terminal only', () => {
  for (const [id, label, run] of [
    ['TC-28.1', 'running', STOP_RUNNING_RUN],
    ['TC-28.2', 'idle', IDLE_RUN],
    ['TC-28.3', 'done', STOP_DONE_RUN],
  ] as const) {
    test(`${id} a ${label} run shows the live terminal, Find and Copy all, and no Transcript tab`, async ({ page }) => {
      await open(page, run);
      await expect(page.getByRole('tab', { name: 'Terminal', selected: true })).toBeVisible();
      // Today's live label. "{user}" in BR-28 and TC-28.x ("Live, attached as {user}") is read as an example, as spec §7.1 says.
      await expect(area(page).getByText(/^Live\b/)).toBeVisible();
      await expect(area(page).getByRole('button', { name: 'Find in scrollback' })).toBeVisible();
      await expect(area(page).getByRole('button', { name: 'Copy all' })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Transcript/ })).toHaveCount(0);
      await expect(page.getByText('coming in MVP')).toHaveCount(0);
    });
  }
});

test.describe('BR-29: no live pod means a read-only Transcript', () => {
  for (const [id, label, run] of [
    ['TC-29.1', 'whose session is ending', ENDING_RUN],
    ['TC-29.2', 'stopped', STOPPED_RUN],
    ['TC-29.3', 'paused by the idle timeout', PAUSED_TRANSCRIPT_RUN],
    ['TC-29.4', 'succeeded', FINISHED_AFTER_PAUSE_RUN],
    ['TC-29.5', 'failed', TRANSCRIPT_FAILED_RUN],
    ['TC-29.6', 'timed out', TRANSCRIPT_TIMED_OUT_RUN],
    ['TC-29.7', 'cancelled', TRANSCRIPT_CANCELLED_RUN],
    ['TC-29.8', 'expired', EXPIRED_STOPPED_RUN],
  ] as const) {
    test(`${id} a ${label} run has no live terminal and no input`, async ({ page }) => {
      await open(page, run);
      await expect(area(page)).toBeVisible();
      await expect(transcriptTab(page)).toBeVisible();
      await expectNoLiveTerminal(page);
    });
  }
});

test.describe('BR-30: session ending notice and loading Transcript', () => {
  test('TC-30.1 an ending session shows the notice above a loading Transcript labelled Ending…', async ({ page }) => {
    await open(page, STOP_RUNNING_ENDING_RUN);
    const view = area(page);
    await expect(view.getByText('Session ending…')).toBeVisible();
    await expect(
      view.getByText('The session is being saved. This page updates by itself when the session has ended.'),
    ).toBeVisible();
    await expect(transcriptTab(page)).toBeVisible();
    await expect(view.getByText('Ending…', { exact: true })).toBeVisible();
    await expect(skeleton(page)).toBeVisible();
    // The notice sits above the terminal area's content.
    const notice = await view.getByText('Session ending…').boundingBox();
    const body = await skeleton(page).boundingBox();
    expect(notice?.y ?? Infinity).toBeLessThan(body?.y ?? 0);
  });
});

test.describe('BR-31: paused Transcript', () => {
  test('TC-31.1 a stopped run shows the Transcript tab and "Paused, read-only"', async ({ page }) => {
    await open(page, STOPPED_RUN);
    await expect(transcriptTab(page)).toBeVisible();
    await expect(area(page).getByText('Paused, read-only', { exact: true })).toBeVisible();
    await expect(log(page)).toBeVisible();
  });

  test("TC-31.2 a run paused by the idle timeout keeps today's notice and shows the Transcript", async ({ page }) => {
    await open(page, PAUSED_TRANSCRIPT_RUN);
    await expect(page.getByText(/^Paused: waiting for your answer\. Can be resumed for /)).toBeVisible();
    await expect(page.getByText(/^Stopped/)).toHaveCount(0);
    await expect(transcriptTab(page)).toBeVisible();
    await expect(area(page).getByText('Paused, read-only', { exact: true })).toBeVisible();
    await expect(log(page)).toBeVisible();
  });
});

test.describe('BR-32: ended Transcript', () => {
  test('TC-32.1 a succeeded run shows its end notice and the Ended Transcript', async ({ page }) => {
    await open(page, FINISHED_AFTER_PAUSE_RUN);
    await expect(page.getByText(/^Succeeded in /)).toBeVisible();
    await expect(area(page).getByText('Ended, read-only', { exact: true })).toBeVisible();
    await expect(log(page)).toBeVisible();
  });

  test('TC-32.2 a failed run shows its failed notice and the Ended Transcript', async ({ page }) => {
    await open(page, TRANSCRIPT_FAILED_RUN);
    await expect(page.getByText(/^Failed/).first()).toBeVisible();
    await expect(area(page).getByText('Ended, read-only', { exact: true })).toBeVisible();
    await expect(log(page)).toBeVisible();
  });

  test('TC-32.3 a timed out run shows its timed-out notice and the Ended Transcript', async ({ page }) => {
    await open(page, TRANSCRIPT_TIMED_OUT_RUN);
    await expect(page.getByText(/^Timed out/).first()).toBeVisible();
    await expect(area(page).getByText('Ended, read-only', { exact: true })).toBeVisible();
    await expect(log(page)).toBeVisible();
  });

  test('TC-32.4 an expired run shows its expired notice and the Ended Transcript', async ({ page }) => {
    await open(page, EXPIRED_STOPPED_RUN);
    await expect(page.getByText(/^Nobody resumed this run within /)).toBeVisible();
    await expect(area(page).getByText('Ended, read-only', { exact: true })).toBeVisible();
    await expect(log(page)).toBeVisible();
  });
});

test.describe('BR-33: a cancelled run shows the Transcript', () => {
  test('TC-33.1 a cancelled run with entries shows the Transcript, not the no-scrollback placeholder', async ({
    page,
  }) => {
    await open(page, TRANSCRIPT_CANCELLED_RUN);
    await expect(page.getByText('Cancelled at 13:10:41.', { exact: true })).toBeVisible();
    await expect(log(page)).toBeVisible();
    await expect(page.getByText('No scrollback was saved')).toHaveCount(0);
    await expect(area(page).getByRole('list')).toHaveCount(0);
    await expect(area(page).getByRole('link', { name: /branch/i })).toHaveCount(0);
  });
});

test.describe('BR-34: starting and resuming keep the placeholder', () => {
  test('TC-34.1 a starting run shows the Starting the agent placeholder and no Transcript', async ({ page }) => {
    // Run 63 is queued, then starting once its script starts; it is seeded as starting-bound.
    await open(page, SCRIPTED_RUN);
    await expect(page.getByRole('heading', { name: 'Starting the agent' })).toBeVisible({ timeout: 15_000 });
    await expect(log(page)).toHaveCount(0);
    await expect(page.getByText('Transcript', { exact: true })).toHaveCount(0);
  });

  test('TC-34.2 a resuming run shows the Resuming the run placeholder and no Transcript', async ({ page }) => {
    await open(page, TRANSCRIPT_RESUMING_RUN);
    await expect(page.getByRole('heading', { name: 'Resuming the run' })).toBeVisible();
    await expect(log(page)).toHaveCount(0);
    await expect(page.getByText('Transcript', { exact: true })).toHaveCount(0);
  });
});

test.describe('BR-35: Transcript bar', () => {
  test('TC-35.1 the bar of a stopped run has only the Transcript tab and the label', async ({ page }) => {
    await open(page, STOPPED_RUN);
    const bar = area(page).getByRole('tablist', { name: 'Run view' });
    await expect(bar.getByRole('tab')).toHaveCount(1);
    await expect(bar.getByRole('tab', { name: 'Transcript' })).toBeVisible();
    await expect(area(page).getByText('Paused, read-only', { exact: true })).toBeVisible();
    await expect(area(page).getByRole('button', { name: /^Find/ })).toHaveCount(0);
    await expect(area(page).getByRole('button', { name: 'Copy all' })).toHaveCount(0);
  });

  test('TC-35.2 the bar of a live running run shows Find and Copy all', async ({ page }) => {
    await open(page, STOP_RUNNING_RUN);
    await expect(area(page).getByRole('button', { name: /^Find/ })).toBeVisible();
    await expect(area(page).getByRole('button', { name: 'Copy all' })).toBeVisible();
  });
});

test.describe('BR-36: tab label while loading, failed and checking', () => {
  test('TC-36.1 while the transcript loads the tab reads Transcript', async ({ page }) => {
    await open(page, TRANSCRIPT_SLOW_RUN);
    await expect(skeleton(page)).toBeVisible();
    await expect(transcriptTab(page)).toBeVisible();
  });

  test('TC-36.2 in the error state the tab reads Transcript', async ({ page }) => {
    await open(page, TRANSCRIPT_ERROR_RUN);
    await expect(errorBanner(page)).toBeVisible();
    await expect(transcriptTab(page)).toBeVisible();
  });

  test('TC-36.3 only after an empty first page does the tab become Saved scrollback', async ({ page }) => {
    await open(page, SCROLLBACK_PAUSED_RUN);
    // The request takes 3 s: until then the tab still reads Transcript.
    await expect(skeleton(page)).toBeVisible();
    await expect(transcriptTab(page)).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Saved scrollback', selected: true })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('BR-37: viewing never starts a pod', () => {
  test('TC-37.3 pressing Retry on the error loads the Transcript and the run stays Paused', async ({ page }) => {
    await open(page, TRANSCRIPT_FLAKY_RUN);
    await expect(errorBanner(page)).toBeVisible();
    await expect(pill(page, 'Paused')).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(log(page)).toBeVisible();
    await expect(pill(page, 'Paused')).toBeVisible();
    for (const state of ['Queued', 'Starting', 'Resuming']) {
      await expect(runHeader(page).getByText(state, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('heading', { name: /Starting the agent|Resuming the run/ })).toHaveCount(0);
  });
});

/** A notice is a centred line between rules: a rule before and after its text, in a muted colour. */
async function noticeLook(notice: Locator): Promise<{ rules: string[]; muted: boolean }> {
  return notice.evaluate((el) => {
    const s = getComputedStyle(el);
    const body = getComputedStyle(el.closest('[role="log"]') as Element);
    return {
      rules: [getComputedStyle(el, '::before').borderTopWidth, getComputedStyle(el, '::after').borderTopWidth],
      muted: s.color !== body.color && s.alignItems === 'center',
    };
  });
}

test.describe('BR-38 to BR-41: entries of the Transcript', () => {
  test('TC-38.1 the first entry is the Prompt and a person message is a raised box labelled You with its time', async ({
    page,
  }) => {
    await open(page, TRANSCRIPT_RICH_RUN);
    const first = log(page).locator('p').first();
    await expect(first).toContainText('Add a refunds column to the weekly report');
    // The label sits with the first entry (the prompt's own block), not on a later one.
    await expect(first.locator(MESSAGE).getByText('Prompt', { exact: true })).toBeVisible();
    await expect(log(page).getByText('Prompt', { exact: true })).toHaveCount(1);
    const reply = log(page).locator('p', { hasText: 'Please also keep the totals row.' });
    const message = reply.locator(MESSAGE);
    const text = reply.locator(TEXT_BOX);
    await expect(message.getByText('You', { exact: true })).toBeVisible();
    await expect(message.getByText('14:16', { exact: true })).toBeVisible();
    // A raised, bordered box: a border and a fill that differ from the plain reply's.
    const look = (el: Element) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopWidth, fill: s.backgroundColor };
    };
    const box = await text.evaluate(look);
    const plain = await log(page)
      .locator('p', { hasText: 'I will start with the report builder.' })
      .locator(TEXT_BOX)
      .evaluate(look);
    expect(box.border).toBe('1px');
    expect(box.fill).not.toBe(plain.fill);
    expect(plain.border).toBe('0px');
  });

  test('TC-39.1 an agent reply is Markdown text labelled Claude with its time and has no box', async ({ page }) => {
    await open(page, TRANSCRIPT_RICH_RUN);
    const paragraph = log(page).locator('p', { hasText: 'I will start with the report builder.' });
    const text = paragraph.locator(TEXT_BOX);
    const reply = paragraph.locator(MESSAGE);
    await expect(reply.getByText('Claude', { exact: true })).toBeVisible();
    await expect(reply.getByText('14:13', { exact: true })).toBeVisible();
    // No box around the reply, nor around its block.
    for (const el of [text, reply]) {
      expect(await el.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe('0px');
      expect(await el.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    }
  });

  test('TC-40.1 a Bash step is one muted line with a terminal icon, Bash in bold and the command in mono', async ({
    page,
  }) => {
    await open(page, TRANSCRIPT_RICH_RUN);
    const step = log(page).locator('div', { hasText: /^Bashdotnet test$/ });
    await expect(step).toHaveCount(1);
    await expect(step.locator('svg')).toHaveCount(1);
    await expect(step.locator('b')).toHaveText('Bash');
    const family = (el: Element) => getComputedStyle(el).fontFamily;
    expect(await step.locator('span').evaluate(family)).toMatch(/mono/i);
    expect(await log(page).locator('p').first().evaluate(family)).not.toMatch(/mono/i);
    expect(await step.locator('b').evaluate((el) => getComputedStyle(el).fontWeight)).toBe('600');
    await expect(step.locator('span')).toHaveText('dotnet test');
    // Muted: the line's colour differs from a plain agent reply's text colour.
    const colour = (el: Element) => getComputedStyle(el).color;
    const reply = log(page).locator('p', { hasText: 'I will start with the report builder.' });
    expect(await step.evaluate(colour)).not.toBe(await reply.evaluate(colour));
  });

  test('TC-40.2 Edit, Write and Read steps show the tool name in bold and the file path in mono', async ({ page }) => {
    await open(page, TRANSCRIPT_RICH_RUN);
    for (const [tool, path] of [
      ['Edit', 'src/Reports/ReportBuilder.cs'],
      ['Write', 'tests/Reports/RefundsColumnTests.cs'],
      ['Read', 'src/Reports/ReportRow.cs'],
    ] as const) {
      const step = log(page).locator('div', { hasText: new RegExp(`^${tool}${path.replace(/\./g, '\\.')}$`) });
      await expect(step).toHaveCount(1);
      await expect(step.locator('b')).toHaveText(tool);
      await expect(step.locator('span')).toHaveText(path);
    }
  });

  test('TC-41.1 notices are centred muted lines in entry order', async ({ page }) => {
    await open(page, TRANSCRIPT_RICH_RUN);
    const texts = [
      'Conversation compacted',
      'API Error: 401 invalid credential',
      'Transcript limit reached; later messages were not saved',
    ];
    const boxes = [];
    for (const text of texts) {
      const notice = log(page).getByText(text, { exact: true });
      await expect(notice).toBeVisible();
      boxes.push(await notice.boundingBox());
      expect(await noticeLook(notice)).toEqual({ rules: ['1px', '1px'], muted: true });
    }
    expect(boxes[0]?.y ?? 0).toBeLessThan(boxes[1]?.y ?? 0);
    expect(boxes[1]?.y ?? 0).toBeLessThan(boxes[2]?.y ?? 0);
  });
});

/** The bidi (U+202A to U+202E, U+2066 to U+2069) and C0 control characters (tab and newline excepted) in a text, as hex codes. */
function unwanted(text: string): string[] {
  return [...text].flatMap((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    const bidi = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    const control = code < 0x20 && code !== 0x09 && code !== 0x0a;
    return bidi || control ? [code.toString(16)] : [];
  });
}

test.describe('BR-43: messages are rendered as safe Markdown', () => {
  test('TC-43.1 unsafe raw HTML is never rendered and nothing runs', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await open(page, TRANSCRIPT_RICH_RUN);
    // The message that carries <b>bold</b> and a <script>: the script is never rendered and nothing runs.
    await expect(log(page).locator('p', { hasText: 'bold' }).first()).toBeVisible();
    await expect(log(page).getByText('alert(1)')).toHaveCount(0);
    await expect(log(page).locator('script, img, [onerror], [onclick]')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('TC-43.2 Markdown is rendered as headings, emphasis, lists and links', async ({ page }) => {
    await open(page, TRANSCRIPT_RICH_RUN);
    await expect(log(page).getByRole('heading', { name: 'Heading' })).toBeVisible();
    await expect(log(page).locator('strong', { hasText: 'strong' })).toBeVisible();
    await expect(log(page).locator('li')).toHaveText(['one', 'two']);
    const link = log(page).getByRole('link', { name: 'a link' });
    await expect(link).toHaveAttribute('href', 'https://example.com/');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(log(page).getByText('# Heading', { exact: false })).toHaveCount(0);
    await expect(log(page).getByText('**strong**', { exact: false })).toHaveCount(0);
  });

  test('TC-43.2b tables, inline code and fenced code are readable and a long code line scrolls in its block', async ({
    page,
  }) => {
    await open(page, TRANSCRIPT_RICH_RUN);
    const table = log(page).getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'refunds', exact: true })).toBeVisible();
    await expect(log(page).locator('code', { hasText: /^inline_code$/ })).toBeVisible();
    const block = log(page).locator('pre', { hasText: 'LONG_CODE_LINE' });
    await expect(block).toBeVisible();
    // The long code line does not widen the transcript itself.
    expect(await log(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    // It scrolls inside its own block: that block clips sideways (auto or scroll) and its line is wider than it.
    const scroll = await block.evaluate((pre) => ({
      overflowX: getComputedStyle(pre).overflowX,
      wider: pre.scrollWidth > pre.clientWidth,
    }));
    expect(scroll.overflowX).toMatch(/^(auto|scroll)$/);
    expect(scroll.wider).toBe(true);
  });

  test('TC-43.3 line breaks are kept and runs of spaces collapse', async ({ page }) => {
    await open(page, TRANSCRIPT_RICH_RUN);
    const text = log(page).locator('p', { hasText: /^a {5}b/ });
    await expect(text).toHaveCount(1);
    const shown = await text.evaluate((el) => (el as HTMLElement).innerText);
    expect(shown).toBe('a b\nc\nd');
  });

  test('TC-43.4 bidi and control characters are removed', async ({ page }) => {
    await open(page, TRANSCRIPT_RICH_RUN);
    const text = log(page).locator('p', { hasText: 'visible' });
    await expect(text).toHaveCount(1);
    const shown = (await text.textContent()) ?? '';
    expect(shown).toBe('before visible after');
    expect(unwanted(shown)).toEqual([]);
    const everything = (await page.locator('body').textContent()) ?? '';
    expect(unwanted(everything)).toEqual([]);
  });
});

test.describe('BR-44: long entries are cut', () => {
  test('TC-44.3 an entry marked as cut ends with a muted … (cut)', async ({ page }) => {
    await open(page, STOPPED_RUN);
    const cut = log(page).getByText('… (cut)', { exact: true });
    await expect(cut).toBeVisible();
    // It ends the entry's text, and is muted against the text.
    await expect(cut.locator('xpath=..')).toContainText(/\(cut\)$/);
    const colours = await cut.evaluate((el) => ({
      cut: getComputedStyle(el).color,
      text: getComputedStyle(el.parentElement as HTMLElement).color,
    }));
    expect(colours.cut).not.toBe(colours.text);
  });
});

test.describe('BR-45: scroll, order and earlier messages', () => {
  const earlier = (page: Page) => log(page).getByRole('button', { name: 'Show earlier messages' });

  test('TC-45.1 the Transcript opens at the newest entry, oldest first, with Show earlier messages at the top', async ({
    page,
  }) => {
    await open(page, TRANSCRIPT_LONG_RUN);
    await expect(earlier(page)).toBeVisible();
    await expect(earlier(page).locator('svg')).toBeVisible();
    // The chevron-up icon (the ds Icon draws it as this path) on a ghost button (transparent fill and border).
    await expect(earlier(page).locator('svg path')).toHaveAttribute('d', 'M6 15l6-6 6 6');
    const look = await earlier(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, border: s.borderTopColor };
    });
    expect(look).toEqual({ bg: 'rgba(0, 0, 0, 0)', border: 'rgba(0, 0, 0, 0)' });
    const scroll = await log(page).evaluate((el) => ({
      atBottom: Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 4,
      top: el.scrollTop,
    }));
    expect(scroll.atBottom).toBe(true);
    // The newest step of 1,000 is at the bottom; the entries run oldest first downward.
    const texts = await log(page).locator('p, div:has(> b)').allTextContents();
    expect(texts.length).toBeGreaterThan(2);
    const steps = texts.flatMap((t) => (/Step (\d+):/.exec(t) ? [Number(/Step (\d+):/.exec(t)?.[1])] : []));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(steps[steps.length - 1]).toBe(999);
  });

  test('TC-45.2 pressing Show earlier messages keeps the first visible entry in place', async ({ page }) => {
    await open(page, TRANSCRIPT_LONG_RUN);
    await expect(earlier(page)).toBeVisible();
    await log(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    const first = log(page).locator('p').first();
    const firstText = (await first.textContent()) ?? '';
    const before = await first.boundingBox();
    await earlier(page).click();
    const same = log(page).locator('p', { hasText: firstText }).first();
    await expect.poll(async () => log(page).locator('p').first().textContent()).not.toBe(firstText);
    const after = await same.boundingBox();
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(3);
  });

  test('TC-45.3 pressing Show earlier messages until the oldest entry is loaded shows the Prompt and no button', async ({
    page,
  }) => {
    await open(page, TRANSCRIPT_LONG_RUN);
    await expect(earlier(page)).toBeVisible();
    await expect(async () => {
      if ((await earlier(page).count()) > 0 && (await earlier(page).isEnabled())) await earlier(page).click();
      await expect(earlier(page)).toHaveCount(0, { timeout: 500 });
    }).toPass({ timeout: 20_000 });
    await log(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(log(page).locator('p').first()).toContainText('Add a refunds column to the weekly report');
    await expect(log(page).getByText('Prompt', { exact: true })).toBeVisible();
  });

  test('TC-45.4 a one-page Transcript has no Show earlier messages button', async ({ page }) => {
    await open(page, STOPPED_RUN);
    await expect(log(page)).toBeVisible();
    await expect(earlier(page)).toHaveCount(0);
  });
});

test.describe('BR-46: loading state', () => {
  test('TC-46.1 a loading Transcript shows skeleton lines and no messages', async ({ page }) => {
    await open(page, TRANSCRIPT_SLOW_RUN);
    await expect(skeleton(page)).toBeVisible();
    await expect(skeleton(page)).toHaveAttribute('aria-busy', 'true');
    await expect(log(page)).toHaveCount(0);
    await expect(page.getByText('I will read the ticket')).toHaveCount(0);
  });

  test('TC-46.2 the skeleton is replaced by the messages once the request completes', async ({ page }) => {
    await open(page, TRANSCRIPT_SLOW_RUN);
    await expect(skeleton(page)).toBeVisible();
    await expect(log(page)).toBeVisible({ timeout: 10_000 });
    await expect(skeleton(page)).toHaveCount(0);
    await expect(page.getByText('I will read the ticket, then add the column and its test.')).toBeVisible();
  });
});

test.describe('BR-47: error state and Retry', () => {
  test('TC-47.1 a failed transcript shows the banner, the request id and Retry', async ({ page }) => {
    await open(page, TRANSCRIPT_ERROR_RUN);
    await expect(errorBanner(page)).toBeVisible();
    await expect(page.getByText('Request ID req-123')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('TC-47.2 a failure with no request id shows the banner and Retry but no Request ID line', async ({ page }) => {
    await open(page, TRANSCRIPT_ERROR_NO_ID_RUN);
    await expect(errorBanner(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByText(/Request ID/)).toHaveCount(0);
  });

  test('TC-47.3 Retry shows the Transcript when the next request succeeds', async ({ page }) => {
    await open(page, TRANSCRIPT_FLAKY_RUN);
    await expect(page.getByText('Request ID req-123')).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(log(page)).toBeVisible();
    await expect(errorBanner(page)).toHaveCount(0);
  });

  test('TC-47.4 Retry keeps the banner when the next request fails again', async ({ page }) => {
    await open(page, TRANSCRIPT_ERROR_RUN);
    await expect(errorBanner(page)).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(errorBanner(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(log(page)).toHaveCount(0);
  });
});

test.describe('BR-48: fallback to saved terminal text', () => {
  test('TC-48.1 a paused run with only saved text shows it read-only as Saved scrollback', async ({ page }) => {
    await open(page, SCROLLBACK_PAUSED_RUN);
    await expect(page.getByRole('tab', { name: 'Saved scrollback', selected: true })).toBeVisible({ timeout: 10_000 });
    await expect(area(page).getByText('Paused, read-only, 412 lines', { exact: true })).toBeVisible();
    await expect(page.getByText('coming in MVP')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Claude Code terminal' })).toContainText('output line 412 of 412');
    await expectReadOnly(page);
  });

  test("TC-48.2 an ended run with only saved text shows it read-only with today's tab and label", async ({ page }) => {
    await open(page, SCROLLBACK_ENDED_RUN);
    await expect(page.getByRole('tab', { name: 'Final scrollback', selected: true })).toBeVisible();
    await expect(area(page).getByText('Ended, read-only, 412 lines', { exact: true })).toBeVisible();
    await expect(page.getByText('coming in MVP')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Claude Code terminal' })).toContainText('output line 412 of 412');
    await expectReadOnly(page);
  });
});

test.describe('BR-49: nothing saved', () => {
  const heading = (page: Page) => page.getByRole('heading', { name: 'No conversation was saved for this run.' });

  test('TC-49.1 an ended run with nothing saved shows the heading and the label Ended', async ({ page }) => {
    await open(page, NOTHING_ENDED_RUN);
    await expect(heading(page)).toBeVisible();
    await expect(heading(page).locator('xpath=..').locator('svg')).toBeVisible();
    await expect(area(page).getByText('Ended', { exact: true })).toBeVisible();
    // No body text: the heading is the only text of its block.
    await expect(heading(page).locator('xpath=..')).toHaveText('No conversation was saved for this run.');
  });

  test('TC-49.2 a paused run with nothing saved shows the heading and the label Paused', async ({ page }) => {
    await open(page, NOTHING_PAUSED_RUN);
    await expect(heading(page)).toBeVisible();
    await expect(heading(page).locator('xpath=..').locator('svg')).toBeVisible();
    await expect(area(page).getByText('Paused', { exact: true })).toBeVisible();
    await expect(heading(page).locator('xpath=..')).toHaveText('No conversation was saved for this run.');
  });
});

test.describe('BR-56: agent-side error notice', () => {
  test('TC-56.1 the API error is a centred notice in the Transcript below the prompt', async ({ page }) => {
    await open(page, TRANSCRIPT_FAILED_RUN);
    const notice = log(page).getByText('API Error: 401 invalid credential', { exact: true });
    await expect(notice).toBeVisible();
    expect(await noticeLook(notice)).toEqual({ rules: ['1px', '1px'], muted: true });
    const prompt = await log(page).locator('p').first().boundingBox();
    const error = await notice.boundingBox();
    expect(error?.y ?? 0).toBeGreaterThan(prompt?.y ?? Infinity);
  });
});
