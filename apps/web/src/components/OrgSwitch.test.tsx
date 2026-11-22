import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { orgSwitchFixtures } from '@/mocks';
import { OrgSwitch, type OrgSwitchProps } from './OrgSwitch';

const orgHref: OrgSwitchProps['orgHref'] = (org) => `/o/${org.slug}`;
const createHref = '/orgs/new';

const projectsHref = '/o/acme/projects';
const settingsHref = '/o/acme/settings';

function setup(data: keyof typeof orgSwitchFixtures, extra: Partial<OrgSwitchProps> = {}) {
  const user = userEvent.setup();
  render(<OrgSwitch {...orgSwitchFixtures[data]} orgHref={orgHref} createHref={createHref} {...extra} />);
  return user;
}
const button = () => screen.getByRole('button', { name: /^Switch organization/ });
const noOrgData = { current: null, orgs: [], platformAdmin: false };

describe('OrgSwitch', () => {
  it('BR-6: several orgs list both in the menu and mark the current one', async () => {
    const user = setup('severalOrgs');
    expect(button()).toHaveAccessibleName('Switch organization, currently Acme');
    expect(button()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button()).toHaveAttribute('aria-expanded', 'false');
    await user.click(button());
    const menu = screen.getByRole('dialog', { name: 'Organizations' });
    const acme = within(menu).getByRole('link', { name: /Acme/ });
    expect(acme).toHaveAttribute('aria-current', 'true');
    expect(acme).toHaveAttribute('href', '/o/acme');
    const beta = within(menu).getByRole('link', { name: /Beta/ });
    expect(beta).not.toHaveAttribute('aria-current');
    expect(within(menu).queryByRole('link', { name: 'Create organization' })).toBeNull();
  });

  it('BR-44: one org shows an Organization menu button whose menu lists the name, Projects and Settings', async () => {
    const user = setup('oneOrg', { projectsHref, settingsHref });
    const trigger = screen.getByRole('button', { name: 'Organization menu, Acme' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(trigger);
    const menu = screen.getByRole('dialog', { name: 'Organizations' });
    expect(within(menu).getByRole('heading', { name: 'Acme' })).toBeInTheDocument();
    const links = within(menu).getAllByRole('link');
    expect(links.map((l) => l.textContent?.trim())).toEqual(['Projects', 'Settings']);
    expect(links[0]).toHaveAttribute('href', projectsHref);
    expect(links[1]).toHaveAttribute('href', settingsHref);
    expect(within(menu).queryByText('Switch organization')).toBeNull();
  });

  it('BR-44: one org without settingsHref has no Settings item', async () => {
    const user = setup('oneOrg', { projectsHref });
    await user.click(screen.getByRole('button', { name: 'Organization menu, Acme' }));
    const menu = screen.getByRole('dialog');
    expect(within(menu).getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('BR-44: one org with no current org still shows the button for the lone org', () => {
    render(<OrgSwitch {...orgSwitchFixtures.oneOrg} current={null} orgHref={orgHref} createHref={createHref} />);
    expect(screen.getByRole('button', { name: 'Organization menu, Acme' })).toBeInTheDocument();
  });

  it('BR-44: several orgs list Projects, Settings, then a Switch organization group with the current one checked', async () => {
    const user = setup('severalOrgs', { projectsHref, settingsHref });
    await user.click(button());
    const menu = screen.getByRole('dialog');
    const group = within(menu).getByRole('group', { name: 'Switch organization' });
    expect(within(group).getByRole('link', { name: /Acme/ })).toHaveAttribute('aria-current', 'true');
    expect(within(group).getByRole('link', { name: /Beta/ })).not.toHaveAttribute('aria-current');
    const labels = within(menu)
      .getAllByRole('link')
      .map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Projects', 'Settings', expect.stringContaining('Acme'), expect.stringContaining('Beta')]);
  });

  it('BR-44: a person with no org who is not a platform admin sees plain text, no button', () => {
    render(<OrgSwitch {...noOrgData} orgHref={orgHref} createHref={createHref} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('No organization')).toBeInTheDocument();
  });

  it('BR-40: a platform admin with several orgs gets Create organization after the orgs', async () => {
    const user = setup('platformAdmin');
    await user.click(button());
    const menu = screen.getByRole('dialog');
    expect(within(menu).getByRole('group', { name: 'Switch organization' })).toBeInTheDocument();
    const links = within(menu).getAllByRole('link');
    expect(links.map((l) => l.textContent?.trim())).toEqual([
      expect.stringContaining('Acme'),
      expect.stringContaining('Beta'),
      'Create organization',
    ]);
    expect(links[2]).toHaveAttribute('href', createHref);
  });

  it('BR-40: a platform admin with one org lists it, then a divider, then Create organization', async () => {
    const user = userEvent.setup();
    const [acme] = orgSwitchFixtures.platformAdmin.orgs;
    render(
      <OrgSwitch
        {...orgSwitchFixtures.platformAdmin}
        orgs={acme ? [acme] : []}
        orgHref={orgHref}
        createHref={createHref}
      />,
    );
    await user.click(button());
    const items = Array.from(screen.getByRole('dialog').querySelectorAll('a, [role=separator]'));
    expect(items.map((e) => (e.getAttribute('role') === 'separator' ? 'separator' : e.textContent?.trim()))).toEqual([
      expect.stringContaining('Acme'),
      'separator',
      'Create organization',
    ]);
  });

  it('BR-40: a platform admin with no org sees No organization and only Create organization', async () => {
    const user = setup('platformAdminNoOrg');
    expect(button()).toHaveTextContent('No organization');
    expect(button()).toHaveAccessibleName('Switch organization');
    await user.click(button());
    const links = within(screen.getByRole('dialog')).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('Create organization');
  });

  it('long names ellipsize and keep the full name in a title', () => {
    setup('longName');
    expect(screen.getAllByTitle(orgSwitchFixtures.longName.current?.name ?? '')[0]).toBeInTheDocument();
  });

  it('keyboard: ArrowDown opens, arrows/Home/End move focus, Escape closes and refocuses the button', async () => {
    const user = setup('platformAdmin');
    button().focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(button()).toHaveAttribute('aria-expanded', 'true');
    const [acme, beta, create] = screen.getAllByRole('link');
    expect(acme).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(beta).toHaveFocus();
    await user.keyboard('{End}');
    expect(create).toHaveFocus();
    await user.keyboard('{Home}');
    expect(acme).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveFocus();
  });
});
