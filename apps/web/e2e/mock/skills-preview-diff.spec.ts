import { expect, test, type Page } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

// The Skills editor's Preview and Diff views, against the qa-e2e fixture (src/mocks/skills.ts). Each test starts from
// one goto (the mock store reseeds on every load) and then moves by clicks.

const SKILL = `/o/${ORG}/p/${INVOICER_API}/desk/skills?skill=qa-e2e`;
const EMPTY_DIFF = 'No changes. The editor matches main.';

const open = async (page: Page) => {
  await page.goto(SKILL);
  await expect(page.getByRole('textbox', { name: 'SKILL.md source' })).toBeVisible();
};
const view = (page: Page, name: 'Edit' | 'Preview' | 'Diff') =>
  page.getByRole('radiogroup', { name: 'Editor view' }).getByRole('radio', { name }).click();
const source = (page: Page) => page.getByRole('textbox', { name: 'SKILL.md source' });
const preview = (page: Page) => page.getByRole('region', { name: 'Skill preview' });
const diff = (page: Page) => page.getByRole('region', { name: 'Changes against main' });
const commit = (page: Page) => page.getByRole('button', { name: 'Commit to main' });
const unsaved = (page: Page) => page.getByText('Unsaved changes');

test('Preview shows the skill as formatted Markdown with its diagram', async ({ page }) => {
  await open(page);
  await view(page, 'Preview');
  const region = preview(page);
  await expect(region.getByRole('term').filter({ hasText: /^name$/ })).toBeVisible();
  await expect(region.getByRole('definition').filter({ hasText: /^qa-e2e$/ })).toBeVisible();
  await expect(region.getByRole('heading', { level: 3, name: 'qa-e2e' })).toBeVisible();
  await expect(region.getByRole('table')).toBeVisible();
  await expect(region.getByRole('columnheader', { name: 'What to try' })).toBeVisible();
  await expect(region.locator('svg').filter({ hasText: 'Explore' }).first()).toBeVisible();
  // Streamdown draws a diagram once it is scrolled near the view, so bring the broken fence into the column first.
  await region.getByRole('heading', { name: 'Not drawn' }).scrollIntoViewIfNeeded();
  await expect(region.getByText('This diagram could not be drawn')).toHaveCount(1);
  await expect(source(page)).toHaveCount(0);
});

test('Preview shows an unsaved edit', async ({ page }) => {
  await open(page);
  await source(page).fill('# Draft heading\n\nNew text');
  await view(page, 'Preview');
  await expect(preview(page).getByRole('heading', { level: 3, name: 'Draft heading' })).toBeVisible();
  await expect(unsaved(page)).toBeVisible();
});

test('Diff with no edits says the editor matches main', async ({ page }) => {
  await open(page);
  await view(page, 'Diff');
  await expect(diff(page).getByText(EMPTY_DIFF)).toBeVisible();
});

test('Diff shows removed and added lines, and Discard empties it', async ({ page }) => {
  await open(page);
  await source(page).fill((await source(page).inputValue()).replace('Open the PR preview', 'Open the preview'));
  await view(page, 'Diff');
  const del = diff(page).locator('[data-kind="del"]');
  const add = diff(page).locator('[data-kind="add"]');
  await expect(del).toHaveCount(1);
  await expect(del).toContainText('Open the PR preview and try');
  await expect(del).toContainText('Removed');
  await expect(add).toHaveCount(1);
  await expect(add).toContainText('Open the preview and try');
  await expect(add).toContainText('Added');
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(diff(page).getByText(EMPTY_DIFF)).toBeVisible();
});

test('switching views keeps the draft, and Commit works from Preview and Diff', async ({ page }) => {
  await open(page);
  await source(page).fill('# First edit');
  await view(page, 'Preview');
  await view(page, 'Diff');
  await view(page, 'Edit');
  await expect(source(page)).toHaveValue('# First edit');

  await view(page, 'Diff');
  await commit(page).click();
  await expect(unsaved(page)).toHaveCount(0);
  // After a commit the route remounts the editor in Edit, so open Diff again.
  await view(page, 'Diff');
  await expect(unsaved(page)).toHaveCount(0);
  await expect(diff(page).getByText(EMPTY_DIFF)).toBeVisible();

  await view(page, 'Edit');
  await source(page).fill('# Second edit');
  await view(page, 'Preview');
  await expect(unsaved(page)).toBeVisible();
  await commit(page).click();
  await expect(unsaved(page)).toHaveCount(0);
});

test('a diagram that tries to loosen Mermaid security stays strict', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await open(page);
  const text = [
    '# Loose',
    '',
    '```mermaid',
    '%%{init: {"securityLevel": "loose"}}%%',
    'flowchart LR',
    '  A["<img src=x onerror=alert(1)>"] --> B',
    '  click A call alert(1)',
    '```',
  ].join('\n');
  await source(page).fill(text);
  await view(page, 'Preview');
  const region = preview(page);
  await expect(region.locator('svg').first()).toBeVisible();
  await expect(region.locator('img')).toHaveCount(0);
  await expect(region.locator('[onerror]')).toHaveCount(0);
  await region.locator('svg g.node').first().click();
  // A dialog event is delivered before this round trip resolves, so no fixed sleep is needed.
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  expect(dialogs).toEqual([]);
});

test('a diagram that tries to replace the sanitiser config still never fetches an image', async ({ page }) => {
  const attacker: string[] = [];
  await page.route(/attacker\.example/, (route) => {
    attacker.push(route.request().url());
    return route.abort();
  });
  await open(page);
  const text = [
    '# Swap',
    '',
    '```mermaid',
    '%%{init: {"dompurifyConfig": {}}}%%',
    'flowchart LR',
    '  A["<img src=https://attacker.example/p.png>"] --> B',
    '```',
  ].join('\n');
  await source(page).fill(text);
  await view(page, 'Preview');
  const region = preview(page);
  await expect(region.locator('svg').first()).toBeVisible();
  await expect(region.locator('img')).toHaveCount(0);
  // Let any image the browser was going to fetch start, then check none did.
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  expect(attacker).toEqual([]);
});

test('wide preview content scrolls inside the editor column', async ({ page }) => {
  await open(page);
  const wide = 'x'.repeat(400);
  const text = `# Wide\n\n| A | B |\n| --- | --- |\n| ${wide} | y |\n\n\`\`\`\n${wide}\n\`\`\`\n`;
  await source(page).fill(text);
  await view(page, 'Preview');
  await expect(preview(page).getByRole('table')).toBeVisible();
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(sizes.scroll).toBe(sizes.inner);
  await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toBeInViewport();
  await expect(commit(page)).toBeInViewport();
});

test('Preview and Diff keep the header and commit bar in view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 300 });
  await open(page);
  const body = await source(page).inputValue();
  await source(page).fill(body.replace('Open the PR preview', 'Open the preview'));
  for (const name of ['Preview', 'Diff'] as const) {
    await view(page, name);
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toBeInViewport();
    await expect(commit(page)).toBeInViewport();
    const o = await page.evaluate(() => ({
      scroll: document.documentElement.scrollHeight,
      inner: window.innerHeight,
    }));
    expect(o.scroll).toBe(o.inner);
  }
});
