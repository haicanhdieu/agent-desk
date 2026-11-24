import { describe, expect, it } from 'vitest';
import { NO_PAGE_CRUMBS, pageTitle } from './pageTitle';

describe('pageTitle', () => {
  it('joins the last crumb, the scope and the product', () => {
    expect(
      pageTitle({
        crumbs: [{ label: 'Organizations', href: '/x' }, { label: 'Harbor Labs', href: '/y' }, { label: 'Members' }],
        scope: 'Platform',
      }),
    ).toBe('Members · Platform · Agent Desk');
    expect(pageTitle({ crumbs: [{ label: 'Projects' }], scope: 'Harbor Labs' })).toBe(
      'Projects · Harbor Labs · Agent Desk',
    );
    expect(pageTitle({ crumbs: [{ label: 'Runs', href: '/r' }, { label: 'Run 62' }], scope: 'invoicer-api' })).toBe(
      'Run 62 · invoicer-api · Agent Desk',
    );
  });

  it('uses the previous label while the last crumb is loading', () => {
    expect(
      pageTitle({
        crumbs: [
          { label: 'Organizations', href: '/x' },
          { label: '', loading: true },
        ],
        scope: 'Platform',
      }),
    ).toBe('Organizations · Platform · Agent Desk');
  });

  it('titles the not-found and forbidden states', () => {
    expect(pageTitle({ crumbs: NO_PAGE_CRUMBS, state: 'notFound' })).toBe('Not found · Agent Desk');
    expect(pageTitle({ crumbs: NO_PAGE_CRUMBS, state: 'forbidden' })).toBe("You don't have access · Agent Desk");
  });

  it('is just the product with no crumbs and no scope', () => {
    expect(pageTitle({ crumbs: NO_PAGE_CRUMBS })).toBe('Agent Desk');
  });
});
