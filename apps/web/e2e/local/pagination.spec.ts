import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { RuleDto, RunDto, SkillSummaryDto, pageOf } from '@agentdesk/contracts';
import {
  API,
  CommentResult,
  REPO,
  commentOnNewTicket,
  ok,
  signInAndCreateProject,
  signInAndStartProject,
} from './helpers';

/*
 * Local end-to-end for the paged lists against the real stack (spec docs/superpowers/specs/2026-11-19-shared-pagination-design.md,
 * "E2E requirements": BR-20, 24, 34, 36, 37 and 38). The stack runs with KUBE_MODE=fake and the fake provider. Every test
 * signs in as a new dev-login user and creates its own project, so the tests do not depend on each other. The projects
 * keep one run slot (maxConcurrentRuns 1), so the first run starts and every later one stays queued.
 *
 * TC-20.3, TC-37.1 and TC-37.3 (more than 20 projects in a local org) are proven in apps/api/test/projects.int.test.ts:
 * the fake provider exposes one repo, and a connection holds one project per repo (plan Task 14, Agent calls).
 *
 * The fake board (dev/demo) is shared by every org on the machine. Skills live in that one repo, so the skills tests use
 * a random name prefix and assert their relative order and that each name appears exactly once, not an exact total.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const nav = (page: Page) => page.getByRole('navigation', { name: 'Pagination' });
const rangeOf = (page: Page) => nav(page).locator('p');
const nextButton = (page: Page) => nav(page).getByRole('button', { name: 'Next', exact: true });
const pageButton = (page: Page, n: number) => nav(page).getByRole('button', { name: `Page ${n}`, exact: true });
const main = (page: Page) => page.getByRole('main');
const chip = (page: Page, label: string) => main(page).getByRole('link', { name: new RegExp(`^${label}\\s*[\\d,]+$`) });
const chipCount = async (page: Page, label: string) =>
  Number((await chip(page, label).locator('b').innerText()).replace(/,/g, ''));
const runLinks = (page: Page) => page.getByRole('link', { name: /^Run \d+$/ });
const todayLine = (page: Page) => main(page).getByText(/^Today: /);

const projectUrl = (handle: string, projectId: string) => `/o/${handle}/p/${projectId}`;
const hex = () => randomBytes(4).toString('hex');
const two = (n: number) => String(n).padStart(2, '0');

/** One run slot, so the first run starts and the rest stay queued. */
async function limitToOneRun(page: Page, projectId: string) {
  await ok(
    await page.request.patch(`/api/projects/${projectId}`, { data: { maxConcurrentRuns: 1 } }),
    200,
    'project limit',
  );
}

/** Given: `count` runs queued one after another, each on its own ticket; returns their run ids, oldest first. */
async function queueRuns(page: Page, handle: string, projectId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(await commentOnNewTicket(page, handle, projectId, '/code-review'));
  return ids;
}

async function runNumberOf(page: Page, runId: string): Promise<number> {
  return RunDto.parse(await ok(await page.request.get(`/api/runs/${runId}`), 200, 'run')).number;
}

/** Reads the rows of every page, in order: page 1, then Next until the last page. */
async function readAllPages(page: Page, readRows: () => Promise<string[]>): Promise<string[][]> {
  const pages: string[][] = [];
  for (let guard = 0; guard < 20; guard++) {
    pages.push(await readRows());
    if (await nextButton(page).isDisabled()) return pages;
    const before = await rangeOf(page).innerText();
    await nextButton(page).click();
    await expect(rangeOf(page)).not.toHaveText(before);
  }
  throw new Error('the list has more than 20 pages');
}

const descending = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i);

async function runNumbers(page: Page): Promise<string[]> {
  await expect(runLinks(page).first()).toBeVisible();
  return (await runLinks(page).allTextContents()).map((t) => t.replace('Run ', ''));
}

// ---- BR-20: each row once, in a fixed order ----

