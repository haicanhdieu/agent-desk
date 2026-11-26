import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { SkillSummaryDto, pageOf } from '@agentdesk/contracts';
import { API, FAKE_STATE_DIR, REPO, ok, signInAndStartProject } from './helpers';

/*
 * Local end-to-end for the Skills page folders (issue 299). The Skills page lists the skill folders of the project's
 * default agent, then `.agents/skills/`; a duplicate name keeps the agent folder; a new skill goes to the agent's
 * folder. The fake board's skill files live under `<FAKE_STATE_DIR>/skills/<repo>/<folder>/<name>.md`, in the one repo
 * (dev/demo) that every org on the machine shares, so each test uses random names and removes its files at the end.
 * Role denial of the skill routes is covered by rbac-project-admin-desk.spec.ts and apps/api/test/skills.int.test.ts.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const hex = () => randomBytes(3).toString('hex');
const skillFile = (folder: string, name: string) =>
  join(FAKE_STATE_DIR, 'skills', ...REPO.split('/'), folder, `${name}.md`);

async function seed(folder: string, name: string, body: string): Promise<void> {
  const file = skillFile(folder, name);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
}

async function listed(page: Page, projectId: string): Promise<SkillSummaryDto[]> {
  const res = await page.request.get(`/api/projects/${projectId}/skills?pageSize=100`);
  return pageOf(SkillSummaryDto).parse(await ok(res, 200, 'skills')).items;
}

const names = (items: SkillSummaryDto[], prefix: string) => items.filter((s) => s.name.startsWith(prefix));

test('TC-299.1: a Claude project lists .claude/skills then .agents/skills; a duplicate shows once with the agent folder', async ({
  page,
}) => {
  const prefix = `f${hex()}-`;
  const both = `${prefix}both`;
  const generic = `${prefix}generic`;
  const files: [string, string][] = [
    ['.claude/skills', both],
    ['.agents/skills', both],
    ['.agents/skills', generic],
  ];
  try {
    for (const [folder, name] of files) await seed(folder, name, `---\ndescription: in ${folder}\n---\n`);
    const { handle, projectId } = await signInAndStartProject(page);
    expect(names(await listed(page, projectId), prefix).map((s) => [s.name, s.path])).toEqual([
      [both, `.claude/skills/${both}/SKILL.md`],
      [generic, `.agents/skills/${generic}/SKILL.md`],
    ]);
    await page.goto(`/o/${handle}/p/${projectId}/desk/skills`);
    await expect(page.getByText('.claude/skills/, .agents/skills/ on main')).toBeVisible();
    const list = page.getByRole('navigation', { name: 'Skills' });
    await expect(list.getByRole('link', { name: new RegExp(both) })).toHaveCount(1);
    await expect(list.getByRole('link', { name: new RegExp(generic) })).toHaveCount(1);
  } finally {
    for (const [folder, name] of files) await rm(skillFile(folder, name), { force: true });
  }
});

test('TC-299.2: a Codex project lists only .agents/skills, names it, and a new skill is created there', async ({
  page,
}) => {
  const prefix = `f${hex()}-`;
  const claudeOnly = `${prefix}claude-only`;
  const shared = `${prefix}shared`;
  const made = `${prefix}made`;
  try {
    await seed('.claude/skills', claudeOnly, 'x');
    await seed('.agents/skills', shared, 'x');
    const { handle, projectId } = await signInAndStartProject(page, 'codex');
    expect(names(await listed(page, projectId), prefix).map((s) => s.name)).toEqual([shared]);

    await page.goto(`/o/${handle}/p/${projectId}/desk/skills`);
    await expect(page.getByText('.agents/skills/ on main')).toBeVisible();
    const list = page.getByRole('navigation', { name: 'Skills' });
    await expect(list.getByRole('link', { name: new RegExp(shared) })).toBeVisible();
    await expect(list.getByRole('link', { name: new RegExp(claudeOnly) })).toHaveCount(0);

    await ok(
      await page.request.put(`/api/projects/${projectId}/skills/${made}`, { data: { body: 'new', message: 'add' } }),
      200,
      'create skill',
    );
    expect(names(await listed(page, projectId), made).map((s) => s.path)).toEqual([`.agents/skills/${made}/SKILL.md`]);
  } finally {
    for (const [folder, name] of [
      ['.claude/skills', claudeOnly],
      ['.agents/skills', shared],
      ['.agents/skills', made],
    ] as const)
      await rm(skillFile(folder, name), { force: true });
  }
});
