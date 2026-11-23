import { render, screen, within } from '@testing-library/react';
import { user } from '@/mocks';
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
const layout = (props: Partial<Parameters<typeof SetupLayout>[0]>) => (
  <SetupLayout user={user} projectName="invoicer-api" steps={[{ label: 'Add rule' }]} current={0} {...props}>
    body
  </SetupLayout>
);

describe('SetupLayout org bar', () => {
  it('marks Projects current and shows Settings with settingsHref', () => {
    render(layout({ org: org('/o/harbor-labs/settings') }));
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: /Projects/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: /Settings/ })).toBeInTheDocument();
  });

  it('has no Settings tab without settingsHref', () => {
    render(layout({ org: org() }));
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: /Settings/ })).not.toBeInTheDocument();
  });
});
