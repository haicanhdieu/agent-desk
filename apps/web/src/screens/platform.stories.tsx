import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell, type EditOrgDialogProps, type SuspendOrgDialogProps } from '@/components';
import {
  activeOrgOverview,
  editOrgDirtyValues,
  editOrgFieldErrors,
  editOrgFormError,
  editOrgSlugTaken,
  editOrgValues,
  pagedPlatformAdminRows,
  pagedPlatformOrgRows,
  platformAdminRows,
  platformOrgRows,
  suspendedOrgOverview,
  type PlatformAdminRowView,
} from '@/mocks';
import { PlatformAdmins as PlatformAdminsScreen, type PlatformAdminsProps } from './PlatformAdmins';
import { PlatformOrgDetail as PlatformOrgDetailScreen, type PlatformOrgDetailProps } from './PlatformOrgDetail';
import { PlatformOrgs as PlatformOrgsScreen, type PlatformOrgsProps } from './PlatformOrgs';
import { PlatformFrame } from './platformFrame';
import { viewport } from './viewports';

const noop = () => undefined;

const meta = {
  title: 'Screens/Platform',
  parameters: { layout: 'fullscreen' },
  globals: viewport(1440, 900),
  decorators: [
    (S) => (
      <AppShell height={900} topBar={null}>
        <S />
      </AppShell>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const pagination = {
  page: 1,
  pageSize: 20 as const,
  total: platformAdminRows.length,
  onPageChange: noop,
  onPageSizeChange: noop,
};

const admins = (over: Partial<PlatformAdminsProps> = {}, sideMenu = true) => (
  <PlatformFrame active="admins" sideMenu={sideMenu}>
    <PlatformAdminsScreen
      view={{ kind: 'ready', rows: platformAdminRows, pagination }}
      onAdd={noop}
      onRevoke={noop}
      {...over}
    />
  </PlatformFrame>
);

const find = (email: string): PlatformAdminRowView => {
  const row = platformAdminRows.find((r) => r.email === email);
  if (!row) throw new Error(`platform admin fixtures lost ${email}`);
  return row;
};
const grace = find('grace@example.com');
const alice = find('alice@example.com');

export const PlatformAdmins: Story = {
  name: 'Platform admins, two working admins and one email not signed in yet',
  render: () => admins(),
};
export const PlatformAdminsLoading: Story = {
  name: 'Platform admins, loading',
  render: () => admins({ view: { kind: 'loading' } }),
};
export const PlatformAdminsEmpty: Story = {
  name: 'Platform admins, empty',
  render: () => admins({ view: { kind: 'ready', rows: [], pagination } }),
};
export const PlatformAdminsError: Story = {
  name: 'Platform admins, failed to load',
  render: () =>
    admins({
      view: { kind: 'error', title: 'Internal server error', requestId: 'req_01JDP4A7K2QX', onRetry: noop },
    }),
};
export const PlatformAdminsForbidden: Story = {
  name: 'Platform admin area, not a platform admin: no side menu',
  render: () => admins({ view: { kind: 'forbidden' } }, false),
};
export const PlatformAdminsPaged: Story = {
  name: 'Platform admins, page 2 of 2',
  render: () =>
    admins({
      view: {
        kind: 'ready',
        rows: pagedPlatformAdminRows.slice(20),
        pagination: { page: 2, pageSize: 20 as const, total: 25, onPageChange: noop, onPageSizeChange: noop },
      },
    }),
};

const addDialog = (over: Partial<NonNullable<PlatformAdminsProps['addDialog']>> = {}) =>
  admins({
    addDialog: {
      open: true,
      values: { email: '' },
      errors: {},
      saving: false,
      onChange: noop,
      onSubmit: noop,
      onClose: noop,
      ...over,
    },
  });

export const PlatformAdminsAdd: Story = {
  name: 'Platform admins, Add platform admin dialog',
  render: () => addDialog(),
};
export const PlatformAdminsAddError: Story = {
  name: 'Platform admins, Add: server error banner in the dialog',
  render: () =>
    addDialog({
      values: { email: 'dana.ortiz@example.com' },
      formError: { title: 'Internal server error', requestId: 'req_01JDP4C9W1ZE' },
    }),
};
export const PlatformAdminsAddFieldErrors: Story = {
  name: 'Platform admins, Add: no account has this email',
  render: () =>
    addDialog({ values: { email: 'jo.marsh@example.com' }, errors: { email: 'No account has this email yet.' } }),
};
export const PlatformAdminsAddSaving: Story = {
  name: 'Platform admins, Add: adding',
  render: () => addDialog({ values: { email: 'dana.ortiz@example.com' }, saving: true }),
};

const revoke = (row: PlatformAdminRowView, own: boolean, busy: boolean) =>
  admins({ revokeConfirm: { row, own, busy, onConfirm: noop, onCancel: noop } });

export const PlatformAdminsRevokeConfirm: Story = {
  name: 'Platform admins, revoke confirm for another admin',
  render: () => revoke(grace, false, false),
};
export const PlatformAdminsRevokeSelf: Story = {
  name: 'Platform admins, revoke your own access (warns)',
  render: () => revoke(alice, true, false),
};
export const PlatformAdminsRevoking: Story = {
  name: 'Platform admins, revoking (busy, not closable)',
  render: () => revoke(grace, false, true),
};
export const PlatformAdminsLastAdmin: Story = {
  name: 'Platform admins, last working admin: Revoke disabled with the reason',
  render: () =>
    admins({
      view: {
        kind: 'ready',
        rows: [find('new.hire@example.com'), { ...alice, lastWorkingAdmin: true }],
        pagination: { ...pagination, total: 2 },
      },
    }),
};

const orgsPagination = {
  page: 1,
  pageSize: 20 as const,
  total: platformOrgRows.length,
  onPageChange: noop,
  onPageSizeChange: noop,
};
const noFilters = { q: '', status: 'all' as const, active: false };

const orgs = (over: Partial<PlatformOrgsProps> = {}) => (
  <PlatformFrame active="orgs">
    <PlatformOrgsScreen
      view={{ kind: 'ready', rows: platformOrgRows, pagination: orgsPagination }}
      filters={noFilters}
      onSearch={noop}
      onStatus={noop}
      onClearFilters={noop}
      createHref="/orgs/new"
      {...over}
    />
  </PlatformFrame>
);

export const PlatformOrgs: Story = {
  name: 'Organizations, directory: suspended org, no owner yet, no activity yet',
  render: () => orgs(),
};
export const PlatformOrgsLoading: Story = {
  name: 'Organizations, loading',
  render: () => orgs({ view: { kind: 'loading' } }),
};
export const PlatformOrgsEmpty: Story = {
  name: 'Organizations, no organizations yet',
  render: () => orgs({ view: { kind: 'ready', rows: [], pagination: { ...orgsPagination, total: 0 } } }),
};
export const PlatformOrgsEmptyFiltered: Story = {
  name: 'Organizations, search and status match nothing',
  render: () =>
    orgs({
      view: { kind: 'ready', rows: [], pagination: { ...orgsPagination, total: 0 } },
      filters: { q: 'zephyr', status: 'suspended', active: true },
    }),
};
export const PlatformOrgsError: Story = {
  name: 'Organizations, failed to load',
  render: () =>
    orgs({ view: { kind: 'error', title: 'Internal server error', requestId: 'req_01JDP4A7K2QX', onRetry: noop } }),
};
export const PlatformOrgsPaged: Story = {
  name: 'Organizations, page 2 of 2',
  render: () =>
    orgs({
      view: {
        kind: 'ready',
        rows: pagedPlatformOrgRows.slice(20),
        pagination: { page: 2, pageSize: 20 as const, total: 25, onPageChange: noop, onPageSizeChange: noop },
      },
    }),
};

const orgNav = { name: 'Acme', links: { overview: '/platform/orgs/org_acme' } };
const header = {
  name: 'Acme',
  slug: 'acme',
  auditHref: '/platform/audit?org=acme',
  onSuspend: noop,
  onReactivate: noop,
};
const detail = (over: Partial<PlatformOrgDetailProps> = {}) => (
  <PlatformFrame active="overview" org={orgNav}>
    <PlatformOrgDetailScreen
      view={{ kind: 'ready', header: { ...header, status: 'active' }, overview: activeOrgOverview }}
      {...over}
    />
  </PlatformFrame>
);
const suspendedView: PlatformOrgDetailProps['view'] = {
  kind: 'ready',
  header: { ...header, status: 'suspended' },
  overview: suspendedOrgOverview,
};

export const PlatformOrgOverview: Story = {
  name: 'Organization detail, Overview, active org',
  render: () => detail(),
};
export const PlatformOrgOverviewLoading: Story = {
  name: 'Organization detail, loading',
  render: () => detail({ view: { kind: 'loading' } }),
};
export const PlatformOrgOverviewError: Story = {
  name: 'Organization detail, failed to load',
  render: () =>
    detail({ view: { kind: 'error', title: 'Internal server error', requestId: 'req_01JDP4A7K2QX', onRetry: noop } }),
};
export const PlatformOrgOverviewNotFound: Story = {
  name: 'Organization detail, unknown organization id',
  render: () => detail({ view: { kind: 'notFound', backHref: '/platform/orgs' } }),
};
export const PlatformOrgOverviewSuspended: Story = {
  name: 'Organization detail, Overview, suspended org (banner with the reason)',
  render: () => detail({ view: suspendedView }),
};

const dialog = (over: Partial<SuspendOrgDialogProps> = {}): SuspendOrgDialogProps => ({
  mode: 'suspend',
  orgName: 'Acme',
  open: true,
  reason: '',
  saving: false,
  onReason: noop,
  onSubmit: noop,
  onClose: noop,
  ...over,
});

export const PlatformOrgOverviewSuspendDialog: Story = {
  name: 'Organization detail, Suspend dialog',
  render: () => detail({ dialog: dialog() }),
};
export const PlatformOrgOverviewSuspendError: Story = {
  name: 'Organization detail, Suspend: reason missing (error at the field)',
  render: () => detail({ dialog: dialog({ error: 'Enter a reason.' }) }),
};
export const PlatformOrgOverviewSuspendFormError: Story = {
  name: 'Organization detail, Suspend: server error banner in the dialog',
  render: () =>
    detail({
      dialog: dialog({
        reason: 'Billing hold',
        formError: { title: 'Could not suspend the organization.', requestId: '01JDK8Q3V2' },
      }),
    }),
};
export const PlatformOrgOverviewSuspendSaving: Story = {
  name: 'Organization detail, Suspend: suspending',
  render: () => detail({ dialog: dialog({ reason: 'Billing hold', saving: true }) }),
};
export const PlatformOrgOverviewReactivateDialog: Story = {
  name: 'Organization detail, Reactivate dialog on a suspended org',
  render: () => detail({ view: suspendedView, dialog: dialog({ mode: 'reactivate' }) }),
};

const editDialog = (over: Partial<EditOrgDialogProps> = {}): EditOrgDialogProps => ({
  open: true,
  values: editOrgValues,
  errors: {},
  dirty: false,
  saving: false,
  onChange: noop,
  onSubmit: noop,
  onClose: noop,
  ...over,
});
const editView: PlatformOrgDetailProps['view'] = {
  kind: 'ready',
  header: { ...header, status: 'active', onEdit: noop },
  overview: activeOrgOverview,
};
const editing = (over: Partial<PlatformOrgDetailProps>) => detail({ view: editView, ...over });

export const PlatformOrgEdit: Story = {
  name: 'Organization detail, Edit organization: Name and URL prefilled, Save disabled until something changes',
  render: () => editing({ editDialog: editDialog() }),
};
export const PlatformOrgEditFieldErrors: Story = {
  name: 'Organization detail, Edit organization: name empty and URL outside the format',
  render: () =>
    editing({
      editDialog: editDialog({ values: { name: '', slug: '-acme-' }, dirty: true, errors: editOrgFieldErrors }),
    }),
};
export const PlatformOrgEditSlugTaken: Story = {
  name: 'Organization detail, Edit organization: URL taken by another org (409)',
  render: () =>
    editing({
      editDialog: editDialog({ values: { name: 'Acme', slug: 'northwind' }, dirty: true, errors: editOrgSlugTaken }),
    }),
};
export const PlatformOrgEditSaving: Story = {
  name: 'Organization detail, Edit organization: saving',
  render: () => editing({ editDialog: editDialog({ values: editOrgDirtyValues, dirty: true, saving: true }) }),
};
export const PlatformOrgEditSlugConfirm: Story = {
  name: 'Organization detail, Edit organization: confirm the URL change (old links stop working)',
  render: () =>
    editing({
      slugConfirm: {
        from: 'acme',
        to: 'acme-robotics',
        closing: 'Share the new link with its members.',
        onConfirm: noop,
        onCancel: noop,
      },
    }),
};
export const PlatformOrgEditError: Story = {
  name: 'Organization detail, Edit organization: server error banner in the dialog (403 or 5xx)',
  render: () =>
    editing({
      editDialog: editDialog({
        values: editOrgDirtyValues,
        dirty: true,
        formError: { ...editOrgFormError, requestId: 'req_01JDP6H2K9TS' },
      }),
    }),
};
