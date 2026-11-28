import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { applyProjectSpace, PROJECT_SPACE_ROLES, type ProjectSpaceRole } from '@/mocks/msw/projectSpaceScenarios';
import { applyShellScenario, FOREIGN } from '@/mocks/msw/shellScenarios';
import { renderRoute } from '@/test/renderRoute';

// BR-29 and BR-82: the bare project URL and the bare /desk URL (with or without a slash) replace themselves with Runs.

const P1 = ids.project.invoicerApi;
const P2 = ids.project.invoicerWeb;
const UNKNOWN = '0badc0de-0000-4000-8000-00000000abcd';
const base = (project: string, org = 'alice') => `/o/${org}/p/${project}`;

let stopLog: (() => void) | undefined;
afterEach(() => {
  stopLog?.();
  stopLog = undefined;
});

/** The GET paths the app requests, in order. */
function logGets() {
  const gets: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method === 'GET') gets.push(new URL(request.url).pathname);
  };
  server.events.on('request:start', listener);
  stopLog = () => server.events.removeListener('request:start', listener);
  return gets;
}

const asRole = (role: ProjectSpaceRole) => () => applyProjectSpace(mockDb, { role });
const runsHeading = () => screen.findByRole('heading', { level: 1, name: 'Runs' });
// What the Desk pages load. Runs itself reads the setup script for an admin (the setup warning), so only a member or
// viewer must show none of it; for everyone the redirect adds no Desk page data.
const DESK_DATA = /\/(agent|agents|skills|rules|plugins)(\/|$)/;
const SETUP_DATA = /\/(setup-script|setup-tests)(\/|$)/;

describe.each([
  ['the bare project URL', (p: string) => base(p)],
  ['the bare /desk URL', (p: string) => `${base(p)}/desk`],
  ['the bare /desk/ URL with a trailing slash', (p: string) => `${base(p)}/desk/`],
])('%s', (_name, urlOf) => {
  it.each(PROJECT_SPACE_ROLES)(
    'TC-29.1, TC-82.1: a %s lands on Runs and the redirect asks for no Desk data',
    async (role) => {
      const gets = logGets();
      const { router } = await renderRoute(urlOf(P1), { scenario: asRole(role) });
      expect(await runsHeading()).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(`${base(P1)}/runs`);
      expect(gets.filter((p) => DESK_DATA.test(p))).toEqual([]);
      if (role === 'member' || role === 'viewer') expect(gets.filter((p) => SETUP_DATA.test(p))).toEqual([]);
    },
  );

  it('TC-29.2, TC-82.3: an admin of P1 only sees Page not found for P2 without its name', async () => {
    await renderRoute(urlOf(P2), { scenario: asRole('projectAdmin') });
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByText('invoicer-web')).not.toBeInTheDocument();
  });

  it('TC-29.3, TC-82.5: an unknown project is Page not found', async () => {
    await renderRoute(urlOf(UNKNOWN), { scenario: asRole('owner') });
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it.each(['alice', FOREIGN.orgSlug])(
    'TC-82.4: another org project under the %s slug is Page not found without its name',
    async (org) => {
      await renderRoute(urlOf(FOREIGN.projectId).replace('/o/alice/', `/o/${org}/`), {
        scenario: () => applyShellScenario('foreignOrg'),
      });
      expect(await screen.findByText('Page not found')).toBeInTheDocument();
      expect(screen.queryByText(FOREIGN.projectName)).not.toBeInTheDocument();
    },
  );
});

describe('Back after the bare /desk redirect (TC-82.2)', () => {
  it('returns to the page before and stays there', async () => {
    const { router } = await renderRoute('/o/alice/projects', { scenario: asRole('owner') });
    await screen.findByRole('heading', { level: 1, name: 'Projects' });
    await router.navigate({ to: `${base(P1)}/desk` });
    expect(await runsHeading()).toBeInTheDocument();
    router.history.back();
    await screen.findByRole('heading', { level: 1, name: 'Projects' });
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.pathname).toBe('/o/alice/projects');
  });
});

describe('the rest of /desk is untouched (BR-82)', () => {
  it.each([
    ['agent', 'Agent & settings'],
    ['setup', 'Workspace setup'],
    ['skills', 'Skills'],
    ['rules', 'Routing rules'],
    ['members', 'Members'],
    ['audit', 'Audit log'],
  ])('TC-82.5: /desk/%s opens %s, not Runs', async (page, title) => {
    const { router } = await renderRoute(`${base(P1)}/desk/${page}`, { scenario: asRole('owner') });
    expect((await screen.findAllByRole('heading', { name: title })).length).toBeGreaterThan(0);
    expect(router.state.location.pathname).toBe(`${base(P1)}/desk/${page}`);
  });

  it('TC-82.5: an unknown /desk/<x> is Page not found', async () => {
    await renderRoute(`${base(P1)}/desk/nope`, { scenario: asRole('owner') });
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it('a top-level /desk stays Page not found', async () => {
    await renderRoute('/desk', { scenario: asRole('owner') });
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it('TC-82.6: /desk/agent?tab=limits keeps its search, opens Limits and does not open Runs', async () => {
    const { router } = await renderRoute(`${base(P1)}/desk/agent?tab=limits`, { scenario: asRole('owner') });
    expect(await screen.findByRole('tab', { name: 'Limits', selected: true })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.href).toBe(`${base(P1)}/desk/agent?tab=limits`));
  });
});
