// Headless Chromium check of the navigation: Option A plus the one scope-aware shell (2026-11-24 navigation-consistency spec). Run:  node design/prototype/interactive/_checks/nav-check.mjs
// Needs playwright-core (found in the repo's node_modules, read-only) and an installed headless Chromium. Screenshots go to ./nav/.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PW_CORE_DIR || '/Users/minhtrucnguyen/working/ntm/agent-desk/node_modules/.pnpm/playwright-core@1.65.0/node_modules/');
const { chromium } = require('playwright-core');
const shell = fs.readdirSync(path.join(process.env.HOME, 'Library/Caches/ms-playwright')).filter((d) => d.startsWith('chromium_headless_shell')).sort().reverse()
  .map((d) => path.join(process.env.HOME, 'Library/Caches/ms-playwright', d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).find((f) => fs.existsSync(f));
const URL0 = pathToFileURL(path.join(here, '../index.html')).href;
const OUT = path.join(here, 'nav');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: shell });
const errs = [];
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('FAIL: ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  await p.goto(URL0 + '#/signin');
  await p.waitForSelector('#pc-persona');
  return p;
}
async function login(p, persona, hash) {
  await p.goto(URL0 + '#/signin'); await p.evaluate(() => AD.acts.signout && 0);
  await p.selectOption('#pc-persona', persona);
  await p.click('a.btn.primary.lg');
  await p.waitForTimeout(150);
  if (hash) { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(150); }
}
const go = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(120); };
const tabs = (p) => p.$$eval('header.top nav.tabs a', (as) => as.map((a) => a.textContent.trim()));
const activeTab = (p) => p.$$eval('header.top nav.tabs a[aria-current="page"]', (as) => as.map((a) => a.textContent.trim().replace(/\s*\d+ needs you$/, '')));
const hdrCount = (p) => p.$$eval('header.top', (h) => h.length);
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + '.png') });
const crumbs = (p) => p.$$eval('header.top .switch', (b) => b.map((x) => x.textContent.trim()));
const hash = (p) => p.evaluate(() => location.hash.split('?')[0]);
const openOrg = async (p) => { await p.click('header.top button.switch[data-menu="org"]'); await p.waitForSelector('header.top .pop'); };
const menuItems = (p) => p.$$eval('header.top .pop [role=menuitem]', (a) => a.map((x) => x.innerText.trim().replace(/\s+/g, ' ')));
const menuSecs = (p) => p.$$eval('header.top .pop .sec-h', (a) => a.map((x) => x.textContent.trim()));

/* ---- 1. the bar per role ---- */
const ROLES = {
  'kim-hale': { tabs: ['Projects', 'Org settings'], orgItems: ['Projects', 'Org settings', 'Harbor Labs', 'Northwind Analytics', 'Riverside Municipal Water and Power Utilities Digital Services'] },
  'jordan-wu': { tabs: ['Projects', 'Org settings'], orgItems: ['Projects', 'Org settings'] },
  'lee-park': { tabs: ['Projects', 'Org settings'], orgItems: ['Projects', 'Org settings'] },
  'mira-chen': { tabs: ['Projects'], orgItems: ['Projects', 'Harbor Labs', 'Northwind Analytics'] },
  'theo-brandt': { tabs: ['Projects'], orgItems: ['Projects'] },
  // platform admin + org admin + project admin: the Platform group comes first
  'priya-natarajan': { tabs: ['Projects', 'Org settings'], orgItems: ['Platform admin', 'Manage this org in Platform', 'Projects', 'Org settings', 'Harbor Labs', 'Northwind Analytics', 'Create organization'] },
};
for (const [persona, want] of Object.entries(ROLES)) {
  const p = await fresh();
  await login(p, persona);
  eq(await hash(p), '#/o/harbor-labs/projects', persona + ' lands on Projects');
  eq(await hdrCount(p), 1, persona + ' one bar');
  eq(await tabs(p), want.tabs, persona + ' tabs on Projects');
  eq(await activeTab(p), ['Projects'], persona + ' active tab');
  eq((await crumbs(p))[0], 'Harbor Labs', persona + ' org crumb is a button');
  // Settings button in the Projects head: off by default
  ok(!(await p.$('main a.btn:text-is("Settings")')), persona + ' no Settings head button by default');
  // org menu
  await openOrg(p);
  eq(await menuItems(p), want.orgItems, persona + ' org menu items');
  if (persona === 'kim-hale') { await shot(p, '01-org-menu-owner'); eq(await menuSecs(p), ['Harbor Labs', 'Switch organization'], 'owner org menu headings'); }
  if (persona === 'jordan-wu') await shot(p, '02-org-menu-one-org-admin');
  if (persona === 'mira-chen') await shot(p, '03-org-menu-member-no-settings');
  if (persona === 'lee-park') await shot(p, '04-org-menu-project-admin');
  if (persona === 'priya-natarajan') { await shot(p, '05-org-menu-platform-admin'); eq(await menuSecs(p), ['Platform', 'Harbor Labs', 'Switch organization'], 'dual-role scope menu headings'); }
  await p.keyboard.press('Escape');
  // account menu: Logout only, never Settings or My invitations
  await p.click('header.top button.avatar');
  eq(await menuItems(p), ['Logout'], persona + ' account menu');
  if (persona === 'kim-hale') await shot(p, '06-account-menu');
  await p.keyboard.press('Escape');
  await shot(p, `10-projects-${persona}`);
  await p.context().close();
}

