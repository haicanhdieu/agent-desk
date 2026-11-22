import { createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { createTestRootRoute, renderRoute } from '@/test/renderRoute';
import { api } from '../api';
import { safeRedirect } from './redirect';
import { sessionQuery } from './session';

const setActiveCalls = () => mockDb.requests('POST', '/auth/organization/set-active');

describe('root session guard', () => {
  it('sends a signed-out visitor to sign-in with the current path as redirect', async () => {
    const { router } = await renderRoute('/o/alice/projects', { scenario: scenarios.signedOut });
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(router.state.location.href).toBe('/sign-in?redirect=%2Fo%2Falice%2Fprojects');
    expect(await screen.findByRole('link', { name: 'Sign in with GitHub' })).toBeInTheDocument();
  });

  it('BR-24 sends a signed-out visitor at an invitation link to sign-in with the link as a safe redirect', async () => {
    const link = `/invitations/${ids.created(7)}`;
    const { router } = await renderRoute(link, { scenario: scenarios.signedOut });
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(router.state.location.href).toBe(`/sign-in?redirect=${encodeURIComponent(link)}`);
    expect(safeRedirect(link)).toBe(link);
    expect(router.state.matches.at(-1)?.search).toEqual(expect.objectContaining({ redirect: link }));
  });

  it('sends a signed-in user at / to the active org projects', async () => {
    const { router } = await renderRoute('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/alice/projects'));
  });

  it('follows the session active org at /', async () => {
    mockDb.setActiveOrg(ids.org.acme);
    const { router } = await renderRoute('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/projects'));
  });

  // The global top bar (projects list, setup) links the logo to `/projects`, which has no org in it.
  it('sends a signed-in user at /projects to the active org projects', async () => {
    mockDb.setActiveOrg(ids.org.acme);
    const { router } = await renderRoute('/projects');
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/projects'));
  });
});

describe('landing with no organization', () => {
  it.each(['/', '/projects'])('sends a signed-in user with no org from %s to /invitations', async (path) => {
    const { router } = await renderRoute(path, { scenario: () => scenarios.onboarding('noOrgUninvited') });
    await waitFor(() => expect(router.state.location.pathname).toBe('/invitations'));
  });

  it('sends a platform admin with no org to /invitations, the welcome page', async () => {
    const { router } = await renderRoute('/', { scenario: () => scenarios.onboarding('platformAdminNoOrg') });
    await waitFor(() => expect(router.state.location.pathname).toBe('/invitations'));
  });
});

describe('org layout', () => {
  it.each(['/o/stranger/projects', '/o/stranger'])(
    'shows not found for an org the user is not in (%s) and never calls set-active',
    async (path) => {
      const { router } = await renderRoute(path);
      expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
      // No redirect happened: the org layout rejected the slug before any child route ran.
      expect(router.state.location.pathname).toBe(path);
      expect(setActiveCalls()).toBe(0);
    },
  );

  it('does not call set-active for the org that is already active', async () => {
    const { router } = await renderRoute('/o/alice');
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/alice/projects'));
    expect(setActiveCalls()).toBe(0);
  });

  it('switches the active org once for another org and drops the old org cache', async () => {
    const { router, queryClient } = await renderRoute('/o/alice');
    queryClient.setQueryData(['org', 'alice', 'projects'], ['cached']);

    await router.navigate({ to: '/o/$org', params: { org: 'acme' } });
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/projects'));

    expect(setActiveCalls()).toBe(1);
    expect(mockDb.auth.activeOrganizationId).toBe(ids.org.acme);
    expect(queryClient.getQueryData(['org', 'alice', 'projects'])).toBeUndefined();
    expect(queryClient.getQueryData(sessionQuery.queryKey)).toMatchObject({ activeOrganizationId: ids.org.acme });
  });
});

