/* Settings, Invitations tab: filter, table, invite dialog, copy link, resend, revoke.
   Built from OrgInvitationsSettings* and OrgInvitations* boards (slice 2 behaviour, now inside the Settings layout). */
(function () {
  'use strict';
  const AD = window.AD;
  const esc = AD.esc;
  const I = AD.I;
  const MAIN = AD.MAIN;
  const LINK = (id) => 'https://agentdesk.example/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43';
  const FILTERS = [['pending', 'Pending'], ['accepted', 'Accepted'], ['declined', 'Declined'], ['revoked', 'Revoked'], ['expired', 'Expired'], ['all', 'All']];
  const ST = {
    pending: ['st-queued', I.stQueued, 'Pending'],
    accepted: ['st-succeeded', '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.2l2.2 2.2 4.2-4.6" fill="none" stroke="#0F1A13" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>', 'Accepted'],
    declined: ['st-cancelled', '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 12 12 4" stroke="currentColor" stroke-width="1.6"/></svg>', 'Declined'],
    revoked: ['st-cancelled', '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>', 'Revoked'],
    expired: ['st-timed_out', '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.6V8.3l2.4 1.5" fill="none" stroke="#1F130A" stroke-width="1.7" stroke-linecap="round"/></svg>', 'Expired'],
  };
  const span = (t, s) => `<span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${s || ''}" title="${esc(t)}">${esc(t)}</span>`;

  function visibleInvites(ctx) {
    const all = AD.state.invites[ctx.orgSlug] || [];
    const me = ctx.perm;
    if (me.orgAdmin) return all;
    // Project admin: only invitations that give access to one of their projects.
    return all.filter((i) => i.access && i.access.some((p) => me.adminProjects.includes(p)));
  }

  function row(ctx, i) {
    const menuId = 'row:' + i.id;
    const canMenu = i.status === 'pending' || i.status === 'expired';
    let menu = '';
    if (AD.ui.menu === menuId && canMenu) {
      const it = (act, txt, color) => `<button class="btn ghost" role="menuitem" data-act="${act}" data-id="${i.id}" style="justify-content:flex-start;width:100%;color:${color || 'var(--text)'}">${txt}</button>`;
      menu = `<div class="pop" role="menu" aria-label="Actions for ${esc(i.email)}" style="right:12px;top:calc(100% - 4px);width:180px;padding:6px;gap:2px;text-align:left">${i.status === 'pending' ? it('inv-copy', 'Copy link') + it('inv-resend', 'Resend') + it('inv-revoke-open', 'Revoke', 'var(--fail)') : it('inv-resend', 'Resend')}</div>`;
    }
    const st = ST[i.status];
    const exp = i.exp ? `<td class="muted" style="font-size:13px">${AD.time(i.exp)}</td>` : '<td class="muted" style="font-size:13px"><span class="faint">—</span></td>';
    const busy = AD.ui.busyInv === i.id;
    return `<tr${busy ? ' aria-busy="true"' : ''}><td>${span(i.email, 'font-weight:500')}</td><td style="font-size:13px">${esc(i.role)}</td><td>${(() => { const a = i.access ? i.access.join(', ') : 'Whole organization'; return span(a, 'font-size:13px;color:var(--muted)'); })()}</td><td><span class="st ${st[0]}">${st[1]}${st[2]}</span></td>${exp}<td style="font-size:13px">${i.by ? `<span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.by)}</span>` : '<span class="faint">—</span>'}</td><td style="text-align:right;position:relative">${canMenu ? `<button class="btn ghost iconbtn" data-act="rowmenu" data-id="${i.id}" aria-label="Actions for ${esc(i.email)}" aria-haspopup="menu" aria-expanded="${AD.ui.menu === menuId}"${busy ? ' disabled' : ''}>${I.dots}</button>${menu}` : ''}</td></tr>`;
  }

  /* ---------- dialogs ---------- */
  const radio = (on, txt, act, val) => `<div class="radio-card${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-act="${act}" data-v="${val}" data-live style="cursor:pointer"><span class="rdot"></span><b style="font-weight:500">${txt}</b></div>`;
  function inviteDialog(ctx) {
    const d = AD.ui.dialog; const me = ctx.perm;
    const roles = me.giveOwner ? ['Owner', 'Admin', 'Member', 'Viewer'] : ['Admin', 'Member', 'Viewer'];
    const projects = me.orgAdmin ? (AD.state.projects[ctx.orgSlug] || []).map((p) => p.id) : me.adminProjects;
    const projOnly = !me.orgAdmin; // project admins can only invite to some projects
    if (projOnly) d.mode = 'projects';
    const emailErr = d.fieldErr;
    const err = d.err ? AD.errBanner(d.err) : '';
    const access = projOnly
      ? `<div class="field"><span class="flabel">Access</span><span class="help">Some projects</span>${projList(d, projects)}</div>`
      : `<div class="field"><span class="flabel" id="iacc">Access</span><div role="radiogroup" aria-labelledby="iacc" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${radio(d.mode === 'org', 'Whole organization', 'inv-mode', 'org')}${radio(d.mode === 'projects', 'Some projects', 'inv-mode', 'projects')}</div>${d.mode === 'projects' ? projList(d, projects) : ''}</div>`;
    return AD.dialog({
      label: 'Invite people', w: 520,
      body: `<h2 style="font-size:18px">Invite people</h2>${err}<div class="field"><label for="ie">Email</label><input id="ie" class="input${emailErr ? ' bad' : ''}" value="${esc(d.email)}" data-dlg="email"${emailErr ? ' aria-invalid="true" aria-describedby="iee"' : ''}${d.busy ? ' readonly' : ''}>${emailErr ? `<span id="iee" class="ferr" role="alert">${esc(emailErr)}</span>` : ''}</div><div class="field"><label for="ir">Role</label><select id="ir" class="input" data-dlg="role">${roles.map((r) => `<option${r === d.role ? ' selected' : ''}>${r}</option>`).join('')}</select></div>${access}`,
      foot: `<button class="btn ghost" data-act="dialog-close"${d.busy ? ' disabled' : ''}>Cancel</button><button class="btn primary" data-act="inv-create"${d.busy ? ' disabled aria-busy="true"' : ''}>${d.busy ? 'Creating…' : 'Create invitation'}</button>`,
    });
  }
  function projList(d, projects) {
    return `<div role="group" aria-label="Projects" style="display:flex;flex-direction:column;gap:8px;padding:4px 2px">${projects.map((p) => { const on = d.projects.includes(p); return `<label class="row" style="gap:10px;font-size:13.5px;cursor:pointer" data-act="inv-proj" data-v="${esc(p)}"><span class="cbx${on ? ' on' : ''}" role="checkbox" aria-checked="${on}" data-live>${on ? I.check11 : ''}</span><span class="mono">${esc(p)}</span></label>`; }).join('')}</div>`;
  }
  function createdDialog(ctx) {
    const d = AD.ui.dialog;
    return AD.dialog({ label: 'Invitation created', w: 560, body: `<h2 style="font-size:18px">Invitation created</h2><p class="muted" style="font-size:13.5px">Send this link to ${esc(d.email)}. It works only for that email and expires on 23 Nov, ${esc(d.time)}.</p><div class="field"><label for="ilink">Invitation link</label><div class="row" style="gap:8px"><input id="ilink" class="input mono" readonly value="${LINK()}"><button class="btn" data-act="inv-copy-created">${I.copy}Copy link</button></div></div>`, foot: `<button class="btn primary" data-act="dialog-close">Done</button>` });
  }
  function revokeDialog(ctx) {
    const d = AD.ui.dialog; const i = (AD.state.invites[ctx.orgSlug] || []).find((x) => x.id === d.id); if (!i) return '';
    return AD.dialog({ label: `Revoke invitation for ${i.email}?`, w: 480, body: `<h2 style="font-size:18px">Revoke invitation for ${esc(i.email)}?</h2><p class="muted" style="font-size:13.5px">The link stops working.</p>`, foot: `<button class="btn ghost" data-act="dialog-close"${d.busy ? ' disabled' : ''}>Cancel</button><button class="btn solid-danger" data-act="inv-revoke"${d.busy ? ' disabled aria-busy="true"' : ''}>${d.busy ? 'Revoking…' : 'Revoke'}</button>` });
  }
  function linkDialog() {
    return AD.dialog({ label: 'Invitation link', w: 520, body: `<h2 style="font-size:18px">Invitation link</h2><div class="field"><label for="plink">Invitation link</label><input id="plink" class="input mono" readonly value="${LINK()}"></div>`, foot: `<button class="btn primary" data-act="dialog-close">Done</button>` });
  }

  /* ---------- actions ---------- */
  const slug = () => AD.cur.params.org;
  function copy(text) {
    const done = () => AD.toast('ok', 'Link copied');
    const failed = () => { AD.toast('err', 'Could not copy. Select the link and copy it.'); AD.ui.menu = null; AD.ui.dialog = { type: 'link' }; AD.render(); };
    try {
      if (AD.ui.fail === 'copy') { AD.ui.fail = 'none'; failed(); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, failed); else failed();
    } catch (e) { failed(); }
  }
  const A = AD.acts;
  A['inv-filter'] = (el) => AD.setQuery({ status: el.dataset.status === 'pending' ? null : el.dataset.status, page: null });
  A['inv-open'] = () => { AD.ui.dialog = { type: 'invite', email: '', role: 'Member', mode: 'org', projects: [], busy: false, err: null, fieldErr: null }; AD.render(); };
  A['inv-mode'] = (el) => { AD.ui.dialog.mode = el.dataset.v; AD.render(); };
  A['inv-proj'] = (el, e) => { e.preventDefault(); const d = AD.ui.dialog; const v = el.dataset.v; d.projects = d.projects.includes(v) ? d.projects.filter((x) => x !== v) : d.projects.concat(v); AD.render(); };
  A['inv-create'] = () => {
    const d = AD.ui.dialog; const s = slug(); if (d.busy) return;
    d.err = null; d.fieldErr = null;
    const email = (d.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { d.fieldErr = 'Enter a valid email address.'; AD.render(); return; }
    if (d.mode === 'projects' && !d.projects.length) { d.fieldErr = null; d.err = { title: 'Pick at least one project' }; AD.render(); return; }
    d.busy = true; AD.render();
    setTimeout(() => {
      const r = AD.api.invite(s, email, d.role.toLowerCase(), d.mode === 'org' ? null : d.projects);
      d.busy = false;
      if (r.field) { d.fieldErr = r.field; AD.render(); return; }
      if (r.err && r.err.toast) { AD.toast('err', r.err.title); AD.render(); return; }
      if (r.err) { d.err = r.err; AD.render(); return; }
      const t = AD.nowLabel();
      AD.ui.dialog = { type: 'created', email, time: t.title.slice(-5) };
      AD.render();
    }, 600);
  };
  A['inv-copy-created'] = () => copy(LINK());
  A['inv-copy'] = () => { AD.ui.menu = null; AD.render(); copy(LINK()); };
  A['inv-resend'] = (el) => {
    const id = el.dataset.id; AD.ui.menu = null; AD.ui.busyInv = id; AD.render();
    setTimeout(() => {
      const r = AD.api.resend(slug(), id);
      AD.ui.busyInv = null;
      if (r.err) AD.toast('err', r.err.title); else AD.toast('ok', 'Invitation renewed. It now expires on 23 Nov, 15:02.');
      AD.render();
    }, 700);
  };
  A['inv-revoke-open'] = (el) => { AD.ui.menu = null; AD.ui.dialog = { type: 'revoke', id: el.dataset.id, busy: false }; AD.render(); };
  A['inv-revoke'] = () => {
    const d = AD.ui.dialog; if (d.busy) return; d.busy = true; AD.render();
    setTimeout(() => {
      const r = AD.api.revoke(slug(), d.id); AD.ui.dialog = null;
      if (r.err) AD.toast('err', r.err.title); else AD.toast('ok', 'Invitation revoked');
      AD.render();
    }, 600);
  };

  /* ---------- screen ---------- */
  AD.screens['settings.invitations'] = {
    title: 'Settings, Invitations',
    snaps: () => AD.snapGroup(AD.boardNames(/^OrgInvitations/)),
    render(ctx) {
      if (ctx.scen !== 'live' && AD.B[ctx.scen]) return AD.boardOut(ctx.scen);
      if (!ctx.perm.invitations) return AD.settingsForbidden(ctx, 'invitations');
      const std = AD.settingsStd(ctx, 'invitations', { empty: null });
      if (std) return std;
      const status = FILTERS.some(([id]) => id === ctx.q.status) ? ctx.q.status : 'pending';
      const vis = visibleInvites(ctx);
      const list = status === 'all' ? vis : vis.filter((i) => i.status === status);
      const forceEmpty = ctx.scen === 'empty';
      const items = forceEmpty ? [] : list;
      const pg = AD.slice(items, Number(ctx.q.page) || 1);
      const chips = FILTERS.map(([id, label]) => `<button class="fchip${id === status ? ' on' : ''}" aria-pressed="${id === status}" data-act="inv-filter" data-status="${id}" data-live>${label}</button>`).join('');
      const head = `<div class="row" style="justify-content:space-between"><h1>Invitations</h1><button class="btn primary" data-act="inv-open">${I.plus}Invite people</button></div><div class="filters" role="group" aria-label="Filter by status">${chips}</div>`;
      let body;
      if (!items.length) {
        const label = status === 'all' ? 'No invitations yet' : 'No ' + status + ' invitations';
        body = `<table style="table-layout:fixed"><colgroup><col style="width:27%"><col style="width:9%"><col style="width:19%"><col style="width:11%"><col style="width:14%"><col style="width:13%"><col style="width:56px"></colgroup><thead><tr><th>Email</th><th>Role</th><th>Access</th><th>Status</th><th>Expires</th><th>Invited by</th><th><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Actions</span></th></tr></thead><tbody></tbody></table><div style="display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:40px 16px"><h3>${label}</h3>${status === 'pending' ? `<div style="margin-top:6px"><button class="btn" data-act="inv-open">${I.plus}Invite people</button></div>` : ''}</div>`;
      } else {
        body = `<table style="table-layout:fixed"><colgroup><col style="width:27%"><col style="width:9%"><col style="width:19%"><col style="width:11%"><col style="width:14%"><col style="width:13%"><col style="width:56px"></colgroup><thead><tr><th>Email</th><th>Role</th><th>Access</th><th>Status</th><th>Expires</th><th>Invited by</th><th><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Actions</span></th></tr></thead><tbody>${pg.rows.map((i) => row(ctx, i)).join('')}</tbody></table>${AD.pager(pg)}`;
      }
      const d = AD.ui.dialog;
      const overlay = !d ? '' : d.type === 'invite' ? inviteDialog(ctx) : d.type === 'created' ? createdDialog(ctx) : d.type === 'revoke' ? revokeDialog(ctx) : d.type === 'link' ? linkDialog() : '';
      return AD.settingsOut(ctx, 'invitations', `<main style="${MAIN}">${head}${body}</main>`, overlay);
    },
  };
})();
