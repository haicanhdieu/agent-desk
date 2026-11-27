import { expect, test, type Page } from '@playwright/test';
import {
  ENDING_RUN,
  FINISHED_AFTER_PAUSE_RUN,
  EXPIRED_STOPPED_RUN,
  IDLE_RUN,
  INVOICER_API,
  ORG,
  PAUSED_RUN,
  SESSION_MOCK_NOW,
  STOPPED_DAY_RUN,
  STOPPED_ISSUE_RUN,
  STOPPED_LATE_RUN,
  STOPPED_NOW_RUN,
  STOPPED_RUN,
  STOP_DONE_ENDING_RUN,
  STOP_DONE_RUN,
  STOP_IDLE_RUN,
  STOP_RUNNING_ENDING_RUN,
  STOP_RUNNING_RUN,
  TRANSCRIPT_FAILED_RUN,
  runHeader,
} from './mock';

/*
 * Stop session control and stopped notices (spec 2026-11-19 "E2E requirements", BR-1 to BR-5, BR-17 to BR-20, BR-25
 * to BR-27). Runs 72 to 97 are seeded into the browser mock only (src/mocks/dto/sessionRuns.ts). Every test installs
 * the fixed clock before its first goto, so relative times ("Stopped by you 2 min ago.") hold.
 */
test.describe.configure({ timeout: 60_000 });

const runUrl = (number: number) => `/o/${ORG}/p/${INVOICER_API}/runs/${number}`;
/** A succeeded run that was never paused (fixtures: dto/runs.ts). */
const PLAIN_SUCCEEDED_RUN = 60;

async function open(page: Page, number: number): Promise<void> {
  await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
  await page.goto(runUrl(number));
}

const stopButton = (page: Page) => runHeader(page).getByRole('button', { name: 'Stop session' });
const terminalArea = (page: Page) => page.getByRole('region', { name: /^(Terminal|Transcript)$/ });
const liveTerminal = (page: Page) => page.getByRole('group', { name: 'Claude Code terminal' });
const pill = (page: Page, label: string) => runHeader(page).getByText(label, { exact: true });

/** The top bar's action buttons, in page order. */
async function actionOrder(page: Page): Promise<string[]> {
  const names = await runHeader(page)
    .getByRole('button', { name: /^(Finish run|Finish|Stop session|Cancel run)$/ })
    .allTextContents();
  return names.map((n) => n.trim());
}

test.describe('BR-1: Stop session is shown on live runs only', () => {
  test('TC-1.1 a running run shows Stop session with a pause icon between Finish run and Cancel run', async ({
    page,
  }) => {
    await open(page, STOP_RUNNING_RUN);
    await expect(stopButton(page)).toBeVisible();
    await expect(stopButton(page).locator('svg')).toBeVisible();
    expect(await actionOrder(page)).toEqual(['Finish', 'Stop session', 'Cancel run']);
  });

  test('TC-1.2 an idle run shows Stop session between Finish run and Cancel run', async ({ page }) => {
    await open(page, STOP_IDLE_RUN);
    await expect(stopButton(page)).toBeVisible();
    expect(await actionOrder(page)).toEqual(['Finish run', 'Stop session', 'Cancel run']);
  });

  test('TC-1.3 a done run shows Stop session between Finish run and Cancel run', async ({ page }) => {
    await open(page, STOP_DONE_RUN);
    await expect(stopButton(page)).toBeVisible();
    expect(await actionOrder(page)).toEqual(['Finish run', 'Stop session', 'Cancel run']);
  });

  test('TC-1.4 a run paused by the idle timeout has no Stop session button', async ({ page }) => {
    await open(page, PAUSED_RUN);
    await expect(pill(page, 'Paused')).toBeVisible();
    await expect(stopButton(page)).toHaveCount(0);
  });

  test('TC-1.5 a stopped run has no Stop session button', async ({ page }) => {
    await open(page, STOPPED_RUN);
    await expect(pill(page, 'Paused')).toBeVisible();
    await expect(stopButton(page)).toHaveCount(0);
  });

  test('TC-1.6 a succeeded run has no Stop session button', async ({ page }) => {
    await open(page, PLAIN_SUCCEEDED_RUN);
    await expect(pill(page, 'Succeeded')).toBeVisible();
    await expect(stopButton(page)).toHaveCount(0);
  });

  test('TC-1.7 a failed run has no Stop session button', async ({ page }) => {
    await open(page, TRANSCRIPT_FAILED_RUN);
    await expect(pill(page, 'Failed')).toBeVisible();
    await expect(stopButton(page)).toHaveCount(0);
  });
});

