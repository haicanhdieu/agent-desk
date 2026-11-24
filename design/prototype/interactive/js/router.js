/* Hash router. Routes look like  #/o/harbor-labs/settings/members?s=<scenario>&page=2  so the browser back button works
   and every screen and state can be linked to. */
(function () {
  'use strict';
  const AD = window.AD;

  AD.parseHash = function () {
    let h = location.hash.replace(/^#/, '');
    if (!h || h === '/') h = '/';
    const qi = h.indexOf('?');
    const path = qi < 0 ? h : h.slice(0, qi);
    const q = {};
    new URLSearchParams(qi < 0 ? '' : h.slice(qi + 1)).forEach((v, k) => { q[k] = v; });
    return { path, parts: path.split('/').filter(Boolean).map(decodeURIComponent), q };
  };
  AD.href = function (path, q) {
    const keys = Object.keys(q || {}).filter((k) => q[k] !== undefined && q[k] !== null && q[k] !== '');
    return '#' + path + (keys.length ? '?' + keys.map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&') : '');
  };
  AD.nav = function (path, q, opts) {
    const target = AD.href(path, q);
    if (target === location.hash) { AD.render(); return; } // same hash: no hashchange would fire
    if (opts && opts.replace) location.replace(location.pathname + location.search + target);
    else location.hash = target;
  };
  // Change only the query of the current route (page, status, scenario ...). Pushes history unless replace.
  AD.setQuery = function (patch, opts) {
    const r = AD.parseHash();
    const q = Object.assign({}, r.q, patch);
    for (const k of Object.keys(q)) if (q[k] === null || q[k] === undefined || q[k] === '' || (k === 'page' && String(q[k]) === '1')) delete q[k];
    const target = AD.href(r.path, q);
    if (target === location.hash) { AD.render(); return; } // same hash: no hashchange fires
    AD.nav(r.path, q, opts);
  };

  /* Route table: first match wins. `screen` is a key of AD.screens. */
  AD.resolve = function (route) {
    const p = route.parts;
    const n = p.length;
    if (n === 0) return { screen: 'landing', params: {} };
    if (p[0] === 'signin') return { screen: 'signin', params: {} };
    if (p[0] === 'index') return { screen: 'index', params: {} };
    // Create organization lives in the platform shell (navigation-consistency spec); the old URL redirects there.
    if (p[0] === 'orgs' && p[1] === 'new') return { screen: 'createorg.redirect', params: {} };
    if (p[0] === 'invitations' && n === 1) return { screen: 'myinvites', params: {} };
    if (p[0] === 'invitations' && n === 2) return { screen: 'accept', params: { token: p[1] } };
    if (p[0] === 'gallery' && p[1] === 'pagination') return { screen: 'gallery', params: {} };
    if (p[0] === 'b' && p[1]) return { screen: 'snapshot', params: { board: p[1] } };
    // Platform admin area (platform-admin-dashboard spec): outside any org, its own layout. The org detail uses the org id.
    if (p[0] === 'platform') {
      if (n === 1) return { screen: 'platform.index', params: {} };
      if (p[1] === 'admins' && n === 2) return { screen: 'platform.admins', params: {} };
      if (p[1] === 'audit' && n === 2) return { screen: 'platform.audit', params: {} };
      if (p[1] === 'orgs' && n === 2) return { screen: 'platform.orgs', params: {} };
      if (p[1] === 'orgs' && p[2] === 'new' && n === 3) return { screen: 'createorg', params: {} };
      if (p[1] === 'orgs' && p[2] && n <= 4) return { screen: 'platform.org', params: { orgId: p[2], tab: p[3] || 'overview' } };
    }
    if (p[0] === 'o' && p[1]) {
      const org = p[1];
      const rest = p.slice(2);
      // A suspended organization shows the fixed "suspended" message on every one of its URLs (BR-37).
      if (AD.orgSuspendedView && AD.orgSuspendedView(org, route.q)) return { screen: 'orgsuspended', params: { org } };
      if (rest[0] === 'projects' && rest.length === 1) return { screen: 'projects', params: { org } };
      if (rest[0] === 'projects' && rest[1] === 'new' && rest[2]) return { screen: 'setup', params: { org, step: rest[2] } };
      if (rest[0] === 'needs-you') return { screen: 'needsyou', params: { org } };
      if (rest[0] === 'invitations') return { screen: 'legacyinvites', params: { org } };
      if (rest[0] === 'settings' && rest.length === 1) return { screen: 'settingsindex', params: { org } };
      if (rest[0] === 'settings' && rest[1]) return { screen: 'settings.' + rest[1], params: { org, tab: rest[1] } };
      if (rest[0] === 'p' && rest[1]) {
        const project = rest[1];
        if (rest[2] === 'runs' && rest.length === 3) return { screen: 'runs', params: { org, project } };
        if (rest[2] === 'runs' && rest[3]) return { screen: 'run', params: { org, project, n: rest[3] } };
        if (rest[2] === 'desk') return { screen: 'desk', params: { org, project, tab: rest[3] || 'skills' } };
      }
    }
    return { screen: 'notfound', params: {} };
  };

  // Routes that work without signing in.
  AD.isPublic = (screen) => ['signin', 'index', 'snapshot', 'accept', 'gallery', 'landing', 'notfound'].includes(screen);

  window.addEventListener('hashchange', () => { AD.ui.menu = null; AD.ui.dialog = null; AD.ui.form = null; AD.render(); });
})();
