import { randomBytes } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  AgentDto,
  AuditEntryDto,
  ProjectDto,
  RuleDto,
  SetupScriptDto,
  SetupTestDto,
  pageOf,
} from '@agentdesk/contracts';
import { API, ok } from './helpers';
import { buildCast, disposeCast, disposeSecondOrg, secondOrg, type Actor, type Cast } from './rbac-cast';
import { auditUrl, projectAuditApi, projectMembersApi } from './project-admin';

/*
 * Local end-to-end for P1's Audit log entries (spec "E2E requirements": BR-16, BR-17, BR-18, BR-19, BR-25). A is the
 * admin of P1 only, B the member of P1 and P2, C the member of P1, D the org admin, O the owner; RB is B's run on P1
 * (`buildCast`). Every case runs in a fresh org. The changes of a case are made over the API as the person the case
 * names (their own browser context's cookie, through the real guard); what the case reads is the Audit log page in the
 * browser, and the audit API for what a page cannot show (the whole entry list, the absence of a secret value).
 * Dev-login people are named after their handle, so a person's name in an entry is their handle.
 *
 * What an entry shows today (`toAuditRow`, `AuditRow`): a typed member entry reads as a sentence; every other entry
 * (the `METHOD route-key` rows the interceptor writes for settings, agent, rules, skills, setup and run actions) shows
 * its raw key in monospace and, only when it has a target label, that label after it. Those rows are tagged with a
 * project and a route target, which carry no label, so the What cell reads as the key alone.
 *
 * TC-18.7 (an environment entry with a secret value) is deferred to #176: environment entries need that feature.
 * Rows written in one transaction can share a timestamp, so no case asserts an order among them; TC-16.4 compares two
 * requests made one after the other.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

let cast: Cast;
/** The cast to dispose: unset until a build succeeded, and again after its disposal, so a failed build never disposes a stale one. */
let built: Cast | undefined;

test.beforeEach(async ({ browser }) => {
  built = undefined;
  built = await buildCast(browser);
  cast = built;
});

test.afterEach(async () => {
  const done = built;
  built = undefined;
  if (done) await disposeCast(done);
});

/** Cleanup that never masks the failure of the test it runs after. */
async function quietly(action: () => Promise<unknown>): Promise<void> {
  await action().catch(() => null);
}

const hex = (): string => randomBytes(3).toString('hex');

/** Deletes P1's rules whose command `matches`, as the owner; never throws, so it never masks a test failure. */
async function removeRules(o: Actor, projectId: string, matches: (command: string) => boolean): Promise<void> {
  await quietly(async () => {
    const rules = pageOf(RuleDto).parse(
      await ok(await o.api.get(`/api/projects/${projectId}/rules?pageSize=100`), 200, 'rules'),
    ).items;
    for (const r of rules.filter((x) => matches(x.command))) await quietly(() => o.api.delete(`/api/rules/${r.id}`));
  });
}

/** The exact text of a cell (whitespace is normalised by the matcher). */
const exact = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

const WHO = 'td:nth-child(2)';
const WHAT = 'td:nth-child(3)';

const heading = (page: Page): Locator => page.getByRole('heading', { level: 1, name: 'Audit log' });
const forbidden = (page: Page): Locator => page.getByRole('heading', { name: "You don't have access" });

/** The audit rows of `who` whose What cell reads exactly `what`. */
function entries(page: Page, who: string, what: string): Locator {
  return page
    .locator('tbody tr')
    .filter({ has: page.locator(WHO, { hasText: exact(who) }) })
    .filter({ has: page.locator(WHAT, { hasText: exact(what) }) });
}

/** The audit rows of `who` that are the raw entry of `key` (monospace key, nothing after it). */
function rawEntries(page: Page, who: string, key: string): Locator {
  return entries(page, who, key).filter({ has: page.locator(`${WHAT} .mono`, { hasText: exact(key) }) });
}

