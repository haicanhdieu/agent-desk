import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';
import {
  API,
  FAKE_STATE_DIR,
  commentOnNewTicket,
  projectFor,
  runOf,
  touchPodFile,
  transcriptOf,
  waitForStatus,
} from './helpers';

/*
 * The saved Transcript on the real localhost stack (the fake pod runs the real Claude transcript adapter). Cases: spec
 * 2026-11-19 "E2E requirements", BR-37, BR-40, BR-42, BR-44, BR-48, BR-50 to BR-56. Each test is named by its TC id.
 *
 * One dev-login user and project are made once per worker and reused: each test starts its own run on a new fake ticket
 * and cancels it at the end, so the project's run slots are free for the next test.
 */
test.describe.configure({ timeout: 240_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

interface Started {
  handle: string;
  projectId: string;
  runId: string;
  number: number;
}

const startedRuns: string[] = [];

/** A run on a new fake ticket (`flags` are fake-pod prompt flags), not yet opened in the browser. */
async function startRun(page: Page, flags = ''): Promise<Started> {
  const { handle, projectId } = await projectFor(page);
  const runId = await commentOnNewTicket(page, handle, projectId, `/code-review ${flags}`.trim());
  startedRuns.push(runId);
  const run = await runOf(page, runId);
  return { handle, projectId, runId, number: run.number };
}

test.afterEach(async ({ page }) => {
  for (const runId of startedRuns.splice(0)) {
    await page.request.post(`/api/runs/${runId}/cancel`).catch(() => null);
  }
});

const topBar = (page: Page) => page.getByRole('banner');
const pill = (page: Page, label: string) => topBar(page).getByText(label, { exact: true });
const stopButton = (page: Page) => topBar(page).getByRole('button', { name: 'Stop session' });
const area = (page: Page) => page.getByRole('region', { name: /^(Terminal|Transcript)$/ });
const liveTerminal = (page: Page) => page.getByRole('group', { name: 'Claude Code terminal' });
const stoppedHeadline = (page: Page) => page.getByText(/^Stopped: can be resumed for /);
const log = (page: Page) => page.getByRole('log', { name: 'Transcript of the agent conversation' });

async function openRun(page: Page, s: Started): Promise<void> {
  await page.goto(`/o/${s.handle}/p/${s.projectId}/runs/${s.number}`);
  await expect(topBar(page)).toBeVisible();
}

/** Starts a run that reaches `idle`, opens it and waits for its live terminal. */
async function openLive(page: Page, flags: string): Promise<Started> {
  const s = await startRun(page, flags);
  await waitForStatus(page, s.runId, 'idle');
  await openRun(page, s);
  await expect(liveTerminal(page)).toContainText('Fake Claude Code', { timeout: 15_000 });
  return s;
}

/** Types one line into the live terminal; the fake pod answers it with a 2 s turn. */
async function typeLine(page: Page, line: string): Promise<void> {
  await liveTerminal(page).click();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

/** Types a line and waits for the turn it starts to end (Running, then Needs you). */
async function exchange(page: Page, line: string): Promise<void> {
  await typeLine(page, line);
  await expect(pill(page, 'Running')).toBeVisible({ timeout: 15_000 });
  await expect(pill(page, 'Needs you')).toBeVisible({ timeout: 30_000 });
}

/** Stop session on an idle run (no confirm) and waits for the Stopped notice. */
async function stopIdle(page: Page): Promise<void> {
  await expect(pill(page, 'Needs you')).toBeVisible({ timeout: 30_000 });
  await stopButton(page).click();
  await expect(stoppedHeadline(page)).toBeVisible({ timeout: 60_000 });
}

/** The text of every entry the Transcript shows, in order. */
async function shownTexts(page: Page): Promise<string[]> {
  return log(page).locator('p, div > span').allInnerTexts();
}

/** Records, from now on, whether `text` was ever on the page. */
async function watchText(page: Page, texts: string[]): Promise<() => Promise<string[]>> {
  const key = `__e2e_seen_${Math.random().toString(36).slice(2)}`;
  await page.evaluate(
    ({ t, k }) => {
      const seen: string[] = [];
      Reflect.set(window, k, seen);
      const check = () => {
        for (const x of t) if (document.body.innerText.includes(x) && !seen.includes(x)) seen.push(x);
      };
      new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
      check();
    },
    { t: texts, k: key },
  );
  return () => page.evaluate((k) => [...(Reflect.get(window, k) as string[])], key);
}

const PodSecret = z.object({ data: z.record(z.string(), z.string()) });

/** The run's workspace token and agent credential, read from the fake cluster's run Secret file. */
async function runSecrets(runId: string): Promise<{ workspaceToken: string; credential: string }> {
  const file = `${FAKE_STATE_DIR}/kube/.secrets/run-${runId}.json`;
  expect(existsSync(file), `no run Secret file at ${file}`).toBe(true);
  const data = PodSecret.parse(JSON.parse(await readFile(file, 'utf8'))).data;
  const workspaceToken = data['workspace-token'];
  const credential = data['CLAUDE_CODE_OAUTH_TOKEN'] ?? data['ANTHROPIC_API_KEY'];
  expect(workspaceToken, 'the run Secret has no workspace token').toBeTruthy();
  expect(credential, 'the run Secret has no agent credential').toBeTruthy();
  return { workspaceToken: workspaceToken ?? '', credential: credential ?? '' };
}

/** A notice is a centred line between rules: a rule before and after its text, in a muted colour. */
async function noticeLook(notice: Locator): Promise<{ rules: string[]; centred: boolean }> {
  return notice.evaluate((el) => ({
    rules: [getComputedStyle(el, '::before').borderTopWidth, getComputedStyle(el, '::after').borderTopWidth],
    centred: getComputedStyle(el).alignItems === 'center',
  }));
}

const LIMIT_NOTICE = 'Transcript limit reached; later messages were not saved';

test.describe('BR-37: viewing never starts a pod', () => {
  test('TC-37.1 opening a stopped run keeps it Paused with no Queued, Starting or Resuming, and no pod', async ({
    page,
  }) => {
    const s = await openLive(page, '');
    await stopIdle(page);
    const podDir = `${FAKE_STATE_DIR}/kube/run-${s.runId}`;
    // The stop deleted the Job, so no pod directory is left; opening the page must not bring one back.
    await expect.poll(() => existsSync(podDir), { timeout: 30_000 }).toBe(false);

    await page.goto('/');
    await openRun(page, s);
    const seen = await watchText(page, ['Queued', 'Starting', 'Resuming']);
    await expect(log(page)).toBeVisible();
    await page.waitForTimeout(10_000);
    await expect(pill(page, 'Paused')).toBeVisible();
    expect(await seen()).toEqual([]);
    expect((await runOf(page, s.runId)).status).toBe('paused');
    expect(existsSync(podDir), 'a pod directory appeared for the stopped run').toBe(false);
  });

  test('TC-37.2 opening a succeeded run keeps its status with no Queued, Starting or Resuming, and the Transcript loads', async ({
    page,
  }) => {
    const s = await startRun(page, '--fake-exit-ok');
    await waitForStatus(page, s.runId, 'succeeded', 90_000);
    await openRun(page, s);
    const seen = await watchText(page, ['Queued', 'Starting', 'Resuming']);
    await expect(log(page)).toBeVisible({ timeout: 15_000 });
    await expect(pill(page, 'Succeeded')).toBeVisible();
    expect(await seen()).toEqual([]);
    expect((await runOf(page, s.runId)).status).toBe('succeeded');
  });
});

const IDLE_END_SECONDS = Number.parseInt(process.env['E2E_IDLE_END_SECONDS'] ?? '', 10);

test.describe('BR-37: a run paused by the idle timeout', () => {
  test.skip(!Number.isFinite(IDLE_END_SECONDS), 'set E2E_IDLE_END_SECONDS to the stack worker RUN_IDLE_END_SECONDS');

  test('TC-37.2 opening a run paused by the idle timeout keeps it Paused and loads the Transcript', async ({
    page,
  }) => {
    const s = await startRun(page, '');
    await waitForStatus(page, s.runId, 'paused', (IDLE_END_SECONDS + 60) * 1000);
    await openRun(page, s);
    const seen = await watchText(page, ['Queued', 'Starting', 'Resuming']);
    await expect(log(page)).toBeVisible({ timeout: 15_000 });
    await expect(pill(page, 'Paused')).toBeVisible();
    expect(await seen()).toEqual([]);
    expect((await runOf(page, s.runId)).status).toBe('paused');
  });
});

test.describe('BR-40: tool steps', () => {
  test('TC-40.3 an "other" tool input of exactly 200 characters is shown whole, one of 201 is cut to 200', async ({
    page,
  }) => {
    await openLive(page, '--fake-tools');
    await stopIdle(page);
    await expect(log(page)).toBeVisible();
    const exact200 = JSON.stringify({ pattern: 'x'.repeat(186) });
    const over201 = JSON.stringify({ pattern: 'y'.repeat(187) });
    expect(exact200).toHaveLength(200);
    expect(over201).toHaveLength(201);
    await expect(log(page).getByText(exact200, { exact: true })).toBeVisible();
    await expect(log(page).getByText(over201.slice(0, 200), { exact: true })).toBeVisible();
    await expect(log(page).getByText(over201, { exact: true })).toHaveCount(0);
  });

  test('TC-40.4 a tool step is shown as a line and its output text is not', async ({ page }) => {
    const s = await openLive(page, '--fake-tools');
    await stopIdle(page);
    await expect(log(page)).toBeVisible();
    await expect(log(page).getByText('Bash', { exact: true })).toBeVisible();
    await expect(log(page).getByText('dotnet test', { exact: true })).toBeVisible();
    await expect(page.getByText('OUTPUT-MARKER')).toHaveCount(0);
    expect((await transcriptOf(page, s.runId)).map((e) => e.text).join('\n')).not.toContain('OUTPUT-MARKER');
  });
});

test.describe('BR-42: no hidden reasoning', () => {
  test('TC-42.1 the reply is shown and the agent thinking is not', async ({ page }) => {
    await openLive(page, '--fake-thinking');
    await stopIdle(page);
    await expect(log(page).getByText('Fake agent reply 1', { exact: true })).toBeVisible();
    await expect(page.getByText('THINKING-MARKER')).toHaveCount(0);
  });
});

test.describe('BR-44: long entries are cut', () => {
  test('TC-44.1 a reply of exactly 8,000 bytes is shown whole with no cut mark', async ({ page }) => {
    await openLive(page, '--fake-long-replies');
    await stopIdle(page);
    const whole = log(page).locator('p').filter({ hasText: /^a+$/ });
    await expect(whole).toHaveCount(1);
    await expect(whole).toHaveText('a'.repeat(8000));
    await expect(whole).not.toContainText('… (cut)');
  });

  test('TC-44.2 a reply of 8,001 bytes is cut and ends with … (cut)', async ({ page }) => {
    await openLive(page, '--fake-long-replies');
    await stopIdle(page);
    const cut = log(page)
      .locator('p')
      .filter({ hasText: /^b+ … \(cut\)$/ });
    await expect(cut).toHaveCount(1);
    await expect(cut.locator('span').filter({ hasText: '… (cut)' })).toBeVisible();
    expect(await cut.innerText()).toMatch(/^b{1,8000} … \(cut\)$/);
  });
});

test.describe('BR-48: fallback to saved terminal text', () => {
  test('TC-48.3 a run that sent no transcript lines shows its saved terminal text read-only as Saved scrollback', async ({
    page,
  }) => {
    await openLive(page, '--fake-no-transcript');
    await stopIdle(page);
    await expect(page.getByRole('tab', { name: 'Saved scrollback', selected: true })).toBeVisible({ timeout: 15_000 });
    await expect(area(page).getByText(/^Paused, read-only, \d+ lines$/)).toBeVisible();
    await expect(liveTerminal(page)).toContainText('Fake Claude Code', { timeout: 15_000 });
    await expect(log(page)).toHaveCount(0);
  });
});

test.describe('BR-50: entries visible at the end of the session', () => {
  test('TC-50.1 after Stop session the Transcript shows the last exchange without a reload', async ({ page }) => {
    await openLive(page, '');
    await exchange(page, 'LAST-EXCHANGE');
    await page.evaluate(() => Reflect.set(window, '__e2eNoReload', true));
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 60_000 });
    await expect(log(page).getByText('LAST-EXCHANGE', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(log(page).getByText('Fake agent reply 2', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, '__e2eNoReload'))).toBe(true);
  });

  test('TC-50.2 after Finish run the Transcript shows the last exchange without a reload', async ({ page }) => {
    await openLive(page, '');
    await exchange(page, 'LAST-EXCHANGE');
    await page.evaluate(() => Reflect.set(window, '__e2eNoReload', true));
    await area(page).getByRole('button', { name: 'Finish run' }).click();
    await expect(pill(page, 'Succeeded')).toBeVisible({ timeout: 60_000 });
    await expect(log(page).getByText('LAST-EXCHANGE', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(log(page).getByText('Fake agent reply 2', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, '__e2eNoReload'))).toBe(true);
  });

  test('TC-50.3 a run that ends on its own shows the Transcript up to the end without a reload', async ({ page }) => {
    // Held before the agent starts so the page is open when the agent finishes and the run ends by itself.
    const s = await startRun(page, '--fake-hold-start --fake-exit-ok');
    await openRun(page, s);
    await page.evaluate(() => Reflect.set(window, '__e2eNoReload', true));
    await touchPodFile(s.runId, 'release-start');
    await expect(pill(page, 'Succeeded')).toBeVisible({ timeout: 90_000 });
    await expect(log(page).getByText('Fake agent reply 1', { exact: true })).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => Reflect.get(window, '__e2eNoReload'))).toBe(true);
  });
});

test.describe('BR-51: two sessions, each entry once', () => {
  test('TC-51.1 messages of two sessions appear in order, each once, before and after a reload', async ({ page }) => {
    const s = await openLive(page, '');
    await exchange(page, 'FIRST-MARKER');
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 60_000 });

    await area(page).getByRole('button', { name: 'Resume' }).click();
    await expect(liveTerminal(page)).toContainText('Fake Claude Code', { timeout: 60_000 });
    await expect(pill(page, 'Needs you')).toBeVisible({ timeout: 30_000 });
    await exchange(page, 'SECOND-MARKER');
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 60_000 });

    const check = (texts: string[]) => {
      const first = texts.filter((t) => t === 'FIRST-MARKER');
      const second = texts.filter((t) => t === 'SECOND-MARKER');
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(texts.indexOf('FIRST-MARKER')).toBeLessThan(texts.indexOf('SECOND-MARKER'));
    };
    check((await transcriptOf(page, s.runId)).map((e) => e.text));
    await expect(log(page).getByText('SECOND-MARKER', { exact: true })).toBeVisible();
    check(await shownTexts(page));
    await page.reload();
    await expect(log(page).getByText('SECOND-MARKER', { exact: true })).toBeVisible({ timeout: 15_000 });
    check(await shownTexts(page));
  });
});

