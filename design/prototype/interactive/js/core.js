/* Agent Desk interactive prototype: core helpers, icons, fake data store, permissions.
   Plain browser script (no modules) so the prototype opens from file://. Everything hangs off window.AD. */
(function () {
  'use strict';
  const AD = (window.AD = { screens: {}, acts: {}, ui: {}, proposals: {}, inputs: {} });

  AD.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  AD.$ = (sel, root) => (root || document).querySelector(sel);
  AD.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------- icons: copied from the boards ---------- */
  const s = (w, d, extra) => `<svg aria-hidden="true" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"${extra || ''}>${d}</svg>`;
  AD.I = {
    brand: `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3" width="19" height="18" rx="3.5"/><path d="M2.5 9.5h19"/><rect x="6.5" y="12.5" width="5" height="5" rx="1" fill="currentColor" stroke="none"/><path d="M14 14h4M14 17h3"/></svg>`,
    chev: s(14, '<path d="M6 9l6 6 6-6"/>'),
    bell: s(16, '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    dots: s(16, '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
    plus: s(15, '<path d="M12 5v14M5 12h14"/>'),
    plus16: s(16, '<path d="M12 5v14M5 12h14"/>'),
    check: s(14, '<path d="M5 12.5 10 17l9-10"/>'),
    check11: s(11, '<path d="M5 12.5 10 17l9-10"/>'),
    x: s(14, '<path d="M6 6l12 12M18 6 6 18"/>'),
    retry: s(14, '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
    warn: s(18, '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>'),
    okc: s(18, '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5 11 15l4.5-5.5"/>'),
    mail: s(18, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/>'),
    info: s(18, '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
    ext: s(14, '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    runs: s(15, '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
    desk: s(15, '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/>'),
    prev: s(14, '<path d="M15 6l-6 6 6 6"/>'),
    next: s(14, '<path d="M9 6l6 6-6 6"/>'),
    sliders: s(15, '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
    people: s(15, '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>'),
    grid: s(15, '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
    logout15: s(15, '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M16 8l4 4-4 4M20 12H9"/>'),
    envelope15: s(15, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/>'),
    clock: s(15, '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    copy: s(14, '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
    stQueued: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    stOk: '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.2l2.2 2.2 4.2-4.6" fill="none" stroke="#0F1A13" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    stFail: '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#1E0E0C" stroke-width="1.8" stroke-linecap="round"/></svg>',
    stIdle: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><rect x="7.1" y="4" width="1.8" height="8" rx=".6" fill="#1A1405"/></svg>',
  };

  /* ---------- fake clock: the boards are drawn at 22 Nov 2026, about 11:00 ---------- */
  AD.clock = { minutes: 0 };
  AD.nowLabel = () => {
    const m = 11 * 60 + AD.clock.minutes;
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return { title: `22 Nov 2026, ${hh}:${mm}`, iso: `2026-11-22T${hh}:${mm}` };
  };

  /* ---------- seed data (names and rows are the ones drawn in the boards) ---------- */
  const P = (name, role) => ({ name, role });
  function seedMembers() {
    const harbor = [
      { uid: 'kim-hale', name: 'Kim Hale', handle: 'kim-hale', role: 'owner', projects: [] },
      { uid: 'ines-moreau', name: 'Ines Moreau', handle: 'ines-moreau', role: 'owner', projects: [] },
      { uid: 'jordan-wu', name: 'Jordan Wu', handle: 'jordan-wu', role: 'admin', projects: [] },
      { uid: 'lee-park', name: 'Lee Park', handle: 'lee-park', role: null, projects: [P('invoicer-api', 'Admin')] },
      { uid: 'mira-chen', name: 'Mira Chen', handle: 'mira-chen', role: 'member', projects: [P('invoicer-web', 'Member'), P('docs-site', 'Member')] },
      { uid: 'theo-brandt', name: 'Theo Brandt', handle: 'theo-brandt', role: 'viewer', projects: [] },
      { uid: 'alexandra-kw', name: 'Alexandra Konstantinopoulou-Whitfield, Platform Engineering', handle: 'alexandra-kw', role: 'viewer', projects: [P('billing-jobs', 'Member'), P('invoicer-api', 'Member'), P('invoicer-web', 'Member'), P('docs-site', 'Viewer')] },
      { uid: 'ari-k', name: '', handle: 'ari-k', role: 'member', projects: [] },
    ];
    // Filler rows so the list pages like OrgMembersPaged (26 members, 20 per page). Names are invented.
    const filler = [
      ['Priya Natarajan', 'priya-natarajan', 'admin'], ['Diego Alvarez', 'diego-alvarez', 'member'], ['Sofia Rossi', 'sofia-rossi', 'member'],
      ['Kenji Mori', 'kenji-mori', 'viewer'], ['Amara Okoye', 'amara-okoye', 'member'], ['Lucas Meyer', 'lucas-meyer', 'member'],
      ['Elena Petrova', 'elena-petrova', 'viewer'], ['Noah Fischer', 'noah-fischer', 'member'], ['Yuki Tanaka', 'yuki-tanaka', 'member'],
      ['Omar Haddad', 'omar-haddad', 'member'], ['Greta Lund', 'greta-lund', 'viewer'], ['Rafael Souza', 'rafael-souza', 'member'],
    ].map(([name, handle, role]) => ({ uid: handle, name, handle, role, projects: [] }));
    const page2 = [
      { uid: 'mateo-silva', name: 'Mateo Silva', handle: 'mateo-silva', role: 'member', projects: [P('invoicer-web', 'Member')] },
      { uid: 'hana-sato', name: 'Hana Sato', handle: 'hana-sato', role: 'viewer', projects: [] },
      { uid: 'build-ops', name: '', handle: 'build-ops', role: 'member', projects: [P('billing-jobs', 'Admin')] },
      { uid: 'olu-adeyemi', name: 'Olu Adeyemi', handle: 'olu-adeyemi', role: 'member', projects: [] },
      { uid: 'nadia-rahman', name: 'Nadia Rahman', handle: 'nadia-rahman', role: null, projects: [] },
      { uid: 'tom-becker', name: 'Tom Becker', handle: 'tom-becker', role: 'admin', projects: [] },
    ];
    return {
      'harbor-labs': [...harbor, ...filler, ...page2],
      northwind: [
        { uid: 'maria-chen', name: 'Maria Chen', handle: 'maria-chen', role: 'owner', projects: [] },
        { uid: 'kim-hale', name: 'Kim Hale', handle: 'kim-hale', role: 'admin', projects: [] },
        { uid: 'mira-chen', name: 'Mira Chen', handle: 'mira-chen', role: null, projects: [] },
      ],
      riverside: [
        { uid: 'sana-iqbal', name: 'Sana Iqbal', handle: 'sana-iqbal', role: 'owner', projects: [] },
        { uid: 'kim-hale', name: 'Kim Hale', handle: 'kim-hale', role: 'member', projects: [] },
      ],
    };
  }

  const conn = (kind, text, action) => ({ kind, text, action });
  function seedProjects() {
    return {
      'harbor-labs': [
        { id: 'invoicer-api', repo: 'harbor-labs/invoicer-api', conn: conn('ok', 'Connected'), needs: 1, running: 1, queued: 1, last: 'Run 63, 2 min ago' },
        { id: 'invoicer-web', repo: 'harbor-labs/invoicer-web', conn: conn('ok', 'Polling every 5 min'), needs: 0, running: 0, queued: 0, last: 'Run 19, yesterday' },
        { id: 'docs-site', repo: 'kim-hale/docs-site', conn: conn('warn', 'No webhooks for 2 days', 'Switch to polling'), needs: 0, running: 0, queued: 0, last: 'Run 4, 12 Oct' },
        { id: 'billing-jobs', repo: 'harbor-labs/billing-jobs', conn: conn('fail', 'Polling failed: rate limited, retry in 5 min'), needs: 0, running: 0, queued: 0, last: 'Run 31, 3 hours ago' },
      ],
      northwind: [{ id: 'forecast-service', repo: 'northwind/forecast-service', conn: conn('ok', 'Connected'), needs: 0, running: 0, queued: 0, last: null }],
      riverside: [],
    };
  }

  function seedAudit() {
    const T = (d, h, m, rel) => ({ title: `${d} Nov 2026, ${h}:${m}`, iso: `2026-11-${d}T${h}:${m}`, rel });
    const A = (name, extra) => Object.assign({ name }, extra || {});
    const rows = [
      [T(22, '10', '58', '2 min ago'), A('Kim Hale'), { k: 'role', who: 'Ines Moreau', from: 'Admin', to: 'Owner' }],
      [T(22, '10', '41', '19 min ago'), A('Kim Hale'), { k: 'url', from: '/o/harbor', to: '/o/harbor-labs' }],
      [T(22, '10', '40', '20 min ago'), A('Kim Hale'), { k: 'name', from: 'Harbor', to: 'Harbor Labs' }],
      [T(22, '09', '12', '2 hours ago'), A('Jordan Wu'), { k: 'removed', who: 'Rosa Lind', role: 'Member' }],
      [T(22, '08', '30', '3 hours ago'), A('Jordan Wu'), { k: 'invited', email: 'sam.reyes@contractor.io', role: 'Viewer' }],
      [T(21, '17', '05', 'yesterday'), A('Ines Moreau'), { k: 'role', who: 'Ines Moreau', from: 'Owner', to: 'Admin' }],
      [T(21, '15', '20', 'yesterday'), A('Morgan Avery', { platform: true }), { k: 'raw', key: 'POST orgs.create' }],
      [T(21, '11', '47', 'yesterday'), A('Deleted user', { deleted: true }), { k: 'accepted', role: 'Member' }],
      [T(20, '16', '02', '2 days ago'), A('Kim Hale'), { k: 'revoked', email: 'lee.park@harborlabs.dev' }],
      [T(20, '14', '33', '2 days ago'), A('Alexandra Konstantinopoulou-Whitfield, Platform Engineering'), { k: 'raw', key: 'PATCH projects.update' }],
      // filler between the two boards (invented), so the log has 25 entries and page 2 has the 5 drawn in OrgAuditPaged
      [T(19, '10', '10', '19 Nov'), A('Jordan Wu'), { k: 'invited', email: 'omar.haddad@example.com', role: 'Member' }],
      [T(19, '09', '48', '19 Nov'), A('Omar Haddad'), { k: 'accepted', role: 'Member' }],
      [T(18, '17', '31', '18 Nov'), A('Kim Hale'), { k: 'role', who: 'Jordan Wu', from: 'Member', to: 'Admin' }],
      [T(18, '12', '04', '18 Nov'), A('Kim Hale'), { k: 'invited', email: 'ivy.chen@example.com', role: 'Viewer' }],
      [T(17, '16', '22', '17 Nov'), A('Ivy Chen', {}), { k: 'declined' }],
      [T(17, '09', '40', '17 Nov'), A('Kim Hale'), { k: 'raw', key: 'PUT desk.rules.put' }],
      [T(16, '14', '15', '16 Nov'), A('Jordan Wu'), { k: 'revoked', email: 'tom.berg@example.com' }],
      [T(15, '11', '02', '15 Nov'), A('Kim Hale'), { k: 'role', who: 'Theo Brandt', from: 'Member', to: 'Viewer' }],
      [T(14, '10', '12', '14 Nov'), A('Kim Hale'), { k: 'invited', email: 'nia.okafor@example.com', role: 'Member' }],
      [T(13, '15', '55', '13 Nov'), A('Jordan Wu'), { k: 'raw', key: 'POST projects.create' }],
      // page 2, as drawn in OrgAuditPaged
      [T(12, '09', '15', '12 Nov'), A('Kim Hale'), { k: 'resent', email: 'mira.chen@example.com' }],
      [T(11, '18', '20', '11 Nov'), A('Mira Chen'), { k: 'accepted', role: 'Member' }],
      [T(11, '12', '00', '11 Nov'), A('ari-k', { handle: true }), { k: 'declined' }],
      [T(10, '10', '02', '10 Nov'), A('Kim Hale'), { k: 'raw', key: 'PUT desk.agent.put' }],
      [T(10, '09', '41', '10 Nov'), A('Morgan Avery', { platform: true }), { k: 'invited', email: 'kim.hale@harborlabs.dev', role: 'Owner', actorShort: 'Morgan Avery' }],
    ];
    return rows.map(([t, actor, ev], i) => ({ id: 'a' + i, time: t, actor, ev }));
  }

  // Invitation rows as drawn in OrgInvitationsAll (plus the 4 pending rows of OrgInvitationsSettings).
  function seedInvites() {
    const I = (email, role, access, status, exp, by, extra) => Object.assign({ email, role, access, status, exp, by }, extra || {});
    return {
      'harbor-labs': [
        I('dana.ortiz@example.com', 'Member', ['invoicer-api', 'invoicer-web'], 'pending', { rel: 'Expires in 2 days', title: '23 Nov 2026, 14:05', iso: '2026-11-23T14:05' }, 'Kim Hale', { id: 'i1' }),
        I('lee.park@harborlabs.dev', 'Admin', null, 'pending', { rel: 'Expires in 5 hours', title: '21 Nov 2026, 18:40', iso: '2026-11-21T18:40' }, 'Kim Hale', { id: 'i2' }),
        I('sam.reyes@contractor.io', 'Viewer', ['docs-site'], 'pending', { rel: 'Expires in 1 day', title: '22 Nov 2026, 11:20', iso: '2026-11-22T11:20' }, 'jordan-wu', { id: 'i3' }),
        I('priya.natarajan.platform-engineering@harborlabs-consulting-group.example.com', 'Member', ['billing-jobs', 'invoicer-api', 'invoicer-web', 'docs-site'], 'pending', { rel: 'Expires in 2 days', title: '23 Nov 2026, 09:02', iso: '2026-11-23T09:02' }, 'Kim Hale', { id: 'i4' }),
        I('omar.haddad@example.com', 'Member', null, 'accepted', null, 'Kim Hale', { id: 'i5' }),
        I('ivy.chen@example.com', 'Viewer', ['invoicer-web'], 'declined', null, 'jordan-wu', { id: 'i6' }),
        I('tom.berg@example.com', 'Admin', null, 'revoked', null, 'Kim Hale', { id: 'i7' }),
        I('nia.okafor@example.com', 'Member', ['docs-site'], 'expired', { rel: 'Expired 1 day ago', title: '20 Nov 2026, 08:15', iso: '2026-11-20T08:15' }, 'Kim Hale', { id: 'i8' }),
        I('rafael.souza@example.com', 'Viewer', null, 'expired', { text: '14 Nov, 10:12' }, null, { id: 'i9' }),
      ],
      northwind: [], riverside: [],
    };
  }

  AD.PERSONAS = [
    { id: 'kim-hale', label: 'Org owner', hint: 'Kim Hale, owner of Harbor Labs (admin in Northwind, member in Riverside)' },
    { id: 'jordan-wu', label: 'Org admin', hint: 'Jordan Wu, admin of Harbor Labs' },
    { id: 'lee-park', label: 'Project admin', hint: 'Lee Park, no org role, admin on invoicer-api only' },
    { id: 'mira-chen', label: 'Member', hint: 'Mira Chen, member of Harbor Labs (no role in Northwind)' },
    { id: 'theo-brandt', label: 'Viewer', hint: 'Theo Brandt, viewer in Harbor Labs' },
    { id: 'ops-admin', label: 'Platform admin', hint: 'ops-admin (Morgan Avery), creates orgs, no org role' },
    { id: 'dana-ortiz', label: 'New user with invitations', hint: 'Dana Ortiz, no org yet, 2 pending invitations' },
    { id: 'jo-marsh', label: 'Visitor with no invitation', hint: 'Jo Marsh, sign-in is refused' },
  ];
  const USERS = {
    'kim-hale': { email: 'kim.hale@harborlabs.dev', name: 'Kim Hale', initials: 'KH' }, 'jordan-wu': { email: 'jordan.wu@harborlabs.dev', name: 'Jordan Wu', initials: 'JW' }, 'lee-park': { email: 'lee.park@harborlabs.dev', name: 'Lee Park', initials: 'LP' },
    'mira-chen': { email: 'mira.chen@example.com', name: 'Mira Chen', initials: 'MC' }, 'theo-brandt': { email: 'theo.brandt@example.com', name: 'Theo Brandt', initials: 'TB' }, 'ops-admin': { email: 'morgan.avery@agentdesk.example', name: 'Morgan Avery', initials: 'OA', platform: true },
    'dana-ortiz': { email: 'dana.ortiz@example.com', name: 'Dana Ortiz', initials: 'DO' }, 'jo-marsh': { email: 'jo.marsh@example.com', name: 'Jo Marsh', initials: 'JM' },
  };
  AD.USERS = USERS;

  AD.seed = function () {
    return {
      uid: null, // signed-in user id
      orgs: [
        { slug: 'harbor-labs', name: 'Harbor Labs' },
        { slug: 'northwind', name: 'Northwind Analytics' },
        { slug: 'riverside', name: 'Riverside Municipal Water and Power Utilities Digital Services' },
      ],
      members: seedMembers(),
      projects: seedProjects(),
      audit: { 'harbor-labs': seedAudit(), northwind: [], riverside: [] },
      invites: seedInvites(),
      // invitations addressed to the signed-in user (MyInvitations)
      mine: {
        'dana-ortiz': [
          { id: 'm1', org: 'harbor-labs', orgName: 'Harbor Labs', role: 'Member', access: 'invoicer-api, invoicer-web', by: 'Kim Hale', exp: { title: '23 Nov 2026, 14:05', iso: '2026-11-23T14:05', text: '23 Nov, 14:05' } },
          { id: 'm2', org: 'northwind', orgName: 'Northwind Analytics', role: 'Viewer', access: 'Whole organization', by: null, exp: { title: '22 Nov 2026, 09:30', iso: '2026-11-22T09:30', text: '22 Nov, 09:30' } },
        ],
        'mira-chen': [
          { id: 'm3', org: 'riverside', orgName: 'Riverside Municipal Water and Power Utilities Digital Services', role: 'Viewer', access: 'Whole organization', by: 'Sana Iqbal', exp: { title: '23 Nov 2026, 10:00', iso: '2026-11-23T10:00', text: '23 Nov, 10:00' } },
        ],
      },
      checklist: { northwind: { connect: true, project: true, agent: true, rule: false } },
    };
  };
  AD.state = AD.seed();

  /* ---------- orgs, access, permissions ---------- */
  AD.user = () => (AD.state.uid ? Object.assign({ id: AD.state.uid }, USERS[AD.state.uid]) : null);
  AD.org = (slug) => AD.state.orgs.find((o) => o.slug === slug) || null;
  AD.memberOf = (slug, uid) => (AD.state.members[slug] || []).find((m) => m.uid === uid) || null;
  // Orgs the user can see in the switcher: the ones they belong to; a platform admin sees all of them.
  AD.userOrgs = (uid) => {
    const u = USERS[uid] || {};
    if (u.platform) return AD.state.orgs.slice(0, 1).concat(AD.state.orgs.slice(3));
    return AD.state.orgs.filter((o) => AD.memberOf(o.slug, uid));
  };
  AD.roleLabel = (r) => ({ owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' }[r] || 'No role');

  AD.access = function (uid, slug) {
    const u = USERS[uid] || {};
    const m = AD.memberOf(slug, uid);
    const role = m ? m.role : null;
    const adminProjects = m ? m.projects.filter((p) => p.role === 'Admin').map((p) => p.name) : [];
    const known = !!m || !!u.platform;
    return { known, platform: !!u.platform, role, adminProjects, projectNames: m ? m.projects.map((p) => p.name) : [] };
  };
  AD.perm = function (uid, slug) {
    const a = AD.access(uid, slug);
    const orgAdmin = a.role === 'owner' || a.role === 'admin';
    const projectAdmin = a.adminProjects.length > 0;
    const hasContent = a.platform || !!a.role || a.projectNames.length > 0;
    return Object.assign({}, a, {
      isOwner: a.role === 'owner', orgAdmin, projectAdmin, hasContent,
      general: orgAdmin, members: orgAdmin, audit: orgAdmin,
      invitations: orgAdmin || projectAdmin,
      settings: orgAdmin || projectAdmin,
      createProject: orgAdmin,
      giveOwner: a.role === 'owner',
    });
  };
  AD.visibleProjects = function (uid, slug) {
    const a = AD.access(uid, slug);
    const all = AD.state.projects[slug] || [];
    if (a.platform || a.role) return all;
    return all.filter((p) => a.projectNames.includes(p.id));
  };
  AD.settingsFirstTab = (p) => (p.general ? 'general' : p.invitations ? 'invitations' : null);
  AD.settingsTabAllowed = (p, tab) => ({ general: p.general, members: p.members, audit: p.audit, invitations: p.invitations }[tab]);

  /* ---------- dates, paging ---------- */
  AD.pageSize = () => AD.ui.pageSize || 20;
  AD.slice = (arr, page) => {
    const size = AD.pageSize();
    const pages = Math.max(1, Math.ceil(arr.length / size));
    const p = Math.min(Math.max(1, page || 1), pages);
    return { rows: arr.slice((p - 1) * size, p * size), page: p, pages, total: arr.length, from: (p - 1) * size + 1, to: Math.min(arr.length, p * size) };
  };

  /* ---------- fake failure injection (Prototype controls: "Fail the next action") ---------- */
  AD.takeFail = function () {
    const f = AD.ui.fail;
    if (f === 'copy') return null; // only the copy-link action reads this one
    AD.ui.fail = 'none';
    const el = AD.$('#pc-fail');
    if (el) el.value = 'none';
    return f && f !== 'none' ? f : null;
  };
  AD.reqId = () => 'req_01JD' + Math.random().toString(36).slice(2, 10).toUpperCase();

  /* ---------- audit ---------- */
  AD.addAudit = function (slug, ev) {
    AD.clock.minutes += 1;
    const u = AD.user();
    const t = AD.nowLabel();
    const actor = { name: u ? u.name : 'Someone' };
    if (u && u.platform) actor.platform = true;
    AD.state.audit[slug] = AD.state.audit[slug] || [];
    AD.state.audit[slug].unshift({ id: 'a' + Date.now() + Math.random(), time: { title: t.title, iso: t.iso, rel: 'just now' }, actor, ev });
  };

  /* ---------- mutations (the fake "API"): return {ok} or {err:{status,title}} ---------- */
  const fail = (f) => {
    const map = {
      '500': { status: 500, title: 'Internal server error' },
      '403': { status: 403, title: "You don't have access" },
      '404': { status: 404, title: 'Member is no longer in the organization' },
      '409': { status: 409, title: 'An organization needs at least one owner.' },
    };
    return { err: Object.assign({ reqId: AD.reqId() }, map[f] || map['500']) };
  };
  const ownerCount = (slug) => AD.state.members[slug].filter((m) => m.role === 'owner').length;

  AD.api = {
    changeRole(slug, targetUid, newRole) {
      const f = AD.takeFail();
      if (f) return fail(f);
      const me = AD.perm(AD.state.uid, slug);
      const t = AD.memberOf(slug, targetUid);
      if (!me.orgAdmin) return fail('403');
      if (!t) return fail('404');
      if (!me.isOwner && (newRole === 'owner' || t.role === 'owner')) return fail('403');
      if (t.role === 'owner' && newRole !== 'owner' && ownerCount(slug) <= 1) return fail('409');
      const from = AD.roleLabel(t.role);
      t.role = newRole || null;
      AD.addAudit(slug, { k: 'role', who: t.name || t.handle, from, to: AD.roleLabel(t.role) });
      return { ok: true };
    },
    removeMember(slug, targetUid) {
      const f = AD.takeFail();
      if (f) return fail(f);
      const me = AD.perm(AD.state.uid, slug);
      const t = AD.memberOf(slug, targetUid);
      if (!me.orgAdmin || targetUid === AD.state.uid) return fail('403');
      if (!t) return fail('404');
      if (t.role === 'owner' && !me.isOwner) return fail('403');
      if (t.role === 'owner' && ownerCount(slug) <= 1) return { err: { status: 409, title: 'The organization needs at least one owner' } };
      AD.state.members[slug] = AD.state.members[slug].filter((m) => m.uid !== targetUid);
      AD.addAudit(slug, { k: 'removed', who: t.name || t.handle, role: t.role ? AD.roleLabel(t.role) : 'No role' });
      return { ok: true };
    },
    updateOrg(slug, name, newSlug) {
      const f = AD.takeFail();
      if (f) return fail(f);
      const o = AD.org(slug);
      if (!AD.perm(AD.state.uid, slug).orgAdmin) return fail('403');
      const oldName = o.name, oldSlug = o.slug;
      if (name !== oldName) { o.name = name; AD.addAudit(slug, { k: 'name', from: oldName, to: name }); }
      if (newSlug !== oldSlug) {
        for (const key of ['members', 'projects', 'audit', 'invites', 'checklist']) {
          if (AD.state[key][oldSlug] !== undefined) { AD.state[key][newSlug] = AD.state[key][oldSlug]; delete AD.state[key][oldSlug]; }
        }
        o.slug = newSlug;
        AD.addAudit(newSlug, { k: 'url', from: '/o/' + oldSlug, to: '/o/' + newSlug });
      }
      return { ok: true };
    },
    invite(slug, email, role, access) {
      const f = AD.takeFail();
      if (f === '500') return fail('500');
      if (f === '403') return { err: { status: 409, title: 'This organization was switched in another tab. Try again.', toast: true } };
      const list = AD.state.invites[slug];
      if (list.some((i) => i.email.toLowerCase() === email.toLowerCase() && i.status === 'pending')) return { field: 'This email already has a pending invitation.' };
      const t = AD.nowLabel();
      const inv = { id: 'i' + Date.now(), email, role: AD.roleLabel(role), access, status: 'pending', exp: { rel: 'Expires in 1 day', title: '23 Nov 2026, ' + t.title.slice(-5), iso: '2026-11-23T' + t.title.slice(-5) }, by: AD.user().name };
      list.unshift(inv);
      AD.addAudit(slug, { k: 'invited', email, role: AD.roleLabel(role) });
      return { ok: true, inv };
    },
    resend(slug, id) {
      const f = AD.takeFail();
      if (f) return { err: { status: 409, title: 'Invitation is no longer pending' } };
      const inv = AD.state.invites[slug].find((i) => i.id === id);
      if (!inv || inv.status !== 'pending') return { err: { status: 409, title: 'Invitation is no longer pending' } };
      AD.clock.minutes += 1;
      inv.exp = { rel: 'Expires in 1 day', title: '23 Nov 2026, 15:02', iso: '2026-11-23T15:02' };
      AD.addAudit(slug, { k: 'resent', email: inv.email });
      return { ok: true };
    },
    revoke(slug, id) {
      const f = AD.takeFail();
      if (f) return fail('500');
      const inv = AD.state.invites[slug].find((i) => i.id === id);
      if (!inv || inv.status !== 'pending') return { err: { status: 409, title: 'Invitation is no longer pending' } };
      inv.status = 'revoked';
      inv.exp = null;
      AD.addAudit(slug, { k: 'revoked', email: inv.email });
      return { ok: true };
    },
  };

  /* ---------- audit sentence ---------- */
  AD.auditText = function (e) {
    const b = (x) => `<b style="font-weight:500">${AD.esc(x)}</b>`;
    const who = e.actor.name;
    const ev = e.ev;
    const plain = (t) => t.replace(/<[^>]+>/g, '');
    let html;
    switch (ev.k) {
      case 'role': html = `${b(who)} changed ${b(ev.who)}'s role from ${AD.esc(ev.from)} to ${AD.esc(ev.to)}`; break;
      case 'url': html = `${b(who)} changed the organization URL from ${AD.esc(ev.from)} to ${AD.esc(ev.to)}`; break;
      case 'name': html = `${b(who)} changed the organization name from ${AD.esc(ev.from)} to ${AD.esc(ev.to)}`; break;
      case 'removed': html = `${b(who)} removed ${b(ev.who)} from the organization (was ${AD.esc(ev.role)})`; break;
      case 'invited': html = `${b(ev.actorShort || who)} invited ${b(ev.email)} as ${AD.esc(ev.role)}`; break;
      case 'revoked': html = `${b(who)} revoked the invitation for ${b(ev.email)}`; break;
      case 'resent': html = `${b(who)} resent the invitation for ${b(ev.email)}`; break;
      case 'accepted': html = `${b(who)} accepted an invitation as ${AD.esc(ev.role)}`; break;
      case 'declined': html = `${b(who)} declined an invitation`; break;
      default: html = `<span class="mono" style="color:var(--text)">${AD.esc(ev.key)}</span>`;
    }
    return { html, title: plain(html.replace(/<b[^>]*>/g, '').replace(/<\/b>/g, '')) };
  };
})();
