import { z } from 'zod';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { API, acceptViaApi, inviteAndSignIn, inviteViaApi, signInAs, PLATFORM_ADMIN_HANDLE } from './helpers';
import { withScope, type Scope } from './onboarding-scope';

/*
 * Local end-to-end for the platform admin creating an org and its first owner joining (spec "E2E requirements": BR-34,
 * BR-35, BR-38, BR-40). A dev-login handle `h` signs in as the verified email `h@dev.local`, which is the address an
 * invitation names.
 *
 * The shared platform admin (`admin@dev.local`) only creates orgs through the UI: it never accepts an invitation, so it
 * stays a member of no org (BR-34, BR-40.2). Every case makes its own handles and orgs with a random tag, one browser
 * context per person, and closes every context it opened.
 *
 * TC-40.1 (a platform admin who IS a member of one org) is not written here: the only platform admin of the local
 * stack is the shared `admin@dev.local`, and the only way to make it a member (accept an invitation, which cannot be
 * undone) would break TC-34.1 and TC-40.2 and every spec that expects `admin` to have no org. It needs a second
 * platform admin entry in the stack's `platform_admins` table; the switcher's markup is proven at the lower layer by
 * `apps/web/src/components/OrgSwitch.test.tsx` and `features/orgs/orgSwitch.route.test.tsx`.
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const WELCOME_HEADING = "You're not a member of any organization";

const orgSwitchButton = (page: Page) => page.getByRole('button', { name: /^Switch scope/ });
const switcherMenu = (page: Page) => page.getByRole('dialog', { name: 'Scope' });
const createOrgControl = (page: Page) =>
  page
    .getByRole('link', { name: 'Create organization', exact: true })
    .or(page.getByRole('button', { name: 'Create organization', exact: true }));

/** The platform admin on the welcome page (a fresh context, signed in through dev-login). */
async function adminOnWelcome(scope: Scope, browser: Browser): Promise<Page> {
  const context = await scope.person(browser);
  const page = await signInAs(context, PLATFORM_ADMIN_HANDLE);
  await expect(page.getByRole('heading', { level: 1, name: WELCOME_HEADING })).toBeVisible();
  return page;
}

/** From the welcome page: opens the create-org form and waits for its heading. */
async function openCreateForm(page: Page): Promise<void> {
  await page.getByRole('main').getByText('Create organization', { exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create an organization' })).toBeVisible();
}

const nameField = (page: Page) => page.getByRole('textbox', { name: /^Name/ });
const urlField = (page: Page) => page.getByRole('textbox', { name: /^URL/ });
const emailField = (page: Page) => page.getByRole('textbox', { name: /^First owner email/ });
const createdHeading = (page: Page) => page.getByRole('heading', { name: 'Organization created' });

/** The path (`/invitations/<id>`) in the created card's "Invitation link" field. */
async function createdLinkPath(page: Page): Promise<string> {
  const text = (await page.getByLabel('Invitation link').innerText()).trim();
  const url = new URL(text);
  expect(url.origin, 'the link points at the app').toBe(new URL(page.url()).origin);
  expect(url.pathname).toMatch(/^\/invitations\/[0-9a-f-]+$/);
  return url.pathname;
}

/** Fills the rest of the form (name already typed), presses "Create organization" and waits for the created card. */
async function submitAndWaitCreated(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(createdHeading(page)).toBeVisible();
}

test('TC-34.1: a platform admin who is a member of no org signs in and the welcome page offers Create organization and Sign out', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const page = await adminOnWelcome(scope, browser);
    await expect(page.getByText('Create an organization and invite its first owner.')).toBeVisible();
    await expect(createOrgControl(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  });
});

test('TC-35.1: the create-org form fills the URL from the name and the created card shows the owner link, Copy link and Done', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const page = await adminOnWelcome(scope, browser);
    await openCreateForm(page);
    const name = `E2E Acme ${scope.tag}`;
    await nameField(page).fill(name);
    await expect(page.getByText('/o/', { exact: true })).toBeVisible();
    // The URL field is filled from the name: a slug in the slug format that carries the name's words.
    await expect(urlField(page)).not.toHaveValue('');
    const slug = await urlField(page).inputValue();
    expect(slug, 'the URL filled from the name').toMatch(SLUG_FORMAT);
    expect(slug.length).toBeLessThanOrEqual(63);
    expect(slug, 'the slug is derived from the name').toContain(scope.tag);
    const ownerEmail = scope.email('owner');
    await emailField(page).fill(ownerEmail);
    await submitAndWaitCreated(page);

    const card = createdHeading(page).locator('..');
    await expect(
      card.getByText(
        new RegExp(
          `^Send this link to ${ownerEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. It works only for that email and expires on .*\\d.*\\.$`,
        ),
      ),
    ).toBeVisible();
    await createdLinkPath(page);
    await expect(card.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  });
});

test('TC-35.2: an edited URL becomes the org URL the first owner lands on after opening the link and accepting', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const page = await adminOnWelcome(scope, browser);
    await openCreateForm(page);
    await nameField(page).fill(`E2E Edit ${scope.tag}`);
    const slug = `e2e-${scope.tag}-x`;
    await urlField(page).fill(slug);
    await emailField(page).fill(scope.email('owner'));
    await submitAndWaitCreated(page);
    const link = await createdLinkPath(page);

    const ownerContext = await scope.person(browser);
    const owner = await signInAs(ownerContext, scope.handle('owner'), link);
    await expect(owner.getByRole('heading', { level: 1, name: `Join E2E Edit ${scope.tag}` })).toBeVisible({
      timeout: 30_000, // the first load of the accept page compiles it in the Vite dev server
    });
    await owner.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(owner).toHaveURL(new RegExp(`/o/${slug}/projects$`));
  });
});

