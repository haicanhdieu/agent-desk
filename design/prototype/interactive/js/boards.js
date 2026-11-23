/* Board-backed screens: every board of design/prototype/project/*.dc.html was extracted (see _tools/build-boards.mjs) into
   window.AD_BOARDS. Screens that are not hand-built render the board markup as it was drawn, inside the live app chrome,
   with the links between boards rewritten to hash routes. The same mechanism serves every "board snapshot" scenario. */
(function () {
  'use strict';
  const AD = window.AD;
  const B = window.AD_BOARDS || {};
  AD.B = B;
  AD.boardNames = (re) => Object.keys(B).filter((n) => re.test(n));
  AD.boardTitle = (n) => (B[n] ? B[n].title : n);

  const RUN_DEFAULT = { 63: 'RunStarting', 62: 'RunIdle', 61: 'RunRunning', 60: 'RunSucceeded', 58: 'RunSetupFailed', 56: 'RunFailed', 54: 'RunTimedOut', 52: 'RunCancelled' };
  AD.RUN_DEFAULT = RUN_DEFAULT;
  const runNum = (name) => { const m = /^Run (\d+)/.exec((B[name] || {}).title || ''); return m ? m[1] : null; };
  const INVITE_TOKEN = '7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43';

  AD.curOrg = function () {
    const r = AD.cur && AD.cur.params && AD.cur.params.org;
    if (r && AD.org(r)) return r;
    const u = AD.state.uid;
    const orgs = u ? AD.userOrgs(u) : [];
    return (orgs[0] || AD.state.orgs[0]).slug;
  };
  AD.curProject = () => (AD.cur && AD.cur.params && AD.cur.params.project) || 'invoicer-api';

  /* Where a board lives in the interactive prototype: {path, q}. */
  AD.boardRoute = function (name) {
    const org = AD.curOrg();
    const proj = AD.curProject();
    const o = (suffix) => `/o/${org}${suffix}`;
    const v = (path, def) => ({ path, q: name === def ? {} : { s: name } });
    let m;
    if (name === 'Main') return { path: '/index', q: {} };
    if (name === 'SignIn') return { path: '/signin', q: {} };
    if (name === 'SignInNoInvitation') return { path: '/signin', q: { s: name } };
    if (/^CreateOrg/.test(name)) return v('/orgs/new', 'CreateOrg');
    if (/^InvitationAccept/.test(name)) return v('/invitations/' + INVITE_TOKEN, 'InvitationAccept');
    if (/^MyInvitations/.test(name)) return v('/invitations', 'MyInvitations');
    if (/^NeedsYou/.test(name)) return v(o('/needs-you'), 'NeedsYou');
    if (name === 'Pagination' || name === 'RouteError' || name === 'RouteLoading') return v('/gallery/pagination', 'Pagination');
    // Platform admin area (Platform* boards) and the tenant "organization suspended" page.
    if (/^PlatformAdmins/.test(name)) return v('/platform/admins', 'PlatformAdmins');
    if (/^PlatformOrgs/.test(name)) return v('/platform/orgs', 'PlatformOrgs');
    if (/^PlatformAudit/.test(name)) return v('/platform/audit', 'PlatformAudit');
    if (/^PlatformOrgEdit/.test(name)) return { path: '/platform/orgs/' + (AD.platformOrgId ? AD.platformOrgId('harbor-labs') : 'harbor-labs'), q: { s: name } };
    if ((m = /^PlatformOrg(Overview|Projects|Members|Invitations)/.exec(name))) {
      const tab = m[1].toLowerCase();
      const id = AD.platformOrgId ? AD.platformOrgId(/Suspended$|Reactivate/.test(name) ? 'bluefin-health' : 'harbor-labs') : 'harbor-labs';
      return { path: '/platform/orgs/' + id + (tab === 'overview' ? '' : '/' + tab), q: name === 'PlatformOrg' + m[1] ? {} : { s: name } };
    }
    if (/^OrgSuspended/.test(name)) return { path: o('/projects'), q: { s: name } };
    if (/^Projects/.test(name)) return v(o('/projects'), 'Projects');
    if ((m = /^Setup([1-4])$/.exec(name))) return { path: o('/projects/new/' + m[1]), q: {} };
    if (/^Setup1(Polling|PollingOk)$/.test(name)) return { path: o('/projects/new/1'), q: { s: name } };
    if (name === 'SetupReady') return { path: o('/projects/new/ready'), q: {} };
    if (name === 'SetupWorkspace') return { path: o('/projects/new/workspace'), q: {} };
    if (name === 'RunTranscriptStates') return { path: o(`/p/${proj}/runs/62`), q: { s: name } };
    if (name === 'Runs') return { path: o(`/p/${proj}/runs`), q: {} };
    if (/^Runs[A-Z]/.test(name)) return { path: o(`/p/${proj}/runs`), q: { s: name } };
    if (/^Run[A-Z]/.test(name)) {
      const n = runNum(name) || '62';
      return { path: o(`/p/${proj}/runs/${n}`), q: RUN_DEFAULT[n] === name ? {} : { s: name } };
    }
    if ((m = /^Desk(Agent|Rules|Setup|Skill|Members|Audit)/.exec(name))) {
      const tab = { Agent: 'agent', Rules: 'rules', Setup: 'setup', Skill: 'skills', Members: 'members', Audit: 'audit' }[m[1]];
      const def = { agent: 'DeskAgent', rules: 'DeskRules', setup: 'DeskSetup', skills: 'DeskSkills', members: 'DeskMembers', audit: 'DeskAudit' }[tab];
      return { path: o(`/p/${proj}/desk/${tab}`), q: name === def ? {} : { s: name } };
    }
    if ((m = /^Org(General|Members|Audit)/.exec(name))) {
      const tab = m[1].toLowerCase();
      return { path: o('/settings/' + tab), q: name === 'Org' + m[1] ? {} : { s: name } };
    }
    if (name === 'OrgInvitationsSettings') return { path: o('/settings/invitations'), q: {} };
    if (/^OrgInvitations/.test(name)) return { path: o('/settings/invitations'), q: { s: name } };
    return { path: '/b/' + name, q: {} };
  };

  AD.fixLinks = function (html) {
    return html.replace(/href="#\/b\/([A-Za-z0-9]+)"/g, (all, name) => {
      const r = AD.boardRoute(name);
      return 'href="' + AD.href(r.path, r.q) + '"';
    });
  };

  function liveAvatar(html) {
    const u = AD.user();
    if (!u) return html;
    return html.replace(/<span class="avatar"[^>]*>[^<]*<\/span>/, AD.chrome.avatarButton());
  }

  /* An `out` object (see main.js) for a board snapshot. */
  const BAR_H = 52; // height of the top bar added in front of boards that were drawn without one
  AD.boardOut = function (name, extra) {
    const b = B[name];
    if (!b) return AD.notFoundOut('No board named ' + name);
    let html = AD.fixLinks(b.body).replace('This list is one click away on the logo.', 'This list is one click away on the Projects tab.');
    // Projects page boards: the Settings (and the older Invitations) button in the head is a proposal now (off by default).
    if (/^Projects/.test(name) && !AD.proposals.projectsSettingsButton) html = html.replace(/<a href="[^"]*" class="btn( lg)?">(Invitations|Settings)<\/a>/g, '');
    const out = { header: b.kind, html, h: b.h, fixed: true, board: name, snapshot: true, title: b.title };
    if (b.kind === 'run') out.headerHtml = AD.chrome.runHeader(liveAvatar(AD.fixLinks(b.header)));
    // Boards drawn with no bar get the one bar: the "needs you" explainer (org bar), the page-crash and loading boards (bar of the current area).
    if (b.kind === 'none' && /^NeedsYou/.test(name)) { out.header = 'global'; out.h = b.h + BAR_H; }
    if (b.kind === 'none' && /^Route(Error|Loading)$/.test(name)) { out.header = 'auto'; out.h = b.h + BAR_H; }
    return Object.assign(out, extra || {});
  };

  /* ---- generic standard states for screens that have no live version of them ---- */
  const forbiddenMain = `<main style="flex:1;min-width:0;padding:24px 40px;overflow:hidden;display:flex;flex-direction:column;gap:20px"><div style="flex:1;display:flex;justify-content:center;padding:72px 0"><div style="width:100%;max-width:760px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center"><h1 style="font-size:28px">You don't have access</h1><p class="muted" style="font-size:15px;max-width:56ch">Ask an owner of this organization to give you access.</p></div></div></main>`;
  AD.forbiddenMain = forbiddenMain;
  AD.forbiddenOut = () => ({ header: 'global', html: forbiddenMain, h: 900 });
  AD.notFoundOut = (msg) => ({ header: 'global', h: 900, html: `<main style="flex:1;min-width:0;padding:24px 40px;display:flex;flex-direction:column;gap:20px"><div style="flex:1;display:flex;justify-content:center;padding:72px 0"><div style="width:100%;max-width:760px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center"><h1 style="font-size:28px">Not found</h1><p class="muted" style="font-size:15px;max-width:56ch">${AD.esc(msg || 'This page does not exist, or you cannot see it.')}</p><a class="btn" href="#/">Go to the start</a></div></div></main>` });
  AD.loadingMain = (extra) => `<main style="flex:1;min-width:0;padding:24px 40px;overflow:hidden;display:flex;flex-direction:column;gap:20px"><div aria-busy="true" role="status" aria-label="Loading" style="display:flex;flex-direction:column;gap:20px"><span aria-hidden="true" style="display:flex;justify-content:space-between"><span aria-hidden="true" style="display:block;height:28px;width:140px;background:var(--raised);border-radius:6px"></span></span><span aria-hidden="true" style="display:flex;flex-direction:column;gap:14px;margin-top:8px">${'<span aria-hidden="true" style="display:block;height:30px;width:100%;background:var(--raised);border-radius:6px"></span>'.repeat(6)}</span></div></main>`;
  AD.errorMain = (retry) => `<main style="flex:1;min-width:0;padding:24px 40px;overflow:hidden;display:flex;flex-direction:column;gap:20px"><div class="banner err" role="alert" style="align-items:center"><span class="b-ico">${AD.I.warn}</span><div class="grow" style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:600">Internal server error</b><span style="font-size:12px" class="muted">Request ID: <code class="mono" style="color:var(--text);font-size:12px">req_01JDA2C8R5HN</code></span></div><button class="btn" data-act="retry">${AD.I.retry}Retry</button></div></main>`;
  AD.emptyMain = (title) => `<main style="flex:1;min-width:0;padding:24px 40px;overflow:hidden;display:flex;flex-direction:column;gap:20px"><div style="display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:40px 16px"><h3>${AD.esc(title)}</h3></div></main>`;

  /* Standard scenarios for a board-backed screen. `alias` maps loading/empty/error/forbidden to a real board when the
     boards drew one; anything else falls back to the generic markup above. */
  AD.standardState = function (scen, alias, header) {
    alias = alias || {};
    if (alias[scen]) return AD.boardOut(alias[scen]);
    const h = header || 'global';
    if (scen === 'loading') return { header: h, html: AD.loadingMain(), h: 900, generic: 'loading' };
    if (scen === 'error') return { header: h, html: AD.errorMain(), h: 900, generic: 'error' };
    if (scen === 'forbidden') return { header: h, html: forbiddenMain, h: 900, generic: 'forbidden' };
    if (scen === 'crash') return AD.boardOut('RouteError');
    if (scen === 'empty') return { header: h, html: AD.emptyMain('Nothing here yet'), h: 900, generic: 'empty' };
    return null;
  };

  /* ---- small helpers for scenario lists ---- */
  AD.snapGroup = (names, label) => names.map((n) => ({ id: n, label: n + ' - ' + (B[n] ? B[n].title : ''), group: label || 'Board snapshots (static, as drawn)' }));

  /* ---- post-render enhancers for board snapshots ---- */
  AD.enhanceBoard = function (root, name) {
    if (!name) return;
    if (/^SignIn/.test(name)) {
      const a = AD.$('a.btn.primary.lg', root);
      if (a) { a.setAttribute('href', '#'); a.setAttribute('data-act', 'signin'); }
    }
    // The Runs chip "Ignored" opens the ignored-commands board (the boards link it from nowhere else).
    if (name === 'Runs' || /^RunsLinked|^RunsPaged|^RunsFlat/.test(name)) {
      AD.$$('.fchip', root).forEach((c) => {
        if (/^Ignored/.test(c.textContent.trim())) { c.setAttribute('data-act', 'go'); c.setAttribute('data-href', AD.href(AD.boardRoute('RunsProblems').path, { s: 'RunsProblems' })); }
      });
    }
    // Dialog / toast closers inside a snapshot return to the screen's default state.
    AD.$$('.overlay .d-f button, .overlay .dialog button', root).forEach((b) => {
      const t = b.textContent.trim();
      if (['Cancel', 'Done', 'Keep running', 'Close'].includes(t) && !b.disabled) { b.setAttribute('data-act', 'leave-snapshot'); }
    });
    AD.$$('button[aria-label="Dismiss"]', root).forEach((b) => b.setAttribute('data-act', 'dismiss-banner'));
  };
})();
