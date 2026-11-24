/* Sign in, my invitations, accepting an invitation, creating an organization (platform admin).
   Built from SignIn*, MyInvitations*, InvitationAccept*, CreateOrg* boards. */
(function () {
  'use strict';
  const AD = window.AD;
  const esc = AD.esc;
  const I = AD.I;
  const WIDE = 'flex:1;display:flex;justify-content:center;padding:96px 40px';
  const TOKEN = '7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43';

  /* ---------- sign in ---------- */
  AD.screens.signin = {
    title: 'Sign in',
    snaps: () => AD.snapGroup(AD.boardNames(/^SignIn/)),
    render(ctx) {
      if (ctx.scen === 'noinv') return AD.boardOut('SignInNoInvitation');
      if (ctx.scen !== 'live' && AD.B[ctx.scen]) return AD.boardOut(ctx.scen);
      if (ctx.scen === 'live') return AD.boardOut('SignIn');
      return null;
    },
  };

  /* ---------- helpers for the invitation screens ---------- */
  function joinOrg(inv) {
    const u = AD.user();
    const list = AD.state.members[inv.org] || (AD.state.members[inv.org] = []);
    if (list.some((m) => m.uid === u.id)) return;
    const projects = inv.access && inv.access !== 'Whole organization' ? inv.access.split(', ').map((n) => ({ name: n, role: inv.role })) : [];
    // An invitation for "Some projects" gives project roles only, so the member has no org role.
    const role = inv.access && inv.access !== 'Whole organization' ? null : inv.role.toLowerCase();
    list.push({ uid: u.id, name: u.name, handle: u.id, role, projects });
    AD.addAudit(inv.org, { k: 'accepted', role: inv.role });
  }
  const invTime = (e) => `<time datetime="${e.iso}" title="${esc(e.title)}">${esc(e.text)}</time>`;

  /* ---------- my invitations ---------- */
  AD.acts['mi-accept'] = (el) => {
    const id = el.dataset.id; const uid = AD.state.uid;
    AD.ui.miBusy = { id, kind: 'accept' }; AD.render();
    setTimeout(() => {
      const f = AD.takeFail();
      const inv = (AD.state.mine[uid] || []).find((x) => x.id === id);
      AD.ui.miBusy = null;
      if (f || !inv) { AD.ui.miError = true; AD.render(); return; }
      joinOrg(inv);
      AD.state.mine[uid] = AD.state.mine[uid].filter((x) => x.id !== id);
      AD.toast('ok', 'You joined ' + inv.orgName);
      AD.nav('/o/' + inv.org + '/projects');
    }, 700);
  };
  AD.acts['mi-decline'] = (el) => {
    const id = el.dataset.id; const uid = AD.state.uid;
    AD.state.mine[uid] = (AD.state.mine[uid] || []).filter((x) => x.id !== id);
    AD.toast('ok', 'Invitation declined'); AD.render();
  };
  AD.screens.myinvites = {
    title: 'Invitations',
    snaps: () => AD.snapGroup(AD.boardNames(/^MyInvitations/)),
    render(ctx) {
      const s = ctx.scen; const u = ctx.user;
      const noOrg = !AD.userOrgs(u.id).length;
      let out;
      if (s !== 'live' && AD.B[s]) out = AD.boardOut(s);
      else if (s === 'loading') out = AD.boardOut('MyInvitationsLoading');
      else if (s === 'error' || AD.ui.miError) { out = AD.boardOut('MyInvitationsError'); }
      else if (s === 'crash') return AD.boardOut('RouteError');
      else if (s === 'forbidden') out = AD.forbiddenOut();
      else {
        const list = s === 'empty' ? [] : AD.state.mine[u.id] || [];
        if (!list.length) out = AD.boardOut(u.platform ? 'MyInvitationsEmptyPlatformAdmin' : 'MyInvitationsEmpty');
        else {
          const busy = AD.ui.miBusy;
          const li = list.map((i) => `<li style="border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:16px;display:flex;gap:16px;align-items:center"><div class="grow" style="display:flex;flex-direction:column;gap:4px"><b style="font-weight:600;font-size:15px">${esc(i.orgName)} invited you as ${esc(i.role)}</b><span class="muted" style="font-size:13px">${esc(i.access)}</span><span class="faint" style="font-size:12.5px">${i.by ? `Invited by ${esc(i.by)}, expires` : 'Expires'} ${invTime(i.exp)}</span></div><div class="row" style="gap:8px"><button class="btn" data-act="mi-decline" data-id="${i.id}"${busy ? ' disabled' : ''}>Decline</button><button class="btn primary" data-act="mi-accept" data-id="${i.id}"${busy ? ' disabled' : ''}${busy && busy.id === i.id ? ' aria-busy="true"' : ''}>${busy && busy.id === i.id ? 'Accepting…' : 'Accept'}</button></div></li>`).join('');
          out = { header: 'global', h: 900, html: `<main style="${WIDE}"><div style="width:100%;max-width:760px;display:flex;flex-direction:column;gap:28px"><h1 style="font-size:28px">Invitations</h1><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px">${li}</ul></div></main>` };
        }
      }
      if (out && noOrg) out.noOrg = true;
      return out;
    },
  };

  /* ---------- accept an invitation ---------- */
  AD.acts['acc-accept'] = () => {
    const uid = AD.state.uid; const inv = (AD.state.mine[uid] || []).find((x) => x.org === 'harbor-labs'); if (!inv) return;
    AD.ui.accBusy = 'accept'; AD.render();
    setTimeout(() => {
      const f = AD.takeFail(); AD.ui.accBusy = null;
      if (f) { AD.ui.accError = true; AD.render(); return; }
      joinOrg(inv);
      AD.state.mine[uid] = AD.state.mine[uid].filter((x) => x.id !== inv.id);
      AD.toast('ok', 'You joined ' + inv.orgName);
      AD.nav('/o/' + inv.org + '/projects');
    }, 700);
  };
  AD.acts['acc-decline-open'] = () => { AD.ui.dialog = { type: 'decline' }; AD.render(); };
  AD.acts['acc-decline'] = () => {
    const uid = AD.state.uid; const inv = (AD.state.mine[uid] || []).find((x) => x.org === 'harbor-labs');
    AD.ui.dialog.busy = true; AD.render();
    setTimeout(() => {
      AD.ui.dialog = null;
      if (inv) AD.state.mine[uid] = AD.state.mine[uid].filter((x) => x.id !== inv.id);
      AD.ui.accDeclined = true; AD.render();
    }, 600);
  };
  AD.screens.accept = {
    title: 'Join organization',
    snaps: () => AD.snapGroup(AD.boardNames(/^InvitationAccept/)),
    render(ctx) {
      const s = ctx.scen;
      if (!ctx.uid) { AD.ui.returnTo = location.hash; AD.nav('/signin', {}, { replace: true }); return { header: 'none', html: '', h: 900 }; }
      if (s !== 'live' && AD.B[s]) return AD.boardOut(s);
      if (s === 'loading') return AD.boardOut('InvitationAcceptLoading');
      if (s === 'error' || AD.ui.accError) return AD.boardOut('InvitationAcceptError');
      if (s === 'crash') return AD.boardOut('RouteError');
      if (s === 'forbidden') return AD.boardOut('InvitationAcceptNotAvailable');
      if (AD.ui.accDeclined) return AD.boardOut('InvitationAcceptDeclined');
      // The sample link belongs to Dana Ortiz's Harbor Labs invitation; everyone else gets "not available".
      const inv = (AD.state.mine[ctx.uid] || []).find((x) => x.org === 'harbor-labs');
      if (!inv) {
        const joined = ctx.uid === 'dana-ortiz' && AD.memberOf('harbor-labs', 'dana-ortiz');
        return AD.boardOut(joined ? 'InvitationAcceptAccepted' : 'InvitationAcceptNotAvailable');
      }
      const busy = AD.ui.accBusy;
      const d = AD.ui.dialog;
      const html = `<main style="${WIDE}"><div style="width:100%;max-width:760px;display:flex;flex-direction:column;gap:28px"><h1 style="font-size:28px">Join ${esc(inv.orgName)}</h1><div style="border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:16px"><dl class="kv" style="grid-template-columns:120px minmax(0,1fr);gap:10px 16px;font-size:14px"><dt>Role</dt><dd>${esc(inv.role)}</dd><dt>Access</dt><dd>${esc(inv.access)}</dd>${inv.by ? `<dt>Invited by</dt><dd>${esc(inv.by)}</dd>` : ''}<dt>Expires</dt><dd>${invTime(inv.exp)}</dd></dl></div><div class="row" style="gap:12px"><button class="btn primary lg" data-act="acc-accept"${busy ? ' disabled aria-busy="true"' : ''}>${busy ? 'Accepting…' : 'Accept'}</button><button class="btn lg" data-act="acc-decline-open"${busy ? ' disabled' : ''}>Decline</button></div></div></main>`;
      const overlay = d && d.type === 'decline' ? AD.dialog({ label: `Decline invitation to ${inv.orgName}?`, w: 440, body: `<h2 style="font-size:18px">Decline invitation to ${esc(inv.orgName)}?</h2><p class="muted" style="font-size:13.5px">You will need a new invitation to join later.</p>`, foot: `<button class="btn ghost" data-act="dialog-close"${d.busy ? ' disabled' : ''}>Cancel</button><button class="btn solid-danger" data-act="acc-decline"${d.busy ? ' disabled aria-busy="true"' : ''}>${d.busy ? 'Declining…' : 'Decline'}</button>` }) : '';
      return { header: 'global', noOrg: !AD.userOrgs(ctx.uid).length, h: 900, html: html + overlay };
    },
  };

  /* ---------- create organization (platform admin) ---------- */
  const slugify = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  function form() {
    if (!AD.ui.form || AD.ui.form.owner !== 'createorg') AD.ui.form = { owner: 'createorg', name: '', slug: '', email: '', slugEdited: false, errors: {}, phase: 'form', banner: null, created: null };
    return AD.ui.form;
  }
  AD.inputs['createorg-name'] = (t) => {
    const f = form(); f.name = t.value;
    if (!f.slugEdited) { f.slug = slugify(f.name); const s = AD.$('#os'); if (s) s.value = f.slug; }
  };
  AD.inputs['createorg-slug'] = (t) => { const f = form(); f.slug = t.value; f.slugEdited = true; };
  function createdOrgLink(f) { return 'https://agentdesk.example/invitations/' + TOKEN; }
  function finishCreate(f) {
    const slug = f.slug;
    AD.state.orgs.push({ slug, name: f.name.trim() });
    AD.state.members[slug] = []; AD.state.projects[slug] = []; AD.state.invites[slug] = []; AD.state.audit[slug] = [];
    AD.addAudit(slug, { k: 'raw', key: 'POST orgs.create' });
    AD.state.invites[slug].push({ id: 'o1', email: f.email.trim(), role: 'Owner', access: null, status: 'pending', exp: { rel: 'Expires in 1 day', title: '23 Nov 2026, 14:05', iso: '2026-11-23T14:05' }, by: AD.user().name });
    AD.addAudit(slug, { k: 'invited', email: f.email.trim(), role: 'Owner' });
    f.created = slug; f.phase = 'created'; f.banner = null; AD.render();
  }
  AD.acts['createorg-submit'] = () => {
    const f = form();
    f.errors = {};
    const name = f.name.trim();
    if (!name) f.errors.name = 'Enter a name.'; else if (name.length > 100) f.errors.name = 'Use 100 characters or fewer.';
    if (!SLUG_RE.test(f.slug)) f.errors.slug = 'Use lowercase letters, numbers and dashes, with no dash at the start or end.';
    else if (AD.state.orgs.concat((AD.state.platform && AD.state.platform.extraOrgs) || []).some((o) => o.slug === f.slug)) f.errors.slug = 'This URL is taken. Try another.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) f.errors.email = 'Enter a valid email address.';
    if (Object.keys(f.errors).length) { AD.render(); return; }
    f.phase = 'saving'; f.banner = null; AD.render();
    setTimeout(() => {
      const fail = AD.takeFail();
      if (fail === '409') { // organization created but the owner invitation failed (CreateOrgInvitationFailed)
        AD.state.orgs.push({ slug: f.slug, name: name }); AD.state.members[f.slug] = []; AD.state.projects[f.slug] = []; AD.state.invites[f.slug] = []; AD.state.audit[f.slug] = [];
        f.phase = 'invfailed'; f.banner = { title: 'Internal server error', reqId: AD.reqId(), detail: 'The organization was created. Retry to create the owner invitation.' }; AD.render(); return;
      }
      if (fail) { f.phase = 'form'; f.banner = { title: fail === '403' ? "You don't have access" : 'Internal server error', reqId: AD.reqId() }; AD.render(); return; }
      finishCreate(f);
    }, 700);
  };
  AD.acts['createorg-retry'] = () => {
    const f = form(); f.phase = 'retrying'; AD.render();
    setTimeout(() => {
      const slug = f.slug;
      AD.state.invites[slug].push({ id: 'o1', email: f.email.trim(), role: 'Owner', access: null, status: 'pending', exp: { rel: 'Expires in 1 day', title: '23 Nov 2026, 14:05', iso: '2026-11-23T14:05' }, by: AD.user().name });
      AD.addAudit(slug, { k: 'raw', key: 'POST orgs.create' }); AD.addAudit(slug, { k: 'invited', email: f.email.trim(), role: 'Owner' });
      f.created = slug; f.phase = 'created'; f.banner = null; AD.render();
    }, 700);
  };
  AD.acts['createorg-copy'] = () => {
    const done = () => AD.toast('ok', 'Link copied');
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(createdOrgLink()).then(done, () => AD.toast('err', 'Could not copy. Select the link and copy it.')); else AD.toast('err', 'Could not copy. Select the link and copy it.'); } catch (e) { AD.toast('err', 'Could not copy. Select the link and copy it.'); }
  };
  // Done: back to the new org in the platform area (the creator is not a member of it, so its own pages would be not found).
  AD.acts['createorg-done'] = () => { const f = form(); const slug = f.created; AD.ui.form = null; AD.nav('/platform/orgs/' + AD.platformOrgId(slug)); };

  // Old URL: /orgs/new redirects to /platform/orgs/new (navigation-consistency spec).
  AD.screens['createorg.redirect'] = {
    title: 'Create organization',
    render(ctx) { setTimeout(() => AD.nav('/platform/orgs/new', ctx.q, { replace: true }), 0); return { header: 'global', h: 900, html: AD.loadingMain() }; },
  };

  AD.screens.createorg = {
    title: 'Create organization',
    snaps: () => AD.snapGroup(AD.boardNames(/^CreateOrg/)),
    render(ctx) {
      const s = ctx.scen;
      // Inside the platform shell: platform bar, Organizations tab active, crumbs Organizations / Create organization.
      if (s !== 'live' && AD.B[s]) return AD.boardOut(s);
      if (s === 'forbidden' || !ctx.user.platform) return AD.boardOut('CreateOrgForbidden');
      if (s === 'loading') return { header: 'global', h: 900, html: AD.loadingMain() };
      if (s === 'error') return { header: 'global', h: 900, html: AD.errorMain() };
      const f = form();
      const e = f.errors;
      const ro = f.phase === 'invfailed' || f.phase === 'retrying' ? ' readonly aria-readonly="true"' : '';
      const banner = f.banner ? `<div class="banner err" role="alert" style="align-items:center"><span class="b-ico">${I.warn}</span><div class="grow" style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:600">${esc(f.banner.title)}</b>${f.banner.detail ? `<span style="font-size:13px" class="muted">${esc(f.banner.detail)}</span>` : ''}<span style="font-size:12px" class="muted">Request ID: <code class="mono" style="color:var(--text);font-size:12px">${esc(f.banner.reqId)}</code></span></div>${f.phase === 'invfailed' ? `<button class="btn" data-act="createorg-retry">${I.retry}Retry</button>` : f.phase === 'retrying' ? '<button class="btn " disabled aria-busy="true">Retrying…</button>' : ''}</div>` : '';
      let inner;
      if (f.phase === 'created') {
        inner = `<section aria-labelledby="oc-h" style="border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:20px;display:flex;flex-direction:column;gap:14px"><h2 id="oc-h" tabindex="-1">Organization created</h2><p class="muted" style="font-size:13.5px">Send this link to ${esc(f.email.trim())}. It works only for that email and expires on 23 Nov, 14:05.</p><div class="field"><label for="ilink">Invitation link</label><div class="row" style="gap:8px"><input id="ilink" class="input mono" readonly value="${createdOrgLink()}"><button class="btn" data-act="createorg-copy">${I.copy}Copy link</button></div></div><div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="createorg-done">Done</button></div></section>`;
      } else {
        const saving = f.phase === 'saving';
        inner = `${banner}<div style="display:flex;flex-direction:column;gap:18px"><div class="field"><label for="on">Name</label><input id="on" class="input${e.name ? ' bad' : ''}" value="${esc(f.name)}" data-in="name" data-on="createorg-name"${e.name ? ' aria-invalid="true" aria-describedby="one"' : ''}${ro}>${e.name ? `<span id="one" class="ferr" role="alert">${esc(e.name)}</span>` : ''}</div><div class="field"><label for="os">URL</label><div class="prefix"${e.slug ? ' style="border-color:var(--fail)"' : ''}><span id="osp">/o/</span><input id="os" value="${esc(f.slug)}" data-in="slug" data-on="createorg-slug" aria-describedby="osp${e.slug ? ' ose' : ''}"${e.slug ? ' aria-invalid="true"' : ''}${ro}></div>${e.slug ? `<span id="ose" class="ferr" role="alert">${esc(e.slug)}</span>` : ''}</div><div class="field"><label for="oe">First owner email</label><input id="oe" class="input${e.email ? ' bad' : ''}" value="${esc(f.email)}" data-in="email" aria-describedby="oeh${e.email ? ' oee' : ''}"${e.email ? ' aria-invalid="true"' : ''}><span id="oeh" class="help">They get the owner role. Send them the link that appears next.</span>${e.email ? `<span id="oee" class="ferr" role="alert">${esc(e.email)}</span>` : ''}</div></div>${f.phase === 'invfailed' || f.phase === 'retrying' ? '' : `<div class="row" style="gap:12px"><button class="btn primary lg" data-act="createorg-submit"${saving ? ' disabled aria-busy="true"' : ''}>${saving ? 'Creating…' : 'Create organization'}</button></div>`}`;
      }
      const html = `<main style="${WIDE}"><div style="width:100%;max-width:560px;display:flex;flex-direction:column;gap:24px"><h1 style="font-size:28px">Create an organization</h1>${inner}</div></main>`;
      return { header: 'global', h: 900, html };
    },
  };
})();
