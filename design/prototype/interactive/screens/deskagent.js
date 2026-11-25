/* Desk > Agent & settings, live: several agents per project, as a tab strip (Agents, GitHub connection, Limits, Danger zone).
   Markup comes from screens/deskagent-view.js (the same functions draw the DeskAgent* boards). State is in memory and resets
   with the prototype. Spec: docs/superpowers/specs/2026-11-24-multi-agent-configs-design.md (BR-1 to BR-60).
   Also here: the live default of Routing rules (agent names, the agent picker) and of setup step 2 (one copy line), which
   only swap in the new boards; the old boards stay reachable from the Scenario list.
   Fail the next action with: 403 = "You don't have access" on any write; 500 on Save agent with a credential = the credential
   step fails (agent kept, pane says so); 500 elsewhere = server error; 409 on Save agent = name already used, on Delete = the
   agent is in use; 404 on Edit, Save, Test or Delete = the agent was deleted meanwhile. */
(function () {
  'use strict';
  const AD = window.AD;
  const V = window.ADV;
  const esc = AD.esc;
  const A = AD.acts;

  /* ---------- store: per org, project and data set ("main", "paged", "empty") ---------- */
  const variantOf = (s) => (s === 'ag-paged' ? 'paged' : s === 'ag-single' ? 'single' : s === 'empty' ? 'empty' : 'main');
  function store(org, project, variant) {
    AD.state.agentDesk = AD.state.agentDesk || {}; // AD.state is replaced on Reset, so the seed comes back
    const k = org + '/' + project + '/' + variant;
    if (!AD.state.agentDesk[k]) {
      AD.state.agentDesk[k] = {
        agents: variant === 'paged' ? V.seedMany() : variant === 'empty' ? [] : variant === 'single' ? V.seed().slice(0, 1) : V.seed(),
        gh: { mode: 'webhook', interval: '5 min' },
        limits: V.limitsSeed(),
        seq: 1,
      };
    }
    return AD.state.agentDesk[k];
  }
  const ordered = (st) => st.agents.slice().sort((a, b) => (a.isDefault === b.isDefault ? (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0) : a.isDefault ? -1 : 1));
  const findAgent = (st, id) => st.agents.find((a) => a.id === id);
  const lag = (fn, ms) => setTimeout(fn, ms || 650);

  /* ---------- screen state (outside AD.ui.form/dialog) ---------- */
  function ui(key) {
    if (!AD.ui.ag || AD.ui.ag.key !== key) AD.ui.ag = { key, form: null, formKey: null, testingId: null, focus: null, sc: {}, gh: { checking: false, refused: false, triggerError: null }, lim: { values: null, errors: {}, saving: false, banner: null } };
    return AD.ui.ag;
  }
  const cur = () => {
    const c = AD.cur;
    return { org: c.params.org, project: c.params.project, scen: (c.q && c.q.s) || 'live', q: c.q || {} };
  };
  const curStore = () => { const c = cur(); return store(c.org, c.project, variantOf(c.scen)); };

  /* ---------- permissions (ADR-0036): owner and admin hold agent:read, agent:update and secret:update, org-wide or on that
     project; project:delete is org level. Nobody holds only agent:read, so "read-only" is a Scenario. ---------- */
  function access(ctx) {
    const p = ctx.perm || {};
    const read = !!(p.orgAdmin || (p.adminProjects || []).includes(ctx.params.project));
    const ro = ctx.scen === 'ag-readonly';
    return { read, write: read && !ro, secret: read && !ro, danger: !!p.orgAdmin };
  }

  /* ---------- forms ---------- */
  const newAdd = () => ({ mode: 'add', kind: null, name: '', label: '', auth: null, token: '', baseUrl: '', origBaseUrl: '', model: null, typedModel: null, maxTurns: '', makeDefault: false, errors: {}, banner: null, step: null, modelState: 'standard' });
  const editForm = (a, readOnly) => ({ mode: readOnly ? 'view' : 'edit', readOnly: !!readOnly, agent: a, kind: a.kind, name: a.name, label: a.label, auth: V.kindOf(a.kind).credentialOptional && !a.cred ? null : a.auth, token: '', baseUrl: a.baseUrl, origBaseUrl: a.baseUrl, model: a.model, typedModel: null, maxTurns: a.maxTurns, makeDefault: false, errors: {}, banner: null, step: null, modelState: a.cred ? 'ready' : 'standard', replacing: false, testing: false, result: null });
  function chooseKind(f, kind) {
    const kd = V.kindOf(kind);
    f.kind = kind; f.typedModel = null; f.baseUrl = ''; f.token = ''; f.errors = {};
    // OpenCode works without signing in: nothing is picked and the model is OpenCode's default (empty); the others start on their first type
    f.auth = kd.credentialOptional ? null : kd.auths[0].id; f.model = kd.credentialOptional ? '' : kd.standard[0];
  }
  // Changing the authentication re-evaluates the model: with an endpoint it is the plain id the endpoint serves (required, typed or
  // listed); with a file or none it is OpenCode's provider/model reference (empty = OpenCode default). A typed key or file never carries over.
  function setAuth(f, id) {
    const kd = V.kindOf(f.kind);
    f.auth = id; f.token = ''; f.errors = {};
    if (!V.addrOn(kd, id)) f.baseUrl = ''; // a file never carries an address
    if (kd.modelOptional) { if (id === 'api_key') { f.model = '_other'; f.typedModel = ''; } else { f.model = ''; f.typedModel = null; } }
  }
  const modelOf = (f) => (f.model === '_other' || f.typedModel != null ? (f.typedModel || '').trim() : f.model);
  const problem = (status, title, detail) => ({ status, title, detail, reqId: status >= 500 ? AD.reqId() : null });
  const NO_ACCESS = () => problem(403, "You don't have access", 'Your role cannot change agents in this project.');

  function validateAddress(kd, v, auth) {
    if (!V.addrOn(kd, auth) || !v) return null;
    if (!/^https:\/\/[^\s/]+\.[^\s/]+/i.test(v)) return 'Use a public https address, for example https://llm.example.com.';
    if (/localhost|127\.|10\.\d|192\.168\./.test(v)) return 'That address is not public.';
    return null;
  }
  function checkForm(f, st, ownId) {
    const e = {};
    const name = f.name.trim();
    if (!name) e.name = 'Enter a name.';
    else if (name.length > 256) e.name = 'Use 256 characters or fewer.';
    else if (st.agents.some((a) => a.id !== ownId && a.name.toLowerCase() === name.toLowerCase())) e.name = 'An agent with this name already exists.';
    if (f.label.trim().length > 256) e.label = 'Use 256 characters or fewer.';
    const kd = V.kindOf(f.kind);
    if (kd.modelOptional) {
      // OpenCode: an endpoint and its key go together; the model is required with an endpoint, optional otherwise
      const key = f.auth === 'api_key';
      const hasT = !!(f.token || '').trim(); const hasA = !!(f.baseUrl || '').trim();
      if (f.mode === 'add' && key) {
        if (hasT && !hasA) e.baseUrl = 'Enter the API endpoint for this key.';
        if (hasA && !hasT) e.token = 'Enter the API key for this endpoint.';
      }
      const needModel = key && (f.mode === 'add' ? hasT || hasA : !!(f.agent && f.agent.cred && f.agent.auth === 'api_key') || (f.replacing && (hasT || hasA)));
      if (needModel && !modelOf(f)) e.model = 'Enter the model your endpoint serves.';
    } else if ((f.model === '_other' || f.typedModel != null) && !(f.typedModel || '').trim()) e.model = 'Enter a model name.';
    if (f.mode === 'add') { const ae = validateAddress(kd, f.baseUrl.trim(), f.auth); if (ae) e.baseUrl = ae; }
    if (f.maxTurns !== '' && !/^\d+$/.test(String(f.maxTurns).trim())) e.maxTurns = 'Enter a whole number or leave it empty.';
    return e;
  }

  /* ---------- fake API ---------- */
  function testResult(a) {
    if (!a.cred) return V.kindOf(a.kind).credentialOptional ? 'unsupported' : 'no_credential'; // OpenCode with no credential: nothing to check
    if (/reject|bad|wrong/i.test(a._lastToken || '')) return 'rejected';
    if (/unreach/i.test(a._lastToken || '') || /unreach/i.test(a.baseUrl)) return 'unreachable';
    if (/odd|invalid/i.test(a._lastToken || '')) return 'invalid';
    return a.kind === 'opencode' && a.auth === 'auth_json' ? 'unsupported' : 'ok'; // a credentials file cannot be probed
  }
  const setCred = (a, f) => { a.cred = { at: '22 Nov 2026', by: AD.state.uid || 'kim-hale' }; a.auth = f.auth || a.auth; a._lastToken = f.token; const kd = V.kindOf(a.kind); if (kd.addrAuth && !V.addrOn(kd, a.auth)) a.baseUrl = ''; else if (f.baseUrl !== undefined && V.addrOn(kd, a.auth)) a.baseUrl = (f.baseUrl || '').trim(); a.test = null; };
  const runTest = (a) => { const s = testResult(a); a.test = { status: s, at: 'just now' }; return s; };
  function usedBy(st, id) { return V.RULES.filter((r) => r.agentId === id).map((r) => r.cmd); }

  /* ---------- tab and URL helpers ---------- */
  const base = (ctx) => '/o/' + ctx.orgSlug + '/p/' + ctx.params.project + '/desk/agent';
  const keepScen = (q) => (q.s && /^ag-/.test(q.s) ? { s: q.s } : {});
  const tabHref = (ctx) => (id) => AD.href(base(ctx), Object.assign({}, keepScen(ctx.q), { tab: id === 'agents' ? null : id }));

  /* ---------- scroll areas: remember where each one was across re-renders (a new pane or tab starts at the top) ---------- */
  const scKey = (el) => el.dataset.sc + ':' + ((AD.cur && AD.cur.q && (AD.cur.q.tab || '') + '/' + (AD.cur.q.agent || '') + '/' + (AD.cur.q.page || '')) || '');
  document.addEventListener('scroll', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.sc && AD.ui.ag && AD.ui.ag.sc) AD.ui.ag.sc[scKey(t)] = t.scrollTop;
  }, true);
  function restoreScroll(stage) {
    const sc = AD.ui.ag && AD.ui.ag.sc; if (!sc) return;
    stage.querySelectorAll('[data-sc]').forEach((el) => { const v = sc[scKey(el)]; if (v) el.scrollTop = v; });
  }

  /* ---------- render ---------- */
  const DESK_FRAME = () => AD.B.DeskAgentList.body;
  function liveOut(ctx, a) {
    const s = ctx.scen;
    const st = store(ctx.orgSlug, ctx.params.project, variantOf(s));
    const u = ui([ctx.orgSlug, ctx.params.project, s].join('/'));
    let tab = ['github', 'limits', 'danger'].includes(ctx.q.tab) ? ctx.q.tab : 'agents';
    if (tab === 'danger' && !a.danger) { tab = 'agents'; setTimeout(() => AD.setQuery({ tab: null }, { replace: true }), 0); } // BR-57
    const o = { live: true, can: { write: a.write, secret: a.secret }, tab, canDanger: a.danger, href: tabHref(ctx) };
    let body;
    const d = AD.ui.dialog && AD.ui.dialog.type === 'ag-delete' ? AD.ui.dialog : null;
    if (tab === 'agents') {
      const param = ctx.q.agent;
      // pane selection comes from the URL (?agent=new | <id>); the typed values live in ui.form until the param changes
      let pane = null;
      if (param === 'new' && a.write) { if (u.formKey !== 'new') { u.form = newAdd(); u.formKey = 'new'; } pane = u.form; }
      else if (param && param !== 'new') {
        const ag = findAgent(st, param);
        if (u.formKey !== param) { u.form = ag ? editForm(ag, !a.write) : { mode: 'gone' }; u.formKey = param; }
        if (u.form && u.form.mode !== 'gone' && !ag) u.form = { mode: 'gone' };
        pane = u.form;
      } else { u.form = null; u.formKey = null; }
      const all = ordered(st);
      const pg = V.pageInfo(all, parseInt(ctx.q.page, 10) || 1, AD.pageSize());
      if (ctx.q.page && pg.page !== parseInt(ctx.q.page, 10)) setTimeout(() => AD.setQuery({ page: pg.page === 1 ? null : pg.page }, { replace: true }), 0);
      const state = s === 'loading' ? 'loading' : s === 'error' ? 'error' : all.length ? 'ready' : 'empty';
      const menuId = /^row:/.test(AD.ui.menu || '') ? AD.ui.menu.slice(4) : null;
      body = V.agents(Object.assign({}, o, { state, rows: pg.rows, page: pg, pane, selectedId: pane && pane.agent ? pane.agent.id : null, menuId, testingId: u.testingId, reqId: u.reqId }));
    } else if (tab === 'github') {
      const state = s === 'loading' ? 'loading' : s === 'error' ? 'error' : 'ready';
      body = V.github(Object.assign({ state }, st.gh, u.gh), o);
    } else if (tab === 'limits') {
      if (!u.lim.values) u.lim.values = Object.assign({}, st.limits);
      body = V.limits({ values: u.lim.values, errors: u.lim.errors, saving: u.lim.saving, banner: u.lim.banner, readOnly: !a.write }, o);
    } else {
      body = V.danger(o);
    }
    const frame = DESK_FRAME();
    const mainOld = frame.match(/<main[\s\S]*<\/main>/)[0];
    let html = AD.fixLinks(frame.replace(mainOld, () => V.main(Object.assign({}, o, { body }))));
    if (d) html += V.deleteDialog(d, o);
    if (!ctx.perm.orgAdmin && !(ctx.perm.adminProjects || []).includes(ctx.params.project)) html = AD.stripDeskAccess(html);
    const focus = u.focus; u.focus = null;
    // The page is as tall as the window and never scrolls: the list, the pane body and the tab panels scroll inside themselves.
    return {
      header: 'project', h: 1, fixed: true, title: 'Desk, Agent & settings', html, sample: true,
      after(stage) {
        restoreScroll(stage);
        const el = focus && stage.querySelector(focus);
        if (el) el.focus();
        else if (d) { const b = stage.querySelector('.overlay .d-f .btn:last-child'); if (b) b.focus(); }
        const pop = stage.querySelector('.pop[role="menu"]'); if (pop) pop.scrollIntoView({ block: 'nearest' });
      },
    };
  }

  function renderAgent(ctx) {
    const s = ctx.scen;
    if (s !== 'live' && AD.B[s]) return AD.boardOut(s, Object.assign({ sample: true }, NEW_BOARD.test(s) ? { h: 1, fixed: true } : {}));
    const visible = AD.visibleProjects(ctx.uid, ctx.orgSlug).some((p) => p.id === ctx.params.project);
    if (!visible) return AD.notFoundOut('This project does not exist, or you cannot see it.');
    if (s === 'crash') return AD.boardOut('RouteError');
    const a = access(ctx);
    if (s === 'forbidden' || !a.read) return { header: 'project', h: 900, title: 'No access', html: AD.forbiddenMain };
    return liveOut(ctx, a);
  }

  /* ---------- actions ---------- */
  function rerender(focus) { const u = AD.ui.ag; if (u && focus) u.focus = focus; AD.render(); }
  // typing re-renders only when a state flips (address changed or not); keep the caret
  function rerenderKeepFocus() {
    const el = document.activeElement; const id = el && el.id; const pos = el && el.selectionStart;
    AD.render();
    const n = id && document.getElementById(id);
    if (n) { n.focus(); try { if (pos != null) n.setSelectionRange(pos, pos); } catch (e) { /* not a text input */ } }
  }
  const form = () => AD.ui.ag && AD.ui.ag.form;
  A['ag-add'] = () => { AD.ui.menu = null; AD.ui.ag.formKey = null; AD.ui.ag.opener = null; AD.setQuery({ agent: 'new' }); setTimeout(() => { const c = document.querySelector('[role="radio"]'); if (c) c.focus(); }, 0); };
  A['ag-edit'] = (el) => { AD.ui.menu = null; AD.ui.ag.formKey = null; AD.ui.ag.opener = '[data-act="ag-edit"][data-id="' + el.dataset.id + '"]'; AD.setQuery({ agent: el.dataset.id }); };
  A['ag-close'] = () => {
    const u = AD.ui.ag; if (!u || (u.form && u.form.step)) return;
    const op = u.opener; u.focus = op || '[data-act="ag-add"]'; u.form = null; u.formKey = null;
    AD.setQuery({ agent: null });
  };
  A['ag-retry'] = () => AD.setQuery({ s: null });
  A['ag-page'] = (el) => { if (el.disabled) return; AD.ui.ag.formKey = null; AD.setQuery({ page: el.dataset.page === '1' ? null : el.dataset.page }); };
  A['ag-provider'] = (el) => { const f = form(); if (!f || f.step) return; chooseKind(f, el.dataset.id); rerender('[role="radio"][aria-checked="true"]'); };
  A['ag-auth'] = (el) => { const f = form(); if (!f || f.step) return; if (f.auth !== el.dataset.id) setAuth(f, el.dataset.id); rerender('[data-act="ag-auth"][aria-pressed="true"]'); };
  A['ag-def-toggle'] = () => { const f = form(); if (!f || f.step) return; f.makeDefault = !f.makeDefault; rerender('#ag-def'); };
  A['ag-replace'] = () => { const f = form(); if (!f) return; f.replacing = true; f.token = ''; rerender('#ag-token'); };
  A['ag-replace-cancel'] = () => { const f = form(); if (!f || f.step) return; f.replacing = false; f.token = ''; f.baseUrl = f.origBaseUrl; f.auth = V.kindOf(f.kind).credentialOptional && !f.agent.cred ? null : f.agent.auth; f.model = f.agent.model; f.typedModel = null; f.errors = {}; rerender('[data-act="ag-replace"]'); };

  AD.inputs.ag = (t) => {
    const f = form(); if (!f) return;
    const key = t.dataset.f;
    if (key === 'model') {
      if (/^Other model/.test(t.value)) { f.model = '_other'; f.typedModel = f.typedModel == null ? '' : f.typedModel; rerender('#ag-model-typed'); return; }
      f.model = t.value === 'OpenCode default' ? '' : t.value; f.typedModel = null; f.errors.model = null; return;
    }
    const before = f.mode !== 'add' && V.addrOn(V.kindOf(f.kind), f.auth) && f.baseUrl !== f.origBaseUrl;
    f[key] = t.value;
    if (f.errors && f.errors[key === 'typedModel' ? 'model' : key]) { f.errors[key === 'typedModel' ? 'model' : key] = null; const e = document.getElementById(t.id + 'e'); if (e) e.remove(); t.classList.remove('bad'); t.removeAttribute('aria-invalid'); }
    if (key === 'token' || key === 'baseUrl') { const kd = V.kindOf(f.kind); const b = AD.$('[data-act="ag-cred-save"]'); if (b) b.disabled = !(f.token || (kd.addrAuth && f.auth === kd.addrAuth && f.baseUrl)) || !!f.step; }
    if (key === 'baseUrl' && f.mode !== 'add') { const after = f.baseUrl !== f.origBaseUrl; if (after !== before) rerenderKeepFocus(); }
  };

  /* Save agent: add = create, then the credential, then the test; edit = PATCH. A failed test is a result, not an error. */
  A['ag-save'] = () => {
    const f = form(); const u = AD.ui.ag; if (!f || f.step) return;
    const st = curStore();
    f.banner = null;
    if (f.mode === 'add') {
      if (!f.kind) return;
      f.errors = checkForm(f, st, null);
      if (Object.keys(f.errors).length) { u.focus = f.errors.name ? '#ag-name' : f.errors.baseUrl ? '#ag-addr' : f.errors.token ? '#ag-token' : '#ag-model-typed'; AD.render(); return; }
      const fail = AD.takeFail();
      f.step = 'agent'; AD.render();
      lag(() => {
        if (fail === '403' || (fail === '500' && !f.token)) { f.step = null; f.banner = fail === '403' ? NO_ACCESS() : problem(500, 'Internal server error'); AD.render(); return; }
        if (fail === '409') { f.step = null; f.errors = { name: 'An agent with this name already exists.' }; u.focus = '#ag-name'; AD.render(); return; }
        const a = { id: 'a-n' + (st.seq++), name: f.name.trim(), kind: f.kind, label: f.label.trim(), auth: f.auth, model: modelOf(f), baseUrl: '', maxTurns: '', isDefault: !st.agents.length, cred: null, test: null };
        st.agents.push(a);
        const done = (extraToast) => {
          if (f.makeDefault && !a.isDefault) { st.agents.forEach((x) => { x.isDefault = x === a; }); }
          u.form = null; u.formKey = null; u.focus = '[data-act="ag-add"]';
          AD.setQuery({ agent: null });
          AD.toast('ok', 'Agent saved');
          if (f.makeDefault) AD.toast('ok', 'Default agent changed. New runs only.');
        };
        if (!f.token) { f.step = null; done(); return; }
        f.step = 'credential'; AD.render();
        lag(() => {
          if (fail === '500') {
            // the agent exists now: the pane switches to editing it and keeps what was typed (retry skips create)
            f.step = null;
            const ef = editForm(a); ef.token = f.token; ef.auth = f.auth; ef.baseUrl = f.baseUrl; ef.replacing = true; ef.model = f.model; ef.typedModel = f.typedModel; ef.makeDefault = f.makeDefault;
            ef.banner = { title: 'Agent saved, credential not saved: Internal server error', detail: 'Your typed values are kept. Save the credential again; the agent is not created twice.', reqId: AD.reqId() };
            u.form = ef; u.formKey = a.id; u.focus = '#ag-token';
            AD.setQuery({ agent: a.id }, { replace: true });
            return;
          }
          setCred(a, f);
          f.step = 'test'; AD.render();
          lag(() => { runTest(a); f.step = null; done(); }, 800);
        });
      });
      return;
    }
    // edit: PATCH name, label, model, max turns
    f.errors = checkForm(f, st, f.agent.id);
    if (Object.keys(f.errors).length) { u.focus = f.errors.name ? '#ag-name' : f.errors.model ? '#ag-model-typed' : '#ag-turns'; AD.render(); return; }
    const fail = AD.takeFail();
    f.step = 'agent'; AD.render();
    lag(() => {
      f.step = null;
      const a = findAgent(st, f.agent.id);
      if (fail === '404' || !a) { if (a) st.agents.splice(st.agents.indexOf(a), 1); u.form = { mode: 'gone' }; AD.render(); return; }
      if (fail === '403') { f.banner = NO_ACCESS(); AD.render(); return; }
      if (fail === '500') { f.banner = problem(500, 'Internal server error'); AD.render(); return; }
      if (fail === '409') { f.errors = { name: 'An agent with this name already exists.' }; u.focus = '#ag-name'; AD.render(); return; }
      a.name = f.name.trim(); a.label = f.label.trim(); a.model = modelOf(f); a.maxTurns = String(f.maxTurns || '').trim();
      let msg = 'Agent saved';
      if (f.makeDefault && !a.isDefault) { st.agents.forEach((x) => { x.isDefault = x === a; }); }
      u.form = null; u.formKey = null; u.focus = a.id ? '[data-act="ag-edit"][data-id="' + a.id + '"]' : null;
      AD.setQuery({ agent: null });
      AD.toast('ok', msg);
      if (f.makeDefault) AD.toast('ok', 'Default agent changed. New runs only.');
    });
  };

  /* Replace credential (and the API address with it): save, then test; the result updates the row. */
  A['ag-cred-save'] = () => {
    const f = form(); const u = AD.ui.ag; if (!f || f.step) return;
    const kd = V.kindOf(f.kind);
    if (!f.token && !(kd.addrAuth && f.auth === kd.addrAuth && f.baseUrl)) return;
    const st = curStore(); const a = findAgent(st, f.agent.id);
    f.banner = null; f.errors = {};
    // OpenCode: the endpoint and its key are saved together
    if (kd.addrAuth && f.auth === kd.addrAuth) {
      if (!(f.token || '').trim()) { f.errors.token = 'Enter the API key for this endpoint.'; u.focus = '#ag-token'; AD.render(); return; }
      if (!(f.baseUrl || '').trim()) { f.errors.baseUrl = 'Enter the API endpoint for this key.'; u.focus = '#ag-addr'; AD.render(); return; }
      if (!modelOf(f)) { f.errors.model = 'Enter the model your endpoint serves.'; u.focus = '#ag-model-typed'; AD.render(); return; }
    }
    const ae = validateAddress(kd, (f.baseUrl || '').trim(), f.auth);
    if (ae) { f.errors.baseUrl = ae; u.focus = '#ag-addr'; AD.render(); return; }
    const fail = AD.takeFail();
    f.step = 'credential'; AD.render();
    lag(() => {
      if (fail === '404' || !a) { f.step = null; u.form = { mode: 'gone' }; if (a) st.agents.splice(st.agents.indexOf(a), 1); AD.render(); return; }
      if (fail === '403' || fail === '500') { f.step = null; f.banner = fail === '403' ? NO_ACCESS() : problem(500, 'Internal server error'); AD.render(); return; }
      setCred(a, f);
      if (kd.modelOptional) a.model = modelOf(f);
      f.agent = a; f.origBaseUrl = a.baseUrl; f.baseUrl = a.baseUrl; f.modelState = 'ready';
      f.step = 'test'; AD.render();
      lag(() => {
        const r = runTest(a);
        f.step = null; f.replacing = false; f.token = ''; f.result = { status: r }; f.modelState = r === 'unreachable' || r === 'rejected' ? 'fallback' : 'ready';
        AD.render();
      }, 800);
    });
  };

  // Test connection from the row menu or the pane
  function doTest(id, inPane) {
    const u = AD.ui.ag; const st = curStore(); const a = findAgent(st, id);
    const fail = AD.takeFail();
    const f = inPane ? form() : null;
    if (inPane && f) { f.testing = true; f.result = null; } else u.testingId = id;
    AD.ui.menu = null; AD.render();
    lag(() => {
      if (inPane && f) f.testing = false; else u.testingId = null;
      if (fail === '404' || !a) { if (a) st.agents.splice(st.agents.indexOf(a), 1); if (inPane) u.form = { mode: 'gone' }; AD.render(); if (!inPane) AD.toast('err', 'This agent no longer exists'); return; }
      if (fail === '403' || fail === '500') { AD.render(); AD.toast('err', fail === '403' ? "You don't have access" : 'Internal server error', fail === '500' ? 'Request ID: ' + AD.reqId() : null); return; }
      const r = runTest(a);
      if (inPane && f) f.result = { status: r };
      AD.render();
    }, 900);
  }
  A['ag-test'] = (el) => doTest(el.dataset.id, false);
  A['ag-test-pane'] = () => { const f = form(); if (f && f.agent && !f.testing) doTest(f.agent.id, true); };

  A['ag-setdefault'] = (el) => {
    const id = el.dataset.id; const st = curStore(); const u = AD.ui.ag;
    AD.ui.menu = null; u.busyId = id; AD.render();
    const fail = AD.takeFail();
    lag(() => {
      u.busyId = null;
      if (fail === '403' || fail === '500') { AD.render(); AD.toast('err', fail === '403' ? "You don't have access" : 'Internal server error', fail === '500' ? 'Request ID: ' + AD.reqId() : null); return; }
      const a = findAgent(st, id);
      if (!a) { AD.render(); AD.toast('err', 'This agent no longer exists'); return; }
      st.agents.forEach((x) => { x.isDefault = x === a; });
      AD.render();
      AD.toast('ok', 'Default agent changed. New runs only.');
    }, 500);
  };

  A['ag-delete'] = (el) => {
    const st0 = curStore(); const a = findAgent(st0, el.dataset.id); if (!a || a.isDefault || st0.agents.length < 2) return;
    AD.ui.menu = null;
    AD.ui.dialog = { type: 'ag-delete', id: a.id, name: a.name, state: 'confirm' };
    AD.render();
  };
  A['ag-delete-confirm'] = () => {
    const d = AD.ui.dialog; if (!d || d.state === 'deleting') return;
    const st = curStore(); const u = AD.ui.ag;
    d.state = 'deleting'; AD.render();
    const fail = AD.takeFail();
    lag(() => {
      const a = findAgent(st, d.id);
      const rules = usedBy(st, d.id);
      if (fail === '500' || fail === '403') { d.state = 'error'; d.reqId = AD.reqId(); AD.render(); return; }
      if (a && st.agents.length < 2) { d.state = 'blocked'; d.title = 'A project needs at least one agent'; d.detail = 'Add another agent first, then delete this one.'; AD.render(); return; }
      if (a && a.isDefault) { d.state = 'blocked'; d.title = 'This is the project default'; d.detail = 'Set another agent as default first, then delete this one.'; AD.render(); return; }
      if (a && rules.length) { d.state = 'blocked'; d.title = 'A routing rule uses this agent'; d.detail = rules.length + (rules.length === 1 ? ' rule names it: ' : ' rules name it: ') + rules.join(', ') + '. Point ' + (rules.length === 1 ? 'it' : 'them') + ' at another agent first, then delete.'; AD.render(); return; }
      if (a && (V.LEGACY_RUN.agentId === a.id || fail === '409')) { d.state = 'blocked'; d.title = 'This agent has open runs'; d.detail = V.LEGACY_RUN.text + ' Finish it first, then delete.'; AD.render(); return; }
      if (a) st.agents.splice(st.agents.indexOf(a), 1);
      AD.ui.dialog = null;
      const wasOpen = u.form && u.form.agent && u.form.agent.id === d.id;
      if (wasOpen) { u.form = null; u.formKey = null; AD.setQuery({ agent: null }); } else AD.render();
      AD.toast('ok', 'Agent deleted');
    }, 700);
  };

  /* GitHub connection tab */
  A['gh-mode'] = (el) => {
    const st = curStore(); const u = AD.ui.ag; const id = el.dataset.id;
    if (st.gh.mode === id) return;
    const fail = AD.takeFail();
    if (fail) { u.gh.triggerError = fail === '403' ? "You don't have access" : 'Internal server error'; AD.render(); return; }
    u.gh.triggerError = null; u.gh.refused = false; st.gh.mode = id; AD.render();
  };
  A['gh-interval'] = (el) => {
    const st = curStore(); const u = AD.ui.ag;
    const fail = AD.takeFail();
    if (fail) { u.gh.triggerError = 'Internal server error'; AD.render(); return; }
    u.gh.triggerError = null; st.gh.interval = el.dataset.id; AD.render();
  };
  A['gh-check'] = () => {
    const u = AD.ui.ag; if (u.gh.checking) return;
    const fail = AD.takeFail();
    u.gh.checking = true; u.gh.refused = false; u.focus = '[data-act="gh-check"]'; AD.render();
    lag(() => {
      u.gh.checking = false;
      if (fail) { u.gh.refused = true; AD.render(); return; }
      AD.render(); AD.toast('ok', 'Checked just now', 'No new comments.');
    }, 800);
  };
  A['gh-ping'] = () => { const fail = AD.takeFail(); if (fail) { AD.toast('err', 'Internal server error', 'Request ID: ' + AD.reqId()); return; } AD.toast('ok', 'Test ping sent', 'GitHub answered with 200.'); };

  /* Limits tab */
  const DUR = { minutes: 1, hours: 60, days: 1440 };
  const NUM_RULES = { idle: [1, 1440, 'minutes'], concurrent: [1, 20], perTicket: [1, 200], autoResume: [0, 10] };
  A['lim-save'] = () => {
    const u = AD.ui.ag; const l = u.lim; if (l.saving) return;
    const v = l.values; const e = {};
    const whole = (x) => /^\d+$/.test(String(x).trim());
    [['timeout', 1, 10080, 'Run time limit'], ['pausedKeep', 1, 43200, 'Keep a paused run for'], ['doneKeep', 0, 43200, 'Keep a finished run’s session for']].forEach(([k, lo, hi]) => {
      if (!whole(v[k])) e[k] = 'Enter a whole number.';
      else { const m = Number(v[k]) * DUR[v[k + 'Unit']]; if (m < lo || m > hi) e[k] = m > hi ? 'Too big: expected a value of at most ' + hi + ' minutes.' : 'Too small: expected a value of at least ' + lo + ' minute.'; }
    });
    Object.keys(NUM_RULES).forEach((k) => {
      const [lo, hi] = NUM_RULES[k];
      if (!whole(v[k])) e[k] = 'Enter a whole number.';
      else if (Number(v[k]) < lo || Number(v[k]) > hi) e[k] = k === 'autoResume' ? 'Automatic resumes must be between 0 and 10' : 'Use a value from ' + lo + ' to ' + hi + '.';
    });
    l.errors = e; l.banner = null;
    if (Object.keys(e).length) { u.focus = '#' + ({ timeout: 'l1', pausedKeep: 'l2', doneKeep: 'l3', idle: 'l4', concurrent: 'l5', perTicket: 'l6', autoResume: 'l7' }[Object.keys(e)[0]]); AD.render(); return; }
    const fail = AD.takeFail();
    l.saving = true; AD.render();
    lag(() => {
      l.saving = false;
      if (fail === '403' || fail === '500') { l.banner = fail === '403' ? NO_ACCESS() : problem(500, 'Internal server error', 'Your values are still here. Try saving again.'); AD.render(); return; }
      Object.assign(curStore().limits, v);
      AD.render(); AD.toast('ok', 'Limits saved', 'They apply to runs of every agent in this project.');
    }, 650);
  };
  AD.inputs.lim = (t) => {
    const l = AD.ui.ag && AD.ui.ag.lim; if (!l || !l.values) return;
    l.values[t.dataset.f] = t.value;
    const k = t.dataset.f.replace(/Unit$/, '');
    if (l.errors[k]) { l.errors[k] = null; const e = document.getElementById(t.id + 'e'); if (e) e.remove(); t.classList.remove('bad'); t.removeAttribute('aria-invalid'); }
  };
  A['dng-delete'] = () => AD.toast('off', 'Not wired in this prototype', 'Delete project is the existing flow and is not drawn again here.');

  /* keyboard: arrows, Home and End move between the tabs; Escape closes the pane unless a save runs */
  document.addEventListener('keydown', (e) => {
    const tab = e.target.closest && e.target.closest('#stage [role="tab"][data-tab]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      const tabs = AD.$$('#stage [role="tab"][data-tab]'); const i = tabs.indexOf(tab);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      e.preventDefault(); AD.ui.ag.focus = '#agent-settings-tab-' + tabs[n].dataset.tab;
      location.hash = tabs[n].getAttribute('href');
      return;
    }
    if (e.key === 'Escape' && !AD.ui.dialog && !AD.ui.menu && AD.cur && AD.cur.q && AD.cur.q.agent && AD.ui.ag && AD.ui.ag.form && !AD.ui.ag.form.step) A['ag-close']();
    if ((e.key === ' ' || e.key === 'Enter') && e.target.matches && e.target.matches('#stage [role="radio"][data-act="ag-provider"], #stage [role="checkbox"][data-act]')) { e.preventDefault(); A[e.target.dataset.act](e.target); }
  });

  /* ---------- Routing rules and setup step 2: swap in the new boards, with small live touches ---------- */
  const RULES_BOARDS = /^DeskRulesAgent/;
  const rulesPath = () => '/o/' + AD.curOrg() + '/p/' + AD.curProject() + '/desk/rules';
  const baseEnhance = AD.enhanceBoard;
  AD.enhanceBoard = function (root, name) {
    baseEnhance(root, name);
    if (!name) return;
    if (/^DeskAgent/.test(name)) {
      // The Danger zone tab is not drawn as a board; its link opens the live tab
      AD.$$('[role="tab"][href="#"]', root).forEach((t) => { t.setAttribute('data-act', 'go'); t.setAttribute('data-href', AD.href('/o/' + AD.curOrg() + '/p/' + AD.curProject() + '/desk/agent', { tab: 'danger' })); });
    }
    if (RULES_BOARDS.test(name)) {
      const triage = AD.$$('.cmd', root).find((c) => c.textContent.trim() === '/triage');
      const listRow = triage && triage.closest('div[style*="grid-template-columns:44px"]');
      if (name === 'DeskRulesAgentWarning' && listRow) { listRow.setAttribute('data-act', 'go'); listRow.setAttribute('data-href', AD.href(rulesPath(), { s: 'DeskRulesAgent' })); listRow.style.cursor = 'pointer'; listRow.setAttribute('title', 'Open this rule'); }
      if (name !== 'DeskRulesAgentWarning') {
        const back = (btn) => { btn.setAttribute('data-act', 'go'); btn.setAttribute('data-href', AD.href(rulesPath(), {})); };
        AD.$$('aside button', root).forEach((b) => { const t = (b.getAttribute('aria-label') || b.textContent).trim(); if (t === 'Close' || t === 'Cancel') back(b); if (t === 'Save rule') { b.setAttribute('data-act', 'rule-save'); } });
        const ra = AD.$('#ra', root);
        if (ra && !ra.disabled) ra.setAttribute('data-act', 'rule-agent');
      }
    }
  };
  A['rule-save'] = () => { AD.toast('ok', 'Rule saved'); location.hash = AD.href(rulesPath(), {}); };
  // Picking another agent resets Model to "Default model" and names that agent's default model (BR-40)
  document.addEventListener('change', (e) => {
    const sel = e.target;
    if (!sel.matches || !sel.matches('#stage select#ra[data-act="rule-agent"]')) return;
    const st = AD.state.agentDesk && AD.state.agentDesk[AD.curOrg() + '/' + AD.curProject() + '/main'];
    const agents = st ? st.agents : V.seed();
    const text = sel.options[sel.selectedIndex].text.replace(/ \(unavailable\)$/, '');
    const isDefault = /^Project default/.test(text);
    const def = agents.find((a) => a.isDefault) || agents[0];
    const ag = isDefault ? def : agents.find((a) => a.name === text);
    const slot = AD.$('#stage aside .sentence .slot:last-of-type') || [].slice.call(document.querySelectorAll('#stage aside .sentence .slot')).pop();
    if (slot) slot.textContent = isDefault ? 'the project default agent' : text;
    const rm = AD.$('#stage #rm');
    if (rm && ag) {
      rm.innerHTML = '<option selected>Default model</option>' + V.modelsFor(ag.kind, ag.auth).map((m) => '<option>' + esc(m) + '</option>').join('') + '<option>Other model…</option>';
      const help = rm.parentNode.querySelector('.help');
      if (help) help.innerHTML = 'Default model of ' + esc(ag.name) + ' is <span class="mono" style="white-space:nowrap">' + esc(ag.model) + '</span>, set on <a href="' + AD.href('/o/' + AD.curOrg() + '/p/' + AD.curProject() + '/desk/agent', {}) + '">Agent &amp; settings</a>.';
    }
  });

  /* ---------- New-project wizard, step 2 "Add agent" (live): pick the agent you work with, set up that one ----------
     Continue = create or choose the agent, save the credential, test it (the order in architecture 4a); a rejected or unreachable
     test stays on the step with "Continue anyway". A credential that contains "reject" gives Credential rejected, "unreach" Can't
     reach address, "odd" Can't verify; an OpenCode credentials file answers Not checkable (it cannot be probed). Scenarios w2-* seed the states of the story list. */
  const newW2 = () => ({ kind: null, auth: null, token: '', baseUrl: '', model: null, typedModel: null, concurrent: '2', errors: {}, banner: null, step: null, result: null, modelState: 'standard', showSecret: false, seeded: null, returning: false, touched: false });
  const w2form = () => { if (!AD.ui.w2) AD.ui.w2 = newW2(); return AD.ui.w2; };
  const W2_SNAPS = [['w2-none', 'Nothing picked, Continue pressed (error under the cards)'], ['w2-claude', 'Claude Code picked (address field shown)'], ['w2-codex', 'OpenAI Codex picked (sign-in file or API key, no address)'],
    ['w2-opencode', 'OpenCode picked (API endpoint and key chosen, model required)'], ['w2-saving', 'Saving the credential'], ['w2-errors', 'Field errors'], ['w2-rejected', 'Test failed: Credential rejected, Continue anyway'],
    ['w2-returning', 'Coming back to the step (agent already set up, provider fixed)']].map(([id, label]) => ({ id, label, group: 'Agent step states (live, clickable)' }));
  function seedW2(scen) {
    const f = newW2(); f.seeded = scen;
    if (scen === 'w2-none') f.errors.kind = true;
    if (['w2-claude', 'w2-saving', 'w2-errors', 'w2-rejected'].includes(scen)) chooseKind(f, 'claude');
    if (scen === 'w2-codex') chooseKind(f, 'codex');
    if (scen === 'w2-opencode') { chooseKind(f, 'opencode'); setAuth(f, 'api_key'); f.baseUrl = 'https://llm.harbor-labs.dev/v1'; f.token = 'sk-xxxxxxxxxxxxxxxx'; }
    if (scen === 'w2-saving') { f.token = 'sk-ant-oat01-xxxxxxxxxxxx'; f.step = 'credential'; }
    if (scen === 'w2-errors') { f.model = '_other'; f.typedModel = ''; f.concurrent = '25'; f.errors = { token: 'Paste the token to continue.', model: 'Enter a model name.', concurrent: 'Use a value from 1 to 20.' }; }
    if (scen === 'w2-rejected') { f.auth = 'api_key'; f.token = 'sk-ant-api03-reject-xxxx'; f.result = { status: 'rejected' }; }
    if (scen === 'w2-returning') { const w = AD.state.wiz || { kind: 'claude', model: 'opus' }; Object.assign(f, { kind: w.kind, auth: w.auth !== undefined ? w.auth : (V.authsOf(w.kind)[0] || {}).id, model: w.model, returning: true }); }
    AD.ui.w2 = f; return f;
  }
  function liveW2(ctx) {
    let f = w2form();
    const scen = ctx.scen;
    if (/^w2-/.test(scen)) { if (f.seeded !== scen) f = seedW2(scen); }
    else {
      if (f.seeded) f = AD.ui.w2 = newW2();
      if (AD.state.wiz && !f.touched && !f.kind) { f.returning = true; f.kind = AD.state.wiz.kind; f.auth = AD.state.wiz.auth !== undefined ? AD.state.wiz.auth : (V.authsOf(f.kind)[0] || {}).id; f.model = AD.state.wiz.model; }
    }
    const b = AD.B.Setup2DefaultAgent;
    const html = AD.fixLinks(b.body).replace(/<main[\s\S]*<\/main>/, () => V.setupAgent(f, { live: true, on: 'w2', can: { write: true, secret: true } }));
    const focus = f.focus; f.focus = null;
    return { header: b.kind, h: 1, fixed: true, title: b.title, html, after(stage) { restoreScroll(stage); const el = focus && stage.querySelector(focus); if (el) el.focus(); } };
  }
  const wizResult = (f) => {
    if (f.kind === 'opencode' && (f.auth !== 'api_key' || !f.token.trim())) return 'unsupported'; // a credentials file, or nothing, cannot be probed
    if (/reject|bad|wrong/i.test(f.token)) return 'rejected';
    if (/unreach/i.test(f.token) || /unreach/i.test(f.baseUrl)) return 'unreachable';
    if (/odd|invalid/i.test(f.token)) return 'invalid';
    return 'ok';
  };
  function wizDone(f) {
    const kd = V.kindOf(f.kind);
    AD.state.wiz = { kind: f.kind, auth: f.auth, label: kd.label, name: kd.label, model: modelOf(f) };
    AD.ui.w2 = null;
    AD.nav('/o/' + AD.curOrg() + '/projects/new/3');
  }
  A['w2-provider'] = (el) => { const f = w2form(); if (f.step || f.returning) return; f.touched = true; chooseKind(f, el.dataset.id); f.result = null; f.banner = null; f.modelState = 'standard'; f.focus = '[role="radio"][aria-checked="true"]'; AD.render(); };
  A['w2-auth'] = (el) => { const f = w2form(); if (f.step) return; f.touched = true; if (f.auth !== el.dataset.id) setAuth(f, el.dataset.id); f.token = ''; f.errors.token = null; f.result = null; f.focus = '[data-act="w2-auth"][aria-checked="true"]'; AD.render(); };
  A['w2-show'] = () => { const f = w2form(); f.showSecret = !f.showSecret; f.focus = '[data-act="w2-show"]'; AD.render(); };
  A['w2-back'] = () => { if (!w2form().step) AD.nav('/o/' + AD.curOrg() + '/projects/new/1'); };
  A['w2-anyway'] = () => { const f = w2form(); if (f.step || !f.result) return; wizDone(f); };
  // OpenCode in the wizard: an endpoint and its key go together; the model is required with an endpoint
  function checkWiz(f, kd) {
    const e = {};
    if (!kd.modelOptional) return e;
    const key = f.auth === 'api_key'; const hasT = !!f.token.trim(); const hasA = !!(f.baseUrl || '').trim();
    if (key && hasT && !hasA) e.baseUrl = 'Enter the API endpoint for this key.';
    if (key && hasA && !hasT) e.token = 'Enter the API key for this endpoint.';
    if (key && (hasT || hasA) && !modelOf(f)) e.model = 'Enter the model your endpoint serves.';
    return e;
  }
  A['w2-continue'] = () => {
    const f = w2form(); if (f.step) return;
    f.banner = null; f.result = null; f.errors = {};
    if (f.returning) { wizDone(f); return; }
    if (!f.kind) { f.errors.kind = true; f.focus = '[role="radio"]'; AD.render(); return; }
    const kd = V.kindOf(f.kind);
    const noCred = kd.credentialOptional; // OpenCode: an empty credential is valid (it works without signing in)
    if (!noCred && !f.token.trim()) { const au = V.authOf(f.kind, f.auth); f.errors.token = 'Paste ' + (au.paste || (au.id === 'auth_json' ? 'the file contents' : au.id === 'api_key' ? 'the key' : 'the token')) + ' to continue.'; }
    Object.assign(f.errors, checkWiz(f, kd));
    const ae = validateAddress(kd, (f.baseUrl || '').trim(), f.auth); if (ae) f.errors.baseUrl = ae;
    if (!kd.modelOptional && (f.model === '_other' || f.typedModel != null) && !(f.typedModel || '').trim()) f.errors.model = 'Enter a model name.';
    if (!/^\d+$/.test(String(f.concurrent).trim()) || Number(f.concurrent) < 1 || Number(f.concurrent) > 20) f.errors.concurrent = 'Use a value from 1 to 20.';
    if (Object.keys(f.errors).length) { f.focus = f.errors.baseUrl && f.errors.token ? '#ag-addr' : f.errors.token ? '#w-token' : f.errors.baseUrl ? '#ag-addr' : f.errors.model ? '#ag-model-typed' : '#w-conc'; AD.render(); return; }
    const fail = AD.takeFail();
    f.step = 'agent'; AD.render();
    lag(() => {
      if (fail === '403' || fail === '500') { f.step = null; f.banner = fail === '403' ? NO_ACCESS() : problem(500, 'Internal server error', 'Your values are still here. Try again.'); AD.render(); return; }
      if (kd.credentialOptional && !f.token.trim()) { f.step = null; wizDone(f); return; }
      f.step = 'credential'; AD.render();
      lag(() => {
        f.step = 'test'; AD.render();
        lag(() => {
          const r = wizResult(f); f.step = null; f.result = { status: r };
          if (r === 'rejected' || r === 'unreachable') { f.focus = '[data-act="w2-continue"]'; AD.render(); return; }
          wizDone(f);
        }, 800);
      }, 600);
    });
  };
  AD.inputs.w2 = (t) => {
    const f = w2form(); const key = t.dataset.f; f.touched = true;
    if (key === 'model') {
      if (/^Other model/.test(t.value)) { f.model = '_other'; f.typedModel = f.typedModel == null ? '' : f.typedModel; f.focus = '#ag-model-typed'; AD.render(); return; }
      f.model = t.value === 'OpenCode default' ? '' : t.value; f.typedModel = null; f.errors.model = null; return;
    }
    f[key] = t.value;
    const ek = key === 'typedModel' ? 'model' : key;
    if (f.errors[ek]) { f.errors[ek] = null; const e = document.getElementById(t.id + 'e'); if (e) e.remove(); t.classList.remove('bad'); t.removeAttribute('aria-invalid'); }
  };
  // later steps are static boards: they carry the chosen agent in the stepper and in the rule's agent field
  const baseEnh2 = AD.enhanceBoard;
  AD.enhanceBoard = function (root, name) {
    baseEnh2(root, name);
    const w = AD.state.wiz;
    if (!w || !/^(SetupWorkspace|Setup3|Setup4|SetupReady)$/.test(name || '')) return;
    AD.$$('.step .faint', root).forEach((e) => { if (e.textContent.trim() === 'Claude Code, opus') e.textContent = w.label + ', ' + (w.model || 'default model'); });
    AD.$$('#ra option', root).forEach((o) => { if (/^Project default/.test(o.textContent)) o.textContent = 'Project default (' + w.name + ')'; });
  };

  /* ---------- links between boards: the canonical new boards are the live screens ---------- */
  const baseRoute = AD.boardRoute;
  AD.boardRoute = function (name) {
    const o = '/o/' + AD.curOrg(); const p = o + '/p/' + AD.curProject();
    if (name === 'DeskAgentList') return { path: p + '/desk/agent', q: {} };
    if (name === 'DeskAgentGitHub') return { path: p + '/desk/agent', q: { tab: 'github' } };
    if (name === 'DeskAgentLimits') return { path: p + '/desk/agent', q: { tab: 'limits' } };
    if (name === 'DeskAgentDanger') return { path: p + '/desk/agent', q: { tab: 'danger' } };
    if (name === 'DeskRulesAgentWarning') return { path: p + '/desk/rules', q: {} };
    if (name === 'Setup2DefaultAgent') return { path: o + '/projects/new/2', q: {} };
    if (/^Setup2Agent/.test(name)) return { path: o + '/projects/new/2', q: { s: name } };
    return baseRoute(name);
  };

  /* ---------- hook into the Desk and setup screens ---------- */
  const desk = AD.screens.desk;
  const baseRender0 = desk.render.bind(desk);
  const NEW_BOARD = /^(DeskAgent(List|Add(?!ress)|Edit|Test|Delete|DefaultChanged|RowMenu|GitHub|Limits)|DeskRulesAgent)/;
  const baseRender = (ctx) => { const out = baseRender0(ctx); if (out && out.board && NEW_BOARD.test(out.board)) { out.h = 1; out.fixed = true; } return out; };
  const baseSnaps = desk.snaps;
  const AG_SNAPS = [
    ['ag-paged', 'Agents: more than one page (24 agents)'],
    ['ag-single', 'Agents: only one agent (Delete is disabled, a project needs one)'],
    ['ag-readonly', 'Read-only role (agent:read only): view agents, no actions'],
  ].map(([id, label]) => ({ id, label, group: 'Agent & settings states (live, clickable)' }));
  const OLD = /^DeskAgent(AddressChanged|AutoResume.*|CustomModel|ProjectAdmin)?$/;
  desk.snaps = (ctx) => {
    if (ctx.params.tab === 'agent') {
      const names = AD.boardNames(/^DeskAgent/);
      return AG_SNAPS.concat(AD.snapGroup(names.filter((n) => !OLD.test(n)), 'New boards: agents, tabs, limits (static, as drawn)'), AD.snapGroup(names.filter((n) => OLD.test(n)), 'Earlier boards: one page before the tab strip (static)'));
    }
    if (ctx.params.tab === 'rules') return AD.snapGroup(AD.boardNames(RULES_BOARDS), 'New boards: rules with an agent picker (static, as drawn)').concat(baseSnaps(ctx).filter((x) => !RULES_BOARDS.test(x.id)));
    return baseSnaps(ctx);
  };
  desk.render = (ctx) => {
    if (ctx.params.tab === 'agent') return renderAgent(ctx);
    if (ctx.params.tab === 'rules' && ctx.scen === 'live') {
      const g = AD.visibleProjects(ctx.uid, ctx.orgSlug).some((p) => p.id === ctx.params.project);
      if (!g) return baseRender(ctx);
      const out = baseRender(Object.assign({}, ctx, { scen: 'DeskRulesAgentWarning' }));
      if (out && out.board === 'DeskRulesAgentWarning') out.snapshot = false; // the default view of Routing rules, not a snapshot
      return out;
    }
    return baseRender(ctx);
  };
  const setup = AD.screens.setup;
  const baseSetup = setup.render.bind(setup);
  const baseSetupSnaps = setup.snaps;
  setup.snaps = (ctx) => (String(ctx.params.step) === '2' ? W2_SNAPS.concat(baseSetupSnaps(ctx)) : baseSetupSnaps(ctx));
  setup.render = (ctx) => {
    if (String(ctx.params.step) === '2') {
      const ok = ctx.perm && ctx.perm.createProject;
      if (ok && (ctx.scen === 'live' || /^w2-/.test(ctx.scen))) return liveW2(ctx);
      if (ok && /^Setup2(DefaultAgent|Agent)/.test(ctx.scen) && AD.B[ctx.scen]) return AD.boardOut(ctx.scen, { h: 1, fixed: true });
    }
    return baseSetup(ctx);
  };
})();