test.describe('BR-20: paging through a list while no rows change', () => {
  test('TC-20.1: 45 runs read on pages 1, 2 and 3: newest queued first, each run once', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await limitToOneRun(page, projectId);
    await queueRuns(page, handle, projectId, 45);

    await page.goto(`${projectUrl(handle, projectId)}/runs`);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 45');
    const pages = await readAllPages(page, () => runNumbers(page));
    expect(pages.map((p) => p.length)).toEqual([20, 20, 5]);
    // Runs are numbered in queue order, so newest queued first reads 45 down to 1 with nothing twice or missing.
    expect(pages.flat()).toEqual(descending(45, 1).map(String));
  });

  test('TC-20.2: 27 ignored commands read on Ignored pages 1 and 2: newest received first, 27 distinct rows', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const first = randomInt(100_000, 900_000_000);
    const tickets = Array.from({ length: 27 }, (_, i) => first + i);
    for (const number of tickets) {
      await ok(
        await page.request.post('/dev/fake/tickets', {
          data: { repoPath: REPO, number, kind: 'pr', title: `e2e ${handle}` },
        }),
        201,
        'fake ticket',
      );
      // No rule has this command, so the comment is ignored.
      const comment = CommentResult.parse(
        await ok(
          await page.request.post('/dev/fake/comments', {
            data: {
              repoPath: REPO,
              ticketNumber: number,
              body: '/no-such-rule',
              deliver: 'webhook',
              projectId,
              author: handle,
            },
          }),
          201,
          'fake comment',
        ),
      );
      expect(comment.outcome, 'the comment is ignored').toMatch(/^ignored/);
    }

    await page.goto(`${projectUrl(handle, projectId)}/runs?filter=ignored`);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 27');
    const ignoredTickets = async () => {
      const links = page.getByRole('link', { name: /^Comment on (?:PR|Issue) #\d+$/ });
      await expect(links.first()).toBeVisible();
      const labels = await links.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
      return labels.map((l) => l.replace(/^Comment on \w+ #/, ''));
    };
    const pages = await readAllPages(page, ignoredTickets);
    expect(pages.map((p) => p.length)).toEqual([20, 7]);
    // The comments were received in ticket order, so newest received first is the highest ticket number first.
    expect(pages.flat()).toEqual([...tickets].reverse().map(String));
  });

  test('TC-20.4: 24 routing rules read on Desk Rules pages 1 and 2: oldest created first, each rule once', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const prefix = `pg${hex()}`;
    const created = Array.from({ length: 24 }, (_, i) => `${prefix}-${two(i + 1)}`);
    for (const command of created) {
      await ok(
        await page.request.post(`/api/projects/${projectId}/rules`, {
          data: { kind: 'prompt', command, labelFilter: [], target: 'any', enabled: true, prompt: 'Say hello.' },
        }),
        201,
        'create rule',
      );
    }

    await page.goto(`${projectUrl(handle, projectId)}/desk/rules`);
    // The two rules of the setup flow come first, then these 24 in the order they were created.
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 26');
    const rules = page.getByRole('button', { name: /^Edit rule \// });
    const commands = async () => {
      await expect(rules.first()).toBeVisible();
      return rules.evaluateAll((els) =>
        els.map((e) => (e.getAttribute('aria-label') ?? '').replace('Edit rule /', '')),
      );
    };
    const pages = await readAllPages(page, commands);
    const all = pages.flat();
    expect(pages.map((p) => p.length)).toEqual([20, 6]);
    expect(new Set(all).size, 'each rule once').toBe(26);
    expect(all.filter((c) => c.startsWith(`${prefix}-`))).toEqual(created);
    expect(all.slice(-24)).toEqual(created);
  });

  test('TC-20.6: 23 setup script versions read on the history pages: highest first (23 down to 1), each once', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    // The setup flow saved version 1; 22 more make 23.
    for (let base = 1; base <= 22; base++) {
      await ok(
        await page.request.put(`/api/projects/${projectId}/setup-script`, {
          data: { body: `#!/usr/bin/env bash\necho version ${base + 1}\n`, note: `v${base + 1}`, baseVersion: base },
        }),
        200,
        'save setup version',
      );
    }

    await page.goto(`${projectUrl(handle, projectId)}/desk/setup`);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 23');
    const versions = async () => {
      const items = page.getByRole('list', { name: 'Setup script versions' }).getByRole('listitem');
      await expect(items.first()).toBeVisible();
      return items.evaluateAll((els) => els.map((e) => /^v(\d+)/.exec(e.textContent ?? '')?.[1] ?? ''));
    };
    const pages = await readAllPages(page, versions);
    expect(pages.map((p) => p.length)).toEqual([20, 3]);
    expect(pages.flat()).toEqual(descending(23, 1).map(String));
  });
});

// ---- BR-24: the Today line ----

test.describe('BR-24: the Today line', () => {
  test('TC-24.4: one run queued just now shows "Today: 1 run" with no failed part', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await commentOnNewTicket(page, handle, projectId, '/code-review');

    await page.goto(`${projectUrl(handle, projectId)}/runs`);
    await expect(runLinks(page).first()).toBeVisible();
    await expect(todayLine(page)).toHaveText('Today: 1 run');
  });
});

// ---- BR-34: names beyond the first 20 are found by the setup flow ----

/** The setup flow from a new project up to the step "Start from skill templates" (step 4). */
async function setupUntilSkillsStep(page: Page): Promise<{ handle: string; projectId: string }> {
  const { handle, projectId } = await signInAndStartProject(page);
  await page.getByRole('textbox', { name: 'Token' }).fill(`sk-ant-e2e-${randomBytes(8).toString('hex')}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Prepare the workspace', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Test setup' }).click();
  await expect(page.getByText('Setup passed', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Start from skill templates', level: 1 })).toBeVisible();
  return { handle, projectId };
}

const skillBody = (name: string) => `---\nname: ${name}\ndescription: Paging check.\n---\n\n# ${name}\n`;

async function putSkill(page: Page, projectId: string, name: string) {
  await ok(
    await page.request.put(`/api/projects/${projectId}/skills/${name}`, {
      data: { body: skillBody(name), message: `add ${name}` },
    }),
    200,
    'put skill',
  );
}

/** Removes skills this spec added to the shared repo; one that is already gone is fine. Never throws, so it can run in `finally`. */
async function removeSkills(page: Page, projectId: string, names: string[]) {
  for (const name of names) {
    await page.request.delete(`/api/projects/${projectId}/skills/${name}?message=cleanup`).catch(() => null);
  }
}

/** Given: the skill is in the repo (added only when it is not there yet). Returns true when this call added it. */
async function ensureSkill(page: Page, projectId: string, name: string): Promise<boolean> {
  const found = await page.request.get(`/api/projects/${projectId}/skills/${name}`);
  if (found.status() === 404) {
    await putSkill(page, projectId, name);
    return true;
  }
  expect(found.status(), 'read skill').toBe(200);
  return false;
}

/**
 * Given: 21 skills with names that sort before every template name, so the templates sit beyond the first 20.
 * `added` gets each name before it is written, so a failure half way still leaves every name for the cleanup.
 */
async function addEarlySkills(page: Page, projectId: string, added: string[]) {
  const prefix = `aa-${hex()}`;
  for (let i = 1; i <= 21; i++) {
    const name = `${prefix}-${two(i)}`;
    added.push(name);
    await putSkill(page, projectId, name);
  }
}

/** Every skill name of the project's repo, read page by page through the API. */
async function allSkillNames(page: Page, projectId: string): Promise<string[]> {
  const names: string[] = [];
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    const body = pageOf(SkillSummaryDto).parse(
      await ok(await page.request.get(`/api/projects/${projectId}/skills?page=${pageNo}&pageSize=100`), 200, 'skills'),
    );
    names.push(...body.items.map((s) => s.name));
    if (names.length >= body.total || body.items.length === 0) break;
  }
  return names;
}

/** The skill names the browser writes while `run` goes on. */
async function skillPutsDuring(page: Page, run: () => Promise<void>): Promise<string[]> {
  const puts: string[] = [];
  const onRequest = (request: { method(): string; url(): string }) => {
    const m = /\/skills\/([^/?]+)$/.exec(new URL(request.url()).pathname);
    if (request.method() === 'PUT' && m?.[1]) puts.push(m[1]);
  };
  page.on('request', onRequest);
  try {
    await run();
  } finally {
    page.off('request', onRequest);
  }
  return puts;
}

const commitSkills = async (page: Page) => {
  await page.getByRole('button', { name: /^Commit \d+ skills? and continue$/ }).click();
  await expect(page.getByRole('heading', { name: 'Add your first rule', level: 1 })).toBeVisible({ timeout: 30_000 });
};

// TC-20.5 pages through the shared fake-repo skills list while the BR-34 tests add and delete skills in it, so they
// share one serial group (the config runs files fully parallel; a skill writer must not overlap the paging read).
test.describe('Shared fake skills repo: paging and setup writes one after another', () => {
  test.describe.configure({ mode: 'serial' });

  test('TC-20.5: 22 skills read on Desk Skills pages: names A to Z across pages, each skill once', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const prefix = `pg${hex()}`;
    const names = Array.from({ length: 22 }, (_, i) => `${prefix}-${String.fromCharCode(97 + i)}`);
    try {
      // Put them in a shuffled order: the list is sorted by name, not by when they were added.
      for (const name of [...names].reverse()) await putSkill(page, projectId, name);

      const skillNames = async () => {
        const items = page.getByRole('navigation', { name: 'Skills' }).locator('li b');
        await expect(items.first()).toBeVisible();
        return items.allTextContents();
      };
      // Another spec file may add or remove a shared template while this reads, which shifts rows between pages:
      // so the check looks only at the skills made here, and a shifted read is repeated.
      await expect(async () => {
        await page.goto(`${projectUrl(handle, projectId)}/desk/skills`);
        await expect(nav(page)).toBeVisible();
        const pages = await readAllPages(page, skillNames);
        for (const rows of pages) expect(rows, 'every page is sorted').toEqual([...rows].sort());
        const own = pages.flat().filter((n) => n.startsWith(`${prefix}-`));
        expect(own, 'own skills: A to Z across pages, each once').toEqual(names);
      }).toPass({ timeout: 60_000 });
    } finally {
      await removeSkills(page, projectId, names);
    }
  });

  test.describe('BR-34: the setup flow finds names beyond the first 20', () => {
    // These tests change the shared templates code-review and code-build (TC-34.3 deletes one), so they run one after another.
    test.describe.configure({ mode: 'serial' });

    test('TC-34.1: step 4 finishes and writes an existing template (past the first 20 skills) only once', async ({
      page,
    }) => {
      const { projectId } = await setupUntilSkillsStep(page);
      const added: string[] = [];
      try {
        await addEarlySkills(page, projectId, added);
        if (await ensureSkill(page, projectId, 'code-review')) added.push('code-review');
        if (await ensureSkill(page, projectId, 'code-build')) added.push('code-build');

        const puts = await skillPutsDuring(page, () => commitSkills(page));
        // Both templates are in the repo already: the step skips them quietly and makes no duplicate.
        expect(puts).toEqual([]);
        const names = await allSkillNames(page, projectId);
        expect(names.filter((n) => n === 'code-review')).toHaveLength(1);
        expect(names.filter((n) => n === 'code-build')).toHaveLength(1);
      } finally {
        await removeSkills(page, projectId, added);
      }
    });

    test('TC-34.2: step 5 finishes and creates no second rule for a command that exists past the first 20 rules', async ({
      page,
    }) => {
      const { projectId } = await setupUntilSkillsStep(page);
      await commitSkills(page);
      // 21 rules, then code-build as the 22nd: the step's check must look past the first 20.
      const prefix = `aa-${hex()}`;
      const commands = [...Array.from({ length: 21 }, (_, i) => `${prefix}-${two(i + 1)}`), 'code-build'];
      for (const command of commands) {
        await ok(
          await page.request.post(`/api/projects/${projectId}/rules`, {
            data: { kind: 'prompt', command, labelFilter: [], target: 'any', enabled: true, prompt: 'Say hello.' },
          }),
          201,
          'create rule',
        );
      }

      const created: string[] = [];
      const onRequest = (request: { method(): string; url(): string; postData(): string | null }) => {
        if (request.method() !== 'POST' || !new URL(request.url()).pathname.endsWith('/rules')) return;
        const body: unknown = JSON.parse(request.postData() ?? '{}');
        if (typeof body === 'object' && body !== null && 'command' in body && typeof body.command === 'string') {
          created.push(body.command);
        }
      };
      page.on('request', onRequest);
      try {
        await expect(page.getByRole('textbox', { name: 'Command' }).first()).toHaveValue('code-build');
        await page.getByRole('button', { name: 'Save rules and finish' }).click();
        await expect(page).toHaveURL(/\/new\/ready\?project=/, { timeout: 30_000 });
      } finally {
        page.off('request', onRequest);
      }
      expect(created).not.toContain('code-build');

      const rules = pageOf(RuleDto).parse(
        await ok(await page.request.get(`/api/projects/${projectId}/rules?page=1&pageSize=100`), 200, 'rules'),
      );
      expect(rules.items.filter((r) => r.command === 'code-build')).toHaveLength(1);
    });

    test('TC-34.3: step 4 still adds a template that is not in the repo', async ({ page }) => {
      const { projectId } = await setupUntilSkillsStep(page);
      const added: string[] = [];
      let buildWasMissing = false;
      try {
        await addEarlySkills(page, projectId, added);
        if (await ensureSkill(page, projectId, 'code-review')) added.push('code-review');
        // code-build is not in the repo.
        buildWasMissing = await ensureSkill(page, projectId, 'code-build');
        await ok(
          await page.request.delete(`/api/projects/${projectId}/skills/code-build?message=remove`),
          204,
          'remove skill',
        );

        const puts = await skillPutsDuring(page, () => commitSkills(page));
        // Another spec file may re-add code-build first, so the step writes nothing but code-build, and at most once.
        expect(
          puts.filter((n) => n !== 'code-build'),
          'only the missing template is written',
        ).toEqual([]);
        expect(puts.filter((n) => n === 'code-build').length, 'code-build written at most once').toBeLessThanOrEqual(1);
        const names = await allSkillNames(page, projectId);
        expect(names.filter((n) => n === 'code-build')).toHaveLength(1);
        expect(names.filter((n) => n === 'code-review')).toHaveLength(1);
      } finally {
        // Leave the shared repo as found: code-build back in place when it was there before, gone when it was not.
        if (buildWasMissing) added.push('code-build');
        else await ensureSkill(page, projectId, 'code-build').catch(() => false);
        await removeSkills(page, projectId, added);
      }
    });
  });
});

// ---- BR-36: live changes ----

test.describe('BR-36: live changes on page 1', () => {
  test('TC-36.1: a new run is the first row on page 1 and the range total grows by one', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await limitToOneRun(page, projectId);
    await queueRuns(page, handle, projectId, 25);

    await page.goto(`${projectUrl(handle, projectId)}/runs`);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 25');
    const newRun = await commentOnNewTicket(page, handle, projectId, '/code-review');
    const number = await runNumberOf(page, newRun);

    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 26', { timeout: 30_000 });
    await expect(runLinks(page).first()).toHaveText(`Run ${number}`);
  });

  test('TC-36.2: a queued run on page 1 shows its new status when the fake pod starts it, without a reload', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await limitToOneRun(page, projectId);
    const [first, second] = await queueRuns(page, handle, projectId, 2);
    const secondNumber = await runNumberOf(page, second);

    await page.goto(`${projectUrl(handle, projectId)}/runs`);
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: `Run ${secondNumber}`, exact: true }) });
    await expect(row).toContainText('Queued');
    await page.evaluate(() => {
      Object.defineProperty(window, '__keptAlive', { value: true });
    });

    // The one slot is held by the first run; cancelling it frees the slot and the second run starts.
    await ok(await page.request.post(`/api/runs/${first}/cancel`), 202, 'cancel');
    await expect(row).toContainText(/Starting|Running|Needs you|Done|Succeeded/, { timeout: 60_000 });
    await expect(row).not.toContainText('Queued');
    await expect(row).toHaveCount(1);
    expect(await page.evaluate(() => Reflect.get(window, '__keptAlive')), 'the page was not reloaded').toBe(true);
  });
});

