import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { user } from '@/mocks';
import { SignOutProvider } from './AccountMenu';
import { SetupLayout } from './SetupLayout';

const harbor = { id: 'org-harbor', slug: 'harbor-labs', name: 'Harbor Labs' };
const org = (settingsHref?: string) => ({
  current: harbor,
  orgs: [harbor],
  platformAdmin: false,
  orgHref: (o: { slug: string }) => `/o/${o.slug}/projects`,
  createHref: '/orgs/new',
  projectsHref: '/o/harbor-labs/projects',
  settingsHref,
});
const account = { name: 'Kim Hale', handle: 'kim-hale', invitationsHref: '/invitations' };
const layout = (props: Partial<Parameters<typeof SetupLayout>[0]>) => (
  <SetupLayout user={user} projectName="invoicer-api" steps={[{ label: 'Add rule' }]} current={0} {...props}>
    body
  </SetupLayout>
);

describe('SetupLayout org bar', () => {
  it('marks Projects current and shows Settings with settingsHref', () => {
    render(layout({ org: org('/o/harbor-labs/settings'), account }));
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: /Projects/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: /Settings/ })).toBeInTheDocument();
  });

  it('has no Settings tab without settingsHref', () => {
    render(layout({ org: org() }));
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: /Settings/ })).not.toBeInTheDocument();
  });

  it('passes account to the avatar menu', async () => {
    render(<SignOutProvider onSignOut={() => undefined}>{layout({ org: org(), account })}</SignOutProvider>);
    await userEvent.click(screen.getByRole('button', { name: `Account menu for ${user.login}` }));
    expect(screen.getByRole('menuitem', { name: /My invitations/ })).toHaveAttribute('href', '/invitations');
  });
});
