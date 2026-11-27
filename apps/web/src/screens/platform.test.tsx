import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  activeOrgOverview,
  assignmentProjects,
  assignmentRoles,
  pagedPlatformMemberRows,
  pagedPlatformProjectRows,
  orgInvitationRows,
  pagedInvitationRows,
  platformMemberRows,
  platformProjectRows,
  editOrgDirtyValues,
  editOrgValues,
  pagedPlatformAuditRows,
  pagedPlatformOrgRows,
  platformAuditActions,
  platformAuditRows,
  platformAdminRows,
  platformOrgRows,
  suspendedOrgOverview,
  type PlatformOrgOverviewView,
} from '@/mocks';
import { PlatformAudit, type PlatformAuditProps } from './PlatformAudit';
import { PlatformAdmins, type PlatformAdminsProps } from './PlatformAdmins';
import { PlatformOrgDetail, type PlatformOrgDetailView } from './PlatformOrgDetail';
import { PlatformOrgInvitations, type PlatformOrgInvitationsProps } from './PlatformOrgInvitations';
import { PlatformOrgMembers, type PlatformOrgMembersProps } from './PlatformOrgMembers';
import { PlatformOrgProjects } from './PlatformOrgProjects';
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

const header = {
  name: 'Acme',
  slug: 'acme',
  status: 'active' as const,
  auditHref: '/platform/audit?org=acme',
  onSuspend: vi.fn(),
  onReactivate: vi.fn(),
};
const ready = (suspended = false, overview?: PlatformOrgOverviewView): PlatformOrgDetailView => ({
  kind: 'ready',
  header: { ...header, status: suspended ? 'suspended' : 'active' },
  overview: overview ?? (suspended ? suspendedOrgOverview : activeOrgOverview),
});

