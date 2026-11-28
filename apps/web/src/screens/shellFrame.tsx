import { useCallback, useMemo, useState } from 'react';
import {
  AppShell,
  ShellContext,
  SubNav,
  TopBar,
  type AppShellProps,
  type ShellContextValue,
  type SubNavProps,
  type TopBarProps,
} from '@/components';

/** The menu of a story: the model the host would build, drawn with the collapse button it keeps state for. */
export type ShellFrameMenu = Omit<SubNavProps, 'collapsed' | 'onToggleCollapsed'>;

/**
 * Stories only: the shell around a screen, with the context that tells the screen to draw only its page. This and
 * `ShellHost` are the only files that render the bar, the menu and the shell.
 */
export function ShellFrame({
  topBar,
  wizard,
  fill,
  height,
  menuMode,
  menu,
  menuModel,
  collapsed: startCollapsed = false,
  wizardSlotRef,
  children,
  ...rest
}: Omit<AppShellProps, 'topBar'> & {
  topBar: TopBarProps;
  wizard?: boolean;
  fill?: boolean;
  /** A menu the frame draws with its own collapse state; `menuMode` follows it unless given. */
  menuModel?: ShellFrameMenu;
  /** With `menuModel`: start collapsed to the 48px strip. */
  collapsed?: boolean;
}) {
  const [wizardSlot, setWizardSlot] = useState<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const value = useMemo<ShellContextValue>(() => ({ wizardSlot, reportPageState: () => () => {} }), [wizardSlot]);
  const slotRef = useCallback(
    (el: HTMLElement | null) => {
      setWizardSlot(el);
      wizardSlotRef?.(el);
    },
    [wizardSlotRef],
  );
  const drawn =
    menuModel === undefined ? (
      menu
    ) : (
      <SubNav {...menuModel} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
    );
  const mode = wizard
    ? 'wizard'
    : (menuMode ?? (menuModel === undefined ? undefined : collapsed ? 'collapsed' : 'full'));
  return (
    <ShellContext.Provider value={value}>
      <AppShell
        {...rest}
        menu={drawn}
        height={height ?? (fill ? 'viewport' : undefined)}
        menuMode={mode}
        wizardSlotRef={slotRef}
        topBar={<TopBar {...topBar} />}
      >
        {children}
      </AppShell>
    </ShellContext.Provider>
  );
}