test.describe('BR-2: Stop session is disabled while the session is ending', () => {
  test('TC-2.1 a running run with nothing ending has Stop session enabled', async ({ page }) => {
    await open(page, STOP_RUNNING_RUN);
    await expect(stopButton(page)).toBeEnabled();
  });

  for (const [id, label, run] of [
    ['TC-2.2', 'idle', ENDING_RUN],
    ['TC-2.3', 'running', STOP_RUNNING_ENDING_RUN],
    ['TC-2.4', 'done', STOP_DONE_ENDING_RUN],
  ] as const) {
    test(`${id} a ${label} run whose session is ending has Stop session disabled with the tooltip`, async ({
      page,
    }) => {
      await open(page, run);
      await expect(page.getByText('Session ending…')).toBeVisible();
      await stopButton(page).hover({ force: true });
      await expect(stopButton(page)).toBeDisabled();
      await expect(stopButton(page)).toHaveAttribute('title', 'The session is already ending');
    });
  }
});

test.describe('BR-3: Stop session is disabled while another action is pending', () => {
  test('TC-3.1 Stop session is disabled while a Finish request is pending', async ({ page }) => {
    await open(page, STOP_IDLE_RUN);
    await expect(stopButton(page)).toBeEnabled();
    await runHeader(page).getByRole('button', { name: 'Finish run' }).click();
    await expect(runHeader(page).getByText('Finishing…')).toBeVisible();
    await expect(stopButton(page)).toBeDisabled();
  });

  test('TC-3.2 Stop session is disabled while a Cancel request is pending', async ({ page }) => {
    await open(page, STOP_RUNNING_RUN);
    await runHeader(page).getByRole('button', { name: 'Cancel run' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel run' }).click();
    await expect(runHeader(page).getByText('Cancelling…')).toBeVisible();
    await expect(stopButton(page)).toBeDisabled();
  });

  test('TC-3.3 an idle run with no action pending has Stop session enabled', async ({ page }) => {
    await open(page, STOP_IDLE_RUN);
    await expect(stopButton(page)).toBeEnabled();
  });
});

test.describe('BR-4: confirm popover when stopping a working agent', () => {
  const BODY =
    'The agent is in the middle of a step. Stopping now cuts that step short. Everything up to now is kept, and you can resume for 7 days.';

  test('TC-4.1 pressing Stop session on a running run opens the confirm with its body and buttons', async ({
    page,
  }) => {
    await open(page, STOP_RUNNING_RUN);
    await stopButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'Stop the session?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Stop the session?', { exact: true })).toBeVisible();
    await expect(dialog.getByText(BODY)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep running' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Stop session' })).toBeVisible();
  });

  test('TC-4.2 the run is not stopped until the confirm is answered', async ({ page }) => {
    await open(page, STOP_RUNNING_RUN);
    await stopButton(page).click();
    await expect(page.getByRole('dialog', { name: 'Stop the session?' })).toBeVisible();
    await expect(pill(page, 'Running')).toBeVisible();
    await expect(liveTerminal(page)).toBeVisible();
    await expect(page.getByText('Session ending…')).toHaveCount(0);
    await expect(page.getByText(/^Stopped: can be resumed for /)).toHaveCount(0);
  });
});