// ---- BR-37: only the member's own org ----

test.describe('BR-37: other orgs do not count', () => {
  test('TC-37.2: org A with 25 runs sees "of 25" and All 25 while org B has 40 runs', async ({ page, browser }) => {
    const a = await signInAndCreateProject(page);
    await limitToOneRun(page, a.projectId);
    await queueRuns(page, a.handle, a.projectId, 25);

    const contextB = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    try {
      const pageB = await contextB.newPage();
      const b = await signInAndCreateProject(pageB);
      await limitToOneRun(pageB, b.projectId);
      await queueRuns(pageB, b.handle, b.projectId, 40);
    } finally {
      await contextB.close();
    }

    await page.goto(`${projectUrl(a.handle, a.projectId)}/runs`);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 25');
    await expect(chip(page, 'All').locator('b')).toHaveText('25');
    await pageButton(page, 2).click();
    await expect(rangeOf(page)).toHaveText('Showing 21–25 of 25');
  });
});

// ---- BR-38: the Runs screen over 20 runs ----

test.describe('BR-38: the Runs screen with more than 20 runs', () => {
  test('TC-38.1 and TC-38.2: 25 runs: "Page 2" shows the next 5 runs, and the chip counts match the runs created', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await limitToOneRun(page, projectId);
    await queueRuns(page, handle, projectId, 25);

    await page.goto(`${projectUrl(handle, projectId)}/runs`);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 25');
    // TC-38.2: "All" reads 25, and the chips add up to the runs created. "Needs you" is not added: a run that waits for
    // the person (idle) is also Active, so it would count twice (no run is paused here).
    await expect(chip(page, 'All').locator('b')).toHaveText('25');
    await expect
      .poll(
        async () => {
          const counts = await Promise.all(['Active', 'Queued', 'Ended'].map((l) => chipCount(page, l)));
          return counts.reduce((sum, n) => sum + n, 0);
        },
        { timeout: 30_000 },
      )
      .toBe(25);

    // TC-38.1: page 2 shows the next 5 runs.
    await pageButton(page, 2).click();
    await expect(rangeOf(page)).toHaveText('Showing 21–25 of 25');
    expect(await runNumbers(page)).toEqual(descending(5, 1).map(String));
  });

  test('TC-38.3: 20 runs show one page and no pagination control', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await limitToOneRun(page, projectId);
    await queueRuns(page, handle, projectId, 20);

    await page.goto(`${projectUrl(handle, projectId)}/runs`);
    await expect(runLinks(page)).toHaveCount(20);
    await expect(nav(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Page \d+$/ })).toHaveCount(0);
  });
});
