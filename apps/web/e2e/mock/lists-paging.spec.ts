import { expect, test, type Locator, type Page } from '@playwright/test';
import { ids } from '../../src/mocks/dto/ids';
import { INVOICER_API, ORG, seedLists, seedOnboarding } from './mock';

/*
 * The other paged screens and the readers that need the whole set (spec
 * docs/superpowers/specs/2026-11-19-shared-pagination-design.md, "E2E requirements": BR-1, BR-3, BR-5, BR-9, BR-11,
 * BR-13, BR-17, BR-18, BR-26 to BR-35). Each test seeds its own list sizes (mock.ts `seedLists`). The Runs screen and
 * the Pagination control itself are covered by runs-paging.spec.ts and pagination-control.spec.ts.
 *
 * Seeded rows are generated from their position: projects invoicer-api, project-02, ...; skills skill-01, ...; rules
 * with the commands code-task-01, ... (rule n uses skill-n); ignored commands and needs-you runs newest first.
 */

const PROJECT = `/o/${ORG}/p/${INVOICER_API}`;
const PROJECTS = `/o/${ORG}/projects`;
const RUNS = `${PROJECT}/runs`;
const NEEDS_YOU = `${PROJECT}/needs-you`;
const RULES = `${PROJECT}/desk/rules`;
const SKILLS = `${PROJECT}/desk/skills`;
const SETUP = `${PROJECT}/desk/setup`;

const nav = (page: Page) => page.getByRole('navigation', { name: 'Pagination' });
const rangeOf = (page: Page) => nav(page).locator('p');
const pageButton = (page: Page, n: number) => nav(page).getByRole('button', { name: `Page ${n}`, exact: true });
const step = (page: Page, name: 'Previous' | 'Next') => nav(page).getByRole('button', { name, exact: true });
const sizeSelect = (page: Page) => nav(page).getByLabel('Rows per page');
const pageParam = (page: Page) => new URL(page.url()).searchParams.get('page');
const loadingArea = (page: Page) => page.getByRole('status', { name: 'Loading' });
const retry = (page: Page) => page.getByRole('button', { name: 'Retry' });
const chip = (page: Page, label: string) =>
  page.getByRole('main').getByRole('link', { name: new RegExp(`^${label}\\s*[\\d,]+$`) });

