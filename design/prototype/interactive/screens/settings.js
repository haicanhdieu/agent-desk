/* Settings area: layout with the "Organization" side menu, General, Members, Audit log.
   Built from OrgGeneral*, OrgMembers*, OrgAudit* boards. Spec: 2026-11-22-org-tenant-admin-design.md. */
(function () {
  'use strict';
  const AD = window.AD;
  const esc = AD.esc;
  const I = AD.I;
  const MAIN = 'flex:1;min-width:0;padding:24px 40px;overflow:hidden;display:flex;flex-direction:column;gap:20px';
  AD.MAIN = MAIN;

  /* ---------- layout ---------- */
  const TABS = [['general', 'General', I.sliders], ['members', 'Members', I.people], ['invitations', 'Invitations', I.envelope15], ['audit', 'Audit log', I.clock]];
  AD.settingsLayout = function (ctx, tab, mainHtml, overlay) {
    const p = ctx.perm;
    const links = TABS.filter(([id]) => AD.settingsTabAllowed(p, id)).map(([id, label, icon]) => `<a href="${AD.href('/o/' + ctx.orgSlug + '/settings/' + id)}" class="${id === tab ? 'on' : ''}"${id === tab ? ' aria-current="page"' : ''}>${icon}${label}</a>`).join('');
    return `<div style="flex:1;display:flex;min-height:0"><nav class="subnav" aria-label="Organization settings"><div class="grp-h" style="padding-top:2px">Organization</div>${links}</nav>${mainHtml}</div>${overlay || ''}`;
  };
  // Wrap a stateful main in the layout, or the forbidden state when this persona may not see the tab.
  AD.settingsOut = function (ctx, tab, mainHtml, overlay) {
    return { header: 'global', h: 900, title: 'Settings', html: AD.settingsLayout(ctx, tab, mainHtml, overlay) };
  };
  AD.settingsForbidden = function (ctx, tab) {
    const p = ctx.perm;
    // A person with at least one tab sees the no-access state inside the layout; members and viewers under the top bar only.
    if (AD.settingsFirstTab(p)) return AD.settingsOut(ctx, tab, AD.forbiddenMain);
    return { header: 'global', h: 900, title: 'No access', html: AD.forbiddenMain };
  };

  // Shared handling of the standard scenarios inside the layout. Returns an out, or null to continue with the live view.
  AD.settingsStd = function (ctx, tab, o) {
    const s = ctx.scen;
    if (s === 'forbidden') return AD.settingsForbidden(ctx, tab);
    if (s === 'loading') return AD.settingsOut(ctx, tab, AD.loadingMain());
    if (s === 'error') return AD.settingsOut(ctx, tab, AD.errorMain());
    if (s === 'crash') return AD.boardOut('RouteError');
    if (s === 'empty' && o && o.empty) return AD.settingsOut(ctx, tab, o.empty);
    if (AD.B[s]) return AD.boardOut(s);
    return null;
  };

  AD.screens['settingsindex'] = {
    title: 'Settings',
    render(ctx) {
      const first = AD.settingsFirstTab(ctx.perm);
      if (!first) return AD.settingsForbidden(ctx, 'general');
      AD.nav('/o/' + ctx.orgSlug + '/settings/' + first, {}, { replace: true });
      return { header: 'global', html: '', h: 900 };
    },
  };
  // Old standalone Invitations URL: redirect to the Settings tab and keep filter and page (BR-13).
  AD.screens['legacyinvites'] = {
    title: 'Invitations',
    render(ctx) {
      const q = {}; if (ctx.q.status) q.status = ctx.q.status; if (ctx.q.page && ctx.q.page !== '1') q.page = ctx.q.page;
      AD.nav('/o/' + ctx.orgSlug + '/settings/invitations', q, { replace: true });
      return { header: 'global', html: '', h: 900 };
    },
  };

  const settingsSnaps = (re) => AD.snapGroup(AD.boardNames(re));

  /* ---------- General ---------- */
  const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  function generalForm(ctx) {
    const o = AD.org(ctx.orgSlug);
    const f = AD.ui.form && AD.ui.form.owner === 'general' ? AD.ui.form : (AD.ui.form = { owner: 'general', name: o.name, slug: o.slug, errors: {}, saving: false, banner: null });
    const changed = f.name !== o.name || f.slug !== o.slug;
    const nameErr = f.errors.name, slugErr = f.errors.slug;
    const banner = f.banner ? `<div style="margin-top:4px">${AD.errBanner(f.banner)}</div>` : '';
    const main = `<main style="${MAIN}"><h1 tabindex="-1">General</h1>${banner}
<section style="display:grid;grid-template-columns:260px minmax(0,1fr);gap:32px;padding:22px 0;border-bottom:1px solid var(--line);margin-top:-20px">
<div style="display:flex;flex-direction:column;gap:4px"><h2 style="font-size:15px">Organization</h2></div>
<div style="display:flex;flex-direction:column;gap:14px;max-width:620px">
<div class="field"><label for="gn">Name</label><input id="gn" class="input${nameErr ? ' bad' : ''}" value="${esc(f.name)}" data-in="name" data-on="general"${nameErr ? ' aria-invalid="true" aria-describedby="gne"' : ''}${f.saving ? ' readonly' : ''}>${nameErr ? `<span id="gne" class="ferr" role="alert">${esc(nameErr)}</span>` : ''}</div>
<div class="field"><label for="gs">URL</label><div class="prefix"${slugErr ? ' style="border-color:var(--fail)"' : ''}><span id="gsp">/o/</span><input id="gs" value="${esc(f.slug)}" data-in="slug" data-on="general" aria-describedby="gsp gsh${slugErr ? ' gse' : ''}"${slugErr ? ' aria-invalid="true"' : ''}${f.saving ? ' readonly' : ''}></div><span id="gsh" class="help">Links that use the old URL will show "not found".</span>${slugErr ? `<span id="gse" class="ferr" role="alert">${esc(slugErr)}</span>` : ''}</div>
<div class="row" style="justify-content:flex-end;gap:8px"><button id="gsave" class="btn primary" data-act="general-save"${f.saving ? ' disabled aria-busy="true"' : !changed ? ' disabled' : ''}>${f.saving ? 'Saving…' : 'Save'}</button></div></div></section></main>`;
    let overlay = '';
    if (AD.ui.dialog && AD.ui.dialog.type === 'slug') {
      const d = AD.ui.dialog;
      const m = (t) => `<span class="mono" style="color:var(--text)">${esc(t)}</span>`;
      overlay = AD.dialog({ label: 'Change the organization URL?', w: 480, body: `<h2 style="font-size:18px">Change the organization URL?</h2><p class="muted" style="font-size:13.5px">${m('/o/' + o.slug)} becomes ${m('/o/' + f.slug)}. Links that use ${m('/o/' + o.slug)} will show "not found". Share the new link with your members.</p>`, foot: `<button class="btn ghost" data-act="dialog-close"${f.saving ? ' disabled' : ''}>Cancel</button><button class="btn primary" data-act="slug-confirm"${f.saving ? ' disabled aria-busy="true"' : ''}>${f.saving ? 'Saving…' : 'Change URL'}</button>` });
    }
    return { main, overlay };
  }
  AD.inputs.general = (t) => {
    const f = AD.ui.form; if (!f || f.owner !== 'general') return;
    const o = AD.org(AD.cur.params.org);
    const btn = AD.$('#gsave'); if (btn) btn.disabled = f.name === o.name && f.slug === o.slug;
  };
  function saveGeneral(ctx) {
    const f = AD.ui.form; const o = AD.org(ctx.orgSlug);
    f.errors = {}; f.banner = null;
    const name = f.name.trim();
    if (!name) f.errors.name = 'Enter a name.'; else if (name.length > 100) f.errors.name = 'Use 100 characters or fewer.';
    if (!SLUG_RE.test(f.slug)) f.errors.slug = 'Use lowercase letters, numbers and dashes, with no dash at the start or end.';
    else if (f.slug !== o.slug && AD.state.orgs.some((x) => x.slug === f.slug)) f.errors.slug = 'This URL is taken. Try another.';
    if (f.errors.name || f.errors.slug) { AD.render(); return false; }
    return true;
  }
  function commitGeneral(ctx) {
    const f = AD.ui.form; const o = AD.org(ctx.orgSlug);
    f.saving = true; AD.render();
    setTimeout(() => {
      const r = AD.api.updateOrg(ctx.orgSlug, f.name.trim(), f.slug);
      f.saving = false; AD.ui.dialog = null;
      if (r.err) { f.banner = r.err; AD.render(); return; }
      AD.ui.form = null;
      AD.toast('ok', 'Organization updated');
      if (f.slug !== ctx.orgSlug) AD.nav('/o/' + f.slug + '/settings/general', {}, { replace: true }); else AD.render();
    }, 600);
  }
  AD.acts['general-save'] = () => {
    const ctx = { orgSlug: AD.cur.params.org };
    const o = AD.org(ctx.orgSlug); const f = AD.ui.form;
    if (!saveGeneral(ctx)) return;
    if (f.slug !== o.slug) { AD.ui.dialog = { type: 'slug' }; AD.render(); return; }
    commitGeneral(ctx);
  };
  AD.acts['slug-confirm'] = () => commitGeneral({ orgSlug: AD.cur.params.org });
  AD.acts['dialog-close'] = () => { if (AD.ui.dialog && AD.ui.dialog.busy) return; AD.ui.dialog = null; AD.render(); };

  AD.screens['settings.general'] = {
    title: 'Settings, General',
    snaps: () => settingsSnaps(/^OrgGeneral/),
    render(ctx) {
      if (ctx.scen !== 'live' && AD.B[ctx.scen]) return AD.boardOut(ctx.scen);
      if (!ctx.perm.general) return AD.settingsForbidden(ctx, 'general');
      const std = AD.settingsStd(ctx, 'general', {});
      if (std) return std;
      const g = generalForm(ctx);
      return AD.settingsOut(ctx, 'general', g.main, g.overlay);
    },
  };

  /* ---------- Members ---------- */
  const ROLE_CARDS = [
    ['owner', 'Owner', 'Everything an admin can do, and manage owners.'],
    ['admin', 'Admin', 'Manage members, invitations, projects and settings.'],
    ['member', 'Member', 'Use projects and start runs.'],
    ['viewer', 'Viewer', 'See projects and runs.'],
    ['none', 'No role', 'Stays a member with no organization role. Project roles stay.'],
  ];
  const nameCell = (m, you) => `<span class="row" style="gap:8px;min-width:0">${m.name ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;min-width:0" title="${esc(m.name)}">${esc(m.name)}</span><span class="muted mono" style="white-space:nowrap;flex:0 0 auto">${esc(m.handle)}</span>` : `<span class="mono" style="font-weight:500;white-space:nowrap">${esc(m.handle)}</span>`}${you ? '<span class="lbl" style="flex:0 0 auto">You</span>' : ''}</span>`;

  function memberRow(ctx, m) {
    const me = ctx.perm;
    const you = m.uid === ctx.uid;
    const busy = AD.ui.busyUid === m.uid;
    const canAct = me.isOwner || (me.orgAdmin && m.role !== 'owner');
    const menuId = 'row:' + m.uid;
    const label = m.name || m.handle;
    let menu = '';
    if (AD.ui.menu === menuId && canAct) {
      menu = `<div class="pop" role="menu" aria-label="Actions for ${esc(label)}" style="right:12px;top:calc(100% - 4px);width:220px;padding:6px;gap:2px;text-align:left"><button class="btn ghost" role="menuitem" data-act="role-open" data-uid="${esc(m.uid)}" style="justify-content:flex-start;width:100%;color:var(--text)">Change access</button>${you ? '' : `<button class="btn ghost" role="menuitem" data-act="remove-open" data-uid="${esc(m.uid)}" style="justify-content:flex-start;width:100%;color:var(--fail)">Remove from organization</button>`}</div>`;
    }
    const chips = [m.role ? `Organization · ${AD.roleLabel(m.role)}` : 'No role', ...m.projects.map((p) => `${p.name} · ${p.role}`)].map((t) => `<li><span class="lbl">${esc(t)}</span></li>`).join('');
    const act = canAct ? `<button class="btn ghost iconbtn" data-act="rowmenu" data-id="${esc(m.uid)}" aria-label="Actions for ${esc(label)}" aria-haspopup="menu" aria-expanded="${AD.ui.menu === menuId}"${busy ? ' disabled' : ''}>${I.dots}</button>${menu}` : '';
    return `<tr${busy ? ' aria-busy="true"' : ''}><td>${nameCell(m, you)}</td><td><ul style="display:flex;flex-wrap:wrap;gap:4px;margin:0;padding:0;list-style:none" aria-label="Access of ${esc(label)}">${chips}</ul></td><td style="text-align:right;position:relative">${act}</td></tr>`;
  }

  const PROJECT_ROLES = ['Admin', 'Member', 'Viewer'];
  const optionsOf = (list, sel) => list.map((o) => `<option${o === sel ? ' selected' : ''}>${esc(o)}</option>`).join('');
  // The grants being edited: the person's grants when the dialog opened, with the role picked in each select.
  const draftOf = (d) => d.projects.map((g, i) => ({ name: g.name, role: d['pr' + i] || g.role }));
  const sameGrants = (a, b) => a.length === b.length && a.every((g, i) => g.name === b[i].name && g.role === b[i].role);
  function projectSection(ctx, d, m) {
    const draft = draftOf(d);
    const dis = d.busy ? ' disabled' : '';
    const rows = draft.length
      ? `<ul style="display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none">${draft.map((g, i) => `<li aria-label="${esc(g.name)}" style="display:flex;align-items:center;gap:8px"><span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px" title="${esc(g.name)}">${esc(g.name)}</span><select class="input" aria-label="Role in ${esc(g.name)}" data-dlg="pr${i}" data-rerender="1" style="flex:0 0 120px;width:120px"${dis}>${optionsOf(PROJECT_ROLES, g.role)}</select><button class="btn ghost iconbtn" data-act="proj-remove" data-i="${i}" aria-label="Remove access to ${esc(g.name)}"${dis}>${I.x}</button></li>`).join('')}</ul>`
      : '<p class="muted" style="margin:0;font-size:13px">No project access.</p>';
    const used = new Set(draft.map((g) => g.name));
    const addable = (AD.state.projects[ctx.orgSlug] || []).map((x) => x.id).filter((id) => !used.has(id));
    const add = `<div style="display:flex;align-items:center;gap:8px"><select class="input" aria-label="Project to add" data-dlg="toAdd" data-rerender="1" style="flex:1 1 auto;min-width:0"${dis}><option value="">Add a project…</option>${addable.map((id) => `<option${id === d.toAdd ? ' selected' : ''}>${esc(id)}</option>`).join('')}</select><select class="input" aria-label="Role in the project to add" data-dlg="addRole" style="flex:0 0 120px;width:120px"${dis}>${optionsOf(PROJECT_ROLES, d.addRole || 'Member')}</select><button class="btn sm" data-act="proj-add"${dis || (d.toAdd ? '' : ' disabled')}>${I.plus || ''}Add project</button></div>`;
    return `<div class="field"><span class="flabel" id="cr-projects">Project access</span><div role="group" aria-labelledby="cr-projects" style="display:flex;flex-direction:column;gap:8px">${rows}${add}</div></div>`;
  }

  function roleDialog(ctx) {
    const d = AD.ui.dialog; const me = ctx.perm;
    const m = AD.memberOf(ctx.orgSlug, d.uid); if (!m) return '';
    const org = AD.org(ctx.orgSlug);
    const cur = m.role || 'none';
    const label = m.name || m.handle;
    const you = m.uid === ctx.uid;
    const stepDown = you && cur === 'owner' && d.sel !== 'owner';
    const ownerNote = d.sel === 'owner' && cur !== 'owner';
    const cards = ROLE_CARDS.filter(([id]) => id !== 'owner' || me.giveOwner).map(([id, title, desc]) => {
      const on = d.sel === id;
      const desc2 = id === 'owner' && ownerNote ? ' aria-describedby="cr-owner-note"' : (on && stepDown ? ' aria-describedby="cr-stepdown"' : '');
      return `<div class="radio-card${on ? ' on' : ''}" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}"${desc2} data-act="role-pick" data-role="${id}" data-live style="cursor:pointer"><span class="rdot"></span><div style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:500">${title}</b><span class="muted" style="font-size:13px">${desc}</span></div></div>${id === 'owner' && ownerNote ? '<p id="cr-owner-note" class="note" role="status" style="margin:-2px 0 2px 2px">Owners can change or remove every member, including other owners.</p>' : ''}`;
    }).join('');
    const err = d.err ? `<div class="banner err" role="alert" style="align-items:center"><span class="b-ico">${I.warn}</span>${d.err.status === 409 ? `<b class="grow" style="font-weight:600">${esc(d.err.title)}</b>` : `<div class="grow" style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:600">${esc(d.err.title)}</b><span style="font-size:12px" class="muted">Request ID: <code class="mono" style="color:var(--text);font-size:12px">${esc(d.err.reqId)}</code></span></div>`}</div>` : '';
    const warn = stepDown ? `<div class="banner warn" id="cr-stepdown" role="status" style="align-items:center"><span class="b-ico">${I.warn}</span><span class="grow" style="font-size:13.5px">You will lose owner rights in ${esc(org.name)}.</span></div>` : '';
    const unchanged = d.sel === cur && sameGrants(draftOf(d), m.projects);
    return AD.dialog({ label: 'Change access for ' + label, w: 520, body: `<h2 style="font-size:18px">Change access for ${esc(label)}</h2>${err}<div class="field"><span class="flabel" id="cr-legend">Role</span><div role="radiogroup" aria-labelledby="cr-legend" style="display:flex;flex-direction:column;gap:8px">${cards}</div></div>${warn}${projectSection(ctx, d, m)}`, foot: `<button class="btn ghost" data-act="dialog-close"${d.busy ? ' disabled' : ''}>Cancel</button><button class="btn primary" data-act="role-save"${d.busy ? ' disabled aria-busy="true"' : unchanged ? ' disabled' : ''}>${d.busy ? 'Saving…' : 'Save access'}</button>` });
  }
  function removeDialog(ctx) {
    const d = AD.ui.dialog; const m = AD.memberOf(ctx.orgSlug, d.uid); if (!m) return '';
    const org = AD.org(ctx.orgSlug); const label = m.name || m.handle;
    return AD.dialog({ label: `Remove ${label} from ${org.name}?`, w: 480, body: `<h2 style="font-size:18px">Remove ${esc(label)} from ${esc(org.name)}?</h2><p class="muted" style="font-size:13.5px">They lose access to every project in ${esc(org.name)}.</p>`, foot: `<button class="btn ghost" data-act="dialog-close"${d.busy ? ' disabled' : ''}>Cancel</button><button class="btn solid-danger" data-act="remove-save"${d.busy ? ' disabled aria-busy="true"' : ''}>${d.busy ? 'Removing…' : 'Remove'}</button>` });
  }

  AD.acts['role-open'] = (el) => {
    const m = AD.memberOf(AD.cur.params.org, el.dataset.uid); if (!m) return;
    AD.ui.menu = null; AD.ui.dialog = { type: 'role', uid: m.uid, sel: m.role || 'none', projects: m.projects.map((g) => ({ name: g.name, role: g.role })), toAdd: '', addRole: 'Member', busy: false, err: null }; AD.render();
  };
  // Folds the roles picked in the selects into the draft, so a removed or added row keeps them.
  const syncProjects = (d) => { d.projects = draftOf(d); d.projects.forEach((_, i) => { delete d['pr' + i]; }); };
  AD.acts['proj-remove'] = (el) => { const d = AD.ui.dialog; if (d.busy) return; syncProjects(d); d.projects.splice(Number(el.dataset.i), 1); d.err = null; AD.render(); };
  AD.acts['proj-add'] = () => { const d = AD.ui.dialog; if (d.busy || !d.toAdd) return; syncProjects(d); d.projects.push({ name: d.toAdd, role: d.addRole || 'Member' }); d.toAdd = ''; d.err = null; AD.render(); };
  AD.acts['role-pick'] = (el) => { if (AD.ui.dialog.busy) return; AD.ui.dialog.sel = el.dataset.role; AD.ui.dialog.err = null; AD.render(); };
  AD.acts['role-save'] = () => {
    const d = AD.ui.dialog; const slug = AD.cur.params.org; if (d.busy) return;
    d.busy = true; d.err = null; AD.render();
    setTimeout(() => {
      const wasOwnerSelf = d.uid === AD.state.uid;
      const m = AD.memberOf(slug, d.uid);
      const roleChanged = m && d.sel !== (m.role || 'none');
      const wanted = draftOf(d);
      const grantsChanged = m && !sameGrants(wanted, m.projects);
      let r = roleChanged || !grantsChanged ? AD.api.changeRole(slug, d.uid, d.sel === 'none' ? null : d.sel) : { ok: true };
      if (!r.err && grantsChanged) r = AD.api.setProjectGrants(slug, d.uid, wanted);
      d.busy = false;
      if (r.err && r.err.status === 404) { AD.ui.dialog = null; AD.toast('err', r.err.title); AD.render(); return; }
      if (r.err) { d.err = r.err; AD.render(); return; }
      AD.ui.dialog = null; AD.toast('ok', grantsChanged ? 'Access changed' : 'Role changed');
      AD.render();
    }, 600);
  };
  AD.acts['remove-open'] = (el) => { AD.ui.menu = null; AD.ui.dialog = { type: 'remove', uid: el.dataset.uid, busy: false }; AD.render(); };
  AD.acts['remove-save'] = () => {
    const d = AD.ui.dialog; const slug = AD.cur.params.org; if (d.busy) return;
    const m = AD.memberOf(slug, d.uid); const label = m ? (m.name || m.handle) : 'Member';
    d.busy = true; AD.ui.busyUid = d.uid; AD.render();
    setTimeout(() => {
      const r = AD.api.removeMember(slug, d.uid);
      AD.ui.busyUid = null; AD.ui.dialog = null;
      if (r.err) AD.toast('err', r.err.title); else AD.toast('ok', label + ' removed');
      AD.render();
    }, 600);
  };

  AD.screens['settings.members'] = {
    title: 'Settings, Members',
    snaps: () => settingsSnaps(/^OrgMembers/),
    render(ctx) {
      if (ctx.scen !== 'live' && AD.B[ctx.scen]) return AD.boardOut(ctx.scen);
      if (!ctx.perm.members) return AD.settingsForbidden(ctx, 'members');
      const std = AD.settingsStd(ctx, 'members', { empty: `<main style="${MAIN}"><h1 tabindex="-1">Members</h1><div style="display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:40px 16px"><h3>No members</h3></div></main>` });
      if (std) return std;
      const all = AD.state.members[ctx.orgSlug] || [];
      const pg = AD.slice(all, Number(ctx.q.page) || 1);
      const rows = pg.rows.map((m) => memberRow(ctx, m)).join('');
      const main = pg.total === 0
        ? `<main style="${MAIN}"><h1 tabindex="-1">Members</h1><div style="display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:40px 16px"><h3>No members</h3></div></main>`
        : `<main style="${MAIN}"><h1 tabindex="-1">Members</h1><table style="table-layout:fixed"><colgroup><col style="width:34%"><col><col style="width:56px"></colgroup><thead><tr><th>Name</th><th>Access</th><th><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Actions</span></th></tr></thead><tbody>${rows}</tbody></table>${AD.pager(pg)}</main>`;
      const d = AD.ui.dialog;
      const overlay = d && d.type === 'role' ? roleDialog(ctx) : d && d.type === 'remove' ? removeDialog(ctx) : '';
      return AD.settingsOut(ctx, 'members', main, overlay);
    },
  };

  /* ---------- Audit log ---------- */
  AD.screens['settings.audit'] = {
    title: 'Settings, Audit log',
    snaps: () => settingsSnaps(/^OrgAudit/),
    render(ctx) {
      if (ctx.scen !== 'live' && AD.B[ctx.scen]) return AD.boardOut(ctx.scen);
      if (!ctx.perm.audit) return AD.settingsForbidden(ctx, 'audit');
      const empty = `<main style="${MAIN}"><h1>Audit log</h1><div style="display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:40px 16px"><h3>No activity yet</h3></div></main>`;
      const std = AD.settingsStd(ctx, 'audit', { empty });
      if (std) return std;
      const all = AD.state.audit[ctx.orgSlug] || [];
      if (!all.length) return AD.settingsOut(ctx, 'audit', empty);
      const pg = AD.slice(all, Number(ctx.q.page) || 1);
      const rows = pg.rows.map((e) => {
        const t = AD.auditText(e);
        const who = e.actor.deleted ? '<span class="faint">Deleted user</span>' : `<span class="row" style="gap:8px;min-width:0"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.actor.name)}">${esc(e.actor.name)}</span>${e.actor.platform ? '<span class="lbl" style="flex:0 0 auto">Platform admin</span>' : ''}</span>`;
        return `<tr><td class="muted" style="font-size:13px;white-space:nowrap">${AD.time(e.time)}</td><td style="font-size:13px">${who}</td><td><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px" title="${esc(t.title)}">${t.html}</span></td></tr>`;
      }).join('');
      const main = `<main style="${MAIN}"><h1>Audit log</h1><table style="table-layout:fixed"><colgroup><col style="width:14%"><col style="width:24%"><col></colgroup><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${rows}</tbody></table>${AD.pager(pg)}</main>`;
      return AD.settingsOut(ctx, 'audit', main);
    },
  };
})();
