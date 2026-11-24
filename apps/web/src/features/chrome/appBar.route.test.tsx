import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// Kept apart from appBar.test.tsx: that file replaces the API and auth clients, this one runs the real routes on MSW.
describe('app bar on the suspended page (BR-51)', () => {
  it('a platform admin of a suspended org still gets the Platform admin entry; /platform/orgs opens', async () => {
    const { user, router } = await renderRoute('/o/alice/projects', {
      scenario: () => scenarios.platform('suspendedPlatformAdmin'),
    });
    await screen.findByRole('heading', { name: 'This organization is suspended' });
    await user.click(await screen.findByRole('button', { name: /^Switch scope/ }));
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    expect(within(menu).getByRole('link', { name: 'Platform admin' })).toHaveAttribute('href', '/platform');
    await act(() => router.navigate({ to: '/platform/orgs' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Organizations' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/platform/orgs');
  });
});