const projectRows = (page: Page) => page.getByRole('table').locator('tbody tr');
const projectNames = (page: Page) => page.getByRole('table').locator('tbody tr td:first-child a');
const ignoredRows = (page: Page) => page.getByRole('link', { name: /^Comment on / });
const needsYouCards = (page: Page) => page.getByRole('link', { name: /^Open run \d+ in Agent Desk$/ });
const ruleRows = (page: Page) => page.getByRole('button', { name: /^Edit rule \// });
const skillItems = (page: Page) => page.getByRole('navigation', { name: 'Skills' }).getByRole('listitem');
const versionItems = (page: Page) => page.getByRole('list', { name: 'Setup script versions' }).getByRole('listitem');
const versionsHeader = (page: Page, count: number) => page.getByText(`${count} versions`, { exact: true });

const two = (n: number) => String(n).padStart(2, '0');
/** Rule `n` of the seeded rules (see e2eLists.ts). */
const ruleId = (n: number) => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The pages where all rows of a list sit on one page: no pagination control at all. */
async function expectNoControl(page: Page): Promise<void> {
  await expect(nav(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Page \d+$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Go to page')).toHaveCount(0);
  await expect(page.getByLabel('Rows per page')).toHaveCount(0);
}

test.describe('Projects', () => {
  test('TC-3.1: 20 projects show all 20 rows and no pagination control', async ({ page }) => {
    await seedLists(page, { projects: 20 });
    await page.goto(PROJECTS);
    await expect(projectRows(page)).toHaveCount(20);
    await expectNoControl(page);
    await expect(page.getByText(/Showing \d/)).toHaveCount(0);
  });

  test('TC-3.2: 21 projects show 20 rows and the control with page buttons and "Rows per page"', async ({ page }) => {
    await seedLists(page, { projects: 21 });
    await page.goto(PROJECTS);
    await expect(projectRows(page)).toHaveCount(20);
    await expect(nav(page)).toBeVisible();
    await expect(pageButton(page, 1)).toBeVisible();
    await expect(pageButton(page, 2)).toBeVisible();
    await expect(sizeSelect(page)).toBeVisible();
    const table = await page.getByRole('table').boundingBox();
    const control = await nav(page).boundingBox();
    expect(table).not.toBeNull();
    expect(control).not.toBeNull();
    expect(control!.y).toBeGreaterThanOrEqual(table!.y + table!.height - 1);
  });

  test('TC-28.1: 26 projects: 20 rows, then page 2 with 6 rows and "Showing 21–26 of 26" under the table', async ({
    page,
  }) => {
    await seedLists(page, { projects: 26 });
    await page.goto(PROJECTS);
    await expect(projectRows(page)).toHaveCount(20);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 26');
    await pageButton(page, 2).click();
    await expect(projectRows(page)).toHaveCount(6);
    await expect(rangeOf(page)).toHaveText('Showing 21–26 of 26');
    const table = await page.getByRole('table').boundingBox();
    const control = await nav(page).boundingBox();
    expect(control!.y).toBeGreaterThanOrEqual(table!.y + table!.height - 1);
  });

  test('TC-28.2: 20 projects show 20 rows and no control', async ({ page }) => {
    await seedLists(page, { projects: 20 });
    await page.goto(PROJECTS);
    await expect(projectRows(page)).toHaveCount(20);
    await expect(nav(page)).toHaveCount(0);
  });

  test('TC-5.3: "Page 2" on 26 projects shows rows 21 to 26, the range and ?page=2', async ({ page }) => {
    await seedLists(page, { projects: 26 });
    await page.goto(PROJECTS);
    await pageButton(page, 2).click();
    await expect(rangeOf(page)).toHaveText('Showing 21–26 of 26');
    await expect(projectRows(page)).toHaveCount(6);
    expect(await projectNames(page).allTextContents()).toEqual(
      [21, 22, 23, 24, 25, 26].map((n) => `project-${two(n)}`),
    );
    expect(pageParam(page)).toBe('2');
    await expect(pageButton(page, 2)).toHaveAttribute('aria-current', 'page');
  });

  test('TC-9.6: page 2 of Projects is still shown after a reload', async ({ page }) => {
    await seedLists(page, { projects: 26 });
    await page.goto(PROJECTS);
    await pageButton(page, 2).click();
    await expect(rangeOf(page)).toHaveText('Showing 21–26 of 26');
    await page.reload();
    await expect(rangeOf(page)).toHaveText('Showing 21–26 of 26');
    await expect(projectRows(page)).toHaveCount(6);
    expect(pageParam(page)).toBe('2');
  });

  test('TC-18.3: a failing Projects request shows the route error with the request ID and Retry', async ({ page }) => {
    await seedLists(page, { projects: 26, fail: [{ route: 'projects.list' }] });
    await page.goto(PROJECTS);
    await expect(page.getByText('Internal server error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Request ID: \S+/)).toBeVisible();
    await expect(retry(page)).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  });
});

test.describe('Across lists', () => {
  test('TC-1.4: each screen holds 20 rows on its first page with no page size saved', async ({ page }) => {
    await seedLists(page, { projects: 26, skills: 22, rules: 24, versions: 23, ignored: 27, needsYou: 21 });
    await page.goto(PROJECTS);
    await expect(projectRows(page)).toHaveCount(20);
    await page.goto(RULES);
    await expect(ruleRows(page)).toHaveCount(20);
    await page.goto(SKILLS);
    await expect(skillItems(page)).toHaveCount(20);
    await page.goto(SETUP);
    await expect(versionItems(page)).toHaveCount(20);
    await page.goto(`${RUNS}?filter=ignored`);
    await expect(ignoredRows(page)).toHaveCount(20);
    await page.goto(NEEDS_YOU);
    await expect(needsYouCards(page)).toHaveCount(20);
  });

  test('TC-13.2: picking 50 on Runs makes Projects use 50 per page', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 }, projects: 26 });
    await page.goto(RUNS);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 63');
    await sizeSelect(page).selectOption('50');
    await expect(rangeOf(page)).toHaveText('Showing 1–50 of 63');
    await page.getByRole('link', { name: 'Agent Desk, all projects' }).click();
    await expect(projectRows(page)).toHaveCount(26);
    await expect(nav(page)).toBeVisible();
    await expect(sizeSelect(page)).toHaveValue('50');
  });

  test('TC-13.3: picking 100 on Projects makes Runs show all 63 runs on one page', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 }, projects: 26 });
    await page.goto(PROJECTS);
    await expect(projectRows(page)).toHaveCount(20);
    await sizeSelect(page).selectOption('100');
    await expect(projectRows(page)).toHaveCount(26);
    await page.getByRole('link', { name: 'invoicer-api', exact: true }).click();
    await expect(page.getByRole('link', { name: /^Run \d+$/ })).toHaveCount(63);
    await expect(sizeSelect(page)).toHaveValue('100');
  });

  const held = [
    { screen: 'Projects', path: PROJECTS, lists: { projects: 26 }, route: 'projects.list' },
    { screen: 'Desk Rules', path: RULES, lists: { rules: 24 }, route: 'rules.list' },
    { screen: 'Desk Skills', path: SKILLS, lists: { skills: 22 }, route: 'skills.list' },
    { screen: 'Needs you', path: NEEDS_YOU, lists: { needsYou: 21 }, route: 'runs.list' },
  ] as const;
  for (const { screen, path, lists, route } of held) {
    test(`TC-17.2: ${screen} shows the busy status area while its response is held back`, async ({ page }) => {
      await seedLists(page, { ...lists, hold: [{ route, ms: 3000 }] });
      await page.goto(path);
      await expect(loadingArea(page)).toBeVisible();
      await expect(loadingArea(page)).toHaveAttribute('aria-busy', 'true');
      await expect(nav(page)).toHaveCount(0);
      await expect(
        page.getByText(/No (routing rules|skills|runs need you) yet|No runs need you right now/),
      ).toHaveCount(0);
      await expect(projectRows(page)).toHaveCount(0);
      await expect(ruleRows(page)).toHaveCount(0);
      await expect(needsYouCards(page)).toHaveCount(0);
    });
  }
});

