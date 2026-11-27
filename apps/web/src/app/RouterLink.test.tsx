import { createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppLink } from '@/ds';
import { createTestRootRoute, renderRoute } from '@/test/renderRoute';

function tree() {
  const root = createTestRootRoute();
  const parent = createRoute({ getParentRoute: () => root, path: '/a', component: () => <p>Parent page</p> });
  const child = createRoute({
    getParentRoute: () => root,
    path: '/a/b',
    component: () => (
      <>
        <AppLink href="/a" aria-current={undefined}>
          Parent link
        </AppLink>
        <AppLink href="/a/b" aria-current="page">
          Own link
        </AppLink>
        <AppLink href="/a">Plain parent link</AppLink>
      </>
    ),
  });
  return root.addChildren([parent, child]);
}

describe('RouterLink current marking', () => {
  it('an explicit aria-current wins over the router: a parent path is not current when the page says it is not', async () => {
    await renderRoute('/a/b', { routeTree: tree() });
    expect(await screen.findByRole('link', { name: 'Parent link' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Own link' })).toHaveAttribute('aria-current', 'page');
  });

  it('a link that says nothing about aria-current keeps the router active state', async () => {
    await renderRoute('/a/b', { routeTree: tree() });
    expect(await screen.findByRole('link', { name: 'Plain parent link' })).toHaveAttribute('aria-current', 'page');
  });
});
