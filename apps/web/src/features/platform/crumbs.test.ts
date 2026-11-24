import { platformCrumbs } from './crumbs';

const ready = { state: 'ready', id: 'abc', name: 'Harbor Labs' } as const;
const ORGS = { label: 'Organizations', href: '/platform/orgs' };

describe('platformCrumbs', () => {
  it('the org list reads Organizations', () => {
    expect(platformCrumbs('/platform/orgs', { state: 'none' })).toEqual({
      crumbs: [{ label: 'Organizations' }],
      tab: 'orgs',
    });
  });

  it('an org page reads Organizations / <org name>', () => {
    expect(platformCrumbs('/platform/orgs/abc', ready)).toEqual({
      crumbs: [ORGS, { label: 'Harbor Labs' }],
      tab: 'orgs',
    });
  });

  it('an org section reads Organizations / <org> / Members with the org linked', () => {
    expect(platformCrumbs('/platform/orgs/abc/members', ready).crumbs).toEqual([
      ORGS,
      { label: 'Harbor Labs', href: '/platform/orgs/abc' },
      { label: 'Members' },
    ]);
  });

  it('while the org loads the middle crumb is a skeleton', () => {
    expect(platformCrumbs('/platform/orgs/abc', { state: 'loading' }).crumbs).toEqual([
      ORGS,
      { label: '', loading: true, what: 'organization' },
    ]);
  });

  it('an org that failed to load reads "Organization"', () => {
    expect(platformCrumbs('/platform/orgs/abc', { state: 'error', id: 'abc' }).crumbs).toEqual([
      ORGS,
      { label: 'Organization' },
    ]);
  });

  it('an unknown org reads Organizations / Not found with the not-found state', () => {
    expect(platformCrumbs('/platform/orgs/zzz', { state: 'notFound' })).toEqual({
      crumbs: [ORGS, { label: 'Not found' }],
      state: 'notFound',
      tab: 'orgs',
    });
  });

  it('platform admins and the audit log have their own tab', () => {
    expect(platformCrumbs('/platform/admins', { state: 'none' })).toEqual({
      crumbs: [{ label: 'Platform admins' }],
      tab: 'admins',
    });
    expect(platformCrumbs('/platform/audit', { state: 'none' })).toEqual({
      crumbs: [{ label: 'Audit log' }],
      tab: 'audit',
    });
  });

  it('the create page reads Organizations / Create organization', () => {
    expect(platformCrumbs('/platform/orgs/new', { state: 'none' })).toEqual({
      crumbs: [ORGS, { label: 'Create organization' }],
      tab: 'orgs',
    });
  });
});
