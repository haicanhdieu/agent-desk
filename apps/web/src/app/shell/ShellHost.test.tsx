import { ORG_HEADER } from '@agentdesk/contracts';
import { createRoute, type AnyRoute } from '@tanstack/react-router';
import { act, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useReportPageState } from '@/components';
import type { RouteChrome } from '@/features/chrome/routeChrome';
import { sessionQuery, type Session } from '@/features/auth/session';
import { ids } from '@/mocks/dto/ids';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { createTestRootRoute, renderRoute } from '@/test/renderRoute';
import { setViewportWidth } from '@/test/fakeMatchMedia';

let mounts = 0;
let unmounts = 0;

beforeEach(() => {
  mounts = 0;
  unmounts = 0;
});

afterEach(() => {
  server.events.removeAllListeners();
});

/** A page that counts how often it mounts, so a remount by the shell is visible. */
function Page({ name = 'Page', state }: { name?: string; state?: 'forbidden' | 'notFound' }) {
  useEffect(() => {
    mounts += 1;
    return () => {
      unmounts += 1;
    };
  }, []);
  useReportPageState(state);
  return (
    <main id="main">
      <p>{name} content</p>
    </main>
  );
}

const standard = (extra: Partial<RouteChrome> = {}): RouteChrome => ({ mode: 'standard', ...extra });

function buildTree(): AnyRoute {
  const root = createTestRootRoute();
  const route = (path: string, chrome: RouteChrome | undefined, page = <Page />) =>
    createRoute({
      getParentRoute: () => root,
      path,
      ...(chrome && { staticData: { chrome } }),
      validateSearch: (s: Record<string, unknown>) => ({ tab: typeof s.tab === 'string' ? s.tab : undefined }),
      component: () => page,
    });
  return root.addChildren([
    route('/plain', undefined, <main id="main">plain content</main>),
    route('/o/$org/projects', standard({ scope: 'org', item: 'projects', crumb: 'Projects' })),
    route('/o/$org/other', standard({ scope: 'org', item: 'projects', crumb: 'Other' }), <Page name="Other" />),
    route('/o/$org/second', standard({ scope: 'org', item: 'projects', crumb: 'Second' }), <Page name="Second" />),
    route(
      '/o/$org/filled',
      standard({ scope: 'org', item: 'projects', crumb: 'Filled', fill: true }),
      <Page name="Filled" />,
    ),
    route(
      '/o/$org/started',
      standard({ scope: 'org', item: 'projects', crumb: 'Started', startCollapsed: true }),
      <Page name="Started" />,
    ),
    route('/o/$org/new', { mode: 'wizard', scope: 'org', crumb: 'New project' }, <Page name="Wizard" />),
    route(
      '/o/$org/denied',
      standard({ scope: 'org', item: 'projects', crumb: 'Denied' }),
      <Page name="Denied" state="forbidden" />,
    ),
    route(
      '/o/$org/missing',
      standard({ scope: 'org', item: 'projects', crumb: 'Missing' }),
      <Page name="Missing" state="notFound" />,
    ),
  ]);
}

const org = () => ({ scenario: () => scenarios.onboarding('twoOrgs'), routeTree: buildTree() });

async function ready() {
  await screen.findByRole('link', { name: 'Projects' });
}

