/* Desk > Workspace setup, live: the "Setup script | Environment" tab strip (tab in the URL as ?tab=environment) and the
   Environment tab with its variables and secrets lists, working in memory. Built from the DeskSetup, DeskSetupTest and
   DeskSetupEnvironment* boards. Spec: docs/superpowers/specs/2026-11-23-workspace-env-secrets-design.md.
   The Setup script tab stays the drawn board (static, as before); only its tab strip is live.
   The other Desk tabs (skills, rules, agent) are untouched: this file only takes over desk/setup. */
(function () {
  'use strict';
  const AD = window.AD;
  const esc = AD.esc;
  const I = AD.I;

  /* ---------- copy (spec "UI and Storybook" > Copy; wording the spec leaves open is the boards') ---------- */
  const C = {
    intro: 'Every run and setup test in this project gets these as environment variables. Runs and tests that start after you save use the new values. A running run keeps its old ones: stop its session and resume it to pick up the change.',
    vars: { title: 'Environment variables', help: 'Plain values are shown in full and are not hidden in logs. Put anything sensitive in Secrets.', empty: 'No environment variables yet. Add one to pass a setting to every run.', add: 'Add variable', one: 'variable', many: 'variables', what: 'variables' },
    secrets: { title: 'Secrets', help: 'Write-only. After you save, a value is hidden for good: you can replace or remove it, not read it back.', empty: 'No secrets yet. Add one for the tokens and passwords your setup or agent needs.', add: 'Add secret', one: 'secret', many: 'secrets', what: 'secrets' },
    visibility: 'Setup scripts and the agent can read these values. Run output shows them as ***, but keep each secret to what this project needs.',
    readOnly: 'You can see these but not change them.',
    load: 'Could not load the environment. Reload to try again.',
    gone: 'This entry no longer exists. Reload the list.',
    testing: 'A test is running. It keeps the values it started with.',
    removeBody: 'Runs that start after this do not get it. Running runs keep it.',
  };

  /* ---------- limits (spec "Limits and validation") ---------- */
  const MAX_ENTRIES = 500; // PROJECT_ENV_MAX_ENTRIES default; the web learns it only from the 409
  const MAX_TOTAL = 262144; // ENV_MAX_TOTAL_BYTES, names and values of both kinds together
  const MAX_VALUE = 8192;
  const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const RESERVED = ['PATH', 'HOME', 'SHELL', 'IFS', 'PS4', 'ENV', 'NODE_OPTIONS', 'REPO_CLONE_URL', 'PROMPT', 'CHECKOUT_REF', 'RESUME_NOTE', 'MAX_TURNS', 'GH_TOKEN', 'GITHUB_TOKEN'];
  const RESERVED_PREFIX = ['BASH_', 'LD_', 'TMUX', 'KUBERNETES_', 'BOT_', 'RUN_', 'SETUP_', 'PLUGIN_', 'AGENT_', 'AGENTDESK_', 'ANTHROPIC_', 'CLAUDE_'];
  const bytes = (s) => new TextEncoder().encode(s).length;
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); // server order: name COLLATE "C" (byte order)
  const reserved = (n) => RESERVED.includes(n) || RESERVED_PREFIX.some((p) => n.startsWith(p));

  /* ---------- icons and small pieces (markup of the DeskSetupEnvironment* boards) ---------- */
  const svg = (w, d) => `<svg aria-hidden="true" class="" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    plus: svg(14, '<path d="M12 5v14M5 12h14"/>'),
    key: svg(14, '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>'),
    eye: svg(15, '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    info: svg(16, '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  };
  const SR = (t) => `<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${esc(t)}</span>`;
  const ROW = 'display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr) auto;gap:16px;align-items:center';
  const ROW_RO = 'display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);gap:16px;align-items:center';
  const ACTIVE = 'background:#1E2333;box-shadow:inset 0 0 0 1px #7C8FD8';
  const PANEL = 'display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid #7C8FD8;border-radius:8px;background:#1E2333';
  const liStyle = (i) => `list-style:none;${i ? 'border-top:1px solid var(--line);' : ''}`;
  const offNote = (t) => `<div class="banner off" role="note" style="align-items:center;padding:10px 14px"><span class="b-ico">${IC.info}</span><span class="muted" style="font-size:13px">${esc(t)}</span></div>`;
  const problemBanner = (e) => `<div class="banner err" role="alert" style="align-items:center"><span class="b-ico">${I.warn}</span><div class="grow" style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:600">${esc(e.title)}</b>${e.detail ? `<span style="font-size:12px" class="muted">${esc(e.detail)}</span>` : ''}${e.reqId ? `<span style="font-size:12px" class="muted">Request ID: <code class="mono" style="color:var(--text);font-size:12px">${esc(e.reqId)}</code></span>` : ''}</div>${e.retry ? `<button class="btn" data-act="retry">${I.retry}Retry</button>` : ''}</div>`;

  /* ---------- in-memory store: per org, project and data set ("main", "paged", "empty") ---------- */
  const V = (name, value) => ({ name, value, size: bytes(name) + bytes(value) });
  const S = (name, who, len) => ({ name, who, size: bytes(name) + (len || 32) }); // a secret keeps no value here, only its size
  function seedEnv(project, variant) {
    if (variant === 'paged') {
      const vars = ['APP_NAME', 'ASPNETCORE_ENVIRONMENT', 'AUTH_AUDIENCE', 'CACHE_TTL', 'CORS_ORIGINS', 'DB_HOST', 'DB_NAME', 'DB_PORT', 'DOTNET_CLI_TELEMETRY_OPTOUT', 'FEATURE_FLAGS', 'HTTP_TIMEOUT', 'INVOICE_PREFIX', 'LOG_FORMAT', 'LOG_LEVEL', 'MAX_UPLOAD_MB', 'METRICS_PORT', 'PDF_RENDERER', 'QUEUE_NAME', 'REDIS_HOST']
        .map((n, i) => V(n, ['invoicer', 'Development', 'invoicer-api', '300', 'https://app.harbor-labs.dev', 'db.internal', 'invoicer', '5432', '1', 'pdf-v2', '30', 'INV-', 'json', 'Information', '25', '9100', 'chromium', 'invoices', 'redis.internal'][i]))
        .concat([V('SMTP_HOST', 'mail.internal'), V('SMTP_PORT', '2525'), V('TZ', 'Europe/Berlin'), V('UPLOAD_DIR', '/tmp/uploads')]);
      const secrets = ['ADMIN_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'AZURE_STORAGE_KEY', 'DATADOG_API_KEY', 'DB_PASSWORD', 'DOCKER_REGISTRY_TOKEN', 'ENCRYPTION_KEY', 'GOOGLE_CLIENT_SECRET', 'JWT_SIGNING_KEY', 'MAILGUN_API_KEY', 'NPM_TOKEN', 'NUGET_API_KEY', 'OPENAI_API_KEY', 'PAGERDUTY_TOKEN', 'PDF_LICENSE_KEY', 'POSTMARK_TOKEN', 'REDIS_PASSWORD', 'S3_SECRET_KEY', 'SENTRY_AUTH_TOKEN', 'SLACK_WEBHOOK_SECRET']
        .map((n) => S(n, 'Set Nov 3 by dana-ortiz'))
        .concat([S('SMTP_PASSWORD', 'Set 5 days ago by kim-hale'), S('STRIPE_TEST_KEY', 'Set Nov 3 by dana-ortiz')]);
      // 23 variables (page 2 of 20 shows SMTP_PORT, TZ, UPLOAD_DIR, as on the Paged board) and 22 secrets
      return { vars: vars.sort(byName), secrets: secrets.sort(byName) };
    }
    if (variant === 'empty' || project !== 'invoicer-api') return { vars: [], secrets: [] };
    return {
      vars: [V('ASPNETCORE_ENVIRONMENT', 'Development'), V('DB_HOST', 'db.internal'), V('DOTNET_CLI_TELEMETRY_OPTOUT', '1')],
      secrets: [S('NPM_TOKEN', 'Set 2 days ago by kim-hale'), S('NUGET_API_KEY', 'Set Nov 3 by dana-ortiz')],
    };
  }
  function store(org, project, variant) {
    AD.state.env = AD.state.env || {}; // Reset replaces AD.state, so the seed comes back
    const k = org + '/' + project + '/' + variant;
    if (!AD.state.env[k]) AD.state.env[k] = seedEnv(project, variant);
    return AD.state.env[k];
  }
  const totalBytes = (st) => st.vars.concat(st.secrets).reduce((n, e) => n + e.size, 0);

  /* ---------- fake API (POST create, PUT edit, DELETE), with "Fail the next action with" ---------- */
  const problem = (status, title, detail) => ({ err: { status, title, detail, reqId: status >= 500 ? AD.reqId() : null } });
  const LIMIT = () => problem(409, 'Too many entries', 'This project has ' + MAX_ENTRIES + ' entries, the most this deployment allows. Remove one to add another.');
  const SIZE = () => problem(409, 'Too large', 'Names and values of this project would pass 256 KiB together. Shorten or remove entries to make room.');
  const injected = (f, op) => {
    if (f === '500') return problem(500, 'Internal server error');
    if (f === '403') return problem(403, "You don't have access");
    if (f === '409') return op === 'remove' ? problem(500, 'Internal server error') : op === 'create' ? LIMIT() : SIZE();
    if (f === 'size') return op === 'remove' ? null : SIZE();
    return null;
  };
  const api = {
    create(st, list, name, value) {
      const f = AD.takeFail();
      if (f === '404') return problem(404, 'This project does not exist, or you cannot see it.');
      const inj = injected(f, 'create'); if (inj) return inj;
      if (st.vars.concat(st.secrets).some((e) => e.name === name)) return { field: { name: name + ' already exists. A name can be used once, as a variable or a secret.' } };
      if (st.vars.length + st.secrets.length >= MAX_ENTRIES) return LIMIT();
      const size = bytes(name) + bytes(value);
      if (totalBytes(st) + size > MAX_TOTAL) return SIZE();
      const e = list === 'vars' ? V(name, value) : S(name, 'Set just now by ' + AD.state.uid, bytes(value));
      st[list].push(e); st[list].sort(byName);
      return { ok: true };
    },
    update(st, list, name, value) {
      const f = AD.takeFail();
      const i = st[list].findIndex((e) => e.name === name);
      if (f === '404' || i < 0) { if (i >= 0) st[list].splice(i, 1); return { gone: true, index: i }; } // another admin removed it meanwhile
      const inj = injected(f, 'update'); if (inj) return inj;
      const e = st[list][i];
      const size = bytes(name) + bytes(value);
      if (totalBytes(st) - e.size + size > MAX_TOTAL) return SIZE();
      if (list === 'vars') { e.value = value; e.size = size; } else { e.size = size; e.who = 'Set just now by ' + AD.state.uid; }
      return { ok: true };
    },
    remove(st, list, name) {
      const f = AD.takeFail();
      const i = st[list].findIndex((e) => e.name === name);
      if (f === '404' || i < 0) { if (i >= 0) st[list].splice(i, 1); return { gone: true, index: i }; }
      const inj = injected(f, 'remove'); if (inj) return inj;
      st[list].splice(i, 1);
      return { ok: true };
    },
  };

  /* ---------- client checks: the contracts request schema (format, lengths, reserved names) ---------- */
  function checkName(n) {
    if (!n) return 'Enter a name.';
    if (n.length > 128) return 'Use 128 characters or fewer.';
    if (!NAME_RE.test(n)) return 'Use letters, digits and _, and do not start with a digit.';
    if (reserved(n)) return n + ' is reserved: Agent Desk sets it for every run.';
    return null;
  }
  function checkValue(list, v) {
    if (list === 'secrets') {
      if (!v) return 'Enter a value.';
      if (v.length < 6) return 'Too short to hide in logs.';
    }
    if (bytes(v) > MAX_VALUE) return 'Use 8 KiB or less.';
    if (/[\r\n\u0000]/.test(v)) return 'A value cannot contain a line break.';
    return null;
  }

  /* ---------- screen state (outside AD.ui.form/dialog so paging keeps an open form) ---------- */
  function envUi(key) {
    if (!AD.ui.env || AD.ui.env.key !== key) AD.ui.env = { key, add: { vars: null, secrets: null }, edit: null, gone: null, focus: null };
    return AD.ui.env;
  }
  const cur = () => {
    const c = AD.cur;
    const s = (c.q && c.q.s) || 'live';
    return { org: c.params.org, project: c.params.project, scen: s, variant: variantOf(s) };
  };
  const variantOf = (s) => (s === 'env-paged' ? 'paged' : s === 'empty' || s === 'env-empty' ? 'empty' : 'main');
  const curStore = () => { const c = cur(); return store(c.org, c.project, c.variant); };

  /* ---------- permissions (ADR-0036: owner and admin, org or this project, hold setup:read, setup:update, secret:update) ---------- */
  function perms(ctx) {
    const p = ctx.perm || {};
    const read = !!(p.orgAdmin || (p.adminProjects || []).includes(ctx.params.project));
    const s = ctx.scen;
    const ro = s === 'env-readonly'; // the setup-reader role fixture: setup:read only (no built-in role)
    return { read, vars: read && !ro, secrets: read && !ro && s !== 'env-secrets-readonly' };
  }

  /* ---------- tab strip ---------- */
  function tabsHtml(ctx, on) {
    const base = '/o/' + ctx.orgSlug + '/p/' + ctx.params.project + '/desk/setup';
    const q = Object.assign({}, ctx.q);
    if (AD.B[q.s]) delete q.s; // a board snapshot is not a state of the other tab
    const qs = (tab) => Object.assign({}, q, { tab: tab === 'environment' ? 'environment' : null });
    const a = (tab, label) => `<a href="${AD.href(base, qs(tab))}" class="${on === tab ? 'on' : ''}" role="tab" aria-selected="${on === tab}"${on === tab && tab === 'environment' ? ' aria-controls="env-panel"' : ''}>${label}</a>`;
    return `<div class="tabs" role="tablist" aria-label="Workspace setup" style="height:40px;flex:0 0 40px;padding:0 8px;border-bottom:1px solid var(--line)">${a('script', 'Setup script')}${a('environment', 'Environment')}</div>`;
  }
  const TABS_RE = /<div class="tabs" role="tablist"[\s\S]*?<\/div>/;

  /* ---------- lists ---------- */
  function field(o) {
    const desc = [o.help && o.id + 'h', o.error && o.id + 'e'].filter(Boolean).join(' ');
    const input = `<input id="${o.id}"${o.password ? ` type="${o.reveal ? 'text' : 'password'}" autocomplete="new-password"` : ''} class="input mono${o.error ? ' bad' : ''}" value="${esc(o.value || '')}" data-on="env" data-f="${o.f}"${o.error ? ' aria-invalid="true"' : ''}${desc ? ` aria-describedby="${desc}"` : ''}${o.busy ? ' readonly' : ''}>`;
    const ctl = o.password ? `<div class="row" style="gap:6px">${input}<button type="button" class="btn ghost" data-act="env-reveal" data-f="${o.f}" data-target="${o.id}" aria-pressed="${!!o.reveal}">${IC.eye}${o.reveal ? 'Hide value' : 'Show value'}</button></div>` : input;
    return `<div class="field"><label for="${o.id}">${esc(o.label)}</label>${ctl}${o.help ? `<span id="${o.id}h" class="help">${esc(o.help)}</span>` : ''}${o.error ? `<span id="${o.id}e" class="ferr" role="alert">${esc(o.error)}</span>` : ''}</div>`;
  }
  function addForm(list, f) {
    const secret = list === 'secrets';
    const p = secret ? 'as' : 'av';
    const label = C[list].add;
    return `<form data-env-form="add" data-list="${list}" role="group" aria-label="${label}" style="${PANEL}" novalidate>${f.banner ? problemBanner(f.banner) : ''}<div style="display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);gap:16px;align-items:start">${field({ id: p + 'n', label: 'Name', value: f.name, f: 'add.' + list + '.name', error: f.errors.name, busy: f.busy })}${field({ id: p + 'v', label: 'Value', value: f.value, f: 'add.' + list + '.value', password: secret, reveal: f.reveal, help: secret ? 'At least 6 characters.' : '', error: f.errors.value, busy: f.busy })}</div><div class="row" style="gap:8px;justify-content:flex-end"><button type="button" class="btn ghost" data-act="env-cancel" data-what="add" data-list="${list}"${f.busy ? ' disabled' : ''}>Cancel</button>${f.busy ? `<button type="button" class="btn primary" disabled aria-busy="true">Saving…</button>` : `<button type="submit" class="btn primary" data-act="env-submit" data-what="add" data-list="${list}">${label}</button>`}</div></form>`;
  }
  const nameCell = (n, secret) => secret
    ? `<span class="row" style="gap:8px;min-width:0"><span class="faint" style="display:inline-flex">${IC.key}</span><span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(n)}">${esc(n)}</span></span>`
    : `<span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(n)}">${esc(n)}</span>`;
  const maskCell = (who) => `<span class="row" style="gap:12px;min-width:0"><span aria-hidden="true" class="faint mono" style="letter-spacing:2px">••••••••</span>${SR('Value hidden')}<span class="faint" style="font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(who)}</span></span>`;
  const valueCell = (v) => (v === '' ? '<span class="faint" style="font-size:12.5px">Empty</span>' : `<span class="mono muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v)}">${esc(v)}</span>`);
  const actions = (list, n, expanded) => {
    const verb = list === 'secrets' ? 'Replace' : 'Edit';
    return `<span class="row" style="gap:2px"><button class="btn ghost sm" data-act="env-edit" data-list="${list}" data-name="${esc(n)}" aria-label="${verb} ${esc(n)}"${expanded ? ' aria-expanded="true"' : ''}>${verb}</button><button class="btn ghost sm" data-act="env-remove" data-list="${list}" data-name="${esc(n)}" aria-label="Remove ${esc(n)}">Remove</button></span>`;
  };
  function row(list, e, i, can) {
    const secret = list === 'secrets';
    return `<li style="${liStyle(i)}${can ? ROW : ROW_RO};padding:7px 8px 7px 12px">${nameCell(e.name, secret)}${secret ? maskCell(e.who) : valueCell(e.value)}${can ? actions(list, e.name) : ''}</li>`;
  }
  function editRow(e, i, f) {
    const busyBtn = `<button type="button" class="btn primary" disabled aria-busy="true">Saving…</button>`;
    return `<li style="${liStyle(i)}padding:12px;${ACTIVE}"><form data-env-form="edit" data-list="vars" novalidate style="display:flex;flex-direction:column;gap:12px">${f.banner ? problemBanner(f.banner) : ''}<div style="display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);gap:16px;align-items:end"><div class="field"><span class="flabel">Name</span><span class="mono" style="height:34px;display:flex;align-items:center">${esc(e.name)}</span></div>${field({ id: 'ev', label: 'Value', value: f.value, f: 'edit.value', error: f.errors.value, busy: f.busy })}</div><div class="row" style="gap:8px;justify-content:flex-end"><button type="button" class="btn ghost" data-act="env-cancel" data-what="edit"${f.busy ? ' disabled' : ''}>Cancel</button>${f.busy ? busyBtn : `<button type="submit" class="btn primary" data-act="env-submit" data-what="edit" data-list="vars">Save</button>`}</div></form></li>`;
  }
  function replaceRow(e, i, f) {
    const busyBtn = `<button type="button" class="btn primary" disabled aria-busy="true">Saving…</button>`;
    return `<li style="${liStyle(i)}padding:7px 8px 12px 12px;${ACTIVE}"><div style="${ROW}">${nameCell(e.name, true)}${maskCell(e.who)}${actions('secrets', e.name, true)}</div><form data-env-form="edit" data-list="secrets" novalidate style="display:flex;flex-direction:column;gap:12px;margin-top:10px;padding-right:4px">${f.banner ? problemBanner(f.banner) : ''}<div style="max-width:620px">${field({ id: 'rv', label: 'New value', value: f.value, f: 'edit.value', password: true, reveal: f.reveal, error: f.errors.value, busy: f.busy })}</div><div class="row" style="gap:8px;justify-content:flex-end"><button type="button" class="btn ghost" data-act="env-cancel" data-what="edit"${f.busy ? ' disabled' : ''}>Cancel</button>${f.busy ? busyBtn : `<button type="submit" class="btn primary" data-act="env-submit" data-what="edit" data-list="secrets" id="env-replace-save"${f.value ? '' : ' disabled'}>Save</button>`}</div></form></li>`;
  }
  const goneRow = (i) => `<li style="${liStyle(i)}padding:8px"><div class="banner err" role="alert" style="align-items:center;padding:10px 14px"><span class="b-ico">${I.warn}</span><div class="grow" style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:600">${esc(C.gone)}</b></div></div></li>`;

  function pager(list, info) {
    if (info.pages <= 1) return '';
    const { page, pages, from, to, total } = info;
    const size = AD.pageSize();
    const btn = (p) => `<button class="btn ${p === page ? '' : 'ghost'} iconbtn num" ${p === page ? 'aria-current="page"' : ''} aria-label="Page ${p}" data-act="env-page" data-list="${list}" data-page="${p}">${p}</button>`;
    const nums = []; let last = 0;
    [...new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b).forEach((p) => { if (last && p - last > 1) nums.push('<span class="faint pg-gap">…</span>'); nums.push(btn(p)); last = p; });
    return `<div style="padding-top:2px"><div class="pager"><nav aria-label="Pagination, ${esc(C[list].title)}" class="pg"><span class="pg-range"><span class="pg-word">Showing </span><span class="num" style="color:var(--text)">${from}–${to}</span> of <span class="num" style="color:var(--text)">${total}</span></span><span class="pg-pages"><button class="btn ghost pg-step" data-act="env-page" data-list="${list}" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${I.prev}<span class="pg-step-t">Previous</span></button><span class="pg-slots w">${nums.join('')}</span><span class="pg-slots n">${nums.join('')}</span><button class="btn ghost pg-step" data-act="env-page" data-list="${list}" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}><span class="pg-step-t">Next</span>${I.next}</button></span><span class="pg-tools"><span class="pg-field"><label for="${list}-jump" class="pg-lbl">Go to page</label><input id="${list}-jump" class="input num pg-jump" inputmode="numeric" value="" data-env-jump="${list}"><button class="btn pg-go" data-act="env-jump" data-list="${list}">Go</button></span><span class="pg-field"><label for="${list}-size" class="pg-lbl">Rows per page</label><select id="${list}-size" class="input num pg-size" data-env-size>${[20, 50, 100].map((n) => `<option${n === size ? ' selected' : ''}>${n}</option>`).join('')}</select></span></span></nav></div></div>`;
  }
  const PAGE_KEY = { vars: 'varsPage', secrets: 'secretsPage' };

  function section(ctx, list, st, ui, state, can) {
    const c = C[list];
    const secret = list === 'secrets';
    const entries = st[list];
    const info = AD.slice(entries, parseInt(ctx.q[PAGE_KEY[list]], 10) || 1);
    const ready = state === 'ready';
    if (ready && ctx.q[PAGE_KEY[list]] && info.page !== parseInt(ctx.q[PAGE_KEY[list]], 10)) {
      // a page past the end (or bad input) is clamped back, as the version history does
      setTimeout(() => AD.setQuery({ [PAGE_KEY[list]]: info.page === 1 ? null : info.page }, { replace: true }), 0);
    }
    const count = ready && entries.length ? `<span class="faint" style="font-size:12.5px">${entries.length} ${entries.length === 1 ? c.one : c.many}</span>` : '';
    const add = can ? `<button class="btn sm" data-act="env-add" data-list="${list}"${ui.add[list] ? ' aria-expanded="true"' : ''}>${IC.plus}${c.add}</button>` : '';
    let body;
    if (state === 'loading') {
      const bar = (w) => `<span aria-hidden="true" style="display:block;height:30px;width:${w};background:var(--raised);border-radius:6px"></span>`;
      body = `<div role="status" aria-busy="true" style="display:flex;flex-direction:column;gap:8px">${SR('Loading ' + c.what)}<span aria-hidden="true" style="display:flex;flex-direction:column;gap:8px">${bar('100%')}${bar('100%')}${bar('60%')}</span></div>`;
    } else if (state === 'error') {
      body = problemBanner({ title: C.load, reqId: 'req_01JDE7Q3M9KT', retry: true });
    } else {
      const items = [];
      const gone = ui.gone && ui.gone.list === list ? ui.gone : null;
      info.rows.forEach((e, k) => {
        const i = info.from - 1 + k;
        if (gone && gone.index === i) items.push(goneRow(items.length));
        const ed = ui.edit && ui.edit.list === list && ui.edit.name === e.name ? ui.edit : null;
        items.push(ed ? (secret ? replaceRow(e, items.length, ed) : editRow(e, items.length, ed)) : row(list, e, items.length, can));
      });
      if (gone && gone.index >= info.from - 1 + info.rows.length && gone.index <= info.to) items.push(goneRow(items.length));
      body = items.length ? `<ul aria-label="${esc(c.title)}" style="margin:0;padding:0;border:1px solid var(--line);border-radius:8px;overflow:hidden">${items.join('')}</ul>` : `<div style="padding:14px 12px;border:1px solid var(--line);border-radius:8px"><p class="muted" style="font-size:13px">${esc(c.empty)}</p></div>`;
      body += pager(list, info);
    }
    const note = !can && ready && list === 'secrets' && ctx.scen === 'env-secrets-readonly' ? offNote(C.readOnly) : '';
    const form = can && ui.add[list] ? addForm(list, ui.add[list]) : '';
    const after = secret ? `<p class="note">${esc(C.visibility)}</p>` : '';
    return `<section aria-labelledby="${list}-h" style="display:flex;flex-direction:column;gap:10px;padding:18px 0;${secret ? '' : 'border-bottom:1px solid var(--line)'}"><div class="row" style="gap:10px;min-height:26px"><h2 id="${list}-h" style="font-size:15px">${esc(c.title)}</h2>${count}<span class="grow"></span>${add}</div><p class="muted" style="font-size:13px;margin-top:-6px">${esc(c.help)}</p>${note}${body}${form}${after}</section>`;
  }

  /* ---------- outs ---------- */
  const listState = (s, list) => {
    if (s === 'loading' || s === 'env-loading') return 'loading';
    if (s === 'error' || (list === 'vars' && s === 'env-error-vars') || (list === 'secrets' && s === 'env-error-secrets')) return 'error';
    return 'ready';
  };
  function envOut(ctx, can) {
    const s = ctx.scen;
    const variant = variantOf(s);
    const st = store(ctx.orgSlug, ctx.params.project, variant);
    const ui = envUi([ctx.orgSlug, ctx.params.project, s].join('/'));
    const boardName = s === 'env-testing' ? 'DeskSetupTest' : 'DeskSetup';
    const body = AD.B[boardName].body;
    const boardMain = body.match(/<main[\s\S]*<\/main>/)[0];
    const header = boardMain.slice(boardMain.indexOf('>') + 1, boardMain.indexOf('<div class="tabs"')).trim();
    const top = !can.vars && !can.secrets ? offNote(C.readOnly) : s === 'env-testing' ? offNote(C.testing) : '';
    const main = `<main style="flex:1;min-width:0;display:flex;flex-direction:column">
${header}
${tabsHtml(ctx, 'environment')}
<div id="env-panel" role="tabpanel" aria-label="Environment" style="flex:1;min-height:0;overflow-y:auto;padding:16px 20px 8px;display:flex;flex-direction:column">
<p class="muted" style="font-size:13px;max-width:780px">${esc(C.intro)}</p>
${top ? `<div style="padding-top:12px;max-width:780px">${top}</div>` : ''}
${section(ctx, 'vars', st, ui, listState(s, 'vars'), can.vars)}
${section(ctx, 'secrets', st, ui, listState(s, 'secrets'), can.secrets)}
</div>
</main>`;
    let overlay = '';
    const d = AD.ui.dialog;
    if (d && d.type === 'env-remove') {
      const kind = d.list === 'secrets' ? 'secret' : 'variable';
      overlay = AD.dialog({ label: 'Remove ' + d.name + '?', w: 480, body: `<h2 style="font-size:18px">Remove <span class="mono" style="font-size:17px">${esc(d.name)}</span>?</h2><p class="muted" style="font-size:13.5px">${esc(C.removeBody)}</p>`, foot: `<button class="btn ghost" data-act="dialog-close"${d.busy ? ' disabled' : ''}>Keep</button><button class="btn solid-danger" data-act="env-remove-confirm"${d.busy ? ' disabled aria-busy="true"' : ''}>${d.busy ? 'Removing…' : 'Remove ' + kind}</button>` });
    }
    let html = AD.fixLinks(body.replace(boardMain, () => main)) + overlay;
    // The read-only fixtures (DeskSetupEnvironmentReadOnly / SecretsReadOnly) draw a person without the side menu's "Access" group.
    if (s === 'env-readonly' || s === 'env-secrets-readonly') html = AD.stripDeskAccess(html);
    const focus = ui.focus; ui.focus = null;
    return {
      header: 'project', h: 900, fixed: true, title: 'Desk, workspace setup, Environment', html,
      after(stage) {
        const el = focus && stage.querySelector(focus);
        if (el) el.focus(); else if (d && d.type === 'env-remove') { const b = stage.querySelector('.overlay .d-f .btn.solid-danger'); if (b) b.focus(); }
      },
    };
  }
  // The Setup script tab: the drawn board, with the live tab strip. Boards drawn before the tabs get the strip under the header.
  function scriptOut(ctx) {
    const s = ctx.scen;
    const name = { loading: 'DeskSetupVersionsLoading', empty: 'DeskSetupVersionsEmpty', error: 'DeskSetupVersionsError', 'env-testing': 'DeskSetupTest' }[s] || 'DeskSetup';
    const out = AD.boardOut(name, { sample: true, title: 'Desk, workspace setup' });
    const tabs = tabsHtml(ctx, 'script');
    if (TABS_RE.test(out.html)) out.html = out.html.replace(TABS_RE, () => tabs);
    else out.html = out.html.replace('padding:14px 20px;gap:12px;border-bottom:1px solid var(--line)', 'padding:14px 20px 10px;gap:12px').replace('Test setup</button>\n</div>', () => 'Test setup</button>\n</div>\n' + tabs);
    if (name === 'DeskSetup') { delete out.board; out.snapshot = false; } // the default view, not a snapshot
    return out;
  }

  function renderSetup(ctx) {
    const s = ctx.scen;
    if (s !== 'live' && AD.B[s]) return AD.boardOut(s, { sample: true });
    const visible = AD.visibleProjects(ctx.uid, ctx.orgSlug).some((p) => p.id === ctx.params.project);
    if (!visible) return AD.notFoundOut('This project does not exist, or you cannot see it.');
    if (s === 'crash') return AD.boardOut('RouteError');
    const can = perms(ctx);
    // Member and viewer hold no setup:read: the existing Forbidden page (desk access matrix, BR-1)
    if (s === 'forbidden' || !can.read) return { header: 'project', h: 900, title: 'No access', html: AD.forbiddenMain };
    return ctx.q.tab === 'environment' ? envOut(ctx, can) : scriptOut(ctx);
  }

  /* ---------- actions ---------- */
  const A = AD.acts;
  const lag = (fn) => setTimeout(fn, 600);
  A['env-add'] = (el) => {
    const ui = AD.ui.env; const list = el.dataset.list;
    if (!ui.add[list]) ui.add[list] = { name: '', value: '', errors: {}, banner: null, busy: false, reveal: false };
    ui.gone = null;
    ui.focus = '#' + (list === 'secrets' ? 'as' : 'av') + 'n';
    AD.render();
  };
  A['env-cancel'] = (el) => {
    const ui = AD.ui.env;
    if (el.dataset.what === 'add') { const list = el.dataset.list; ui.add[list] = null; ui.focus = `[data-act="env-add"][data-list="${list}"]`; }
    else { const e = ui.edit; ui.edit = null; if (e) ui.focus = `[data-act="env-edit"][data-name="${e.name}"]`; }
    AD.render();
  };
  A['env-edit'] = (el) => {
    const ui = AD.ui.env; const list = el.dataset.list; const name = el.dataset.name;
    if (ui.edit && ui.edit.list === list && ui.edit.name === name) return;
    const e = curStore()[list].find((x) => x.name === name);
    // Edit opens with the current plain value; Replace opens with an empty field (the stored value is never sent back)
    ui.edit = { list, name, value: list === 'vars' && e ? e.value : '', errors: {}, banner: null, busy: false, reveal: false };
    ui.gone = null;
    ui.focus = list === 'vars' ? '#ev' : '#rv';
    AD.render();
  };
  A['env-reveal'] = (el) => {
    const inp = AD.$('#' + el.dataset.target); if (!inp) return;
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    el.setAttribute('aria-pressed', String(show));
    el.innerHTML = IC.eye + (show ? 'Hide value' : 'Show value');
    const f = formOf(el.dataset.f); if (f) f.reveal = show;
  };
  function formOf(path) {
    const ui = AD.ui.env; if (!ui) return null;
    const p = path.split('.');
    return p[0] === 'add' ? ui.add[p[1]] : ui.edit;
  }
  AD.inputs.env = (t) => {
    const f = formOf(t.dataset.f); if (!f) return;
    const key = t.dataset.f.split('.').pop();
    f[key] = t.value;
    const save = AD.$('#env-replace-save'); if (save && t.id === 'rv') save.disabled = !t.value; // a blank replace sends nothing (BR-10)
  };
  A['env-submit'] = (el, e) => {
    if (e) e.preventDefault();
    const ui = AD.ui.env; const list = el.dataset.list;
    const st = curStore();
    if (el.dataset.what === 'add') {
      const f = ui.add[list]; if (!f || f.busy) return;
      f.errors = {}; f.banner = null;
      const ne = checkName(f.name); const ve = checkValue(list, f.value);
      if (ne) f.errors.name = ne; if (ve) f.errors.value = ve;
      if (ne || ve) { ui.focus = '#' + (list === 'secrets' ? 'as' : 'av') + (ne ? 'n' : 'v'); AD.render(); return; }
      f.busy = true; AD.render();
      lag(() => {
        const r = api.create(st, list, f.name, f.value);
        f.busy = false;
        if (r.field) { f.errors = r.field; ui.focus = '#' + (list === 'secrets' ? 'as' : 'av') + 'n'; AD.render(); return; }
        if (r.err) { f.banner = r.err; AD.render(); return; }
        const name = f.name;
        ui.add[list] = null; // the typed value is dropped once saved
        ui.focus = `[data-act="env-add"][data-list="${list}"]`;
        AD.render(); // the list stays on its page; the new row may be on another one
        AD.toast('ok', 'Added ' + name);
      });
      return;
    }
    const f = ui.edit; if (!f || f.busy) return;
    if (list === 'secrets' && !f.value) return; // blank replace: nothing is sent
    f.errors = {}; f.banner = null;
    const ve = checkValue(list, f.value);
    if (ve) { f.errors.value = ve; ui.focus = list === 'vars' ? '#ev' : '#rv'; AD.render(); return; }
    f.busy = true; AD.render();
    lag(() => {
      const r = api.update(st, list, f.name, f.value);
      f.busy = false;
      if (r.gone) { ui.edit = null; ui.gone = { list, name: f.name, index: Math.max(0, r.index) }; ui.focus = `[data-act="env-add"][data-list="${list}"]`; AD.render(); return; }
      if (r.err) { f.banner = r.err; AD.render(); return; }
      ui.edit = null;
      ui.focus = `[data-act="env-edit"][data-name="${f.name}"]`;
      AD.render();
    });
  };
  A['env-remove'] = (el) => {
    AD.ui.env.gone = null;
    AD.ui.dialog = { type: 'env-remove', list: el.dataset.list, name: el.dataset.name, busy: false };
    AD.render();
  };
  A['env-remove-confirm'] = () => {
    const d = AD.ui.dialog; if (!d || d.busy) return;
    const ui = AD.ui.env; const st = curStore();
    d.busy = true; AD.render();
    lag(() => {
      const r = api.remove(st, d.list, d.name);
      AD.ui.dialog = null;
      ui.focus = `[data-act="env-add"][data-list="${d.list}"]`;
      if (ui.edit && ui.edit.name === d.name) ui.edit = null;
      if (r.gone) ui.gone = { list: d.list, name: d.name, index: Math.max(0, r.index) };
      AD.render();
      if (r.err) AD.toast('err', r.err.title, r.err.reqId ? 'Request ID: ' + r.err.reqId : r.err.detail);
    });
  };
  A['env-page'] = (el) => { if (el.disabled) return; AD.setQuery({ [PAGE_KEY[el.dataset.list]]: el.dataset.page === '1' ? null : el.dataset.page }); };
  A['env-jump'] = (el) => {
    const list = el.dataset.list;
    const inp = AD.$(`[data-env-jump="${list}"]`); const n = parseInt(inp && inp.value, 10);
    if (n >= 1) AD.setQuery({ [PAGE_KEY[list]]: n === 1 ? null : n });
  };
  document.addEventListener('change', (e) => {
    if (e.target.matches && e.target.matches('[data-env-size]')) { AD.ui.pageSize = Number(e.target.value); AD.setQuery({ varsPage: null, secretsPage: null }); }
  });
  // Enter submits a row form (the browser clicks its submit button, which carries the action); Escape cancels it.
  document.addEventListener('submit', (e) => { if (e.target.closest && e.target.closest('[data-env-form]')) e.preventDefault(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-env-jump]')) { A['env-jump'](e.target); return; }
    if (e.key !== 'Escape' || AD.ui.dialog) return;
    const form = e.target.closest && e.target.closest('[data-env-form]');
    if (!form) return;
    const btn = form.querySelector('[data-act="env-cancel"]');
    if (btn && !btn.disabled) A['env-cancel'](btn);
  });

  /* ---------- hook into the Desk screen (desk/setup only) ---------- */
  const desk = AD.screens.desk;
  const baseRender = desk.render.bind(desk);
  const baseSnaps = desk.snaps;
  const ENV_SNAPS = [
    ['env-paged', 'Environment: more than one page (23 variables, 22 secrets)'],
    ['env-loading', 'Environment: both lists loading'],
    ['env-empty', 'Environment: no entries yet'],
    ['env-error-vars', 'Environment: variables failed to load'],
    ['env-error-secrets', 'Environment: secrets failed to load'],
    ['env-readonly', 'Environment: read-only role (setup:read only)'],
    ['env-secrets-readonly', 'Environment: secrets read-only (no secret:update)'],
    ['env-testing', 'A setup test is running (both tabs)'],
  ].map(([id, label]) => ({ id, label, group: 'Workspace setup states (live, clickable)' }));
  desk.snaps = (ctx) => (ctx.params.tab === 'setup' ? ENV_SNAPS.concat(AD.snapGroup(AD.boardNames(/^DeskSetup/))) : baseSnaps(ctx));
  desk.render = (ctx) => (ctx.params.tab === 'setup' ? renderSetup(ctx) : baseRender(ctx));
})();