test.describe('BR-5: Keep running and Escape close the confirm', () => {
  test('TC-5.1 Keep running closes the popover and the run keeps running', async ({ page }) => {
    await open(page, STOP_RUNNING_RUN);
    await stopButton(page).click();
    await page.getByRole('dialog', { name: 'Stop the session?' }).getByRole('button', { name: 'Keep running' }).click();
    await expect(page.getByRole('dialog', { name: 'Stop the session?' })).toHaveCount(0);
    await expect(pill(page, 'Running')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Terminal', selected: true })).toBeVisible();
    await expect(liveTerminal(page)).toBeVisible();
  });

  test('TC-5.2 Escape closes the popover and the run keeps running', async ({ page }) => {
    await open(page, STOP_RUNNING_RUN);
    await stopButton(page).click();
    await expect(page.getByRole('dialog', { name: 'Stop the session?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Stop the session?' })).toHaveCount(0);
    await expect(pill(page, 'Running')).toBeVisible();
    await expect(liveTerminal(page)).toBeVisible();
  });

  test('TC-5.3 Stop session opens the same confirm again after Keep running', async ({ page }) => {
    await open(page, STOP_RUNNING_RUN);
    await stopButton(page).click();
    await page.getByRole('dialog', { name: 'Stop the session?' }).getByRole('button', { name: 'Keep running' }).click();
    await expect(page.getByRole('dialog', { name: 'Stop the session?' })).toHaveCount(0);
    await stopButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'Stop the session?' });
    await expect(dialog.getByText('Stop the session?', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/^The agent is in the middle of a step\./)).toContainText(
      'you can resume for 7 days.',
    );
  });
});

test.describe('BR-17: Stopped notice', () => {
  test('TC-17.1 a run stopped 2 minutes ago shows the Stopped notice, Resume, Finish and View PR', async ({ page }) => {
    await open(page, STOPPED_RUN);
    const area = terminalArea(page);
    await expect(area.getByRole('img', { name: 'Stopped' })).toBeVisible();
    // Stopped 2 minutes ago with a 7 day keep: 6 days 23 hours 58 minutes left, shown as the nearest unit.
    await expect(area.getByText('Stopped: can be resumed for 7 days.', { exact: true })).toBeVisible();
    await expect(area.getByText('Stopped by you 2 min ago.')).toBeVisible();
    const resume = area.getByRole('button', { name: 'Resume' });
    const finish = area.getByRole('button', { name: 'Finish', exact: true });
    await expect(resume).toBeVisible();
    await expect(finish).toBeVisible();
    // Resume is the primary (go) button, Finish the plain one; the notice has the paused (idle) tone.
    await expect(resume).toHaveClass(/go/);
    await expect(finish).not.toHaveClass(/go/);
    const notice = area
      .getByText('Stopped: can be resumed for 7 days.', { exact: true })
      .locator('xpath=ancestor::*[contains(@class,"idle")][1]');
    await expect(notice).toHaveCount(1);
    await expect(notice.getByRole('button', { name: 'Resume' })).toBeVisible();
    await expect(pill(page, 'Paused')).toBeVisible();
    await expect(runHeader(page).getByRole('link', { name: 'View PR' })).toBeVisible();
  });

  test('TC-17.2 a stopped run on an issue shows View issue and the Paused pill', async ({ page }) => {
    await open(page, STOPPED_ISSUE_RUN);
    await expect(runHeader(page).getByRole('link', { name: 'View issue' })).toBeVisible();
    await expect(pill(page, 'Paused')).toBeVisible();
  });

  test('TC-17.3 any viewer sees "Stopped by you"', async ({ page }) => {
    // The mock has one signed-in user and the run carries no stopper, so this is the notice as another viewer sees it.
    await open(page, STOPPED_RUN);
    await expect(page.getByText(/^Stopped by you .+\.$/)).toBeVisible();
  });
});

test.describe('BR-18: time left and relative stop time', () => {
  test('TC-18.1 a run stopped a day ago shows 6 days left', async ({ page }) => {
    await open(page, STOPPED_DAY_RUN);
    await expect(page.getByText('Stopped: can be resumed for 6 days.')).toBeVisible();
  });

  test('TC-18.2 a run stopped just now shows the full keep time', async ({ page }) => {
    await open(page, STOPPED_NOW_RUN);
    await expect(page.getByText('Stopped: can be resumed for 7 days.')).toBeVisible();
  });

  test('TC-18.3 the relative stop time updates by itself', async ({ page }) => {
    await open(page, STOPPED_RUN);
    await expect(page.getByText('Stopped by you 2 min ago.')).toBeVisible();
    await page.clock.fastForward('03:00');
    await expect(page.getByText('Stopped by you 5 min ago.')).toBeVisible();
  });

  test('TC-18.4 a run stopped 6 days 23 hours ago shows under one day left', async ({ page }) => {
    await open(page, STOPPED_LATE_RUN);
    const headline = page.getByText(/^Stopped: can be resumed for /);
    await expect(headline).toBeVisible();
    const text = (await headline.textContent()) ?? '';
    expect(text).not.toBe('Stopped: can be resumed for 7 days.');
    expect(text).not.toBe('Stopped: can be resumed for 6 days.');
  });
});

