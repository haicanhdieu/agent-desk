import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSwitch, type ProjectSwitchMenu } from './ProjectSwitch';

const items = [
  { name: 'invoicer-api', needsYou: 1, current: true, href: '/p/api' },
  { name: 'invoicer-web', needsYou: 0, href: '/p/web' },
  { name: 'docs-site', needsYou: 0, href: '/p/docs' },
];
const ready: ProjectSwitchMenu = { status: 'ready', items };
const button = () => screen.getByRole('button', { name: /^Switch project/ });

function setup(menu?: ProjectSwitchMenu) {
  const user = userEvent.setup();
  render(
    <div>
      <ProjectSwitch project="invoicer-api" menu={menu} />
      <button>Elsewhere</button>
    </div>,
  );
  return user;
}

describe('ProjectSwitch menu', () => {
  it('the button shows only the project name', () => {
    setup();
    expect(button()).toHaveTextContent(/^invoicer-api$/);
    expect(button()).toHaveAccessibleName('Switch project, currently invoicer-api');
  });

  it('without a menu the button stays inert', async () => {
    const user = setup();
    await user.click(button());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).not.toHaveAttribute('aria-expanded');
  });

  it('calls onOpen when the menu opens, not before', async () => {
    const onOpen = vi.fn();
    const user = setup({ status: 'loading', onOpen });
    expect(onOpen).not.toHaveBeenCalled();
    await user.click(button());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Loading projects');
  });

  it('click toggles the menu and aria-expanded', async () => {
    const user = setup(ready);
    expect(button()).toHaveAttribute('aria-expanded', 'false');
    await user.click(button());
    expect(button()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('link', { name: /invoicer-api/ })).toHaveAttribute('aria-current', 'true');
    await user.click(button());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape closes the menu and returns focus to the button', async () => {
    const user = setup(ready);
    await user.click(button());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveFocus();
  });

  it('an outside click closes the menu', async () => {
    const user = setup(ready);
    await user.click(button());
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveAttribute('aria-expanded', 'false');
  });

  it('ArrowDown on the closed button opens the menu with focus on the first project', async () => {
    const user = setup(ready);
    button().focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('dialog', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /invoicer-api/ })).toHaveFocus();
  });

  it('arrow keys, Home and End move between projects and wrap around', async () => {
    const user = setup(ready);
    await user.click(button());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: /invoicer-web/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('link', { name: /docs-site/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: /invoicer-api/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('link', { name: /docs-site/ })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('link', { name: /invoicer-api/ })).toHaveFocus();
  });

  it('following a project link closes the menu', async () => {
    const user = setup(ready);
    await user.click(button());
    const link = screen.getByRole('link', { name: /invoicer-web/ });
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('loading shows a status and no links', async () => {
    const user = setup({ status: 'loading' });
    await user.click(button());
    expect(screen.getByRole('status')).toHaveTextContent('Loading projects');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('empty says there are no projects', async () => {
    const user = setup({ status: 'ready', items: [] });
    await user.click(button());
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
  });

  it('error shows an alert and Retry calls onRetry', async () => {
    const onRetry = vi.fn();
    const user = setup({ status: 'error', onRetry });
    await user.click(button());
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your projects.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  describe('BR-53: the list arrives after opening', () => {
    const mount = (menu: ProjectSwitchMenu) => {
      const user = userEvent.setup();
      const tree = (m: ProjectSwitchMenu) => (
        <div>
          <ProjectSwitch project="invoicer-api" menu={m} />
          <button>Elsewhere</button>
        </div>
      );
      const view = render(tree(menu));
      return { user, show: (m: ProjectSwitchMenu) => view.rerender(tree(m)) };
    };

    it('arrows work when the list arrives after opening', async () => {
      const { user, show } = mount({ status: 'loading' });
      button().focus();
      await user.keyboard('{Enter}');
      show({ status: 'ready', items: items.slice(0, 2) });
      expect(await screen.findByRole('link', { name: /invoicer-api/ })).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('link', { name: /invoicer-web/ })).toHaveFocus();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(button()).toHaveFocus();
    });

    it('Escape closes the menu while it is still loading', async () => {
      const { user } = mount({ status: 'loading' });
      button().focus();
      await user.keyboard('{Enter}');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(button()).toHaveFocus();
    });

    it('focus that moved outside before the list arrived is not pulled back', async () => {
      const { user, show } = mount({ status: 'loading' });
      button().focus();
      await user.keyboard('{Enter}');
      screen.getByRole('button', { name: 'Elsewhere' }).focus();
      show({ status: 'ready', items });
      expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
    });
  });

  describe('scope switcher states', () => {
    const footer = { allProjectsHref: '/o/acme/projects', newProjectHref: '/o/acme/projects/new' };
    const states: [string, ProjectSwitchMenu][] = [
      ['loading', { status: 'loading', ...footer }],
      ['error', { status: 'error', onRetry: () => undefined, ...footer }],
      ['empty', { status: 'ready', items: [], ...footer }],
      ['ready', { status: 'ready', items, ...footer }],
    ];

    it.each(states)('%s: titled "Switch project", footer has All projects and New project', async (_n, menu) => {
      const user = setup(menu);
      await user.click(button());
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Switch project')).toBeInTheDocument();
      expect(within(dialog).getByRole('link', { name: 'All projects' })).toHaveAttribute(
        'href',
        footer.allProjectsHref,
      );
      expect(within(dialog).getByRole('link', { name: 'New project' })).toHaveAttribute('href', footer.newProjectHref);
    });

    it('without newProjectHref there is no New project', async () => {
      const user = setup({ status: 'ready', items, allProjectsHref: footer.allProjectsHref });
      await user.click(button());
      expect(screen.getByRole('link', { name: 'All projects' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'New project' })).toBeNull();
    });

    it('labels counts "{n} needs you" only when above 0', async () => {
      const user = setup({ status: 'ready', items, ...footer });
      await user.click(button());
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('1 needs you')).toBeInTheDocument();
      expect(within(dialog).queryByText('0')).toBeNull();
      expect(within(dialog).queryByText(/^0 needs you/)).toBeNull();
    });

    it('error keeps its alert and Retry beside the footer', async () => {
      const onRetry = vi.fn();
      const user = setup({ status: 'error', onRetry, ...footer });
      await user.click(button());
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load your projects.');
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });
});