/* ---- 2. owner: Projects <-> Settings with the tabs, and the back button ---- */
{
  const p = await fresh();
  await login(p, 'kim-hale');
  await p.click('header.top nav a:has-text("Settings")');
  await p.waitForTimeout(150);
  eq(await hash(p), '#/o/harbor-labs/settings/general', 'Settings tab opens General');
  eq(await activeTab(p), ['Org settings'], 'Settings tab active');
  eq(await p.$$eval('nav.subnav', (n) => n.map((x) => x.getAttribute('aria-label'))), ['Organization settings'], 'side menu label');
  eq(await p.$$eval('nav[aria-label="Organization"]', (n) => n.length), 0, 'no second "Organization" landmark');
  await shot(p, '20-settings-general-owner');
  await p.click('header.top nav a:has-text("Members")').catch(() => {});
  await p.click('nav.subnav a:has-text("Members")');
  await p.waitForTimeout(120);
  eq(await activeTab(p), ['Org settings'], 'Settings tab stays active on Members');
  await p.click('header.top nav a:has-text("Projects")');
  await p.waitForTimeout(120);
  eq(await hash(p), '#/o/harbor-labs/projects', 'Projects tab goes back');
  eq(await activeTab(p), ['Projects'], 'Projects active again');
  await p.goBack(); await p.waitForTimeout(150);
  eq(await hash(p), '#/o/harbor-labs/settings/members', 'browser back returns to Members');
  eq(await activeTab(p), ['Org settings'], 'bar follows browser back');
  await p.goBack(); await p.waitForTimeout(150);
  eq(await hash(p), '#/o/harbor-labs/settings/general', 'back again: General');
  // the logo still goes to Projects
  await p.click('header.top a.brand'); await p.waitForTimeout(120);
  eq(await hash(p), '#/o/harbor-labs/projects', 'logo goes to Projects');

  /* proposals */
  await p.click('#pc-p-btn'); await p.waitForTimeout(100);
  ok(!!(await p.$('main a.btn:text-is("Settings")')), 'toggle on: Settings head button shows for the owner');
  await shot(p, '30-toggle-settings-button-on');
  await p.click('main a.btn:text-is("Settings")'); await p.waitForTimeout(150);
  eq(await hash(p), '#/o/harbor-labs/settings/general', 'head button opens Settings');
  await go(p, '/o/harbor-labs/projects');
  await p.click('#pc-p-btn'); await p.waitForTimeout(100);
  ok(!(await p.$('main a.btn:text-is("Settings")')), 'toggle off: button gone');
  eq(await p.$$eval('header.top nav.tabs .count-idle', (x) => x.length), 0, 'needs count off by default');
  await p.click('#pc-p-needs'); await p.waitForTimeout(100);
  eq(await p.$$eval('header.top nav.tabs a:first-child .count-idle', (x) => x.map((e) => e.textContent)), ['1 needs you'], 'needs count on the Projects tab');
  await shot(p, '31-toggle-needs-count-on');
  await go(p, '/o/harbor-labs/settings/members'); // count follows on every org page
  eq(await p.$$eval('header.top nav.tabs a:first-child .count-idle', (x) => x.length), 1, 'count also on Settings pages');
  await p.click('#pc-p-needs'); await p.waitForTimeout(100);
  eq(await p.$$eval('header.top nav.tabs .count-idle', (x) => x.length), 0, 'needs count off again');
  // Reset restores both toggles to off
  await p.click('#pc-p-btn'); await p.click('#pc-p-needs'); await p.click('#pc-reset'); await p.waitForTimeout(200);
  eq(await p.$$eval('#pc-p-btn, #pc-p-needs', (x) => x.map((e) => e.checked)), [false, false], 'Reset turns both proposals off');
  await p.context().close();
}