test.describe('BR-52: a pod killed hard', () => {
  /** A run killed hard in the middle of a turn; returns once it is paused. */
  async function killedMidTurn(page: Page): Promise<Started> {
    const s = await openLive(page, '--fake-unflushed');
    await typeLine(page, 'MID-TURN');
    await expect(pill(page, 'Running')).toBeVisible({ timeout: 15_000 });
    await touchPodFile(s.runId, 'hardkill');
    await waitForStatus(page, s.runId, 'paused', 90_000);
    return s;
  }

  test('TC-52.1 a run killed in the middle of a turn shows paused with the entries up to the step in progress', async ({
    page,
  }) => {
    const s = await killedMidTurn(page);
    await openRun(page, s);
    await expect(pill(page, 'Paused')).toBeVisible();
    await expect(log(page).getByText('Fake agent reply 1', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(log(page).getByText('MID-TURN', { exact: true })).toBeVisible();
    await expect(page.getByText('UNFLUSHED-MARKER')).toHaveCount(0);
  });

  test('TC-52.2 after Resume and Stop session the entries written after the last save appear too', async ({ page }) => {
    const s = await killedMidTurn(page);
    await openRun(page, s);
    await area(page).getByRole('button', { name: 'Resume' }).click();
    await expect(liveTerminal(page)).toContainText('Fake Claude Code', { timeout: 60_000 });
    await expect(pill(page, 'Needs you')).toBeVisible({ timeout: 30_000 });
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 60_000 });
    await expect(log(page).getByText('UNFLUSHED-MARKER', { exact: true })).toBeVisible({ timeout: 15_000 });
    expect((await transcriptOf(page, s.runId)).map((e) => e.text)).toContain('UNFLUSHED-MARKER');
  });
});

