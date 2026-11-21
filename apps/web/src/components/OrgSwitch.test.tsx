import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { orgSwitchFixtures } from '@/mocks';
import { OrgSwitch, type OrgSwitchProps } from './OrgSwitch';

const orgHref: OrgSwitchProps['orgHref'] = (org) => `/o/${org.slug}`;
const createHref = '/orgs/new';

function setup(data: keyof typeof orgSwitchFixtures) {
  const user = userEvent.setup();
  render(<OrgSwitch {...orgSwitchFixtures[data]} orgHref={orgHref} createHref={createHref} />);
  return user;
}
const button = () => screen.getByRole('button', { name: /^Switch organization/ });

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

  it('BR-9: one org and not a platform admin shows plain text, no button', () => {
    setup('oneOrg');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('BR-9: one org with no current org still shows no switcher button', () => {
    render(<OrgSwitch {...orgSwitchFixtures.oneOrg} current={null} orgHref={orgHref} createHref={createHref} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('BR-9: no org and not a platform admin renders no switcher', () => {
    const { container } = render(
      <OrgSwitch {...orgSwitchFixtures.oneOrg} current={null} orgs={[]} orgHref={orgHref} createHref={createHref} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('BR-40: a platform admin with several orgs gets Create organization after the orgs', async () => {
    const user = setup('platformAdmin');
    await user.click(button());
    const links = within(screen.getByRole('dialog')).getAllByRole('link');
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
    expect(screen.getByTitle(orgSwitchFixtures.longName.current?.name ?? '')).toBeInTheDocument();
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
