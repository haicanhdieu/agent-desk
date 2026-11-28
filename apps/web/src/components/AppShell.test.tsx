import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useEffect, type ReactNode } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setViewportWidth } from '@/test/fakeMatchMedia';
import { AppShell, type MenuMode } from './AppShell';
import { ShellContext, useReportPageState, type ShellContextValue } from './shellContext';
import { ShellFrame } from '@/screens/shellFrame';
import { TopBar } from './TopBar';
import { NO_PAGE_CRUMBS } from './pageTitle';

const css = readFileSync(resolve(__dirname, 'Chrome.module.css'), 'utf8');
const bar = <header>bar</header>;
const menu = <nav aria-label="Side menu">menu</nav>;
const modes: MenuMode[] = ['none', 'full', 'collapsed', 'drawer', 'wizard'];
const user = { login: 'kim-hale', initials: 'KH' };

function Probe({ onMount }: { onMount(): void }) {
  useEffect(onMount, [onMount]);
  return <p>page</p>;
}

describe('AppShell', () => {
  it('marks the root as fixed-height for a numeric height, and not for fill', () => {
    const { container, rerender } = render(
      <AppShell topBar={bar} menu={menu} menuMode="full" height={600}>
        <p>page</p>
      </AppShell>,
    );
    expect((container.firstElementChild as HTMLElement).className).toMatch(/appFixed/);
    rerender(
      <AppShell topBar={bar} menu={menu} menuMode="full" height="viewport">
        <p>page</p>
      </AppShell>,
    );
    expect((container.firstElementChild as HTMLElement).className).not.toMatch(/appFixed/);
  });

  it('has one banner (the top bar) and no main of its own', () => {
    render(
      <AppShell topBar={bar} menu={menu} menuMode="full">
        <p>page</p>
      </AppShell>,
    );
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.queryByRole('main')).toBeNull();
  });

  it('renders no navigation when the menu mode is none, even with a menu', () => {
    render(
      <AppShell topBar={bar} menu={menu}>
        <p>page</p>
      </AppShell>,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('keeps the node that holds the children, mounted once, through every menu mode and the drawer', () => {
    const onMount = vi.fn();
    const make = (menuMode: MenuMode, drawerOpen: boolean) => (
      <AppShell topBar={bar} menu={menu} menuMode={menuMode} drawerOpen={drawerOpen}>
        <Probe onMount={onMount} />
      </AppShell>
    );
    const { rerender } = render(make('none', false));
    const holder = screen.getByText('page').parentElement;
    for (const mode of modes) {
      for (const open of [true, false]) {
        rerender(make(mode, open));
        expect(screen.getByText('page').parentElement).toBe(holder);
      }
    }
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('never wraps the content in the drawer', () => {
    render(
      <AppShell topBar={bar} menu={menu} menuMode="drawer" drawerOpen onDrawerClose={() => {}}>
        <p>page</p>
      </AppShell>,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('navigation', { name: 'Side menu' })).toBeInTheDocument();
    expect(dialog).not.toContainElement(screen.getByText('page'));
  });

  it('draws one copy of the menu: inline for full, in the drawer only when it is open', () => {
    const { rerender } = render(
      <AppShell topBar={bar} menu={menu} menuMode="full">
        <p>page</p>
      </AppShell>,
    );
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(
      <AppShell topBar={bar} menu={menu} menuMode="drawer" drawerOpen={false}>
        <p>page</p>
      </AppShell>,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('calls onDrawerClose when the drawer closes with Escape', async () => {
    const onClose = vi.fn();
    render(
      <AppShell topBar={bar} menu={menu} menuMode="drawer" drawerOpen onDrawerClose={onClose}>
        <p>page</p>
      </AppShell>,
    );
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('hands the wizard slot out inline at 1440', () => {
    const slot = vi.fn();
    render(
      <AppShell topBar={bar} menuMode="wizard" wizardSlotRef={slot}>
        <p>page</p>
      </AppShell>,
    );
    const el = slot.mock.calls
      .map((c) => c[0] as HTMLElement | null)
      .filter(Boolean)
      .at(-1);
    expect(el).toBeInstanceOf(HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hands the wizard slot out inside the open drawer at 390', () => {
    setViewportWidth(390);
    const slot = vi.fn();
    render(
      <AppShell topBar={bar} menuMode="wizard" wizardSlotRef={slot} drawerOpen onDrawerClose={() => {}}>
        <p>page</p>
      </AppShell>,
    );
    const el = slot.mock.calls
      .map((c) => c[0] as HTMLElement | null)
      .filter(Boolean)
      .at(-1);
    expect(el).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('dialog')).toContainElement(el as HTMLElement);
  });

  it('gives the wizard slot no home while the 390 drawer is closed', () => {
    setViewportWidth(390);
    const slot = vi.fn();
    render(
      <AppShell topBar={bar} menuMode="wizard" wizardSlotRef={slot} drawerOpen={false}>
        <p>page</p>
      </AppShell>,
    );
    expect(slot.mock.calls.map((c) => c[0]).filter(Boolean)).toHaveLength(0);
  });

  it('moves the wizard slot into the drawer when the window narrows', () => {
    const slot = vi.fn();
    render(
      <AppShell topBar={bar} menuMode="wizard" wizardSlotRef={slot} drawerOpen onDrawerClose={() => {}}>
        <p>page</p>
      </AppShell>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => setViewportWidth(390));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('AppShell fill mode', () => {
  const content = (root: HTMLElement) => root.querySelector('[data-slot="content"]');

  it('marks the root and the content slot as fill with height viewport', () => {
    const { container } = render(
      <AppShell topBar={bar} height="viewport">
        <p>page</p>
      </AppShell>,
    );
    expect(container.firstElementChild).toHaveClass('appViewport');
    expect(content(container)).toHaveClass('contentFill');
  });

  it('marks fill through ShellFrame fill, and lets a given height win', () => {
    const { container, rerender } = render(
      <ShellFrame fill topBar={{ user, crumbs: NO_PAGE_CRUMBS }}>
        <p>page</p>
      </ShellFrame>,
    );
    expect(container.querySelector('.appViewport')).not.toBeNull();
    expect(content(container)).toHaveClass('contentFill');
    rerender(
      <ShellFrame fill height={600} topBar={{ user, crumbs: NO_PAGE_CRUMBS }}>
        <p>page</p>
      </ShellFrame>,
    );
    expect(container.querySelector('.appViewport')).toBeNull();
    expect(container.firstElementChild).toHaveStyle({ height: '600px' });
  });

  it('has no fixed height and no fill classes without it', () => {
    const { container } = render(
      <AppShell topBar={bar}>
        <p>page</p>
      </AppShell>,
    );
    expect(container.firstElementChild).not.toHaveClass('appViewport');
    expect((container.firstElementChild as HTMLElement).style.height).toBe('');
    expect(content(container)).not.toHaveClass('contentFill');
  });

  it('lets the CSS size the slot, scroll the menu on its own and subtract no bar height', () => {
    expect(css).toMatch(/\.contentFill\s*\{[^}]*flex:\s*1\b[^}]*min-height:\s*0/);
    expect(css).toMatch(/\.menuSlot\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).not.toMatch(/calc\([^)]*52px/);
  });
});

describe('shell context', () => {
  function Report({ state }: { state: 'error' | 'loading' | 'notFound' | undefined }) {
    useReportPageState(state);
    return null;
  }
  const wrap = (reportPageState: ShellContextValue['reportPageState'], child: ReactNode) => (
    <ShellContext.Provider value={{ wizardSlot: null, reportPageState }}>{child}</ShellContext.Provider>
  );

  it('reports a page state and undoes it on unmount', () => {
    const undo = vi.fn();
    const report = vi.fn(() => undo);
    const { unmount } = render(wrap(report, <Report state="error" />));
    expect(report).toHaveBeenCalledWith('error');
    expect(undo).not.toHaveBeenCalled();
    unmount();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('reports nothing for an undefined state, or without a provider', () => {
    const report = vi.fn(() => () => {});
    render(wrap(report, <Report state={undefined} />));
    expect(report).not.toHaveBeenCalled();
    expect(() => render(<Report state="loading" />)).not.toThrow();
  });
});

describe('TopBar in the shell', () => {
  const base = { user, crumbs: NO_PAGE_CRUMBS } as const;
  it('shows Open menu only with onOpenMenu, with aria-expanded', () => {
    const { rerender } = render(<TopBar {...base} />);
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
    rerender(<TopBar {...base} onOpenMenu={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false');
    rerender(<TopBar {...base} onOpenMenu={() => {}} menuOpen />);
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'true');
  });
});