test.describe('Ignored', () => {
  test('TC-11.2: no ignored commands show "No ignored commands" and no control', async ({ page }) => {
    await seedLists(page, { ignored: 0 });
    await page.goto(`${RUNS}?filter=ignored`);
    await expect(page.getByRole('heading', { name: 'No ignored commands' })).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  });

  test('TC-26.1: 27 ignored commands: 20 rows, then page 2 with 7 rows and "Showing 21–27 of 27" under them', async ({
    page,
  }) => {
    await seedLists(page, { ignored: 27 });
    await page.goto(RUNS);
    await chip(page, 'Ignored').click();
    await expect(ignoredRows(page)).toHaveCount(20);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 27');
    await pageButton(page, 2).click();
    await expect(ignoredRows(page)).toHaveCount(7);
    await expect(rangeOf(page)).toHaveText('Showing 21–27 of 27');
    const last = await ignoredRows(page).last().boundingBox();
    const control = await nav(page).boundingBox();
    expect(control!.y).toBeGreaterThanOrEqual(last!.y + last!.height - 1);
  });

  test('TC-26.2: the Ignored chip count equals the total of 27', async ({ page }) => {
    await seedLists(page, { ignored: 27 });
    await page.goto(RUNS);
    await expect(chip(page, 'Ignored').locator('b')).toHaveText('27');
    await chip(page, 'Ignored').click();
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 27');
    await expect(chip(page, 'Ignored').locator('b')).toHaveText('27');
  });

  test('TC-26.3: 130 ignored commands: ?page=7 reads "Showing 121–130 of 130", no 100-row cap', async ({ page }) => {
    await seedLists(page, { ignored: 130 });
    await page.goto(RUNS);
    await chip(page, 'Ignored').click();
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 130');
    await page.goto(`${RUNS}?filter=ignored&page=7`);
    await expect(rangeOf(page)).toHaveText('Showing 121–130 of 130');
    await expect(ignoredRows(page)).toHaveCount(10);
  });

  test('TC-26.4: 20 ignored commands show 20 rows and no control', async ({ page }) => {
    await seedLists(page, { ignored: 20 });
    await page.goto(RUNS);
    await chip(page, 'Ignored').click();
    await expect(ignoredRows(page)).toHaveCount(20);
    await expect(nav(page)).toHaveCount(0);
  });
});

