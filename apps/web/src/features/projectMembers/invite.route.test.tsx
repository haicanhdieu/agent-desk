import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { orgsQuery } from '@/features/auth/session';
import { useInviteForm } from '@/features/orgInvitations/inviteForm';
import { orgInvitationsListKey } from '@/features/orgInvitations/queries';
import { projectAuditListKey } from '@/features/projectAudit/queries';
import { roleFixtures } from '@/mocks/dto/access';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { problemResponse, routeDef } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { applyProjectSpace, type ProjectSpaceRole } from '@/mocks/msw/projectSpaceScenarios';
import { renderRoute } from '@/test/renderRoute';

const P = ids.project.invoicerApi;
const page = `/o/alice/p/${P}/desk/members`;
const create = routeDef('invitations.create');
const createPath = create.path.replace(':orgId', ids.org.alice);

const as = (role: ProjectSpaceRole) => () => applyProjectSpace(mockDb, { role });
const ready = () => screen.findByRole('heading', { level: 1, name: 'Members' });
const roleId = (key: string) => roleFixtures.find((r) => r.key === key)?.id ?? '';

type Rendered = Awaited<ReturnType<typeof renderRoute>>;
const openInvite = async (role: ProjectSpaceRole = 'projectAdmin'): Promise<{ r: Rendered; dialog: HTMLElement }> => {
  const r = await renderRoute(page, { scenario: as(role) });
  await ready();
  await r.user.click(screen.getByRole('button', { name: 'Invite people' }));
  const dialog = await screen.findByRole('dialog', { name: 'Invite people' });
  await within(dialog).findByRole('option', { name: 'Member' });
  return { r, dialog };
};
const fill = async (r: Rendered, email: string, role: string) => {
  await r.user.click(screen.getByRole('textbox', { name: 'Email' }));
  await r.user.paste(email);
  await r.user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), role);
};

describe('BR-13 Invite people from Members', () => {
  it.each<ProjectSpaceRole>(['projectAdmin', 'owner'])(
    'opens with this project fixed and three roles (%s)',
    async (role) => {
      const { dialog } = await openInvite(role);
      expect(within(dialog).getByRole('textbox', { name: 'Email' })).toHaveValue('');
      const select = within(dialog).getByRole('combobox', { name: 'Role' });
      expect(select).toHaveValue('');
      expect(within(select).getByText('Choose a role')).toBeInTheDocument();
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent)
          .filter((t) => t !== 'Choose a role'),
      ).toEqual(['Admin', 'Member', 'Viewer']);
      expect(within(dialog).getByText('Some projects')).toBeInTheDocument();
      expect(within(dialog).queryByRole('radio', { name: 'Whole organization' })).not.toBeInTheDocument();
      const boxes = within(dialog).getAllByRole('checkbox');
      expect(boxes).toHaveLength(1);
      expect(boxes[0]).toBeChecked();
      expect(boxes[0]).toHaveAccessibleName('invoicer-api');
    },
  );

  it('creates an invitation for this project, shows the link, and Done returns to Members', async () => {
    const { r } = await openInvite();
    await fill(r, 'New.Person@dev.local', 'Viewer');
    await r.user.click(screen.getByRole('button', { name: 'Create invitation' }));
    const created = await screen.findByRole('dialog', { name: 'Invitation created' });
    const row = mockDb.state.invitations.find((i) => i.email === 'new.person@dev.local');
    expect(row?.role.id).toBe(roleId('viewer'));
    expect(row?.scope).toEqual({ type: 'project', projects: [{ id: P, name: 'invoicer-api' }] });
    expect(within(created).getByTitle(`${window.location.origin}/invitations/${row?.id}`)).toBeInTheDocument();
    await r.user.click(within(created).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
  });

  it('two quick clicks on Create invitation send one request', async () => {
    const posts: string[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.post(`*${createPath}`, async ({ request }) => {
        posts.push(request.url);
        await held;
        return problemResponse({ status: 500, title: 'Internal server error', type: 'internal' });
      }),
    );
    const { r } = await openInvite();
    await fill(r, 'twice@dev.local', 'Member');
    const button = screen.getByRole('button', { name: 'Create invitation' });
    await Promise.all([r.user.click(button), r.user.click(button)]);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    release();
    await screen.findByText('Internal server error');
    expect(posts).toHaveLength(1);
  });

  it('a failed create keeps the dialog and shows the problem', async () => {
    server.use(
      http.post(`*${createPath}`, () =>
        problemResponse({ status: 500, title: 'Internal server error', type: 'internal' }),
      ),
    );
    const { r, dialog } = await openInvite();
    await fill(r, 'fail@dev.local', 'Member');
    await r.user.click(screen.getByRole('button', { name: 'Create invitation' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create invitation' })).toBeEnabled());
    expect(screen.getByRole('dialog', { name: 'Invite people' })).toBeInTheDocument();
    expect(within(dialog).getByText('Internal server error')).toBeInTheDocument();
    expect(mockDb.state.invitations.some((i) => i.email === 'fail@dev.local')).toBe(false);
  });

  it('an org switched in another tab (409) toasts the message and keeps the dialog without a field error', async () => {
    server.use(
      http.post(`*${createPath}`, () =>
        problemResponse({ status: 409, title: 'Conflict', type: 'urn:agentdesk:problem:org-mismatch' }),
      ),
    );
    const { r, dialog } = await openInvite();
    await fill(r, 'switched@dev.local', 'Member');
    await r.user.click(screen.getByRole('button', { name: 'Create invitation' }));
    expect(await screen.findByText('This organization was switched in another tab. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Invite people' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create invitation' })).toBeEnabled();
  });

  it('shows a banner when the roles fail to load', async () => {
    server.use(
      http.get('*/api/orgs/:orgId/roles', () =>
        problemResponse({ status: 500, title: 'Internal server error', type: 'internal' }),
      ),
    );
    const r = await renderRoute(page, { scenario: as('projectAdmin') });
    await ready();
    await r.user.click(screen.getByRole('button', { name: 'Invite people' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite people' });
    expect(await within(dialog).findByText(/Could not load the roles/)).toBeInTheDocument();
  });
});

describe('BR-13 after an invitation is created', () => {
  it('the org invitations list, the org audit and this project audit read again', async () => {
    applyProjectSpace(mockDb, { role: 'projectAdmin' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(orgsQuery.queryKey, [{ id: ids.org.alice, name: 'Alice', slug: 'alice' }]);
    const keys = {
      invitations: [...orgInvitationsListKey('alice'), 'pending', 1, 20],
      orgAudit: ['org', 'alice', 'audit', 'list', 1, 20],
      projectAudit: [...projectAuditListKey('alice', P), 1, 20],
      otherProjectAudit: [...projectAuditListKey('alice', ids.project.invoicerWeb), 1, 20],
    };
    for (const key of Object.values(keys))
      queryClient.setQueryData(key, { items: [], total: 0, page: 1, pageSize: 20 });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useInviteForm({ org: 'alice', projectsOnly: true, onOrgSwitched: () => {}, fixedProjectId: P }),
      { wrapper },
    );
    act(() => result.current.change({ ...result.current.values, email: 'inv@dev.local', roleId: roleId('member') }));
    act(() => result.current.submit());
    await waitFor(() => expect(result.current.created).toBeDefined());
    const stale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    expect(stale(keys.invitations)).toBe(true);
    expect(stale(keys.orgAudit)).toBe(true);
    expect(stale(keys.projectAudit)).toBe(true);
    expect(stale(keys.otherProjectAudit)).toBe(false);
  });
});
