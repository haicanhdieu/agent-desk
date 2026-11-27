import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
const button = () => screen.getByRole('button', { name: /^Switch scope/ });
const noOrgData = { current: null, orgs: [], platformAdmin: false };

describe('OrgSwitch', () => {
  it('names the button "Switch scope, currently organization Acme" for one org and for several', () => {
    const { unmount } = render(
      <OrgSwitch {...orgSwitchFixtures.oneOrg} orgHref={orgHref} createHref={createHref} projectsHref={projectsHref} />,
    );
    expect(screen.getByRole('button', { name: 'Switch scope, currently organization Acme' })).toBeInTheDocument();
    unmount();
    setup('severalOrgs');
    expect(screen.getByRole('button', { name: 'Switch scope, currently organization Acme' })).toBeInTheDocument();
  });

  it('names the menu dialog "Scope"', async () => {
    const user = setup('severalOrgs');
    await user.click(screen.getByRole('button', { name: /^Switch scope/ }));
    expect(screen.getByRole('dialog', { name: 'Scope' })).toBeInTheDocument();
  });

  it('a platform admin with no org gets "Switch scope, currently no organization"', () => {
    setup('platformAdminNoOrg');
    expect(screen.getByRole('button', { name: 'Switch scope, currently no organization' })).toBeInTheDocument();
  });

  it('BR-6: several orgs list both in the menu and mark the current one', async () => {
    const user = setup('severalOrgs');
    expect(button()).toHaveAccessibleName('Switch scope, currently organization Acme');
    expect(button()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button()).toHaveAttribute('aria-expanded', 'false');
    await user.click(button());
    const menu = screen.getByRole('dialog', { name: 'Scope' });
    const acme = within(menu).getByRole('link', { name: /Acme/ });
    expect(acme).toHaveAttribute('aria-current', 'true');
    expect(acme).toHaveAttribute('href', '/o/acme');
    const beta = within(menu).getByRole('link', { name: /Beta/ });
    expect(beta).not.toHaveAttribute('aria-current');
    expect(within(menu).queryByRole('link', { name: 'Create organization' })).toBeNull();
  });

  it('BR-44: one org shows an Organization menu button whose menu lists the name, Projects and Settings', async () => {
    const user = setup('oneOrg', { projectsHref, settingsHref });
    const trigger = screen.getByRole('button', { name: 'Switch scope, currently organization Acme' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(trigger);
    const menu = screen.getByRole('dialog', { name: 'Scope' });
    expect(within(menu).getByRole('heading', { name: 'Acme' })).toBeInTheDocument();
    const links = within(menu).getAllByRole('link');
    expect(links.map((l) => l.textContent?.trim())).toEqual(['Projects', 'Org settings']);
    expect(links[0]).toHaveAttribute('href', projectsHref);
    expect(links[1]).toHaveAttribute('href', settingsHref);
    expect(within(menu).queryByText('Switch organization')).toBeNull();
  });

  it('the current org group lists "Projects" and "Org settings"', async () => {
    const user = setup('oneOrg', { projectsHref, settingsHref });
    await user.click(screen.getByRole('button', { name: 'Switch scope, currently organization Acme' }));
    const menu = screen.getByRole('dialog');
    expect(within(menu).getByRole('link', { name: 'Org settings' })).toHaveAttribute('href', settingsHref);
  });

  it('BR-44: one org without settingsHref has no Settings item', async () => {
    const user = setup('oneOrg', { projectsHref });
    await user.click(screen.getByRole('button', { name: 'Switch scope, currently organization Acme' }));
    const menu = screen.getByRole('dialog');
    expect(within(menu).getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: 'Org settings' })).toBeNull();
  });

  it('BR-79: one suspended current org with legacy hrefs and no platform role is plain text, not a button', () => {
    render(
      <OrgSwitch
        current={{ id: 'o1', slug: 'acme', name: 'Acme', suspended: true }}
        orgs={[{ id: 'o1', slug: 'acme', name: 'Acme', suspended: true }]}
        platformAdmin={false}
        orgHref={orgHref}
        createHref={createHref}
        projectsHref={projectsHref}
        settingsHref={settingsHref}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Switch scope/ })).toBeNull();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('BR-12: several orgs and none current (not-found page) read "Organization", never "No organization"', () => {
    render(<OrgSwitch {...orgSwitchFixtures.severalOrgs} current={null} orgHref={orgHref} createHref={createHref} />);
    expect(button()).toHaveTextContent('Organization');
    expect(button()).not.toHaveTextContent('No organization');
  });

  it('BR-44: one org with no current org still shows the button for the lone org', () => {
    render(
      <OrgSwitch
        {...orgSwitchFixtures.oneOrg}
        current={null}
        orgHref={orgHref}
        createHref={createHref}
        projectsHref={projectsHref}
      />,
    );
    expect(screen.getByRole('button', { name: 'Switch scope, currently organization Acme' })).toBeInTheDocument();
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
    expect(labels).toEqual([
      'Projects',
      'Org settings',
      expect.stringContaining('Acme'),
      expect.stringContaining('Beta'),
    ]);
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
    expect(button()).toHaveAccessibleName('Switch scope, currently no organization');
    await user.click(button());
    const links = within(screen.getByRole('dialog')).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('Create organization');
  });

  it('long names ellipsize and keep the full name in a title', () => {
    setup('longName');
    expect(screen.getAllByTitle(orgSwitchFixtures.longName.current?.name ?? '')[0]).toBeInTheDocument();
  });

  it('BR-45: platformHref puts "Platform" first, before the orgs and "Create organization"', async () => {
    const user = setup('platformAdmin', { platformHref: '/platform/orgs' });
    await user.click(button());
    const links = within(screen.getByRole('dialog')).getAllByRole('link');
    expect(links.map((l) => l.textContent?.trim())).toEqual([
      'Platform',
      expect.stringContaining('Acme'),
      expect.stringContaining('Beta'),
      'Create organization',
    ]);
    expect(screen.getByRole('link', { name: 'Platform' })).toHaveAttribute('href', '/platform/orgs');
  });

  it('the Platform group is the first group and holds "Platform admin"', async () => {
    const user = setup('platformAdmin', { platformHref: '/platform/orgs', projectsHref, settingsHref });
    await user.click(button());
    const menu = screen.getByRole('dialog');
    const groups = within(menu).getAllByRole('group');
    expect(groups[0]).toHaveAccessibleName('Platform');
    expect(within(groups[0] as HTMLElement).getByRole('link', { name: 'Platform admin' })).toBeInTheDocument();
    const labels = within(menu)
      .getAllByRole('link')
      .map((l) => l.textContent?.trim() ?? '');
    expect(labels[0]).toBe('Platform admin');
    expect(labels.indexOf('Platform admin')).toBeLessThan(labels.indexOf('Projects'));
    expect(labels[labels.length - 1]).toBe('Create organization');
  });

  it('in platform scope the button reads "Platform" and is named "Switch scope, currently Platform"', () => {
    setup('platformAdmin', { scope: 'platform', platformHref: '/platform/orgs' });
    expect(screen.getByRole('button', { name: 'Switch scope, currently Platform' })).toHaveTextContent('Platform');
  });

  it('in platform scope "Platform admin" has aria-current="true" and no org is checked', async () => {
    const user = setup('platformAdmin', { scope: 'platform', platformHref: '/platform/orgs', projectsHref });
    await user.click(button());
    const menu = screen.getByRole('dialog');
    expect(within(menu).getByRole('link', { name: 'Platform admin' })).toHaveAttribute('aria-current', 'true');
    for (const name of [/Acme/, /Beta/]) {
      expect(within(menu).getByRole('link', { name })).not.toHaveAttribute('aria-current');
    }
    expect(within(menu).queryByRole('link', { name: 'Projects' })).toBeNull();
  });

  it('in org scope "Platform" is not marked current', async () => {
    const user = setup('platformAdmin', { platformHref: '/platform/orgs' });
    await user.click(button());
    expect(screen.getByRole('link', { name: 'Platform' })).not.toHaveAttribute('aria-current');
  });

  it('a platform admin with no membership sees no "Switch organization" group', async () => {
    const user = setup('platformAdminNoOrg', { scope: 'platform', platformHref: '/platform/orgs' });
    expect(button()).toHaveAccessibleName('Switch scope, currently Platform');
    await user.click(button());
    expect(within(screen.getByRole('dialog')).queryByRole('group', { name: 'Switch organization' })).toBeNull();
  });

  it('without platformAdmin and platformHref there is no Platform group', async () => {
    const user = setup('severalOrgs');
    await user.click(button());
    expect(within(screen.getByRole('dialog')).queryByRole('group', { name: 'Platform' })).toBeNull();
  });

  it('in org scope with one membership there is no "Switch organization" group', async () => {
    const user = setup('oneOrg', { projectsHref });
    await user.click(button());
    expect(within(screen.getByRole('dialog')).queryByRole('group', { name: 'Switch organization' })).toBeNull();
  });

  it('BR-1: platformHref shows the item with no orgs and no current org', async () => {
    const user = setup('platformAdminNoOrg', { platformHref: '/platform/orgs' });
    await user.click(button());
    const links = within(screen.getByRole('dialog')).getAllByRole('link');
    expect(links.map((l) => l.textContent?.trim())).toEqual(['Platform', 'Create organization']);
  });

  it('BR-1: platformHref with no orgs, no current org and no create right still opens a menu', async () => {
    const user = userEvent.setup();
    render(<OrgSwitch {...noOrgData} orgHref={orgHref} createHref={createHref} platformHref="/platform/orgs" />);
    await user.click(button());
    const links = within(screen.getByRole('dialog')).getAllByRole('link');
    expect(links.map((l) => l.textContent?.trim())).toEqual(['Platform']);
  });

  it('BR-1: without platformHref there is no "Platform" item', async () => {
    const user = setup('platformAdmin');
    await user.click(button());
    expect(screen.queryByRole('link', { name: 'Platform' })).toBeNull();
  });

  it('BR-48: a suspended option reads "Suspended" and still links', async () => {
    const user = userEvent.setup();
    const [acme, beta] = orgSwitchFixtures.severalOrgs.orgs;
    if (!acme || !beta) throw new Error('fixture');
    render(
      <OrgSwitch
        {...orgSwitchFixtures.severalOrgs}
        orgs={[acme, { ...beta, suspended: true }]}
        orgHref={orgHref}
        createHref={createHref}
      />,
    );
    await user.click(button());
    const menu = screen.getByRole('dialog');
    const link = within(menu).getByRole('link', { name: /Beta/ });
    expect(link).toHaveTextContent('Suspended');
    expect(link).toHaveAttribute('href', '/o/beta');
    expect(within(menu).getByRole('link', { name: /Acme/ })).not.toHaveTextContent('Suspended');
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

  it('"Manage this org in Platform" is absent without manageHref', async () => {
    const user = setup('platformAdmin', { platformHref: '/platform' });
    await user.click(button());
    expect(screen.queryByRole('link', { name: 'Manage this org in Platform' })).not.toBeInTheDocument();
  });

  it('with manageHref the item sits in the Platform group and links to it', async () => {
    const user = setup('platformAdmin', { platformHref: '/platform', manageHref: '/platform/orgs/org-1' });
    await user.click(button());
    const group = within(screen.getByRole('group', { name: 'Platform' }));
    expect(group.getByRole('link', { name: 'Manage this org in Platform' })).toHaveAttribute(
      'href',
      '/platform/orgs/org-1',
    );
  });

  it('the item does not show in the platform scope', async () => {
    const user = setup('platformAdmin', {
      platformHref: '/platform',
      manageHref: '/platform/orgs/org-1',
      scope: 'platform',
    });
    await user.click(button());
    expect(screen.queryByRole('link', { name: 'Manage this org in Platform' })).not.toBeInTheDocument();
  });

  describe('scope-only states', () => {
    const [acme, beta] = orgSwitchFixtures.severalOrgs.orgs;
    if (!acme || !beta) throw new Error('fixture');
    const platformHref = '/platform/orgs';
    const admin = { current: acme, orgs: [acme, beta], platformAdmin: true, platformHref };
    type Data = Partial<OrgSwitchProps> & Pick<OrgSwitchProps, 'orgs' | 'platformAdmin' | 'current'>;
    const tree = (data: Data) => (
      <div>
        <OrgSwitch {...data} orgHref={orgHref} createHref={createHref} />
        <button>Elsewhere</button>
      </div>
    );
    const mount = (data: Data) => {
      const user = userEvent.setup();
      const view = render(tree(data));
      return { user, show: (next: Data) => view.rerender(tree(next)) };
    };
    const loading = { status: 'loading' } as const;
    const failed = { status: 'error', onRetry: () => undefined } as const;

    it('loading: the button reads "Organization", not an org name, with a skeleton and a spoken status', async () => {
      const { user } = mount({ ...admin, list: loading });
      expect(button()).toHaveAccessibleName('Switch scope');
      expect(button()).toHaveTextContent(/^Organization$/);
      expect(screen.queryByText('No organization')).toBeNull();
      await user.click(button());
      expect(screen.getByRole('status')).toHaveTextContent('Loading organizations');
      expect(screen.queryByText('Acme')).toBeNull();
    });

    it('loading in the platform scope reads "Platform"', () => {
      mount({ ...admin, list: loading, scope: 'platform' });
      expect(button()).toHaveAccessibleName('Switch scope');
      expect(button()).toHaveTextContent(/^Platform$/);
    });

    it('error: says it could not load, and Retry calls onRetry and is reachable by keyboard', async () => {
      const onRetry = vi.fn();
      const { user } = mount({ ...admin, list: { status: 'error', onRetry } });
      expect(button()).toHaveTextContent(/^Organization$/);
      button().focus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load your organizations.');
      const retry = screen.getByRole('button', { name: 'Retry' });
      await user.keyboard('{ArrowDown}');
      expect(retry).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['loading', loading],
      ['error', failed],
      ['ready', undefined],
    ])('%s: a platform admin sees Platform and Create organization', async (_name, list) => {
      const { user } = mount({ ...admin, list });
      await user.click(button());
      const menu = screen.getByRole('dialog', { name: 'Scope' });
      expect(within(menu).getByRole('link', { name: 'Platform' })).toHaveAttribute('href', platformHref);
      expect(within(menu).getByRole('link', { name: 'Create organization' })).toHaveAttribute('href', createHref);
    });

    it.each([
      ['loading', loading],
      ['error', failed],
      ['ready', undefined],
    ])('%s: a person who is not a platform admin never sees them', async (_name, list) => {
      const { user } = mount({ current: acme, orgs: [acme, beta], platformAdmin: false, list });
      await user.click(button());
      const menu = screen.getByRole('dialog', { name: 'Scope' });
      expect(within(menu).queryByRole('link', { name: 'Platform' })).toBeNull();
      expect(within(menu).queryByRole('link', { name: 'Create organization' })).toBeNull();
    });

    it('ready: Platform, separator, orgs with the current checked and suspended labelled, separator, Create', async () => {
      const { user } = mount({ ...admin, orgs: [acme, { ...beta, suspended: true }] });
      await user.click(button());
      const parts = Array.from(screen.getByRole('dialog').querySelectorAll('a, [role=separator]'));
      expect(parts.map((e) => (e.getAttribute('role') === 'separator' ? '|' : e.textContent?.trim()))).toEqual([
        'Platform',
        '|',
        expect.stringContaining('Acme'),
        expect.stringContaining('Beta'),
        '|',
        'Create organization',
      ]);
      expect(screen.getByRole('link', { name: /Acme/ })).toHaveAttribute('aria-current', 'true');
      expect(screen.getByRole('link', { name: /Beta/ })).toHaveTextContent('Suspended');
    });

    it('ready with one org, no platform role and no legacy link: plain text, no button', () => {
      mount({ current: acme, orgs: [acme], platformAdmin: false });
      expect(screen.queryByRole('button', { name: /^Switch scope/ })).toBeNull();
      expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    it('ready with no org: plain "No organization"', () => {
      mount({ current: null, orgs: [], platformAdmin: false });
      expect(screen.queryByRole('button', { name: /^Switch scope/ })).toBeNull();
      expect(screen.getByText('No organization')).toBeInTheDocument();
    });

    it('with several orgs, or a platform admin with one, it stays a button', () => {
      const { unmount } = render(tree({ current: acme, orgs: [acme, beta], platformAdmin: false }));
      expect(button()).toBeInTheDocument();
      unmount();
      render(tree({ current: acme, orgs: [acme], platformAdmin: true }));
      expect(button()).toBeInTheDocument();
    });

    describe('hold while open or focused when the list arrives', () => {
      const one = { current: acme, orgs: [acme], platformAdmin: false };

      it('open when the list arrives: stays a button listing the one org, checked', async () => {
        const { user, show } = mount({ ...one, list: loading });
        await user.click(button());
        show(one);
        expect(button()).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Acme/ })).toHaveAttribute('aria-current', 'true');
      });

      it('open when an empty list arrives: a non-pickable "No organization" line', async () => {
        const none = { current: null, orgs: [], platformAdmin: false };
        const { user, show } = mount({ ...none, list: loading });
        await user.click(button());
        show(none);
        const menu = screen.getByRole('dialog', { name: 'Scope' });
        expect(within(menu).getByText('No organization')).toBeInTheDocument();
        expect(within(menu).queryByRole('link')).toBeNull();
        expect(within(menu).queryByRole('button')).toBeNull();
      });

      it('focus moving into the entries is not leaving', async () => {
        const { user, show } = mount({ ...one, list: loading });
        button().focus();
        await user.keyboard('{ArrowDown}');
        show(one);
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('link', { name: /Acme/ })).toHaveFocus();
        expect(button()).toBeInTheDocument();
      });

      it('Escape closes, focus returns, and it is still a button', async () => {
        const { user, show } = mount({ ...one, list: loading });
        button().focus();
        await user.keyboard('{ArrowDown}');
        show(one);
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(button()).toHaveFocus();
      });

      it('after Escape, Tab away turns it into plain text', async () => {
        const { user, show } = mount({ ...one, list: loading });
        button().focus();
        await user.keyboard('{ArrowDown}');
        show(one);
        await user.keyboard('{Escape}');
        await user.tab();
        expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
        expect(screen.queryByRole('button', { name: /^Switch scope/ })).toBeNull();
        expect(screen.getByText('Acme')).toBeInTheDocument();
      });

      it('focused but closed holds until focus leaves', async () => {
        const { user, show } = mount({ ...one, list: loading });
        button().focus();
        show(one);
        expect(button()).toHaveFocus();
        await user.tab();
        expect(screen.queryByRole('button', { name: /^Switch scope/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
      });

      it('an outside press that moves focus gives plain text and focus stays on the control moved to', async () => {
        const { user, show } = mount({ ...one, list: loading });
        await user.click(button());
        show(one);
        await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
        expect(screen.queryByRole('button', { name: /^Switch scope/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
      });
    });

    it('BR-53: arrows move through the entries once the list shows, after opening while loading', async () => {
      const { user, show } = mount({ ...admin, list: loading });
      button().focus();
      await user.keyboard('{Enter}');
      show(admin);
      expect(await screen.findByRole('link', { name: 'Platform' })).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('link', { name: /Acme/ })).toHaveFocus();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(button()).toHaveFocus();
    });

    it('Escape closes the menu while it is still loading', async () => {
      const { user } = mount({ ...admin, list: loading });
      button().focus();
      await user.keyboard('{Enter}');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(button()).toHaveFocus();
    });
  });
});