/* ---- 3. inside a project and a run ---- */
{
  const p = await fresh();
  await login(p, 'kim-hale', '/o/harbor-labs/p/invoicer-api/runs');
  eq(await hdrCount(p), 1, 'Runs one bar');
  eq(await crumbs(p), ['Harbor Labs', 'invoicer-api'], 'Runs crumbs');
  eq(await tabs(p), ['Runs1 needs you', 'Project settings'], 'Runs tabs');
  eq(await activeTab(p), ['Runs'], 'Runs active');
  await shot(p, '40-runs-owner');
  // Settings in 2 clicks (org menu, Settings)
  await openOrg(p); await shot(p, '41-runs-org-menu');
  await p.click('header.top .pop a:text-is("Org settings")'); await p.waitForTimeout(150);
  eq(await hash(p), '#/o/harbor-labs/settings/general', 'Runs -> org menu -> Settings (2 clicks)');
  // another org from a project, 2 clicks + switch delay
  await go(p, '/o/harbor-labs/p/invoicer-api/desk/skills');
  eq(await activeTab(p), ['Project settings'], 'Settings active');
  await openOrg(p); await p.click('header.top .pop a[data-org="northwind"]'); await p.waitForTimeout(1000);
  eq(await hash(p), '#/o/northwind/projects', 'project -> org menu -> Northwind');
  eq((await crumbs(p))[0], 'Northwind Analytics', 'Northwind crumb');
  await shot(p, '42-switched-to-northwind');
  // run page
  await go(p, '/o/harbor-labs/p/invoicer-api/runs/62');
  eq(await hdrCount(p), 1, 'Run one bar');
  eq(await crumbs(p), ['Harbor Labs', 'invoicer-api'], 'Run crumbs');
  eq(await p.$$eval('header.top nav[aria-label="Breadcrumb"] a', (a) => a.map((x) => x.textContent.trim().replace(/\s+/g, ' '))), ['Runs 1'], 'Run page crumb links');
  eq(await p.$$eval('header.top a[href="#/o/harbor-labs/projects"]', (a) => a.length), 1, 'only the logo leads to the all-projects list');
  await shot(p, '43-run-62');
  await p.click('header.top nav[aria-label="Breadcrumb"] a:has-text("Runs")'); await p.waitForTimeout(120);
  eq(await hash(p), '#/o/harbor-labs/p/invoicer-api/runs', 'Run crumb Runs -> project Runs');
  await go(p, '/o/harbor-labs/p/invoicer-api/runs/62');
  await openOrg(p); await shot(p, '44-run-org-menu');
  await p.click('header.top .pop a:text-is("Org settings")'); await p.waitForTimeout(150);
  eq(await hash(p), '#/o/harbor-labs/settings/general', 'Run -> org menu -> Settings (2 clicks)');
  await go(p, '/o/harbor-labs/p/invoicer-api/runs/62');
  await openOrg(p); await p.click('header.top .pop a[data-org="riverside"]'); await p.waitForTimeout(1000);
  eq(await hash(p), '#/o/riverside/projects', 'Run -> org menu -> Riverside (2 clicks)');
  eq(await p.evaluate(() => { const h = document.querySelector('header.top'); return h.scrollWidth <= h.clientWidth + 1; }), true, 'long org name does not overflow the bar');
  await shot(p, '45-riverside-long-name');
  await go(p, '/o/harbor-labs/p/invoicer-api/runs/62');
  await p.click('header.top button.switch[data-menu="proj"]'); await p.waitForSelector('header.top .pop'); await shot(p, '46-run-project-menu');
  await p.click('header.top .pop a:has-text("invoicer-web")'); await p.waitForTimeout(150);
  eq(await hash(p), '#/o/harbor-labs/p/invoicer-web/runs', 'Run -> project menu -> other project (2 clicks)');
  eq(await crumbs(p), ['Harbor Labs', 'invoicer-web'], 'crumb follows project');
  // selecting the current project closes the menu
  await p.click('header.top button.switch[data-menu="proj"]'); await p.click('header.top .pop a[aria-current="true"]'); await p.waitForTimeout(100);
  eq(await p.$$eval('header.top .pop', (x) => x.length), 0, 'picking the current project closes the menu');
  // unknown / hidden project
  await go(p, '/o/harbor-labs/p/nope/runs');
  eq(await hdrCount(p), 1, 'not found has one bar');
  await shot(p, '47-project-not-found');
  await p.context().close();
}

