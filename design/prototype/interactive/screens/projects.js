/* Projects list (the org home). Built from Projects*, ProjectsChecklist*, ProjectsEmpty* boards.
   Settings is a tab in the top bar (chrome.js). A Settings button in this page's header is a proposal under review (off by default). */
(function () {
  'use strict';
  const AD = window.AD;
  const esc = AD.esc;
  const I = AD.I;
  const WRAP = 'flex:1;padding:36px 48px;display:flex;flex-direction:column;gap:20px;max-width:1240px;width:100%;margin:0 auto';
  const small = (svg) => svg.replace(/width="18" height="18"/, 'width="14" height="14"');

  function connCell(p) {
    const c = p.conn;
    if (c.kind === 'ok') return `<span class="row" style="gap:6px;font-size:13px"><span class="st st-succeeded" title="status: succeeded">${I.stOk}</span>${esc(c.text)}</span>`;
    if (c.kind === 'fail') return `<span class="row" style="gap:6px;font-size:13px"><span class="st st-failed" title="status: failed">${I.stFail}</span>${esc(c.text)}</span>`;
    return `<span class="row" style="gap:6px;font-size:13px;color:var(--idle)">${small(I.warn)}${esc(c.text)}</span><button class="btn sm" style="margin-top:6px" data-act="to-polling" data-id="${esc(p.id)}">${esc(c.action)}</button>`;
  }
  function projectRow(ctx, p) {
    const base = '/o/' + ctx.orgSlug + '/p/' + p.id;
    return `<tr><td><a href="${AD.href(base + '/runs')}" style="color:var(--text);font-weight:600">${esc(p.id)}</a><div class="faint mono" style="font-size:12px">${esc(p.repo)}</div></td><td>${connCell(p)}</td><td>${p.needs ? `<span class="st st-idle st-pill" title="status: idle">${I.stIdle}${p.needs} run${p.needs > 1 ? 's' : ''}</span>` : '<span class="faint">None</span>'}</td><td class="num">${p.running}</td><td class="num">${p.queued}</td><td class="${p.last ? 'muted' : 'faint'}" style="font-size:13px">${p.last ? esc(p.last) : 'None'}</td><td style="text-align:right"><button class="btn ghost iconbtn" aria-label="More for ${esc(p.id)}">${I.dots}</button></td></tr>`;
  }
  function checklist(ctx) {
    const c = AD.state.checklist[ctx.orgSlug];
    if (!c) return '';
    if (c.connect && c.project && c.agent && c.rule) return '';
    const steps = [['connect', 'Connect a code host', '1'], ['project', 'Create a project', '1'], ['agent', 'Add an agent', '2'], ['rule', 'Add a rule', '4']];
    const li = steps.map(([k, label, step]) => c[k]
      ? `<li class="row" style="gap:10px;padding:10px 0;border-top:1px solid var(--line)"><span class="st st-succeeded" title="Done">${I.stOk}</span><span class="grow" style="font-weight:500">${label}</span><span class="muted" style="font-size:13px">Done</span></li>`
      : `<li class="row" style="gap:10px;padding:10px 0;border-top:1px solid var(--line)"><span class="st st-queued" title="Not done">${I.stQueued}</span><span class="grow" style="font-weight:500">${label}</span><a href="${AD.href('/o/' + ctx.orgSlug + '/projects/new/' + step)}" class="btn sm">Start</a></li>`).join('');
    return `<section aria-labelledby="gs-h" style="border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:16px;display:flex;flex-direction:column;gap:10px"><h2 id="gs-h">Get started</h2><ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column">${li}</ol></section>`;
  }
  function pendingBanner(ctx) {
    const n = (AD.state.mine[ctx.uid] || []).length;
    if (!n) return '';
    return `<div class="banner off" role="status" style="align-items:center"><span class="b-ico">${I.mail}</span><span class="grow">You have ${n} pending invitation${n > 1 ? 's' : ''}.</span><a href="${AD.href('/invitations')}" class="btn sm">View</a></div>`;
  }
  const settingsBtn = (ctx, lg) => (ctx.perm.settings && AD.proposals.projectsSettingsButton ? `<a href="${AD.href('/o/' + ctx.orgSlug + '/settings')}" class="btn${lg ? ' lg' : ''}">Settings</a>` : '');
  const newBtn = (ctx) => `<a href="${AD.href('/o/' + ctx.orgSlug + '/projects/new/1')}" class="btn primary">${I.plus}New project</a>`;

  AD.acts['to-polling'] = (el) => {
    const p = (AD.state.projects[AD.cur.params.org] || []).find((x) => x.id === el.dataset.id);
    if (!p) return;
    el.disabled = true; el.setAttribute('aria-busy', 'true'); el.textContent = 'Switching…';
    setTimeout(() => { p.conn = { kind: 'ok', text: 'Polling every 5 min' }; AD.toast('ok', 'Switched to polling'); AD.render(); }, 600);
  };

  AD.screens.projects = {
    title: 'Projects',
    snaps: () => AD.snapGroup(AD.boardNames(/^Projects/)),
    render(ctx) {
      const s = ctx.scen;
      if (s !== 'live' && AD.B[s]) return AD.boardOut(s);
      if (s === 'forbidden' || !ctx.perm.hasContent) return AD.boardOut('ProjectsNoAccess');
      if (s === 'crash') return AD.boardOut('RouteError');
      if (s === 'loading') return AD.boardOut('ProjectsSwitching');
      if (s === 'error') return { header: 'global', h: 900, html: AD.errorMain() };
      const visible = s === 'empty' ? [] : AD.visibleProjects(ctx.uid, ctx.orgSlug);
      if (!visible.length) {
        if (!ctx.perm.createProject) return AD.boardOut('ProjectsEmptyNoCreate');
        const withChecklist = !!AD.state.checklist[ctx.orgSlug];
        const out = AD.boardOut(withChecklist ? 'ProjectsEmptyChecklist' : 'ProjectsEmpty');
        const create = new RegExp('(<a href="[^"]*" class="btn primary lg">[\\s\\S]*?Create project</a>)');
        out.html = out.html.replace(/<a href="[^"]*" class="btn lg">(Invitations|Settings)<\/a>/, '').replace(create, '$1' + settingsBtn(ctx, true));
        return out;
      }
      const showNew = ctx.perm.createProject;
      const main = `<main style="${WRAP}">${pendingBanner(ctx)}<div class="row" style="justify-content:space-between"><h1>Projects</h1><div class="row" style="gap:8px">${settingsBtn(ctx)}${showNew ? newBtn(ctx) : ''}</div></div><p class="muted" style="font-size:13.5px">After sign-in you land on the runs of the project you used last. This list is one click away on the Projects tab.</p>${ctx.perm.createProject ? checklist(ctx) : ''}<table><thead><tr><th>Project</th><th>GitHub</th><th>Needs you</th><th>Running</th><th>Queued</th><th>Last run</th><th></th></tr></thead><tbody>${visible.map((p) => projectRow(ctx, p)).join('')}</tbody></table></main>`;
      return { header: 'global', h: 900, html: main };
    },
  };
})();
