import { expect, test, type Page } from '@playwright/test';
import { answerRequest, INVOICER_API, ORG, seedAgents } from './mock';

/*
 * Deleting an agent from the Agents tab (spec 2026-11-24-multi-agent-configs-design.md, BR-27 to BR-30, BR-66). The
 * refusals are the API's own sentences; the dialog shows every 409 with only "Close". `deleteBlocked` seeds the seven
 * fixture agents: "Claude - Work" is named by one rule (command "/fix"), "Codex" has a paused run (number 900), "Claude -
 * Personal" is the default.
 */
test.describe.configure({ timeout: 60_000 });

const agentPage = `/o/${ORG}/p/${INVOICER_API}/desk/agent`;
const PERSONAL = 'Claude - Personal';
const WORK = 'Claude - Work';
const CODEX = 'Codex';
const FILE = 'OpenCode - Credentials file';

const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Agent & settings' });
const rows = (page: Page) => page.getByRole('region', { name: 'Agents list' }).getByRole('listitem');
const rowOf = (page: Page, name: string) => rows(page).filter({ has: page.getByText(name, { exact: true }) });
const menuOf = (page: Page, name: string) => page.getByRole('button', { name: `Actions for ${name}`, exact: true });
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name: `Delete agent ${name}?` });

async function open(page: Page): Promise<void> {
  await page.goto(agentPage);
  await expect(heading(page)).toBeVisible();
}

async function chooseDelete(page: Page, name: string): Promise<void> {
  await menuOf(page, name).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
}

/** Rules are created through the mock API route, as the rule form does (the store lives in the page). */
async function nameAgentInRules(page: Page, agentName: string, commands: string[]): Promise<void> {
  await page.evaluate(
    async ({ projectId, agentName: name, commands: list }) => {
      const base = `/api/projects/${projectId}`;
      const listed = await (await fetch(`${base}/agents`)).json();
      const agent = (listed.items as Array<{ id: string; name: string }>).find((a) => a.name === name);
      if (!agent) throw new Error(`agent ${name} not listed`);
      for (const command of list) {
        const res = await fetch(`${base}/rules`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'skill',
            command,
            skillName: command,
            labelFilter: [],
            target: 'issue',
            enabled: true,
            agentId: agent.id,
          }),
        });
        if (!res.ok) throw new Error(`rule ${command}: ${res.status}`);
      }
    },
    { projectId: INVOICER_API, agentName, commands },
  );
}

test.describe('BR-27: delete an unused agent', () => {
  test.beforeEach(async ({ page }) => {
    await seedAgents(page, 'deleteBlocked');
  });

  test('TC-27.1: the dialog names the agent, Delete agent removes the row and shows the Toast', async ({ page }) => {
    await open(page);
    await chooseDelete(page, FILE);
    const confirm = dialog(page, FILE);
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText('Rules and runs stop using it. Run history keeps its name.')).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete agent', exact: true }).click();
    await expect(page.getByText('Agent deleted', { exact: true })).toBeVisible();
    await expect(rowOf(page, FILE)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(6);
  });

  test('TC-27.2: Keep agent closes the dialog and the row stays', async ({ page }) => {
    await open(page);
    await chooseDelete(page, FILE);
    await dialog(page, FILE).getByRole('button', { name: 'Keep agent', exact: true }).click();
    await expect(dialog(page, FILE)).toHaveCount(0);
    await expect(rowOf(page, FILE)).toBeVisible();
    await expect(rows(page)).toHaveCount(7);
  });
});

test.describe('BR-28: the default agent', () => {
  test('TC-28.1: the default agent`s Delete item is disabled with the reason', async ({ page }) => {
    await seedAgents(page, 'deleteBlocked');
    await open(page);
    await menuOf(page, PERSONAL).click();
    const item = page.getByRole('button', { name: 'Delete (set another default first)', exact: true });
    await expect(item).toBeVisible();
    await expect(item).toBeDisabled();
  });
});

