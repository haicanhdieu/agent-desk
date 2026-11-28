import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Button, Dialog } from '@/ds';
import {
  AppShell,
  InviteDialog,
  InviteLink,
  type InviteDialogStep,
  type EditOrgDialogProps,
  type SuspendOrgDialogProps,
} from '@/components';
import {
  activeOrgOverview,
  assignmentProjects,
  assignmentRoles,
  editOrgDirtyValues,
  editOrgFieldErrors,
  editOrgFormError,
  editOrgSlugTaken,
  editOrgValues,
  invitationLink,
  inviteProjectOptions,
  inviteRoleOptions,
  orgInvitationRows,
  pagedInvitationRows,
  pagedPlatformAdminRows,
  pagedPlatformMemberRows,
  pagedPlatformProjectRows,
  pagedPlatformAuditRows,
  pagedPlatformOrgRows,
  platformAdminRows,
  platformAuditActions,
  platformAuditRows,
  platformMemberRows,
  platformProjectRows,
  platformOrgRows,
  suspendedOrgOverview,
  type OrgInvitationRowView,
  type PlatformAdminRowView,
  type PlatformMemberRowView,
  type PlatformProjectRowView,
} from '@/mocks';
import { PlatformAudit as PlatformAuditScreen, type PlatformAuditProps } from './PlatformAudit';
import { PlatformAdmins as PlatformAdminsScreen, type PlatformAdminsProps } from './PlatformAdmins';
import { PlatformOrgDetail as PlatformOrgDetailScreen, type PlatformOrgDetailProps } from './PlatformOrgDetail';
import {
  PlatformOrgInvitations as PlatformOrgInvitationsScreen,
  type PlatformOrgInvitationsProps,
} from './PlatformOrgInvitations';
import { PlatformOrgMembers as PlatformOrgMembersScreen, type PlatformOrgMembersProps } from './PlatformOrgMembers';
import { PlatformOrgProjects as PlatformOrgProjectsScreen, type ListView } from './PlatformOrgProjects';
import { PlatformOrgs as PlatformOrgsScreen, type PlatformOrgsProps } from './PlatformOrgs';
import { PlatformFrame } from './platformShellFrame';
import { PlatformShellFrame } from './platformShellFrame';
import { CreateOrg as CreateOrgScreen } from './CreateOrg';
import { viewport } from './viewports';

const noop = () => undefined;

