import { createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { Route as PlatformIndexRoute } from '@/app/routes/platform.index';
import { Route as PlatformRoute } from '@/app/routes/platform';
import { createTestRootRoute, renderRoute } from '@/test/renderRoute';
import { accessKeys } from '@/features/access/keys';
import { api } from '../api';

/** Paths of the requests the browser sends until `stop()`. */
function capture() {
  const paths: string[] = [];
  const listener = ({ request }: { request: Request }) => void paths.push(new URL(request.url).pathname);
  server.events.on('request:start', listener);
  stop = () => server.events.removeListener('request:start', listener);
  return paths;
}
let stop = () => {};

/** A file route's options carry the generated `id`; a code route takes `path` instead, never both. */
function withoutId<T extends object>(options: T): T {
  const rest = { ...options };
  Reflect.deleteProperty(rest, 'id');
  return rest;
}

/**
 * The real /platform layout and index with stand-in children at /platform/admins and /platform/orgs.
 * The child loads `platform.listOrgs`, so a test can have a child platform query fail.
 */
function platformTree() {
  const root = createTestRootRoute();
  // @ts-expect-error -- the file route's options are typed against the generated tree's parent, not this test root
  const shell = createRoute({ ...withoutId(PlatformRoute.options), path: '/platform', getParentRoute: () => root });
  // @ts-expect-error -- same: the generated index route is typed against the generated shell route
  const index = createRoute({ ...withoutId(PlatformIndexRoute.options), path: '/', getParentRoute: () => shell });
  const admins = createRoute({
    getParentRoute: () => shell,
    path: '/admins',
    loader: ({ context: { queryClient } }) =>
      queryClient.ensureQueryData({ queryKey: ['platform', 'orgs', {}], queryFn: () => api.platform.listOrgs() }),
    component: () => <p>Admins page</p>,
  });
  const orgs = createRoute({ getParentRoute: () => shell, path: '/orgs', component: () => <p>Orgs page</p> });
  return root.addChildren([shell.addChildren([index, admins, orgs])]);
}
afterEach(() => stop());

describe('the platform shell', () => {
  it('BR-2: /platform redirects to /platform/orgs', async () => {
    const { router } = await renderRoute('/platform', {
      routeTree: platformTree(),
      scenario: () => scenarios.platform('platformAdminOrgs'),
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/platform/orgs'));
  });

  it('BR-2: the platform bar reads Platform with the Platform sections tabs and no "No organization"', async () => {
    await renderRoute('/platform/admins', {
      routeTree: platformTree(),
      scenario: () => scenarios.platform('platformAdminNoOrg'),
    });
    const tabs = await screen.findByRole('navigation', { name: 'Platform sections' });
    expect(within(tabs).getByRole('link', { name: 'Organizations' })).toHaveAttribute('href', '/platform/orgs');
    expect(within(tabs).getByRole('link', { name: 'Platform admins' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Audit log' })).toHaveAttribute('href', '/platform/audit');
    expect(screen.getByRole('button', { name: 'Switch scope, currently Platform' })).toBeInTheDocument();
    expect(screen.queryByText('No organization')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Platform admin' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Org settings' })).toBeNull();
  });

  describe('inside one org', () => {
    const ACME = 'b8000000-0000-4000-8000-000000000001';
    const UNKNOWN = 'b8000000-0000-4000-8000-0000000000ff';
    const orgTree = () => {
      const root = createTestRootRoute();
      // @ts-expect-error -- the file route's options are typed against the generated tree's parent, not this test root
      const shell = createRoute({ ...withoutId(PlatformRoute.options), path: '/platform', getParentRoute: () => root });
      const orgs = createRoute({ getParentRoute: () => shell, path: '/orgs', component: () => <p>Orgs page</p> });
      const org = createRoute({ getParentRoute: () => orgs, path: '$orgId', component: () => <p>Org page</p> });
      return root.addChildren([shell.addChildren([orgs.addChildren([org])])]);
    };

    it('an unknown org id shows Organizations / Not found, no side menu, title "Not found · Agent Desk"', async () => {
      await renderRoute(`/platform/orgs/${UNKNOWN}`, {
        routeTree: orgTree(),
        scenario: () => scenarios.platform('platformAdminOrgs'),
      });
      const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
      expect(await within(crumbs).findByText('Not found')).toBeInTheDocument();
      expect(within(crumbs).getByRole('link', { name: 'Organizations' })).toHaveAttribute('href', '/platform/orgs');
      expect(screen.queryByRole('navigation', { name: 'Platform admin' })).toBeNull();
      await waitFor(() => expect(document.title).toBe('Not found · Agent Desk'));
    });

    it('a failed org read labels the crumb and the side menu "Organization"', async () => {
      await renderRoute(`/platform/orgs/${ACME}`, {
        routeTree: orgTree(),
        scenario: () => {
          scenarios.platform('platformAdminOrgs');
          scenarios.serverError('platform.getOrg');
        },
      });
      const menu = await screen.findByRole('navigation', { name: 'Platform admin' });
      await waitFor(() => expect(within(menu).getByRole('link', { name: 'Organization' })).toBeInTheDocument());
      expect(within(menu).getByRole('link', { name: 'Members' })).toHaveAttribute(
        'href',
        `/platform/orgs/${ACME}/members`,
      );
      const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(within(crumbs).getByText('Organization')).toBeInTheDocument();
    });

    it('a ready org shows its name in the side menu group', async () => {
      await renderRoute(`/platform/orgs/${ACME}`, {
        routeTree: orgTree(),
        scenario: () => scenarios.platform('platformAdminOrgs'),
      });
      const menu = await screen.findByRole('navigation', { name: 'Platform admin' });
      expect(await within(menu).findByRole('link', { name: 'Acme' })).toHaveAttribute('href', `/platform/orgs/${ACME}`);
      expect(
        within(menu)
          .getAllByRole('link')
          .map((a) => a.textContent),
      ).toEqual(['Acme', 'Overview', 'Projects', 'Members', 'Invitations']);
    });
  });

  it('BR-3: a non-admin on /platform/admins sees the forbidden state, the org bar and sends no platform request', async () => {
    const paths = capture();
    await renderRoute('/platform/admins', {
      routeTree: platformTree(),
      scenario: () => scenarios.platform('ownerNoPlatform'),
    });
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
    expect(screen.getByText('This area is for platform admins.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to projects' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Platform admin' })).toBeNull();
    expect(paths.filter((p) => p.startsWith('/api/platform/'))).toEqual([]);
  });

  it('BR-3: a signed-out visitor goes to sign-in, not the forbidden state', async () => {
    const { router } = await renderRoute('/platform/admins', { scenario: scenarios.signedOut });
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(screen.queryByRole('heading', { name: "You don't have access" })).toBeNull();
  });

  it('a 403 from a child platform query shows the same forbidden state', async () => {
    await renderRoute('/platform/admins', {
      routeTree: platformTree(),
      scenario: () => {
        scenarios.platform('platformAdminOrgs');
        scenarios.problem('platform.listOrgs', { status: 403, title: 'Forbidden', type: 'forbidden' });
      },
    });
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
  });

  it('a stale non-admin answer is refetched: a user granted platform admin gets in without a reload', async () => {
    const { router, queryClient } = await renderRoute('/platform/admins', {
      routeTree: platformTree(),
      scenario: () => scenarios.platform('ownerNoPlatform'),
    });
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
    scenarios.platform('platformAdminOrgs');
    // Age the cached answer past the 30 s staleTime without a refetch (no observer sees a change).
    queryClient.getQueryCache().find({ queryKey: accessKeys.platform() })?.setState({ dataUpdatedAt: 0 });
    await router.navigate({ to: '/platform' });
    expect(await screen.findByRole('navigation', { name: 'Platform sections' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "You don't have access" })).toBeNull();
  });

  it('a 500 on me.platform shows the load error with Retry', async () => {
    await renderRoute('/platform', {
      routeTree: platformTree(),
      scenario: () => {
        scenarios.platform('platformAdminOrgs');
        scenarios.serverError('me.platform');
      },
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
