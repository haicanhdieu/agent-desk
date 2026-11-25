/* Side menu shell (docs/superpowers/specs/2026-11-25-sidebar-navigation-shell-design.md).
   "Side mode": every route under #/side/... is the same live screen, drawn in the new shell. Routes without /side keep
   the tabs shell, so the two can be compared. This file only wraps the prototype's own helpers and uses the classes and
   tokens of the new boards (already in board-styles.css). It must load after js/main.js and before the page is ready. */
(function () {
  'use strict';
  const AD = window.AD;
  const esc = AD.esc;
  const I = AD.I;
  const SN = (AD.sideNav = {});

  /* ---------- the new boards, drawn as they are ---------- */
  const words = (s) => s.trim().split(/\s+/);
  const DESKTOP = words(`
    OrgMembersSideMenu OrgMembersSideMenuCollapsed OrgMembersSideMenuLoading OrgMembersSideMenuError ProjectsSideMenu
    ProjectsSideMenuPlatformAdmin ProjectsMemberSideMenu ProjectsResumeSetup OrgInvitationsSettingsSideMenuProjectAdmin
    RunsSideMenu RunsSideMenuMember RunsSideMenuRepoWarning RunsSideMenuRepoError RunsSideMenuRepoNoBranch RunsSideMenuLoading
    RunsSideMenuError DeskRulesSideMenu DeskRulesSideMenuSetupWarning DeskSkillsSideMenu DeskSetupSideMenu DeskAgentSideMenu
    PlatformOrgsSideMenu CreateOrgSideMenu PlatformOrgProjectsSideMenu PlatformOrgOverviewSideMenuSuspended
    PlatformOrgMembersSideMenuLoading PlatformOrgMembersSideMenuError PlatformOrgOverviewSideMenuNotFound RunIdleSideCollapsed
    RunIdleSideExpanded RunIdle1024 RunRunningSideMenu RunRunningStopSideMenu ProjectsSideSwitcherOpen ProjectsSideSwitcherLoading
    ProjectsSideSwitcherError ProjectsSideSwitcherOneOrgHeld ProjectsSideOneOrg MyInvitationsEmptySideSwitcherHeld
    MyInvitationsEmptyNoOrg RunsSideProjectSwitcher RunsSideProjectSwitcherNoCreate RunsSideProjectSwitcherLoading
    RunsSideProjectSwitcherError RunsSideProjectSwitcherEmpty ProjectsSideAccountMenu OrgSuspendedNoMenu OrgSuspendedPlainName
    OrgAuditForbiddenSideMenu DeskRulesForbiddenSideMenu RunsNotFoundSideMenu RunsNeedsYouNotFound RouteErrorSideMenu
    RouteErrorNoMenu RouteErrorNotFoundNoMenu RouteErrorCrashSideMenu RouteLoadingSideMenu PlatformAdminsForbiddenNoMenu
    MyInvitationsSideMenu MyInvitationsEmptyMember InvitationAcceptSideMenu InvitationAcceptErrorSideMenu
    InvitationAcceptNotAvailableNoMenu Setup3ExitSetup Setup4ExitSetup SetupReadyExitSetup Setup3PreviewDialog
    SignInProofOfConcept`);
  const PHONE = words(`
    SignInPhone ProjectsPhone Setup1Phone Setup2Phone Setup3Phone Setup4Phone SetupReadyPhone Setup3PreviewDialogPhone
    Setup3PhoneDrawer RunsPhone DeskRulesPhone DeskRulesPromptPhone DeskSkillsPhone DeskSetupPhone DeskAgentPhone DeskMembersPhone
    DeskAuditPhone OrgGeneralPhone OrgMembersPhone OrgInvitationsSettingsPhone OrgAuditPhone PlatformOrgsPhone PlatformAdminsPhone
    PlatformAuditPhone PlatformOrgOverviewPhone PlatformOrgProjectsPhone PlatformOrgMembersPhone PlatformOrgInvitationsPhone
    CreateOrgPhone MyInvitationsPhone InvitationAcceptPhone RouteErrorPhone OrgSuspendedPhone RunIdlePhone RunIdlePhoneDetails
    RunReconnectPhone RunStoppedPhone RunRunningPhoneCancelConfirm ProjectsPhoneDrawer RunsPhoneDrawer ProjectsPhoneSwitcher
    DeskAgentAddPhone DeskAgentEditPhone DeskAgentRowMenuPhone DeskAgentDeletePhone DeskAgentGitHubPhone DeskAgentLimitsPhone
    Setup2AgentPickedPhone Setup2AgentRejectedPhone`);
  const NEW = new Set(DESKTOP.concat(PHONE));
  SN.boards = Array.from(NEW);
  const boardWidth = (n) => (PHONE.includes(n) ? 390 : n === 'RunIdle1024' ? 1024 : 1440);

  const fresh = () => ({ width: 'auto', collapsed: false, runOpen: false, drawer: false, menu: 'live', orgs: 'live', projects: 'live', repo: 'data', view: 'Terminal', savedStep: '3' });
  SN.ui = fresh();

  /* ---------- routing: #/side/... is the same route, in side mode ---------- */
  const inSide = () => /^#\/side(\/|\?|$)/.test(location.hash);
  const parse = AD.parseHash;
  AD.parseHash = function () {
    const r = parse();
    r.side = r.parts[0] === 'side';
    if (r.side) { r.parts = r.parts.slice(1); r.path = '/' + r.path.split('/').slice(2).join('/'); }
    return r;
  };
  // Standalone pages (board index, board viewer, gallery) have no side mode.
  const noSide = (path) => /^\/(side|index|b|gallery)(\/|$)/.test(path);
  const nav = AD.nav;
  AD.nav = function (path, q, opts) { return nav(inSide() && !noSide(path) ? '/side' + path : path, q, opts); };
  const sideHref = (h) => (h && h.indexOf('#/') === 0 && !noSide(h.slice(1).split('?')[0]) ? '#/side' + h.slice(1) : h);
  const H = (path, q) => sideHref(AD.href(path, q));

  const resolve = AD.resolve;
  AD.resolve = function (route) {
    if (route.q.s && NEW.has(route.q.s)) return { screen: 'snapshot', params: { board: route.q.s } };
    const p = route.parts;
    const org = p[0] === 'o' ? p[1] : null;
    if (!route.side || !org || (AD.orgSuspendedView && AD.orgSuspendedView(org, route.q))) return resolve(route);
    // The bare project address and the bare /desk address redirect (replace) to Runs.
    if (p[2] === 'p' && p[3] && (p.length === 4 || (p.length === 5 && p[4] === 'desk'))) return { screen: 'sideredirect', params: { org, project: p[3] } };
    // /needs-you is removed: Not found, in the menu of the deepest scope in the URL.
    if (p[2] === 'needs-you') return { screen: 'notfound', params: { org } };
    if (p[2] === 'p' && p[4] === 'runs' && p.length === 5 && route.q.filter === 'ignored' && !route.q.s) route.q.s = 'RunsProblems';
    const res = resolve(route);
    if (res.screen === 'notfound') res.params = { org, project: p[2] === 'p' ? p[3] : undefined };
    return res;
  };
  const canSee = (uid, org, project) => AD.visibleProjects(uid, org).some((x) => x.id === project);
  AD.screens.sideredirect = {
    title: 'Runs',
    render(ctx) {
      const { org, project } = ctx.params;
      if (!canSee(ctx.uid, org, project)) return AD.notFoundOut('This project does not exist, or you cannot see it.');
      setTimeout(() => AD.nav('/o/' + org + '/p/' + project + '/runs', {}, { replace: true }), 0);
      return { header: 'project', h: 900, html: AD.loadingMain() };
    },
  };

  /* ---------- where a new board lives ---------- */
  const platformId = (slug) => (AD.platformOrgId ? AD.platformOrgId(slug) : slug);
  function newBoardPath(name) {
    const org = AD.curOrg();
    const proj = AD.curProject();
    const o = '/o/' + org;
    const p = o + '/p/' + proj;
    let m;
    if (/^SignIn/.test(name)) return '/signin';
    if (/^RouteLoading|^RouteError/.test(name)) return o + '/projects';
    if (/^CreateOrg/.test(name)) return '/platform/orgs/new';
    if (/^MyInvitations/.test(name)) return '/invitations';
    if (/^InvitationAccept/.test(name)) return '/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43';
    if (/^PlatformAdmins/.test(name)) return '/platform/admins';
    if (/^PlatformAudit/.test(name)) return '/platform/audit';
    if (/^PlatformOrgs/.test(name)) return '/platform/orgs';
    if ((m = /^PlatformOrg(Overview|Projects|Members|Invitations)/.exec(name))) {
      return '/platform/orgs/' + platformId(/Suspended/.test(name) ? 'bluefin-health' : 'harbor-labs') + (m[1] === 'Overview' ? '' : '/' + m[1].toLowerCase());
    }
    if (/^OrgSuspended/.test(name)) return o + '/projects';
    if ((m = /^Org(General|Members|Audit|Invitations)/.exec(name))) return o + '/settings/' + m[1].toLowerCase();
    if (/^Setup([1-4])/.test(name)) return o + '/projects/new/' + /^Setup([1-4])/.exec(name)[1];
    if (/^SetupReady/.test(name)) return o + '/projects/new/ready';
    if (/^Projects|^MyProjects/.test(name)) return o + '/projects';
    if (name === 'RunsNeedsYouNotFound') return p + '/needs-you';
    if (/^Runs/.test(name)) return p + '/runs';
    if (/^RunRunning/.test(name)) return p + '/runs/61';
    if (/^Run/.test(name)) return p + '/runs/62';
    if ((m = /^Desk(Agent|Rules|Setup|Skills|Members|Audit)/.exec(name))) return p + '/desk/' + m[1].toLowerCase();
    return o + '/projects';
  }
  const boardRoute = AD.boardRoute;
  AD.boardRoute = function (name) {
    return NEW.has(name) ? { path: '/side' + newBoardPath(name), q: { s: name } } : boardRoute(name);
  };

  /* ---------- pieces copied from the new boards, so the live shell cannot drift from them ---------- */
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };
  const frag = (board, part) => el((AD.B[board] || {})[part || 'body'] || '');
  let iconMap = null;
  function icon(label) {
    if (!iconMap) {
      iconMap = {};
      ['RunsSideMenu', 'OrgMembersSideMenu', 'PlatformOrgsSideMenu', 'PlatformOrgProjectsSideMenu', 'ProjectsSideMenuPlatformAdmin'].forEach((b) => {
        frag(b).querySelectorAll('nav.s-menu li a').forEach((a) => {
          const c = a.cloneNode(true);
          c.querySelectorAll('.count-idle, svg').forEach((x) => x.remove());
          const key = c.textContent.trim();
          const svg = a.querySelector('svg');
          if (svg && !iconMap[key]) iconMap[key] = svg.outerHTML;
        });
      });
    }
    return iconMap[label] || '';
  }
  const outer = (board, sel, part) => { const n = frag(board, part).querySelector(sel); return n ? n.outerHTML : ''; };
  const menuIcon = () => { const n = frag('OrgMembersPhone', 'header').querySelector('button[aria-label="Open menu"]'); return n ? n.innerHTML : ''; };
  const markSvg = () => outer('OrgMembersPhone', '.brand svg', 'header') || I.brand;

  /* ---------- width ---------- */
  function widthClass() {
    const w = SN.ui.width;
    if (w !== 'auto') return w;
    return window.innerWidth < 640 ? 'phone' : window.innerWidth < 1024 ? 'narrow' : 'wide';
  }

  /* ---------- the model: which menu, which switchers, which crumbs ---------- */
  function shellModel(out, ctx) {
    const u = AD.user();
    const screen = ctx.screen;
    const pr = ctx.params || {};
    const state = out.state || '';
    const m = { bar: 'org', menu: null, wizard: false, scope: { kind: 'org' }, project: null, crumbs: [], projectsHref: H('/') };
    const mine = AD.userOrgs(u.id);
    const activeOrg = mine.find((o) => !AD.orgIsSuspended(o.slug));
    const orgScope = (slug) => { const o = AD.org(slug); m.scope = { kind: 'org', slug, name: o ? o.name : slug }; };
    const plainScope = () => { if (mine.length) orgScope(mine[0].slug); else m.scope = { kind: 'none' }; };
    const crumbs = () => AD.chrome.pageCrumbs(out).filter((c) => !['Org settings', 'Project settings'].includes(c.label));

    if (/^platform\.|^createorg$/.test(screen)) {
      if (!u.platform) { plainScope(); return m; }
      m.bar = 'platform';
      m.scope = { kind: 'platform' };
      m.crumbs = state ? [] : crumbs();
      m.menu = platformMenu(screen === 'platform.admins' ? 'admins' : screen === 'platform.audit' ? 'audit' : 'orgs');
      if (screen === 'platform.org') {
        const slug = AD.state.orgs.concat((AD.state.platform || {}).extraOrgs || []).map((o) => o.slug).find((s) => platformId(s) === pr.orgId);
        if (slug && ['overview', 'projects', 'members', 'invitations'].includes(pr.tab)) m.menu = platformOrgMenu(slug, pr.tab);
      }
      return m;
    }
    if (screen === 'myinvites' || screen === 'accept') {
      if (activeOrg) { orgScope(activeOrg.slug); m.menu = orgMenu(activeOrg.slug, null); m.projectsHref = H('/o/' + activeOrg.slug + '/projects'); }
      else plainScope();
      m.crumbs = [{ label: screen === 'accept' ? 'Invitation' : 'My invitations' }];
      return m;
    }
    if (!pr.org) { plainScope(); return m; }
    if (!mine.some((o) => o.slug === pr.org)) { m.scope = { kind: 'unknown' }; return m; }
    orgScope(pr.org);
    m.projectsHref = H('/o/' + pr.org + '/projects');
    if (screen === 'orgsuspended') return m;
    m.crumbs = state ? [] : crumbs();
    if (screen === 'setup' && !state && ctx.perm.createProject) { m.wizard = true; m.crumbs = [{ label: 'New project' }]; return m; }
    if (pr.project) {
      const visible = canSee(u.id, pr.org, pr.project);
      if (visible) {
        m.bar = 'project';
        m.project = pr.project;
        let active = null;
        if (screen === 'runs' || screen === 'run') active = 'runs';
        if (screen === 'desk' && !state) active = pr.tab;
        m.menu = projectMenu(pr.org, pr.project, active, screen === 'run' ? 'true' : 'page');
        if (screen === 'run' && !state) m.crumbs = [{ label: 'Runs', href: H('/o/' + pr.org + '/p/' + pr.project + '/runs') }, { label: 'Run ' + pr.n }];
        return m;
      }
    }
    let active = null;
    if (screen === 'projects') active = 'projects';
    if (/^settings\./.test(screen) && !state) active = pr.tab;
    m.menu = orgMenu(pr.org, active);
    return m;
  }

  // While the org list loads or has failed, membership is unknown: the menu keeps only the item everyone sees
  // (Projects or Runs), with Retry after a failure, and nothing that needs a tenant read. Platform menus stay.
  function accessUnknown(model, ctx) {
    if (SN.ui.orgs === 'live' || ctx.screen === 'orgsuspended') return model;
    model.project = null;
    model.wizard = false;
    if (model.bar === 'platform') return model;
    const org = (ctx.params && ctx.params.org) || model.scope.slug;
    if (!org) return model;
    const project = ctx.params && ctx.params.project;
    const base = '/o/' + org;
    const only = project
      ? item('runs', 'Runs', base + '/p/' + project + '/runs', ctx.screen === 'runs' || ctx.screen === 'run' ? 'runs' : null, { current: ctx.screen === 'run' ? 'true' : 'page' })
      : item('projects', 'Projects', base + '/projects', ctx.screen === 'projects' ? 'projects' : null);
    model.menu = {
      label: project ? 'Project menu' : 'Organization menu',
      back: project ? { label: 'All projects', href: H(base + '/projects') } : null,
      groups: [{ items: [only] }],
      state: SN.ui.orgs === 'error' ? 'error' : 'live',
    };
    return model;
  }
  // The page reads the same list, so it waits or shows the error, as drawn on the two switcher boards.
  function unknownPage() {
    const board = SN.ui.orgs === 'error' ? 'ProjectsSideSwitcherError' : 'ProjectsSideSwitcherLoading';
    const main = frag(board).querySelector('main');
    main.querySelectorAll('button').forEach((b) => b.setAttribute('data-act', 'sn-menu-retry'));
    const host = make('div', 's-host', [main]);
    host.style.cssText = 'flex:1;min-width:0;min-height:0;display:flex;flex-direction:column';
    return host;
  }

  /* ---------- menus ---------- */
  const item = (key, label, path, active, extra) => Object.assign({ label, href: H(path), on: key === active }, extra || {});
  function orgMenu(slug, active) {
    const u = AD.user();
    const p = AD.perm(u.id, slug);
    const base = '/o/' + slug;
    const groups = [{ items: [item('projects', 'Projects', base + '/projects', active)] }];
    const live = SN.ui.menu === 'live';
    const set = [
      p.members && item('members', 'Members', base + '/settings/members', active),
      p.invitations && item('invitations', 'Invitations', base + '/settings/invitations', active),
      p.audit && item('audit', 'Audit log', base + '/settings/audit', active),
      p.general && item('general', 'General', base + '/settings/general', active),
    ].filter(Boolean);
    if (live && set.length) groups.push({ h: 'Settings', items: set });
    const foot = live && u.platform ? `<ul class="s-list"><li><a href="${H('/platform/orgs/' + platformId(slug))}" data-act="sn-pick">${I.ext}Manage in Platform</a></li></ul>` : '';
    return { label: 'Organization menu', groups, foot, state: SN.ui.menu };
  }
  function repoFoot(slug, project) {
    const sample = (AD.state.projects[slug] || []).find((x) => x.id === project);
    const kind = SN.ui.repo === 'data' ? (sample && sample.conn ? sample.conn.kind : 'ok') : SN.ui.repo;
    const board = { ok: 'RunsSideMenu', warn: 'RunsSideMenuRepoWarning', fail: 'RunsSideMenuRepoError', nobranch: 'RunsSideMenuRepoNoBranch' }[kind] || 'RunsSideMenu';
    const foot = frag(board).querySelector('.s-foot');
    if (!foot) return '';
    const repo = (sample && sample.repo ? sample.repo : slug + '/' + project).split('/');
    const lines = foot.querySelectorAll('.s-repo > span:first-child > span');
    if (lines.length === 2) { lines[0].textContent = repo[0] + ' /'; lines[1].textContent = repo[1]; }
    return foot.innerHTML;
  }
  function projectMenu(slug, project, active, current) {
    const u = AD.user();
    const p = AD.perm(u.id, slug);
    const full = p.orgAdmin || p.adminProjects.includes(project);
    const base = '/o/' + slug + '/p/' + project;
    const sample = (AD.state.projects[slug] || []).find((x) => x.id === project);
    const live = SN.ui.menu === 'live';
    const groups = [{ items: [item('runs', 'Runs', base + '/runs', active, { current, badge: live && sample ? sample.needs : 0 })] }];
    if (full && live) {
      groups.push({ h: 'Configure', items: [['rules', 'Routing rules'], ['skills', 'Skills'], ['setup', 'Workspace setup'], ['agent', 'Agent & settings']].map(([k, l]) => item(k, l, base + '/desk/' + k, active)) });
      groups.push({ h: 'Access', items: [['members', 'Members'], ['audit', 'Audit log']].map(([k, l]) => item(k, l, base + '/desk/' + k, active)) });
    }
    return { label: 'Project menu', back: { label: 'All projects', href: H('/o/' + slug + '/projects') }, groups, foot: live ? repoFoot(slug, project) : '', state: SN.ui.menu };
  }
  function platformMenu(active) {
    return { label: 'Platform menu', state: SN.ui.menu, groups: [{ items: [item('orgs', 'Organizations', '/platform/orgs', active), item('admins', 'Platform admins', '/platform/admins', active), item('audit', 'Audit log', '/platform/audit', active)] }] };
  }
  function platformOrgMenu(slug, tab) {
    const id = platformId(slug);
    const base = '/platform/orgs/' + id;
    const o = AD.state.orgs.concat((AD.state.platform || {}).extraOrgs || []).find((x) => x.slug === slug);
    const loading = SN.ui.menu === 'loading';
    const failed = SN.ui.menu === 'error';
    const susp = AD.orgIsSuspended(slug);
    const status = susp ? outer('PlatformOrgOverviewSideMenuSuspended', '.s-orghead .st') : outer('PlatformOrgProjectsSideMenu', '.s-orghead .st');
    const head = loading
      ? outer('PlatformOrgMembersSideMenuLoading', '.s-orghead')
      : `<div class="s-orghead"><b class="s-ell" style="font-weight:600" title="${esc(failed ? 'Organization' : o.name)}">${esc(failed ? 'Organization' : o.name)}</b>${failed ? '' : status}</div>`;
    const items = [item('overview', 'Overview', base, tab), item('projects', 'Projects', base + '/projects', tab), item('members', 'Members', base + '/members', tab), item('invitations', 'Invitations', base + '/invitations', tab)];
    return { label: 'Platform menu', back: { label: 'Organizations', href: H('/platform/orgs') }, head, groups: loading ? [] : [{ items }], state: loading ? 'loading' : 'live' };
  }

  function menuHtml(menu, mode) {
    if (mode === 'strip') return `<nav class="s-strip" aria-label="${menu.label}"><button class="btn ghost iconbtn" aria-label="Expand menu" title="Expand menu" aria-expanded="false" data-act="sn-collapse">${I.next}</button></nav>`;
    const drawer = mode === 'drawer';
    const btn = drawer
      ? `<button class="btn ghost iconbtn" aria-label="Close menu" title="Close menu" data-act="sn-drawer">${I.x}</button>`
      : `<button class="btn ghost iconbtn" aria-label="Collapse menu" title="Collapse menu" aria-expanded="true" data-act="sn-collapse">${I.prev}</button>`;
    const back = menu.back ? `<a href="${menu.back.href}" class="s-back" data-act="sn-pick">${I.prev}${menu.back.label}</a>` : '';
    let html = `<div class="s-mtop"><div class="s-lead">${back}</div>${btn}</div>${menu.head || ''}`;
    if (menu.state === 'loading') {
      html += `<div role="status" aria-label="Loading menu">${[96, 120, 84, 108].map((w) => `<div class="subnav-sk"><span class="sk-line" style="width:15px"></span><span class="sk-line" style="width:${w}px"></span></div>`).join('')}</div>`;
    } else {
      html += menu.groups.map((g, i) => `${g.h ? `<div class="grp-h" id="sg${i}">${g.h}</div>` : ''}<ul class="s-list"${g.h ? ` aria-labelledby="sg${i}"` : ''}>${g.items.map((x) => `<li><a href="${x.href}" data-act="sn-pick"${x.on ? ` class="on" aria-current="${x.current || 'page'}"` : ''}>${icon(x.label)}${esc(x.label)}${x.badge ? `<span class="count-idle s-count" title="${x.badge} run needs you">${x.badge} needs you</span>` : ''}</a></li>`).join('')}</ul>`).join('');
      if (menu.state === 'error') html += `<div class="s-err" role="alert"><span>Could not load the menu.</span><button class="btn sm" data-act="sn-menu-retry">${I.retry}Retry</button></div>`;
    }
    if (menu.foot) html += `<div class="s-foot">${menu.foot}</div>`;
    return `<nav class="subnav s-menu${drawer ? ' s-drawer' : ''}" aria-label="${menu.label}"${drawer ? ' role="dialog" aria-modal="true"' : ''}>${html}</nav>`;
  }

  /* ---------- switchers and account menu ---------- */
  const pop = (label, inner, role) => `<div class="pop" role="${role || 'menu'}" aria-label="${label}" style="left:0;top:calc(100% + 8px);width:300px;max-width:calc(100vw - 32px);padding:8px;gap:2px">${inner}</div>`;
  const RULE = '<div class="s-poprule" role="separator"></div>';
  const mi = (href, ic, label, extra) => `<a href="${href}" class="btn ghost s-menuitem" role="menuitem" data-act="menu-link"${extra || ''}>${ic}${label}</a>`;
  const noIcon = '<span style="width:14px;flex:0 0 auto"></span>';
  const skel = (label) => `<div role="status" aria-label="${label}" style="display:flex;flex-direction:column;gap:8px;padding:6px 8px">${[170, 130, 150].map((w) => `<span class="sk-line" style="width:${w}px"></span>`).join('')}</div>`;
  const popError = (text) => `<div class="s-popnote" role="alert"><span>${text}</span><button class="btn sm" data-act="sn-pop-retry">${I.retry}Retry</button></div>`;

  function orgPop(scope) {
    const u = AD.user();
    const mine = AD.userOrgs(u.id);
    const parts = [];
    if (u.platform) parts.push(mi(H('/platform/orgs'), I.lock16, 'Platform', scope.kind === 'platform' ? ' aria-current="true"' : ''));
    if (SN.ui.orgs === 'loading') parts.push(skel('Loading organizations'));
    else if (SN.ui.orgs === 'error') parts.push(popError('Could not load your organizations.'));
    else if (!mine.length) parts.push('<div class="s-popnote">No organization</div>');
    else {
      parts.push(mine.map((o) => {
        const on = o.slug === scope.slug;
        return `<a href="${H('/o/' + o.slug + '/projects')}" class="btn ghost s-menuitem" role="menuitem" data-act="switch-org" data-org="${esc(o.slug)}"${on ? ' aria-current="true"' : ''}>${on ? I.check : noIcon}<span class="s-ell"${on ? ' style="font-weight:600"' : ''}>${esc(o.name)}</span>${AD.orgIsSuspended(o.slug) ? '<span class="lbl" style="margin-left:auto;flex:0 0 auto">Suspended</span>' : ''}</a>`;
      }).join(''));
    }
    if (u.platform) parts.push(mi(H('/platform/orgs/new'), I.plus16, 'Create organization'));
    return pop('Switch scope', parts.join(RULE));
  }
  function projectPop(slug, cur) {
    const u = AD.user();
    const list = SN.ui.projects === 'empty' ? [] : AD.visibleProjects(u.id, slug);
    const screen = AD.cur.screen;
    const p = AD.perm(u.id, slug);
    // Same page in the new project if allowed, else Runs; from a run page, Runs.
    const target = (id) => {
      const tab = AD.cur.params.tab;
      const keep = screen === 'desk' && (p.orgAdmin || p.adminProjects.includes(id));
      return H('/o/' + slug + '/p/' + id + (keep ? '/desk/' + tab : '/runs'));
    };
    let rows;
    if (SN.ui.projects === 'loading') rows = skel('Loading projects');
    else if (SN.ui.projects === 'error') rows = popError('Could not load your projects.');
    else if (!list.length) rows = '<div class="s-popnote">No projects yet.</div>';
    else rows = list.map((x) => `<a href="${target(x.id)}" class="btn ghost s-menuitem" role="menuitem" data-act="menu-link"${x.id === cur ? ' aria-current="true"' : ''}>${x.id === cur ? I.check : noIcon}<span class="mono s-ell"${x.id === cur ? ' style="font-weight:600"' : ''}>${esc(x.id)}</span>${x.needs ? `<span class="count-idle" style="margin-left:auto" title="${x.needs} run needs you">${x.needs} needs you</span>` : ''}</a>`).join('');
    const foot = mi(H('/o/' + slug + '/projects'), noIcon, 'All projects') + (p.createProject ? mi(H('/o/' + slug + '/projects/new/1'), I.plus16, 'New project') : '');
    return pop('Switch project', `<span class="sec-h" role="presentation" style="padding:4px 8px 6px">Switch project</span>${rows}${RULE}${foot}`);
  }
  function switcher(menu, text, label, popHtml, muted) {
    const open = AD.ui.menu === menu;
    return `<span class="menu-anchor"><button class="switch" data-act="menu" data-menu="${menu}" aria-haspopup="menu" aria-expanded="${open}" aria-label="${esc(label)}" title="${esc(text)}">${muted ? `<span class="s-name muted">${esc(text)}</span>` : `<b style="font-weight:600">${esc(text)}</b>`}${I.chev}</button>${open ? popHtml() : ''}</span>`;
  }
  function scopeHtml(scope) {
    const u = AD.user();
    const draw = () => orgPop(scope);
    if (SN.ui.orgs !== 'live') return switcher('org', scope.kind === 'platform' ? 'Platform' : 'Organization', 'Switch scope', draw, true);
    if (scope.kind === 'platform') return switcher('org', 'Platform', 'Switch scope', draw);
    if (!u.platform && AD.userOrgs(u.id).length <= 1 && scope.kind !== 'unknown') {
      return scope.kind === 'none' ? '<span class="s-plain muted">No organization</span>' : `<b class="s-plain" style="font-weight:600" title="${esc(scope.name)}">${esc(scope.name)}</b>`;
    }
    if (scope.kind === 'unknown') return switcher('org', 'Organization', 'Switch scope', draw, true);
    if (scope.kind === 'none') return switcher('org', 'No organization', 'Switch scope', draw, true);
    return switcher('org', scope.name, 'Switch scope', draw);
  }
  const acctMenu = AD.chrome.acctMenu;
  AD.chrome.acctMenu = function () {
    if (!(AD.cur && AD.cur.route && AD.cur.route.side)) return acctMenu();
    const u = AD.user();
    return `<div class="pop" role="menu" aria-label="Account" style="right:0;top:calc(100% + 8px);width:240px;padding:8px;gap:2px;text-align:left"><span class="sec-h" role="presentation" style="padding:4px 8px 6px;flex-direction:column;align-items:flex-start;gap:2px"><b style="color:var(--text);font-weight:600">${esc(u.name)}</b><span class="mono faint">${esc(u.email)}</span></span>${RULE}${mi(H('/invitations'), icon('Invitations'), 'My invitations')}<button class="btn ghost s-menuitem" role="menuitem" data-act="signout">${I.logout15}<span>Logout</span></button></div>`;
  };

  function headerHtml(m, w) {
    const menuBtn = (m.menu || m.wizard) && w !== 'wide' ? `<button class="btn ghost iconbtn" aria-label="Open menu" title="Open menu" aria-expanded="${SN.ui.drawer}" data-act="sn-drawer">${menuIcon()}</button>` : '';
    const bell = `<button class="btn ghost iconbtn" disabled aria-label="Notifications (coming soon)" title="Notifications (coming soon)">${I.bell}</button>`;
    const switchers = [scopeHtml(m.scope)];
    if (m.project) switchers.push(switcher('proj', m.project, 'Switch project, currently ' + m.project, () => projectPop(m.scope.slug, m.project)));
    const home = m.projectsHref;
    if (w === 'phone') {
      return `<header class="top" data-bar="${m.bar}"><div class="s-top s-ph2"><div class="s-row1">${menuBtn}<a href="${home}" class="brand" aria-label="Agent Desk, home">${markSvg()}</a><span class="grow"></span>${bell}${AD.chrome.avatarButton()}</div><nav class="s-row2" aria-label="Breadcrumb">${switchers.join('')}</nav></div></header>`;
    }
    const slash = '<span class="faint" aria-hidden="true">/</span>';
    const tail = m.crumbs.map((c, i) => (i === m.crumbs.length - 1
      ? `<b class="s-ell" style="font-weight:600" aria-current="page" title="${esc(c.label)}">${esc(c.label)}</b>`
      : `<a href="${c.href}" class="muted crumb-link">${esc(c.label)}</a>`));
    return `<header class="top" data-bar="${m.bar}"><div class="s-top">${menuBtn}<a href="${home}" class="brand" aria-label="Agent Desk, home">${I.brand}</a><span class="sep"></span><nav class="row crumbs" aria-label="Breadcrumb" style="gap:6px;font-size:13.5px;min-width:0">${switchers.concat(tail).join(slash)}</nav><span class="grow"></span>${bell}${AD.chrome.avatarButton()}</div></header>`;
  }

  /* ---------- page content: the shared page header and the spec's smaller changes ---------- */
  const make = (tag, cls, kids) => { const n = document.createElement(tag); if (cls) n.className = cls; (kids || []).forEach((k) => n.appendChild(k)); return n; };
  function pageHeader(title, meta, actions, pill) {
    const row = make('div', 'row', [title].concat(pill ? [pill] : []));
    row.style.cssText = 'gap:10px;flex-wrap:wrap';
    const left = make('div', 's-ph-title', [row]);
    if (meta.length) left.appendChild(make('div', 's-ph-meta', meta));
    const head = make('div', 's-ph', [left]);
    if (actions.length) head.appendChild(make('div', 's-ph-actions', actions));
    title.setAttribute('tabindex', '-1');
    return head;
  }
  const asH1 = (text) => { const h = document.createElement('h1'); h.textContent = text; return h; };
  // Takes a drawn heading row apart: the h1 (or the h2 that stands in for it), the lines under it, the buttons beside it.
  function splitHead(first, title) {
    if (/^H[12]$/.test(first.tagName)) return { title: title ? asH1(title) : first, meta: [], actions: [], used: first };
    let h = null;
    const meta = [];
    const actions = [];
    Array.from(first.children).forEach((c) => {
      if (/^H[12]$/.test(c.tagName)) h = c;
      else if (c.querySelector(':scope > h1, :scope > h2')) Array.from(c.children).forEach((x) => { if (/^H[12]$/.test(x.tagName)) h = x; else meta.push(x); });
      else actions.push(c);
    });
    return { title: title ? asH1(title) : h, meta, actions, used: first };
  }
  const dropUsed = (p) => { if (p.used !== p.title) p.used.remove(); };
  function setMain(main, cls) { main.removeAttribute('style'); main.className = 's-main' + (cls ? ' ' + cls : ''); }

  function ordinaryPage(host) {
    const main = host.querySelector('main');
    if (!main) return;
    const first = Array.from(main.children).find((c) => c.tagName === 'H1' || c.querySelector('h1'));
    if (!first) return;
    const p = splitHead(first);
    if (!p.title) return;
    const head = pageHeader(p.title, p.meta, p.actions);
    dropUsed(p);
    setMain(main);
    main.insertBefore(head, main.firstChild);
  }
  // Routing rules, Skills and Workspace setup fill the window: a header, then the in-page columns.
  function fillPage(host, tab) {
    const row = host.firstElementChild;
    if (!row) return false;
    const cols = Array.from(row.children);
    const box = tab === 'rules' && cols.length === 1 && cols[0].tagName === 'MAIN' ? cols[0] : row;
    let p;
    if (tab === 'rules') {
      const list = box.firstElementChild;
      if (!list || !list.firstElementChild) return false;
      p = splitHead(list.firstElementChild, 'Routing rules');
    } else if (tab === 'setup') {
      const main = cols[0];
      if (!main || !main.firstElementChild || !main.querySelector('h2')) return false;
      p = splitHead(main.firstElementChild, 'Workspace setup');
    } else {
      const list = cols[0];
      if (!list || !list.firstElementChild) return false;
      const headRow = list.firstElementChild;
      const btn = headRow.querySelector('button');
      const path = Array.from(list.children).find((c) => /\.claude\/skills\//.test(c.textContent) && c.tagName === 'P');
      if (btn) btn.className = 'btn primary';
      if (path) { path.className = 'mono'; path.style.cssText = 'font-size:12px'; }
      p = { title: asH1('Skills'), meta: path ? [path] : [], actions: btn ? [btn] : [], used: headRow };
    }
    const head = pageHeader(p.title, p.meta, p.actions);
    dropUsed(p);
    const col = make('div', 's-col', Array.from(box.children));
    // No nested main: a drawn <main> column becomes a div inside the page's one main.
    col.querySelectorAll('main').forEach((x) => { const d = make('div', x.className, Array.from(x.childNodes)); d.setAttribute('style', x.getAttribute('style') || ''); x.replaceWith(d); });
    const main = make('main', 's-main s-fill', [head, col]);
    row.replaceWith(main);
    return true;
  }

  function runPage(host, out, w) {
    const board = AD.B[out.board];
    const row = host.firstElementChild;
    if (!board || !row) return;
    const kids = Array.from(el(AD.fixLinks(board.header)).children);
    const growAt = kids.findIndex((k) => k.classList.contains('grow'));
    if (growAt < 0) return;
    const before = kids.slice(0, growAt);
    const pill = before.find((k) => k.tagName === 'SPAN' && k.querySelector('.st') && !k.querySelector('code.cmd'));
    const meta = before.filter((k) => k !== pill && (k.querySelector('code.cmd') || /(^| )(num|faint|muted|lbl)( |$)/.test(k.className)));
    const actions = kids.slice(growAt + 1).filter((k) => !/(^| )(sep|avatar)( |$)/.test(k.className) && !/full screen/i.test(k.getAttribute('aria-label') || '') && !k.querySelector('.avatar'))
      .filter((k) => !(w !== 'wide' && /context panel/i.test(k.getAttribute('aria-label') || '')));
    const head = pageHeader(asH1('Run ' + AD.cur.params.n), meta, actions, pill);
    const col = make('div', 's-col', Array.from(row.children));
    const main = make('main', 's-main s-fill', [head, col]);
    row.replaceWith(main);
    if (w === 'wide') return;
    const view = SN.ui.view;
    const seg = el(`<div style="padding:8px 16px;border-bottom:1px solid var(--line);display:flex"><div class="seg" role="group" aria-label="Run view switch" style="display:flex;flex:1;align-self:stretch">${['Terminal', 'Details'].map((v) => `<button style="flex:1"${v === view ? ' class="on"' : ''} aria-pressed="${v === view}" data-act="sn-view" data-view="${v}">${v}</button>`).join('')}</div></div>`).firstElementChild;
    main.insertBefore(seg, col);
    col.style.flexDirection = 'column';
    const [term, aside] = Array.from(col.children);
    if (term) {
      term.style.cssText += ';flex:1 1 0;min-height:0;width:100%';
      if (view !== 'Terminal') term.style.display = 'none';
      // Keys show only while the live terminal accepts typing.
      if (out.board === 'RunIdle' || out.board === 'RunRunning') term.insertAdjacentHTML('beforeend', outer('RunIdlePhone', '.s-keys'));
      term.querySelectorAll('.s-keys button').forEach((b) => b.setAttribute('data-act', 'sn-key'));
    }
    if (aside) {
      aside.style.cssText += ';width:100%;flex:1 1 0;min-height:0;overflow:auto;border-left:0';
      if (view !== 'Details') aside.style.display = 'none';
    }
  }

  function projectsPage(host, ctx) {
    const main = host.querySelector('main');
    if (!main) return;
    const intro = Array.from(main.querySelectorAll('p')).find((p) => /After sign-in you land/.test(p.textContent));
    if (intro) intro.textContent = 'After sign-in you land on this list. It is one click away on the logo.';
    const body = main.querySelector('tbody');
    if (!body || !ctx.perm.createProject || ctx.orgSlug !== 'harbor-labs') return;
    const row = frag('ProjectsResumeSetup').querySelector('a[aria-label="Resume setup for reports-service"]');
    const tr = row && row.closest('tr');
    if (!tr) return;
    tr.querySelectorAll('a').forEach((a) => a.setAttribute('href', H('/o/' + ctx.orgSlug + '/projects/new/' + SN.ui.savedStep)));
    body.appendChild(tr);
  }
  function platformProjects(host) {
    const table = host.querySelector('table');
    if (!table) return;
    table.querySelectorAll('tr').forEach((tr) => { if (tr.children.length === 2) tr.appendChild(tr.firstElementChild); });
    const cols = table.querySelectorAll('col');
    if (cols.length === 2) { cols[0].removeAttribute('style'); cols[1].style.width = '44%'; }
    table.querySelectorAll('th').forEach((th) => { if (th.textContent.trim() === 'Id' || th.textContent.trim() === 'ID') th.textContent = 'Id'; });
  }
  function invitationPage(host, ctx) {
    const main = host.querySelector('main');
    const wrap = main && main.children.length === 1 ? main.firstElementChild : null;
    const h = wrap && wrap.querySelector(':scope > h1');
    if (!h) return;
    const mine = AD.userOrgs(ctx.uid).length;
    if (ctx.screen === 'myinvites') {
      if (!mine && !wrap.querySelector('ul')) return; // the no-org welcome stays as today
      if (!wrap.querySelector('ul')) {
        host.innerHTML = '<main class="s-main">' + myInvitationsEmpty(ctx) + '</main>';
        return;
      }
      h.textContent = 'My invitations';
    } else if (!/^Join/.test(h.textContent)) return;
    const head = pageHeader(h, [], []);
    wrap.className = 's-narrow';
    wrap.removeAttribute('style');
    setMain(main);
    main.insertBefore(head, wrap);
  }
  function myInvitationsEmpty(ctx) {
    const b = frag('MyInvitationsEmptyMember').querySelector('main');
    const email = ctx.user ? ctx.user.email : '';
    if (!b) return '';
    const p = Array.from(b.querySelectorAll('p')).find((x) => /No invitations for/.test(x.textContent));
    if (p) p.textContent = 'No invitations for ' + email + '.';
    return b.innerHTML;
  }

  function wizard(host, ctx, w) {
    const row = host.firstElementChild;
    const aside = row && row.querySelector(':scope > aside');
    const main = row && row.querySelector(':scope > main');
    if (!aside || !main) return null;
    const step = ctx.params.step;
    const steps = aside.innerHTML;
    aside.remove();
    main.id = 'main';
    if (step === '3') {
      main.querySelectorAll('a').forEach((a) => {
        if (a.textContent.trim() !== 'Preview') return;
        const card = a.closest('.radio-card');
        const name = card && card.querySelector('b.mono') ? card.querySelector('b.mono').textContent.trim() : 'code-build';
        const b = el(`<button class="btn ghost sm" aria-haspopup="dialog" data-act="sn-preview" data-name="${esc(name)}">Preview</button>`).firstElementChild;
        a.replaceWith(b);
      });
    }
    if (step === '4') {
      const project = 'invoicer-api';
      main.querySelectorAll('a').forEach((a) => {
        if (a.textContent.trim() === 'Change') a.setAttribute('href', H('/o/' + ctx.orgSlug + '/p/' + project + '/desk/agent', { tab: 'limits' }));
      });
    }
    const exit = `<button class="btn" data-act="sn-exit" data-step="${esc(step)}">Exit setup</button>`;
    row.replaceWith(main);
    main.style.minHeight = '0';
    if (w === 'wide') {
      return { steps, column: `<nav aria-label="Setup progress" style="width:300px;flex:0 0 300px;border-right:1px solid var(--line);padding:28px 20px;display:flex;flex-direction:column;gap:18px">${steps}<div style="padding:0 12px">${exit}</div></nav>` };
    }
    const agentStep = main.querySelector(':scope > [data-sc="wizard"]');
    if (agentStep) { wizardAgentNarrow(main, agentStep, exit, w); return { steps, column: '' }; }
    const label = Array.from(main.querySelectorAll('span.muted')).find((s) => /^Step \d of \d/.test(s.textContent));
    const bar = el(`<div class="s-step-row"><span class="muted" style="font-size:13px">${label ? esc(label.textContent) : ''}</span>${exit}</div>`).firstElementChild;
    if (label) label.remove();
    main.insertBefore(bar, main.firstChild);
    stack(main, w);
    if (w === 'phone') phoneRows(main);
    return { steps, column: '' };
  }

  /* ---------- below 1024px: columns stack; below 640px: tables become cards ---------- */
  function stack(box, w) {
    box.style.flexDirection = 'column';
    box.style.gap = '16px';
    box.style.overflow = 'auto';
    box.style.padding = w === 'phone' ? '16px' : '24px 32px';
    Array.from(box.children).forEach((c) => { c.style.flex = '0 0 auto'; c.style.width = '100%'; c.style.maxWidth = '100%'; c.style.borderLeft = '0'; c.style.borderRight = '0'; });
  }
  function toCards(host) {
    host.querySelectorAll('table').forEach((t) => {
      const labels = Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent.trim());
      const ul = make('ul', 's-cards');
      t.querySelectorAll('tbody > tr').forEach((tr) => {
        const li = make('li');
        if (tr.classList.contains('grp')) {
          li.className = 's-grp';
          const src = tr.querySelector('td > *') || tr.querySelector('td');
          Array.from(src.childNodes).forEach((n) => { if (!(n.classList && n.classList.contains('grow'))) li.appendChild(n); });
          ul.appendChild(li);
          return;
        }
        li.className = 's-card' + (tr.classList.contains('needs') ? ' needs' : '');
        const title = make('div', 's-card-t');
        const dl = make('dl');
        const acts = make('div', 's-card-acts');
        let rowMenu = null;
        Array.from(tr.children).forEach((td, n) => {
          const label = labels[n] || '';
          if (n === 0) { title.append(...td.childNodes); return; }
          if (!label || label === 'Actions') {
            if (td.children.length === 1 && /^(More|Actions)/.test(td.firstElementChild.getAttribute('aria-label') || '')) rowMenu = make('span', 's-card-menu', [td.firstElementChild]);
            else acts.append(...td.childNodes);
            return;
          }
          const dt = make('dt'); dt.textContent = label;
          const dd = make('dd'); dd.append(...td.childNodes);
          dl.append(dt, dd);
        });
        li.appendChild(title);
        if (dl.children.length) li.appendChild(dl);
        if (acts.textContent.trim() || acts.children.length) li.appendChild(acts);
        if (rowMenu) li.appendChild(rowMenu);
        ul.appendChild(li);
      });
      t.replaceWith(ul);
    });
  }
  // Phone: rows wrap and two-column grids become one column. Code boxes keep their own layout and scroll.
  function phoneRows(root) {
    const keep = (x) => !!x.closest('.editor, .term, pre, .filters, table');
    root.querySelectorAll('[style*="grid-template-columns"], dl.kv').forEach((d) => {
      if (keep(d)) return;
      // A routing rule row has three columns; the run count and last run (or "Never ran") move under the sentence.
      if (d.children.length === 4 && d.firstElementChild.classList.contains('toggle')) {
        d.style.gridTemplateColumns = '44px minmax(0,1fr) 32px';
        d.children[1].appendChild(d.children[2]);
        return;
      }
      d.style.gridTemplateColumns = 'minmax(0,1fr)';
    });
    root.querySelectorAll('.row, .seg, [style*="display:flex"]').forEach((x) => {
      if (keep(x) || x.matches('.s-col, .editor, .term') || x.style.flexDirection === 'column') return;
      x.style.flexWrap = 'wrap';
      x.style.maxWidth = '100%';
      x.style.minWidth = '0';
    });
  }
  function narrowLayout(host, ctx, w) {
    if (ctx.screen === 'run') {
      // As on the phone run boards, the drawn terminal rules are shortened to the phone width.
      if (w === 'phone') {
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) if (n.parentElement.closest('.term')) n.nodeValue = n.nodeValue.replace(/\u2500{45,}/g, '\u2500'.repeat(44));
      }
      return;
    }
    if (ctx.screen === 'setup') return;
    const col = host.querySelector('main > .s-col');
    if (col) {
      col.style.flexDirection = 'column';
      col.style.overflow = 'auto';
      Array.from(col.children).forEach((c) => { c.style.flex = '0 0 auto'; c.style.width = '100%'; c.style.borderLeft = '0'; c.style.borderRight = '0'; });
    }
    if (w !== 'phone') return;
    toCards(host);
    const main = host.querySelector('main');
    if (main && !main.classList.contains('s-fill')) {
      if (main.classList.contains('s-main')) main.classList.add('s-pad16');
      else { main.style.padding = '16px'; main.style.minWidth = '0'; }
    }
    host.querySelectorAll('.filters').forEach((f) => { f.classList.add('s-chips'); f.style.maxWidth = '100%'; f.style.minWidth = '0'; });
    if (main) phoneRows(main);
  }

  /* ---------- multi-agent screens (Agent & settings, Routing rules, setup step 2) ----------
     screens/deskagent*.js and the multi-agent boards pin their own header, bars and scroll areas, so they are moved into
     the shell as they are, not rearranged like the other pages. */
  function multiAgentKind(host, ctx) {
    if (ctx.screen === 'desk' && ctx.params.tab === 'agent' && host.querySelector('main > [role="tablist"][aria-label="Agent and project settings"]')) return 'agent';
    if (ctx.screen === 'desk' && ctx.params.tab === 'rules' && host.querySelector('main [data-sc="list"]')) return 'rules';
    return null;
  }
  const restyle = (root, from, to) => root.querySelectorAll('[style]').forEach((x) => {
    const before = x.getAttribute('style');
    const after = before.replace(from, to);
    if (after !== before) x.setAttribute('style', after);
  });
  const sidePadding = (root, w) => restyle(root, /padding:([^;]*?) (40|28)px/g, 'padding:$1 ' + (w === 'phone' ? 16 : 32) + 'px');
  // Below 1024px: one column; footers and segmented controls wrap.
  function oneColumn(root) {
    restyle(root, /grid-template-columns:260px minmax\(0,1fr\);gap:32px/g, 'grid-template-columns:minmax(0,1fr);gap:14px');
    restyle(root, /grid-template-columns:repeat\([23],minmax\(0,1fr\)\)/g, 'grid-template-columns:minmax(0,1fr)');
    restyle(root, /grid-column:1\/-1/g, 'grid-column:auto');
    root.querySelectorAll('dl.kv').forEach((d) => { d.style.gridTemplateColumns = 'minmax(0,1fr)'; });
    root.querySelectorAll('.row').forEach((x) => { x.style.flexWrap = 'wrap'; x.style.minWidth = '0'; });
    root.querySelectorAll('.seg').forEach((x) => { x.style.flexWrap = 'wrap'; x.style.maxWidth = '100%'; x.style.height = 'auto'; });
  }
  // The add, edit and rule panes take the whole content width in place of the list, which stays in the page, hidden.
  function paneInPlace(list, aside) {
    list.style.display = 'none';
    aside.style.cssText += ';width:100%;flex:1 1 0;min-width:0;border-left:0';
    restyle(aside, /padding:(18px 24px 14px|16px 24px 20px|12px 24px 14px)/g, 'padding:12px 16px');
  }
  function stackAgentRows(root) {
    root.querySelectorAll('ul[aria-label="Agents"] > li').forEach((li) => {
      if (li.children.length < 3 || !/32px minmax\(0,1fr\) auto/.test(li.getAttribute('style'))) return;
      li.style.gridTemplateColumns = '32px minmax(0,1fr)';
      li.style.alignItems = 'start';
      li.children[1].querySelectorAll('b, span').forEach((x) => { if (x.style.textOverflow) { x.style.whiteSpace = 'normal'; x.style.overflowWrap = 'anywhere'; } });
      const acts = li.children[2];
      acts.style.gridColumn = '2';
      acts.style.justifyContent = 'flex-start';
      if (acts.firstElementChild) acts.firstElementChild.style.flex = '1 1 auto';
    });
    const add = root.querySelector('[data-sc="list"]');
    const head = add && add.previousElementSibling && add.previousElementSibling.querySelector(':scope > .row');
    if (head) { head.style.flexDirection = 'column'; head.style.alignItems = 'flex-start'; }
  }
  function agentPage(host, w) {
    const main = host.querySelector('main');
    const [headBox, tabs, panel] = Array.from(main.children);
    const head = pageHeader(headBox.querySelector('h1'), [], []);
    head.style.cssText = 'padding:' + (w === 'phone' ? '12px 16px 0' : '24px 32px 0') + ';border-bottom:0';
    headBox.replaceWith(head);
    setMain(main, 's-fill');
    host.firstElementChild.replaceWith(main);
    tabs.style.padding = w === 'phone' ? '0 4px' : '0 20px';
    sidePadding(panel, w);
    if (w === 'wide') return;
    const kids = Array.from(panel.children);
    const aside = kids.find((k) => k.tagName === 'ASIDE');
    if (aside) paneInPlace(kids[0], aside);
    oneColumn(panel);
    if (w !== 'phone') return;
    // One row of tabs that scrolls sideways inside itself.
    tabs.style.overflowX = 'auto';
    tabs.style.overflowY = 'hidden';
    tabs.style.gap = '0';
    Array.from(tabs.children).forEach((t) => { t.style.flex = '0 0 auto'; t.style.whiteSpace = 'nowrap'; });
    stackAgentRows(panel);
  }
  function rulesAgentPage(host, ctx, w) {
    const main = host.querySelector('main');
    const col = main.firstElementChild;
    const aside = main.querySelector(':scope > aside');
    const headBox = col.firstElementChild;
    const row = headBox.firstElementChild;
    const title = row && row.querySelector('h1');
    if (!title) return;
    const help = title.nextElementSibling;
    const action = row.children[1];
    const head = pageHeader(title, help ? [help] : [], action ? [action] : []);
    head.style.padding = w === 'phone' ? '12px 16px' : '24px 32px 16px';
    headBox.remove();
    setMain(main, 's-fill');
    host.firstElementChild.replaceWith(main);
    sidePadding(col, w);
    if (w === 'wide') {
      col.insertBefore(head, col.firstChild);
      main.style.flexDirection = 'row';
      return;
    }
    const body = make('div', 's-col', Array.from(main.children));
    body.style.flexDirection = 'column';
    main.appendChild(head);
    main.appendChild(body);
    col.style.flex = '1 1 0';
    if (aside) {
      // The live default is drawn with a rule open; below 1024px it shows the list, and a rule's pane replaces it.
      if (ctx.scen === 'live') aside.style.display = 'none';
      else paneInPlace(col, aside);
      oneColumn(aside);
    }
    if (w === 'phone') {
      phoneRows(col);
      col.querySelectorAll('.pfirst').forEach((x) => { x.style.display = 'block'; x.style.maxWidth = '100%'; });
      col.querySelectorAll('.toggle + div').forEach((x) => { x.style.minWidth = '0'; });
    }
  }
  // Setup step 2 "Add agent" keeps its pinned footer; below 1024px the step row sits at the top of the scroll area.
  function wizardAgentNarrow(main, scroll, exit, w) {
    const label = Array.from(scroll.querySelectorAll('span.muted')).find((s) => /^Step \d of \d/.test(s.textContent));
    const bar = el(`<div class="s-step-row" style="margin-bottom:16px"><span class="muted" style="font-size:13px">${label ? esc(label.textContent) : ''}</span>${exit}</div>`).firstElementChild;
    if (label) label.remove();
    scroll.insertBefore(bar, scroll.firstChild);
    scroll.style.padding = w === 'phone' ? '16px' : '24px 32px';
    const foot = scroll.nextElementSibling;
    if (foot) foot.style.padding = w === 'phone' ? '12px 16px' : '12px 32px';
    oneColumn(main);
  }

  const HIDDEN = /^(Full screen( terminal.*)?|Send test ping|History|Manage installation( on GitHub)?)$/;
  function hideUnfinished(root) {
    root.querySelectorAll('button, a').forEach((b) => {
      if (!HIDDEN.test(b.textContent.trim() || b.getAttribute('aria-label') || '')) return;
      const parent = b.parentElement;
      b.remove();
      if (parent && !parent.children.length && !parent.textContent.trim()) parent.remove();
    });
  }
  function signIn(app) {
    const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) if (/Single user per project/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/Single user per project\.\s*/, '');
  }

  const PREVIEW = () => {
    const d = frag('Setup3PreviewDialog').querySelector('.dialog .d-b');
    return d ? d.innerHTML : '';
  };
  function previewDialog(w) {
    const name = AD.ui.dialog.name;
    const body = el(PREVIEW());
    const h = body.querySelector('h2');
    if (h) h.textContent = name + ' SKILL.md';
    const box = document.createElement('div');
    box.appendChild(body);
    return `<div class="overlay fx" style="z-index:40"><div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(name)} SKILL.md" style="width:${w === 'phone' ? 'calc(100% - 16px);max-width:374px' : '720px'};max-height:calc(100vh - 80px)"><div class="d-b" style="min-height:0;overflow:auto">${box.innerHTML}</div><div class="d-f"><button class="btn" data-act="dialog-close">Close</button></div></div></div>`;
  }

  function frame(app, w, isRun) {
    const forced = SN.ui.width !== 'auto';
    if (forced && w !== 'wide') {
      const px = w === 'phone' ? 390 : 1023;
      app.style.cssText = `width:${px}px;max-width:100%;margin:0 auto;position:relative;border-left:1px solid var(--line2);border-right:1px solid var(--line2);` + (isRun ? 'height:844px;overflow:hidden' : 'min-height:max(844px,100vh)');
    } else if (isRun) app.style.cssText = 'height:100vh;min-height:640px';
  }

  function decorate(out, ctx) {
    const stage = AD.$('#stage');
    const app = stage.querySelector('.app');
    if (!app) return;
    const w = widthClass();
    if (ctx.screen === 'signin') {
      signIn(app);
      frame(app, w, false);
      // Phone: one column, "One ticket, two runs" below.
      const cols = app.firstElementChild;
      if (w === 'phone' && cols && cols.children.length === 2) {
        cols.style.gridTemplateColumns = 'minmax(0,1fr)';
        cols.style.height = 'auto';
        Array.from(cols.children).forEach((c) => { c.style.padding = '32px 16px'; c.style.gap = '20px'; c.style.borderRight = '0'; });
      }
      rewrite(stage);
      return;
    }
    if (!AD.user() || ['index', 'snapshot', 'gallery', 'sideredirect'].includes(ctx.screen)) { rewrite(stage); return; }
    const m = accessUnknown(shellModel(out, ctx), ctx);
    const waiting = SN.ui.orgs !== 'live';
    const old = app.querySelector(':scope > header.top');
    let host = make('div', 's-host');
    host.style.cssText = 'flex:1;min-width:0;min-height:0;display:flex;flex-direction:column';
    Array.from(app.children).filter((c) => c !== old && !c.matches('.overlay, .pop')).forEach((c) => host.appendChild(c));
    if (waiting) {
      host.innerHTML = '';
      app.querySelectorAll(':scope > .overlay, :scope > .pop').forEach((c) => c.remove());
      host = unknownPage();
    }
    host.querySelectorAll('nav.subnav').forEach((x) => x.remove());
    const isRun = !waiting && ctx.screen === 'run' && !out.state && !!AD.B[out.board] && AD.B[out.board].kind === 'run';
    let wiz = null;
    const multi = waiting || out.state ? null : multiAgentKind(host, ctx);
    // These pages fill the window and never scroll, at every width.
    const fit = isRun || !!multi || (!waiting && ctx.screen === 'setup' && !!host.querySelector('main > [data-sc="wizard"]'));
    // Centered messages (not found, no access, suspended, generic states) keep their own layout.
    const title = host.querySelector('h1');
    const plainPage = out.state === 'notfound' || out.state === 'forbidden' || ctx.screen === 'orgsuspended' || out.generic || !!(title && /^((Page )?Not found|You don.t have access)$/i.test(title.textContent.trim()));
    if (waiting) { /* nothing to rearrange */ } else if (isRun) runPage(host, out, w);
    else if (multi === 'agent' && !plainPage) agentPage(host, w);
    else if (multi === 'rules' && !plainPage) rulesAgentPage(host, ctx, w);
    else if (m.wizard) wiz = wizard(host, ctx, w);
    else if (!plainPage) {
      if (ctx.screen === 'myinvites' || ctx.screen === 'accept') invitationPage(host, ctx);
      else if (ctx.screen === 'desk' && ['rules', 'skills', 'setup'].includes(ctx.params.tab)) { if (!fillPage(host, ctx.params.tab)) ordinaryPage(host); }
      else {
        if (ctx.screen === 'projects') projectsPage(host, ctx);
        if (ctx.screen === 'platform.org' && ctx.params.tab === 'projects') platformProjects(host);
        ordinaryPage(host);
      }
    }
    host.querySelectorAll('a').forEach((a) => {
      if (a.textContent.trim() === 'Go to the start') { a.textContent = 'Go to projects'; a.className = 'btn primary'; a.setAttribute('href', m.projectsHref); }
    });
    hideUnfinished(host);
    const main = host.querySelector('main');
    if (main) main.id = 'main';
    if (w !== 'wide' && !multi) narrowLayout(host, ctx, w);

    const body = make('div', 's-body' + (w === 'phone' ? ' s-sm' : ''));
    const collapsed = isRun ? !SN.ui.runOpen : SN.ui.collapsed;
    if (m.menu && w === 'wide') body.innerHTML = menuHtml(m.menu, collapsed ? 'strip' : 'full');
    if (wiz && w === 'wide') body.innerHTML = wiz.column;
    body.appendChild(host);
    if (old) old.remove();
    app.insertBefore(body, app.firstChild);
    app.insertAdjacentHTML('afterbegin', headerHtml(m, w));
    const menu = body.querySelector(':scope > nav.s-menu, :scope > nav.s-strip');
    if (menu) menu.style.cssText = 'position:sticky;top:52px;height:calc(100vh - 52px);align-self:flex-start';
    // The collapsed prototype controls button sits at the bottom left; the menu footer stays above it.
    if (menu && menu.querySelector('.s-foot')) menu.style.paddingBottom = '56px';

    if (w !== 'wide' && SN.ui.drawer && (m.menu || m.wizard)) {
      const drawer = m.wizard
        ? `<nav class="subnav s-menu s-drawer" aria-label="Setup progress" role="dialog" aria-modal="true" style="padding:12px 16px;gap:18px"><div class="s-mtop"><div class="s-lead"></div><button class="btn ghost iconbtn" aria-label="Close menu" title="Close menu" data-act="sn-drawer">${I.x}</button></div>${wiz ? wiz.steps : ''}</nav>`
        : menuHtml(m.menu, 'drawer');
      app.insertAdjacentHTML('beforeend', '<div class="s-scrim" data-act="sn-drawer"></div>' + drawer);
      // The drawer lies over the sticky top bar too.
      app.querySelectorAll(':scope > .s-scrim, :scope > .s-drawer').forEach((x) => {
        x.style.zIndex = x.classList.contains('s-drawer') ? '41' : '40';
        if (SN.ui.width === 'auto') x.style.position = 'fixed';
      });
      const drawerFoot = app.querySelector(':scope > .s-drawer .s-foot');
      if (drawerFoot && SN.ui.width === 'auto') drawerFoot.parentElement.style.paddingBottom = '56px';
    }
    if (AD.ui.dialog && AD.ui.dialog.type === 'sn-preview') app.insertAdjacentHTML('beforeend', previewDialog(w));
    frame(app, w, fit);
    if (w === 'phone' && multi) app.querySelectorAll(':scope > .overlay .dialog').forEach((d) => { d.style.width = '100%'; d.style.borderRadius = '0'; });
    // The two phone switchers share the whole second row.
    app.querySelectorAll(':scope > header .s-row2 .switch').forEach((x) => { x.style.maxWidth = 'none'; });
    // Pages that fill the window scroll inside their columns, so they need a definite height (as the boards have).
    if (w === 'wide' && !fit && host.querySelector(':scope > main.s-fill, :scope > * > main.s-fill')) app.style.height = `max(${out.h || 900}px,100vh)`;
    app.querySelectorAll(':scope > .pop').forEach((p) => placeConfirm(app, p, w));
    rewrite(stage);
    // Moving the page into the shell dropped scroll positions and focus; the multi-agent screens restore them again.
    if (fit && !isRun && out.after) out.after(stage);
    if (multi === 'agent' && w === 'phone') showSelectedTab(stage);
    focusAfter(stage);
  }
  function showSelectedTab(stage) {
    const tab = stage.querySelector('[role="tab"][aria-selected="true"]');
    const strip = tab && tab.parentElement;
    if (!strip) return;
    const t = tab.getBoundingClientRect();
    const b = strip.getBoundingClientRect();
    if (t.right > b.right) strip.scrollLeft += t.right - b.right;
    else if (t.left < b.left) strip.scrollLeft -= b.left - t.left;
  }
  // The cancel and stop confirm popovers hang under the page header buttons; on a phone they are full width.
  function placeConfirm(app, p, w) {
    const bar = app.querySelector('.s-ph-actions');
    if (!bar) return;
    const a = app.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    p.style.top = Math.round(b.bottom - a.top + 8) + 'px';
    if (w === 'phone') { p.style.left = '16px'; p.style.right = '16px'; p.style.width = 'auto'; } else { p.style.left = 'auto'; p.style.right = Math.max(16, Math.round(a.right - b.right)) + 'px'; }
  }

  function rewrite(stage) {
    stage.querySelectorAll('a[href^="#/"]').forEach((a) => {
      let h = a.getAttribute('href');
      if (/[?&]s=RunsProblems/.test(h)) h = h.replace(/s=RunsProblems/, 'filter=ignored');
      a.setAttribute('href', sideHref(h));
    });
    stage.querySelectorAll('[data-href^="#/"]').forEach((b) => {
      b.setAttribute('data-href', sideHref(b.getAttribute('data-href').replace(/s=RunsProblems/, 'filter=ignored')));
    });
  }

  /* ---------- focus ---------- */
  let wantFocus = null;
  function focusAfter(stage) {
    if (!wantFocus) return;
    const sel = wantFocus;
    wantFocus = null;
    const n = stage.querySelector(sel);
    if (!n) return;
    if (!n.hasAttribute('tabindex') && n.tagName === 'MAIN') n.setAttribute('tabindex', '-1');
    n.focus({ preventScroll: true });
  }

  /* ---------- paint ---------- */
  function paintBoard(out, ctx, def) {
    const name = out.board;
    const b = AD.B[name];
    const width = boardWidth(name);
    const box = width === 390
      ? `width:390px;height:${b.h}px;min-height:${b.h}px;margin:0 auto;position:relative;overflow:hidden;border:1px solid var(--line2)`
      : width === 1024
        ? `width:1024px;height:${b.h}px;min-height:${b.h}px;margin:0 auto;position:relative;overflow:hidden;border:1px solid var(--line2)`
        : `height:max(${b.h}px,100vh);min-height:max(${b.h}px,100vh);position:relative;overflow:hidden`;
    const bar = { global: 'org', project: 'project', platform: 'platform', run: 'run' }[b.kind] || 'org';
    const header = b.header ? `<header class="top" data-bar="${bar}">${AD.fixLinks(b.header)}</header>` : '';
    const stage = AD.$('#stage');
    stage.innerHTML = `<div class="app stage-app" style="${box}">${header}${AD.fixLinks(b.body)}</div>`;
    if (ctx.route.side) rewrite(stage);
    window.scrollTo(0, 0);
    AD.lastKey = ctx.route.path;
    document.title = b.title + ' · Agent Desk';
    AD.enhanceBoard(stage, name);
    AD.out = out;
    if (AD.controls) AD.controls.refresh(ctx, def, out);
  }
  let lastPath = null;
  const paint = AD.paint;
  AD.paint = function (out, ctx, def) {
    if (ctx.route.path !== lastPath) {
      if (SN.ui.drawer) wantFocus = '#main';
      SN.ui.drawer = false;
      SN.ui.runOpen = false;
      SN.ui.view = 'Terminal';
      lastPath = ctx.route.path;
    }
    // Closing the skill preview (Close or Escape) returns focus to its Preview button.
    const preview = AD.ui.dialog && AD.ui.dialog.type === 'sn-preview' ? AD.ui.dialog.name : null;
    if (!preview && SN.preview) wantFocus = `[data-act="sn-preview"][data-name="${SN.preview}"]`;
    SN.preview = preview;
    if (out.board && NEW.has(out.board)) { paintBoard(out, ctx, def); return; }
    paint(out, ctx, def);
    if (ctx.route.side) {
      decorate(out, ctx);
      if (AD.controls) AD.controls.refresh(ctx, def, out);
    }
  };

  /* ---------- actions ---------- */
  const ruleSave = AD.acts['rule-save'];
  AD.acts['rule-save'] = (b) => {
    if (!inSide()) return ruleSave(b);
    AD.toast('ok', 'Rule saved');
    return AD.nav('/o/' + AD.curOrg() + '/p/' + AD.curProject() + '/desk/rules', {});
  };
  Object.assign(AD.acts, {
    'sn-collapse': () => {
      if (AD.cur.screen === 'run') SN.ui.runOpen = !SN.ui.runOpen; else SN.ui.collapsed = !SN.ui.collapsed;
      wantFocus = '[data-act="sn-collapse"]';
      AD.render();
    },
    'sn-drawer': () => {
      SN.ui.drawer = !SN.ui.drawer;
      wantFocus = SN.ui.drawer ? '.s-drawer button[aria-label="Close menu"]' : 'header button[aria-label="Open menu"]';
      AD.ui.menu = null;
      AD.render();
    },
    'sn-pick': (a) => {
      if (SN.ui.drawer) wantFocus = '#main';
      SN.ui.drawer = false;
      AD.ui.menu = null;
      const h = a.getAttribute('href');
      if (h === location.hash) AD.render(); else location.hash = h;
    },
    'sn-menu-retry': () => { SN.ui.menu = 'live'; SN.ui.orgs = 'live'; AD.render(); },
    'sn-pop-retry': () => { if (AD.ui.menu === 'org') SN.ui.orgs = 'live'; else SN.ui.projects = 'live'; AD.render(); },
    'sn-view': (b) => { SN.ui.view = b.dataset.view; wantFocus = `[data-view="${b.dataset.view}"]`; AD.render(); },
    'sn-key': (b) => AD.toast('ok', (b.getAttribute('aria-label') || b.textContent.trim()) + ' sent to the terminal', 'Prototype: no terminal is connected.'),
    'sn-preview': (b) => { AD.ui.dialog = { type: 'sn-preview', name: b.dataset.name }; wantFocus = '.overlay .d-f button'; AD.render(); },
    'sn-exit': (b) => {
      SN.ui.savedStep = /^[1-4]$/.test(b.dataset.step) ? b.dataset.step : SN.ui.savedStep;
      AD.nav('/o/' + AD.cur.params.org + '/projects');
    },
  });
  document.addEventListener('keydown', (e) => {
    if (!SN.ui.drawer) return;
    if (e.key === 'Escape') { AD.acts['sn-drawer'](); return; }
    if (e.key !== 'Tab') return;
    const list = AD.$$('#stage .s-drawer a[href], #stage .s-drawer button:not([disabled])');
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); list[list.length - 1].focus(); } else if (!e.shiftKey && (i < 0 || i === list.length - 1)) { e.preventDefault(); list[0].focus(); }
  });
  let lastWidth = null;
  window.addEventListener('resize', () => {
    const w = widthClass();
    if (w === lastWidth) return;
    lastWidth = w;
    if (w === 'wide') SN.ui.drawer = false;
    if (AD.cur && AD.cur.route.side) AD.render();
  });

  /* ---------- prototype controls ---------- */
  const SELECTS = [
    ['sn-mode', 'Navigation', [['side', 'Side menu (new)'], ['tabs', 'Top tabs (current)']]],
    ['sn-width', 'Window width (side menu mode)', [['auto', 'Follow this window'], ['wide', '1024px and up'], ['narrow', 'Below 1024px (drawer)'], ['phone', 'Phone, 390px']]],
    ['sn-menu', 'Side menu data', [['live', 'Loaded'], ['loading', 'Loading'], ['error', 'Error (with retry)']]],
    ['sn-orgs', 'Organization list (menu, page and switcher)', [['live', 'Loaded'], ['loading', 'Loading'], ['error', 'Error (with retry)']]],
    ['sn-projects', 'Project list (open the switcher)', [['live', 'Loaded'], ['loading', 'Loading'], ['error', 'Error (with retry)'], ['empty', 'Empty']]],
    ['sn-repo', 'Repository block (project menu)', [['data', 'From the project'], ['ok', 'Connected'], ['warn', 'Warning'], ['fail', 'Error'], ['nobranch', 'No default branch']]],
  ];
  const KEY = { 'sn-width': 'width', 'sn-menu': 'menu', 'sn-orgs': 'orgs', 'sn-projects': 'projects', 'sn-repo': 'repo' };
  const mount = AD.controls.mount;
  AD.controls.mount = function () {
    mount();
    // Closed at first, so the panel stays short enough to leave the top bar free.
    const html = `<details class="proto-sec"><summary>Side menu shell: width and data states</summary>${SELECTS.map(([id, label, opts]) => `<div class="proto-sec"><label for="${id}">${label}</label><select id="${id}" class="input">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`).join('')}</details>`;
    AD.$('#pc-fail').closest('.proto-sec').insertAdjacentHTML('beforebegin', html);
    AD.$('#sn-mode').addEventListener('change', (e) => {
      const rest = location.hash.replace(/^#(\/side(?=\/|\?|$))?/, '') || '/';
      location.hash = e.target.value === 'side' ? '#/side' + rest : '#' + rest;
    });
    Object.keys(KEY).forEach((id) => AD.$('#' + id).addEventListener('change', (e) => {
      SN.ui[KEY[id]] = e.target.value;
      SN.ui.drawer = false;
      AD.render();
    }));
  };
  const routeKey = (path) => path.replace(/^\/side/, '').replace(/\/o\/[^/]+/, '/o/_').replace(/\/p\/[^/]+/, '/p/_').replace(/\/runs\/\d+/, '/runs/_').replace(/\/orgs\/(?!new)[0-9a-f-]{20,}/, '/orgs/_').replace(/\/invitations\/[0-9a-f-]{20,}/, '/invitations/_');
  const refresh = AD.controls.refresh;
  AD.controls.refresh = function (ctx, def, out) {
    refresh(ctx, def, out);
    const sel = AD.$('#pc-scen');
    if (!sel || !ctx) return;
    AD.$$('option', sel).forEach((o) => { if (NEW.has(o.value)) o.remove(); });
    AD.$$('optgroup', sel).forEach((g) => { if (!g.children.length) g.remove(); });
    const here = routeKey(ctx.route.path);
    const opt = (n) => `<option value="${n}">${esc(n + ' - ' + AD.B[n].title)}</option>`;
    const mine = SN.boards.filter((n) => AD.B[n] && routeKey(newBoardPath(n)) === here);
    const rest = SN.boards.filter((n) => AD.B[n] && !mine.includes(n));
    const standard = sel.querySelector('optgroup');
    const group = (label, names) => (names.length ? `<optgroup label="${label}">${names.map(opt).join('')}</optgroup>` : '');
    if (standard) {
      if (ctx.route.side || NEW.has(ctx.scen)) standard.insertAdjacentHTML('afterend', group('Side menu boards, this screen (new)', mine));
      sel.insertAdjacentHTML('beforeend', group((ctx.route.side || NEW.has(ctx.scen)) ? 'Side menu boards, other screens (new)' : 'Side menu boards (new)', ctx.route.side || NEW.has(ctx.scen) ? rest : SN.boards.filter((n) => AD.B[n])));
    }
    sel.value = ctx.scen || 'live';
    if (NEW.has(ctx.scen)) AD.$('#pc-note').textContent = 'Static snapshot of the new board "' + ctx.scen + '" (' + boardWidth(ctx.scen) + 'px wide). Choose "Default" for the live screen.';
    if (AD.$('#sn-mode')) {
      AD.$('#sn-mode').value = inSide() ? 'side' : 'tabs';
      Object.keys(KEY).forEach((id) => { AD.$('#' + id).value = SN.ui[KEY[id]]; });
    }
  };
  const reset = AD.controls.reset;
  AD.controls.reset = function () { SN.ui = fresh(); return reset(); };
  const toggleMap = AD.controls.toggleMap;
  AD.controls.toggleMap = function () {
    toggleMap();
    const box = AD.$('#pc-mapbox');
    if (!box) return;
    const o = '/o/' + AD.curOrg();
    const p = o + '/p/' + AD.curProject();
    const L = (path, label) => `<a href="${H(path)}">${esc(label)}</a>`;
    box.querySelector('.proto-hint').insertAdjacentHTML('afterend', `<div class="proto-map-g"><b>Side menu shell (new)</b>${[
      L('/signin', 'Sign in'), L(o + '/projects', 'Org menu: Projects (with Resume setup)'), L(o + '/settings/members', 'Org menu: Members'),
      L(o + '/projects/new/3', 'Wizard step 3: Exit setup, Preview'), L(p + '/runs', 'Project menu: Runs'), L(p + '/runs/62', 'Run page: menu starts collapsed'),
      L(p + '/desk/rules', 'Routing rules'), L(p + '/desk/skills', 'Skills'), L(p + '/desk/setup', 'Workspace setup'), L(p, 'Bare project address (goes to Runs)'),
      L(p + '/needs-you', 'Removed needs-you page (Not found, project menu)'), L('/platform/orgs', 'Platform menu'),
      L('/platform/orgs/' + platformId('harbor-labs') + '/projects', 'Platform, one org menu'), L('/invitations', 'My invitations'),
    ].join('')}</div>`);  };
})();