test.describe('Needs you', () => {
  test('TC-11.3: no run needing attention shows "No runs need you right now." and no control', async ({ page }) => {
    await seedLists(page, { needsYou: 0 });
    await page.goto(NEEDS_YOU);
    await expect(page.getByText('No runs need you right now.').first()).toBeVisible();
    await expect(needsYouCards(page)).toHaveCount(0);
    await expect(nav(page)).toHaveCount(0);
  });

  test('TC-27.1: 21 runs need attention: 20 cards, then page 2 with one card and "Showing 21–21 of 21"', async ({
    page,
  }) => {
    await seedLists(page, { needsYou: 21 });
    await page.goto(NEEDS_YOU);
    await expect(needsYouCards(page)).toHaveCount(20);
    await pageButton(page, 2).click();
    await expect(needsYouCards(page)).toHaveCount(1);
    await expect(rangeOf(page)).toHaveText('Showing 21–21 of 21');
  });

  test('TC-27.2: the tab badge and the title count show 21 on every page', async ({ page }) => {
    await seedLists(page, { needsYou: 21 });
    await page.goto(NEEDS_YOU);
    await expect(needsYouCards(page)).toHaveCount(20);
    await expect(page.getByTitle('21 runs need you').first()).toBeVisible();
    await expect(page.getByText('(21) Needs you, invoicer-api')).toBeVisible();
    await pageButton(page, 2).click();
    await expect(needsYouCards(page)).toHaveCount(1);
    await expect(page.getByTitle('21 runs need you').first()).toBeVisible();
    await expect(page.getByText('(21) Needs you, invoicer-api')).toBeVisible();
  });

  test('TC-27.3: 20 runs need attention show 20 cards and no control', async ({ page }) => {
    await seedLists(page, { needsYou: 20 });
    await page.goto(NEEDS_YOU);
    await expect(needsYouCards(page)).toHaveCount(20);
    await expect(nav(page)).toHaveCount(0);
  });
});

