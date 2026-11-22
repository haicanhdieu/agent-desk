/* Screens that render the drawn boards as they are: project setup, runs list, run page, Desk, needs-you, index,
   gallery, plain snapshots. The scenario selector lists every board of the family. */
(function () {
  'use strict';
  const AD = window.AD;

  AD.screens.notfound = { title: 'Not found', render: () => AD.notFoundOut() };
  AD.screens.index = {
    title: 'Board index',
    render(ctx) { return ctx.scen === 'live' ? AD.boardOut('Main') : AD.standardState(ctx.scen, {}, 'none'); },
  };
  AD.screens.gallery = {
    title: 'Pagination and paged-list states',
    snaps: () => AD.snapGroup(['Pagination', 'RouteLoading', 'RouteError']),
    render(ctx) { return AD.boardOut(AD.B[ctx.scen] ? ctx.scen : 'Pagination'); },
  };
  AD.screens.snapshot = {
    title: 'Board snapshot',
    render(ctx) { return AD.B[ctx.params.board] ? AD.boardOut(ctx.params.board) : AD.notFoundOut('No board named ' + ctx.params.board); },
  };

  // Project scope: a person sees only projects they may see; anything else is "not found" (never "forbidden").
  function projectGate(ctx) {
    const ok = AD.visibleProjects(ctx.uid, ctx.orgSlug).some((p) => p.id === ctx.params.project);
    return ok ? null : AD.notFoundOut('This project does not exist, or you cannot see it.');
  }
  // Generic family renderer: scenario id = board name; standard states map through `alias`, else the generic markup.
  function family(def, header, alias, extra) {
    return (ctx, name) => {
      const s = ctx.scen;
      if (s !== 'live' && AD.B[s]) return AD.boardOut(s, extra);
      const std = AD.standardState(s, alias, header);
      if (std) return Object.assign(std, extra || {});
      return AD.boardOut(name, extra);
    };
  }

  const SETUP = { 1: 'Setup1', 2: 'Setup2', 3: 'Setup3', 4: 'Setup4', ready: 'SetupReady', workspace: 'SetupWorkspace' };
  AD.screens.setup = {
    title: 'New project',
    snaps: () => AD.snapGroup(AD.boardNames(/^Setup/)),
    render(ctx) {
      const name = SETUP[ctx.params.step];
      if (!name) return AD.notFoundOut();
      if (ctx.scen === 'live' && !ctx.perm.createProject) return AD.settingsForbiddenLike();
      return family(null, 'global', {})(ctx, name);
    },
  };
  AD.settingsForbiddenLike = () => ({ header: 'global', h: 900, html: AD.forbiddenMain });

  AD.screens.runs = {
    title: 'Runs',
    snaps: () => AD.snapGroup(AD.boardNames(/^Runs/)),
    render(ctx) {
      const g = projectGate(ctx); if (g && !AD.B[ctx.scen]) return g;
      return family(null, 'project', { empty: 'RunsEmpty', loading: 'RunsPageLoading', error: null }, { sample: true })(ctx, 'Runs');
    },
  };
  AD.screens.run = {
    title: 'Run',
    snaps: () => AD.snapGroup(AD.boardNames(/^Run[A-Z]/).filter((n) => AD.B[n].kind === 'run').concat(['RunTranscriptStates'])),
    render(ctx) {
      const g = projectGate(ctx); if (g && !AD.B[ctx.scen]) return g;
      const name = AD.RUN_DEFAULT[ctx.params.n];
      if (!name && !AD.B[ctx.scen]) return AD.notFoundOut('This run does not exist, or you cannot see it.');
      return family(null, 'project', { error: null }, { sample: true })(ctx, name);
    },
  };
  const DESK = { skills: 'DeskSkills', rules: 'DeskRules', setup: 'DeskSetup', agent: 'DeskAgent' };
  const DESK_RE = { skills: /^DeskSkill/, rules: /^DeskRules/, setup: /^DeskSetup/, agent: /^DeskAgent/ };
  const DESK_ALIAS = {
    skills: { empty: 'DeskSkillsEmpty' }, rules: { empty: 'DeskRulesEmpty' },
    setup: { empty: 'DeskSetupVersionsEmpty', loading: 'DeskSetupVersionsLoading', error: 'DeskSetupVersionsError' }, agent: {},
  };
  AD.screens.desk = {
    title: 'Desk',
    snaps: (ctx) => AD.snapGroup(AD.boardNames(DESK_RE[ctx.params.tab] || /^Desk/)),
    render(ctx) {
      const name = DESK[ctx.params.tab];
      if (!name) return AD.notFoundOut();
      const g = projectGate(ctx); if (g && !AD.B[ctx.scen]) return g;
      return family(null, 'project', DESK_ALIAS[ctx.params.tab], { sample: true })(ctx, name);
    },
  };
  AD.screens.needsyou = {
    title: 'Needs you',
    snaps: () => AD.snapGroup(AD.boardNames(/^NeedsYou/)),
    render(ctx) { return family(null, 'global', { empty: 'NeedsYouEmpty' })(ctx, 'NeedsYou'); },
  };
})();
