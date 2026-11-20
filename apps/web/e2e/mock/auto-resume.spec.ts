import { expect, test } from '@playwright/test';
import {
  AUTO_FAILED_GAVE_UP_RUN,
  AUTO_RESUMED_RUNNING_RUN,
  AUTO_WAITING_RUN,
  CRASHED_GAVE_UP_RUN,
  GAVE_UP_ONCE_RUN,
  GAVE_UP_RUN,
  INVOICER_API,
  KILLED_RUN,
  ORG,
} from './mock';

const runUrl = (number: number) => `/o/${ORG}/p/${INVOICER_API}/runs/${number}`;
const field = (page: import('@playwright/test').Page) => page.getByLabel('Automatic resumes after a crash');
const GAVE_UP_TEXT = /Tried to resume automatically/;

test('Automatic resumes after a crash shows 5 by default with its help text', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
  await expect(field(page)).toHaveValue('5');
  await expect(page.getByText(/resumes by itself after its pod is killed or the agent crashes/)).toBeVisible();
  await expect(
    page.getByText(/Typing in the terminal or pressing Resume starts the count again\. 0 turns it off\./),
  ).toBeVisible();
});

test('a saved change to 2 is shown again after leaving the page', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
  await field(page).fill('2');
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText('Limits saved')).toBeVisible();

  // Leave by link (a reload would reseed the mock store) and come back: the saved value is read from the agent.
  await page.getByRole('link', { name: 'Routing rules' }).click();
  await page.getByRole('link', { name: 'Agent & settings' }).click();
  await expect(field(page)).toHaveValue('2');
});

test('12 is refused with "Automatic resumes must be between 0 and 10", the field marked invalid, and nothing saved', async ({
  page,
}) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
  await field(page).fill('12');
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText('Automatic resumes must be between 0 and 10')).toBeVisible();
  await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Limits saved')).toHaveCount(0);

  // Nothing was saved: leave by link (a reload would reseed the mock store) and come back, the agent still has 5.
  await page.getByRole('link', { name: 'Routing rules' }).click();
  await page.getByRole('link', { name: 'Agent & settings' }).click();
  await expect(field(page)).toHaveValue('5');
});

test('a killed run with automatic resume off or not tried shows no gave-up line', async ({ page }) => {
  await page.goto(runUrl(KILLED_RUN));
  await expect(page.getByText('Paused: the pod was killed, most likely out of memory (exit code 137)')).toBeVisible();
  await expect(page.getByText(GAVE_UP_TEXT)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
});

test('a run that gave up after 5 tries shows "Tried to resume automatically 5 times."', async ({ page }) => {
  await page.goto(runUrl(GAVE_UP_RUN));
  await expect(page.getByText('Paused: the pod was killed, most likely out of memory (exit code 137)')).toBeVisible();
  const detail = page.getByText(/^Paused .*, the pod stopped unexpectedly .*\. Can be resumed for /);
  await expect(detail).toBeVisible();
  const line = page.getByText('Tried to resume automatically 5 times.');
  await expect(line).toBeVisible();
  // Under the "Paused ... Can be resumed for ..." line.
  const detailBox = await detail.boundingBox();
  const lineBox = await line.boundingBox();
  expect(lineBox?.y ?? 0).toBeGreaterThan(detailBox?.y ?? Number.POSITIVE_INFINITY);
});

test('a run that gave up after 1 try shows "Tried to resume automatically 1 time."', async ({ page }) => {
  await page.goto(runUrl(GAVE_UP_ONCE_RUN));
  await expect(page.getByText('Tried to resume automatically 1 time.')).toBeVisible();
});

test('a crashed run that gave up shows "Paused: agent crashed (exit code 1)" and the 5-times line', async ({
  page,
}) => {
  await page.goto(runUrl(CRASHED_GAVE_UP_RUN));
  await expect(page.getByText('Paused: agent crashed (exit code 1)')).toBeVisible();
  await expect(page.getByText('Tried to resume automatically 5 times.')).toBeVisible();
});

test('while waiting between tries the page shows "Resume failed: the pod could not start" and no gave-up line', async ({
  page,
}) => {
  await page.goto(runUrl(AUTO_WAITING_RUN));
  await expect(page.getByText('Resume failed: the pod could not start')).toBeVisible();
  await expect(page.getByText(GAVE_UP_TEXT)).toHaveCount(0);
});

test('when the last try could not start the page shows the Resume failed bar and the gave-up line', async ({
  page,
}) => {
  await page.goto(runUrl(AUTO_FAILED_GAVE_UP_RUN));
  await expect(page.getByText('Resume failed: the pod could not start')).toBeVisible();
  await expect(page.getByText('Tried to resume automatically 5 times.')).toBeVisible();
});

test("a running run's Lifecycle list shows the automatic resume line", async ({ page }) => {
  await page.goto(runUrl(AUTO_RESUMED_RUNNING_RUN));
  const lifecycle = page.getByText('Lifecycle', { exact: true }).locator('xpath=ancestor::section[1]');
  const line = 'The last session was killed (OOMKilled, exit 137, limit 3Gi). Resuming automatically, try 1 of 5.';
  await expect(lifecycle.getByText(line)).toBeVisible();
  const text = await lifecycle.innerText();
  expect(text.indexOf('Claude Code started')).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(line)).toBeGreaterThan(text.indexOf('Claude Code started'));
  expect(text.indexOf('Pod running', text.indexOf(line))).toBeGreaterThan(text.indexOf(line));
});