test.describe('BR-53: secrets are masked', () => {
  /**
   * The agent's own messages cannot be chosen in the fake pod, so the value is typed into the terminal: a typed line
   * becomes a `user` entry and redaction applies to every kind of entry.
   */
  async function typedThenStopped(page: Page, pick: (s: { workspaceToken: string; credential: string }) => string) {
    const s = await openLive(page, '');
    const secret = pick(await runSecrets(s.runId));
    await exchange(page, `my value is ${secret}`);
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 60_000 });
    await expect(log(page).getByText('Fake agent reply 2', { exact: true })).toBeVisible({ timeout: 15_000 });
    const everything = (await transcriptOf(page, s.runId)).map((e) => e.text).join('\n');
    expect(everything).toContain('my value is');
    expect(everything).not.toContain(secret);
    expect(await page.locator('body').innerText()).not.toContain(secret);
  }

  test('TC-53.1 the run workspace token is not present in the Transcript', async ({ page }) => {
    await typedThenStopped(page, (s) => s.workspaceToken);
  });

  test('TC-53.2 the agent credential is not present in the Transcript', async ({ page }) => {
    await typedThenStopped(page, (s) => s.credential);
  });

  test('TC-53.3 ordinary text that is not a secret is shown unchanged', async ({ page }) => {
    const s = await openLive(page, '');
    await exchange(page, 'ordinary text, nothing secret here');
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 60_000 });
    await expect(log(page).getByText('ordinary text, nothing secret here', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    expect((await transcriptOf(page, s.runId)).map((e) => e.text)).toContain('ordinary text, nothing secret here');
  });
});