test.describe('Desk Rules', () => {
  test('TC-11.4: a project with no routing rules shows "No routing rules yet" with "New rule" and no control', async ({
    page,
  }) => {
    await seedLists(page, { rules: 0 });
    await page.goto(RULES);
    await expect(page.getByRole('heading', { name: 'No routing rules yet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New rule' }).first()).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  });

  test('TC-29.1: 24 rules: 20 rules, then page 2 with 4 rules and "Showing 21–24 of 24"', async ({ page }) => {
    await seedLists(page, { rules: 24 });
    await page.goto(RULES);
    await expect(ruleRows(page)).toHaveCount(20);
    await pageButton(page, 2).click();
    await expect(ruleRows(page)).toHaveCount(4);
    await expect(rangeOf(page)).toHaveText('Showing 21–24 of 24');
  });

  test('TC-29.2: the control sits between the rule list and "Guards on every rule"', async ({ page }) => {
    await seedLists(page, { rules: 24 });
    await page.goto(RULES);
    await expect(ruleRows(page)).toHaveCount(20);
    const guards = page.getByText('Guards on every rule');
    await expect(nav(page)).toBeVisible();
    await expect(guards).toBeVisible();
    const lastRule = await ruleRows(page).last().elementHandle();
    const control = await nav(page).elementHandle();
    const heading = await guards.elementHandle();
    const follows = (a: typeof lastRule, b: typeof lastRule) =>
      page.evaluate(([x, y]) => (x!.compareDocumentPosition(y!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, [a, b]);
    const order = { before: await follows(lastRule, control), after: await follows(control, heading) };
    expect(order).toEqual({ before: true, after: true });
    const controlBox = await nav(page).boundingBox();
    const guardsBox = await guards.boundingBox();
    expect(controlBox!.y).toBeLessThan(guardsBox!.y);
  });

  test('TC-29.3: 20 rules show 20 rules, no control and "Guards on every rule" below the list', async ({ page }) => {
    await seedLists(page, { rules: 20 });
    await page.goto(RULES);
    await expect(ruleRows(page)).toHaveCount(20);
    await expect(nav(page)).toHaveCount(0);
    const guards = await page.getByText('Guards on every rule').boundingBox();
    const last = await ruleRows(page).last().boundingBox();
    expect(guards!.y).toBeGreaterThan(last!.y);
  });

  test('TC-29.4: a link to rule 22 (on page 2) opens its editor, and the list has a working control', async ({
    page,
  }) => {
    await seedLists(page, { rules: 24 });
    await page.goto(`${RULES}?rule=${ruleId(22)}`);
    const pane = page.getByRole('complementary', { name: 'Edit rule' });
    await expect(pane.getByRole('textbox', { name: 'Command' })).toHaveValue('code-task-22');
    await expect(nav(page)).toBeVisible();
    await expect(ruleRows(page).first()).toBeVisible();
    // The sources do not say which page the list shows (Q1): use the page it does not show.
    const onPageTwo = (await rangeOf(page).textContent())?.startsWith('Showing 21');
    await pageButton(page, onPageTwo ? 1 : 2).click();
    await expect(rangeOf(page)).toHaveText(onPageTwo ? 'Showing 1–20 of 24' : 'Showing 21–24 of 24');
    await expect(pane.getByRole('textbox', { name: 'Command' })).toHaveValue('code-task-22');
  });
});

test.describe('Desk Skills', () => {
  test('TC-11.5: a project with no skills shows "No skills yet" and no control', async ({ page }) => {
    await seedLists(page, { skills: 0 });
    await page.goto(SKILLS);
    await expect(page.getByRole('heading', { name: 'No skills yet' })).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  });

  test('TC-30.1: 22 skills: 20 skills, then page 2 with 2 and "Showing 21–22 of 22" in the left column', async ({
    page,
  }) => {
    await seedLists(page, { skills: 22 });
    await page.goto(SKILLS);
    await expect(skillItems(page)).toHaveCount(20);
    // The left column is narrow: the control shows the current page only, so Next moves on.
    await step(page, 'Next').click();
    await expect(skillItems(page)).toHaveCount(2);
    await expect(rangeOf(page)).toHaveText('Showing 21–22 of 22');
    const list = await page.getByRole('navigation', { name: 'Skills' }).boundingBox();
    const control = await nav(page).boundingBox();
    const editor = await page.getByRole('textbox', { name: 'SKILL.md source' }).boundingBox();
    expect(control!.y).toBeGreaterThanOrEqual(list!.y + list!.height - 1);
    expect(control!.x + control!.width).toBeLessThanOrEqual(editor!.x + 1);
  });

  test('TC-30.2: moving to page 2 keeps the selected skill in the editor, unchanged', async ({ page }) => {
    await seedLists(page, { skills: 22 });
    await page.goto(`${SKILLS}?skill=skill-03`);
    const editor = page.getByRole('textbox', { name: 'SKILL.md source' });
    await expect(page.getByRole('heading', { name: 'skill-03', level: 2 })).toBeVisible();
    const body = await editor.inputValue();
    expect(body).toContain('name: skill-03');
    await step(page, 'Next').click();
    await expect(rangeOf(page)).toHaveText('Showing 21–22 of 22');
    await expect(page.getByRole('heading', { name: 'skill-03', level: 2 })).toBeVisible();
    await expect(editor).toHaveValue(body);
  });

  test('TC-30.3: 20 skills show 20 skills and no control', async ({ page }) => {
    await seedLists(page, { skills: 20 });
    await page.goto(SKILLS);
    await expect(skillItems(page)).toHaveCount(20);
    await expect(nav(page)).toHaveCount(0);
  });

  test('TC-30.4: a link to skill 22 (on page 2) opens it in the editor, and the list has a working control', async ({
    page,
  }) => {
    await seedLists(page, { skills: 22 });
    await page.goto(`${SKILLS}?skill=skill-22`);
    await expect(page.getByRole('heading', { name: 'skill-22', level: 2 })).toBeVisible();
    await expect(nav(page)).toBeVisible();
    await expect(skillItems(page).first()).toBeVisible();
    // The sources do not say which page the list shows (Q1): use the page it does not show.
    const onPageTwo = (await rangeOf(page).textContent())?.startsWith('Showing 21');
    await step(page, onPageTwo ? 'Previous' : 'Next').click();
    await expect(rangeOf(page)).toHaveText(onPageTwo ? 'Showing 1–20 of 22' : 'Showing 21–22 of 22');
    await expect(page.getByRole('heading', { name: 'skill-22', level: 2 })).toBeVisible();
  });
});

test.describe('Setup history', () => {
  test('TC-11.6: no setup versions show "0 versions" and "No versions yet…" and no control', async ({ page }) => {
    await seedLists(page, { versions: 0 });
    await page.goto(SETUP);
    await expect(versionsHeader(page, 0)).toBeVisible();
    await expect(page.getByText('No versions yet. The first save creates version 1.')).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  });

  test('TC-31.1: 23 versions: the header reads "23 versions" on both pages, page 2 holds 3 rows', async ({ page }) => {
    await seedLists(page, { versions: 23 });
    await page.goto(SETUP);
    await expect(versionsHeader(page, 23)).toBeVisible();
    await step(page, 'Next').click();
    await expect(versionItems(page)).toHaveCount(3);
    await expect(versionsHeader(page, 23)).toBeVisible();
    await expect(rangeOf(page)).toHaveText('Showing 21–23 of 23');
    await page.evaluate(() => document.fonts.ready);
    const listBox = page.getByRole('list', { name: 'Setup script versions' });
    // Poll the gap (control top minus list bottom) so both boxes are re-read together until layout settles.
    await expect
      .poll(async () => {
        const list = await listBox.boundingBox();
        const control = await nav(page).boundingBox();
        return list && control ? control.y - (list.y + list.height) : Number.NEGATIVE_INFINITY;
      })
      .toBeGreaterThanOrEqual(-1);
  });

  test('TC-31.2: page 1 of 23 versions reads "23 versions", not 20', async ({ page }) => {
    await seedLists(page, { versions: 23 });
    await page.goto(SETUP);
    await expect(versionItems(page)).toHaveCount(20);
    await expect(versionsHeader(page, 23)).toBeVisible();
    await expect(versionsHeader(page, 20)).toHaveCount(0);
  });

  test('TC-31.3: while the history response is held back it shows "Loading versions" with a busy mark and no control', async ({
    page,
  }) => {
    await seedLists(page, { versions: 23, hold: [{ route: 'setupScript.versions', ms: 4000 }] });
    await page.goto(SETUP);
    const loading = page.getByRole('status').filter({ hasText: 'Loading versions' });
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('aria-busy', 'true');
    await expect(nav(page)).toHaveCount(0);
  });

  test('TC-31.4: a failing history request shows the reload message and no control', async ({ page }) => {
    await seedLists(page, { versions: 23, fail: [{ route: 'setupScript.versions' }] });
    await page.goto(SETUP);
    await expect(page.getByText('Could not load the version history. Reload to try again.')).toBeVisible({
      timeout: 15_000,
    });
    await expect(nav(page)).toHaveCount(0);
  });

  test('TC-31.5: 0 versions show "0 versions", "No versions yet…" and no control', async ({ page }) => {
    await seedLists(page, { versions: 0 });
    await page.goto(SETUP);
    await expect(versionsHeader(page, 0)).toBeVisible();
    await expect(page.getByText('No versions yet. The first save creates version 1.')).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  });
});

test.describe('Whole-set readers', () => {
  const switcherLinks = async (page: Page) => {
    await page.getByRole('button', { name: /^Switch project, currently / }).click();
    const menu = page.getByRole('dialog', { name: 'Projects' });
    await expect(menu).toBeVisible();
    // The switcher's footer holds "All projects" and "New project" (shell spec BR-48); the count is of the projects.
    return menu.getByRole('link').filter({ hasNotText: /^(All projects|New project)$/ });
  };

  for (const [tc, total, listed] of [
    ['TC-32.1', 26, 26],
    ['TC-32.2', 100, 100],
    ['TC-32.3', 101, 100],
  ] as const) {
    test(`${tc}: ${total} projects list ${listed} in the project switcher menu`, async ({ page }) => {
      await seedLists(page, { projects: total });
      await page.goto(RUNS);
      const links = await switcherLinks(page);
      await expect(links).toHaveCount(listed);
      if (total === 101) await expect(links.filter({ hasText: 'project-101' })).toHaveCount(0);
    });
  }

  test('TC-32.4: Needs you lists all 26 projects', async ({ page }) => {
    await seedLists(page, { projects: 26 });
    await page.goto(NEEDS_YOU);
    await expect(page.getByRole('main').locator('a[href$="/needs-you"]')).toHaveCount(26);
  });

  async function pickerOptions(page: Page): Promise<string[]> {
    await page.goto(RULES);
    await expect(ruleRows(page).first()).toBeVisible();
    await page.getByRole('button', { name: 'New rule' }).first().click();
    const picker = page.getByRole('combobox', { name: 'Skill', exact: true });
    await expect(picker).toBeVisible();
    const names = await picker.locator('option').allTextContents();
    return names.filter((n) => /^skill-\d+$/.test(n));
  }

  test('TC-33.1: the skill picker offers all 25 skills', async ({ page }) => {
    await seedLists(page, { skills: 25 });
    const names = await pickerOptions(page);
    expect(names).toHaveLength(25);
    expect(new Set(names).size).toBe(25);
    expect(names).toContain('skill-25');
  });

  test('TC-33.3: the skill picker offers 100 of 100 skills', async ({ page }) => {
    await seedLists(page, { skills: 100 });
    const names = await pickerOptions(page);
    expect(names).toHaveLength(100);
    expect(new Set(names).size).toBe(100);
  });

  test('TC-33.4: the skill picker offers 100 of 101 skills', async ({ page }) => {
    await seedLists(page, { skills: 101 });
    const names = await pickerOptions(page);
    expect(names).toHaveLength(100);
    expect(new Set(names).size).toBe(100);
  });

  test('TC-33.2: the Skills page references all 25 rules, including those beyond the first 20', async ({ page }) => {
    // Rule n uses skill-n, so a skill shows "1 rule" (or "1 rule, off") only when its rule was read.
    await seedLists(page, { skills: 25, rules: 25 });
    const noRules: string[] = [];
    let withRule = 0;
    for (const target of [SKILLS, `${SKILLS}?page=2`]) {
      await page.goto(target);
      await expect(skillItems(page).first()).toBeVisible();
      for (const text of await skillItems(page).allTextContents()) {
        if (text.includes('No rules')) noRules.push(text);
        else if (/1 rule/.test(text)) withRule += 1;
      }
    }
    expect(noRules).toEqual([]);
    expect(withRule).toBe(25);
  });

  /** Names that sort before "code-build" (in the order the list sorts them), then the template's own name. */
  const before = (n: number) => Array.from({ length: n }, (_, i) => `aa-${two(i + 1)}`);

  test('TC-34.4: setup step 4 skips a template that exists beyond the first 20 skills and finishes', async ({
    page,
  }) => {
    // code-build sorts 25th of 25 skills: invisible to a first-page-only check, which would put it again (409).
    await seedLists(page, { skills: [...before(24), 'code-build'], rules: 0 });
    const puts: string[] = [];
    const onRequest = (request: { method(): string; url(): string }) => {
      const m = /\/skills\/([^/?]+)$/.exec(new URL(request.url()).pathname);
      if (request.method() === 'PUT' && m?.[1]) puts.push(m[1]);
    };
    page.on('request', onRequest);
    try {
      await page.goto(`/o/${ORG}/projects/new/skills?project=${INVOICER_API}`);
      await expect(page.getByRole('heading', { name: 'Start from skill templates', level: 1 })).toBeVisible();
      await page.getByRole('button', { name: 'Commit 2 skills and continue' }).click();
      await expect(page.getByRole('heading', { name: 'Add your first rule', level: 1 })).toBeVisible();
      expect(puts).toEqual(['code-review']);
    } finally {
      page.off('request', onRequest);
    }
  });

  test('TC-34.4: setup step 5 skips a rule command that exists beyond the first 20 rules and finishes', async ({
    page,
  }) => {
    // /code-build is the 25th rule: invisible to a first-page-only check, which would create it again (409).
    await seedLists(page, { rules: [...before(24), 'code-build'] });
    const created: string[] = [];
    const onRequest = (request: { method(): string; url(): string; postData(): string | null }) => {
      if (request.method() !== 'POST' || !new URL(request.url()).pathname.endsWith('/rules')) return;
      const body: unknown = JSON.parse(request.postData() ?? '{}');
      if (typeof body === 'object' && body !== null && 'command' in body && typeof body.command === 'string') {
        created.push(body.command);
      }
    };
    page.on('request', onRequest);
    // The whole rule list is read in one call; without it the step could not know code-build exists.
    const wholeList = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        request.method() === 'GET' && url.pathname.endsWith('/rules') && url.searchParams.get('pageSize') === '100'
      );
    });
    try {
      await page.goto(`/o/${ORG}/projects/new/rules?project=${INVOICER_API}`);
      await expect(page.getByRole('heading', { name: 'Add your first rule', level: 1 })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Command' })).toHaveValue('code-build');
      await page.getByRole('button', { name: 'Save rules and finish' }).click();
      await expect(page.getByRole('heading', { name: 'Trigger your first run from GitHub', level: 1 })).toBeVisible();
      await wholeList;
      expect(created).not.toContain('code-build');
    } finally {
      page.off('request', onRequest);
    }
  });
});