/* ---- 4. needs-you, setup, create org, invitations ---- */
{
  const p = await fresh();
  await login(p, 'kim-hale', '/o/harbor-labs/needs-you');
  eq(await hdrCount(p), 1, 'needs-you has the bar');
  eq(await tabs(p), ['Projects', 'Org settings'], 'needs-you tabs');
  eq(await activeTab(p), [], 'needs-you has no active tab');
  ok(await p.$('header.top button.avatar'), 'needs-you has the account menu');
  await shot(p, '50-needs-you-owner');
  await go(p, '/o/harbor-labs/projects/new/1');
  eq(await hdrCount(p), 1, 'setup one bar'); eq(await activeTab(p), ['Projects'], 'setup: Projects tab active');
  await shot(p, '51-setup-1');
  await go(p, '/invitations');
  eq(await hdrCount(p), 1, 'my invitations one bar');
  eq(await tabs(p), ['Projects', 'Org settings'], 'my invitations (a member of an org) shows the org tabs'); eq(await activeTab(p), [], 'none active');
  await shot(p, '52-my-invitations-owner');
  await go(p, '/orgs/new'); await p.waitForTimeout(100);
  eq(await hash(p), '#/platform/orgs/new', 'old /orgs/new redirects to /platform/orgs/new');
  eq(await tabs(p), [], 'create org (not a platform admin): no tabs');
  ok(await p.$('text=You don\'t have access'), 'create org (not a platform admin): no access');
  await p.context().close();
}
{
  const p = await fresh();
  await login(p, 'ops-admin');
  eq(await hash(p), '#/platform/orgs', 'platform admin with no membership lands on Platform > Organizations');
  await go(p, '/orgs/new'); await p.waitForTimeout(100);
  eq(await hash(p), '#/platform/orgs/new', 'create org lives in the platform shell');
  eq(await tabs(p), ['Organizations', 'Platform admins', 'Audit log'], 'create org: platform tabs');
  eq(await activeTab(p), ['Organizations'], 'create org: Organizations active');
  eq(await crumbs(p), ['Platform'], 'create org: scope crumb Platform');
  eq(await p.$$eval('header.top nav[aria-label="Breadcrumb"] a, header.top nav[aria-label="Breadcrumb"] [aria-current="page"]', (a) => a.map((x) => x.textContent.trim())), ['Organizations', 'Create organization'], 'create org crumbs');
  await shot(p, '53-create-org-platform');
  await p.click('header.top button.switch[data-menu="org"]');
  eq(await menuItems(p), ['Platform admin', 'Create organization'], 'platform admin with no membership: no org list in the scope menu');
  await p.keyboard.press('Escape');
  // create an org, land on its platform detail (the creator is not a member)
  await p.fill('#on', 'Orbit Labs'); await p.fill('#oe', 'boss@orbit.example'); await p.click('[data-act="createorg-submit"]'); await p.waitForTimeout(1000);
  await p.click('[data-act="createorg-done"]'); await p.waitForTimeout(200);
  ok(/^#\/platform\/orgs\/[0-9a-f-]+$/.test(await hash(p)), 'Done opens the new org in the platform area');
  ok(!(await p.$('main a:has-text("Open organization")')), 'not a member of the new org: no Open organization');
  await shot(p, '54-new-org-platform');
  // a non-member platform admin: org pages stay not found (Decision 1)
  await go(p, '/o/harbor-labs/settings/members');
  eq(await hdrCount(p), 1, 'platform admin org URL: one bar');
  ok(await p.$('main h1:text-is("Not found")'), 'platform admin, not a member: org page not found');
  eq(await p.title(), 'Not found · Agent Desk', 'not found title');
  await p.context().close();
}
{
  const p = await fresh();
  await login(p, 'dana-ortiz');
  eq(await hash(p), '#/invitations', 'Dana lands on My invitations');
  eq(await hdrCount(p), 1, 'Dana one bar'); eq(await tabs(p), [], 'Dana no tabs');
  eq(await p.$$eval('header.top .muted', (x) => x.map((e) => e.textContent.trim())), ['No organization'], 'Dana: No organization');
  await shot(p, '55-dana-no-org');
  await p.click('header.top button.avatar');
  eq(await menuItems(p), ['Logout'], 'Dana account menu');
  await shot(p, '56-dana-account-menu');
  await p.keyboard.press('Escape');
  await p.click('[data-act="mi-accept"] >> nth=0'); await p.waitForTimeout(1200);
  eq(await hash(p), '#/o/harbor-labs/projects', 'accepting still works');
  eq(await tabs(p), ['Projects'], 'new member: Projects tab only');
  await p.click('header.top button.avatar'); await p.click('header.top .pop button[data-act="signout"]'); await p.waitForTimeout(150);
  eq(await hash(p), '#/signin', 'Logout signs out');
  await p.context().close();
}

/* ---- 5. project admin, member, viewer: gates, one-org menus ---- */
{
  const p = await fresh();
  await login(p, 'lee-park');
  await p.click('header.top nav a:has-text("Settings")'); await p.waitForTimeout(150);
  eq(await hash(p), '#/o/harbor-labs/settings/invitations', 'project admin: Settings opens Invitations');
  eq(await p.$$eval('nav.subnav a', (a) => a.map((x) => x.textContent.trim())), ['Invitations'], 'project admin: only Invitations');
  await shot(p, '60-project-admin-settings');
  await go(p, '/o/harbor-labs/settings/members');
  eq(await hdrCount(p), 1, 'project admin Members URL one bar'); eq(await activeTab(p), ['Org settings'], 'Settings tab active on forbidden Members');
  await go(p, '/o/harbor-labs/p/invoicer-api/runs');
  await openOrg(p); await p.click('header.top .pop a:text-is("Org settings")'); await p.waitForTimeout(150);
  eq(await hash(p), '#/o/harbor-labs/settings/invitations', 'project admin: project -> org menu -> Settings');
  await go(p, '/o/harbor-labs/projects');
  eq(await p.$$eval('tbody tr', (r) => r.length), 1, 'project admin sees one project');
  await p.context().close();
}
for (const persona of ['mira-chen', 'theo-brandt']) {
  const p = await fresh();
  await login(p, persona, '/o/harbor-labs/settings/members');
  eq(await hdrCount(p), 1, persona + ' Settings URL one bar'); eq(await tabs(p), ['Projects'], persona + ' no Settings tab');
  ok(await p.$('text=You don\'t have access'), persona + ' forbidden');
  await shot(p, `61-${persona}-settings-url`);
  await go(p, '/o/harbor-labs/p/invoicer-web/runs');
  await openOrg(p); ok(!(await menuItems(p)).includes('Org settings'), persona + ' project org menu: no Settings');
  await p.context().close();
}
{ // jordan: org admin, no Owner card etc. is unchanged; just check Settings tabs
  const p = await fresh();
  await login(p, 'jordan-wu', '/o/harbor-labs/settings/members');
  eq(await p.$$eval('nav.subnav a', (a) => a.map((x) => x.textContent.trim())), ['General', 'Members', 'Invitations', 'Audit log'], 'org admin side menu');
  await shot(p, '62-org-admin-members');
  await p.context().close();
}

/* ---- 6. every board: exactly one bar (or none where the board is drawn without one), none doubled ---- */
{
  const p = await fresh();
  await login(p, 'kim-hale');
  const names = await p.evaluate(() => Object.keys(AD.B));
  const NONE = new Set(['Main', 'SignIn', 'SignInNoInvitation', 'Pagination', 'RunTranscriptStates']);
  const bad = [];
  for (const n of names) {
    const r = await p.evaluate((n) => AD.boardRoute(n), n);
    await p.evaluate(([path, q]) => { location.hash = AD.href(path, q); }, [r.path, r.q]);
    await p.waitForTimeout(25);
    const info = await p.evaluate(() => ({ bars: document.querySelectorAll('header.top').length, inner: document.querySelectorAll('#stage .app .app, #stage header.top header.top').length, hash: location.hash }));
    // sign-in boards sign the user out? no: they are public and just draw the board
    const want = NONE.has(n) ? 0 : 1;
    if (info.bars !== want || info.inner) bad.push(`${n}: ${info.bars} bar(s) at ${info.hash}`);
  }
  ok(bad.length === 0, 'board bars: ' + bad.join(' | '));
  console.log(`boards checked: ${names.length}`);
  await p.context().close();
}

/* ---- 6b. Projects boards without and with the Settings head button proposal ---- */
{
  const p = await fresh();
  await login(p, 'kim-hale');
  const btn = (n) => p.evaluate((n) => { const r = AD.boardRoute(n); location.hash = AD.href(r.path, r.q); return new Promise((res) => setTimeout(() => res(!!Array.from(document.querySelectorAll('main a.btn')).find((a) => /^(Settings|Invitations)$/.test(a.textContent.trim()))), 60)); }, n);
  for (const n of ['ProjectsChecklistDoneSettings', 'ProjectsEmptyChecklistSettings', 'ProjectsOrgSwitchOpen', 'ProjectsEmpty']) ok(!(await btn(n)), n + ' has no Settings/Invitations head button by default');
  await p.click('#pc-p-btn');
  ok(!(await btn('ProjectsChecklistDoneSettings')), 'proposal on: the redrawn board has no Settings head button (it is not drawn; the live screens show it, checked below)');
  await go(p, '/o/harbor-labs/projects?s=empty'); // live empty state with the proposal on
  ok(!!(await p.$('main a.btn:text-is("Settings")')), 'proposal on: live empty state shows Settings');
  await p.click('#pc-p-btn');
  await go(p, '/o/harbor-labs/projects?s=empty');
  ok(!(await p.$('main a.btn:text-is("Settings")')), 'proposal off: live empty state has no Settings button');
  await p.context().close();
}

/* ---- 7. screenshot of a few more screens for the record ---- */
{
  const p = await fresh();
  await login(p, 'kim-hale', '/o/harbor-labs/p/invoicer-api/desk/skills');
  await shot(p, '70-desk-owner');
  await go(p, '/o/harbor-labs/settings/invitations'); await shot(p, '71-invitations-owner');
  await p.context().close();
}

/* ---- 8. platform admin area (platform-admin-dashboard spec) ---- */
{
  const p = await fresh();
  await login(p, 'ops-admin', '/platform/orgs/new');
  await p.evaluate(() => AD.controls.collapse(true)); // the controls panel would cover row actions
  await openOrg(p); await p.click('header.top .pop [role=menuitem]:has-text("Platform admin")'); await p.waitForTimeout(150);
  eq(await hash(p), '#/platform/orgs', 'Platform admin menu item opens the directory');
  eq(await hdrCount(p), 1, 'platform: one bar'); eq(await tabs(p), ['Organizations', 'Platform admins', 'Audit log'], 'platform: tabs in the top bar');
  eq(await p.$$eval('nav.subnav', (a) => a.length), 0, 'platform directory: no side menu (the sections are tabs)');
  eq(await p.$$eval('main tbody tr', (r) => r.length), 5, 'directory: 5 orgs');
  await shot(p, '80-platform-orgs');
  await p.fill('#oq', 'blue'); await p.waitForTimeout(450);
  eq(await p.$$eval('main tbody tr', (r) => r.length), 1, 'directory search filters');
  await p.fill('#oq', 'zzz'); await p.waitForTimeout(450);
  ok(await p.$('main h3:text-is("No organizations match")'), 'directory: no match state');
  await p.click('[data-act="pdir-clear"]'); await p.waitForTimeout(120);
  await p.click('main tbody a:text-is("Harbor Labs")'); await p.waitForTimeout(120);
  ok(/^#\/platform\/orgs\/[0-9a-f-]+$/.test(await hash(p)), 'directory row opens the detail');
  // suspend: empty reason is refused, then suspended with a reason
  await p.click('[data-act="porg-status-open"]'); await p.click('[data-act="porg-status"]'); await p.waitForTimeout(80);
  ok(await p.$('.ferr:text-is("Enter a reason.")'), 'suspend: reason required');
  await p.fill('#sr', 'Security review'); await p.click('[data-act="porg-status"]'); await p.waitForTimeout(900);
  ok(await p.$('main .banner.warn'), 'suspended banner'); ok(await p.$('main button:text-is("Reactivate organization")'), 'Reactivate button');
  await shot(p, '81-platform-org-suspended');
  // members: add a project assignment, then remove it
  await go(p, (await hash(p)) + '/members');
  await p.click('main button[aria-label="Actions for Kim Hale"]'); await p.click('[data-act="pm-assign-open"]');
  await p.click('[data-act="pa-mode"][data-v="project"]'); await p.click('[data-act="pm-assign"]'); await p.waitForTimeout(900);
  ok((await p.innerText('main tbody tr:first-child')).includes('Member (invoicer-api)'), 'assignment added');
  await p.click('main button[aria-label="Actions for Kim Hale"]'); await p.click('[data-act="pm-remove-open"][data-scope="invoicer-api"]'); await p.click('[data-act="pm-remove"]'); await p.waitForTimeout(900);
  ok(!(await p.innerText('main tbody tr:first-child')).includes('invoicer-api'), 'assignment removed');
  // audit: View audit log filters to the org with a removable chip
  await p.click('main a:has-text("View audit log")'); await p.waitForTimeout(120);
  ok((await p.innerText('main')).includes('Organization: Harbor Labs'), 'audit org chip');
  ok((await p.innerText('main tbody tr:first-child')).includes('removed Kim Hale'), 'audit: newest entry first');
  await shot(p, '82-platform-audit-org');
  await p.click('[data-act="paud-chip-x"]'); await p.waitForTimeout(120);
  ok(!(await p.innerText('main')).includes('Organization: Harbor Labs'), 'chip removed');
  // admins: revoke Priya, then Morgan is the last working admin
  await go(p, '/platform/admins');
  await p.click('button[aria-label="Revoke platform access for priya.natarajan@agentdesk.example"]'); await p.click('[data-act="padm-revoke"]'); await p.waitForTimeout(900);
  ok(await p.$('button[aria-label="Revoke platform access for morgan.avery@agentdesk.example"][disabled]'), 'last working admin: Revoke disabled');
  await p.click('[data-act="padm-add-open"]'); await p.fill('#pe', 'jo.marsh@example.com'); await p.click('[data-act="padm-add"]'); await p.waitForTimeout(900);
  ok(await p.$('.ferr:text-is("No account has this email yet.")'), 'add: no account');
  await p.fill('#pe', 'jordan.wu@harborlabs.dev'); await p.click('[data-act="padm-add"]'); await p.waitForTimeout(900);
  eq(await p.$$eval('main tbody tr', (r) => r.length), 3, 'add: new row');
  await shot(p, '83-platform-admins');
  // a member of the suspended org sees the fixed message; the switcher marks it
  await p.evaluate(() => AD.controls.setPersona('kim-hale')); await go(p, '/o/harbor-labs/settings/members');
  ok(await p.$('main h1:text-is("This organization is suspended")'), 'suspended org page for a member');
  eq(await tabs(p), [], 'suspended page: no tabs');
  await openOrg(p); ok((await menuItems(p)).includes('Harbor Labs Suspended'), 'switcher marks the suspended org');
  await shot(p, '84-org-suspended-switcher');
  await go(p, '/platform/admins');
  ok(await p.$('main h1:text-is("You don\'t have access")'), 'non-admin: platform forbidden');
  await p.context().close();
}

/* ---- 9. platform: Edit organization (name, URL with confirm, taken URL, suspended org, old link not found) ---- */
{
  const p = await fresh();
  await login(p, 'ops-admin', '/platform/orgs');
  await p.evaluate(() => AD.controls.collapse(true));
  const hl = await p.evaluate(() => AD.platformOrgId('harbor-labs'));
  const bf = await p.evaluate(() => AD.platformOrgId('bluefin-health'));
  await go(p, '/platform/orgs/' + hl);
  eq(await p.$$eval('main button.btn, main a.row', (b) => b.slice(0, 3).map((x) => x.textContent.trim())), ['Edit organization', 'Suspend organization', 'View audit log'], 'detail header actions order');
  await p.click('[data-act="porg-edit-open"]');
  ok(await p.$('#pe-save[disabled]'), 'edit: Save disabled until changed');
  eq(await p.$eval('#en', (i) => i.value), 'Harbor Labs', 'edit: name prefilled');
  // rename only: no confirm, toast, header and side-menu group show the new name
  await p.fill('#en', 'Harbor Labs Group'); ok(!(await p.$('#pe-save[disabled]')), 'edit: Save enabled after a change');
  await p.click('#pe-save'); await p.waitForTimeout(900);
  eq(await p.$eval('main h1', (h) => h.textContent.trim()), 'Harbor Labs Group', 'rename: header');
  ok((await p.innerText('nav.subnav')).includes('Harbor Labs Group'), 'rename: side-menu group');
  // URL: taken slug, then confirm with Cancel keeping the input, then change
  await p.click('[data-act="porg-edit-open"]'); await p.fill('#es', 'northwind'); await p.click('#pe-save');
  ok(await p.$('h2:text-is("Change the organization URL?")'), 'URL change asks to confirm');
  await p.click('[data-act="porg-edit-back"]');
  eq(await p.$eval('#es', (i) => i.value), 'northwind', 'confirm Cancel keeps the input');
  await p.click('#pe-save'); await p.click('[data-act="porg-edit-confirm"]'); await p.waitForTimeout(900);
  ok(await p.$('.ferr:text-is("This URL is taken. Try another.")'), 'taken URL error at the field');
  await p.fill('#es', '-bad-'); await p.click('#pe-save');
  ok(await p.$('.ferr:text-is("Use lowercase letters, numbers and dashes, with no dash at the start or end.")'), 'URL format error');
  await p.fill('#es', 'harbor-group'); await p.click('#pe-save'); await p.click('[data-act="porg-edit-confirm"]'); await p.waitForTimeout(900);
  ok((await p.innerText('main')).includes('/o/harbor-group'), 'new URL on the detail');
  eq(await hash(p), '#/platform/orgs/' + hl, 'detail URL keeps the org id');
  await shot(p, '85-platform-org-edited');
  await go(p, '/platform/orgs');
  ok((await p.innerText('main tbody')).includes('Harbor Labs Group'), 'directory row shows the new name');
  await go(p, '/platform/audit');
  ok((await p.innerText('main tbody tr:first-child')).includes('changed the URL of Harbor Labs Group from /o/harbor-labs to /o/harbor-group'), 'platform audit: org edit entry');
  // suspended org stays editable and stays suspended
  await go(p, '/platform/orgs/' + bf); await p.click('[data-act="porg-edit-open"]'); await p.fill('#en', 'Bluefin Health Co'); await p.click('#pe-save'); await p.waitForTimeout(900);
  ok((await p.innerText('main')).includes('Bluefin Health Co') && await p.$('main .banner.warn'), 'edit on a suspended org; still suspended');
  // a member: old link not found, new link opens, the org audit shows the edit marked Platform admin
  await p.evaluate(() => AD.controls.setPersona('kim-hale')); await go(p, '/o/harbor-labs/projects');
  ok(await p.$('main h1:text-is("Not found")'), 'old /o/<slug> shows not found');
  await go(p, '/o/harbor-group/settings/audit');
  ok((await p.innerText('main tbody tr:first-child')).includes('changed the organization URL from /o/harbor-labs to /o/harbor-group'), 'org audit: URL change');
  ok((await p.innerText('main tbody tr:first-child')).includes('Platform admin'), 'org audit: marked Platform admin');
  await shot(p, '86-org-audit-platform-edit');
  await p.context().close();
}

/* ---- 10. one scope-aware shell (navigation-consistency spec): dual-role flow, crumbs, titles, landmarks, skip link, states ---- */
const navNames = (p) => p.$$eval('nav', (n) => n.map((x) => x.getAttribute('aria-label')));
const crumbTexts = (p) => p.$$eval('header.top nav[aria-label="Breadcrumb"] a, header.top nav[aria-label="Breadcrumb"] [aria-current="page"]', (a) => a.map((x) => x.textContent.trim().replace(/\s+/g, ' ')));
const bells = (p) => p.$$eval('header.top button[aria-label="Notifications"]', (b) => b.length);
const distinctNavs = async (p, where) => { const n = (await navNames(p)).filter((x) => x !== 'Pagination'); ok(new Set(n).size === n.length && !n.includes('Main'), where + ': nav names distinct, none "Main": ' + JSON.stringify(n)); };
{
  const p = await fresh();
  await login(p, 'priya-natarajan');
  await p.evaluate(() => AD.controls.collapse(true));
  const hl = await p.evaluate(() => AD.platformOrgId('harbor-labs'));
  const rv = await p.evaluate(() => AD.platformOrgId('riverside'));
  // org scope
  eq(await hash(p), '#/o/harbor-labs/projects', 'dual role lands on the org');
  eq(await crumbTexts(p), ['Projects'], 'org page crumbs');
  eq(await p.title(), 'Projects · Harbor Labs · Agent Desk', 'org page title');
  eq(await p.$eval('header.top button.switch[data-menu="org"]', (b) => b.getAttribute('aria-label')), 'Switch scope, currently organization Harbor Labs', 'scope button label (org)');
  eq(await p.$$eval('header.top nav.tabs', (n) => n.map((x) => x.getAttribute('aria-label'))), ['Organization sections'], 'org tabs landmark');
  eq(await bells(p), 1, 'bell on the org bar');
  await distinctNavs(p, 'org page');
  // skip link: first focusable, moves focus to main
  await p.keyboard.press('Tab');
  eq(await p.evaluate(() => document.activeElement.textContent.trim()), 'Skip to main content', 'skip link is the first focusable item');
  await shot(p, '90-skip-link');
  await p.keyboard.press('Enter'); await p.waitForTimeout(50);
  eq(await p.evaluate(() => document.activeElement.tagName), 'MAIN', 'skip link moves focus to main');
  // org -> platform: scope menu > Manage this org in Platform
  await openOrg(p); await shot(p, '91-dual-role-scope-menu-org');
  await p.click('header.top .pop a:has-text("Manage this org in Platform")'); await p.waitForTimeout(150);
  eq(await hash(p), '#/platform/orgs/' + hl, 'Manage this org in Platform opens the platform org');
  eq(await crumbs(p), ['Platform'], 'platform scope crumb');
  eq(await p.$eval('header.top button.switch[data-menu="org"]', (b) => b.getAttribute('aria-label')), 'Switch scope, currently Platform', 'scope button label (platform)');
  eq(await crumbTexts(p), ['Organizations', 'Harbor Labs', 'Overview'], 'platform org crumbs');
  eq(await tabs(p), ['Organizations', 'Platform admins', 'Audit log'], 'platform tabs');
  eq(await activeTab(p), ['Organizations'], 'Organizations tab active on an org');
  eq(await bells(p), 1, 'bell on the platform bar');
  ok(await p.$('main a:has-text("Open organization")'), 'member of Harbor Labs: Open organization shown');
  await distinctNavs(p, 'platform org page');
  // side menu: org group only; the org name links to Overview
  await p.click('nav.subnav a:text-is("Members")'); await p.waitForTimeout(120);
  eq(await crumbTexts(p), ['Organizations', 'Harbor Labs', 'Members'], 'crumbs Organizations / Harbor Labs / Members');
  eq(await p.title(), 'Members · Platform · Agent Desk', 'platform org page title');
  eq(await p.$$eval('nav.subnav a', (a) => a.map((x) => x.textContent.trim())), ['Harbor Labs', 'Overview', 'Projects', 'Members', 'Invitations'], 'platform side menu: org group only');
  await shot(p, '92-platform-org-members-dual-role');
  await p.click('nav.subnav a.grp-link'); await p.waitForTimeout(120);
  eq(await hash(p), '#/platform/orgs/' + hl, 'side menu org name opens Overview');
  await p.click('header.top nav[aria-label="Breadcrumb"] a:text-is("Organizations")'); await p.waitForTimeout(120);
  eq(await hash(p), '#/platform/orgs', 'crumb Organizations goes back to the directory');
  // not a member of Riverside: no Open organization
  await go(p, '/platform/orgs/' + rv);
  ok(!(await p.$('main a:has-text("Open organization")')), 'not a member of Riverside: no Open organization');
  // platform -> org: Open organization
  await go(p, '/platform/orgs/' + hl);
  await p.click('main a:has-text("Open organization")'); await p.waitForTimeout(1000);
  eq(await hash(p), '#/o/harbor-labs/projects', 'Open organization lands on the org Projects');
  // org -> project
  await go(p, '/o/harbor-labs/p/invoicer-api/runs');
  eq(await crumbs(p), ['Harbor Labs', 'invoicer-api'], 'project scope crumbs');
  eq(await crumbTexts(p), ['Runs'], 'project page crumb');
  eq(await p.$$eval('header.top nav.tabs', (n) => n.map((x) => x.getAttribute('aria-label'))), ['Project sections'], 'project tabs landmark');
  eq(await p.title(), 'Runs · invoicer-api · Agent Desk', 'project page title');
  await distinctNavs(p, 'project page');
  await shot(p, '93-project-runs-dual-role');
  await go(p, '/o/harbor-labs/p/invoicer-api/desk/rules');
  eq(await crumbTexts(p), ['Project settings', 'Routing rules'], 'Project settings crumbs');
  await go(p, '/o/harbor-labs/p/invoicer-api/runs/62');
  eq(await crumbTexts(p), ['Runs 1', 'Run 62'], 'run page crumbs');
  eq(await p.title(), 'Run 62 · invoicer-api · Agent Desk', 'run page title (never the ticket title)');
  eq(await bells(p), 1, 'bell on the run bar');
  eq(await p.$$eval('header.top [aria-current="page"]', (a) => a.map((x) => x.textContent.trim())), ['Run 62'], 'run crumb is the current page');
  // project -> platform in two clicks
  await openOrg(p); await p.click('header.top .pop a:has-text("Platform admin")'); await p.waitForTimeout(150);
  eq(await hash(p), '#/platform/orgs', 'run -> scope menu -> Platform admin (2 clicks)');
  await openOrg(p);
  eq(await menuItems(p), ['Platform admin', 'Harbor Labs', 'Northwind Analytics', 'Create organization'], 'platform scope menu (dual role): Platform first, then orgs, then Create');
  await shot(p, '94-dual-role-scope-menu-platform');
  await p.click('header.top .pop a[data-org="northwind"]'); await p.waitForTimeout(1000);
  eq(await hash(p), '#/o/northwind/projects', 'platform -> org list -> Northwind');
  eq(await tabs(p), ['Projects', 'Org settings'], 'Northwind (project grant only): Org settings from the invite permission');
  await go(p, '/o/northwind/settings');
  eq(await hash(p), '#/o/northwind/settings/invitations', 'Northwind Org settings opens Invitations');
  // org settings crumbs
  await go(p, '/o/harbor-labs/settings/members');
  eq(await crumbTexts(p), ['Org settings', 'Members'], 'org settings crumbs');
  eq(await p.title(), 'Members · Harbor Labs · Agent Desk', 'org settings title');
  // states: loading (no jump), error, not found
  await go(p, '/platform/orgs/' + hl + '/members');
  const ready = await p.$eval('nav.subnav', (n) => { const k = [...n.children]; return k.map((c) => Math.round(c.getBoundingClientRect().height)); });
  const crumbW = await p.$eval('header.top nav.tabs', (n) => Math.round(n.getBoundingClientRect().left));
  await go(p, '/platform/orgs/' + hl + '/members?s=loading');
  ok(await p.$('header.top .crumb-sk'), 'loading: crumb skeleton');
  const loading = await p.$eval('nav.subnav', (n) => [...n.children].map((c) => Math.round(c.getBoundingClientRect().height)));
  eq(loading, ready, 'loading: side menu items keep their size (no jump)');
  await shot(p, '95-platform-org-loading');
  await go(p, '/platform/orgs/' + hl + '/members?s=error');
  eq(await crumbTexts(p), ['Organizations', 'Organization', 'Members'], 'error: the org crumb reads "Organization"');
  await go(p, '/platform/orgs/00000000-0000-4000-8000-000000000000');
  ok(await p.$('main a:text-is("Back to organizations")'), 'not found keeps Back to organizations');
  eq(await p.title(), 'Not found · Agent Desk', 'platform not found title');
  // me.platform failed: no Platform group
  await go(p, '/o/harbor-labs/projects?s=ProjectsShellScopeMenuPlatformError');
  await openOrg(p);
  ok(!(await menuItems(p)).includes('Platform admin') && !(await menuItems(p)).includes('Create organization'), 'platform check failed: Platform group and Create hidden');
  await p.keyboard.press('Escape');
  await p.context().close();
}
{ // the platform admin with no membership: Harbor Labs page without Open organization, the same shell
  const p = await fresh();
  await login(p, 'ops-admin');
  const hl = await p.evaluate(() => AD.platformOrgId('harbor-labs'));
  await go(p, '/platform/orgs/' + hl + '/members');
  ok(!(await p.$('main a:has-text("Open organization")')), 'non-member platform admin: no Open organization');
  eq(await crumbTexts(p), ['Organizations', 'Harbor Labs', 'Members'], 'non-member: same crumbs');
  await shot(p, '96-platform-org-members-non-member');
  await p.context().close();
}
{ // other roles never see the Platform group or Manage this org in Platform
  for (const persona of ['jordan-wu', 'lee-park']) {
    const p = await fresh();
    await login(p, persona);
    await openOrg(p);
    const items = await menuItems(p);
    ok(!items.includes('Platform admin') && !items.includes('Manage this org in Platform') && !items.includes('Create organization'), persona + ': no Platform group');
    await p.context().close();
  }
}
{ // every new Shell board is reachable: its route renders it and the Scenario selector lists it
  const p = await fresh();
  await login(p, 'priya-natarajan');
  const names = await p.evaluate(() => Object.keys(AD.B).filter((n) => /Shell/.test(n)));
  const bad = [];
  for (const n of names) {
    const r = await p.evaluate((n) => AD.boardRoute(n), n);
    await p.evaluate(([path, q]) => { location.hash = AD.href(path, q); }, [r.path, r.q]);
    await p.waitForTimeout(60);
    const opts = await p.$$eval('#pc-scen option', (o) => o.map((x) => x.value));
    if (!opts.includes(n)) bad.push(n + ' not in Scenario selector at ' + r.path);
    if ((await hdrCount(p)) !== 1) bad.push(n + ' bars');
  }
  ok(bad.length === 0, 'Shell boards reachable: ' + bad.join(' | '));
  console.log(`shell boards checked: ${names.length}`);
  await p.context().close();
}

console.log(`passed ${passes}, failed ${fails}`);
console.log('console errors:', errs.length ? errs : 'none');
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