test.describe('BR-54: the 20,000-entry limit', () => {
  test.describe.configure({ timeout: 600_000 });

  test('TC-54.1 with 19,999 entries the newest is the last one sent and there is no limit notice', async ({ page }) => {
    const s = await startRun(page, '--fake-transcript-bulk=19999');
    await waitForStatus(page, s.runId, 'idle', 120_000);
    await openRun(page, s);
    await expect(liveTerminal(page)).toContainText('Fake Claude Code', { timeout: 15_000 });
    await stopIdle(page);
    await expect(log(page).getByText('bulk reply 19998', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(log(page).getByText(LIMIT_NOTICE, { exact: true })).toHaveCount(0);
    const all = await transcriptOf(page, s.runId);
    expect(all).toHaveLength(19_999);
    expect(all.at(-1)?.text).toBe('bulk reply 19998');
    expect(all.some((e) => e.text === LIMIT_NOTICE)).toBe(false);
  });

  test('TC-54.2 and TC-54.3 at 20,000 entries the run goes on, then one notice is newest and OVER-LIMIT is not shown', async ({
    page,
  }) => {
    const s = await startRun(page, '--fake-transcript-bulk=20000');
    await waitForStatus(page, s.runId, 'idle', 120_000);
    await openRun(page, s);
    // TC-54.3: the run itself continues normally: the live terminal takes input and the turn runs and ends.
    await expect(liveTerminal(page)).toContainText('Fake Claude Code', { timeout: 15_000 });
    await expect(pill(page, 'Needs you')).toBeVisible();
    await exchange(page, 'OVER-LIMIT');
    await expect(liveTerminal(page)).toContainText('OVER-LIMIT');
    expect((await runOf(page, s.runId)).status).toBe('idle');

    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 60_000 });
    await expect(log(page).getByText(LIMIT_NOTICE, { exact: true })).toBeVisible({ timeout: 60_000 });
    const all = await transcriptOf(page, s.runId);
    expect(all.at(-1)?.text).toBe(LIMIT_NOTICE);
    expect(all.filter((e) => e.text === LIMIT_NOTICE)).toHaveLength(1);
    expect(all.some((e) => e.text.includes('OVER-LIMIT'))).toBe(false);
    await expect(page.getByText('OVER-LIMIT')).toHaveCount(0);
  });
});

