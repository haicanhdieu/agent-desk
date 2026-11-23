/* App chrome (Option A navigation): ONE top bar on every page. The crumbs say where you are ("Org v / Project v") and the tabs
   are the sections of the last crumb: Projects and Settings on org pages; Runs and Settings on project pages. Org menu: Projects,
   Settings, switch organization, create organization. Account menu: name, email, Logout. Markup and classes are the
   ones of the boards (header.top, .switch, .tabs, .avatar, .pop, .banner). */
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
  chrome.bell = () => `<button class="btn ghost iconbtn" data-act="bell" aria-label="Notifications ${AD.ui.bell === false ? 'off' : 'on'}" title="Desktop notifications ${AD.ui.bell === false ? 'off' : 'on'}">${I.bell}</button>`;

  // Org-wide number of runs that need you, over the projects this person can see.
  chrome.orgNeeds = (uid, slug) => AD.visibleProjects(uid, slug).reduce((n, p) => n + (p.needs || 0), 0);

  /* Account menu: personal things only (name, email, Logout). Settings belongs to the org, so it is in the org menu. */
  chrome.acctMenu = function () {
    const u = AD.user();
    const out = `<button class="btn ghost" role="menuitem" style="${menuItemStyle}" data-act="signout">${I.logout15}<span>Logout</span></button>`;
    return `<div class="pop" role="menu" aria-label="Account" style="right:0;top:calc(100% + 8px);width:240px;padding:8px;gap:2px;text-align:left"><span class="sec-h" role="presentation" style="padding:4px 8px 6px;flex-direction:column;align-items:flex-start;gap:2px"><b style="color:var(--text);font-weight:600">${esc(u.name)}</b><span class="mono faint">${esc(u.email)}</span></span>${SEP_LINE}${out}</div>`;
  };

  /* Org menu (always a button, also for people in one org): this org's Projects and Settings, then switch organization
     (2+ orgs or platform admin), then Create organization (platform admin). opts.noCurrent: no org is open (no-org pages). */
  chrome.orgMenu = function (opts) {
    opts = opts || {};
    const u = AD.user();
    const cur = opts.noCurrent ? null : AD.curOrg();
    const orgs = AD.userOrgs(u.id);
    const link = (path, icon, label) => `<a href="${AD.href(path)}" data-act="menu-link" class="btn ghost" role="menuitem" style="${menuItemStyle}">${icon}${label}</a>`;
    let html = '';
    if (cur) {
      const o = AD.org(cur);
      const p = AD.perm(u.id, cur);
      html += `<span class="sec-h" role="presentation" style="padding:4px 8px 6px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(o ? o.name : cur)}">${esc(o ? o.name : cur)}</span></span>`;
      html += link('/o/' + cur + '/projects', I.grid, 'Projects');
      if (p.settings) html += link('/o/' + cur + '/settings', I.sliders, 'Settings');
    }
    if (orgs.length > 1 || u.platform) {
      if (html) html += SEP_LINE;
      html += '<span class="sec-h" role="presentation" style="padding:4px 8px 6px">Switch organization</span>';
      html += orgs.map((o) => {
        const on = o.slug === cur;
        return `<a href="${AD.href('/o/' + o.slug + '/projects')}" data-act="switch-org" data-org="${esc(o.slug)}" class="btn ghost" role="menuitem" style="${menuItemStyle}"${on ? ' aria-current="true"' : ''}>${on ? I.check : noIcon}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${on ? 'font-weight:600;' : ''}" title="${esc(o.name)}">${esc(o.name)}</span></a>`;
      }).join('');
    }
    if (u.platform) html += SEP_LINE + `<a href="${AD.href('/orgs/new')}" data-act="menu-link" class="btn ghost" role="menuitem" style="${menuItemStyle}">${I.plus16}Create organization</a>`;
    return `<div class="pop" role="dialog" aria-label="Organization" style="left:0;top:calc(100% + 8px);width:300px;padding:8px;gap:2px"><div role="menu" aria-label="Organization" style="display:flex;flex-direction:column;gap:2px">${html}</div></div>`;
  };

  chrome.projMenu = function () {
    const u = AD.user();
    const slug = AD.curOrg();
    const cur = AD.curProject();
    const rows = AD.visibleProjects(u.id, slug).map((p) => `<a href="${AD.href('/o/' + slug + '/p/' + p.id + '/runs')}" data-act="menu-link" class="btn ghost" role="menuitem" style="${menuItemStyle}"${p.id === cur ? ' aria-current="true"' : ''}>${p.id === cur ? I.check : noIcon}<span class="mono" style="${p.id === cur ? 'font-weight:600' : ''}">${esc(p.id)}</span>${p.needs ? `<span class="count-idle" style="margin-left:auto">${p.needs}</span>` : ''}</a>`).join('');
    return `<div class="pop" role="menu" aria-label="Projects" style="left:0;top:calc(100% + 8px);width:300px;padding:8px;gap:2px"><span class="sec-h" role="presentation" style="padding:4px 8px 6px">Projects</span>${rows}${SEP_LINE}<a href="${AD.href('/o/' + slug + '/projects')}" data-act="menu-link" class="btn ghost" role="menuitem" style="${menuItemStyle}">All projects</a></div>`;
  };

  /* ---------- crumbs ---------- */
  // "Org v": always a button when signed in. noOrg: a person with no organization sees plain text, a platform admin a menu.
  chrome.orgCrumb = function (noOrg) {
    const u = AD.user();
    const open = AD.ui.menu === 'org';
    if (noOrg) {
      if (!u.platform) return '<span class="muted">No organization</span>';
      return `<span class="menu-anchor"><button class="switch" data-act="menu" data-menu="org" aria-haspopup="dialog" aria-expanded="${open}" aria-label="Switch organization"><span class="muted">No organization</span>${I.chev}</button>${open ? chrome.orgMenu({ noCurrent: true }) : ''}</span>`;
    }
    const slug = AD.curOrg();
    const o = AD.org(slug);
    const name = o ? o.name : slug;
    const multi = AD.userOrgs(u.id).length > 1 || u.platform;
    const label = multi ? `Switch organization, currently ${name}` : `Organization menu, ${name}`;
    return `<span class="menu-anchor"><button class="switch" data-act="menu" data-menu="org" aria-haspopup="dialog" aria-expanded="${open}" aria-label="${esc(label)}" title="${esc(name)}"><b style="font-weight:600">${esc(name)}</b>${I.chev}</button>${open ? chrome.orgMenu() : ''}</span>`;
  };
  // "Project v": just the project name (the org has its own crumb).
  chrome.projCrumb = function () {
    const proj = AD.curProject();
    const open = AD.ui.menu === 'proj';
    return `<span class="menu-anchor"><button class="switch" data-act="menu" data-menu="proj" aria-haspopup="menu" aria-expanded="${open}" aria-label="Switch project, currently ${esc(proj)}" title="${esc(proj)}"><b style="font-weight:600">${esc(proj)}</b>${I.chev}</button>${open ? chrome.projMenu() : ''}</span>`;
  };

  /* ---------- tabs: the sections of the last crumb ---------- */
  const tab = (href, on, icon, label, extra) => `<a href="${href}" class="${on ? 'on' : ''}"${on ? ' aria-current="page"' : ''}>${icon}${label}${extra || ''}</a>`;
  const orgTabFor = (screen) => (/^(projects|setup)$/.test(screen) ? 'projects' : /^(settingsindex|legacyinvites|settings\.)/.test(screen) ? 'settings' : null);
  chrome.orgTabs = function () {
    const u = AD.user();
    const slug = AD.curOrg();
    const p = AD.perm(u.id, slug);
    const on = orgTabFor((AD.cur && AD.cur.screen) || '');
    const n = AD.proposals.needsCount ? chrome.orgNeeds(u.id, slug) : 0;
    const count = n ? `<span class="count-idle" title="${n} run${n > 1 ? 's' : ''} need${n > 1 ? '' : 's'} you in this organization">${n} needs you</span>` : '';
    return `<nav class="tabs" aria-label="Main">${tab(AD.href('/o/' + slug + '/projects'), on === 'projects', I.grid, 'Projects', count)}${p.settings ? tab(AD.href('/o/' + slug + '/settings'), on === 'settings', I.sliders, 'Settings') : ''}</nav>`;
  };
  chrome.projTabs = function (which) {
    const slug = AD.curOrg();
    const proj = AD.curProject();
    const sample = (AD.state.projects[slug] || []).find((p) => p.id === proj);
    const needs = sample ? sample.needs : 0;
    const base = '/o/' + slug + '/p/' + proj;
    return `<nav class="tabs" aria-label="Main">${tab(AD.href(base + '/runs'), which === 'runs', I.runs, 'Runs', needs ? `<span class="count-idle" title="${needs} run needs you">${needs} needs you</span>` : '')}${tab(AD.href(base + '/desk/skills'), which === 'desk', I.sliders, 'Settings')}</nav>`;
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
    const brand = `<a href="${brandHref}" class="brand" aria-label="Agent Desk, all projects">${I.brand}</a><span class="sep"></span>`;
    let level = out.header;
    if (level === 'auto') level = /^(runs|run|desk)$/.test(screen) ? 'project' : 'global';
    const noOrg = !!out.noOrg || !AD.userOrgs(u.id).length;
    const tail = chrome.bell() + chrome.avatarButton();
    if (level === 'project' && !noOrg) {
      const which = out.tab || (screen === 'desk' ? 'desk' : 'runs');
      return `<header class="top">${brand}${chrome.orgCrumb(false)}${SLASH}${chrome.projCrumb()}${chrome.projTabs(which)}<span class="grow"></span><a class="btn ghost sm" href="https://github.com/" target="_blank" rel="noopener">${I.ext}Repo on GitHub</a>${tail}</header>`;
    }
    // Org level and personal pages. Create organization has no tabs; no-org people have nothing to open.
    const tabs = noOrg || screen === 'createorg' ? '' : chrome.orgTabs();
    return `<header class="top">${brand}${chrome.orgCrumb(noOrg)}${tabs}<span class="grow"></span>${tail}</header>`;
  };

  /* Run page bar: the board's own compact header (status, command, timer, actions) with the crumbs "Org v / Project v / Runs / Run N".
     The crumb "Runs" goes to the project's Runs list. No tabs here, so the terminal keeps its height. */
  chrome.runHeader = function (boardHeader) {
    if (!AD.user() || !AD.userOrgs(AD.user().id).length) return boardHeader;
    const crumbs = chrome.orgCrumb(false) + SLASH + chrome.projCrumb() + SLASH;
    return boardHeader.replace(/(<nav class="row" aria-label="Breadcrumb"[^>]*>)\s*<a [^>]*>[^<]*<\/a><span class="faint">\/<\/span>/, '$1' + crumbs);
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
