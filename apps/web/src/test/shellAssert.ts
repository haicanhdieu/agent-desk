import { screen, within } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * The shell-owned contract of a screen (plan "Pattern for screen tasks"): rendered in a shell frame it adds no second
 * banner or navigation, has one `main`, and has the expected h1 (or none when `h1` is null).
 */
export function expectShellOwnedPage(
  h1: string | null,
  { menu = 'Organization menu', pageHeader = true }: { menu?: string; pageHeader?: boolean } = {},
): HTMLElement {
  // A `header` inside `main` is the page header, not a banner landmark, whatever jsdom's role mapping says.
  expect(screen.getAllByRole('banner').filter((b) => !b.closest('main'))).toHaveLength(1);
  expect(screen.getAllByRole('navigation', { name: menu })).toHaveLength(1);
  const main = screen.getByRole('main');
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(within(main).queryByRole('navigation', { name: menu })).toBeNull();
  const headings = screen.queryAllByRole('heading', { level: 1 });
  if (h1 === null) expect(headings).toHaveLength(0);
  else {
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(h1);
    // The title sits in the shared page header (a notice page, such as no access, centres its own title instead).
    if (pageHeader) expect(headings[0]!.closest('header')).not.toBeNull();
  }
  return main;
}

/** The page header's actions container inside `main`. */
export function headerActions(main: HTMLElement): HTMLElement {
  const actions = main.querySelector<HTMLElement>('[data-page-header-actions]');
  if (!actions) throw new Error('no page header actions');
  return actions;
}
