/* Platform admin area (spec docs/superpowers/specs/2026-11-23-platform-admin-dashboard-design.md), built from the Platform*
   boards: side menu layout, Platform admins (add, revoke, last working admin), Organizations directory (search, status),
   organization detail (Overview with suspend/reactivate, Projects, Members with assignments, Invitations), platform Audit log
   (action filter, org chip), and the tenant "This organization is suspended" page. Only the prototype's own tokens and helpers. */
(function () {
  'use strict';
  const AD = window.AD;
  const esc = AD.esc;
  const I = AD.I;
  const MAIN = 'flex:1;min-width:0;padding:24px 40px;overflow:hidden;display:flex;flex-direction:column;gap:20px';
  const SR = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
  const span = (t, s) => `<span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${s || ''}" title="${esc(t)}">${esc(t)}</span>`;
  const DASH = '<span class="faint" style="font-size:13px">—</span>';
  const T = (d, h, m, rel, mon) => ({ title: `${d} ${mon || 'Nov'} 2026, ${h}:${m}`, iso: `2026-${mon === 'Oct' ? '10' : mon === 'Sep' ? '09' : '11'}-${String(d).padStart(2, '0')}T${h}:${m}`, rel });
  const now = () => { AD.clock.minutes += 1; const t = AD.nowLabel(); return { title: t.title, iso: t.iso, rel: 'just now' }; };

  /* ---------- seed (added to the shared seed; Reset restores it, and the ops-admin platform flag) ---------- */
  const ORG_IDS = { 'harbor-labs': '0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10', northwind: '2b8e4c17-9d3a-4f61-8c2e-5d7b1a9f3e24', riverside: '5c1a7e39-2f8d-4b6c-a3e9-8d4f2b6c1a57', 'acme-rockets': '8e3f5b20-6a1c-4d97-b8f2-3c9e7a5d2b81', 'bluefin-health': 'b47d9c62-1e5f-4a38-9d6b-2f8a4c7e1d93' };
  const PROJECT_IDS = { 'invoicer-api': '0b9f6c2e-5d41-4a7e-9b3c-8e2f1a6d4c70', 'invoicer-web': '3c1d8e7a-92b4-4f06-a5e1-7d4c2b9f0e13', 'docs-site': '7e5a2c90-1f3b-4d8e-b6a4-c0d9e2f17a58', 'billing-jobs': 'a24f6b1d-8c3e-47a9-9e05-5b7d1c3f6e82', 'forecast-service': 'c62e8a14-7b3d-4f59-a1c8-9e0d2b5f7a36', 'intake-api': 'd5a91c3e-2f7b-4e60-8a4d-1c9e6b3f2a75', 'claims-portal': 'e1f47b92-5c8a-4d3e-9b61-7a2d0c8e4f19' };
  const EMAIL_OVERRIDE = { 'ari-k': 'ari.k@example.com', 'alexandra-kw': 'alexandra.kw@harborlabs.dev', 'ruth-okafor': 'ruth.okafor@bluefin.example' };
  const UNVERIFIED = ['new.hire@agentdesk.example']; // an account that exists but has not verified its email (422)

  function platformSeed(st) {
    const P = (name, role) => ({ name, role });
    st.members['bluefin-health'] = [
      { uid: 'ruth-okafor', name: 'Ruth Okafor', handle: 'ruth-okafor', role: 'owner', projects: [] },
      { uid: 'tom-reed', name: 'Tom Reed', handle: 'tom-reed', role: 'admin', projects: [] },
      { uid: 'lena-voss', name: 'Lena Voss', handle: 'lena-voss', role: 'member', projects: [P('intake-api', 'Member')] },
      { uid: 'kofi-mensah', name: 'Kofi Mensah', handle: 'kofi-mensah', role: 'member', projects: [] },
      { uid: 'ana-lima', name: 'Ana Lima', handle: 'ana-lima', role: 'viewer', projects: [] },
      { uid: 'bf-ci', name: '', handle: 'bf-ci', role: null, projects: [P('claims-portal', 'Admin')] },
    ];
    st.members['acme-rockets'] = [];
    st.projects['bluefin-health'] = [{ id: 'intake-api' }, { id: 'claims-portal' }];
    st.projects['acme-rockets'] = [];
    st.invites['bluefin-health'] = [];
    st.invites['acme-rockets'] = [{ id: 'o1', email: 'cto@acmerockets.example', role: 'Owner', access: null, status: 'pending', exp: { rel: 'Expires in 1 day', title: '23 Nov 2026, 10:58', iso: '2026-11-23T10:58' }, by: 'Morgan Avery' }];
    st.audit['bluefin-health'] = []; st.audit['acme-rockets'] = [];
    const A = (name) => (name ? { name } : { name: 'Deleted user', deleted: true });
    const row = (time, actor, k, x) => Object.assign({ time, actor: A(actor), k }, x);
    const BF = { org: 'bluefin-health', orgName: 'Bluefin Health' };
    const RV = { org: 'riverside', orgName: 'Riverside Municipal Water and Power Utilities Digital Services' };
    const HL = { org: 'harbor-labs', orgName: 'Harbor Labs' };
    const NW = { org: 'northwind', orgName: 'Northwind Analytics' };
    const audit = [
      // page 1, as drawn in PlatformAudit
      row(T(22, '10', '58', '2 min ago'), 'Morgan Avery', 'created', { org: 'acme-rockets', orgName: 'Acme Rockets' }),
      row(T(21, '16', '40', 'yesterday'), 'Morgan Avery', 'suspended', Object.assign({ reason: 'Contract ended on 20 Nov; the customer asked us to pause access.' }, BF)),
      row(T(21, '09', '15', 'yesterday'), 'Priya Natarajan', 'inv-revoked', Object.assign({ email: 'tom.reed@bluefin.example' }, BF)),
      row(T(20, '14', '02', '2 days ago'), 'Morgan Avery', 'admin-added', { email: 'priya.natarajan@agentdesk.example' }),
      row(T(19, '11', '30', '19 Nov'), 'Priya Natarajan', 'reactivated', Object.assign({ reason: 'Owner confirmed the new billing contact.' }, RV)),
      row(T(18, '17', '05', '18 Nov'), 'Priya Natarajan', 'suspended', Object.assign({ reason: 'Billing contact unreachable for 30 days.' }, RV)),
      row(T(18, '10', '12', '18 Nov'), 'Morgan Avery', 'assign-added', Object.assign({ member: 'Ruth Okafor', role: 'Owner' }, BF)),
      row(T(18, '10', '05', '18 Nov'), 'Morgan Avery', 'inv-created', Object.assign({ email: 'ruth.okafor@bluefin.example', role: 'Owner' }, BF)),
      row(T(18, '10', '01', '18 Nov'), 'Morgan Avery', 'updated', Object.assign({ changes: [['name', 'Bluefin', 'Bluefin Health'], ['slug', 'bluefin', 'bluefin-health']] }, BF)),
      row(T(18, '09', '58', '18 Nov'), 'Morgan Avery', 'created', BF),
      row(T(15, '13', '20', '15 Nov'), null, 'admin-revoked', { email: 'sam.lee@agentdesk.example' }),
      // filler (invented) so the log pages like PlatformAuditPaged (25 entries, 20 per page)
      row(T(15, '11', '05', '15 Nov'), 'Morgan Avery', 'inv-resent', Object.assign({ email: 'sana.iqbal@riverside.example' }, RV)),
      row(T(15, '10', '40', '15 Nov'), 'Morgan Avery', 'assign-added', Object.assign({ member: 'Mira Chen', role: 'Member', project: 'docs-site' }, HL)),
      row(T(14, '16', '22', '14 Nov'), 'Morgan Avery', 'assign-removed', Object.assign({ member: 'Theo Brandt', role: 'Member' }, HL)),
      row(T(14, '15', '10', '14 Nov'), 'Morgan Avery', 'assign-added', Object.assign({ member: 'Theo Brandt', role: 'Viewer' }, HL)),
      row(T(14, '12', '45', '14 Nov'), 'Morgan Avery', 'inv-created', Object.assign({ email: 'maria.chen@northwind.example', role: 'Owner' }, NW)),
      row(T(14, '11', '30', '14 Nov'), 'Morgan Avery', 'inv-revoked', Object.assign({ email: 'old.owner@northwind.example' }, NW)),
      row(T(14, '11', '02', '14 Nov'), 'Morgan Avery', 'admin-added', { email: 'sre-oncall@agentdesk.example' }),
      row(T(14, '10', '45', '14 Nov'), 'Morgan Avery', 'inv-created', Object.assign({ email: 'sana.iqbal@riverside.example', role: 'Owner' }, RV)),
      row(T(14, '10', '30', '14 Nov'), 'Morgan Avery', 'assign-added', Object.assign({ member: 'Lee Park', role: 'Admin', project: 'docs-site' }, HL)),
      // page 2, as drawn in PlatformAuditPaged
      row(T(14, '10', '20', '14 Nov'), 'Morgan Avery', 'admin-added', { email: 'omar.haddad@agentdesk.example' }),
      row(T(10, '09', '41', '10 Nov'), 'Morgan Avery', 'inv-created', Object.assign({ email: 'kim.hale@harborlabs.dev', role: 'Owner' }, HL)),
      row(T(10, '09', '40', '10 Nov'), 'Morgan Avery', 'inv-resent', Object.assign({ email: 'maria.chen@northwind.example' }, NW)),
      row(T(9, '11', '12', '9 Nov'), 'Morgan Avery', 'created', RV),
      row(T(6, '15', '02', '6 Nov'), 'Morgan Avery', 'assign-removed', Object.assign({ member: 'Lee Park', role: 'Admin', project: 'docs-site' }, HL)),
    ].map((e, i) => Object.assign({ id: 'pa' + i }, e));
    st.platform = {
      ids: Object.assign({}, ORG_IDS),
      extraOrgs: [{ slug: 'acme-rockets', name: 'Acme Rockets' }, { slug: 'bluefin-health', name: 'Bluefin Health' }],
      meta: {
        'acme-rockets': { created: T(22, '10', '58', '2 min ago'), last: null },
        'bluefin-health': { created: T(18, '09', '58', '18 Nov'), last: T(19, '16', '40', '3 days ago') },
        riverside: { created: T(9, '11', '12', '9 Nov'), last: null },
        northwind: { created: T(5, '15', '30', '5 Nov'), last: null },
        'harbor-labs': { created: T(3, '09', '00', '3 Nov'), last: T(22, '10', '58', '2 min ago') },
      },
      susp: { 'bluefin-health': { since: '21 Nov 2026', by: 'Morgan Avery', reason: 'Contract ended on 20 Nov; the customer asked us to pause access.' } },
      admins: [
        { id: 'adm3', email: 'sre-oncall@agentdesk.example', account: false, added: T(21, '09', '30', 'yesterday'), by: null },
        { id: 'adm2', name: 'Priya Natarajan', handle: 'priya-n', email: 'priya.natarajan@agentdesk.example', account: true, added: T(20, '14', '02', '2 days ago'), by: 'Morgan Avery' },
        { id: 'adm1', uid: 'ops-admin', name: 'Morgan Avery', handle: 'ops-admin', email: 'morgan.avery@agentdesk.example', account: true, added: T(12, '09', '00', '12 Nov'), by: null },
      ],
      audit,
    };
    return st;
  }
  const seed0 = AD.seed;
  AD.seed = function () { AD.USERS['ops-admin'].platform = true; return platformSeed(seed0()); };
  platformSeed(AD.state);

  /* ---------- org helpers ---------- */
  const PS = () => AD.state.platform;
  const allOrgs = () => AD.state.orgs.concat(PS().extraOrgs);
  const porg = (slug) => allOrgs().find((o) => o.slug === slug) || null;
  AD.platformOrgId = (slug) => {
    const ids = PS().ids;
    if (!ids[slug]) ids[slug] = 'a0c3' + Math.random().toString(16).slice(2, 6) + '-1d2e-4f30-8a41-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
    return ids[slug];
  };
  const slugOf = (id) => Object.keys(PS().ids).find((s) => PS().ids[s] === id && porg(s)) || null;
  AD.orgIsSuspended = (slug) => !!(AD.state.platform && PS().susp[slug]);
  // Router hook: show the "suspended" page on every URL of a suspended org, and for the OrgSuspended* board snapshots.
  AD.orgSuspendedView = (slug, q) => {
    const s = q && q.s;
    if (s && /^OrgSuspended/.test(s)) return true;
    if (s && AD.B[s]) return false;
    return AD.orgIsSuspended(slug);
  };
  function meta(slug) {
    const m = PS().meta;
    if (!m[slug]) m[slug] = { created: now(), last: null };
    return m[slug];
  }
  function info(slug) {
    const o = porg(slug);
    const members = AD.state.members[slug] || [];
    const owner = members.find((m) => m.role === 'owner');
    const md = meta(slug);
    return { slug, id: AD.platformOrgId(slug), name: o.name, owner, members: members.length, projects: (AD.state.projects[slug] || []).length, last: md.last, created: md.created, suspended: AD.orgIsSuspended(slug) };
  }
  const memberEmail = (m, slug) => (AD.USERS[m.uid] && AD.USERS[m.uid].email) || EMAIL_OVERRIDE[m.handle] || m.handle.replace(/-/g, '.') + '@' + (slug === 'harbor-labs' ? 'harborlabs.dev' : slug + '.example');

  /* ---------- platform audit ---------- */
  const ACTIONS = [['admin-added', 'Platform admin added'], ['admin-revoked', 'Platform admin revoked'], ['created', 'Organization created'], ['updated', 'Organization updated'], ['suspended', 'Organization suspended'], ['reactivated', 'Organization reactivated'], ['assign-added', 'Assignment added'], ['assign-removed', 'Assignment removed'], ['inv-created', 'Invitation created'], ['inv-resent', 'Invitation resent'], ['inv-revoked', 'Invitation revoked']];
  function paudit(k, x) {
    const u = AD.user();
    PS().audit.unshift(Object.assign({ id: 'pa' + Date.now() + Math.random(), time: now(), actor: { name: u ? u.name : 'Someone' }, k }, x));
  }
  function paudText(e) {
    const b = (x) => `<b style="font-weight:500">${esc(x)}</b>`;
    const who = b(e.actor.name);
    const scope = e.project ? ` on ${b(e.project)}` : '';
    const html = {
      'admin-added': () => `${who} added ${b(e.email)} as a platform admin`,
      'admin-revoked': () => `${who} revoked platform access for ${b(e.email)}`,
      created: () => `${who} created ${b(e.orgName)}`,
      // Org edit (BR-60): one entry with the old and new value of each changed field.
      updated: () => `${who} changed ` + e.changes.map(([f, from, to], i) => (f === 'name' ? (i ? 'the name' : `the name of ${b(e.orgName)}`) + ` from ${esc(from)} to ${esc(to)}` : (i ? 'the URL' : `the URL of ${b(e.orgName)}`) + ` from <span class="mono">/o/${esc(from)}</span> to <span class="mono">/o/${esc(to)}</span>`)).join(' and '),
      suspended: () => `${who} suspended ${b(e.orgName)}`,
      reactivated: () => `${who} reactivated ${b(e.orgName)}`,
      'assign-added': () => `${who} gave ${b(e.member)} the ${esc(e.role)} role${scope} in ${b(e.orgName)}`,
      'assign-removed': () => `${who} removed ${b(e.member)}'s ${esc(e.role)} role${scope} in ${b(e.orgName)}`,
      'inv-created': () => `${who} invited ${b(e.email)} to ${b(e.orgName)} as ${esc(e.role)}`,
      'inv-resent': () => `${who} resent the invitation for ${b(e.email)} to ${b(e.orgName)}`,
      'inv-revoked': () => `${who} revoked the invitation for ${b(e.email)} to ${b(e.orgName)}`,
    }[e.k]();
    return { html, title: html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'") };
  }
  // Writes a platform admin makes through the shared fake API (create org, invitations) also land in the platform audit (BR-44).
  const addAudit0 = AD.addAudit;
  AD.addAudit = function (slug, ev) {
    addAudit0(slug, ev);
    const u = AD.user();
    if (!u || !u.platform || !AD.state.platform) return;
    const o = porg(slug); const x = { org: slug, orgName: o ? o.name : slug };
    if (ev.k === 'raw' && ev.key === 'POST orgs.create') paudit('created', x);
    else if (ev.k === 'invited') paudit('inv-created', Object.assign({ email: ev.email, role: ev.role }, x));
    else if (ev.k === 'resent') paudit('inv-resent', Object.assign({ email: ev.email }, x));
    else if (ev.k === 'revoked') paudit('inv-revoked', Object.assign({ email: ev.email }, x));
  };
  // Tenant audit sentences for the platform admin's suspend and reactivate (BR-43): no reason.
  const auditText0 = AD.auditText;
  AD.auditText = function (e) {
    if (e.ev.k === 'suspended' || e.ev.k === 'reactivated') {
      const html = `<b style="font-weight:500">${esc(e.actor.name)}</b> ${e.ev.k} the organization`;
      return { html, title: `${e.actor.name} ${e.ev.k} the organization` };
    }
    return auditText0(e);
  };

  /* ---------- layout ---------- */
  function sideNav(active, org) {
    const a = (path, q, id, icon, label) => `<a href="${AD.href(path, q)}" class="${active === id ? 'on' : ''}"${active === id ? ' aria-current="page"' : ''}>${icon}${label}</a>`;
    let h = `<nav class="subnav" aria-label="Platform admin"><div class="grp-h" style="padding-top:2px">Platform admin</div>${a('/platform/orgs', {}, 'orgs', I.grid, 'Organizations')}${a('/platform/admins', {}, 'admins', I.lock15, 'Platform admins')}${a('/platform/audit', {}, 'audit', I.clock, 'Audit log')}`;
    if (org) {
      const base = '/platform/orgs/' + org.id;
      h += `<div class="grp-h">${span(org.name)}</div>${a(base, {}, 'overview', I.sliders, 'Overview')}${a(base + '/projects', {}, 'projects', '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>', 'Projects')}${a(base + '/members', {}, 'members', I.people, 'Members')}${a(base + '/invitations', {}, 'invitations', I.envelope15, 'Invitations')}`;
    }
    return h + '</nav>';
  }
  function out(title, active, org, main, overlay, after) {
    return { header: 'global', noOrg: true, h: 900, title, html: `<div style="flex:1;display:flex;min-height:0">${sideNav(active, org)}<main style="${MAIN}">${main}</main></div>${overlay || ''}`, after };
  }
  const LOADING = `<div aria-busy="true" role="status" aria-label="Loading" style="display:flex;flex-direction:column;gap:14px">${'<span aria-hidden="true" style="display:block;height:30px;width:100%;background:var(--raised);border-radius:6px"></span>'.repeat(5)}</div>`;
  const ERROR = () => AD.errBanner({ title: 'Internal server error', reqId: AD.reqId() }, `<button class="btn" data-act="retry">${I.retry}Retry</button>`);
  const empty = (title, body, action) => `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:40px 16px"><h3>${esc(title)}</h3>${body ? `<p class="muted" style="font-size:13.5px">${esc(body)}</p>` : ''}${action ? `<div style="margin-top:6px">${action}</div>` : ''}</div>`;
  const table = (cols, head, rows) => `<table style="table-layout:fixed"><colgroup>${cols.map((w) => (w ? `<col style="width:${w}">` : '<col>')).join('')}</colgroup><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  const ACTIONS_TH = `<span style="${SR}">Actions</span>`;
  const later = (fn) => setTimeout(fn, 600);
  const focusH1 = () => setTimeout(() => { const h = AD.$('#stage main h1'); if (h) h.focus(); }, 0);

  // Board snapshots, the non-admin gate and the generic loading/error states, shared by every platform screen.
  function gate(ctx, active, org) {
    const s = ctx.scen;
    if (s !== 'live' && AD.B[s]) { const o = AD.boardOut(s); if (s !== 'PlatformAdminsForbidden') o.noOrg = true; return o; }
    if (s === 'forbidden' || !ctx.user.platform) return Object.assign(AD.boardOut('PlatformAdminsForbidden'), { snapshot: false, board: null, title: "You don't have access" });
    if (s === 'crash') return AD.boardOut('RouteError');
    if (s === 'loading') return out('Loading', active, org, LOADING);
    if (s === 'error') return out('Error', active, org, ERROR());
    return null;
  }
  const snaps = (re) => () => AD.snapGroup(AD.boardNames(re));

  /* =========================================================================================================
     Platform admins
     ========================================================================================================= */
  const working = () => PS().admins.filter((a) => a.account);
  function account(email) {
    const e = email.toLowerCase();
    for (const uid of Object.keys(AD.USERS)) if (uid !== 'jo-marsh' && AD.USERS[uid].email === e) return { uid, name: AD.USERS[uid].name, handle: uid };
    for (const slug of Object.keys(AD.state.members)) for (const m of AD.state.members[slug]) if (memberEmail(m, slug) === e) return { name: m.name, handle: m.handle };
    if (e === 'priya.natarajan@agentdesk.example') return { name: 'Priya Natarajan', handle: 'priya-n' };
    return null;
  }
  function adminRow(a, last) {
    const u = AD.user();
    const you = a.uid && a.uid === u.id;
    const name = a.account ? `<span class="row" style="gap:8px;min-width:0"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;min-width:0" title="${esc(a.name)}">${esc(a.name)}</span>${you ? '<span class="lbl" style="flex:0 0 auto">You</span>' : ''}</span>` : '<span class="lbl">Not signed in yet</span>';
    const busy = AD.ui.dialog && AD.ui.dialog.type === 'prevoke' && AD.ui.dialog.busy && AD.ui.dialog.id === a.id;
    const act = last
      ? `<span class="row" style="justify-content:flex-end;gap:8px"><span id="la-${a.id}" class="faint" style="font-size:12.5px;white-space:nowrap" title="Grant the role to someone else first.">Last admin</span><button class="btn sm" disabled aria-describedby="la-${a.id}" aria-label="Revoke platform access for ${esc(a.email)}">Revoke</button></span>`
      : `<button class="btn sm" data-act="padm-revoke-open" data-id="${a.id}" aria-label="Revoke platform access for ${esc(a.email)}"${busy ? ' disabled' : ''}>Revoke</button>`;
    return `<tr${busy ? ' aria-busy="true"' : ''}><td>${name}</td><td>${span(a.email, 'font-size:13px')}</td><td>${a.handle ? `<span class="muted mono">${esc(a.handle)}</span>` : DASH}</td><td class="muted" style="font-size:13px;white-space:nowrap">${AD.time(a.added)}</td><td style="font-size:13px">${a.by ? span(a.by) : DASH}</td><td style="text-align:right">${act}</td></tr>`;
  }
  function addDialog() {
    const d = AD.ui.dialog;
    const fe = d.fieldErr;
    return AD.dialog({
      label: 'Add platform admin', w: 480,
      body: `<h2 style="font-size:18px">Add platform admin</h2>${d.err ? AD.errBanner(d.err) : ''}<div class="field"><label for="pe">Email</label><input id="pe" class="input${fe ? ' bad' : ''}" value="${esc(d.email)}" data-dlg="email" aria-describedby="pe-h${fe ? ' pe-e' : ''}"${fe ? ' aria-invalid="true"' : ''}${d.busy ? ' readonly' : ''}><span id="pe-h" class="help">They need an Agent Desk account with a verified email.</span>${fe ? `<span id="pe-e" class="ferr" role="alert">${esc(fe)}</span>` : ''}</div>`,
      foot: `<button class="btn ghost" data-act="dialog-close"${d.busy ? ' disabled' : ''}>Cancel</button><button class="btn primary" data-act="padm-add"${d.busy ? ' disabled aria-busy="true"' : ''}>${d.busy ? 'Adding…' : 'Add'}</button>`,
    });
  }
  function revokeDialog() {
    const d = AD.ui.dialog;
    const a = PS().admins.find((x) => x.id === d.id); if (!a) return '';
    const self = a.uid === AD.state.uid;
    const title = self ? 'Revoke your own platform access?' : `Revoke platform access for ${a.name || a.email}?`;
    const body = self ? 'You lose access right away and go to the home page.' : 'They can no longer open the platform admin area.';
    return AD.dialog({ label: title, w: 480, body: `<h2 style="font-size:18px">${esc(title)}</h2><p class="muted" style="font-size:13.5px">${body}</p>`, foot: `<button class="btn ghost" data-act="dialog-close"${d.busy ? ' disabled' : ''}>Cancel</button><button class="btn solid-danger" data-act="padm-revoke"${d.busy ? ' disabled aria-busy="true"' : ''}>${d.busy ? 'Revoking…' : 'Revoke'}</button>` });
  }
  const A = AD.acts;
  A['padm-add-open'] = () => { AD.ui.dialog = { type: 'padd', email: '', busy: false, err: null, fieldErr: null }; AD.render(); setTimeout(() => { const i = AD.$('#pe'); if (i) i.focus(); }, 0); };
  A['padm-add'] = () => {
    const d = AD.ui.dialog; if (d.busy) return;
    d.err = null; d.fieldErr = null;
    const email = (d.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { d.fieldErr = 'Enter a valid email address.'; AD.render(); return; }
    d.busy = true; AD.render();
    later(() => {
      d.busy = false;
      const f = AD.takeFail();
      if (f === '500' || f === '403') { d.err = { title: f === '403' ? "You don't have access" : 'Internal server error', reqId: AD.reqId() }; AD.render(); return; }
      const e = email.toLowerCase();
      if (UNVERIFIED.includes(e)) { d.fieldErr = 'This email is not verified yet.'; AD.render(); return; }
      const acc = account(e);
      if (!acc) { d.fieldErr = 'No account has this email yet.'; AD.render(); return; }
      if (!PS().admins.some((a) => a.email === e)) { // a repeat (already an admin) is a 200 no-op: no second row, no audit entry (BR-12, BR-44)
        PS().admins.unshift({ id: 'adm' + Date.now(), uid: acc.uid, name: acc.name || acc.handle, handle: acc.handle, email: e, account: true, added: now(), by: AD.user().name });
        if (acc.uid && AD.USERS[acc.uid]) AD.USERS[acc.uid].platform = true;
        paudit('admin-added', { email: e });
      }
      AD.ui.dialog = null; AD.toast('ok', 'Platform admin added'); AD.render();
    });
  };
  A['padm-revoke-open'] = (el) => { AD.ui.dialog = { type: 'prevoke', id: el.dataset.id, busy: false }; AD.render(); };
  A['padm-revoke'] = () => {
    const d = AD.ui.dialog; if (d.busy) return; d.busy = true; AD.render();
    later(() => {
      AD.ui.dialog = null;
      const f = AD.takeFail();
      const a = PS().admins.find((x) => x.id === d.id);
      const lastWorking = a && a.account && working().length <= 1;
      if (f === '409' || lastWorking) { AD.toast('err', 'Cannot revoke the last platform admin'); AD.render(); return; }
      if (f === '404' || !a) { AD.toast('err', 'Platform admin not found'); AD.render(); return; }
      if (f) { AD.toast('err', f === '403' ? "You don't have access" : 'Internal server error'); AD.render(); return; }
      PS().admins = PS().admins.filter((x) => x.id !== a.id);
      if (a.uid && AD.USERS[a.uid]) AD.USERS[a.uid].platform = false;
      paudit('admin-revoked', { email: a.email });
      AD.toast('ok', 'Platform admin revoked');
      if (a.uid === AD.state.uid) { AD.nav('/'); return; } // BR-15: own access gone, go home
      AD.render(); focusH1();
    });
  };

  AD.screens['platform.index'] = { title: 'Platform admin', render() { setTimeout(() => AD.nav('/platform/orgs', {}, { replace: true }), 0); return out('Platform admin', 'orgs', null, LOADING); } };
  AD.screens['platform.admins'] = {
    title: 'Platform admins',
    snaps: snaps(/^PlatformAdmins/),
    render(ctx) {
      const g = gate(ctx, 'admins'); if (g) return g;
      const head = `<div class="row" style="justify-content:space-between"><h1 tabindex="-1">Platform admins</h1><button class="btn primary" data-act="padm-add-open">${I.plus}Add platform admin</button></div>`;
      const list = ctx.scen === 'empty' ? [] : PS().admins;
      const d = AD.ui.dialog;
      const overlay = !d ? '' : d.type === 'padd' ? addDialog() : d.type === 'prevoke' ? revokeDialog() : '';
      if (!list.length) return out('Platform admins', 'admins', null, head + empty('No platform admins'), overlay);
      const lone = working().length === 1;
      const pg = AD.slice(list, Number(ctx.q.page) || 1);
      const rows = pg.rows.map((a) => adminRow(a, lone && a.account));
      return out('Platform admins', 'admins', null, head + table(['22%', '26%', '13%', '11%', '14%', '150px'], ['Name', 'Email', 'Handle', 'Added', 'Added by', ACTIONS_TH], rows) + AD.pager(pg), overlay);
    },
  };

  /* =========================================================================================================
     Organizations directory
     ========================================================================================================= */
  const statusCell = (susp) => (susp ? `<span class="st" style="color:var(--late)">${I.stSusp}Suspended</span>` : `<span class="st st-succeeded">${I.stOk}Active</span>`);
  function orgRow(o) {
    const owner = o.owner ? span(o.owner.name || o.owner.handle) : '<span class="faint">No owner yet</span>';
    return `<tr><td><span class="row" style="gap:8px;min-width:0"><a href="${AD.href('/platform/orgs/' + o.id)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;min-width:0" title="${esc(o.name)}">${esc(o.name)}</a><span class="muted mono" style="white-space:nowrap;flex:0 0 auto">/o/${esc(o.slug)}</span></span></td><td style="font-size:13px">${owner}</td><td class="num">${o.members}</td><td class="num">${o.projects}</td><td class="muted" style="font-size:13px;white-space:nowrap">${o.last ? AD.time(o.last) : '<span class="faint">No activity yet</span>'}</td><td>${statusCell(o.suspended)}</td><td class="muted" style="font-size:13px;white-space:nowrap">${AD.time(o.created)}</td></tr>`;
  }
  let searchTimer = null;
  AD.inputs['pdir-q'] = (t) => {
    clearTimeout(searchTimer);
    const v = t.value;
    searchTimer = setTimeout(() => { AD.ui.pdirFocus = true; AD.setQuery({ q: v.trim() ? v : null, page: null }, { replace: true }); }, 250);
  };
  AD.inputs['pdir-status'] = (t) => AD.setQuery({ status: t.value === 'all' ? null : t.value, page: null });
  A['pdir-clear'] = () => AD.setQuery({ q: null, status: null, page: null });
  AD.screens['platform.orgs'] = {
    title: 'Organizations',
    snaps: snaps(/^PlatformOrgs/),
    render(ctx) {
      const g = gate(ctx, 'orgs'); if (g) return g;
      const head = `<div class="row" style="justify-content:space-between"><h1 tabindex="-1">Organizations</h1><a href="${AD.href('/orgs/new')}" class="btn primary">${I.plus}Create organization</a></div>`;
      const all = ctx.scen === 'empty' ? [] : allOrgs().map((o) => info(o.slug)).sort((a, b) => (a.created.iso < b.created.iso ? 1 : -1));
      if (!all.length) return out('Organizations', 'orgs', null, head + empty('No organizations yet', 'Create one to invite its first owner.'));
      const q = (ctx.q.q || '').trim().toLowerCase();
      const st = ['active', 'suspended'].includes(ctx.q.status) ? ctx.q.status : 'all';
      const list = all.filter((o) => (!q || o.name.toLowerCase().includes(q) || o.slug.includes(q)) && (st === 'all' || (st === 'suspended') === o.suspended));
      const filters = `<div class="row" style="gap:8px"><label for="oq" style="${SR}">Search organizations</label><input id="oq" class="input" type="search" maxlength="100" placeholder="Search organizations" value="${esc(ctx.q.q || '')}" data-on="pdir-q" style="width:320px"><label for="ost" style="${SR}">Status</label><select id="ost" class="input" data-on="pdir-status" style="width:170px">${[['all', 'All statuses'], ['active', 'Active'], ['suspended', 'Suspended']].map(([v, l]) => `<option value="${v}"${v === st ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`;
      const pg = AD.slice(list, Number(ctx.q.page) || 1);
      const tbl = table(['30%', '14%', '9%', '9%', '13%', '12%', ''], ['Organization', 'Owner', 'Members', 'Projects', 'Last activity', 'Status', 'Created'], pg.rows.map(orgRow));
      const body = list.length ? tbl + AD.pager(pg) : tbl + empty('No organizations match', null, '<button class="btn" data-act="pdir-clear">Clear filters</button>');
      const after = () => { if (!AD.ui.pdirFocus) return; AD.ui.pdirFocus = false; const i = AD.$('#oq'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
      return out('Organizations', 'orgs', null, head + filters + body, '', after);
    },
  };

  /* =========================================================================================================
     Organization detail
     ========================================================================================================= */
  function orgHeader(o) {
    const btn = o.suspended ? '<button class="btn" data-act="porg-status-open" data-mode="reactivate">Reactivate organization</button>' : '<button class="btn danger" data-act="porg-status-open" data-mode="suspend">Suspend organization</button>';
    let h = `<div class="row" style="justify-content:space-between;align-items:flex-start;gap:16px"><div style="display:flex;flex-direction:column;gap:6px;min-width:0"><h1 tabindex="-1" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(o.name)}">${esc(o.name)}</h1><div class="row" style="gap:12px"><span class="muted mono">/o/${esc(o.slug)}</span>${statusCell(o.suspended)}</div></div><div class="row" style="gap:16px;flex:0 0 auto"><button class="btn" data-act="porg-edit-open">Edit organization</button>${btn}<a href="${AD.href('/platform/audit', { org: o.id })}" class="row" style="gap:6px;font-size:13.5px">${I.clock}View audit log</a></div></div>`;
    const s = PS().susp[o.slug];
    if (s) h += `<div class="banner warn" role="status"><span class="b-ico">${I.warn}</span><div class="grow" style="display:flex;flex-direction:column;gap:4px"><b style="font-weight:600">This organization is suspended</b><span style="font-size:13.5px">Since ${esc(s.since)} by ${esc(s.by)}. People cannot open it and no new runs start.</span><span class="muted" style="font-size:13px">Reason: ${esc(s.reason)}</span></div></div>`;
    return h;
  }
  const NOTE = '<p class="note">Platform view: names and emails only. Tickets, runs and secrets are never shown here.</p>';
  function statusDialog(o) {
    const d = AD.ui.dialog;
    const susp = d.mode === 'suspend';
    const title = (susp ? 'Suspend ' : 'Reactivate ') + o.name + '?';
    const fe = d.fieldErr;
    const verb = susp ? ['Suspend', 'Suspending…'] : ['Reactivate', 'Reactivating…'];
    return AD.dialog({
      label: title, w: 520,
      body: `<h2 style="font-size:18px">${esc(title)}</h2><p class="muted" style="font-size:13.5px">${susp ? 'People in this organization cannot open it and no new runs start. Runs already in progress finish. Nothing is deleted.' : 'People can open it again.'}</p>${d.err ? AD.errBanner(d.err) : ''}<div class="field"><label for="sr">Reason</label><textarea id="sr" class="textarea${fe ? ' bad' : ''}" rows="4" data-dlg="reason"${fe ? ' aria-invalid="true" aria-describedby="sr-e"' : ''}${d.busy ? ' readonly' : ''}>${esc(d.reason)}</textarea>${fe ? `<span id="sr-e" class="ferr" role="alert">${esc(fe)}</span>` : ''}</div>`,
      foot: `<button class="btn ghost" data-act="dialog-close"${d.busy ? ' disabled' : ''}>Cancel</button><button class="btn ${susp ? 'solid-danger' : 'primary'}" data-act="porg-status"${d.busy ? ' disabled aria-busy="true"' : ''}>${d.busy ? verb[1] : verb[0]}</button>`,
    });
  }
  const curSlug = () => AD.cur.params.invOrg;
  A['porg-status-open'] = (el) => { AD.ui.dialog = { type: 'pstatus', mode: el.dataset.mode, reason: '', busy: false, err: null, fieldErr: null }; AD.render(); setTimeout(() => { const t = AD.$('#sr'); if (t) t.focus(); }, 0); };
  A['porg-status'] = () => {
    const d = AD.ui.dialog; if (d.busy) return;
    const slug = curSlug(); const o = porg(slug);
    d.err = null; d.fieldErr = null;
    const reason = (d.reason || '').trim();
    if (!reason) d.fieldErr = 'Enter a reason.'; else if (reason.length > 500) d.fieldErr = 'Use 500 characters or fewer.';
    if (d.fieldErr) { AD.render(); return; }
    d.busy = true; AD.render();
    later(() => {
      d.busy = false;
      const f = AD.takeFail();
      if (f === '404') { AD.ui.dialog = null; AD.toast('err', 'Organization not found'); AD.nav('/platform/orgs'); return; }
      if (f) { d.err = { title: f === '403' ? "You don't have access" : 'Internal server error', reqId: AD.reqId() }; AD.render(); return; }
      const susp = d.mode === 'suspend';
      const already = susp === AD.orgIsSuspended(slug); // a repeat of the current state: 200, no change, no audit (BR-35)
      if (!already) {
        if (susp) PS().susp[slug] = { since: '22 Nov 2026', by: AD.user().name, reason }; else delete PS().susp[slug];
        AD.addAudit(slug, { k: susp ? 'suspended' : 'reactivated' }); // tenant audit, actor marked Platform admin, no reason (BR-43)
        paudit(susp ? 'suspended' : 'reactivated', { org: slug, orgName: o.name, reason });
      }
      AD.ui.dialog = null; AD.toast('ok', susp ? 'Organization suspended' : 'Organization reactivated'); AD.render(); focusH1();
    });
  };

  /* ---------- Edit organization (BR-52 to BR-62): name and URL, URL-change confirm; allowed on a suspended org ---------- */
  const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const editDirty = (d, o) => d.name !== o.name || d.slug !== o.slug;
  function editDialog(o) {
    const d = AD.ui.dialog;
    const ne = d.errors.name, se = d.errors.slug;
    const nameField = `<div class="field"><label for="en">Name</label><input id="en" class="input${ne ? ' bad' : ''}" value="${esc(d.name)}" data-dlg="name" data-on="porg-edit-in"${ne ? ' aria-invalid="true" aria-describedby="ene"' : ''}${d.busy ? ' readonly' : ''}>${ne ? `<span id="ene" class="ferr" role="alert">${esc(ne)}</span>` : ''}</div>`;
    const urlField = `<div class="field"><label for="es">URL</label><div class="prefix"${se ? ' style="border-color:var(--fail)"' : ''}><span id="esp">/o/</span><input id="es" value="${esc(d.slug)}" data-dlg="slug" data-on="porg-edit-in"${se ? ' aria-invalid="true"' : ''} aria-describedby="esp esh${se ? ' ese' : ''}"${d.busy ? ' readonly' : ''}></div><span id="esh" class="help">Links that use the old URL will show "not found".</span>${se ? `<span id="ese" class="ferr" role="alert">${esc(se)}</span>` : ''}</div>`;
    const save = d.busy ? '<button class="btn primary" disabled aria-busy="true">Saving…</button>' : `<button class="btn primary" data-act="porg-edit-save" id="pe-save"${editDirty(d, o) ? '' : ' disabled'}>Save</button>`;
    return AD.dialog({ label: 'Edit organization', w: 520, body: `<h2 style="font-size:18px">Edit organization</h2>${d.err ? AD.errBanner(d.err) : ''}${nameField}${urlField}`, foot: `<button class="btn ghost" data-act="dialog-close"${d.busy ? ' disabled' : ''}>Cancel</button>${save}` });
  }
  function slugConfirm(o) {
    const d = AD.ui.dialog;
    const m = (t) => `<span class="mono" style="color:var(--text)">${esc(t)}</span>`;
    return AD.dialog({ label: 'Change the organization URL?', w: 480, body: `<h2 style="font-size:18px">Change the organization URL?</h2><p class="muted" style="font-size:13.5px">${m('/o/' + o.slug)} becomes ${m('/o/' + d.slug.trim())}. Links that use ${m('/o/' + o.slug)} will show "not found". Share the new link with its members.</p>`, foot: '<button class="btn ghost" data-act="porg-edit-back">Cancel</button><button class="btn primary" data-act="porg-edit-confirm">Change URL</button>' });
  }
  // Save stays disabled until a value differs from the stored one (no re-render while typing, so focus stays).
  AD.inputs['porg-edit-in'] = () => { const d = AD.ui.dialog; const o = porg(curSlug()); const b = AD.$('#pe-save'); if (b && d && o) b.disabled = !editDirty(d, o); };
  A['porg-edit-open'] = () => { const o = porg(curSlug()); AD.ui.dialog = { type: 'pedit', name: o.name, slug: o.slug, errors: {}, err: null, busy: false }; AD.render(); setTimeout(() => { const i = AD.$('#en'); if (i) i.focus(); }, 0); };
  A['porg-edit-back'] = () => { AD.ui.dialog.type = 'pedit'; AD.render(); };
  function renameOrg(oldSlug, newSlug, name) {
    const o = porg(oldSlug);
    o.name = name;
    if (newSlug === oldSlug) return;
    for (const key of ['members', 'projects', 'audit', 'invites', 'checklist']) {
      if (AD.state[key] && AD.state[key][oldSlug] !== undefined) { AD.state[key][newSlug] = AD.state[key][oldSlug]; delete AD.state[key][oldSlug]; }
    }
    for (const key of ['ids', 'meta', 'susp']) { const m = PS()[key]; if (m[oldSlug] !== undefined) { m[newSlug] = m[oldSlug]; delete m[oldSlug]; } }
    PS().audit.forEach((e) => { if (e.org === oldSlug) e.org = newSlug; });
    o.slug = newSlug; // the old /o/<old-slug> now resolves to nothing (not found), and the old slug is free (BR-58)
  }
  function editSave() {
    const d = AD.ui.dialog; const slug = curSlug(); const o = porg(slug);
    d.busy = true; d.type = 'pedit'; AD.render();
    later(() => {
      d.busy = false;
      const f = AD.takeFail();
      if (f === '404') { AD.ui.dialog = null; AD.toast('err', 'Organization not found'); AD.nav('/platform/orgs'); return; }
      if (f) { d.err = { title: f === '403' ? "You don't have access" : 'Internal server error', reqId: AD.reqId() }; AD.render(); return; }
      const name = d.name.trim(); const newSlug = d.slug.trim();
      if (newSlug !== o.slug && allOrgs().some((x) => x.slug === newSlug)) { d.errors = { slug: 'This URL is taken. Try another.' }; AD.render(); setTimeout(() => { const i = AD.$('#es'); if (i) i.focus(); }, 0); return; }
      const changes = [];
      if (name !== o.name) changes.push(['name', o.name, name]);
      if (newSlug !== o.slug) changes.push(['slug', o.slug, newSlug]);
      const oldName = o.name; const oldSlug = o.slug;
      if (changes.length) { // equal values: 200, no change, no audit (BR-59)
        renameOrg(oldSlug, newSlug, name);
        // the org's own audit, marked Platform admin (BR-61); platform audit, one entry with old and new values (BR-60)
        if (name !== oldName) AD.addAudit(newSlug, { k: 'name', from: oldName, to: name });
        if (newSlug !== oldSlug) AD.addAudit(newSlug, { k: 'url', from: '/o/' + oldSlug, to: '/o/' + newSlug });
        paudit('updated', { org: newSlug, orgName: oldName, changes });
      }
      AD.ui.dialog = null; AD.toast('ok', 'Organization updated'); AD.render(); focusH1();
    });
  }
  A['porg-edit-save'] = () => {
    const d = AD.ui.dialog; if (d.busy) return; const o = porg(curSlug());
    d.err = null; d.errors = {};
    const name = (d.name || '').trim(); const slug = (d.slug || '').trim();
    if (!name) d.errors.name = 'Enter a name.'; else if (name.length > 100) d.errors.name = 'Use 100 characters or fewer.';
    if (!SLUG_RE.test(slug)) d.errors.slug = 'Use lowercase letters, numbers and dashes, with no dash at the start or end.';
    if (d.errors.name || d.errors.slug) { AD.render(); setTimeout(() => { const i = AD.$(d.errors.name ? '#en' : '#es'); if (i) i.focus(); }, 0); return; }
    if (slug !== o.slug) { d.type = 'pedit-confirm'; AD.render(); return; } // BR-57: confirm a URL change first
    editSave();
  };
  A['porg-edit-confirm'] = () => editSave();

  /* ---------- Members: assignments ---------- */
  const roleList = (m) => (m.role ? [{ scope: 'org', role: AD.roleLabel(m.role), label: AD.roleLabel(m.role) + ' (organization)' }] : []).concat(m.projects.map((p) => ({ scope: p.name, role: p.role, label: p.role + ' (' + p.name + ')' })));
  function memberRow(m, slug) {
    const label = m.name || m.handle;
    const id = 'pm-' + m.uid;
    const open = AD.ui.menu === 'row:' + id;
    const roles = roleList(m);
    const d = AD.ui.dialog;
    const busy = d && d.type === 'premove' && d.busy && d.uid === m.uid;
    const it = (act, txt, scope, danger) => `<button class="btn ghost" role="menuitem" data-act="${act}" data-uid="${esc(m.uid)}" data-scope="${esc(scope || '')}" style="justify-content:flex-start;width:100%;color:var(${danger ? '--fail' : '--text'})">${esc(txt)}</button>`;
    const menu = open ? `<div class="pop" role="menu" aria-label="Actions for ${esc(label)}" style="right:12px;top:calc(100% - 4px);width:260px;padding:6px;gap:2px;text-align:left">${it('pm-assign-open', 'Add assignment')}${roles.length ? '<div role="separator" style="height:1px;background:var(--line);margin:4px 0"></div>' : ''}${roles.map((r) => it('pm-remove-open', 'Remove ' + r.label, r.scope, true)).join('')}</div>` : '';
    const name = m.name ? `<span class="row" style="gap:8px;min-width:0"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;min-width:0" title="${esc(m.name)}">${esc(m.name)}</span><span class="muted mono" style="white-space:nowrap;flex:0 0 auto">${esc(m.handle)}</span></span>` : `<span class="mono" style="font-weight:500;white-space:nowrap">${esc(m.handle)}</span>`;
    return `<tr${busy ? ' aria-busy="true"' : ''}><td>${name}</td><td>${span(memberEmail(m, slug), 'font-size:13px')}</td><td>${roles.length ? span(roles.map((r) => r.label).join(', '), 'font-size:13px;color:var(--muted)') : DASH}</td><td style="text-align:right;position:relative"><button class="btn ghost iconbtn" data-act="rowmenu" data-id="${id}" aria-label="Actions for ${esc(label)}" aria-haspopup="menu" aria-expanded="${open}"${busy ? ' disabled' : ''}>${I.dots}</button>${menu}</td></tr>`;
  }
  const radio = (on, txt, val) => `<div class="radio-card${on ? ' on' : ''}" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-act="pa-mode" data-v="${val}" data-live style="cursor:pointer"><span class="rdot"></span><b style="font-weight:500">${txt}</b></div>`;
  function assignDialog(slug) {
    const d = AD.ui.dialog;
    const m = (AD.state.members[slug] || []).find((x) => x.uid === d.uid); if (!m) return '';
    const projects = (AD.state.projects[slug] || []).map((p) => p.id);
    const roles = d.mode === 'org' ? ['Owner', 'Admin', 'Member', 'Viewer'] : ['Admin', 'Member', 'Viewer'];
    const proj = d.mode === 'project' ? `<label for="ap" style="${SR}">Project</label><select id="ap" class="input mono" data-dlg="project">${projects.map((p) => `<option${p === d.project ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>` : '';
    return AD.dialog({
      label: 'Add assignment', w: 520,
      body: `<h2 style="font-size:18px">Add assignment</h2><p class="muted" style="font-size:13.5px">${esc(m.name || m.handle)}${m.name ? ` <span class="mono">${esc(m.handle)}</span>` : ''}</p>${d.err ? AD.errBanner(d.err) : ''}<div class="field"><label for="ar">Role</label><select id="ar" class="input" data-dlg="role">${roles.map((r) => `<option${r === d.role ? ' selected' : ''}>${r}</option>`).join('')}</select></div><div class="field"><span class="flabel" id="aacc">Access</span><div role="radiogroup" aria-labelledby="aacc" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${radio(d.mode === 'org', 'Whole organization', 'org')}${projects.length ? radio(d.mode === 'project', 'One project', 'project') : ''}</div>${proj}</div>`,
      foot: `<button class="btn ghost" data-act="dialog-close"${d.busy ? ' disabled' : ''}>Cancel</button><button class="btn primary" data-act="pm-assign"${d.busy ? ' disabled aria-busy="true"' : ''}>${d.busy ? 'Adding…' : 'Add assignment'}</button>`,
    });
  }
  function removeDialog(slug) {
    const d = AD.ui.dialog;
    const m = (AD.state.members[slug] || []).find((x) => x.uid === d.uid); if (!m) return '';
    const r = roleList(m).find((x) => x.scope === d.scope); if (!r) return '';
    const title = `Remove ${r.role} from ${m.name || m.handle}?`;
    return AD.dialog({ label: title, w: 480, body: `<h2 style="font-size:18px">${esc(title)}</h2>${d.err ? AD.errBanner(d.err) : ''}`, foot: `<button class="btn ghost" data-act="dialog-close"${d.busy ? ' disabled' : ''}>Cancel</button><button class="btn solid-danger" data-act="pm-remove"${d.busy ? ' disabled aria-busy="true"' : ''}>${d.busy ? 'Removing…' : 'Remove'}</button>` });
  }
  A['pa-mode'] = (el) => { const d = AD.ui.dialog; d.mode = el.dataset.v; if (d.mode === 'project' && d.role === 'Owner') d.role = 'Member'; AD.render(); };
  A['pm-assign-open'] = (el) => { const slug = curSlug(); AD.ui.menu = null; AD.ui.dialog = { type: 'passign', uid: el.dataset.uid, role: 'Member', mode: 'org', project: ((AD.state.projects[slug] || [])[0] || {}).id, busy: false, err: null }; AD.render(); };
  A['pm-remove-open'] = (el) => { AD.ui.menu = null; AD.ui.dialog = { type: 'premove', uid: el.dataset.uid, scope: el.dataset.scope, busy: false, err: null }; AD.render(); };
  const fail = (d, f) => { d.err = { title: f === '403' ? "You don't have access" : 'Internal server error', reqId: AD.reqId() }; AD.render(); };
  A['pm-assign'] = () => {
    const d = AD.ui.dialog; if (d.busy) return; d.busy = true; AD.render();
    later(() => {
      d.busy = false;
      const f = AD.takeFail(); if (f) { fail(d, f); return; }
      const slug = curSlug(); const m = AD.state.members[slug].find((x) => x.uid === d.uid);
      if (d.mode === 'org') m.role = d.role.toLowerCase();
      else { m.projects = m.projects.filter((p) => p.name !== d.project).concat({ name: d.project, role: d.role }); }
      paudit('assign-added', { org: slug, orgName: porg(slug).name, member: m.name || m.handle, role: d.role, project: d.mode === 'project' ? d.project : undefined });
      AD.ui.dialog = null; AD.toast('ok', 'Assignment added'); AD.render();
    });
  };
  A['pm-remove'] = () => {
    const d = AD.ui.dialog; if (d.busy) return; d.busy = true; AD.render();
    later(() => {
      d.busy = false;
      const f = AD.takeFail(); if (f) { fail(d, f); return; }
      const slug = curSlug(); const m = AD.state.members[slug].find((x) => x.uid === d.uid);
      const r = roleList(m).find((x) => x.scope === d.scope);
      if (d.scope === 'org') m.role = null; else m.projects = m.projects.filter((p) => p.name !== d.scope);
      // The last owner may be removed on platform routes; the directory then shows "No owner yet" (BR-28).
      paudit('assign-removed', { org: slug, orgName: porg(slug).name, member: m.name || m.handle, role: r.role, project: d.scope === 'org' ? undefined : d.scope });
      AD.ui.dialog = null; AD.toast('ok', 'Assignment removed'); AD.render();
    });
  };

  AD.screens['platform.org'] = {
    title: 'Organization',
    snaps: (ctx) => {
      const tab = ctx.params.tab || 'overview';
      const re = { overview: /^PlatformOrg(Overview|Edit)/, projects: /^PlatformOrgProjects/, members: /^PlatformOrgMembers/, invitations: /^PlatformOrgInvitations/ }[tab] || /^PlatformOrg[A-Z]/;
      return AD.snapGroup(AD.boardNames(re));
    },
    render(ctx) {
      const tab = ctx.params.tab;
      const slug = slugOf(ctx.params.orgId);
      ctx.params.invOrg = slug; // the shared invitation actions and the org actions read the org from here
      const o = slug ? info(slug) : null;
      const g = gate(ctx, tab, o); if (g) return g;
      if (!o || !['overview', 'projects', 'members', 'invitations'].includes(tab)) {
        return out('Page not found', 'orgs', null, `<div style="flex:1;display:flex;justify-content:center;padding:72px 0"><div style="width:100%;max-width:760px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center"><h1 style="font-size:28px">Page not found</h1><p class="muted" style="font-size:15px;max-width:56ch">This organization does not exist.</p><div class="row" style="gap:12px;margin-top:10px;justify-content:center"><a href="${AD.href('/platform/orgs')}" class="btn">Back to organizations</a></div></div></div>`);
      }
      const d = AD.ui.dialog;
      let overlay = d && d.type === 'pstatus' ? statusDialog(o) : d && d.type === 'pedit' ? editDialog(o) : d && d.type === 'pedit-confirm' ? slugConfirm(o) : '';
      const head = orgHeader(o);
      const forceEmpty = ctx.scen === 'empty';
      let main;
      if (tab === 'overview') {
        const owner = o.owner ? `<span class="row" style="gap:8px">${esc(o.owner.name || o.owner.handle)}${o.owner.name ? `<span class="muted mono">${esc(o.owner.handle)}</span>` : ''}</span>` : '<span class="faint">No owner yet</span>';
        const kv = [['Slug', `<span class="mono">/o/${esc(o.slug)}</span>`], ['Owner', owner], ['Members', `<span class="num">${o.members}</span>`], ['Projects', `<span class="num">${o.projects}</span>`], ['Last activity', o.last ? AD.time(o.last) : '<span class="faint">No activity yet</span>'], ['Created', AD.time(Object.assign({}, o.created, { rel: o.created.title.split(',')[0] }))], ['Status', statusCell(o.suspended)]];
        main = head + '<h2>Overview</h2>' + `<dl class="kv" style="max-width:620px">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
      } else if (tab === 'projects') {
        const list = forceEmpty ? [] : AD.state.projects[slug] || [];
        const pg = AD.slice(list, Number(ctx.q.page) || 1);
        main = head + '<div class="row" style="justify-content:space-between"><h2>Projects</h2></div>' + (list.length ? table(['44%', ''], ['Id', 'Name'], pg.rows.map((p) => `<tr><td><span class="mono" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(PROJECT_IDS[p.id] || p.id)}</span></td><td>${span(p.id)}</td></tr>`)) + AD.pager(pg) : empty('No projects'));
      } else if (tab === 'members') {
        const list = forceEmpty ? [] : AD.state.members[slug] || [];
        const pg = AD.slice(list, Number(ctx.q.page) || 1);
        main = head + '<div class="row" style="justify-content:space-between"><h2>Members</h2></div>' + NOTE + (list.length ? table(['32%', '26%', '', '56px'], ['Name', 'Email', 'Roles', ACTIONS_TH], pg.rows.map((m) => memberRow(m, slug))) + AD.pager(pg) : empty('No members'));
        if (d && d.type === 'passign') overlay = assignDialog(slug);
        if (d && d.type === 'premove') overlay = removeDialog(slug);
      } else {
        const ictx = Object.assign({}, ctx, { orgSlug: slug, perm: { orgAdmin: true, giveOwner: true, adminProjects: [] }, invEmpty: 'No invitations' });
        if (forceEmpty) AD.state.invites[slug] = AD.state.invites[slug] || [];
        const parts = AD.invitationsParts(forceEmpty ? Object.assign(ictx, { q: Object.assign({}, ctx.q, { status: 'pending' }) }) : ictx);
        const body = forceEmpty ? empty('No invitations', null, `<button class="btn" data-act="inv-open">${I.plus}Invite people</button>`) : parts.body;
        main = head + `<div class="row" style="justify-content:space-between"><h2>Invitations</h2><button class="btn primary" data-act="inv-open">${I.plus}Invite people</button></div>` + NOTE + parts.chips + body;
        if (!overlay) overlay = parts.overlay;
      }
      return out(o.name, tab, o, main, overlay);
    },
  };

  /* =========================================================================================================
     Platform audit
     ========================================================================================================= */
  AD.inputs['paud-action'] = (t) => AD.setQuery({ action: t.value || null, page: null });
  A['paud-chip-x'] = () => AD.setQuery({ org: null, page: null });
  A['paud-clear'] = () => AD.setQuery({ action: null, page: null });
  function audRow(e) {
    const t = paudText(e);
    const who = e.actor.deleted ? '<span class="faint">Deleted user</span>' : span(e.actor.name);
    const what = `<span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px" title="${esc(t.title)}">${t.html}</span>${e.reason ? `<span class="note" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px" title="Reason: ${esc(e.reason)}">Reason: ${esc(e.reason)}</span>` : ''}`;
    return `<tr><td class="muted" style="font-size:13px;white-space:nowrap">${AD.time(e.time)}</td><td style="font-size:13px">${who}</td><td>${what}</td></tr>`;
  }
  AD.screens['platform.audit'] = {
    title: 'Audit log',
    snaps: snaps(/^PlatformAudit/),
    render(ctx) {
      const g = gate(ctx, 'audit'); if (g) return g;
      const action = ACTIONS.some(([k]) => k === ctx.q.action) ? ctx.q.action : '';
      const orgId = ctx.q.org || null;
      const orgSlug = orgId ? slugOf(orgId) : null;
      const chipText = orgId ? (orgSlug ? 'Organization: ' + porg(orgSlug).name : 'Unknown organization') : '';
      const chip = orgId ? `<span class="fchip on" style="cursor:default;padding-right:4px">${esc(chipText)}<button class="btn ghost iconbtn sm" data-act="paud-chip-x" aria-label="Remove filter ${esc(chipText)}" style="width:22px;height:22px;padding:0">${I.x}</button></span>` : '';
      const filters = `<div class="row" style="gap:8px;flex-wrap:wrap"><label for="aa" style="${SR}">Action</label><select id="aa" class="input" data-on="paud-action" style="width:220px"><option value=""${!action ? ' selected' : ''}>All actions</option>${ACTIONS.map(([k, l]) => `<option value="${k}"${k === action ? ' selected' : ''}>${l}</option>`).join('')}</select>${chip}</div>`;
      const all = ctx.scen === 'empty' ? [] : PS().audit;
      const list = orgId && !orgSlug ? [] : all.filter((e) => (!action || e.k === action) && (!orgSlug || e.org === orgSlug));
      const pg = AD.slice(list, Number(ctx.q.page) || 1);
      const tbl = table(['14%', '20%', ''], ['When', 'Who', 'What'], pg.rows.map(audRow));
      const body = list.length ? tbl + AD.pager(pg) : action ? tbl + empty('No audit entries match', null, '<button class="btn" data-act="paud-clear">Clear filters</button>') : empty('No audit entries');
      return out('Audit log', 'audit', null, '<h1 tabindex="-1">Audit log</h1>' + filters + body);
    },
  };

  /* =========================================================================================================
     Tenant side: "This organization is suspended" (BR-37, BR-49); the org bar keeps the switcher (BR-48, BR-51)
     ========================================================================================================= */
  AD.screens.orgsuspended = {
    title: 'Organization suspended',
    snaps: snaps(/^OrgSuspended/),
    render(ctx) {
      const s = ctx.scen;
      if (s !== 'live' && AD.B[s]) return AD.boardOut(s);
      const name = ctx.org ? ctx.org.name : ctx.orgSlug;
      return { header: 'global', h: 900, title: 'This organization is suspended', html: `<main style="flex:1;display:flex;justify-content:center;padding:96px 40px"><div style="width:100%;max-width:760px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center"><h1 style="font-size:28px">This organization is suspended</h1><p class="muted" style="font-size:15px;max-width:56ch">You can't open ${esc(name)} right now. Contact your Agent Desk administrator.</p></div></main>` };
    },
  };
})();
