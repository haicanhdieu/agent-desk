/* "Prototype controls" panel: sits outside the app chrome. Persona (role) switcher, scenario selector, failure injection,
   reset, screen map, and the "Proposals to review" toggles (open questions 2 and 3 of the navigation proposal). */
(function () {
  'use strict';
  const AD = window.AD;
  const esc = AD.esc;
  const C = (AD.controls = {});

  const STD = [
    ['live', 'Live (the working screen)'],
    ['loading', 'Loading'],
    ['empty', 'Empty'],
    ['error', 'Error (with retry)'],
    ['forbidden', 'Forbidden / no access'],
    ['crash', 'Page crash (RouteError board)'],
  ];
  const FAILS = [
    ['none', 'None'],
    ['500', 'Server error (500)'],
    ['403', 'No access (403)'],
    ['404', 'Not found: removed meanwhile (404)'],
    ['409', 'Conflict (409): last owner, no longer pending, environment entry limit'],
    ['size', 'Too large (409): environment over 256 KiB'],
    ['copy', 'Clipboard blocked (copy link)'],
  ];

  C.mount = function () {
    const el = document.createElement('aside');
    el.id = 'proto';
    el.className = 'proto';
    el.setAttribute('aria-label', 'Prototype controls');
    el.innerHTML = `
<button class="proto-head" id="pc-toggle" aria-expanded="true"><span><b>Prototype controls</b> <span class="proto-tag">not part of the app</span></span><span id="pc-caret">${AD.I.chev}</span></button>
<div class="proto-body" id="pc-body">
  <div class="proto-sec"><label for="pc-persona">Signed in as (role)</label>
    <select id="pc-persona" class="input">${AD.PERSONAS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select>
    <div class="proto-hint" id="pc-hint"></div></div>
  <div class="proto-sec"><label for="pc-scen">Scenario / state of this screen</label>
    <select id="pc-scen" class="input"></select>
    <div class="proto-hint" id="pc-note"></div></div>
  <div class="proto-sec"><label for="pc-fail">Fail the next action with</label>
    <select id="pc-fail" class="input">${FAILS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
    </div>
  <div class="proto-row"><button class="btn sm" id="pc-reset">Reset</button><button class="btn sm" id="pc-signout">Logout</button><button class="btn sm" id="pc-map">Screen map</button><button class="btn sm" id="pc-copy">Copy link</button></div>
  <details class="proto-sec" open><summary>Proposals to review</summary>
    <label class="proto-check"><input type="checkbox" id="pc-p-btn"> <span>Keep a Settings button on the Projects page header (besides the Settings tab in the top bar).</span></label>
    <label class="proto-check"><input type="checkbox" id="pc-p-needs"> <span>Show the org-wide "needs you" count on the Projects tab.</span></label></details>
  <div class="proto-hint" id="pc-route"></div>
</div>`;
    document.body.appendChild(el);
    try { if (localStorage.getItem('ad-pc-collapsed') === '1') C.collapse(true); } catch (e) { /* storage may be blocked */ }

    AD.$('#pc-toggle').addEventListener('click', () => C.collapse(!el.classList.contains('collapsed')));
    AD.$('#pc-persona').addEventListener('change', (e) => C.setPersona(e.target.value));
    AD.$('#pc-scen').addEventListener('change', (e) => AD.setQuery({ s: e.target.value === 'live' ? null : e.target.value, page: null }));
    AD.$('#pc-fail').addEventListener('change', (e) => { AD.ui.fail = e.target.value; });
    AD.$('#pc-reset').addEventListener('click', C.reset);
    AD.$('#pc-signout').addEventListener('click', () => AD.acts.signout());
    AD.$('#pc-map').addEventListener('click', C.toggleMap);
    AD.$('#pc-copy').addEventListener('click', () => {
      const url = location.href;
      const ok = () => AD.toast('ok', 'Link copied', url);
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, () => AD.toast('off', 'Copy the address bar', url)); else AD.toast('off', 'Copy the address bar', url); } catch (e) { AD.toast('off', 'Copy the address bar', url); }
    });
    AD.$('#pc-p-needs').addEventListener('change', (e) => { AD.proposals.needsCount = e.target.checked; AD.render(); });
    AD.$('#pc-p-btn').addEventListener('change', (e) => { AD.proposals.projectsSettingsButton = e.target.checked; AD.render(); });
  };

  C.collapse = function (on) {
    const el = AD.$('#proto'); if (!el) return;
    el.classList.toggle('collapsed', on);
    AD.$('#pc-toggle').setAttribute('aria-expanded', String(!on));
    try { localStorage.setItem('ad-pc-collapsed', on ? '1' : '0'); } catch (e) { /* ignore */ }
  };

  C.setPersona = function (id) {
    AD.ui.persona = id;
    if (!AD.state.uid) { C.refresh(AD.cur, null, AD.out); return; }
    if (id === 'jo-marsh') { AD.state.uid = null; AD.nav('/signin', { s: 'SignInNoInvitation' }); return; }
    AD.state.uid = id; AD.ui.menu = null; AD.ui.dialog = null; AD.ui.form = null;
    const params = AD.cur.params || {};
    const stay = !params.org || AD.userOrgs(id).some((o) => o.slug === params.org);
    if (!stay) AD.nav(AD.landing()); else AD.render();
  };

  C.reset = function () {
    const persona = AD.ui.persona;
    AD.state = AD.seed(); AD.clock.minutes = 0;
    AD.ui = { menu: null, dialog: null, form: null, fail: 'none', pageSize: 20, bell: true, switching: false, persona };
    AD.proposals.projectsSettingsButton = false; AD.proposals.needsCount = false;
    AD.$('#pc-p-btn').checked = false; AD.$('#pc-p-needs').checked = false;
    AD.$('#toasts').innerHTML = '';
    AD.nav('/signin');
    AD.toast('ok', 'Prototype reset', 'Members, invitations, projects and audit log are back to the seed data.');
  };

  C.refresh = function (ctx, def, out) {
    if (!AD.$('#pc-persona') || !ctx) return;
    const uid = AD.state.uid;
    AD.$('#pc-persona').value = uid || AD.ui.persona;
    const p = AD.PERSONAS.find((x) => x.id === (uid || AD.ui.persona));
    AD.$('#pc-hint').textContent = (uid ? '' : 'Signed out. The Sign in button signs in as: ') + (p ? p.hint : '');
    AD.$('#pc-fail').value = AD.ui.fail || 'none';

    // scenario list
    const scen = ctx.scen || (ctx.q && ctx.q.s) || 'live';
    const sel = AD.$('#pc-scen');
    const snaps = def && def.snaps ? def.snaps(ctx) : [];
    const groups = {};
    snaps.forEach((s) => { (groups[s.group] = groups[s.group] || []).push(s); });
    const hasLive = !!def && !['index', 'snapshot', 'gallery', 'notfound'].includes(ctx.screen);
    let html = '';
    if (hasLive) {
      html += '<optgroup label="Standard states">' + STD.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('') + '</optgroup>';
    } else html += '<optgroup label="Standard states"><option value="live">Default</option></optgroup>';
    Object.keys(groups).forEach((g) => { html += `<optgroup label="${esc(g)}">` + groups[g].map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('') + '</optgroup>'; });
    if (scen !== 'live' && !STD.some(([v]) => v === scen) && !snaps.some((s) => s.id === scen)) html += `<optgroup label="Linked board"><option value="${esc(scen)}">${esc(scen)}</option></optgroup>`;
    sel.innerHTML = html;
    sel.value = scen;

    let note = '';
    if (AD.B[scen]) note = 'Static snapshot of the board "' + scen + '". Clicks on drawn controls that have no behaviour show a "Not wired" toast.';
    else if (out && out.generic) note = 'The boards do not draw this state for this screen; a generic ' + out.generic + ' placeholder in the same style is shown.';
    else if (out && out.sample) note = 'Run and Desk boards show sample data of invoicer-api for every project (the header follows the project you picked).';
    AD.$('#pc-note').textContent = note;
    AD.$('#pc-route').innerHTML = 'Route: <code class="mono">' + esc(location.hash || '#/') + '</code>';
  };

  /* ---------- screen map ---------- */
  C.toggleMap = function () {
    let m = AD.$('#pc-mapbox');
    if (m) { m.remove(); return; }
    const org = AD.curOrg();
    const proj = AD.curProject();
    const o = '/o/' + org;
    const L = (path, label, q) => `<a href="${AD.href(path, q)}">${esc(label)}</a>`;
    const g = (title, links) => `<div class="proto-map-g"><b>${esc(title)}</b>${links.join('')}</div>`;
    m = document.createElement('div');
    m.id = 'pc-mapbox';
    m.className = 'proto-map';
    m.innerHTML = `<div class="proto-map-h"><b>Screen map</b><button class="btn ghost sm" id="pc-mapx" aria-label="Close screen map">${AD.I.x}</button></div>
<p class="proto-hint">Current org: <b>${esc(org)}</b>, project: <b>${esc(proj)}</b>. Links open the route in the current role.</p>
${g('Entry', [L('/signin', 'Sign in'), L('/index', 'Board index (all boards)'), L('/invitations', 'My invitations'), L('/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43', 'Accept an invitation'), L('/orgs/new', 'Create an organization (platform admin)'), L('/gallery/pagination', 'Pagination and paged-list states')])}
${g('Organization', [L(o + '/projects', 'Projects'), L(o + '/projects/new/1', 'New project: 1 connect repository'), L(o + '/projects/new/2', '2 Claude credential'), L(o + '/projects/new/workspace', '3 prepare workspace'), L(o + '/projects/new/3', '3 skills'), L(o + '/projects/new/4', '4 first rule'), L(o + '/projects/new/ready', 'Ready to trigger'), L(o + '/needs-you', 'Needs you (outside the run page)')])}
${g('Settings', [L(o + '/settings', 'Settings (first tab for the role)'), L(o + '/settings/general', 'General'), L(o + '/settings/members', 'Members'), L(o + '/settings/invitations', 'Invitations'), L(o + '/settings/audit', 'Audit log'), L(o + '/invitations', 'Old /invitations URL (redirects)', { status: 'all' })])}
${g('Project ' + proj, [L(o + '/p/' + proj + '/runs', 'Runs'), ...[63, 62, 61, 60, 58, 56, 54, 52].map((n) => L(o + '/p/' + proj + '/runs/' + n, 'Run ' + n + ' (' + AD.RUN_DEFAULT[n].replace(/^Run/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase() + ')')), L(o + '/p/' + proj + '/desk/skills', 'Desk: skills'), L(o + '/p/' + proj + '/desk/rules', 'Desk: routing rules'), L(o + '/p/' + proj + '/desk/setup', 'Desk: workspace setup'), L(o + '/p/' + proj + '/desk/setup', 'Desk: workspace setup, Environment tab', { tab: 'environment' }),L(o + '/p/' + proj + '/desk/agent', 'Desk: agent and settings')])}`;
    document.body.appendChild(m);
    AD.$('#pc-mapx').addEventListener('click', () => m.remove());
    m.addEventListener('click', (e) => { if (e.target.closest('a')) m.remove(); });
  };
})();