test("TC-35.3: pressing Done on the created card goes to the new org's platform page", async ({ browser }) => {
  await withScope(async (scope) => {
    const page = await adminOnWelcome(scope, browser);
    await openCreateForm(page);
    const name = `E2E Done ${scope.tag}`;
    await nameField(page).fill(name);
    await emailField(page).fill(scope.email('owner'));
    await submitAndWaitCreated(page);

    // The new org's id, from the platform directory (the page is signed in as the platform admin).
    const res = await page.request.get(`/api/platform/orgs?pageSize=100&q=${encodeURIComponent(name)}`);
    const body: unknown = await res.json();
    const items = z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) }).parse(body).items;
    const org = items.find((o) => o.name === name);
    expect(org, `org ${name} is not in the platform directory`).toBeTruthy();

    // Every URL the page goes through after the press (client-side navigations included).
    const visited: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
    });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    expect(visited[0], `Done went to the org page, then ${visited.join(' -> ')}`).toBe(`/platform/orgs/${org?.id}`);
  });
});

test('TC-38.1: the first owner opens the copied link, signs in, accepts, and lands in the new org with four Not done steps; the platform admin is not a member', async ({
  browser,
}) => {
  await withScope(
    async (scope) => {
      const admin = await adminOnWelcome(scope, browser);
      await openCreateForm(admin);
      const name = `E2E New ${scope.tag}`;
      const slug = `e2e-new-${scope.tag}`;
      await nameField(admin).fill(name);
      await urlField(admin).fill(slug);
      await emailField(admin).fill(scope.email('owner'));
      await submitAndWaitCreated(admin);
      await admin.getByRole('button', { name: 'Copy link', exact: true }).click();
      const copied = await admin.evaluate(() => navigator.clipboard.readText());
      const link = new URL(copied);

      // The owner context is signed out: opening the link sends it to sign in.
      const ownerContext = await scope.person(browser);
      const owner = await ownerContext.newPage();
      await owner.goto(link.pathname);
      await expect(owner).toHaveURL(/\/sign-in/);
      await owner.goto(`/auth/dev-login?handle=${scope.handle('owner')}&redirect=${encodeURIComponent(link.pathname)}`);
      await expect(owner.getByRole('heading', { level: 1, name: `Join ${name}` })).toBeVisible({
        timeout: 30_000,
      });
      await owner.getByRole('button', { name: 'Accept', exact: true }).click();

      await expect(owner).toHaveURL(new RegExp(`/o/${slug}/projects$`));
      await expect(owner.getByRole('heading', { name: 'Get started' })).toBeVisible();
      const rows = owner.getByRole('listitem').filter({ has: owner.getByRole('img', { name: /^(Done|Not done)$/ }) });
      await expect(rows).toHaveCount(4);
      await expect(owner.getByRole('img', { name: 'Not done', exact: true })).toHaveCount(4);
      await expect(owner.getByRole('img', { name: 'Done', exact: true })).toHaveCount(0);
      for (const label of ['Connect a code host', 'Create a project', 'Add an agent', 'Add a rule']) {
        await expect(rows.filter({ hasText: label })).toHaveCount(1);
      }

      // The platform admin did not become a member: its welcome page and switcher do not list the org.
      await admin.goto('/');
      await expect(admin.getByRole('heading', { level: 1, name: WELCOME_HEADING })).toBeVisible();
      await expect(admin.getByText(name)).toHaveCount(0);
      await orgSwitchButton(admin).click();
      await expect(switcherMenu(admin)).toBeVisible();
      await expect(switcherMenu(admin).getByText(name)).toHaveCount(0);
    },
    { clipboard: true },
  );
});

test('TC-40.2: a platform admin with no org opens "/", and the switcher reads "No organization", holds the Platform group and Create organization, and no org', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const page = await adminOnWelcome(scope, browser);
    await expect(page).toHaveURL(/\/invitations$|\/$/);
    const button = orgSwitchButton(page);
    await expect(button).toHaveText('No organization');
    await button.click();
    const menu = switcherMenu(page);
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link')).toHaveCount(2);
    await expect(
      menu.getByRole('group', { name: 'Platform' }).getByRole('link', { name: 'Platform admin', exact: true }),
    ).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Create organization', exact: true })).toBeVisible();
    await expect(menu.getByRole('group', { name: 'Switch organization' })).toHaveCount(0);
    // One divider: between the Platform group and Create organization.
    await expect(menu.getByRole('separator')).toHaveCount(1);
  });
});

test('TC-40.3: an org owner who is not a platform admin and belongs to two orgs sees both orgs in the switcher and no Create organization', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const first = await scope.org('a');
    const second = await scope.org('b');
    const context: BrowserContext = await scope.person(browser);
    const page = await context.newPage();
    const handle = scope.handle('owner');
    await inviteAndSignIn(page, scope.pa, first.id, handle, 'owner', { type: 'org' });
    const invitation = await inviteViaApi(scope.pa, second.id, scope.email('owner'), 'owner', { type: 'org' });
    await acceptViaApi(page, invitation.id);
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`/o/${first.slug}/projects$`));

    await orgSwitchButton(page).click();
    const menu = switcherMenu(page);
    await expect(menu).toBeVisible();
    const orgs = menu.getByRole('group', { name: 'Switch organization' });
    await expect(orgs.getByRole('link')).toHaveCount(2);
    expect((await orgs.getByRole('link').allInnerTexts()).map((t) => t.trim()).sort()).toEqual(
      [first.name, second.name].sort(),
    );
    await expect(menu.getByText('Create organization')).toHaveCount(0);
    // The one divider separates Projects from the org group; a non-admin has no Create organization divider after it.
    await expect(menu.getByRole('separator')).toHaveCount(1);
  });
});