describe('ShellHost: ownership', () => {
  it('a route without chrome gets no banner or navigation from the host', async () => {
    await renderRoute('/plain', org());
    await screen.findByText('plain content');
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('a route with chrome gets one banner, one navigation and the one main of the page', async () => {
    await renderRoute('/o/alice/projects', org());
    await ready();
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('navigation', { name: 'Organization menu' })).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  it('a fill route gives the app the viewport fill mode, another route does not', async () => {
    const { router } = await renderRoute('/o/alice/filled', org());
    await ready();
    const root = () => screen.getByRole('banner').parentElement as HTMLElement;
    const filled = root().className;
    await act(() => router.navigate({ href: '/o/alice/other' }));
    await screen.findByText('Other content');
    expect(root().className).not.toBe(filled);
  });
});

describe('ShellHost: the page stays mounted', () => {
  it('through collapse, expand, drawer, viewport changes, menu loading and a notFound report', async () => {
    const { user } = await renderRoute('/o/alice/projects', org());
    await ready();
    expect(mounts).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Collapse menu' }));
    await user.click(screen.getByRole('button', { name: 'Expand menu' }));
    act(() => setViewportWidth(390));
    await user.click(await screen.findByRole('button', { name: 'Open menu' }));
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    act(() => setViewportWidth(1440));
    await screen.findByRole('button', { name: 'Collapse menu' });
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it('through the menu loading to ready', async () => {
    await renderRoute('/o/alice/projects', org());
    expect(mounts).toBe(1);
    await ready();
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it('through a notFound report', async () => {
    await renderRoute('/o/alice/missing', org());
    await waitFor(() => expect(document.title).toBe(`Not found · Agent Desk`));
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it('changing only the search params keeps the page, the current item, the crumbs and the title', async () => {
    const { router } = await renderRoute('/o/alice/projects', org());
    await ready();
    const title = document.title;
    const crumb = () => within(screen.getByRole('banner')).getByText('Alice').textContent;
    expect(crumb()).toBe('Alice');
    await act(() => router.navigate({ href: '/o/alice/projects?tab=x' }));
    await act(() => router.navigate({ href: '/o/alice/projects?tab=y' }));
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    expect(screen.getByRole('link', { name: 'Projects', current: 'page' })).toBeInTheDocument();
    expect(document.title).toBe(title);
    expect(crumb()).toBe('Alice');
  });
});

describe('ShellHost: the document title', () => {
  it('is built from the crumbs', async () => {
    await renderRoute('/o/alice/projects', org());
    await waitFor(() => expect(document.title).toBe('Projects · Alice · Agent Desk'));
  });

  it('is the forbidden title for a page that reports forbidden', async () => {
    await renderRoute('/o/alice/denied', org());
    await waitFor(() => expect(document.title).toBe("You don't have access · Agent Desk"));
  });
});

describe('ShellHost: org switch race', () => {
  it('after moving from org A to org B no A name is left and no request leaves with B while the session is on A', async () => {
    const { router, queryClient } = await renderRoute('/o/alice/projects', {
      scenario: () => scenarios.onboarding('twoOrgs'),
    });
    await ready();
    const wrong: string[] = [];
    const sentToB: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const session = queryClient.getQueryData<Session | null>(sessionQuery.queryKey);
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/') && request.headers.get(ORG_HEADER) === ids.org.acme) {
        sentToB.push(url.pathname);
        if (session?.activeOrganizationId !== ids.org.acme) wrong.push(url.pathname);
      }
    });
    await act(() => router.navigate({ href: '/o/acme/projects' }));
    await waitFor(() =>
      expect(queryClient.getQueryData<Session | null>(sessionQuery.queryKey)?.activeOrganizationId).toBe(ids.org.acme),
    );
    // The top bar is the first banner; the page's own heading row is a header too.
    const [bar] = screen.getAllByRole('banner');
    if (!bar) throw new Error('no top bar');
    expect(within(bar).queryByText('Alice')).toBeNull();
    await waitFor(() => expect(sentToB.length).toBeGreaterThan(0));
    expect(wrong).toEqual([]);
  });
});

describe('ShellHost: collapse state', () => {
  it('the shared choice survives navigation between pages', async () => {
    const { router, user } = await renderRoute('/o/alice/projects', org());
    await ready();
    await user.click(screen.getByRole('button', { name: 'Collapse menu' }));
    await act(() => router.navigate({ href: '/o/alice/other' }));
    await screen.findByText('Other content');
    expect(screen.getByRole('button', { name: 'Expand menu' })).toBeInTheDocument();
  });

  it('a startCollapsed page starts collapsed on every entry and its toggles leave the shared choice alone', async () => {
    const { router, user } = await renderRoute('/o/alice/started', org());
    await screen.findByRole('button', { name: 'Expand menu' });
    await user.click(screen.getByRole('button', { name: 'Expand menu' }));
    expect(screen.getByRole('button', { name: 'Collapse menu' })).toBeInTheDocument();
    await act(() => router.navigate({ href: '/o/alice/other' }));
    await screen.findByText('Other content');
    expect(screen.getByRole('button', { name: 'Collapse menu' })).toBeInTheDocument();
    await act(() => router.navigate({ href: '/o/alice/started' }));
    await screen.findByText('Started content');
    expect(screen.getByRole('button', { name: 'Expand menu' })).toBeInTheDocument();
  });

  it('the wizard shows no toggle and leaves the shared choice', async () => {
    const { router, user } = await renderRoute('/o/alice/projects', org());
    await ready();
    await user.click(screen.getByRole('button', { name: 'Collapse menu' }));
    await act(() => router.navigate({ href: '/o/alice/new' }));
    await screen.findByText('Wizard content');
    expect(screen.queryByRole('button', { name: /Collapse menu|Expand menu/ })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Organization menu' })).toBeNull();
    await act(() => router.navigate({ href: '/o/alice/other' }));
    await screen.findByText('Other content');
    expect(screen.getByRole('button', { name: 'Expand menu' })).toBeInTheDocument();
  });
});

describe('ShellHost: the drawer', () => {
  async function openDrawer() {
    act(() => setViewportWidth(390));
    const rendered = await renderRoute('/o/alice/other', org());
    await rendered.user.click(await screen.findByRole('button', { name: 'Open menu' }));
    await screen.findByRole('dialog', { name: 'Main menu' });
    return rendered;
  }

  it('picking an item navigates, closes the drawer and focuses main', async () => {
    const { user, router } = await openDrawer();
    const dialog = screen.getByRole('dialog', { name: 'Main menu' });
    await user.click(await within(dialog).findByRole('link', { name: 'Projects' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/alice/projects'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('main')));
  });

  it('the close button closes it without navigating and focus returns to Open menu', async () => {
    const { user, router } = await openDrawer();
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/o/alice/other');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open menu' }));
  });

  it('Escape closes it without navigating', async () => {
    const { user, router } = await openDrawer();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/o/alice/other');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open menu' }));
  });

  it('the scrim closes it without navigating', async () => {
    const { user, router } = await openDrawer();
    await user.click(screen.getByTestId('drawer-scrim'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/o/alice/other');
  });

  it('widening the window to 1024 closes it', async () => {
    await openDrawer();
    act(() => setViewportWidth(1024));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByTestId('drawer-scrim')).toBeNull();
  });

  it('Review Focus 2: history back closes it and removes the scrim', async () => {
    const { router, user } = await renderRoute('/o/alice/projects', { ...org() });
    await act(() => router.navigate({ href: '/o/alice/second' }));
    await screen.findByText('Second content');
    act(() => setViewportWidth(390));
    await user.click(await screen.findByRole('button', { name: 'Open menu' }));
    await screen.findByTestId('drawer-scrim');
    await act(async () => router.history.back());
    await waitFor(() => expect(screen.queryByTestId('drawer-scrim')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/o/alice/projects');
  });
});
