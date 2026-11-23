// Visual parity: screenshots each Screens/* story next to its prototype board at the artboard size.
// Usage: pnpm build-storybook && node scripts/parity.mjs   (writes apps/web/parity-out/<board>.{story,proto}.png)
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const protoDir = resolve(root, '../../design/prototype/project');
const staticDir = resolve(root, 'storybook-static');
const outDir = resolve(root, 'parity-out');
const canvas = JSON.parse(readFileSync(join(protoDir, 'canvas.json'), 'utf8'));

// Same rule as src/screens/storyIds.ts: kebab-case of title and export name.
const kebab = (s) =>
  s
    .replace(/([a-z])([A-Z0-9])/g, '$1-$2')
    .replace(/([0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
const stories = {
  Main: ['Screens/Overview', 'Main'],
  NeedsYou: ['Screens/Runs', 'NeedsYou'],
  SignIn: ['Screens/Entry', 'SignIn'],
  ProjectsEmpty: ['Screens/Entry', 'ProjectsEmpty'],
  Projects: ['Screens/Entry', 'Projects'],
  Setup1: ['Screens/Setup', 'Setup1'],
  Setup1Polling: ['Screens/Setup', 'Setup1Polling'],
  Setup1PollingOk: ['Screens/Setup', 'Setup1PollingOk'],
  Setup2: ['Screens/Setup', 'Setup2'],
  SetupWorkspace: ['Screens/Setup', 'SetupWorkspace'],
  Setup3: ['Screens/Setup', 'Setup3'],
  Setup4: ['Screens/Setup', 'Setup4'],
  SetupReady: ['Screens/Setup', 'SetupReady'],
  Runs: ['Screens/Runs', 'Runs'],
  RunsProblems: ['Screens/Runs', 'RunsProblems'],
  Pagination: ['Components/Pagination', 'Board'],
  RunsPaged: ['Screens/Runs', 'RunsPaged'],
  RunsFlatPaged: ['Screens/Runs', 'RunsFlatPaged'],
  RunsPageLoading: ['Screens/Runs', 'RunsPageLoading'],
  RunsEmpty: ['Screens/Runs', 'RunsEmpty'],
  RunsProblemsPaged: ['Screens/Runs', 'RunsProblemsPaged'],
  RunsProblemsEmpty: ['Screens/Runs', 'RunsProblemsEmpty'],
  RunsLinked: ['Screens/Runs', 'RunsLinked'],
  RunsLinkedSeveralPrs: ['Screens/Runs', 'RunsLinkedSeveralPrs'],
  RunsLinkedSplitPr: ['Screens/Runs', 'RunsLinkedSplitPr'],
  RunsLinkedFiltered: ['Screens/Runs', 'RunsLinkedFiltered'],
  RunsLinkedLongChain: ['Screens/Runs', 'RunsLinkedLongChain'],
  RunsPagedLinkedPrOnly: ['Screens/Runs', 'RunsPagedLinkedPrOnly'],
  RunsPagedLinkedIssueOnly: ['Screens/Runs', 'RunsPagedLinkedIssueOnly'],
  RunsPageLoadingLinked: ['Screens/Runs', 'RunsPageLoadingLinked'],
  NeedsYouPaged: ['Screens/Runs', 'NeedsYouPaged'],
  NeedsYouEmpty: ['Screens/Runs', 'NeedsYouNone'],
  RouteLoading: ['Screens/Runs', 'RouteLoading'],
  RouteError: ['Screens/Runs', 'RouteError'],
  ProjectsPaged: ['Screens/Entry', 'ProjectsPaged'],
  DeskRulesPaged: ['Screens/Desk', 'DeskRulesPaged'],
  DeskRulesEmpty: ['Screens/Desk', 'DeskRulesEmpty'],
  DeskSkillsPaged: ['Screens/Desk', 'DeskSkillsPaged'],
  DeskSkillsEmpty: ['Screens/Desk', 'DeskSkillsEmpty'],
  DeskSetupPaged: ['Screens/Desk', 'DeskSetupPaged'],
  DeskSetupVersionsLoading: ['Screens/Desk', 'DeskSetupVersionsLoading'],
  DeskSetupVersionsError: ['Screens/Desk', 'DeskSetupVersionsError'],
  DeskSetupVersionsEmpty: ['Screens/Desk', 'DeskSetupVersionsEmpty'],
  ProjectsChecklist: ['Screens/Entry', 'ProjectsChecklist'],
  ProjectsChecklistDone: ['Screens/Entry', 'ProjectsChecklistDone'],
  ProjectsChecklistError: ['Screens/Entry', 'ProjectsChecklistError'],
  ProjectsChecklistLoading: ['Screens/Entry', 'ProjectsChecklistLoading'],
  ProjectsEmptyChecklist: ['Screens/Entry', 'ProjectsEmptyChecklist'],
  ProjectsEmptyNoCreate: ['Screens/Entry', 'ProjectsEmptyNoCreate'],
  ProjectsMember: ['Screens/Entry', 'ProjectsMember'],
  ProjectsNoAccess: ['Screens/Entry', 'ProjectsNoAccess'],
  ProjectsOrgSwitchAdmin: ['Screens/Entry', 'ProjectsOrgSwitchAdmin'],
  ProjectsOrgSwitchOpen: ['Screens/Entry', 'ProjectsOrgSwitchOpen'],
  ProjectsSwitching: ['Screens/Entry', 'ProjectsSwitching'],
  SignInNoInvitation: ['Screens/Entry', 'SignInNoInvitation'],
  MyInvitations: ['Screens/Invitations', 'MyInvitations'],
  MyInvitationsAccepting: ['Screens/Invitations', 'MyInvitationsAccepting'],
  MyInvitationsEmpty: ['Screens/Invitations', 'MyInvitationsEmpty'],
  MyInvitationsEmptyPlatformAdmin: ['Screens/Invitations', 'MyInvitationsEmptyPlatformAdmin'],
  MyInvitationsError: ['Screens/Invitations', 'MyInvitationsError'],
  MyInvitationsLoading: ['Screens/Invitations', 'MyInvitationsLoading'],
  InvitationAccept: ['Screens/Invitations', 'InvitationAccept'],
  InvitationAcceptAccepted: ['Screens/Invitations', 'InvitationAcceptAccepted'],
  InvitationAcceptAccepting: ['Screens/Invitations', 'InvitationAcceptAccepting'],
  InvitationAcceptDeclineConfirm: ['Screens/Invitations', 'InvitationAcceptDeclineConfirm'],
  InvitationAcceptDeclined: ['Screens/Invitations', 'InvitationAcceptDeclined'],
  InvitationAcceptDeclining: ['Screens/Invitations', 'InvitationAcceptDeclining'],
  InvitationAcceptError: ['Screens/Invitations', 'InvitationAcceptError'],
  InvitationAcceptExpired: ['Screens/Invitations', 'InvitationAcceptExpired'],
  InvitationAcceptExpiredInviterDeleted: ['Screens/Invitations', 'InvitationAcceptExpiredInviterDeleted'],
  InvitationAcceptLoading: ['Screens/Invitations', 'InvitationAcceptLoading'],
  InvitationAcceptNotAvailable: ['Screens/Invitations', 'InvitationAcceptNotAvailable'],
  InvitationAcceptRevoked: ['Screens/Invitations', 'InvitationAcceptRevoked'],
  OrgInvitations: ['Screens/Invitations', 'OrgInvitations'],
  OrgInvitationsAll: ['Screens/Invitations', 'OrgInvitationsAll'],
  OrgInvitationsEmpty: ['Screens/Invitations', 'OrgInvitationsEmpty'],
  OrgInvitationsEmptyAll: ['Screens/Invitations', 'OrgInvitationsEmptyAll'],
  OrgInvitationsEmptyFiltered: ['Screens/Invitations', 'OrgInvitationsEmptyFiltered'],
  OrgInvitationsError: ['Screens/Invitations', 'OrgInvitationsError'],
  OrgInvitationsFiltered: ['Screens/Invitations', 'OrgInvitationsFiltered'],
  OrgInvitationsForbidden: ['Screens/Invitations', 'OrgInvitationsForbidden'],
  OrgInvitationsLoading: ['Screens/Invitations', 'OrgInvitationsLoading'],
  OrgInvitationsPaged: ['Screens/Invitations', 'OrgInvitationsPaged'],
  OrgInvitationsRowMenu: ['Screens/Invitations', 'OrgInvitationsRowMenu'],
  OrgInvitationsRowMenuExpired: ['Screens/Invitations', 'OrgInvitationsRowMenuExpired'],
  OrgInvitationsCopyFailed: ['Screens/Invitations', 'OrgInvitationsCopyFailed'],
  OrgInvitationsCreated: ['Screens/Invitations', 'OrgInvitationsCreated'],
  OrgInvitationsInvite: ['Screens/Invitations', 'OrgInvitationsInvite'],
  OrgInvitationsInviteFieldError: ['Screens/Invitations', 'OrgInvitationsInviteFieldError'],
  OrgInvitationsInviteFormError: ['Screens/Invitations', 'OrgInvitationsInviteFormError'],
  OrgInvitationsInviteProjectAdmin: ['Screens/Invitations', 'OrgInvitationsInviteProjectAdmin'],
  OrgInvitationsInviteProjects: ['Screens/Invitations', 'OrgInvitationsInviteProjects'],
  OrgInvitationsInviteSaving: ['Screens/Invitations', 'OrgInvitationsInviteSaving'],
  OrgInvitationsInviteTabSwitched: ['Screens/Invitations', 'OrgInvitationsInviteTabSwitched'],
  OrgInvitationsLinkCopied: ['Screens/Invitations', 'OrgInvitationsLinkCopied'],
  OrgInvitationsRenewed: ['Screens/Invitations', 'OrgInvitationsRenewed'],
  OrgInvitationsResendConflict: ['Screens/Invitations', 'OrgInvitationsResendConflict'],
  OrgInvitationsResending: ['Screens/Invitations', 'OrgInvitationsResending'],
  OrgInvitationsRevokeConfirm: ['Screens/Invitations', 'OrgInvitationsRevokeConfirm'],
  OrgInvitationsRevoked: ['Screens/Invitations', 'OrgInvitationsRevoked'],
  CreateOrg: ['Screens/Invitations', 'CreateOrg'],
  CreateOrgCreated: ['Screens/Invitations', 'CreateOrgCreated'],
  CreateOrgError: ['Screens/Invitations', 'CreateOrgError'],
  CreateOrgFieldErrors: ['Screens/Invitations', 'CreateOrgFieldErrors'],
  CreateOrgForbidden: ['Screens/Invitations', 'CreateOrgForbidden'],
  CreateOrgInvitationFailed: ['Screens/Invitations', 'CreateOrgInvitationFailed'],
  CreateOrgRetrying: ['Screens/Invitations', 'CreateOrgRetrying'],
  CreateOrgSaving: ['Screens/Invitations', 'CreateOrgSaving'],
  CreateOrgSlugAuto: ['Screens/Invitations', 'CreateOrgSlugAuto'],
  CreateOrgSlugEdited: ['Screens/Invitations', 'CreateOrgSlugEdited'],
  CreateOrgSlugTaken: ['Screens/Invitations', 'CreateOrgSlugTaken'],
  ProjectsChecklistDoneSettings: ['Screens/Entry', 'ProjectsChecklistDoneSettings'],
  ProjectsEmptyChecklistSettings: ['Screens/Entry', 'ProjectsEmptyChecklistSettings'],
  OrgInvitationsSettings: ['Screens/Invitations', 'OrgInvitationsSettings'],
  OrgInvitationsSettingsProjectAdmin: ['Screens/Invitations', 'OrgInvitationsSettingsProjectAdmin'],
  OrgMembers: ['Screens/OrgSettings', 'OrgMembers'],
  OrgMembersAdmin: ['Screens/OrgSettings', 'OrgMembersAdmin'],
  OrgMembersPaged: ['Screens/OrgSettings', 'OrgMembersPaged'],
  OrgMembersEmpty: ['Screens/OrgSettings', 'OrgMembersEmpty'],
  OrgMembersLoading: ['Screens/OrgSettings', 'OrgMembersLoading'],
  OrgMembersError: ['Screens/OrgSettings', 'OrgMembersError'],
  OrgMembersForbidden: ['Screens/OrgSettings', 'OrgMembersForbidden'],
  OrgMembersRowMenu: ['Screens/OrgSettings', 'OrgMembersRowMenu'],
  OrgMembersRowMenuSelf: ['Screens/OrgSettings', 'OrgMembersRowMenuSelf'],
  OrgMembersBusy: ['Screens/OrgSettings', 'OrgMembersBusy'],
  OrgMembersChangeRole: ['Screens/OrgSettings', 'OrgMembersChangeRole'],
  OrgMembersChangeRoleAdmin: ['Screens/OrgSettings', 'OrgMembersChangeRoleAdmin'],
  OrgMembersMakeOwner: ['Screens/OrgSettings', 'OrgMembersMakeOwner'],
  OrgMembersStepDown: ['Screens/OrgSettings', 'OrgMembersStepDown'],
  OrgMembersChangeRoleSaving: ['Screens/OrgSettings', 'OrgMembersChangeRoleSaving'],
  OrgMembersChangeRoleError: ['Screens/OrgSettings', 'OrgMembersChangeRoleError'],
  OrgMembersLastOwner: ['Screens/OrgSettings', 'OrgMembersLastOwner'],
  OrgMembersRoleChanged: ['Screens/OrgSettings', 'OrgMembersRoleChanged'],
  OrgMembersGone: ['Screens/OrgSettings', 'OrgMembersGone'],
  OrgMembersRemoveConfirm: ['Screens/OrgSettings', 'OrgMembersRemoveConfirm'],
  OrgMembersRemoving: ['Screens/OrgSettings', 'OrgMembersRemoving'],
  OrgMembersRemoved: ['Screens/OrgSettings', 'OrgMembersRemoved'],
  OrgMembersRemoveLastOwner: ['Screens/OrgSettings', 'OrgMembersRemoveLastOwner'],
  OrgGeneral: ['Screens/OrgSettings', 'OrgGeneral'],
  OrgGeneralSaving: ['Screens/OrgSettings', 'OrgGeneralSaving'],
  OrgGeneralSaved: ['Screens/OrgSettings', 'OrgGeneralSaved'],
  OrgGeneralFieldErrors: ['Screens/OrgSettings', 'OrgGeneralFieldErrors'],
  OrgGeneralNameTooLong: ['Screens/OrgSettings', 'OrgGeneralNameTooLong'],
  OrgGeneralSlugTaken: ['Screens/OrgSettings', 'OrgGeneralSlugTaken'],
  OrgGeneralSlugConfirm: ['Screens/OrgSettings', 'OrgGeneralSlugConfirm'],
  OrgGeneralFormError: ['Screens/OrgSettings', 'OrgGeneralFormError'],
  OrgGeneralForbidden: ['Screens/OrgSettings', 'OrgGeneralForbidden'],
  OrgAudit: ['Screens/OrgSettings', 'OrgAudit'],
  OrgAuditPaged: ['Screens/OrgSettings', 'OrgAuditPaged'],
  OrgAuditEmpty: ['Screens/OrgSettings', 'OrgAuditEmpty'],
  OrgAuditLoading: ['Screens/OrgSettings', 'OrgAuditLoading'],
  OrgAuditError: ['Screens/OrgSettings', 'OrgAuditError'],
  OrgAuditForbidden: ['Screens/OrgSettings', 'OrgAuditForbidden'],
  ...Object.fromEntries(
    [
      'Starting',
      'Running',
      'Idle',
      'Reconnect',
      'Succeeded',
      'Prompt',
      'Failed',
      'SetupFailed',
      'TimedOut',
      'Cancelled',
      'Stopped',
      'SucceededFinished',
      'TranscriptStates',
      'RunningStop',
      'IdleEnding',
      'StoppedPodLost',
      'StoppedPodLostGaveUp',
      'StoppedPodLostGaveUpOnce',
      'StoppedCrashedGaveUp',
      'StoppedAutoResumeWaiting',
      'StoppedAutoResumeFailedGaveUp',
      'RunningAutoResume',
    ].map((s) => [`Run${s}`, ['Screens/Run detail', `Run${s}`]]),
  ),
  ...Object.fromEntries(
    [
      'Skills',
      'SkillDelete',
      'Rules',
      'RulesPrompt',
      'RulesPromptNew',
      'RulesPromptError',
      'Agent',
      'AgentProjectAdmin',
      'AgentCustomModel',
      'AgentAddressChanged',
      'AgentAutoResume',
      'AgentAutoResumeChanged',
      'AgentAutoResumeError',
      'Setup',
      'SetupTest',
    ].map((s) => [`Desk${s}`, ['Screens/Desk', `Desk${s}`]]),
  ),
};

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};
const server = createServer((req, res) => {
  const p = join(staticDir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(staticDir) || !existsSync(p) || !statSync(p).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }).end(readFileSync(p));
});
if (!existsSync(staticDir)) throw new Error('storybook-static missing: run pnpm build-storybook first');
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch(
  process.env.PARITY_CHROMIUM ? { executablePath: process.env.PARITY_CHROMIUM } : {},
); // or run: npx playwright install chromium
let pairs = 0;
try {
  for (const file of canvas.order) {
    const name = file.replace(/\.dc\.html$/, '');
    const { w, h } = canvas.boards[file];
    const [title, exp] = stories[name] ?? [];
    if (!title) throw new Error(`no story mapped for ${name}`);
    const id = `${title.split('/').map(kebab).join('-')}--${kebab(exp)}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#storybook-root > *', { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(outDir, `${name}.story.png`) });
    await page.goto(pathToFileURL(join(protoDir, file)).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(outDir, `${name}.proto.png`) });
    await ctx.close();
    pairs += 1;
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`${pairs} pairs written to ${outDir}`);
