// Headless Chromium check of the Option A navigation. Run:  node design/prototype/interactive/_checks/nav-check.mjs
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
const tabs = (p) => p.$$eval('header.top nav[aria-label="Main"] a', (as) => as.map((a) => a.textContent.trim()));
const activeTab = (p) => p.$$eval('header.top nav[aria-label="Main"] a[aria-current="page"]', (as) => as.map((a) => a.textContent.trim().replace(/\s*\d+ needs you$/, '')));
const hdrCount = (p) => p.$$eval('header.top', (h) => h.length);
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + '.png') });
const crumbs = (p) => p.$$eval('header.top .switch', (b) => b.map((x) => x.textContent.trim()));
const hash = (p) => p.evaluate(() => location.hash.split('?')[0]);
const openOrg = async (p) => { await p.click('header.top button.switch[data-menu="org"]'); await p.waitForSelector('header.top .pop'); };
const menuItems = (p) => p.$$eval('header.top .pop [role=menuitem]', (a) => a.map((x) => x.innerText.trim().replace(/\s+/g, ' ')));
const menuSecs = (p) => p.$$eval('header.top .pop .sec-h', (a) => a.map((x) => x.textContent.trim()));

/* ---- 1. the bar per role ---- */
const ROLES = {
  'kim-hale': { tabs: ['Projects', 'Settings'], orgItems: ['Projects', 'Settings', 'Harbor Labs', 'Northwind Analytics', 'Riverside Municipal Water and Power Utilities Digital Services'] },
  'jordan-wu': { tabs: ['Projects', 'Settings'], orgItems: ['Projects', 'Settings'] },
  'lee-park': { tabs: ['Projects', 'Settings'], orgItems: ['Projects', 'Settings'] },
  'mira-chen': { tabs: ['Projects'], orgItems: ['Projects', 'Harbor Labs', 'Northwind Analytics'] },
  'theo-brandt': { tabs: ['Projects'], orgItems: ['Projects'] },
  'ops-admin': { tabs: ['Projects'], orgItems: ['Projects', 'Harbor Labs', 'Platform admin', 'Create organization'] },
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
  if (persona === 'ops-admin') await shot(p, '05-org-menu-platform-admin');
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
  eq(await activeTab(p), ['Settings'], 'Settings tab active');
  eq(await p.$$eval('nav.subnav', (n) => n.map((x) => x.getAttribute('aria-label'))), ['Organization settings'], 'side menu label');
  eq(await p.$$eval('nav[aria-label="Organization"]', (n) => n.length), 0, 'no second "Organization" landmark');
  await shot(p, '20-settings-general-owner');
  await p.click('header.top nav a:has-text("Members")').catch(() => {});
  await p.click('nav.subnav a:has-text("Members")');
  await p.waitForTimeout(120);
  eq(await activeTab(p), ['Settings'], 'Settings tab stays active on Members');
  await p.click('header.top nav a:has-text("Projects")');
  await p.waitForTimeout(120);
  eq(await hash(p), '#/o/harbor-labs/projects', 'Projects tab goes back');
  eq(await activeTab(p), ['Projects'], 'Projects active again');
  await p.goBack(); await p.waitForTimeout(150);
  eq(await hash(p), '#/o/harbor-labs/settings/members', 'browser back returns to Members');
  eq(await activeTab(p), ['Settings'], 'bar follows browser back');
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
  eq(await p.$$eval('header.top nav[aria-label="Main"] .count-idle', (x) => x.length), 0, 'needs count off by default');
  await p.click('#pc-p-needs'); await p.waitForTimeout(100);
  eq(await p.$$eval('header.top nav[aria-label="Main"] a:first-child .count-idle', (x) => x.map((e) => e.textContent)), ['1 needs you'], 'needs count on the Projects tab');
  await shot(p, '31-toggle-needs-count-on');
  await go(p, '/o/harbor-labs/settings/members'); // count follows on every org page
  eq(await p.$$eval('header.top nav[aria-label="Main"] a:first-child .count-idle', (x) => x.length), 1, 'count also on Settings pages');
  await p.click('#pc-p-needs'); await p.waitForTimeout(100);
  eq(await p.$$eval('header.top nav[aria-label="Main"] .count-idle', (x) => x.length), 0, 'needs count off again');
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
  eq(await tabs(p), ['Runs1 needs you', 'Settings'], 'Runs tabs');
  eq(await activeTab(p), ['Runs'], 'Runs active');
  await shot(p, '40-runs-owner');
  // Settings in 2 clicks (org menu, Settings)
  await openOrg(p); await shot(p, '41-runs-org-menu');
  await p.click('header.top .pop a:text-is("Settings")'); await p.waitForTimeout(150);
  eq(await hash(p), '#/o/harbor-labs/settings/general', 'Runs -> org menu -> Settings (2 clicks)');
  // another org from a project, 2 clicks + switch delay
  await go(p, '/o/harbor-labs/p/invoicer-api/desk/skills');
  eq(await activeTab(p), ['Settings'], 'Settings active');
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
  await p.click('header.top .pop a:text-is("Settings")'); await p.waitForTimeout(150);
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
  eq(await tabs(p), ['Projects', 'Settings'], 'needs-you tabs');
  eq(await activeTab(p), [], 'needs-you has no active tab');
  ok(await p.$('header.top button.avatar'), 'needs-you has the account menu');
  await shot(p, '50-needs-you-owner');
  await go(p, '/o/harbor-labs/projects/new/1');
  eq(await hdrCount(p), 1, 'setup one bar'); eq(await activeTab(p), ['Projects'], 'setup: Projects tab active');
  await shot(p, '51-setup-1');
  await go(p, '/invitations');
  eq(await hdrCount(p), 1, 'my invitations one bar');
  eq(await tabs(p), ['Projects', 'Settings'], 'my invitations (a member of an org) shows the org tabs'); eq(await activeTab(p), [], 'none active');
  await shot(p, '52-my-invitations-owner');
  await go(p, '/orgs/new');
  eq(await tabs(p), [], 'create org: no tabs');
  await p.context().close();
}
{
  const p = await fresh();
  await login(p, 'ops-admin', '/orgs/new');
  eq(await tabs(p), [], 'create org (platform admin): no tabs');
  eq(await crumbs(p), ['No organization'], 'create org crumb');
  await shot(p, '53-create-org-platform');
  await p.click('header.top button.switch[data-menu="org"]');
  eq(await menuItems(p), ['Harbor Labs', 'Platform admin', 'Create organization'], 'create org: org menu');
  await p.keyboard.press('Escape');
  // create an org, land on its Projects page under the bar
  await p.fill('#on', 'Acme Rockets'); await p.fill('#oe', 'boss@acme.example'); await p.click('[data-act="createorg-submit"]'); await p.waitForTimeout(1000);
  await p.click('[data-act="createorg-done"]'); await p.waitForTimeout(200);
  eq(await hash(p), '#/o/acme-rockets/projects', 'new org opens its Projects');
  eq(await crumbs(p), ['Acme Rockets'], 'new org crumb');
  eq(await tabs(p), ['Projects'], 'platform admin: Projects tab only');
  await shot(p, '54-new-org-platform');
  // platform admin typed URL to Settings: forbidden, bar still there, no Settings tab
  await go(p, '/o/harbor-labs/settings/members');
  eq(await hdrCount(p), 1, 'platform admin Settings URL: one bar'); eq(await tabs(p), ['Projects'], 'no Settings tab for platform admin');
  ok(await p.$('text=You don\'t have access'), 'forbidden text shown');
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
  eq(await hdrCount(p), 1, 'project admin Members URL one bar'); eq(await activeTab(p), ['Settings'], 'Settings tab active on forbidden Members');
  await go(p, '/o/harbor-labs/p/invoicer-api/runs');
  await openOrg(p); await p.click('header.top .pop a:text-is("Settings")'); await p.waitForTimeout(150);
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
  await openOrg(p); ok(!(await menuItems(p)).includes('Settings'), persona + ' project org menu: no Settings');
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
  await login(p, 'ops-admin', '/orgs/new');
  await p.evaluate(() => AD.controls.collapse(true)); // the controls panel would cover row actions
  await openOrg(p); await p.click('header.top .pop [role=menuitem]:has-text("Platform admin")'); await p.waitForTimeout(150);
  eq(await hash(p), '#/platform/orgs', 'Platform admin menu item opens the directory');
  eq(await hdrCount(p), 1, 'platform: one bar'); eq(await tabs(p), [], 'platform: no tabs');
  eq(await p.$$eval('nav.subnav[aria-label="Platform admin"] a', (a) => a.map((x) => x.textContent.trim())), ['Organizations', 'Platform admins', 'Audit log'], 'platform side menu');
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

console.log(`passed ${passes}, failed ${fails}`);
console.log('console errors:', errs.length ? errs : 'none');
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