test.describe('Same-ticket runs section', () => {
  const chain = (page: Page) => page.locator('ol').filter({ has: page.getByText('This run', { exact: true }) });

  for (const [tc, total] of [
    ['TC-35.1', 21],
    ['TC-35.2', 50],
    ['TC-35.3', 20],
  ] as const) {
    test(`${tc}: a ticket with ${total} runs lists all ${total} in run detail`, async ({ page }) => {
      await seedLists(page, { runs: { total, ticketSize: total } });
      await page.goto(`${RUNS}/${total}`);
      await expect(page.getByText('Chain on this ticket')).toBeVisible();
      await expect(chain(page).getByRole('listitem')).toHaveCount(total);
      const numbers = (await chain(page).locator('b').allTextContents()).map((t) => Number(t.replace('Run ', '')));
      expect(numbers).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    });
  }
});

test.describe('Environment lists (workspace setup)', () => {
  test('BR-27: the Environment variables and Secrets lists page independently, each with its own control', async ({
    page,
  }) => {
    await seedOnboarding(page, 'owner');
    await seedLists(page, { env: { variables: 23, secrets: 22 } });
    await page.goto(`/o/acme/p/${ids.project.invoicerApi}/desk/setup?tab=environment`);
    const vars = page.getByRole('region', { name: 'Environment variables' });
    const secrets = page.getByRole('region', { name: 'Secrets' });
    const bar = (group: Locator) => group.getByRole('navigation', { name: 'Pagination' });
    const range = (group: Locator) => bar(group).locator('p');
    const next = (group: Locator) => bar(group).getByRole('button', { name: 'Next', exact: true });
    await expect(bar(vars)).toBeVisible();
    await expect(bar(secrets)).toBeVisible();
    await expect(range(vars)).toHaveText('Showing 1–20 of 23');
    await expect(range(secrets)).toHaveText('Showing 1–20 of 22');
    await next(vars).click();
    await expect(range(vars)).toHaveText('Showing 21–23 of 23');
    await expect(range(secrets)).toHaveText('Showing 1–20 of 22');
    await next(secrets).click();
    await expect(range(secrets)).toHaveText('Showing 21–22 of 22');
    await expect(range(vars)).toHaveText('Showing 21–23 of 23');
    expect(new URL(page.url()).searchParams.get('varsPage')).toBe('2');
    expect(new URL(page.url()).searchParams.get('secretsPage')).toBe('2');
  });
});