test.describe('BR-19: stopped run in the run list', () => {
  const runsUrl = `/o/${ORG}/p/${INVOICER_API}/runs`;
  const row = (page: Page) =>
    page.getByRole('row').filter({ has: page.getByRole('link', { name: `Run ${STOPPED_RUN}`, exact: true }) });

  async function openList(page: Page): Promise<void> {
    await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
    await page.goto(runsUrl);
  }
  const chip = (page: Page, label: string) => page.getByLabel('Filter by status').getByText(label, { exact: false });

  test('TC-19.1 the stopped run pill reads Paused in the run list', async ({ page }) => {
    await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
    // The list shows 20 runs a page, newest first: run 77 is on the third page of the seeded list.
    await page.goto(`${runsUrl}?page=3`);
    // The All chip is the default view; pressing it keeps the step that showed All reveals the paused row.
    await chip(page, 'All').first().click();
    await expect(row(page).getByText('Paused', { exact: true })).toBeVisible();
  });

  test('TC-19.3 the stopped run is listed under Needs you', async ({ page }) => {
    await openList(page);
    await chip(page, 'Needs you').first().click();
    await expect(row(page)).toBeVisible();
  });

  test('TC-19.4 the stopped run is not listed under Active', async ({ page }) => {
    await openList(page);
    await chip(page, 'Active').first().click();
    await expect(page.getByRole('link', { name: /^Run \d+$/ }).first()).toBeVisible();
    await expect(row(page)).toHaveCount(0);
  });
});

test.describe('BR-20: no "Waiting for you" section outside idle', () => {
  const waiting = (page: Page) => page.getByText('Waiting for you', { exact: true });

  test('TC-20.1 a stopped run has no Waiting for you section', async ({ page }) => {
    await open(page, STOPPED_RUN);
    await expect(pill(page, 'Paused')).toBeVisible();
    await expect(waiting(page)).toHaveCount(0);
  });

  test('TC-20.2 a run paused by the idle timeout has no Waiting for you section', async ({ page }) => {
    await open(page, PAUSED_RUN);
    await expect(pill(page, 'Paused')).toBeVisible();
    await expect(waiting(page)).toHaveCount(0);
  });

  test('TC-20.3 a succeeded run has no Waiting for you section', async ({ page }) => {
    await open(page, PLAIN_SUCCEEDED_RUN);
    await expect(pill(page, 'Succeeded')).toBeVisible();
    await expect(waiting(page)).toHaveCount(0);
  });

  test('TC-20.4 an idle run shows Waiting for you', async ({ page }) => {
    await open(page, IDLE_RUN);
    await expect(waiting(page)).toBeVisible();
  });
});

test.describe('BR-25: a plain succeeded run has no Finished line', () => {
  const FINISHED = 'Finished. The session was deleted and cannot be resumed.';

  test("TC-25.1 a run that succeeded without a pause shows today's notice and no Finished line", async ({ page }) => {
    await open(page, PLAIN_SUCCEEDED_RUN);
    await expect(pill(page, 'Succeeded')).toBeVisible();
    await expect(page.getByText(/^Succeeded in /)).toBeVisible();
    await expect(page.getByText(FINISHED)).toHaveCount(0);
  });

  test('TC-25.2 a run that was paused, resumed and finished shows the Finished line', async ({ page }) => {
    await open(page, FINISHED_AFTER_PAUSE_RUN);
    await expect(page.getByText(FINISHED)).toBeVisible();
  });
});

test.describe('BR-26: keep time runs out', () => {
  test('TC-26.1 an expired stopped run shows the expired notice, no Resume and the Transcript', async ({ page }) => {
    await open(page, EXPIRED_STOPPED_RUN);
    await expect(page.getByText('Nobody resumed this run within 7 days. The saved session was deleted.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);
    await expect(page.getByRole('log', { name: 'Transcript of the agent conversation' })).toBeVisible();
  });
});

test.describe('BR-27: a stopped run has no Cancel button', () => {
  test('TC-27.2 a stopped run shows no Cancel run button', async ({ page }) => {
    await open(page, STOPPED_RUN);
    await expect(pill(page, 'Paused')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel run' })).toHaveCount(0);
  });
});
