import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { pagedPlatformOrgRows, platformAdminRows, platformOrgRows } from '@/mocks';
import { PlatformAdmins, type PlatformAdminsProps } from './PlatformAdmins';
import { PlatformOrgs, type PlatformOrgsProps } from './PlatformOrgs';

const noop = () => {};
const pagination = { page: 1, pageSize: 20 as const, total: 3, onPageChange: noop, onPageSizeChange: noop };

const props = (over: Partial<PlatformAdminsProps> = {}): PlatformAdminsProps => ({
  view: { kind: 'ready', rows: platformAdminRows, pagination },
  onAdd: vi.fn(),
  onRevoke: vi.fn(),
  ...over,
});

describe('PlatformAdmins', () => {
  it('ready: h1 "Platform admins" is focusable and the six columns show', () => {
    render(<PlatformAdmins {...props()} />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Platform admins' });
    expect(h1).toHaveAttribute('tabindex', '-1');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Name',
      'Email',
      'Handle',
      'Added',
      'Added by',
      'Actions',
    ]);
    expect(screen.getAllByRole('row')).toHaveLength(platformAdminRows.length + 1);
  });

  it('Add platform admin calls onAdd', async () => {
    const onAdd = vi.fn();
    render(<PlatformAdmins {...props({ onAdd })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add platform admin' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('Revoke on a row calls onRevoke with that row', async () => {
    const onRevoke = vi.fn();
    render(<PlatformAdmins {...props({ onRevoke })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke platform access for grace@example.com' }));
    expect(onRevoke).toHaveBeenCalledWith(platformAdminRows[1]);
  });

  it('no rows shows "No platform admins"', () => {
    render(<PlatformAdmins {...props({ view: { kind: 'ready', rows: [], pagination } })} />);
    expect(screen.getByText('No platform admins')).toBeInTheDocument();
  });

  it('busyId disables Revoke on that row only', () => {
    render(
      <PlatformAdmins
        {...props({ view: { kind: 'ready', rows: platformAdminRows, pagination, busyId: platformAdminRows[1].id } })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Revoke platform access for grace@example.com' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revoke platform access for new.hire@example.com' })).toBeEnabled();
  });

  it('pagination shows with rows and is absent when there are none', () => {
    const paged = { ...pagination, total: 25 };
    const { rerender } = render(
      <PlatformAdmins {...props({ view: { kind: 'ready', rows: platformAdminRows, pagination: paged } })} />,
    );
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    rerender(<PlatformAdmins {...props({ view: { kind: 'ready', rows: [], pagination: paged } })} />);
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('loading is a busy status with no heading', () => {
    render(<PlatformAdmins {...props({ view: { kind: 'loading' } })} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('error shows the title and request id, and Retry calls onRetry', async () => {
    const onRetry = vi.fn();
    render(
      <PlatformAdmins
        {...props({ view: { kind: 'error', title: 'Internal server error', requestId: 'req_01JDP4A7K2QX', onRetry } })}
      />,
    );
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText('Request ID: req_01JDP4A7K2QX')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('forbidden shows the no-access notice and a link to projects', () => {
    render(<PlatformAdmins {...props({ view: { kind: 'forbidden' } })} />);
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access" })).toBeInTheDocument();
    expect(screen.getByText('This area is for platform admins.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to projects' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('revoke confirm names the person, by name or else by email', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const named = platformAdminRows[1];
    const { rerender } = render(
      <PlatformAdmins {...props({ revokeConfirm: { row: named, own: false, busy: false, onConfirm, onCancel } })} />,
    );
    expect(screen.getByRole('dialog', { name: 'Revoke platform access for Grace Hopper?' })).toBeInTheDocument();
    expect(screen.getByText('They can no longer open the platform admin area.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(
      <PlatformAdmins
        {...props({ revokeConfirm: { row: platformAdminRows[2], own: false, busy: false, onConfirm, onCancel } })}
      />,
    );
    expect(
      screen.getByRole('dialog', { name: 'Revoke platform access for new.hire@example.com?' }),
    ).toBeInTheDocument();
  });

  it('revoking your own access warns you go to the home page', () => {
    render(
      <PlatformAdmins
        {...props({
          revokeConfirm: { row: platformAdminRows[0], own: true, busy: false, onConfirm: vi.fn(), onCancel: vi.fn() },
        })}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Revoke your own platform access?' })).toBeInTheDocument();
    expect(screen.getByText('You lose access right away and go to the home page.')).toBeInTheDocument();
  });

  it('busy shows "Revoking…" and cannot be cancelled or closed', async () => {
    const onCancel = vi.fn();
    render(
      <PlatformAdmins
        {...props({
          revokeConfirm: { row: platformAdminRows[1], own: false, busy: true, onConfirm: vi.fn(), onCancel },
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Revoking…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('the add dialog renders over the page when given', () => {
    render(
      <PlatformAdmins
        {...props({
          addDialog: {
            open: true,
            values: { email: '' },
            errors: {},
            saving: false,
            onChange: vi.fn(),
            onSubmit: vi.fn(),
            onClose: vi.fn(),
          },
        })}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Add platform admin' })).toBeInTheDocument();
  });
});

const orgFilters = { q: '', status: 'all' as const, active: false };
const orgProps = (over: Partial<PlatformOrgsProps> = {}): PlatformOrgsProps => ({
  view: { kind: 'ready', rows: platformOrgRows, pagination: { ...pagination, total: platformOrgRows.length } },
  filters: orgFilters,
  onSearch: vi.fn(),
  onStatus: vi.fn(),
  onClearFilters: vi.fn(),
  createHref: '/orgs/new',
  ...over,
});

describe('PlatformOrgs', () => {
  it('ready: h1 "Organizations", the seven columns and one row per org', () => {
    render(<PlatformOrgs {...orgProps()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Organizations' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Organization',
      'Owner',
      'Members',
      'Projects',
      'Last activity',
      'Status',
      'Created',
    ]);
    expect(screen.getAllByRole('row')).toHaveLength(platformOrgRows.length + 1);
  });

  it('"Create organization" links to createHref', () => {
    render(<PlatformOrgs {...orgProps({ createHref: '/orgs/new' })} />);
    expect(screen.getByRole('link', { name: 'Create organization' })).toHaveAttribute('href', '/orgs/new');
  });

  it('search is labelled, capped at 100 characters and reports typing', async () => {
    const onSearch = vi.fn();
    render(<PlatformOrgs {...orgProps({ onSearch })} />);
    const search = screen.getByRole('searchbox', { name: 'Search organizations' });
    expect(search).toHaveAttribute('maxlength', '100');
    await userEvent.type(search, 'a');
    expect(onSearch).toHaveBeenLastCalledWith('a');
  });

  it('the search box shows the filter q and follows it when it is cleared', () => {
    const { rerender } = render(
      <PlatformOrgs {...orgProps({ filters: { q: 'acme', status: 'all', active: true } })} />,
    );
    expect(screen.getByRole('searchbox', { name: 'Search organizations' })).toHaveValue('acme');
    rerender(<PlatformOrgs {...orgProps({ filters: orgFilters })} />);
    expect(screen.getByRole('searchbox', { name: 'Search organizations' })).toHaveValue('');
  });

  it('status select offers All statuses, Active and Suspended and reports the choice', async () => {
    const onStatus = vi.fn();
    render(<PlatformOrgs {...orgProps({ onStatus })} />);
    const select = screen.getByRole('combobox', { name: 'Status' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All statuses', 'Active', 'Suspended']);
    await userEvent.selectOptions(select, 'Suspended');
    expect(onStatus).toHaveBeenCalledWith('suspended');
  });

  it('empty and unfiltered: "No organizations yet" with no filters or table', () => {
    render(
      <PlatformOrgs {...orgProps({ view: { kind: 'ready', rows: [], pagination: { ...pagination, total: 0 } } })} />,
    );
    expect(screen.getByText('No organizations yet')).toBeInTheDocument();
    expect(screen.getByText('Create one to invite its first owner.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('empty and filtered: "No organizations match" and Clear filters calls onClearFilters', async () => {
    const onClearFilters = vi.fn();
    render(
      <PlatformOrgs
        {...orgProps({
          view: { kind: 'ready', rows: [], pagination: { ...pagination, total: 0 } },
          filters: { q: 'zephyr', status: 'suspended', active: true },
          onClearFilters,
        })}
      />,
    );
    expect(screen.getByText('No organizations match')).toBeInTheDocument();
    expect(screen.queryByText('No organizations yet')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('the table scrolls sideways inside main', () => {
    render(<PlatformOrgs {...orgProps()} />);
    const region = screen.getByRole('region', { name: 'Organizations table' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('main')).toContainElement(region);
    expect(region).toContainElement(screen.getByRole('table'));
  });

  it('pagination shows with rows', () => {
    render(
      <PlatformOrgs
        {...orgProps({
          view: { kind: 'ready', rows: pagedPlatformOrgRows.slice(20), pagination: { ...pagination, total: 25 } },
        })}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });

  it('loading is a busy status with no table', () => {
    render(<PlatformOrgs {...orgProps({ view: { kind: 'loading' } })} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('error shows the title and request id, and Retry calls onRetry', async () => {
    const onRetry = vi.fn();
    render(
      <PlatformOrgs
        {...orgProps({
          view: { kind: 'error', title: 'Internal server error', requestId: 'req_01JDP4A7K2QX', onRetry },
        })}
      />,
    );
    expect(screen.getByText('Request ID: req_01JDP4A7K2QX')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