describe('PlatformOrgDetail', () => {
  it('Overview shows the seven facts and no banner for an active org', () => {
    render(<PlatformOrgDetail view={ready()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Overview' })).toBeInTheDocument();
    const terms = screen.getAllByRole('term').map((t) => t.textContent);
    expect(terms).toEqual(['Slug', 'Owner', 'Members', 'Projects', 'Last activity', 'Created', 'Status']);
    expect(screen.queryByText('This organization is suspended')).not.toBeInTheDocument();
  });

  it('children render below the header and the suspended banner, in place of the built-in Overview', () => {
    render(
      <PlatformOrgDetail view={ready(true)}>
        <p>child page</p>
      </PlatformOrgDetail>,
    );
    const child = screen.getByText('child page');
    const banner = screen.getByText('This organization is suspended');
    expect(banner.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Acme' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Overview' })).not.toBeInTheDocument();
  });

  it('children are not rendered while loading', () => {
    render(
      <PlatformOrgDetail view={{ kind: 'loading' }}>
        <p>child page</p>
      </PlatformOrgDetail>,
    );
    expect(screen.queryByText('child page')).not.toBeInTheDocument();
  });

  it('header shows the edit slot when given, and Suspend comes before View audit log in the More actions menu', async () => {
    render(<PlatformOrgDetail view={ready()} editSlot={<span>edit slot</span>} />);
    expect(screen.getByText('edit slot')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const names = [
      screen.getByRole('menuitem', { name: 'Suspend organization' }),
      screen.getByRole('menuitem', { name: 'View audit log' }),
    ];
    expect(names[0].compareDocumentPosition(names[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  const editDialog = {
    open: true,
    values: editOrgValues,
    errors: {},
    dirty: false,
    saving: false,
    onChange: noop,
    onSubmit: noop,
    onClose: noop,
  };
  const slugConfirm = {
    from: 'acme',
    to: 'acme-robotics',
    closing: 'Share the new link.',
    onConfirm: noop,
    onCancel: noop,
  };

  it('editDialog opens the Edit organization dialog with the header and Overview behind it', () => {
    render(<PlatformOrgDetail view={ready()} editDialog={editDialog} />);
    expect(screen.getByRole('dialog', { name: 'Edit organization' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Acme', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Overview', hidden: true })).toBeInTheDocument();
  });

  it('slugConfirm replaces the edit dialog: only one modal at a time', () => {
    render(
      <PlatformOrgDetail
        view={ready()}
        editDialog={{ ...editDialog, values: editOrgDirtyValues, dirty: true }}
        slugConfirm={slugConfirm}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Change the organization URL?' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Edit organization' })).not.toBeInTheDocument();
  });

  it('suspended: warning banner with the date, actor and reason', async () => {
    render(<PlatformOrgDetail view={ready(true)} />);
    expect(screen.getByText('This organization is suspended')).toBeInTheDocument();
    expect(
      screen.getByText('Since 21 Nov 2026 by Sam Rivera. People cannot open it and no new runs start.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Reason: Billing hold')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Reactivate organization' })).toBeInTheDocument();
  });

  it('a reason with markup renders as text', () => {
    const overview = {
      ...suspendedOrgOverview,
      suspension: { since: '21 Nov 2026', by: 'Sam Rivera', reason: '<img src=x onerror=alert(1)>' },
    };
    const { container } = render(<PlatformOrgDetail view={ready(true, overview)} />);
    expect(screen.getByText('Reason: <img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('suspended with no known actor still reads', () => {
    const overview = { ...suspendedOrgOverview, suspension: { since: '21 Nov 2026', by: null, reason: 'x' } };
    render(<PlatformOrgDetail view={ready(true, overview)} />);
    expect(screen.getByText('Since 21 Nov 2026. People cannot open it and no new runs start.')).toBeInTheDocument();
  });

  it('shows the suspend dialog when given', () => {
    render(
      <PlatformOrgDetail
        view={ready()}
        dialog={{
          mode: 'suspend',
          orgName: 'Acme',
          open: true,
          reason: '',
          saving: false,
          onReason: vi.fn(),
          onSubmit: vi.fn(),
          onClose: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Suspend Acme?' })).toBeInTheDocument();
  });

  it('shows the reactivate dialog when given', () => {
    render(
      <PlatformOrgDetail
        view={ready(true)}
        dialog={{
          mode: 'reactivate',
          orgName: 'Acme',
          open: true,
          reason: '',
          saving: false,
          onReason: vi.fn(),
          onSubmit: vi.fn(),
          onClose: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Reactivate Acme?' })).toBeInTheDocument();
    expect(screen.getByText('People can open it again.')).toBeInTheDocument();
  });

  it('not found: Page not found with a way back', () => {
    render(<PlatformOrgDetail view={{ kind: 'notFound', backHref: '/platform/orgs' }} />);
    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(screen.getByText('This organization does not exist.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to organizations' })).toHaveAttribute('href', '/platform/orgs');
  });

  it('loading is a busy status', () => {
    render(<PlatformOrgDetail view={{ kind: 'loading' }} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
  });

  it('error shows the title and request id, and Retry calls onRetry', async () => {
    const onRetry = vi.fn();
    render(
      <PlatformOrgDetail
        view={{ kind: 'error', title: 'Internal server error', requestId: 'req_01JDP4A7K2QX', onRetry }}
      />,
    );
    expect(screen.getByText('Request ID: req_01JDP4A7K2QX')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

const auditProps = (over: Partial<PlatformAuditProps> = {}): PlatformAuditProps => ({
  view: { kind: 'ready', rows: platformAuditRows, pagination },
  action: 'all',
  actions: platformAuditActions,
  onAction: vi.fn(),
  filtered: false,
  onClearFilters: vi.fn(),
  ...over,
});

describe('PlatformAudit', () => {
  it('ready: h1 "Audit log", the columns When, Who, What and one row per entry', () => {
    render(<PlatformAudit {...auditProps()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Audit log' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['When', 'Who', 'What']);
    expect(screen.getAllByRole('row')).toHaveLength(platformAuditRows.length + 1);
  });

  it('shows the reason as a note under suspend and reactivate rows', () => {
    render(<PlatformAudit {...auditProps()} />);
    expect(screen.getAllByText(/^Reason: /).length).toBeGreaterThan(0);
  });

  it('Action select starts at "All actions" and reports the chosen action', async () => {
    const onAction = vi.fn();
    render(<PlatformAudit {...auditProps({ onAction })} />);
    const select = screen.getByRole('combobox', { name: 'Action' });
    expect(select).toHaveValue('all');
    expect(within(select).getByRole('option', { name: 'All actions' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'Organization suspended');
    expect(onAction).toHaveBeenCalledWith('org.suspended');
  });

  it('shows the org chip with a remove button named after it', async () => {
    const onRemove = vi.fn();
    render(<PlatformAudit {...auditProps({ orgChip: { label: 'Organization: Bluefin Health', onRemove } })} />);
    expect(screen.getByText('Organization: Bluefin Health')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Organization: Bluefin Health' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('has no chip without an org filter', () => {
    render(<PlatformAudit {...auditProps()} />);
    expect(screen.queryByRole('button', { name: /^Remove filter/ })).not.toBeInTheDocument();
  });

  it('empty: "No audit entries"', () => {
    render(<PlatformAudit {...auditProps({ view: { kind: 'ready', rows: [], pagination } })} />);
    expect(screen.getByRole('heading', { level: 2, name: 'No audit entries' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('empty with filters: "No audit entries match" and Clear filters', async () => {
    const onClearFilters = vi.fn();
    render(
      <PlatformAudit
        {...auditProps({ view: { kind: 'ready', rows: [], pagination }, filtered: true, onClearFilters })}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No audit entries match' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('paged: shows the range of the second page', () => {
    render(
      <PlatformAudit
        {...auditProps({
          view: {
            kind: 'ready',
            rows: pagedPlatformAuditRows.slice(20),
            pagination: { ...pagination, page: 2, total: 25 },
          },
        })}
      />,
    );
    expect(screen.getByText('21–25')).toBeInTheDocument();
  });

  it('loading is a busy status', () => {
    render(<PlatformAudit {...auditProps({ view: { kind: 'loading' } })} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
  });

  it('error shows the request id and Retry calls onRetry', async () => {
    const onRetry = vi.fn();
    render(
      <PlatformAudit
        {...auditProps({
          view: { kind: 'error', title: 'Internal server error', requestId: 'req_01JDP4A7K2QX', onRetry },
        })}
      />,
    );
    expect(screen.getByText('Request ID: req_01JDP4A7K2QX')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

const tabPagination = { ...pagination, total: 3 };

describe('PlatformOrgProjects', () => {
  it('ready: section heading "Projects" and the Name and Id columns', () => {
    render(<PlatformOrgProjects view={{ kind: 'ready', rows: platformProjectRows, pagination: tabPagination }} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Projects' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Id']);
    expect(screen.getByText('Billing jobs')).toBeInTheDocument();
  });

  it('empty rows show "No projects" and no table', () => {
    render(<PlatformOrgProjects view={{ kind: 'ready', rows: [], pagination: { ...tabPagination, total: 0 } }} />);
    expect(screen.getByRole('heading', { name: 'No projects' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('paged: the second page shows its range', () => {
    render(
      <PlatformOrgProjects
        view={{
          kind: 'ready',
          rows: pagedPlatformProjectRows.slice(20),
          pagination: { ...tabPagination, page: 2, total: 25 },
        }}
      />,
    );
    expect(screen.getByText('21–25')).toBeInTheDocument();
  });

  it('loading is a busy status', () => {
    render(<PlatformOrgProjects view={{ kind: 'loading' }} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
  });

  it('error shows the request id and Retry calls onRetry', async () => {
    const onRetry = vi.fn();
    render(
      <PlatformOrgProjects
        view={{ kind: 'error', title: 'Internal server error', requestId: 'req_01JDP4A7K2QX', onRetry }}
      />,
    );
    expect(screen.getByText('Request ID: req_01JDP4A7K2QX')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

const membersProps = (over: Partial<PlatformOrgMembersProps> = {}): PlatformOrgMembersProps => ({
  view: { kind: 'ready', rows: platformMemberRows, pagination: { ...tabPagination, total: 4 } },
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  ...over,
});

describe('PlatformOrgMembers', () => {
  it('ready: section heading "Members", the platform-view note and the four columns', () => {
    render(<PlatformOrgMembers {...membersProps()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Members' })).toBeInTheDocument();
    expect(
      screen.getByText('Platform view: names and emails only. Tickets, runs and secrets are never shown here.'),
    ).toHaveClass('muted');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Name',
      'Email',
      'Roles',
      'Actions',
    ]);
  });

  it('empty rows show "No members" and keep the note', () => {
    render(
      <PlatformOrgMembers
        {...membersProps({ view: { kind: 'ready', rows: [], pagination: { ...tabPagination, total: 0 } } })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No members' })).toBeInTheDocument();
    expect(screen.getByText(/Platform view: names and emails only/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('loading is a busy status and error offers Retry', async () => {
    const { rerender } = render(<PlatformOrgMembers {...membersProps({ view: { kind: 'loading' } })} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    const onRetry = vi.fn();
    rerender(
      <PlatformOrgMembers {...membersProps({ view: { kind: 'error', title: 'Internal server error', onRetry } })} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('paged: the second page shows its range', () => {
    render(
      <PlatformOrgMembers
        {...membersProps({
          view: {
            kind: 'ready',
            rows: pagedPlatformMemberRows.slice(20),
            pagination: { ...tabPagination, page: 2, total: 25 },
          },
        })}
      />,
    );
    expect(screen.getByText('21–25')).toBeInTheDocument();
  });

  it('the row menu calls onAdd and onRemove with the row and the assignment', async () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(<PlatformOrgMembers {...membersProps({ onAdd, onRemove })} />);
    const cleo = platformMemberRows[1]!;
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add assignment' }));
    expect(onAdd).toHaveBeenCalledWith(cleo);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Member (Alpha)' }));
    expect(onRemove).toHaveBeenCalledWith(cleo, cleo.assignments[1]);
  });

  it('busyUserId disables only that row menu', () => {
    render(<PlatformOrgMembers {...membersProps({ busyUserId: platformMemberRows[0]!.userId })} />);
    expect(screen.getByRole('button', { name: 'Actions for Lee Park' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Actions for Cleo Martin' })).toBeEnabled();
  });

  it('remove confirm reads "Remove <role> from <name>?" with Cancel and Remove', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <PlatformOrgMembers
        {...membersProps({
          removeConfirm: { roleLabel: 'Owner', personName: 'Lee Park', busy: false, onConfirm, onCancel },
        })}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Remove Owner from Lee Park?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('remove confirm busy shows "Removing…", disables both buttons and cannot be closed', async () => {
    const onCancel = vi.fn();
    render(
      <PlatformOrgMembers
        {...membersProps({
          removeConfirm: { roleLabel: 'Owner', personName: 'Lee Park', busy: true, onConfirm: vi.fn(), onCancel },
        })}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Remove Owner from Lee Park?' });
    expect(within(dialog).getByRole('button', { name: 'Removing…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows the assignment dialog when given', () => {
    render(
      <PlatformOrgMembers
        {...membersProps({
          assignmentDialog: {
            open: true,
            person: { name: 'Cleo Martin', handle: 'cleo' },
            roles: assignmentRoles,
            projects: assignmentProjects,
            values: { access: 'org', roleKey: '', projectId: '' },
            errors: {},
            saving: false,
            onChange: vi.fn(),
            onSubmit: vi.fn(),
            onClose: vi.fn(),
          },
        })}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Add assignment' })).toBeInTheDocument();
  });
});

const pendingInvites = orgInvitationRows.filter((r) => r.status === 'pending');
const invitationsProps = (over: Partial<PlatformOrgInvitationsProps> = {}): PlatformOrgInvitationsProps => ({
  view: { kind: 'ready', rows: pendingInvites, pagination: { ...tabPagination, total: pendingInvites.length } },
  status: 'pending',
  onStatus: vi.fn(),
  onInvite: vi.fn(),
  rowActions: () => ({ onCopy: vi.fn(), onResend: vi.fn(), onRevoke: vi.fn() }),
  ...over,
});

describe('PlatformOrgInvitations', () => {
  it('ready: heading, Invite people, the platform note and the seven columns', () => {
    render(<PlatformOrgInvitations {...invitationsProps()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Invitations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite people' })).toBeInTheDocument();
    expect(
      screen.getByText('Platform view: names and emails only. Tickets, runs and secrets are never shown here.'),
    ).toHaveClass('muted');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Email',
      'Role',
      'Access',
      'Status',
      'Expires',
      'Invited by',
      'Actions',
    ]);
  });

  it('Invite people calls onInvite', async () => {
    const onInvite = vi.fn();
    render(<PlatformOrgInvitations {...invitationsProps({ onInvite })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Invite people' }));
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it('status filter: Pending is on, the six chips read in order and a pick calls onStatus', async () => {
    const onStatus = vi.fn();
    render(<PlatformOrgInvitations {...invitationsProps({ onStatus })} />);
    const group = screen.getByRole('group', { name: 'Filter by status' });
    const chips = within(group).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['Pending', 'Accepted', 'Declined', 'Revoked', 'Expired', 'All']);
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
    await userEvent.click(within(group).getByRole('button', { name: 'Revoked' }));
    expect(onStatus).toHaveBeenCalledWith('revoked');
  });

  it('empty rows show "No invitations" with Invite people and keep the note', async () => {
    const onInvite = vi.fn();
    render(
      <PlatformOrgInvitations
        {...invitationsProps({
          onInvite,
          view: { kind: 'ready', rows: [], pagination: { ...tabPagination, total: 0 } },
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No invitations' })).toBeInTheDocument();
    expect(screen.getByText(/Platform view: names and emails only/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Invite people' });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[1]!);
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it('loading is a busy status and error offers Retry', async () => {
    const { rerender } = render(<PlatformOrgInvitations {...invitationsProps({ view: { kind: 'loading' } })} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    const onRetry = vi.fn();
    rerender(
      <PlatformOrgInvitations
        {...invitationsProps({ view: { kind: 'error', title: 'Internal server error', onRetry } })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('paged: the second page shows its range', () => {
    render(
      <PlatformOrgInvitations
        {...invitationsProps({
          view: {
            kind: 'ready',
            rows: pagedInvitationRows(2),
            pagination: { ...tabPagination, page: 2, total: 22 },
          },
        })}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('21–22');
  });

  it('resending disables only that row menu', () => {
    render(<PlatformOrgInvitations {...invitationsProps({ resendingId: pendingInvites[0]!.id })} />);
    expect(screen.getByRole('button', { name: `Actions for ${pendingInvites[0]!.email}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Actions for ${pendingInvites[1]!.email}` })).toBeEnabled();
  });

  it('row menu runs the handlers of rowActions for that row', async () => {
    const onResend = vi.fn();
    const rowActions = vi.fn(() => ({ onCopy: vi.fn(), onResend, onRevoke: vi.fn() }));
    render(<PlatformOrgInvitations {...invitationsProps({ rowActions })} />);
    await userEvent.click(screen.getByRole('button', { name: `Actions for ${pendingInvites[0]!.email}` }));
    await userEvent.click(screen.getByRole('button', { name: 'Resend' }));
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(rowActions).toHaveBeenCalledWith(pendingInvites[0]);
  });

  it('shows the invite and link dialogs when given', () => {
    render(
      <PlatformOrgInvitations
        {...invitationsProps({
          inviteDialog: <div role="dialog" aria-label="Invite people" />,
          linkDialog: <div role="dialog" aria-label="Invitation link" />,
        })}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Invite people' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Invitation link' })).toBeInTheDocument();
  });

  it('copy failed shows the by-hand message as an alert', () => {
    render(<PlatformOrgInvitations {...invitationsProps({ copyFailed: true })} />);
    expect(screen.getByText('Could not copy. Select the link and copy it.')).toBeInTheDocument();
  });
});