const meta = {
  title: 'Screens/Platform',
  parameters: { layout: 'fullscreen' },
  globals: viewport(1440, 900),
  decorators: [
    // A story with `parameters.shell` brings its own ShellFrame; the others sit in the old bare frame.
    (S, { parameters }) =>
      parameters.shell ? (
        <S />
      ) : (
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
      createHref="/platform/orgs/new"
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

const orgNav = { state: 'ready' as const, name: 'Acme', links: { overview: '/platform/orgs/org_acme' } };
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

const auditPagination = { ...pagination, total: platformAuditRows.length };
const audit = (over: Partial<PlatformAuditProps> = {}) => (
  <PlatformFrame active="audit">
    <PlatformAuditScreen
      view={{ kind: 'ready', rows: platformAuditRows, pagination: auditPagination }}
      action="all"
      actions={platformAuditActions}
      onAction={noop}
      filtered={false}
      onClearFilters={noop}
      {...over}
    />
  </PlatformFrame>
);
const bluefinRows = platformAuditRows.filter((r) => r.what.kind === 'sentence' && r.what.title.includes('Bluefin'));

export const PlatformAudit: Story = {
  name: 'Platform audit log, newest first, reason on suspend and reactivate',
  render: () => audit(),
};
export const PlatformAuditLoading: Story = {
  name: 'Platform audit log, loading',
  render: () => audit({ view: { kind: 'loading' } }),
};
export const PlatformAuditEmpty: Story = {
  name: 'Platform audit log, no entries',
  render: () => audit({ view: { kind: 'ready', rows: [], pagination: { ...pagination, total: 0 } } }),
};
export const PlatformAuditEmptyFiltered: Story = {
  name: 'Platform audit log, action filter matches nothing',
  render: () =>
    audit({
      view: { kind: 'ready', rows: [], pagination: { ...pagination, total: 0 } },
      action: 'invitation.resent',
      filtered: true,
    }),
};
export const PlatformAuditError: Story = {
  name: 'Platform audit log, failed to load',
  render: () =>
    audit({
      view: { kind: 'error', title: 'Internal server error', requestId: 'req_01JDP7B3M4VX', onRetry: noop },
    }),
};
export const PlatformAuditPaged: Story = {
  name: 'Platform audit log, page 2 of 2',
  render: () =>
    audit({
      view: {
        kind: 'ready',
        rows: pagedPlatformAuditRows.slice(20),
        pagination: { ...pagination, page: 2, total: 25 },
      },
    }),
};
export const PlatformAuditOrgChip: Story = {
  name: 'Platform audit log, from "View audit log": filtered to one org, removable chip',
  render: () =>
    audit({
      view: { kind: 'ready', rows: bluefinRows, pagination: { ...pagination, total: bluefinRows.length } },
      orgChip: { label: 'Organization: Bluefin Health', onRemove: noop },
      filtered: true,
    }),
};
export const PlatformAuditOrgChipUnknown: Story = {
  name: 'Platform audit log, org filter with an unknown id',
  render: () =>
    audit({
      view: { kind: 'ready', rows: [], pagination: { ...pagination, total: 0 } },
      orgChip: { label: 'Unknown organization', onRemove: noop },
      filtered: true,
    }),
};

const tabNav = {
  state: 'ready' as const,
  name: 'Acme',
  links: {
    overview: '/platform/orgs/org_acme',
    projects: '/platform/orgs/org_acme/projects',
    members: '/platform/orgs/org_acme/members',
    invitations: '/platform/orgs/org_acme/invitations',
  },
};
const tabHeader = { ...header, status: 'active' as const, onEdit: noop };
const tabPagination = { ...pagination, total: 3 };
const tabPage = (active: 'projects' | 'members' | 'invitations', children: ReactNode) => (
  <PlatformFrame active={active} org={tabNav}>
    <PlatformOrgDetailScreen view={{ kind: 'ready', header: tabHeader, overview: activeOrgOverview }}>
      {children}
    </PlatformOrgDetailScreen>
  </PlatformFrame>
);
const listError = {
  kind: 'error' as const,
  title: 'Internal server error',
  requestId: 'req_01JDP8C5N6WY',
  onRetry: noop,
};

const projects = (view: ListView<PlatformProjectRowView> = readyProjects) =>
  tabPage('projects', <PlatformOrgProjectsScreen view={view} />);
const readyProjects: ListView<PlatformProjectRowView> = {
  kind: 'ready',
  rows: platformProjectRows,
  pagination: tabPagination,
};

export const PlatformOrgProjects: Story = {
  name: 'Organization detail, Projects: id and name only',
  render: () => projects(),
};
export const PlatformOrgProjectsLoading: Story = {
  name: 'Organization detail, Projects: loading',
  render: () => projects({ kind: 'loading' }),
};
export const PlatformOrgProjectsEmpty: Story = {
  name: 'Organization detail, Projects: none',
  render: () => projects({ kind: 'ready', rows: [], pagination: { ...tabPagination, total: 0 } }),
};
export const PlatformOrgProjectsError: Story = {
  name: 'Organization detail, Projects: failed to load',
  render: () => projects(listError),
};
export const PlatformOrgProjectsPaged: Story = {
  name: 'Organization detail, Projects: page 2 of 2',
  render: () =>
    projects({
      kind: 'ready',
      rows: pagedPlatformProjectRows.slice(20),
      pagination: { ...tabPagination, page: 2, total: 25 },
    }),
};

const memberRows: ListView<PlatformMemberRowView> = {
  kind: 'ready',
  rows: platformMemberRows,
  pagination: { ...tabPagination, total: platformMemberRows.length },
};
const members = (over: Partial<PlatformOrgMembersProps> = {}) =>
  tabPage('members', <PlatformOrgMembersScreen view={memberRows} onAdd={noop} onRemove={noop} {...over} />);
const cleo = platformMemberRows.find((r) => r.handle === 'cleo');
if (!cleo?.assignments[0]) throw new Error('platform member fixtures lost cleo');
const cleoRole = cleo.assignments[0];
const removeConfirm = (busy: boolean): NonNullable<PlatformOrgMembersProps['removeConfirm']> => ({
  roleLabel: 'Admin',
  personName: 'Cleo Martin',
  busy,
  onConfirm: noop,
  onCancel: noop,
});

export const PlatformOrgMembers: Story = {
  name: 'Organization detail, Members: names, emails, roles with scopes',
  render: () => members(),
};
export const PlatformOrgMembersLoading: Story = {
  name: 'Organization detail, Members: loading',
  render: () => members({ view: { kind: 'loading' } }),
};
export const PlatformOrgMembersEmpty: Story = {
  name: 'Organization detail, Members: none',
  render: () => members({ view: { kind: 'ready', rows: [], pagination: { ...tabPagination, total: 0 } } }),
};
export const PlatformOrgMembersError: Story = {
  name: 'Organization detail, Members: failed to load',
  render: () => members({ view: listError }),
};
export const PlatformOrgMembersPaged: Story = {
  name: 'Organization detail, Members: page 2 of 2',
  render: () =>
    members({
      view: {
        kind: 'ready',
        rows: pagedPlatformMemberRows.slice(20),
        pagination: { ...tabPagination, page: 2, total: 25 },
      },
    }),
};
export const PlatformOrgMembersRowMenu: Story = {
  name: 'Organization detail, Members: row menu (Add assignment, remove one assignment)',
  render: () => members(),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Actions for Cleo Martin' }));
    await expect(within(document.body).getByRole('button', { name: 'Add assignment' })).toBeInTheDocument();
    await expect(within(document.body).getByRole('button', { name: `Remove ${cleoRole.label}` })).toBeInTheDocument();
  },
};
export const PlatformOrgMembersAddAssignment: Story = {
  name: 'Organization detail, Members: Add assignment dialog (whole organization: Owner, Admin, Member, Viewer)',
  render: () =>
    members({
      assignmentDialog: {
        open: true,
        person: { name: cleo.name, handle: cleo.handle },
        roles: assignmentRoles,
        projects: assignmentProjects,
        values: { access: 'org', roleKey: '', projectId: '' },
        errors: {},
        saving: false,
        onChange: noop,
        onSubmit: noop,
        onClose: noop,
      },
    }),
};
export const PlatformOrgMembersRemoveConfirm: Story = {
  name: 'Organization detail, Members: remove an assignment (confirm)',
  render: () => members({ removeConfirm: removeConfirm(false) }),
};
export const PlatformOrgMembersRemoving: Story = {
  name: 'Organization detail, Members: removing an assignment (busy)',
  render: () => members({ removeConfirm: removeConfirm(true), busyUserId: cleo.userId }),
};

const pendingInvites = orgInvitationRows.filter((r) => r.status === 'pending');
const inviteRows: ListView<OrgInvitationRowView> = {
  kind: 'ready',
  rows: pendingInvites,
  pagination: { ...tabPagination, total: pendingInvites.length },
};
const invitations = (over: Partial<PlatformOrgInvitationsProps> = {}) =>
  tabPage(
    'invitations',
    <PlatformOrgInvitationsScreen
      view={inviteRows}
      status="pending"
      onStatus={noop}
      onInvite={noop}
      rowActions={() => ({ onCopy: noop, onResend: noop, onRevoke: noop })}
      {...over}
    />,
  );
const inviteStep: InviteDialogStep = {
  kind: 'form',
  values: { email: 'ruth.okafor@harborlabs.dev', roleId: 'owner', scope: 'org', projectIds: [] },
  errors: {},
  saving: false,
};
const linkDialog = (
  <Dialog
    open
    title="Invitation link"
    width={520}
    onClose={noop}
    footer={
      <Button variant="primary" onClick={noop}>
        Done
      </Button>
    }
  >
    <InviteLink link={invitationLink} onCopy={noop} copyFailed />
  </Dialog>
);

export const PlatformOrgInvitations: Story = {
  name: 'Organization detail, Invitations: pending by default',
  render: () => invitations(),
};
export const PlatformOrgInvitationsLoading: Story = {
  name: 'Organization detail, Invitations: loading',
  render: () => invitations({ view: { kind: 'loading' } }),
};
export const PlatformOrgInvitationsEmpty: Story = {
  name: 'Organization detail, Invitations: none',
  render: () => invitations({ view: { kind: 'ready', rows: [], pagination: { ...tabPagination, total: 0 } } }),
};
export const PlatformOrgInvitationsError: Story = {
  name: 'Organization detail, Invitations: failed to load',
  render: () => invitations({ view: listError }),
};
export const PlatformOrgInvitationsPaged: Story = {
  name: 'Organization detail, Invitations: page 2 of 2',
  render: () =>
    invitations({
      view: {
        kind: 'ready',
        rows: pagedInvitationRows(2),
        pagination: { ...tabPagination, page: 2, total: 22 },
      },
    }),
};
export const PlatformOrgInvitationsInvite: Story = {
  name: 'Organization detail, Invitations: invite dialog (a platform admin may invite an owner)',
  render: () =>
    invitations({
      inviteDialog: (
        <InviteDialog
          open
          step={inviteStep}
          roles={inviteRoleOptions.owner}
          projects={inviteProjectOptions}
          projectsOnly={false}
          onChange={noop}
          onSubmit={noop}
          onCancel={noop}
          onCopy={noop}
          onDone={noop}
        />
      ),
    }),
};
export const PlatformOrgInvitationsResending: Story = {
  name: 'Organization detail, Invitations: resending (row busy)',
  render: () => invitations({ resendingId: pendingInvites[1]?.id }),
};
export const PlatformOrgInvitationsCopyFailed: Story = {
  name: 'Organization detail, Invitations: copy link blocked by the browser',
  render: () => invitations({ linkDialog, copyFailed: true }),
};

// The same screens inside the shell: the "Platform menu" (top level, or the one-org menu that replaces it) beside a
// page that draws only its own header and body.
const shellStory = (story: Story): Story => ({ ...story, parameters: { ...story.parameters, shell: true } });
const orgsCrumb = { label: 'Organizations', href: '/platform/orgs' };
const harborCrumbs = (...rest: { label: string; href?: string }[]) => [
  orgsCrumb,
  { label: 'Harbor Labs', href: '/platform/orgs/org-harbor' },
  ...rest,
];
const shellHeader = { ...tabHeader, name: 'Harbor Labs', slug: 'harbor-labs' };
const shellOrgPage = (
  org: 'active' | 'suspended' | 'loading' | 'error',
  tab: 'overview' | 'projects' | 'members' | 'invitations',
  view: PlatformOrgDetailProps['view'],
  crumbs: { label: string; href?: string }[],
  children?: ReactNode,
) => (
  <PlatformShellFrame menu={{ org, tab }} crumbs={crumbs}>
    <PlatformOrgDetailScreen view={view}>{children}</PlatformOrgDetailScreen>
  </PlatformShellFrame>
);
const shellReady: PlatformOrgDetailProps['view'] = {
  kind: 'ready',
  header: shellHeader,
  overview: activeOrgOverview,
};

export const PlatformOrgsSideMenu: Story = shellStory({
  name: 'Platform organizations, platform menu',
  render: () => (
    <PlatformShellFrame menu={{ page: 'orgs' }} crumbs={[orgsCrumb]}>
      <PlatformOrgsScreen
        view={{ kind: 'ready', rows: platformOrgRows, pagination: orgsPagination }}
        filters={noFilters}
        onSearch={noop}
        onStatus={noop}
        onClearFilters={noop}
        createHref="/platform/orgs/new"
      />
    </PlatformShellFrame>
  ),
});
export const PlatformAdminsForbiddenNoMenu: Story = shellStory({
  name: 'Platform admins, no access: no menu',
  render: () => (
    <PlatformShellFrame menu={{ page: 'admins' }} sideMenu={false} crumbs={[{ label: 'Platform admins' }]}>
      <PlatformAdminsScreen view={{ kind: 'forbidden' }} onAdd={noop} onRevoke={noop} />
    </PlatformShellFrame>
  ),
});
export const PlatformOrgMembersSideMenuError: Story = shellStory({
  name: 'Platform organization Members, failed to load: menu reads Organization',
  render: () =>
    shellOrgPage(
      'error',
      'members',
      { kind: 'error', title: 'Internal server error', onRetry: noop },
      harborCrumbs({ label: 'Members' }),
    ),
});
export const PlatformOrgMembersSideMenuLoading: Story = shellStory({
  name: 'Platform organization Members, loading: placeholder menu',
  render: () => shellOrgPage('loading', 'members', { kind: 'loading' }, harborCrumbs({ label: 'Members' })),
});
export const PlatformOrgOverviewSideMenuNotFound: Story = shellStory({
  name: 'Platform organization not found: platform menu with Organizations',
  render: () => (
    <PlatformShellFrame menu={{ page: 'orgs' }} crumbs={[orgsCrumb, { label: 'Not found' }]}>
      <PlatformOrgDetailScreen view={{ kind: 'notFound', backHref: '/platform/orgs' }} />
    </PlatformShellFrame>
  ),
});
export const PlatformOrgOverviewSideMenuSuspended: Story = shellStory({
  name: 'Platform organization Overview, suspended',
  render: () =>
    shellOrgPage(
      'suspended',
      'overview',
      { kind: 'ready', header: { ...shellHeader, status: 'suspended' }, overview: suspendedOrgOverview },
      harborCrumbs({ label: 'Overview' }),
    ),
});
export const PlatformOrgProjectsSideMenu: Story = shellStory({
  name: 'Platform organization Projects, platform menu',
  render: () =>
    shellOrgPage(
      'active',
      'projects',
      shellReady,
      harborCrumbs({ label: 'Projects' }),
      <PlatformOrgProjectsScreen view={readyProjects} />,
    ),
});
export const CreateOrgSideMenu: Story = shellStory({
  name: 'Create organization, platform menu',
  render: () => (
    <PlatformShellFrame menu={{ page: 'orgs' }} crumbs={[orgsCrumb, { label: 'Create organization' }]}>
      <CreateOrgScreen
        state={{ kind: 'form', values: { name: '', slug: '', email: '' }, errors: {}, saving: false }}
        onChange={noop}
        onSubmit={noop}
        onRetry={noop}
        onCopy={noop}
        onDone={noop}
      />
    </PlatformShellFrame>
  ),
});

// BR-65: the platform pages at 390x844 (phone boards): lists are cards with their value labels, filters wrap, the
// Overview keys stack over their values. The real shell frame draws the bar and the menu.
const phoneStory = (story: Story): Story => ({
  ...shellStory(story),
  decorators: [
    (S) => (
      <div style={{ width: 390, height: 844 }}>
        <S />
      </div>
    ),
  ],
  globals: viewport(390, 844),
});
const phonePagination = { page: 1, pageSize: 20 as const, total: 25, onPageChange: noop, onPageSizeChange: noop };

export const PlatformOrgsPhone: Story = phoneStory({
  name: 'Phone: organizations as cards, filters wrap',
  render: () => (
    <PlatformShellFrame menu={{ page: 'orgs' }} crumbs={[orgsCrumb]} height={844}>
      <PlatformOrgsScreen
        view={{ kind: 'ready', rows: platformOrgRows, pagination: phonePagination }}
        filters={noFilters}
        onSearch={noop}
        onStatus={noop}
        onClearFilters={noop}
        createHref="/platform/orgs/new"
      />
    </PlatformShellFrame>
  ),
});
export const PlatformAdminsPhone: Story = phoneStory({
  name: 'Phone: platform admins as cards',
  render: () => (
    <PlatformShellFrame menu={{ page: 'admins' }} crumbs={[{ label: 'Platform admins' }]} height={844}>
      <PlatformAdminsScreen
        view={{ kind: 'ready', rows: platformAdminRows, pagination: phonePagination }}
        onAdd={noop}
        onRevoke={noop}
      />
    </PlatformShellFrame>
  ),
});
export const PlatformAuditPhone: Story = phoneStory({
  name: 'Phone: platform audit log as cards, filters wrap',
  render: () => (
    <PlatformShellFrame menu={{ page: 'audit' }} crumbs={[{ label: 'Audit log' }]} height={844}>
      <PlatformAuditScreen
        view={{ kind: 'ready', rows: platformAuditRows, pagination: phonePagination }}
        action="all"
        actions={platformAuditActions}
        onAction={noop}
        orgChip={{ label: 'Harbor Labs', onRemove: noop }}
        filtered={false}
        onClearFilters={noop}
      />
    </PlatformShellFrame>
  ),
});
export const PlatformOrgOverviewPhone: Story = phoneStory({
  name: 'Phone: organization overview, keys over values, header actions wrap',
  render: () => (
    <PlatformShellFrame
      menu={{ org: 'active', tab: 'overview' }}
      crumbs={harborCrumbs({ label: 'Overview' })}
      height={844}
    >
      <PlatformOrgDetailScreen view={shellReady} />
    </PlatformShellFrame>
  ),
});
export const PlatformOrgProjectsPhone: Story = phoneStory({
  name: 'Phone: organization projects as cards',
  render: () => (
    <PlatformShellFrame
      menu={{ org: 'active', tab: 'projects' }}
      crumbs={harborCrumbs({ label: 'Projects' })}
      height={844}
    >
      <PlatformOrgDetailScreen view={shellReady}>
        <PlatformOrgProjectsScreen
          view={{ kind: 'ready', rows: platformProjectRows, pagination: { ...phonePagination, total: 25 } }}
        />
      </PlatformOrgDetailScreen>
    </PlatformShellFrame>
  ),
});
export const PlatformOrgMembersPhone: Story = phoneStory({
  name: 'Phone: organization members as cards',
  render: () => (
    <PlatformShellFrame
      menu={{ org: 'active', tab: 'members' }}
      crumbs={harborCrumbs({ label: 'Members' })}
      height={844}
    >
      <PlatformOrgDetailScreen view={shellReady}>
        <PlatformOrgMembersScreen
          view={{ kind: 'ready', rows: platformMemberRows, pagination: phonePagination }}
          onAdd={noop}
          onRemove={noop}
        />
      </PlatformOrgDetailScreen>
    </PlatformShellFrame>
  ),
});
export const PlatformOrgInvitationsPhone: Story = phoneStory({
  name: 'Phone: organization invitations as cards, status chips scroll',
  render: () => (
    <PlatformShellFrame
      menu={{ org: 'active', tab: 'invitations' }}
      crumbs={harborCrumbs({ label: 'Invitations' })}
      height={844}
    >
      <PlatformOrgDetailScreen view={shellReady}>
        <PlatformOrgInvitationsScreen
          view={{ kind: 'ready', rows: pendingInvites, pagination: phonePagination }}
          status="pending"
          onStatus={noop}
          onInvite={noop}
          rowActions={() => ({ onCopy: noop, onResend: noop, onRevoke: noop })}
        />
      </PlatformOrgDetailScreen>
    </PlatformShellFrame>
  ),
});
