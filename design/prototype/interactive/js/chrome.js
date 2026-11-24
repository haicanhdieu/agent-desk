/* App chrome (navigation-consistency spec, docs/superpowers/specs/2026-11-24-admin-navigation-consistency-design.md):
   ONE scope-aware top bar on every page (platform, org, project, run):
     [logo] Scope switch v / Project v / Section / Page      [tabs of the scope]      [bell] [account]
   - The scope switch is the first crumb: "Platform" in the platform area, otherwise the org name. Its menu, top to bottom:
     a Platform group (platform admins: "Platform admin", and inside an org "Manage this org in Platform"), the current org's
     Projects and Org settings, the org list ("Switch organization", memberships only), "Create organization" (platform admins).
   - Page crumbs follow on every page; every crumb but the last is a link, the last has aria-current="page".
   - Tabs are the sections of the scope: Platform (Organizations, Platform admins, Audit log), Org (Projects, Org settings),
     Project (Runs, Project settings); each tabs nav has its own landmark name.
   - document.title is "<last crumb> · <scope> · Agent Desk", built from the same crumb list the bar renders.
   Markup and classes are the ones of the boards (header.top, .switch, .tabs, .avatar, .pop). */
(function () {
  'use strict';
  const AD = window.AD;
  const esc = AD.esc;
  const I = AD.I;
  const chrome = (AD.chrome = {});

  const SLASH = '<span class="faint" aria-hidden="true">/</span>';
  const menuItemStyle = 'justify-content:flex-start;width:100%;gap:8px;color:var(--text)';
  const SEP_LINE = '<div role="separator" style="height:1px;background:var(--line);margin:4px 0"></div>';
  const noIcon = '<span style="width:14px;flex:0 0 auto"></span>';

  chrome.avatarButton = function () {
    const u = AD.user();
    return `<span class="menu-anchor"><button class="avatar" data-act="menu" data-menu="acct" aria-haspopup="menu" aria-expanded="${AD.ui.menu === 'acct'}" aria-label="Account menu for ${esc(AD.state.uid)}" title="${esc(AD.state.uid)}">${esc(u.initials)}</button>${AD.ui.menu === 'acct' ? chrome.acctMenu() : ''}</span>`;
  };
  // Bell: on every bar, platform included; no click behaviour yet (Decision 3). A click shows the prototype's "Not wired" toast.
  chrome.bell = () => `<button class="btn ghost iconbtn" aria-label="Notifications" title="Notifications">${I.bell}</button>`;

  // Org-wide number of runs that need you, over the projects this person can see.
  chrome.orgNeeds = (uid, slug) => AD.visibleProjects(uid, slug).reduce((n, p) => n + (p.needs || 0), 0);

  /* Account menu: personal things only (name, email, Logout). */
  chrome.acctMenu = function () {
    const u = AD.user();
    const out = `<button class="btn ghost" role="menuitem" style="${menuItemStyle}" data-act="signout">${I.logout15}<span>Logout</span></button>`;
    return `<div class="pop" role="menu" aria-label="Account" style="right:0;top:calc(100% + 8px);width:240px;padding:8px;gap:2px;text-align:left"><span class="sec-h" role="presentation" style="padding:4px 8px 6px;flex-direction:column;align-items:flex-start;gap:2px"><b style="color:var(--text);font-weight:600">${esc(u.name)}</b><span class="mono faint">${esc(u.email)}</span></span>${SEP_LINE}${out}</div>`;
  };

  /* ---------- scope ---------- */
  // 'platform' (platform area, platform admins only), 'none' (no org: a person with no membership), else 'org'.
  chrome.scope = function () {
    const u = AD.user();
    const screen = (AD.cur && AD.cur.screen) || '';
    if (u && u.platform && (/^platform\./.test(screen) || screen === 'createorg')) return 'platform';
    if (!u || !AD.userOrgs(u.id).length) return 'none';
    return 'org';
  };
  // A platform admin's "failed GET /api/me/platform" (scenario on the scope menu boards) hides the Platform group.
  const platformKnown = () => { const u = AD.user(); return !!(u && u.platform) && !AD.ui.platformFailed; };

  /* Scope switch menu. opts.scope: 'platform' | 'org' | 'none'. */
  chrome.orgMenu = function (opts) {
    opts = opts || {};
    const u = AD.user();
    const scope = opts.scope || chrome.scope();
    const cur = scope === 'org' ? AD.curOrg() : null;
    const orgs = AD.userOrgs(u.id);
    const plat = platformKnown();
    const link = (path, icon, label, extra) => `<a href="${AD.href(path)}" data-act="menu-link" class="btn ghost" role="menuitem" style="${menuItemStyle}"${extra || ''}>${icon}${label}</a>`;
    const groups = [];
    // 1. Platform group first, so it is found without scrolling past the org list.
    if (plat) {
      let g = '<span class="sec-h" role="presentation" style="padding:4px 8px 6px">Platform</span>';
      g += link('/platform/orgs', scope === 'platform' ? I.check : I.lock16, 'Platform admin', scope === 'platform' ? ' aria-current="true"' : '');
      if (cur && AD.platformOrgId) g += link('/platform/orgs/' + AD.platformOrgId(cur), I.sliders, 'Manage this org in Platform');
      groups.push(g);
    }
    // 2. This org's Projects and Org settings (a suspended org has no pages to open).
    if (cur && !(AD.orgIsSuspended && AD.orgIsSuspended(cur))) {
      const o = AD.org(cur);
      const p = AD.perm(u.id, cur);
      let g = `<span class="sec-h" role="presentation" style="padding:4px 8px 6px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(o ? o.name : cur)}">${esc(o ? o.name : cur)}</span></span>`;
      g += link('/o/' + cur + '/projects', I.grid, 'Projects');
      if (p.settings) g += link('/o/' + cur + '/settings', I.sliders, 'Org settings');
      groups.push(g);
    }
    // 3. The org list: memberships only. A platform admin with no membership gets no list (not an empty group).
    if (orgs.length > 1 || (orgs.length && scope !== 'org')) {
      let g = '<span class="sec-h" role="presentation" style="padding:4px 8px 6px">Switch organization</span>';
      g += orgs.map((o) => {
        const on = o.slug === cur;
        const susp = AD.orgIsSuspended && AD.orgIsSuspended(o.slug) ? '<span class="lbl" style="flex:0 0 auto;margin-left:auto">Suspended</span>' : '';
        return `<a href="${AD.href('/o/' + o.slug + '/projects')}" data-act="switch-org" data-org="${esc(o.slug)}" class="btn ghost" role="menuitem" style="${menuItemStyle}"${on ? ' aria-current="true"' : ''}>${on ? I.check : noIcon}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${on ? 'font-weight:600;' : ''}" title="${esc(o.name)}">${esc(o.name)}</span>${susp}</a>`;
      }).join('');
      groups.push(g);
    }
    // 4. Create organization (platform admins), inside the platform shell.
    if (plat) groups.push(link('/platform/orgs/new', I.plus16, 'Create organization'));
    return `<div class="pop" role="dialog" aria-label="Scope" style="left:0;top:calc(100% + 8px);width:300px;padding:8px;gap:2px"><div role="menu" aria-label="Scope" style="display:flex;flex-direction:column;gap:2px">${groups.join(SEP_LINE)}</div></div>`;
  };

  chrome.projMenu = function () {
    const u = AD.user();
    const slug = AD.curOrg();
    const cur = AD.curProject();
    const rows = AD.visibleProjects(u.id, slug).map((p) => `<a href="${AD.href('/o/' + slug + '/p/' + p.id + '/runs')}" data-act="menu-link" class="btn ghost" role="menuitem" style="${menuItemStyle}"${p.id === cur ? ' aria-current="true"' : ''}>${p.id === cur ? I.check : noIcon}<span class="mono" style="${p.id === cur ? 'font-weight:600' : ''}">${esc(p.id)}</span>${p.needs ? `<span class="count-idle" style="margin-left:auto">${p.needs}</span>` : ''}</a>`).join('');
    return `<div class="pop" role="menu" aria-label="Projects" style="left:0;top:calc(100% + 8px);width:300px;padding:8px;gap:2px"><span class="sec-h" role="presentation" style="padding:4px 8px 6px">Projects</span>${rows}${SEP_LINE}<a href="${AD.href('/o/' + slug + '/projects')}" data-act="menu-link" class="btn ghost" role="menuitem" style="${menuItemStyle}">All projects</a></div>`;
  };

  /* ---------- crumbs ---------- */
  // The scope switch (first crumb). "Platform" in platform scope, the org name in org scope; a person with no org and no
  // platform role sees plain "No organization" text.
  chrome.orgCrumb = function (scope) {
    const u = AD.user();
    scope = scope || chrome.scope();
    const open = AD.ui.menu === 'org';
    const btn = (inner, label, title) => `<span class="menu-anchor"><button class="switch" data-act="menu" data-menu="org" aria-haspopup="dialog" aria-expanded="${open}" aria-label="${esc(label)}"${title ? ` title="${esc(title)}"` : ''}>${inner}${I.chev}</button>${open ? chrome.orgMenu({ scope }) : ''}</span>`;
    if (scope === 'platform') return btn('<b style="font-weight:600">Platform</b>', 'Switch scope, currently Platform');
    if (scope === 'none') {
      if (!u.platform) return '<span class="muted">No organization</span>';
      return btn('<span class="muted">No organization</span>', 'Switch scope, currently no organization');
    }
    const slug = AD.curOrg();
    const o = AD.org(slug);
    const name = o ? o.name : slug;
    return btn(`<b style="font-weight:600">${esc(name)}</b>`, `Switch scope, currently organization ${name}`, name);
  };
  // "Project v": just the project name (the org has its own crumb). loading: a fixed-width skeleton (no jump).
  chrome.projCrumb = function (loading) {
    const proj = AD.curProject();
    const open = AD.ui.menu === 'proj';
    if (loading) return '<span class="crumb-sk" role="status" aria-label="Loading project"></span>';
    return `<span class="menu-anchor"><button class="switch" data-act="menu" data-menu="proj" aria-haspopup="menu" aria-expanded="${open}" aria-label="Switch project, currently ${esc(proj)}" title="${esc(proj)}"><b style="font-weight:600">${esc(proj)}</b>${I.chev}</button>${open ? chrome.projMenu() : ''}</span>`;
  };

  /* Page crumbs per screen: [{label, href?, loading?}]. A screen may set out.crumbs itself (the platform screens do). */
  const DESK_LABEL = { skills: 'Skills', rules: 'Routing rules', setup: 'Workspace setup', agent: 'Agent & settings', members: 'Members', audit: 'Audit log' };
  const SETTINGS_LABEL = { general: 'General', members: 'Members', invitations: 'Invitations', audit: 'Audit log' };
  chrome.pageCrumbs = function (out) {
    if (out && out.crumbs) return out.crumbs;
    const c = AD.cur || {};
    const pr = c.params || {};
    const o = '/o/' + pr.org;
    const orgSettings = { label: 'Org settings', href: AD.href(o + '/settings') };
    switch (c.screen) {
      case 'projects': return [{ label: 'Projects' }];
      case 'setup': return [{ label: 'Projects', href: AD.href(o + '/projects') }, { label: 'New project' }];
      case 'needsyou': return [{ label: 'Needs you' }];
      case 'settingsindex': return [{ label: 'Org settings' }];
      case 'legacyinvites': return [orgSettings, { label: 'Invitations' }];
      case 'runs': return [{ label: 'Runs' }];
      case 'run': return [{ label: 'Runs', href: AD.href(o + '/p/' + pr.project + '/runs') }, { label: 'Run ' + pr.n }];
      case 'desk': return [{ label: 'Project settings', href: AD.href(o + '/p/' + pr.project + '/desk/skills') }, { label: DESK_LABEL[pr.tab] || 'Project settings' }];
      case 'myinvites': return [{ label: 'Invitations' }];
      case 'accept': return [{ label: 'Invitation' }];
      case 'createorg': return [{ label: 'Organizations', href: AD.href('/platform/orgs') }, { label: 'Create organization' }];
      case 'platform.orgs': return [{ label: 'Organizations' }];
      case 'platform.admins': return [{ label: 'Platform admins' }];
      case 'platform.audit': return [{ label: 'Audit log' }];
      default:
        if (/^settings\./.test(c.screen || '')) return [orgSettings, { label: SETTINGS_LABEL[pr.tab] || 'Org settings' }];
        return [];
    }
  };
  const crumbHtml = (list) => list.map((x, i) => {
    const last = i === list.length - 1;
    const sep = i ? SLASH : '';
    if (x.loading) return sep + `<span class="crumb-sk" role="status" aria-label="Loading ${esc(x.what || 'name')}"></span>`;
    if (last) return sep + `<b style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0" aria-current="page" title="${esc(x.label)}">${esc(x.label)}</b>`;
    return sep + `<a href="${x.href}" class="muted crumb-link" title="${esc(x.label)}">${esc(x.label)}</a>`;
  }).join('');
  chrome.breadcrumb = function (lead, list) {
    const tail = list.length ? SLASH + crumbHtml(list) : '';
    return `<nav class="row crumbs" aria-label="Breadcrumb" style="gap:6px;font-size:13.5px;min-width:0">${lead}${tail}</nav>`;
  };

  /* ---------- tabs: the sections of the scope (each with its own landmark name) ---------- */
  const tab = (href, on, icon, label, extra) => `<a href="${href}" class="${on ? 'on' : ''}"${on ? ' aria-current="page"' : ''}>${icon}${label}${extra || ''}</a>`;
  const orgTabFor = (screen) => (/^(projects|setup)$/.test(screen) ? 'projects' : /^(settingsindex|legacyinvites|settings\.)/.test(screen) ? 'settings' : null);
  chrome.orgTabs = function () {
    const u = AD.user();
    const slug = AD.curOrg();
    const p = AD.perm(u.id, slug);
    const on = orgTabFor((AD.cur && AD.cur.screen) || '');
    const n = AD.proposals.needsCount ? chrome.orgNeeds(u.id, slug) : 0;
    const count = n ? `<span class="count-idle" title="${n} run${n > 1 ? 's' : ''} need${n > 1 ? '' : 's'} you in this organization">${n} needs you</span>` : '';
    return `<nav class="tabs" aria-label="Organization sections">${tab(AD.href('/o/' + slug + '/projects'), on === 'projects', I.grid, 'Projects', count)}${p.settings ? tab(AD.href('/o/' + slug + '/settings'), on === 'settings', I.sliders, 'Org settings') : ''}</nav>`;
  };
  chrome.projTabs = function (which) {
    const slug = AD.curOrg();
    const proj = AD.curProject();
    const sample = (AD.state.projects[slug] || []).find((p) => p.id === proj);
    const needs = sample ? sample.needs : 0;
    const base = '/o/' + slug + '/p/' + proj;
    return `<nav class="tabs" aria-label="Project sections">${tab(AD.href(base + '/runs'), which === 'runs', I.runs, 'Runs', needs ? `<span class="count-idle" title="${needs} run needs you">${needs} needs you</span>` : '')}${tab(AD.href(base + '/desk/skills'), which === 'desk', I.sliders, 'Project settings')}</nav>`;
  };
  chrome.platformTabs = function () {
    const screen = (AD.cur && AD.cur.screen) || '';
    const on = screen === 'platform.admins' ? 'admins' : screen === 'platform.audit' ? 'audit' : 'orgs';
    return `<nav class="tabs" aria-label="Platform sections">${tab(AD.href('/platform/orgs'), on === 'orgs', I.grid, 'Organizations')}${tab(AD.href('/platform/admins'), on === 'admins', I.lock15, 'Platform admins')}${tab(AD.href('/platform/audit'), on === 'audit', I.clock, 'Audit log')}</nav>`;
  };

  /* ---------- the bar ---------- */
  chrome.bar = function (out) {
    out = out || {};
    if (out.header === 'run') return '<header class="top">' + (out.headerHtml || '') + '</header>';
    if (!out.header || out.header === 'none') return '';
    const u = AD.user();
    const screen = (AD.cur && AD.cur.screen) || '';
    const inOrgRoute = !!(AD.cur && AD.cur.params && AD.cur.params.org);
    const brandHref = inOrgRoute ? AD.href('/o/' + AD.cur.params.org + '/projects') : u ? AD.href('/') : AD.href('/signin');
    if (!u) return `<header class="top"><a href="${brandHref}" class="brand" aria-label="Agent Desk">${I.brand}</a><span class="grow"></span></header>`;
    const brand = `<a href="${brandHref}" class="brand" aria-label="Agent Desk, home">${I.brand}</a><span class="sep"></span>`;
    let level = out.header;
    if (level === 'auto') level = /^(runs|run|desk)$/.test(screen) ? 'project' : 'global';
    let scope = chrome.scope();
    if (out.noOrg && scope === 'org') scope = 'none';
    const crumbs = out.state === 'notfound' ? [] : chrome.pageCrumbs(out);
    const tail = chrome.bell() + chrome.avatarButton();
    if (scope === 'platform') {
      return `<header class="top">${brand}${chrome.breadcrumb(chrome.orgCrumb('platform'), crumbs)}${chrome.platformTabs()}<span class="grow"></span>${tail}</header>`;
    }
    if (level === 'project' && scope === 'org') {
      const which = out.tab || (screen === 'desk' ? 'desk' : 'runs');
      return `<header class="top">${brand}${chrome.breadcrumb(chrome.orgCrumb('org') + SLASH + chrome.projCrumb(out.crumbState === 'loading'), crumbs)}${chrome.projTabs(which)}<span class="grow"></span><a class="btn ghost sm" href="https://github.com/" target="_blank" rel="noopener">${I.ext}Repo on GitHub</a>${tail}</header>`;
    }
    // Org level and personal pages. No-org people have nothing to open; a suspended org and create org show no org tabs.
    const tabs = scope !== 'org' || screen === 'createorg' || screen === 'orgsuspended' ? '' : chrome.orgTabs();
    return `<header class="top">${brand}${chrome.breadcrumb(chrome.orgCrumb(scope), crumbs)}${tabs}<span class="grow"></span>${tail}</header>`;
  };

  /* Run page bar: the board's own compact header (status, command, timer, actions) with the crumbs
     "Org v / Project v / Runs / Run N" and the bell. No tabs here, so the terminal keeps its height. */
  chrome.runHeader = function (boardHeader) {
    const u = AD.user();
    if (!u || !AD.userOrgs(u.id).length) return boardHeader;
    const crumbs = chrome.orgCrumb('org') + SLASH + chrome.projCrumb() + SLASH;
    let h = /<!--scope-->/.test(boardHeader)
      ? boardHeader.replace(/<!--scope-->[\s\S]*?<!--\/scope-->/, crumbs)
      : boardHeader.replace(/(<nav class="row" aria-label="Breadcrumb"[^>]*>)\s*<a [^>]*>[^<]*<\/a><span class="faint">\/<\/span>/, '$1' + crumbs);
    // the last crumb ("Run N") is the current page
    h = h.replace(/(<nav class="row" aria-label="Breadcrumb"[\s\S]*?)<b style="font-weight:600">(Run \d+)<\/b>/, '$1<b style="font-weight:600" aria-current="page">$2</b>');
    if (!/aria-label="Notifications/.test(h)) h = h.replace(/<span class="menu-anchor"><button class="avatar"/, chrome.bell() + '<span class="menu-anchor"><button class="avatar"');
    return h;
  };

  /* document.title: "<last crumb> · <scope> · Agent Desk", from the same crumb list as the bar. Not found and forbidden
     states: "Not found · Agent Desk", "You don't have access · Agent Desk". Run pages use "Run N", never the ticket title. */
  chrome.title = function (out, def) {
    out = out || {};
    if (out.state === 'notfound') return 'Not found · Agent Desk';
    if (out.state === 'forbidden') return "You don't have access · Agent Desk";
    const u = AD.user();
    const list = out.header && out.header !== 'none' && u ? chrome.pageCrumbs(out) : [];
    const last = list.length ? list[list.length - 1] : null;
    const page = last ? (last.loading ? last.what || 'Loading' : last.label) : out.title || (def && def.title) || '';
    if (!page) return 'Agent Desk';
    let scope = u && out.header && out.header !== 'none' ? chrome.scope() : 'none';
    if (out.noOrg && scope === 'org') scope = 'none';
    const screen = (AD.cur && AD.cur.screen) || '';
    let scopeName = '';
    if (scope === 'platform') scopeName = 'Platform';
    else if (scope === 'org') {
      if (/^(runs|run|desk)$/.test(screen) || out.header === 'project' || out.header === 'run') scopeName = AD.curProject();
      else { const o = AD.org(AD.curOrg()); scopeName = o ? o.name : ''; }
    }
    return [page, scopeName, 'Agent Desk'].filter(Boolean).join(' · ');
  };

  /* ---------- toasts ---------- */
  AD.toast = function (tone, title, sub) {
    const host = AD.$('#toasts');
    if (!host) return;
    const icon = { ok: I.okc, err: I.warn, off: I.info, warn: I.warn }[tone] || I.info;
    const el = document.createElement('div');
    el.className = 'banner ' + tone + ' toast';
    el.setAttribute('role', tone === 'err' ? 'alert' : 'status');
    el.innerHTML = `<span class="b-ico">${icon}</span><div class="grow" style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:600;font-size:13px">${esc(title)}</b>${sub ? `<span class="muted" style="font-size:12px">${esc(sub)}</span>` : ''}</div><button class="btn ghost iconbtn sm" aria-label="Dismiss" data-act="dismiss-toast" style="width:26px;padding:0;flex:0 0 auto">${I.x}</button>`;
    host.appendChild(el);
    setTimeout(() => el.remove(), tone === 'err' ? 9000 : 5000);
  };

  /* ---------- pager (same markup as the boards' Pagination) ---------- */
  AD.pager = function (info, disabledAll) {
    if (info.total <= 20) return ''; // the boards draw the pager only for lists longer than the smallest page size (20)
    const { page, pages, from, to, total } = info;
    const size = AD.pageSize();
    const btn = (p) => `<button class="btn ${p === page ? '' : 'ghost'} iconbtn num" ${p === page ? 'aria-current="page"' : ''} aria-label="Page ${p}" data-act="page" data-page="${p}">${p}</button>`;
    const nums = [];
    const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
    let last = 0;
    [...set].sort((a, b) => a - b).forEach((p) => { if (last && p - last > 1) nums.push('<span class="faint pg-gap">…</span>'); nums.push(btn(p)); last = p; });
    return `<div class="pager"><nav aria-label="Pagination" class="pg"><span class="pg-range"><span class="pg-word">Showing </span><span class="num" style="color:var(--text)">${from}–${to}</span> of <span class="num" style="color:var(--text)">${total}</span></span><span class="pg-pages"><button class="btn ghost pg-step" data-act="page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${I.prev}<span class="pg-step-t">Previous</span></button><span class="pg-slots w">${nums.join('')}</span><button class="btn ghost pg-step" data-act="page" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}><span class="pg-step-t">Next</span>${I.next}</button></span><span class="pg-tools"><span class="pg-field"><label for="pg-jump" class="pg-lbl">Go to page</label><input id="pg-jump" class="input num pg-jump" inputmode="numeric" value="" data-pg-jump><button class="btn pg-go" data-act="page-jump">Go</button></span><span class="pg-field"><label for="pg-size" class="pg-lbl">Rows per page</label><select id="pg-size" class="input num pg-size" data-pg-size>${[20, 50, 100].map((n) => `<option${n === size ? ' selected' : ''}>${n}</option>`).join('')}</select></span></span></nav></div>`;
  };

  /* ---------- dialog / banner helpers shared by the live screens ---------- */
  AD.dialog = function (o) {
    return `<div class="overlay fx" style="z-index:40"><div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(o.label)}" style="width:${o.w || 480}px"><div class="d-b">${o.body}</div><div class="d-f">${o.foot}</div></div></div>`;
  };
  AD.errBanner = function (e, extra) {
    return `<div class="banner err" role="alert" style="align-items:center"><span class="b-ico">${I.warn}</span><div class="grow" style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:600">${esc(e.title)}</b>${e.reqId ? `<span style="font-size:12px" class="muted">Request ID: <code class="mono" style="color:var(--text);font-size:12px">${esc(e.reqId)}</code></span>` : ''}</div>${extra || ''}</div>`;
  };
  AD.time = (t, cls) => `<time datetime="${esc(t.iso)}" title="${esc(t.title)}">${esc(t.rel || t.text || t.title)}</time>`;
})();