async function openLog(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(heading(page)).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

/** The What texts of the shown rows, in screen order. */
async function whatTexts(page: Page): Promise<string[]> {
  return (await page.locator(`tbody tr ${WHAT}`).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

/** P1's whole audit list as `who` reads it over the API (exactly 200). */
async function projectEntries(who: Actor, projectId: string): Promise<AuditEntryDto[]> {
  return pageOf(AuditEntryDto).parse(await ok(await projectAuditApi(who, projectId), 200, 'project audit')).items;
}

/** The org's whole audit list as `who` reads it over the API. */
async function orgEntries(who: Actor, orgId: string): Promise<AuditEntryDto[]> {
  return pageOf(AuditEntryDto).parse(
    await ok(await who.api.get(`/api/orgs/${orgId}/audit?pageSize=100`), 200, 'org audit'),
  ).items;
}

const patchProject = (who: Actor, projectId: string, data: object, what: string): Promise<unknown> =>
  who.api.patch(`/api/projects/${projectId}`, { data }).then((res) => ok(res, 200, what));

/** What every credential `buildCast` stores starts with. */
const CREDENTIAL_PREFIX = 'sk-ant-e2e-';

const POLLING = { triggerMode: 'polling', pollIntervalSeconds: 1800 };

const ruleBody = (command: string) => ({
  command,
  labelFilter: [],
  target: 'any',
  enabled: true,
  kind: 'prompt',
  prompt: 'Answer in two words.',
});

const skillBody = (name: string): string => `---\nname: ${name}\ndescription: Project audit check.\n---\n\n# ${name}\n`;

/** The project audit after the cast's own entries: the entries of `who` (by name) with `action`. */
const byActor = (all: AuditEntryDto[], who: Actor, action: string): AuditEntryDto[] =>
  all.filter((e) => e.actor?.userId === who.userId && e.action === action);

test.describe('BR-16: P1 Audit log, newest first', () => {
  /** A changes P1's trigger mode, then creates a rule: two requests, one after the other. */
  async function twoChanges(): Promise<void> {
    const { a, p1 } = cast;
    await patchProject(a, p1, POLLING, 'projects.update as A');
    const rule = await a.api.post(`/api/projects/${p1}/rules`, { data: ruleBody(`audit-a-${hex()}`) });
    RuleDto.parse(await ok(rule, 201, 'rules.create as A'));
  }

  /** On the open log: both of A's entries show, the rule entry above the trigger-mode entry. */
  async function expectBothNewestFirst(page: Page): Promise<void> {
    const { a } = cast;
    const trigger = rawEntries(page, a.handle, 'PATCH projects.update');
    const rule = rawEntries(page, a.handle, 'POST rules.create');
    await expect(trigger).toHaveCount(1);
    await expect(rule).toHaveCount(1);
    const rows = page.locator('tbody tr');
    const triggerAt = await rows.evaluateAll(
      (trs, who) =>
        trs.findIndex((tr) => tr.textContent?.includes(who) && tr.textContent.includes('PATCH projects.update')),
      a.handle,
    );
    const ruleAt = await rows.evaluateAll(
      (trs, who) =>
        trs.findIndex((tr) => tr.textContent?.includes(who) && tr.textContent.includes('POST rules.create')),
      a.handle,
    );
    expect(triggerAt, 'the trigger-mode entry is listed').toBeGreaterThanOrEqual(0);
    expect(ruleAt, 'the rule entry is listed').toBeGreaterThanOrEqual(0);
    expect(ruleAt, 'newest first: the rule entry is above the trigger-mode entry').toBeLessThan(triggerAt);
  }

  test('TC-16.4: A changed the trigger mode, then added a rule; A opens P1 Audit log and both entries show, the rule entry above', async () => {
    const { a, o, p1 } = cast;
    await twoChanges();
    try {
      await openLog(a.page, auditUrl(cast, p1));
      await expectBothNewestFirst(a.page);
    } finally {
      await removeRules(o, p1, (command) => command.startsWith('audit-a-'));
    }
  });

  test('TC-16.5: O opens P1 Audit log and the same two entries of A show, the rule entry above', async () => {
    const { o, p1 } = cast;
    await twoChanges();
    await openLog(o.page, auditUrl(cast, p1));
    await expectBothNewestFirst(o.page);
  });
});

test.describe('BR-17: member changes are audited', () => {
  test('TC-17.1: A adds D to P1 as Member; P1 Audit shows the sentence, the org Audit log shows the assignment.granted entry', async () => {
    const { a, d, o, p1, roleIds } = cast;
    const added = await projectMembersApi(a, p1).add(d.userId, roleIds.member);
    expect(added.status(), `A adds D to P1: ${await added.text()}`).toBe(201);

    await openLog(a.page, auditUrl(cast, p1));
    await expect(entries(a.page, a.handle, `${a.handle} added ${d.handle} to this project as Member`)).toHaveCount(1);

    await openLog(o.page, `/o/${cast.slug}/settings/audit`);
    // The org Audit log keeps its existing text for assignment.granted: the raw key and the person it is about.
    const orgRow = entries(o.page, a.handle, `assignment.granted ${d.handle}`);
    await expect(orgRow).toHaveCount(1);
    await expect(orgRow.locator('.mono')).toHaveText('assignment.granted');
  });

  test('TC-17.2: A changes C from Member to Viewer; P1 Audit shows the sentence, the org Audit log an entry with A, C and both roles', async () => {
    const { a, c, o, p1, roleIds } = cast;
    const changed = await projectMembersApi(a, p1).setRole(c.userId, roleIds.viewer);
    expect(changed.status(), `A changes C to Viewer: ${await changed.text()}`).toBe(200);
    const sentence = `${a.handle} changed ${c.handle}'s project role from Member to Viewer`;

    await openLog(a.page, auditUrl(cast, p1));
    await expect(entries(a.page, a.handle, sentence)).toHaveCount(1);

    await openLog(o.page, `/o/${cast.slug}/settings/audit`);
    const orgRow = entries(o.page, a.handle, sentence);
    await expect(orgRow).toHaveCount(1);
    await expect(orgRow.locator(WHAT).locator('b')).toHaveText([a.handle, c.handle]);
  });

  test('TC-17.3: A removes C from P1; P1 Audit shows the sentence with the role C had, the org Audit log an entry with A and C', async () => {
    const { a, c, o, p1 } = cast;
    const removed = await projectMembersApi(a, p1).remove(c.userId);
    expect(removed.status(), `A removes C from P1: ${await removed.text()}`).toBe(204);
    const sentence = `${a.handle} removed ${c.handle} from this project (was Member)`;

    await openLog(a.page, auditUrl(cast, p1));
    await expect(entries(a.page, a.handle, sentence)).toHaveCount(1);

    await openLog(o.page, `/o/${cast.slug}/settings/audit`);
    const orgRow = entries(o.page, a.handle, sentence);
    await expect(orgRow).toHaveCount(1);
    await expect(orgRow.locator(WHAT).locator('b')).toHaveText([a.handle, c.handle]);
  });
});

test.describe('BR-18: project changes are audited', () => {
  /**
   * On P1's open log: `count` entries of A with the raw `key` show, each with A as actor, the key in monospace, and no
   * other text in the What cell (these entries carry no target label).
   */
  async function expectRaw(page: Page, key: string, count = 1): Promise<void> {
    const rows = rawEntries(page, cast.a.handle, key);
    await expect(rows).toHaveCount(count);
    for (let n = 0; n < count; n++) {
      await expect(rows.nth(n).locator(WHO)).toHaveText(cast.a.handle);
      await expect(rows.nth(n).locator(`${WHAT} .mono`)).toHaveText(key);
      await expect(rows.nth(n).locator(WHAT)).toHaveText(key);
    }
    // No secret value appears: the cast set P1's agent credential to `sk-ant-e2e-<hex>` (`buildCast`), so any leak of a
    // stored value into the page or the audit list shows as that prefix. The entries are on the page, so this reads a loaded log.
    await expect(page.locator('body')).not.toContainText(CREDENTIAL_PREFIX);
    expect(await page.content(), 'the page markup').not.toContain(CREDENTIAL_PREFIX);
    expect(JSON.stringify(await projectEntries(cast.a, cast.p1)), 'P1 audit API').not.toContain(CREDENTIAL_PREFIX);
  }

  // TC-18.1 to TC-18.6 make their changes over the API as A, through the real guard: the screens that save them are
  // driven by BR-22's cases (rbac-project-admin-desk.spec.ts). The Agent & settings screen sends one `PATCH projects.update`
  // per save: the trigger-mode save (`useSaveTrigger`: triggerMode, with pollIntervalSeconds when polling, one request per
  // pick) and the limits save (`useSaveLimits`: the run limits as one PATCH, the agent times as one `PUT agents.put`).
  // So the case sends one PATCH per change below, and each shows as its own entry.
  test('TC-18.1: A changes the trigger mode, name, poll interval and a limit of P1; each change shows as a PATCH projects.update entry by A', async () => {
    const { a, p1 } = cast;
    await patchProject(a, p1, POLLING, 'trigger mode');
    await patchProject(a, p1, { name: `Audit ${hex()}` }, 'name');
    await patchProject(a, p1, { pollIntervalSeconds: 900 }, 'poll interval');
    await patchProject(a, p1, { maxConcurrentRuns: 4 }, 'a limit');
    // The owner's own PATCH of the cast is another actor's; A made these four.
    await openLog(a.page, auditUrl(cast, p1));
    await expectRaw(a.page, 'PATCH projects.update', 4);
  });

  test('TC-18.2: A changes the agent configuration of P1; the PUT agents.put entry shows', async () => {
    const { a, o, p1 } = cast;
    const agent = AgentDto.parse(await ok(await o.api.get(`/api/projects/${p1}/agent`), 200, 'agent'));
    await ok(
      await a.api.put(`/api/projects/${p1}/agent`, {
        data: { model: agent.model, timeoutSeconds: agent.timeoutSeconds + 60 },
      }),
      200,
      'agents.put as A',
    );
    await openLog(a.page, auditUrl(cast, p1));
    await expectRaw(a.page, 'PUT agents.put');
  });

  test('TC-18.3: A sets the agent credential to a known value; the PUT agents.putCredential entry shows and the value is nowhere', async () => {
    const { a, o, p1 } = cast;
    const value = `sk-ant-e2e-audit-${randomBytes(12).toString('hex')}`;
    const agent = AgentDto.parse(await ok(await o.api.get(`/api/projects/${p1}/agent`), 200, 'agent'));
    await ok(
      await a.api.put(`/api/agents/${agent.id}/credential`, { data: { type: 'api_key', value } }),
      200,
      'agents.putCredential as A',
    );
    await openLog(a.page, auditUrl(cast, p1));
    await expectRaw(a.page, 'PUT agents.putCredential');
    // The entry is on the page, so the absence below is read from a loaded log.
    await expect(a.page.locator('body')).not.toContainText(value);
    expect(await a.page.content(), 'the page markup').not.toContain(value);
    expect(JSON.stringify(await projectEntries(a, p1)), 'P1 audit API').not.toContain(value);
    expect(JSON.stringify(await orgEntries(o, cast.orgId)), 'org audit API').not.toContain(value);
  });

  test('TC-18.4: A creates a routing rule on P1; the POST rules.create entry shows', async () => {
    const { a, o, p1 } = cast;
    const command = `audit-r-${hex()}`;
    try {
      RuleDto.parse(
        await ok(await a.api.post(`/api/projects/${p1}/rules`, { data: ruleBody(command) }), 201, 'rules.create as A'),
      );
      await openLog(a.page, auditUrl(cast, p1));
      await expectRaw(a.page, 'POST rules.create');
    } finally {
      await removeRules(o, p1, (c) => c === command);
    }
  });

  test('TC-18.5: A adds a skill to P1; the PUT skills.put entry shows', async () => {
    const { a, o, p1 } = cast;
    const skill = `audit-s-${hex()}`;
    try {
      await ok(
        await a.api.put(`/api/projects/${p1}/skills/${skill}`, {
          data: { body: skillBody(skill), message: `add ${skill}` },
        }),
        200,
        'skills.put as A',
      );
      await openLog(a.page, auditUrl(cast, p1));
      await expectRaw(a.page, 'PUT skills.put');
    } finally {
      await quietly(() => o.api.delete(`/api/projects/${p1}/skills/${skill}?message=cleanup`));
    }
  });

  test('TC-18.6: A changes the setup script of P1 and starts a setup test; both entries show', async () => {
    const { a, o, p1 } = cast;
    const script = `#!/usr/bin/env bash\necho audit-${hex()}\n`;
    try {
      const before = SetupScriptDto.nullable().parse(
        await ok(await a.api.get(`/api/projects/${p1}/setup-script`), 200, 'setupScript.get'),
      );
      await ok(
        await a.api.put(`/api/projects/${p1}/setup-script`, {
          data: { body: script, baseVersion: before?.version ?? null },
        }),
        200,
        'setupScript.put as A',
      );
      const started = await a.api.post(`/api/projects/${p1}/setup-tests`, { data: { script } });
      expect(started.ok(), `setupTests.create as A: ${started.status()} ${await started.text()}`).toBe(true);

      await openLog(a.page, auditUrl(cast, p1));
      await expectRaw(a.page, 'PUT setupScript.put');
      await expectRaw(a.page, 'POST setupTests.create');
    } finally {
      // The test's id is only known once the answer is parsed: end whatever the project's latest setup test is.
      await quietly(async () => {
        const latest = SetupTestDto.nullable().parse(
          await ok(await o.api.get(`/api/projects/${p1}/setup-tests/latest`), 200, 'latest'),
        );
        if (latest) await o.api.post(`/api/setup-tests/${latest.id}/end`);
      });
    }
  });

  // TC-18.7 (an environment entry with a secret value) is deferred to #176: environment entries need that feature.

  test('TC-18.8: A cancels RB on P1; the POST runs.cancel entry shows', async () => {
    const { a, rb } = cast;
    const cancelled = await a.api.post(`/api/runs/${rb}/cancel`);
    expect(cancelled.ok(), `runs.cancel as A: ${cancelled.status()} ${await cancelled.text()}`).toBe(true);
    await openLog(a.page, auditUrl(cast, cast.p1));
    await expectRaw(a.page, 'POST runs.cancel');
  });
});

test.describe('BR-19: P1 Audit never shows other projects or orgs', () => {
  test('TC-19.2: O changes P2 trigger mode; A opens P1 Audit log and the P2 change is not listed', async () => {
    const { a, o, p1, p2 } = cast;
    // The owner's own settings entry of P1 (the cast set the project up) is the baseline the page must keep showing.
    const baseline = byActor(await projectEntries(a, p1), o, 'PATCH projects.update').length;
    expect(baseline, 'the cast made one settings change of P1 as O').toBeGreaterThan(0);

    const p2Before = byActor(await projectEntries(o, p2), o, 'PATCH projects.update').length;
    await patchProject(o, p2, POLLING, 'P2 trigger mode as O');
    // Control: the P2 change is in P2's own log, so it exists where it belongs.
    expect(
      byActor(await projectEntries(o, p2), o, 'PATCH projects.update'),
      "P2's own log has the change",
    ).toHaveLength(p2Before + 1);
    // A newer entry of P1, so the log is read after the P2 change and its newest entry is P1's.
    await patchProject(a, p1, { maxConcurrentRuns: 4 }, 'P1 limit as A');

    await openLog(a.page, auditUrl(cast, p1));
    await expect(rawEntries(a.page, a.handle, 'PATCH projects.update')).toHaveCount(1);
    await expect(rawEntries(a.page, o.handle, 'PATCH projects.update')).toHaveCount(baseline);
    const all = await projectEntries(a, p1);
    expect(
      all.filter((e) => e.target.id === p2),
      'no entry targets P2',
    ).toEqual([]);
    expect(byActor(all, o, 'PATCH projects.update')).toHaveLength(baseline);
  });

  test('TC-19.3: O changes an org setting; A opens P1 Audit log and the org-only entries are not listed', async () => {
    const { a, o, p1 } = cast;
    const renamed = `Audit ${hex()}`;
    await ok(await o.api.patch(`/api/orgs/${cast.orgId}`, { data: { name: renamed } }), 200, 'org rename as O');
    // The org entry exists for the org's owner.
    expect(
      (await orgEntries(o, cast.orgId)).some((e) => e.action === 'org.updated'),
      'the org Audit log has the org.updated entry',
    ).toBe(true);
    // A newer entry of P1, so the log is read after the org change and its newest entry is P1's.
    await patchProject(a, p1, { maxConcurrentRuns: 4 }, 'P1 limit as A');

    await openLog(a.page, auditUrl(cast, p1));
    await expect(rawEntries(a.page, a.handle, 'PATCH projects.update')).toHaveCount(1);
    await expect(a.page.locator('tbody tr').filter({ hasText: 'org.updated' })).toHaveCount(0);
    await expect(a.page.locator('tbody tr').filter({ hasText: 'PATCH orgs.update' })).toHaveCount(0);
    expect(
      (await whatTexts(a.page)).filter((t) => t.includes('the organization name')),
      'no organization sentence',
    ).toEqual([]);
    const all = await projectEntries(a, p1);
    expect(all.filter((e) => e.action === 'org.updated' || e.action === 'PATCH orgs.update')).toEqual([]);
  });

  test('TC-19.4: a second org has activity in a project of the same name; A opens P1 Audit log and none of it shows', async ({
    browser,
  }) => {
    const { a, o, p1 } = cast;
    const second = await secondOrg(browser, cast.pa);
    try {
      const name = ProjectDto.parse(await ok(await o.api.get(`/api/projects/${p1}`), 200, 'P1')).name;
      const secondChanges = async (): Promise<number> =>
        (await orgEntries(second.owner, second.orgId)).filter(
          (e) =>
            e.actor?.userId === second.owner.userId &&
            e.action === 'PATCH projects.update' &&
            e.target.id === second.project,
        ).length;
      const before = await secondChanges();
      await patchProject(second.owner, second.project, { name }, 'rename the second org project as its owner');
      await patchProject(second.owner, second.project, POLLING, 'second org trigger mode');
      // Control: the second org's own Audit log has both changes, so they exist where they belong.
      expect(await secondChanges(), "the second org's own log has both changes").toBe(before + 2);
      expect(
        ProjectDto.parse(await ok(await second.owner.api.get(`/api/projects/${second.project}`), 200, 'Y project'))
          .name,
        'the second org project has the name of P1',
      ).toBe(name);
      // A newer entry of P1, so the log is read after the second org's activity and its newest entry is P1's.
      await patchProject(a, p1, { maxConcurrentRuns: 4 }, 'P1 limit as A');

      await openLog(a.page, auditUrl(cast, p1));
      await expect(rawEntries(a.page, a.handle, 'PATCH projects.update')).toHaveCount(1);
      await expect(a.page.locator('tbody tr').filter({ hasText: second.owner.handle })).toHaveCount(0);
      const all = await projectEntries(a, p1);
      expect(
        all.filter((e) => e.actor?.userId === second.owner.userId || e.target.id === second.project),
        "no entry of the second org's owner or project",
      ).toEqual([]);
    } finally {
      await disposeSecondOrg(second);
    }
  });
});

test.describe('BR-25: a demoted admin with the Audit log open', () => {
  test('TC-25.3: A has P1 Audit log open, O demotes A to Member on P1, A reloads and the Forbidden page shows, no entries', async () => {
    const { a, o, p1, roleIds } = cast;
    await openLog(a.page, auditUrl(cast, p1));

    const demoted = await projectMembersApi(o, p1).setRole(a.userId, roleIds.member);
    expect(demoted.status(), `O demotes A to Member on P1: ${await demoted.text()}`).toBe(200);

    await a.page.reload();
    await expect(forbidden(a.page)).toBeVisible();
    await expect(a.page.getByRole('table')).toHaveCount(0);
    await expect(a.page.getByRole('row')).toHaveCount(0);
    await expect(heading(a.page)).toHaveCount(0);
  });
});