test.describe('BR-29: an agent a rule names', () => {
  test('TC-29.1: the refusal names the rule and has only Close; the row stays', async ({ page }) => {
    await seedAgents(page, 'deleteBlocked');
    await open(page);
    await chooseDelete(page, WORK);
    const refusal = dialog(page, WORK);
    await refusal.getByRole('button', { name: 'Delete agent', exact: true }).click();
    await expect(refusal.getByText('A routing rule uses this agent', { exact: true })).toBeVisible();
    await expect(
      refusal.getByText('1 rule names it: /fix. Point it at another agent first, then delete.', { exact: true }),
    ).toBeVisible();
    await expect(refusal.getByRole('button')).toHaveText(['Close']);
    await refusal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog(page, WORK)).toHaveCount(0);
    await expect(rowOf(page, WORK)).toBeVisible();
  });

  test('TC-29.2: six rules are reported, five commands are listed; the row stays', async ({ page }) => {
    await seedAgents(page, 'deleteBlocked');
    await open(page);
    // "Claude - Work" already has the scenario's rule "/fix"; five more make six.
    await nameAgentInRules(page, WORK, ['fix-a', 'fix-b', 'fix-c', 'fix-d', 'fix-e']);
    await chooseDelete(page, WORK);
    const refusal = dialog(page, WORK);
    await refusal.getByRole('button', { name: 'Delete agent', exact: true }).click();
    await expect(refusal.getByText('A routing rule uses this agent', { exact: true })).toBeVisible();
    await expect(
      refusal.getByText(
        '6 rules name it: /fix, /fix-a, /fix-b, /fix-c, /fix-d and 1 more. Point it at another agent first, then delete.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(refusal.getByRole('button')).toHaveText(['Close']);
    await refusal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(rowOf(page, WORK)).toBeVisible();
  });
});

test.describe('BR-30: an agent with an open run', () => {
  test('TC-30.1: the refusal says the agent has open runs and has only Close; the row stays', async ({ page }) => {
    await seedAgents(page, 'deleteBlocked');
    await open(page);
    await chooseDelete(page, CODEX);
    const refusal = dialog(page, CODEX);
    await refusal.getByRole('button', { name: 'Delete agent', exact: true }).click();
    await expect(refusal.getByText('This agent has open runs', { exact: true })).toBeVisible();
    await expect(
      refusal.getByText('Run 900 is paused and can be resumed. Finish it first, then delete.', { exact: true }),
    ).toBeVisible();
    await expect(refusal.getByRole('button')).toHaveText(['Close']);
    await refusal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(rowOf(page, CODEX)).toBeVisible();
  });
});

test.describe('BR-66: the only agent', () => {
  test('TC-66.1: in a project with one agent the Delete item is disabled with the reason', async ({ page }) => {
    // The seeded project has one agent, "Claude".
    await open(page);
    await expect(rows(page)).toHaveCount(1);
    await menuOf(page, 'Claude').click();
    const item = page.getByRole('button', { name: 'Delete (a project needs at least one agent)', exact: true });
    await expect(item).toBeVisible();
    await expect(item).toBeDisabled();
  });

  test('TC-66.2: when the API answers 409 on delete, the dialog shows the text and the row stays', async ({ page }) => {
    await seedAgents(page, 'deleteBlocked');
    await answerRequest(page, {
      method: 'DELETE',
      path: '/api/agents/',
      times: 1,
      problem: {
        status: 409,
        title: 'Conflict',
        detail: 'A project needs at least one agent. Add another agent first.',
      },
    });
    await open(page);
    await chooseDelete(page, FILE);
    const refusal = dialog(page, FILE);
    await refusal.getByRole('button', { name: 'Delete agent', exact: true }).click();
    await expect(
      refusal.getByText('A project needs at least one agent. Add another agent first.', { exact: true }),
    ).toBeVisible();
    await expect(refusal.getByRole('button')).toHaveText(['Close']);
    await refusal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(rowOf(page, FILE)).toBeVisible();
  });
});
