import { randomBytes } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { AuditEntryDto, ProjectDto, pageOf } from '@agentdesk/contracts';
import { API, inviteViaApi, ok } from './helpers';
import { buildCast, disposeCast, type Actor, type Cast } from './rbac-cast';
import { auditUrl, projectAuditApi } from './project-admin';

/*
 * Local end-to-end for the invitation entries of P1's Audit log (spec "E2E requirements": BR-27, TC-27.9 to TC-27.11).
 * A is the admin of P1 only, O the owner (`buildCast`); every case runs in a fresh org. O's invitations are made over
 * the org's own invitation route as O (the signed-in owner's cookie, through the real guard), so O is the actor of each
 * entry; what a case reads is the Audit log page in the browser, and the audit API for what a page cannot show (the
 * absence of an email or of P2's id). A dev-login person's name is their handle. An invitee's email is only an address
 * of the case: nobody accepts the invitation, and each pending invitation is revoked in a `finally`.
 *
 * The expired case of BR-27 is not e2e (expiry is 2 days and a local spec cannot move it): the API integration test
 * proves it.
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

/** The exact text of a cell (whitespace is normalised by the matcher). */
const exact = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

const WHAT = 'td:nth-child(3)';

/** The audit rows whose What cell reads exactly `sentence`. */
function entries(page: Page, sentence: string): Locator {
  return page.locator('tbody tr').filter({ has: page.locator(WHAT, { hasText: exact(sentence) }) });
}

async function openLog(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

/** P1's audit list as `who` reads it over the API (first 100 entries, exactly 200). */
async function projectEntries(who: Actor, projectId: string): Promise<AuditEntryDto[]> {
  return pageOf(AuditEntryDto).parse(await ok(await projectAuditApi(who, projectId), 200, 'project audit')).items;
}

async function projectName(who: Actor, projectId: string): Promise<string> {
  return ProjectDto.parse(await ok(await who.api.get(`/api/projects/${projectId}`), 200, 'project')).name;
}

/** The invitations a case made, revoked (quietly) when the case ends. */
interface Made {
  ids: string[];
}

/** O invites `<tag>-<rand>@dev.local` as Member over `projectIds` (org route, as O); the id is recorded at once. */
async function invite(made: Made, tag: string, projectIds: string[]): Promise<{ id: string; email: string }> {
  const email = `e2e-${tag}-${hex()}@dev.local`;
  const { id } = await inviteViaApi(cast.o.api, cast.orgId, email, 'member', { type: 'project', projectIds }, 'tenant');
  made.ids.push(id);
  return { id, email };
}

async function revokeAll(made: Made): Promise<void> {
  for (const id of made.ids) {
    await quietly(() => cast.o.api.delete(`/api/orgs/${cast.orgId}/invitations/${id}`));
  }
}

/** The names of P1 and P2 (the project name defaults to its repo, so one may be the other plus a suffix), and both sorted. */
async function names(): Promise<{ p1: string; p2: string; both: string }> {
  const p1 = await projectName(cast.o, cast.p1);
  const p2 = await projectName(cast.o, cast.p2);
  expect(p1, 'P1 and P2 have different names').not.toBe(p2);
  const sorted = [p1, p2].sort((x, y) => x.localeCompare(y));
  return { p1, p2, both: sorted.join(', ') };
}

test.describe('BR-27: invitation entries per viewer on P1 Audit log', () => {
  test('TC-27.9: O invites X to P1 only and Y to P1 and P2; A opens P1 Audit log; X shows with the email, Y with no email and no P2 name', async () => {
    const { a, o, p1, p2 } = cast;
    const made: Made = { ids: [] };
    try {
      const { p1: p1Name, p2: p2Name } = await names();
      const x = await invite(made, 'x', [p1]);
      const y = await invite(made, 'y', [p1, p2]);

      await openLog(a.page, auditUrl(cast, p1));
      // X lists P1 only: A administers it, so the email and the project name show.
      const xRow = entries(a.page, `${o.handle} invited ${x.email} as Member to ${p1Name}`);
      await expect(xRow).toHaveCount(1);
      await expect(xRow.locator(`${WHAT} b`)).toHaveText([o.handle, x.email, p1Name]);
      // Y lists P1 and P2: A does not administer P2, so no email, and only P1's name.
      const yRow = entries(a.page, `${o.handle} invited someone as Member to ${p1Name}`);
      await expect(yRow).toHaveCount(1);
      await expect(yRow).not.toContainText(y.email);
      await expect(yRow).not.toContainText(p2Name);
      // The page and the API answer carry neither Y's email nor anything of P2 on Y's entry.
      await expect(a.page.locator('body')).not.toContainText(y.email);
      const entry = (await projectEntries(a, p1)).find((e) => e.target.id === y.id);
      expect(entry, "Y's invitation entry is in A's P1 audit").toBeTruthy();
      expect(entry?.target.label, "Y's entry carries no email").toBeNull();
      expect(entry?.projects, "Y's entry names P1 only").toEqual([{ id: p1, name: p1Name }]);
      expect(JSON.stringify(entry), "Y's entry holds nothing of P2").not.toContain(p2);
      expect(JSON.stringify(entry), "Y's entry holds no email").not.toContain(y.email);
      expect(JSON.stringify(entry), "Y's entry holds no P2 name").not.toContain(p2Name);
    } finally {
      await revokeAll(made);
    }
  });

  test("TC-27.10: as TC-27.9; O opens P1 Audit log and Y's entry shows Y's email and both project names", async () => {
    const { o, p1, p2 } = cast;
    const made: Made = { ids: [] };
    try {
      const { both } = await names();
      await invite(made, 'x', [p1]);
      const y = await invite(made, 'y', [p1, p2]);

      await openLog(o.page, auditUrl(cast, p1));
      const yRow = entries(o.page, `${o.handle} invited ${y.email} as Member to ${both}`);
      await expect(yRow).toHaveCount(1);
      await expect(yRow.locator(`${WHAT} b`)).toHaveText([o.handle, y.email, both]);
    } finally {
      await revokeAll(made);
    }
  });

  test('TC-27.11: O invites Z to P2 only; A opens P1 Audit log and no entry for Z shows', async () => {
    const { a, p1, p2 } = cast;
    const made: Made = { ids: [] };
    try {
      const z = await invite(made, 'z', [p2]);

      await openLog(a.page, auditUrl(cast, p1));
      const shown = await projectEntries(a, p1);
      // Positive control: the log has entries, so the absence below is read from a loaded log.
      expect(shown.length, "A's P1 audit lists entries").toBeGreaterThan(0);
      // The cast's own invitations (A, B, C) list P1, so invitation entries are in this log: only Z's must be absent.
      expect(
        shown.filter((e) => e.target.id === z.id),
        'no entry for the invitation of Z in the P1 audit',
      ).toEqual([]);
      await expect(a.page.locator('tbody tr').filter({ hasText: z.email })).toHaveCount(0);
    } finally {
      await revokeAll(made);
    }
  });
});
