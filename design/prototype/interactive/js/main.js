/* Render pipeline, event delegation and the shared actions. */
(function () {
  'use strict';
  const AD = window.AD;
  const esc = AD.esc;

  AD.resetUi = function () {
    AD.ui = Object.assign(AD.ui || {}, { menu: null, dialog: null, form: null, fail: 'none', pageSize: 20, bell: true, switching: false, persona: (AD.ui && AD.ui.persona) || 'kim-hale' });
  };
  AD.resetUi();
  // Proposals to review (open questions of the navigation proposal). Both are off until the designer decides.
  AD.proposals.projectsSettingsButton = false; // keep a Settings button in the Projects page header besides the Settings tab
  AD.proposals.needsCount = false; // org-wide "needs you" count on the Projects tab

  AD.landing = function () {
    const uid = AD.state.uid;
    if (!uid) return '/signin';
    const orgs = AD.userOrgs(uid);
    if (orgs.length) return '/o/' + orgs[0].slug + '/projects';
    return '/invitations';
  };

  AD.render = function () {
    const route = AD.parseHash();
    const res = AD.resolve(route);
    AD.cur = { route, screen: res.screen, params: res.params, q: route.q };
    if (res.screen === 'landing') { AD.nav(AD.landing(), {}, { replace: true }); return; }
    const uid = AD.state.uid;
    if (!uid && !AD.isPublic(res.screen)) { AD.nav('/signin', {}, { replace: true }); return; }

    const ctx = { route, screen: res.screen, params: res.params, q: route.q, scen: route.q.s || 'live', uid, user: AD.user() };
    let out;
    const def = AD.screens[res.screen] || AD.screens.notfound;
    if (res.params.org) {
      ctx.orgSlug = res.params.org;
      ctx.org = AD.org(res.params.org);
      const visible = ctx.org && uid && AD.userOrgs(uid).some((o) => o.slug === res.params.org);
      if (!visible) { out = AD.notFoundOut('This organization does not exist, or you are not a member of it.'); }
      else ctx.perm = AD.perm(uid, ctx.orgSlug);
    }
    if (!out && AD.ui.switching) out = { header: 'global', html: AD.loadingMain(), h: 900 };
    if (!out) {
      const std = ['loading', 'error', 'forbidden', 'crash'].includes(ctx.scen);
      out = def.render(ctx);
      if (!out && std) out = AD.standardState(ctx.scen, {}, 'global');
      if (!out && AD.B[ctx.scen]) out = AD.boardOut(ctx.scen);
      if (!out) out = AD.standardState(ctx.scen, {}, 'global') || AD.notFoundOut();
    }
    AD.paint(out, ctx, def);
  };

  AD.paint = function (out, ctx, def) {
    const stage = AD.$('#stage');
    const header = AD.chrome.bar(out);
    const h = out.h || 900;
    const style = out.fixed ? `height:max(${h}px,100vh)` : `min-height:max(${h}px,100vh)`;
    const scrollY = window.scrollY;
    stage.innerHTML = `<div class="app stage-app" style="${style}">${header}${out.html}</div>`;
    if (AD.lastKey !== ctx.route.path) window.scrollTo(0, 0); else window.scrollTo(0, scrollY);
    AD.lastKey = ctx.route.path;
    document.title = (out.title || (def && def.title) || 'Agent Desk') + ' - Agent Desk prototype';
    AD.enhanceBoard(stage, out.board);
    if (out.after) out.after(stage);
    if (def && def.after) def.after(stage, ctx);
    AD.out = out;
    if (AD.controls) AD.controls.refresh(ctx, def, out);
  };

  /* ---------- events ---------- */
  const DEAD_SELECTOR = 'button, [role="menuitem"], a[href="#"], .fchip, .seg button, .toggle, [role="tab"]';
  document.addEventListener('click', (e) => {
    if (e.target.closest('#proto')) return;
    const t = e.target.closest('[data-act]');
    if (t) {
      const fn = AD.acts[t.dataset.act];
      if (fn) { if (t.tagName === 'A') e.preventDefault(); fn(t, e); }
      return;
    }
    if (AD.ui.menu && !e.target.closest('.pop')) { AD.ui.menu = null; AD.render(); return; }
    const stage = e.target.closest('#stage');
    if (!stage) return;
    // purely visual widgets of the boards (no data behind them)
    const tg = e.target.closest('.toggle'); if (tg && !tg.disabled) { tg.classList.toggle('on'); return; }
    const seg = e.target.closest('.seg button'); if (seg) { AD.$$('button', seg.parentNode).forEach((b) => b.classList.toggle('on', b === seg)); return; }
    const chip = e.target.closest('.fchip'); if (chip && !chip.closest('[data-live]')) { AD.$$('.fchip', chip.parentNode).forEach((c) => { c.classList.toggle('on', c === chip); c.setAttribute('aria-pressed', c === chip); }); return; }
    const rc = e.target.closest('.radio-card'); if (rc && !rc.closest('[data-live]')) { const grp = rc.parentNode; AD.$$(':scope > .radio-card', grp).forEach((c) => { c.classList.toggle('on', c === rc); c.setAttribute('aria-checked', c === rc); }); return; }
    const cb = e.target.closest('.cbx'); if (cb && !cb.closest('[data-live]')) { cb.classList.toggle('on'); cb.setAttribute('aria-checked', cb.classList.contains('on')); return; }
    const dead = e.target.closest(DEAD_SELECTOR);
    if (dead && !dead.disabled && !(dead.tagName === 'A' && dead.getAttribute('href') !== '#')) {
      if (dead.tagName === 'A') e.preventDefault();
      const label = (dead.getAttribute('aria-label') || dead.textContent || '').trim().slice(0, 40) || 'this control';
      AD.toast('off', 'Not wired in this prototype', '"' + label + '" is drawn on the board but has no behaviour here.');
    }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.in && AD.ui.form) AD.ui.form[t.dataset.in] = t.value;
    if (t.dataset && t.dataset.dlg && AD.ui.dialog) {
      AD.ui.dialog[t.dataset.dlg] = t.value;
      if (t.dataset.dlg === 'email' && AD.ui.dialog.fieldErr) { // edit clears the field error without re-rendering (keeps focus)
        AD.ui.dialog.fieldErr = null; t.classList.remove('bad'); t.removeAttribute('aria-invalid');
        const e = t.parentNode.querySelector('.ferr'); if (e) e.remove();
      }
    }
    if (t.dataset && t.dataset.on && AD.inputs[t.dataset.on]) AD.inputs[t.dataset.on](t, e);
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches && t.matches('[data-pg-size]')) { AD.ui.pageSize = Number(t.value); AD.setQuery({ page: null }); return; }
    if (t.dataset && t.dataset.in && AD.ui.form) { AD.ui.form[t.dataset.in] = t.value; if (t.dataset.rerender) AD.render(); }
    if (t.dataset && t.dataset.dlg && AD.ui.dialog) { AD.ui.dialog[t.dataset.dlg] = t.value; if (t.dataset.rerender) AD.render(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (AD.ui.dialog && !AD.ui.dialog.busy) { AD.ui.dialog = null; AD.render(); }
      else if (AD.ui.menu) { AD.ui.menu = null; AD.render(); }
    }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-pg-jump]')) AD.acts['page-jump'](e.target);
  });

  /* ---------- shared actions ---------- */
  const A = AD.acts;
  A.menu = (el) => { const m = el.dataset.menu; AD.ui.menu = AD.ui.menu === m ? null : m; AD.render(); };
  A.rowmenu = (el) => { const m = 'row:' + el.dataset.id; AD.ui.menu = AD.ui.menu === m ? null : m; AD.render(); };
  A.bell = () => { AD.ui.bell = AD.ui.bell === false; AD.render(); AD.toast('off', AD.ui.bell ? 'Desktop notifications on' : 'Desktop notifications off'); };
  A.go = (el) => { location.hash = el.dataset.href; };
  // A link inside a menu: close the menu, then go (same hash: no hashchange fires, so re-render).
  A['menu-link'] = (el) => { AD.ui.menu = null; const t = el.getAttribute('href'); if (t === location.hash) AD.render(); else location.hash = t; };
  A.retry = () => { AD.setQuery({ s: null }); };
  A['leave-snapshot'] = () => { AD.setQuery({ s: null }); };
  A['dismiss-banner'] = (el) => { const b = el.closest('.banner'); if (b) b.remove(); };
  A['dismiss-toast'] = (el) => { const b = el.closest('.toast'); if (b) b.remove(); };
  A.page = (el) => { if (el.disabled) return; AD.setQuery({ page: el.dataset.page }); };
  A['page-jump'] = (el) => {
    const inp = AD.$('[data-pg-jump]'); const n = parseInt(inp && inp.value, 10);
    if (n >= 1) AD.setQuery({ page: n });
  };
  A.signout = () => { AD.state.uid = null; AD.ui.menu = null; AD.nav('/signin'); };
  A.signin = () => {
    const pid = AD.ui.persona;
    if (pid === 'jo-marsh') { AD.nav('/signin', { s: 'SignInNoInvitation' }); return; }
    AD.state.uid = pid; AD.ui.menu = null;
    if (AD.ui.returnTo) { const t = AD.ui.returnTo; AD.ui.returnTo = null; location.hash = t; return; }
    AD.nav(AD.landing(), {});
  };
  A['switch-org'] = (el, e) => {
    e.preventDefault();
    const slug = el.dataset.org;
    AD.ui.menu = null;
    if (slug === AD.curOrg()) { AD.render(); return; }
    AD.ui.switching = true;
    AD.nav('/o/' + slug + '/projects');
    setTimeout(() => { AD.ui.switching = false; AD.render(); }, 700);
  };

  /* ---------- boot ---------- */
  window.addEventListener('DOMContentLoaded', () => { if (AD.controls) AD.controls.mount(); AD.render(); });
})();