describe('401 sign-out path', () => {
  it('signs out once and navigates once when several queries hit 401 together', async () => {
    const root = createTestRootRoute();
    const page = createRoute({
      getParentRoute: () => root,
      path: '/two',
      loader: ({ context: { queryClient } }) =>
        Promise.all([
          queryClient.ensureQueryData({ queryKey: ['org', 'alice', 'projects'], queryFn: () => api.projects.list() }),
          queryClient.ensureQueryData({ queryKey: ['org', 'alice', 'conns'], queryFn: () => api.connections.list() }),
        ]),
      component: () => <p>Loaded</p>,
    });
    // An expired session: every /api route answers 401.
    const { router } = await renderRoute('/', { routeTree: root.addChildren([page]), scenario: scenarios.signedOut });
    const navigate = vi.spyOn(router, 'navigate');

    await router.navigate({ href: '/two' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    await new Promise((r) => setTimeout(r, 50));

    expect(mockDb.requests('POST', '/auth/sign-out')).toBe(1);
    const toSignIn = navigate.mock.calls.filter(([opts]) => opts?.to === '/sign-in');
    expect(toSignIn).toHaveLength(1);
    expect(router.state.location.href).toBe('/sign-in?redirect=%2Ftwo');
  });
});

describe('sign-in', () => {
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/\t/evil.example'])(
    'drops the unsafe redirect %s',
    (value) => {
      expect(safeRedirect(value)).toBeUndefined();
    },
  );

  it('keeps relative paths with search', () => {
    expect(safeRedirect('/o/alice/projects?x=1')).toBe('/o/alice/projects?x=1');
  });

  it('ignores redirect=https://evil.example and signs in back to /', async () => {
    let callbackURL: unknown = 'unset';
    server.use(
      http.post('/auth/sign-in/social', async ({ request }) => {
        const body: unknown = await request.json();
        callbackURL = typeof body === 'object' && body !== null && 'callbackURL' in body ? body.callbackURL : undefined;
        return HttpResponse.json({ url: '/', redirect: false });
      }),
    );
    const { router, user } = await renderRoute('/sign-in?redirect=https%3A%2F%2Fevil.example', {
      scenario: scenarios.signedOut,
    });
    // The sign-in match's validated search drops it.
    expect(router.state.matches.at(-1)?.search).toEqual({ redirect: undefined });
    await user.click(await screen.findByRole('link', { name: 'Sign in with GitHub' }));
    await waitFor(() => expect(callbackURL).toBe('/'));
  });

  it('passes a relative redirect as the GitHub callback URL', async () => {
    let callbackURL: unknown = 'unset';
    server.use(
      http.post('/auth/sign-in/social', async ({ request }) => {
        const body: unknown = await request.json();
        callbackURL = typeof body === 'object' && body !== null && 'callbackURL' in body ? body.callbackURL : undefined;
        return HttpResponse.json({ url: '/', redirect: false });
      }),
    );
    const { user } = await renderRoute('/sign-in?redirect=%2Fo%2Facme%2Fprojects', { scenario: scenarios.signedOut });
    await user.click(await screen.findByRole('link', { name: 'Sign in with GitHub' }));
    await waitFor(() => expect(callbackURL).toBe('/o/acme/projects'));
  });

  it('shows a failed social sign-in instead of ignoring it', async () => {
    server.use(
      http.post('/auth/sign-in/social', () =>
        HttpResponse.json({ code: 'PROVIDER_ERROR', message: 'GitHub is unavailable' }, { status: 500 }),
      ),
    );
    const { router, user } = await renderRoute('/sign-in', { scenario: scenarios.signedOut });
    await user.click(await screen.findByRole('link', { name: 'Sign in with GitHub' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed');
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('BR-1 shows the no-invitation Banner for ?error=no_invitation and keeps the sign-in control', async () => {
    await renderRoute('/sign-in?error=no_invitation', { scenario: scenarios.signedOut });
    expect(await screen.findByText('No invitation found for your email')).toBeInTheDocument();
    expect(
      screen.getByText('Ask an owner or admin of your organization to invite you, then sign in again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in with GitHub' })).toBeInTheDocument();
    expect(screen.queryByText('Sign-in failed')).toBeNull();
  });

  it.each(['other', '<b>x</b>'])('shows "Sign-in failed" for ?error=%s and never renders the value', async (value) => {
    await renderRoute(`/sign-in?error=${encodeURIComponent(value)}`, { scenario: scenarios.signedOut });
    expect(await screen.findByText('Sign-in failed')).toBeInTheDocument();
    expect(screen.queryByText('No invitation found for your email')).toBeNull();
    expect(document.body.innerHTML).not.toContain('<b>x</b>');
    expect(screen.queryByText('x')).toBeNull();
    expect(screen.queryByText(value)).toBeNull();
  });

  it('shows no error without the error param', async () => {
    await renderRoute('/sign-in', { scenario: scenarios.signedOut });
    await screen.findByRole('link', { name: 'Sign in with GitHub' });
    expect(screen.queryByText('Sign-in failed')).toBeNull();
    expect(screen.queryByText('No invitation found for your email')).toBeNull();
  });

  it.each([
    ['/sign-in', '/sign-in'],
    ['/sign-in?redirect=%2Fo%2Facme%2Fprojects', '/sign-in?redirect=%2Fo%2Facme%2Fprojects'],
  ])('passes errorCallbackURL back to the sign-in page (%s)', async (path, expected) => {
    let errorCallbackURL: unknown = 'unset';
    server.use(
      http.post('/auth/sign-in/social', async ({ request }) => {
        const body: unknown = await request.json();
        errorCallbackURL =
          typeof body === 'object' && body !== null && 'errorCallbackURL' in body ? body.errorCallbackURL : undefined;
        return HttpResponse.json({ url: '/', redirect: false });
      }),
    );
    const { user } = await renderRoute(path, { scenario: scenarios.signedOut });
    await user.click(await screen.findByRole('link', { name: 'Sign in with GitHub' }));
    await waitFor(() => expect(errorCallbackURL).toBe(expected));
  });

  it('a signed-in user opening /sign-in goes to the landing org', async () => {
    const { router } = await renderRoute('/sign-in');
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/alice/projects'));
  });
});

describe('account menu Logout in the top bar', () => {
  it('the avatar opens an account menu whose Logout signs out, clears the cache and lands on /sign-in', async () => {
    const { router, queryClient, user } = await renderRoute('/o/alice/projects');
    await screen.findByText('invoicer-api');
    expect(queryClient.getQueryData(sessionQuery.queryKey)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^Account menu/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Account' })).getByRole('menuitem', { name: 'Logout' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(router.state.location.href).toBe('/sign-in');
    expect(mockDb.requests('POST', '/auth/sign-out')).toBe(1);
    expect(queryClient.getQueryData(sessionQuery.queryKey)).toBeFalsy();
  });
});
