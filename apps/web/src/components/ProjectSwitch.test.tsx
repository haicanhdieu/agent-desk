import { render, screen } from '@testing-library/react';
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
      <ProjectSwitch org="harbor-labs" project="invoicer-api" menu={menu} />
      <button>Elsewhere</button>
    </div>,
  );
  return user;
}

describe('ProjectSwitch menu', () => {
  it('without a menu the button stays inert', async () => {
    const user = setup();
    await user.click(button());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).not.toHaveAttribute('aria-expanded');
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
});