test.describe('BR-55: malformed transcript marker lines', () => {
  const badBody = Buffer.from('{"id":"a b","kind":"agent","text":"x"}').toString('base64');
  const lines = {
    oversize: 'agentdesk: transcript AAAAAAAA',
    'bad encoding': 'agentdesk: transcript !!!',
    'invalid fields': `agentdesk: transcript ${badBody.slice(0, 40)}`,
  } as const;

  async function malformed(page: Page, which: keyof typeof lines): Promise<void> {
    const s = await openLive(page, '--fake-bad-transcript-lines');
    // The line is ordinary text in the live terminal.
    await expect(liveTerminal(page)).toContainText(lines[which], { timeout: 15_000 });
    await stopIdle(page);
    await expect(log(page).getByText('Fake agent reply 1', { exact: true })).toBeVisible({ timeout: 15_000 });
    const texts = (await transcriptOf(page, s.runId)).map((e) => e.text);
    expect(texts.some((t) => t.includes('agentdesk: transcript'))).toBe(false);
    expect(texts.some((t) => t === 'x' || t.startsWith('AAAAAAAA'))).toBe(false);
    await expect(page.getByText('agentdesk: transcript')).toHaveCount(0);
  }

  test('TC-55.1 an oversize marker line is terminal text, not a Transcript entry', async ({ page }) => {
    await malformed(page, 'oversize');
  });

  test('TC-55.2 a marker line with bad encoding is terminal text, not a Transcript entry', async ({ page }) => {
    await malformed(page, 'bad encoding');
  });

  test('TC-55.3 a marker line with invalid fields is terminal text, not a Transcript entry', async ({ page }) => {
    await malformed(page, 'invalid fields');
  });
});

test.describe('BR-56: agent-side error notice', () => {
  test('TC-56.2 a run that fails with a rejected credential shows the API error as a centred notice under the prompt', async ({
    page,
  }) => {
    const s = await startRun(page, '--fake-api-error');
    await waitForStatus(page, s.runId, 'paused', 90_000);
    await openRun(page, s);
    const notice = log(page).getByText('API Error: 401 invalid credential', { exact: true });
    await expect(notice).toBeVisible({ timeout: 15_000 });
    expect(await noticeLook(notice)).toEqual({ rules: ['1px', '1px'], centred: true });
    const prompt = await log(page).locator('p').first().boundingBox();
    const error = await notice.boundingBox();
    expect(error?.y ?? 0).toBeGreaterThan(prompt?.y ?? Infinity);
    await expect(log(page).locator('p').first()).toContainText('/code-review');
  });
});
